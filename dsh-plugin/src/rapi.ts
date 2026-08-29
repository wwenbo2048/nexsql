/**
 * rapi —— renderer Web SPA 的 HTTP 桥接层（window.api 的 Host 侧）。
 *
 * 路由：POST /nexsql/rapi/<ns>/<method>，body { args: [...] }。
 * 约定与 src/main/ipc.ts 的 ipcMain.handle 一一对应：
 *   - 大多数方法返回 IpcResponse { success, data? | error? }
 *   - 少数方法（config.getConnections、ai.getSettings、对话 CRUD）返回原始值
 * 业务逻辑直接复用 nexSql 主进程服务层（src/main/services/*，零 Electron 依赖）。
 *
 * 密码策略（桌面端 safeStorage 加密在 DSH 进程不可解）：
 *   - 读取：enc: 前缀的密码按连接 id 从 ~/.nexsql/mcp-connections.json（明文）解析
 *   - 写入：明文回写 nexsql-config.json（桌面端 crypto.ts 对明文原样透传，双向兼容）
 */
import { randomUUID } from 'node:crypto'
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import * as db from '../../src/main/services/db'
import * as redis from '../../src/main/services/redis'
import type { ConnectionConfig } from '../../src/shared/types'

const ENC_PREFIX = 'enc:'

/** macOS 上 electron-store（name: 'nexsql-config'）的落盘位置 */
const APP_STORE_PATH = join(homedir(), 'Library', 'Application Support', 'nexSql', 'nexsql-config.json')
const MCP_STORE_PATH = join(homedir(), '.nexsql', 'mcp-connections.json')

interface AiSettings {
  apiKey: string
  model: string
}

interface AiConversation {
  id: string
  title: string
  messages: unknown[]
  database?: string
  createdAt: number
  updatedAt: number
}

interface AppStore {
  connections?: ConnectionConfig[]
  aiSettings?: AiSettings
  aiConversations?: AiConversation[]
  [key: string]: unknown
}

function readJson(path: string): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
  } catch {
    return {}
  }
}

function readStore(): AppStore {
  return readJson(APP_STORE_PATH) as AppStore
}

/** 原子写：tmp + rename，进程崩溃不会留下半个 JSON（保护桌面应用的存储） */
function atomicWrite(path: string, content: string): void {
  const tmp = `${path}.dsh-tmp`
  writeFileSync(tmp, content, 'utf8')
  renameSync(tmp, path)
}

function writeStore(store: AppStore): void {
  atomicWrite(APP_STORE_PATH, JSON.stringify(store, null, 2))
}

/** 连接配置最小校验（HTTP 面来的输入，不像桌面端只信 renderer） */
function assertConnectionConfig(value: unknown): asserts value is ConnectionConfig {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('连接配置必须是对象')
  }
  const c = value as Record<string, unknown>
  if (typeof c.name !== 'string' || c.name === '') throw new Error('连接配置缺少 name')
  if (typeof c.host !== 'string' || c.host === '') throw new Error('连接配置缺少 host')
  if (!Number.isFinite(Number(c.port))) throw new Error('连接配置缺少有效 port')
}

/** MCP 导出文件里的明文密码表（id → password / sshPassword） */
function mcpPasswordMap(): Map<string, { password?: string; sshPassword?: string }> {
  const file = readJson(MCP_STORE_PATH)
  const list = Array.isArray(file.connections) ? (file.connections as ConnectionConfig[]) : []
  const map = new Map<string, { password?: string; sshPassword?: string }>()
  for (const c of list) map.set(c.id, { password: c.password, sshPassword: c.sshPassword })
  return map
}

/** enc: 密码 → MCP 明文；否则原样返回 */
function resolvePassword(value: string | undefined, plain: string | undefined): string {
  if (typeof value === 'string' && value.startsWith(ENC_PREFIX)) return plain ?? ''
  return value ?? ''
}

/** 供 UI 使用的连接列表（含 color 等完整字段 + 可用密码） */
function uiConnections(): ConnectionConfig[] {
  const store = readStore()
  const list = store.connections ?? []
  const plains = mcpPasswordMap()
  return list.map((c) => {
    const plain = plains.get(c.id)
    return {
      ...c,
      password: resolvePassword(c.password, plain?.password),
      sshPassword: resolvePassword(c.sshPassword, plain?.sshPassword)
    }
  })
}

/** 把面板里的明文连接同步进 app 存储（upsert） */
function upsertConnection(config: ConnectionConfig): ConnectionConfig {
  const store = readStore()
  const list = store.connections ?? []
  const saved: ConnectionConfig = { ...config, id: config.id || randomUUID() }
  const idx = list.findIndex((c) => c.id === saved.id)
  if (idx >= 0) list[idx] = saved
  else list.push(saved)
  store.connections = list
  writeStore(store)
  return saved
}

/** IpcResponse 包装器：services 抛错 → {success:false,error} */
function ok(data?: unknown): { success: boolean; data?: unknown } {
  return data === undefined ? { success: true } : { success: true, data }
}

function fail(err: unknown): { success: boolean; error: string } {
  const msg = err instanceof Error ? err.message : String(err)
  console.error('[nexsql:rapi]', msg)
  return { success: false, error: msg }
}

function wrap<T>(fn: (...args: unknown[]) => Promise<T>) {
  return async (...args: unknown[]): Promise<{ success: boolean; data?: T } | { success: boolean; error: string }> => {
    try {
      return ok(await fn(...args))
    } catch (err) {
      return fail(err)
    }
  }
}

/** 对话列表（不含 messages，与 ipc.ts 一致） */
function conversationSummaries() {
  return (readStore().aiConversations ?? []).map((c) => ({
    id: c.id,
    title: c.title,
    database: c.database,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt
  }))
}

/** 与 ipc.ts config:importConnections 相同的导入语义（按 id 合并），content 为文件文本 */
function importConnectionsData(content: string): { canceled: boolean; added: number; updated: number; skipped: number; updatedIds: string[] } {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    throw new Error('文件不是有效的 JSON 格式')
  }
  // 兼容三种格式：{ connections: [...] }（本应用导出 / MCP 配置）/ [ ... ] 纯数组
  let list: unknown[]
  if (Array.isArray(parsed)) {
    list = parsed
  } else if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { connections?: unknown }).connections)) {
    list = (parsed as { connections: unknown[] }).connections
  } else {
    throw new Error('文件格式不正确：未找到 connections 连接数组')
  }
  if (list.length === 0) throw new Error('文件中没有连接配置')

  const validTypes = ['mysql', 'redis']
  const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined)
  const store = readStore()
  const connections = store.connections ?? []
  let added = 0
  let updated = 0
  let skipped = 0
  const updatedIds: string[] = []
  const batchIds = new Set<string>()

  for (const raw of list) {
    if (!raw || typeof raw !== 'object') {
      skipped++
      continue
    }
    const item = raw as Record<string, unknown>
    if (!str(item.name) || !str(item.host) || !validTypes.includes(item.type as string)) {
      skipped++
      continue
    }
    const type = item.type as ConnectionConfig['type']
    // 浏览器面板存储明文（与 saveConnection 一致；桌面端对明文透传）
    const imported: ConnectionConfig = {
      id: str(item.id) ?? randomUUID(),
      name: (item.name as string).trim(),
      ...(str(item.group) ? { group: str(item.group) } : {}),
      ...(Array.isArray(item.tags) ? { tags: item.tags.filter((t): t is string => typeof t === 'string') } : {}),
      type,
      host: (item.host as string).trim(),
      port: typeof item.port === 'number' && item.port > 0 ? item.port : type === 'redis' ? 6379 : 3306,
      user: typeof item.user === 'string' ? item.user : '',
      password: typeof item.password === 'string' ? item.password : '',
      ...(str(item.database) ? { database: str(item.database) } : {}),
      ...(str(item.color) ? { color: str(item.color) } : {}),
      sshEnabled: item.sshEnabled === true,
      ...(str(item.sshHost) ? { sshHost: str(item.sshHost) } : {}),
      ...(typeof item.sshPort === 'number' && item.sshPort > 0 ? { sshPort: item.sshPort } : {}),
      ...(str(item.sshUser) ? { sshUser: str(item.sshUser) } : {}),
      sshPassword: typeof item.sshPassword === 'string' ? item.sshPassword : '',
      ...(str(item.sshPrivateKey) ? { sshPrivateKey: str(item.sshPrivateKey) } : {}),
      sslEnabled: item.sslEnabled === true,
      ...(typeof item.connectTimeout === 'number' && item.connectTimeout > 0 ? { connectTimeout: item.connectTimeout } : {}),
      ...(type === 'redis' && typeof item.redisDb === 'number' ? { redisDb: item.redisDb } : {})
    }
    if (batchIds.has(imported.id)) {
      skipped++
      continue
    }
    batchIds.add(imported.id)
    const idx = connections.findIndex((c) => c.id === imported.id)
    if (idx >= 0) {
      connections[idx] = imported
      updated++
      updatedIds.push(imported.id)
    } else {
      connections.push(imported)
      added++
    }
  }

  if (added + updated === 0) throw new Error(`没有可导入的有效连接（共 ${skipped} 条无效记录）`)
  store.connections = connections
  writeStore(store)

  // 断开被更新连接的旧池/隧道（未连接时为空操作），与桌面端一致
  void Promise.allSettled(updatedIds.flatMap((id) => [db.disconnect(id), redis.disconnectRedis(id)]))
  // 同步 MCP 导出文件（enc: 密码沿用文件旧值）
  syncMcpFile()
  return { canceled: false, added, updated, skipped, updatedIds }
}

/** 用面板已知的明文密码刷新 ~/.nexsql/mcp-connections.json */
function syncMcpFile(): void {
  const store = readStore()
  const plains = mcpPasswordMap()
  const connections = (store.connections ?? []).map((c) => {
    const plain = plains.get(c.id)
    return {
      ...c,
      password: resolvePassword(c.password, plain?.password),
      sshPassword: resolvePassword(c.sshPassword, plain?.sshPassword)
    }
  })
  atomicWrite(MCP_STORE_PATH, JSON.stringify({ connections }, null, 2))
}

/** 与 ipc.ts config:exportConnections 相同的导出载荷（明文密码），由浏览器端下载落盘 */
function exportConnectionsData(): { content: string; filename: string; count: number } {
  const store = readStore()
  const list = store.connections ?? []
  if (list.length === 0) throw new Error('没有可导出的连接')
  const plains = mcpPasswordMap()
  const plain = list.map((c) => {
    const p = plains.get(c.id)
    return {
      ...c,
      password: resolvePassword(c.password, p?.password),
      sshPassword: resolvePassword(c.sshPassword, p?.sshPassword)
    }
  })
  const now = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`
  const payload = { app: 'nexsql', version: 1, exportedAt: now.toISOString(), connections: plain }
  return { content: JSON.stringify(payload, null, 2), filename: `nexsql-connections-${stamp}.json`, count: plain.length }
}

type SyncHandler = (...args: unknown[]) => unknown
type Handler = SyncHandler | ((...args: unknown[]) => Promise<unknown>)

/** 与 ipc.ts 对应的方法表；未列出的方法返回 404 */
const handlers: Record<string, Record<string, Handler>> = {
  config: {
    // 原始值方法（与 ipc.ts 一样不包 IpcResponse）
    getConnections: () => uiConnections(),
    saveConnection: (config) => {
      assertConnectionConfig(config)
      return upsertConnection(config)
    },
    deleteConnection: (id) => {
      if (typeof id !== 'string' || id === '') throw new Error('deleteConnection 需要 id')
      const store = readStore()
      const before = store.connections?.length ?? 0
      store.connections = (store.connections ?? []).filter((c) => c.id !== id)
      writeStore(store)
      return (store.connections?.length ?? 0) < before
    },
    exportMcp: () => {
      syncMcpFile()
      return { success: true, data: { path: MCP_STORE_PATH, count: readStore().connections?.length ?? 0 } }
    },
    getMcpInfo: () => ({
      success: true,
      data: { serverPath: '', configPath: MCP_STORE_PATH, built: true }
    }),
    // 浏览器版导入/导出：文件选择与落盘在浏览器端，数据与合并语义在 Host
    importConnectionsData: (content) => {
      if (typeof content !== 'string' || content === '') throw new Error('导入内容为空')
      return importConnectionsData(content)
    },
    exportConnectionsData: () => exportConnectionsData()
  },

  db: {
    testConnection: wrap((config: ConnectionConfig) => db.testConnection(config)),
    connect: wrap((config: ConnectionConfig) => db.connect(config)),
    disconnect: wrap((configId: string) => db.disconnect(configId)),
    query: wrap((config: ConnectionConfig, sql: string, database?: string) => db.executeQuery(config, sql, database)),
    executeBatch: wrap((config: ConnectionConfig, statements: string[], database?: string) =>
      db.executeBatch(config, statements, database)
    ),
    getDatabases: wrap((config: ConnectionConfig) => db.getDatabases(config)),
    getTables: wrap((config: ConnectionConfig, database: string) => db.getTables(config, database)),
    getTableColumns: wrap((config: ConnectionConfig, database: string, table: string) =>
      db.getTableColumns(config, database, table)
    ),
    getTableIndexes: wrap((config: ConnectionConfig, database: string, table: string) =>
      db.getTableIndexes(config, database, table)
    ),
    getTableRowCount: wrap((config: ConnectionConfig, database: string, table: string) =>
      db.getTableRowCount(config, database, table)
    ),
    getTableDDL: wrap((config: ConnectionConfig, database: string, table: string) =>
      db.getTableDDL(config, database, table)
    ),
    getForeignKeys: wrap((config: ConnectionConfig, database: string, table: string) =>
      db.getForeignKeys(config, database, table)
    ),
    getTableTriggers: wrap((config: ConnectionConfig, database: string, table: string) =>
      db.getTableTriggers(config, database, table)
    ),
    getTableOptions: wrap((config: ConnectionConfig, database: string, table: string) =>
      db.getTableOptions(config, database, table)
    ),
    getTableDetails: wrap((config: ConnectionConfig, database: string, table: string) =>
      db.getTableDetails(config, database, table)
    ),
    getViews: wrap((config: ConnectionConfig, database: string) => db.getViews(config, database)),
    getRoutines: wrap((config: ConnectionConfig, database: string) => db.getRoutines(config, database)),
    getEvents: wrap((config: ConnectionConfig, database: string) => db.getEvents(config, database)),
    getERRelations: wrap((config: ConnectionConfig, database: string) => db.getAllForeignKeys(config, database)),
    getERTableColumns: wrap((config: ConnectionConfig, database: string) => db.getAllTableColumns(config, database)),
    getServerStatus: wrap((config: ConnectionConfig) => db.getServerStatus(config))
  },

  redis: {
    testConnection: wrap((config: ConnectionConfig) => redis.testRedisConnection(config)),
    connect: wrap((config: ConnectionConfig) => redis.getClient(config).then(() => undefined)),
    disconnect: wrap((configId: string) => redis.disconnectRedis(configId)),
    dbsize: wrap((config: ConnectionConfig) => redis.getDbSize(config)),
    scan: wrap((config: ConnectionConfig, pattern: string, cursor: number, count?: number) =>
      redis.scanKeys(config, pattern, cursor, count ?? 200)
    ),
    getKey: wrap((config: ConnectionConfig, key: string) => redis.getKeyDetail(config, key)),
    setKey: wrap((config: ConnectionConfig, key: string, type: string, value: string, ttl?: number) =>
      redis.setKeyValue(config, key, type as never, value, ttl)
    ),
    deleteKey: wrap((config: ConnectionConfig, key: string) => redis.deleteKey(config, key)),
    batchDeleteKeys: wrap((config: ConnectionConfig, keys: string[]) => redis.batchDeleteKeys(config, keys)),
    setTtl: wrap((config: ConnectionConfig, key: string, ttl: number) => redis.setTtl(config, key, ttl)),
    rename: wrap((config: ConnectionConfig, oldKey: string, newKey: string) =>
      redis.renameKey(config, oldKey, newKey)
    ),
    command: wrap((config: ConnectionConfig, command: string[]) => redis.executeCommand(config, command))
  },

  ai: {
    // 原始值方法
    getSettings: () => {
      const s = readStore().aiSettings
      return { apiKey: '', model: s?.model ?? '' } // apiKey 不回传面板（避免明文密钥在浏览器侧流转）
    },
    setSettings: (settings: AiSettings) => {
      const store = readStore()
      const prev = store.aiSettings
      // 空 apiKey 表示未修改，保留原值
      store.aiSettings = {
        apiKey: settings.apiKey || prev?.apiKey || '',
        model: settings.model ?? prev?.model ?? ''
      }
      writeStore(store)
      return true
    },
    getConversations: () => conversationSummaries(),
    getConversation: (id: string) => readStore().aiConversations?.find((c) => c.id === id) ?? null,
    createConversation: (database?: string) => {
      const store = readStore()
      const list = store.aiConversations ?? []
      const now = Date.now()
      const conv: AiConversation = { id: randomUUID(), title: '新对话', messages: [], database, createdAt: now, updatedAt: now }
      list.unshift(conv)
      store.aiConversations = list
      writeStore(store)
      return conv
    },
    saveConversation: (conv: AiConversation) => {
      const store = readStore()
      const list = store.aiConversations ?? []
      const idx = list.findIndex((c) => c.id === conv.id)
      const updated = { ...conv, updatedAt: Date.now() }
      if (idx >= 0) list[idx] = updated
      else list.unshift(updated)
      store.aiConversations = list
      writeStore(store)
      return true
    },
    deleteConversation: (id: string) => {
      const store = readStore()
      store.aiConversations = (store.aiConversations ?? []).filter((c) => c.id !== id)
      writeStore(store)
      return true
    },
    clearConversations: () => {
      const store = readStore()
      store.aiConversations = []
      writeStore(store)
      return true
    }
  }
}

/**
 * 分发一次 rapi 调用。
 * @returns HTTP 状态与 JSON 体；未知方法 → 404 {error}
 */
export async function dispatchRapi(
  ns: string,
  method: string,
  args: unknown[]
): Promise<{ status: number; body: unknown }> {
  // hasOwnProperty 防护：'constructor'/'__proto__' 等继承键不算注册方法
  const table = Object.prototype.hasOwnProperty.call(handlers, ns) ? handlers[ns] : undefined
  const handler = table && Object.prototype.hasOwnProperty.call(table, method) ? table[method] : undefined
  if (!handler) return { status: 404, body: { error: `未知方法 ${ns}.${method}` } }
  try {
    return { status: 200, body: await handler(...args) }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[nexsql:rapi] ${ns}.${method}:`, msg)
    return { status: 200, body: { success: false, error: msg } }
  }
}
