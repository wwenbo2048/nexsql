/**
 * /nexsql/* HTTP 路由：浏览器面板与 Host 之间的桥。
 *
 * 挂在 ctx.webServer 上（prefix 路由），刻意避开 /api 前缀（该前缀带
 * dsh 的浏览器信任围栏）。POST（SQL 执行）要求同源；GET 查询参数驱动。
 * 失败策略：单个请求错误返回 JSON 错误，不影响其他路由。
 */
import { createReadStream, statSync } from 'node:fs'
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http'
import { dirname, join, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { McpConnectionConfig } from '../../src/mcp/types.js'
import { loadConfig } from '../../src/mcp/config.js'
import { testConnection } from '../../src/mcp/connection-manager.js'
import { dispatchRapi } from './rapi.js'
import {
  panelColumns,
  panelConnections,
  panelData,
  panelDatabases,
  panelQuery,
  panelRedisInfo,
  panelRedisKey,
  panelRedisKeys,
  panelTables,
} from './panel-service.js'

/** ctx.webServer 的最小结构面（权威定义见 deepseek-harness docs/subsystems/web-server.md）。 */
export interface WebServerRoute {
  kind: 'exact' | 'prefix'
  path: string
  handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>
}

export interface WebServerService {
  register(route: WebServerRoute): () => void
  readonly port?: number
  readonly host?: number | string
}

/**
 * 浏览器鉴权门：优先接 dsh Connection 服务的 requestRejection
 * （Host/Origin 围栏 + 进程 token / dsh-auth cookie 会话）。
 * 旧运行时（0.1.1-rc.2 等）无该方法时，退化为下方 isTrustedApiRequest
 * 等强度围栏；服务不可用时保持 undefined，退化为仅同源校验。
 */
export interface AuthGate {
  reject?: (request: IncomingMessage) => number | undefined
}

// ==================== dsh /api 信任围栏的等价实现 ====================

/**
 * 等价于 @deepseek-ai/dsh-client-connection 的 isTrustedApiRequest
 * （master 与 0.1.1-rc.2 语义一致）。profile 插件不能 import 该包
 * （插件按自身路径解析 node_modules，解析不到 dsh 运行时），故内联；
 * 上游围栏语义变化时同步本节。
 */
function parseAuthority(authority: string): URL | undefined {
  try {
    return new URL(`http://${authority}`)
  } catch {
    return undefined
  }
}

/** localhost、IPv6 回环或 127/8 内的任意 IPv4 字面量。 */
function isLoopbackHostname(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '[::1]') return true
  const parts = hostname.split('.')
  return parts.length === 4 && parts[0] === '127' && parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255)
}

/** 规范化的 `hostname[:port]`；端口从 http/https 两种解析判定，默认端口也算显式。 */
function canonicalAuthority(entry: string, entryUrl: URL): string {
  const port = entryUrl.port !== '' ? entryUrl.port : new URL(`https://${entry}`).port
  return port === '' ? entryUrl.hostname : `${entryUrl.hostname}:${port}`
}

/** 显式端口的条目按精确 authority 匹配；无端口条目按 hostname 匹配任意端口。 */
function isTrustedAuthority(hostUrl: URL, trustedHosts: readonly string[]): boolean {
  return trustedHosts.some((entry) => {
    const entryUrl = parseAuthority(entry)
    if (entryUrl === undefined) return false
    return canonicalAuthority(entry, entryUrl) === entryUrl.hostname
      ? entryUrl.hostname === hostUrl.hostname
      : entryUrl.host === hostUrl.host
  })
}

/**
 * Host 是本机（loopback 或 trustedHosts）且浏览器标记（若有）同源。
 * 防 DNS rebinding 与跨站请求；非浏览器客户端同样受 Host 绑定约束。
 */
export function isTrustedApiRequest(
  request: { headers: IncomingHttpHeaders },
  trustedHosts: readonly string[],
): boolean {
  const headers = request.headers
  const host = headers.host
  if (host === undefined) return false
  const hostUrl = parseAuthority(host)
  if (hostUrl === undefined) return false
  if (!isLoopbackHostname(hostUrl.hostname) && !isTrustedAuthority(hostUrl, trustedHosts)) return false
  if (headers['sec-fetch-site'] === 'cross-site') return false
  const origin = headers.origin
  if (origin === undefined) return true
  try {
    return new URL(origin).host === hostUrl.host
  } catch {
    return false
  }
}

/** 路由前缀：webserver 的 prefix 按路径段匹配（p 与 p/<anything>），不能带尾斜杠。 */
const ROUTE_PREFIX = '/nexsql'
const MAX_BODY_BYTES = 1024 * 1024

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  response.end(payload)
}

function sendError(response: ServerResponse, status: number, message: string): void {
  sendJson(response, status, { error: message })
}

/** 同源校验：无 Origin（curl / 本机工具）放行；跨源浏览器 POST 拒绝。 */
function sameOrigin(request: IncomingMessage): boolean {
  const origin = request.headers.origin
  if (origin === undefined) return true
  const host = request.headers.host
  if (host === undefined) return false
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = chunk as Buffer
    size += buffer.length
    if (size > MAX_BODY_BYTES) throw new Error('body too large')
    chunks.push(buffer)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  return text === '' ? undefined : JSON.parse(text)
}

/** 解析查询参数为 Record。 */
function queryOf(url: string): URLSearchParams {
  const idx = url.indexOf('?')
  return new URLSearchParams(idx >= 0 ? url.slice(idx + 1) : '')
}

function requireParam(query: URLSearchParams, name: string): string {
  const v = query.get(name)
  if (typeof v !== 'string' || v === '') throw new Error(`缺少参数 "${name}"`)
  return v
}

function optionalNumber(query: URLSearchParams, name: string, fallback: number): number {
  const v = query.get(name)
  if (v === null || v === '') return fallback
  const n = Number(v)
  if (!Number.isFinite(n)) throw new Error(`参数 "${name}" 不是数字`)
  return n
}

/** 按连接 ID 解析配置。 */
function requireConnection(connectionId: string): McpConnectionConfig {
  const conn = loadConfig().connections.find((c) => c.id === connectionId)
  if (!conn) throw new Error(`连接 "${connectionId}" 不存在`)
  return conn
}

/** 把面板请求分发到数据服务。 */
async function dispatch(path: string, query: URLSearchParams, body: unknown, request: IncomingMessage, response: ServerResponse): Promise<void> {
  // renderer Web SPA 的 API 桥：POST /nexsql/rapi/<ns>/<method>
  if (path === '/rapi' || path.startsWith('/rapi/')) {
    if (request.method !== 'POST') {
      sendError(response, 405, 'rapi 需要 POST')
      return
    }
    if (!sameOrigin(request)) {
      sendError(response, 403, '跨源请求被拒绝')
      return
    }
    const segments = path.split('/').filter(Boolean) // ['rapi', ns, method]
    const ns = segments[1]
    const method = segments[2]
    if (!ns || !method) {
      sendError(response, 400, 'rapi 路径需要 /rapi/<ns>/<method>')
      return
    }
    const b = (body ?? {}) as { args?: unknown }
    const args = Array.isArray(b.args) ? b.args : []
    const result = await dispatchRapi(ns, method, args)
    sendJson(response, result.status, result.body)
    return
  }

  // renderer Web SPA 静态资源：/nexsql/app/*（产物在 dsh-plugin/webui/）
  if (path === '/app' || path.startsWith('/app/')) {
    serveWebUi(path, response)
    return
  }

  switch (path) {
    case '/connections': {
      const config = loadConfig()
      sendJson(response, 200, { connections: await panelConnections(config.connections) })
      return
    }
    case '/test': {
      const conn = requireConnection(requireParam(query, 'connectionId'))
      const ok = await testConnection(conn)
      sendJson(response, 200, { ok, name: conn.name })
      return
    }
    case '/databases': {
      const conn = requireConnection(requireParam(query, 'connectionId'))
      sendJson(response, 200, await panelDatabases(conn))
      return
    }
    case '/tables': {
      const conn = requireConnection(requireParam(query, 'connectionId'))
      sendJson(response, 200, await panelTables(conn, requireParam(query, 'database')))
      return
    }
    case '/columns': {
      const conn = requireConnection(requireParam(query, 'connectionId'))
      sendJson(response, 200, await panelColumns(conn, requireParam(query, 'database'), requireParam(query, 'table')))
      return
    }
    case '/data': {
      const conn = requireConnection(requireParam(query, 'connectionId'))
      sendJson(response, 200, await panelData(
        conn,
        requireParam(query, 'database'),
        requireParam(query, 'table'),
        optionalNumber(query, 'limit', 50),
        optionalNumber(query, 'offset', 0),
        query.get('where') ?? undefined
      ))
      return
    }
    case '/query': {
      if (request.method !== 'POST') {
        sendError(response, 405, 'query 需要 POST')
        return
      }
      if (!sameOrigin(request)) {
        sendError(response, 403, '跨源请求被拒绝')
        return
      }
      const b = (body ?? {}) as { connectionId?: unknown; sql?: unknown; database?: unknown }
      if (typeof b.connectionId !== 'string' || typeof b.sql !== 'string' || b.sql === '') {
        sendError(response, 400, 'body 需要 connectionId 与 sql')
        return
      }
      const conn = requireConnection(b.connectionId)
      sendJson(response, 200, await panelQuery(
        conn,
        b.sql,
        typeof b.database === 'string' && b.database !== '' ? b.database : undefined
      ))
      return
    }
    case '/redis/keys': {
      const conn = requireConnection(requireParam(query, 'connectionId'))
      sendJson(response, 200, await panelRedisKeys(
        conn,
        query.get('pattern') ?? '*',
        optionalNumber(query, 'count', 100)
      ))
      return
    }
    case '/redis/key': {
      const conn = requireConnection(requireParam(query, 'connectionId'))
      sendJson(response, 200, await panelRedisKey(conn, requireParam(query, 'key')))
      return
    }
    case '/redis/info': {
      const conn = requireConnection(requireParam(query, 'connectionId'))
      sendJson(response, 200, { info: await panelRedisInfo(conn) })
      return
    }
    default:
      sendError(response, 404, `未知路径 ${path}`)
  }
}

/** 在 webServer 上挂载 /nexsql 前缀路由，返回卸载函数。gate 提供时全部请求先过鉴权。 */
export function mountNexsqlRoutes(webServer: WebServerService, gate?: AuthGate): () => void {
  return webServer.register({
    kind: 'prefix',
    path: ROUTE_PREFIX,
    async handler(request, response) {
      try {
        // P0：rapi（SQL 执行/凭证读取/连接写入）与静态资源都必须过 dsh 浏览器鉴权，
        // 否则 0.0.0.0 绑定时局域网任意设备可无凭证调用。
        const rejection = gate?.reject?.(request)
        if (rejection !== undefined) {
          sendJson(response, rejection, {
            error: rejection === 401 ? '未认证：请从 DSH 界面打开本面板' : '请求被拒绝'
          })
          return
        }
        const url = request.url ?? ''
        const stripped = url.startsWith(ROUTE_PREFIX) ? url.slice(ROUTE_PREFIX.length) : url
        const raw = stripped.split('?')[0]!.replace(/\/+$/, '')
        const path = raw === '' ? '/' : raw.startsWith('/') ? raw : `/${raw}`
        const query = queryOf(url)
        const body = request.method === 'POST' ? await readJsonBody(request) : undefined
        await dispatch(path, query, body, request, response)
      } catch (err) {
        sendError(response, 400, err instanceof Error ? err.message : String(err))
      }
    },
  })
}

// ==================== renderer Web SPA 静态服务 ====================

/** webui 产物目录：lib/routes.js → dsh-plugin/webui/ */
const WEBUI_DIR = resolvePath(dirname(fileURLToPath(import.meta.url)), '..', 'webui')

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm'
}

/** 服务 /nexsql/app/* 静态文件；目录/根 → index.html；带防路径穿越。 */
function serveWebUi(path: string, response: ServerResponse): void {
  const rel = path === '/app' || path === '/app/' ? '' : path.slice('/app/'.length)
  const target = resolvePath(WEBUI_DIR, rel === '' ? 'index.html' : rel)
  if (target !== WEBUI_DIR && !target.startsWith(WEBUI_DIR + '/')) {
    sendError(response, 403, '禁止路径')
    return
  }
  let stat: { isFile(): boolean }
  try {
    stat = statSync(target)
  } catch {
    sendError(response, 404, `未找到 ${rel}`)
    return
  }
  if (!stat.isFile()) {
    sendError(response, 404, `未找到 ${rel}`)
    return
  }
  const ext = target.slice(target.lastIndexOf('.')).toLowerCase()
  const type = MIME[ext] ?? 'application/octet-stream'
  // index.html 与 api-shim 不缓存（垫片更新必须即时生效）；hash 资源可缓存
  const noStore = target.endsWith('index.html') || target.endsWith('api-shim.js')
  const headers: Record<string, string> = {
    'content-type': type,
    'cache-control': noStore ? 'no-store' : 'public, max-age=86400'
  }
  if (ext === '.js' || ext === '.mjs') {
    headers['cross-origin-resource-policy'] = 'same-origin'
  }
  response.writeHead(200, headers)
  createReadStream(target).pipe(response)
}
