/**
 * 隧道客户端（ruoyi-tunnel 协议）
 *
 * 连接公网隧道网关的控制面 WebSocket，将本地 HTTP 服务暴露到公网。
 *
 * 核心流程：
 * 1. 连接 ws(s)://gateway/ws/tunnel/control?tunnelId=xxx&secret=xxx
 * 2. 发送 register 声明隧道（指向本地 HTTP 服务器端口）
 * 3. 每 25 秒发送 ping 心跳
 * 4. 收到 http_request → 本地转发 → 返回 http_response
 * 5. 收到 open_stream → 连接本地 WS + 网关数据面 → 双向桥接
 */

import WebSocket from 'ws'
import { Buffer } from 'buffer'
import Store from 'electron-store'
import type { ConnectionConfig } from '../../shared/types'

// ==================== 类型定义 ====================

export interface TunnelConfig {
  gatewayUrl: string      // 如 wss://tunnel.example.com/ws/tunnel/control
  tunnelId: string        // 如 nexsql-001
  secret: string          // 密钥
  tunnelName: string      // 本地隧道名（URL 路径段），如 "mobile"
}

export interface TunnelStatus {
  connected: boolean
  tunnelId: string | null
  publicUrl: string | null   // 完整公网访问 URL
  error: string | null
}

// ==================== Store ====================

const tunnelStore = new Store<{
  tunnelConfig: TunnelConfig
}>({
  name: 'nexsql-tunnel',
  defaults: {
    tunnelConfig: {
      gatewayUrl: '',
      tunnelId: '',
      secret: '',
      tunnelName: 'mobile'
    }
  }
})

// ==================== 状态 ====================

let controlWs: WebSocket | null = null
let heartbeatTimer: ReturnType<typeof setInterval> | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let localPort = 19800
let registered = false
let lastError: string | null = null

// pending http_request 的 AbortController（用于响应超时取消）
const pendingRequests = new Map<string, AbortController>()

// ==================== 配置管理 ====================

export function getTunnelConfig(): TunnelConfig {
  return tunnelStore.get('tunnelConfig')
}

export function saveTunnelConfig(config: Partial<TunnelConfig>): TunnelConfig {
  const current = tunnelStore.get('tunnelConfig')
  const updated = { ...current, ...config }
  tunnelStore.set('tunnelConfig', updated)
  return updated
}

export function getTunnelStatus(): TunnelStatus {
  const config = getTunnelConfig()
  const connected = controlWs !== null && controlWs.readyState === WebSocket.OPEN && registered

  // 公网 URL 推导：从 gatewayUrl 提取域名
  let publicUrl: string | null = null
  if (connected && config.tunnelId) {
    try {
      // gatewayUrl 格式：wss://domain/ws/tunnel/control 或 ws://domain/ws/tunnel/control
      const url = new URL(config.gatewayUrl)
      const protocol = url.protocol === 'wss:' ? 'https' : 'http'
      publicUrl = `${protocol}://${url.host}/tunnel/${config.tunnelId}/${config.tunnelName}/`
    } catch {
      // URL 解析失败，忽略
    }
  }

  return {
    connected,
    tunnelId: connected ? config.tunnelId : null,
    publicUrl,
    error: lastError
  }
}

// ==================== 核心逻辑 ====================

/** 启动隧道连接 */
export function startTunnel(port: number): TunnelStatus {
  localPort = port

  const config = getTunnelConfig()

  if (!config.gatewayUrl || !config.tunnelId || !config.secret) {
    lastError = '请先配置隧道网关地址、节点 ID 和密钥'
    return getTunnelStatus()
  }

  // 已连接则先断开
  if (controlWs) {
    stopTunnel()
  }

  lastError = null
  registered = false
  connectControl(config)

  return getTunnelStatus()
}

/** 停止隧道 */
export function stopTunnel(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }
  // 取消所有 pending 请求
  for (const controller of pendingRequests.values()) {
    controller.abort()
  }
  pendingRequests.clear()

  if (controlWs) {
    try {
      controlWs.close()
    } catch {
      // 忽略
    }
    controlWs = null
  }
  registered = false
  lastError = null
  console.log('[Tunnel] 已断开')
}

// ==================== 控制面连接 ====================

function connectControl(config: TunnelConfig): void {
  const wsUrl = `${config.gatewayUrl}?tunnelId=${encodeURIComponent(config.tunnelId)}&secret=${encodeURIComponent(config.secret)}`

  console.log(`[Tunnel] 连接网关: ${config.gatewayUrl}`)

  try {
    controlWs = new WebSocket(wsUrl)
  } catch (err) {
    lastError = `连接失败: ${err instanceof Error ? err.message : String(err)}`
    console.error('[Tunnel]', lastError)
    scheduleReconnect(config)
    return
  }

  controlWs.on('open', () => {
    console.log('[Tunnel] 控制面已连接')
    lastError = null

    // 发送 register
    const registerMsg = {
      type: 'register',
      tunnelName: 'nexSql',
      tunnels: [
        { name: config.tunnelName, target: `127.0.0.1:${localPort}` }
      ]
    }
    if (controlWs) send(controlWs, registerMsg)

    // 启动心跳（每 25 秒）
    if (heartbeatTimer) clearInterval(heartbeatTimer)
    heartbeatTimer = setInterval(() => {
      if (controlWs && controlWs.readyState === WebSocket.OPEN) {
        send(controlWs, { type: 'ping' })
      }
    }, 25000)
  })

  controlWs.on('message', (data: WebSocket.RawData) => {
    try {
      const msg = JSON.parse(data.toString())
      handleControlMessage(msg, config)
    } catch (err) {
      console.error('[Tunnel] 消息解析失败:', err)
    }
  })

  controlWs.on('close', (code: number, reason: Buffer) => {
    console.log(`[Tunnel] 连接关闭: ${code} ${reason.toString()}`)
    registered = false
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer)
      heartbeatTimer = null
    }
    if (code === 1008) {
      // 1008 = Policy Violation（认证失败），不重连
      lastError = `认证被拒绝: ${reason.toString() || '请检查 tunnelId 和 secret'}`
    } else {
      scheduleReconnect(config)
    }
  })

  controlWs.on('error', (err: Error) => {
    lastError = err.message
    console.error('[Tunnel] WebSocket 错误:', err.message)
  })
}

/** 处理控制面消息 */
async function handleControlMessage(msg: any, config: TunnelConfig): Promise<void> {
  switch (msg.type) {
    case 'register_ack':
      registered = true
      console.log('[Tunnel] 注册成功, tunnelId:', msg.tunnelId, 'tunnels:', msg.tunnels)
      break

    case 'pong':
      // 心跳响应，无需处理
      break

    case 'ping':
      // 网关主动探活，回复 pong
      if (controlWs) send(controlWs, { type: 'pong' })
      break

    case 'http_request':
      await handleHttpRequest(msg, config)
      break

    case 'open_stream':
      await handleOpenStream(msg, config)
      break

    default:
      // 未知消息类型，忽略
      break
  }
}

// ==================== HTTP 请求转发 ====================

const HOP_HEADERS = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailers', 'transfer-encoding', 'upgrade', 'host', 'content-length'
])

async function handleHttpRequest(msg: any, config: TunnelConfig): Promise<void> {
  const { requestId, tunnel, method, path, headers, body } = msg

  // 确认隧道名匹配
  if (tunnel !== config.tunnelName) {
    console.warn(`[Tunnel] 未知隧道: ${tunnel}, 忽略`)
    return
  }

  const controller = new AbortController()
  pendingRequests.set(requestId, controller)

  try {
    // 构建本地请求 URL
    const url = `http://127.0.0.1:${localPort}${path}`

    // 构建请求头（过滤 hop-by-hop 头）
    const reqHeaders: Record<string, string> = {}
    if (headers) {
      for (const [key, value] of Object.entries(headers)) {
        if (!HOP_HEADERS.has(key.toLowerCase())) {
          reqHeaders[key] = String(value)
        }
      }
    }

    // 构建请求体
    let reqBody: Uint8Array | undefined
    if (body && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      reqBody = Buffer.from(body, 'base64')
    }

    // 发起本地 HTTP 请求（超时 60s，留足余量）
    const timeout = setTimeout(() => controller.abort(), 60000)

    const resp = await fetch(url, {
      method,
      headers: reqHeaders,
      body: reqBody as BodyInit | undefined,
      signal: controller.signal
    })

    clearTimeout(timeout)

    // 读取响应体
    const respBuffer = Buffer.from(await resp.arrayBuffer())

    // 收集响应头（过滤 hop-by-hop 头）
    const respHeaders: Record<string, string> = {}
    resp.headers.forEach((value: string, key: string) => {
      if (!HOP_HEADERS.has(key.toLowerCase())) {
        respHeaders[key] = value
      }
    })

    // 返回 http_response
    if (controlWs && controlWs.readyState === WebSocket.OPEN) {
      send(controlWs, {
        type: 'http_response',
        requestId,
        status: resp.status,
        headers: respHeaders,
        body: respBuffer.toString('base64')
      })
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    console.error(`[Tunnel] HTTP 请求转发失败 [${requestId}]:`, errMsg)

    if (controlWs && controlWs.readyState === WebSocket.OPEN) {
      send(controlWs, {
        type: 'http_response',
        requestId,
        status: 502,
        headers: { 'Content-Type': 'text/plain' },
        body: Buffer.from(`Tunnel error: ${errMsg}`).toString('base64')
      })
    }
  } finally {
    pendingRequests.delete(requestId)
  }
}

// ==================== WebSocket 中继 ====================

async function handleOpenStream(msg: any, config: TunnelConfig): Promise<void> {
  const { streamId, tunnel, path: wsPath } = msg

  if (tunnel !== config.tunnelName) {
    console.warn(`[Tunnel] 未知隧道(stream): ${tunnel}`)
    return
  }

  console.log(`[Tunnel] open_stream: ${streamId}, path: ${wsPath}`)

  const localPath = wsPath || '/'

  // 1. 连接本地 WebSocket（用于 SSE 的 EventSource 或其他 WS 服务）
  const localWsUrl = `ws://127.0.0.1:${localPort}${localPath}`
  // 2. 连接网关数据面
  const gatewayUrlBase = config.gatewayUrl.replace('/ws/tunnel/control', '')
  const dataWsUrl = `${gatewayUrlBase}/ws/tunnel/data?streamId=${streamId}`

  try {
    const localWs = new WebSocket(localWsUrl)
    const dataWs = new WebSocket(dataWsUrl)

    const cleanup = () => {
      try { localWs.close() } catch {}
      try { dataWs.close() } catch {}
    }

    // 本地 → 网关
    localWs.on('message', (data: WebSocket.RawData, isBinary: boolean) => {
      if (dataWs.readyState === WebSocket.OPEN) {
        dataWs.send(data, { binary: isBinary })
      }
    })

    // 网关 → 本地
    dataWs.on('message', (data: WebSocket.RawData, isBinary: boolean) => {
      if (localWs.readyState === WebSocket.OPEN) {
        localWs.send(data, { binary: isBinary })
      }
    })

    // 关闭联动
    localWs.on('close', cleanup)
    localWs.on('error', (err: Error) => {
      console.error('[Tunnel] localWs error:', err.message)
      cleanup()
    })
    dataWs.on('close', cleanup)
    dataWs.on('error', (err: Error) => {
      console.error('[Tunnel] dataWs error:', err.message)
      cleanup()
    })
  } catch (err) {
    console.error('[Tunnel] open_stream 失败:', err)
  }
}

// ==================== 辅助函数 ====================

function send(ws: WebSocket, msg: object): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg))
  }
}

function scheduleReconnect(config: TunnelConfig): void {
  if (reconnectTimer) clearTimeout(reconnectTimer)
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    if (controlWs === null) return // 已主动停止
    console.log('[Tunnel] 尝试重连...')
    connectControl(config)
  }, 5000) // 5 秒后重连
}
