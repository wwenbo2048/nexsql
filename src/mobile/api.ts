// ==================== API 封装 ====================

const TOKEN_KEY = 'nexsql-mobile-token'

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY)
}

export function isAuthenticated(): boolean {
  return !!getToken()
}

interface ApiResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

/** 统一请求方法 */
async function request<T = unknown>(path: string, options: RequestInit = {}): Promise<ApiResponse<T>> {
  const token = getToken()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options.headers as Record<string, string>) || {})
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  try {
    const res = await fetch(`/api${path}`, {
      ...options,
      headers
    })

    if (res.status === 401 || res.status === 403) {
      // 授权失效，清除 token
      clearToken()
      const body = await res.json().catch(() => ({}))
      return { success: false, error: body.error ?? '授权已失效，请重新配对' }
    }

    return await res.json()
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : '网络错误' }
  }
}

// ==================== 配对 ====================

export async function pair(code: string): Promise<ApiResponse<{ token: string }>> {
  return request<{ token: string }>('/pair', {
    method: 'POST',
    body: JSON.stringify({ code })
  })
}

// ==================== 连接 ====================

export interface MobileConnection {
  id: string
  name: string
  type: 'mysql' | 'redis'
  host: string
  port: number
  user: string
  database?: string
  color?: string
  group?: string
  redisDb?: number
}

export async function getConnections(): Promise<ApiResponse<MobileConnection[]>> {
  return request<MobileConnection[]>('/connections')
}

// ==================== MySQL 数据库操作 ====================

export interface DatabaseInfo {
  name: string
  charset?: string
  collation?: string
}

export async function getDatabases(connectionId: string): Promise<ApiResponse<DatabaseInfo[]>> {
  return request<DatabaseInfo[]>('/db/databases', {
    method: 'POST',
    body: JSON.stringify({ connectionId })
  })
}

export interface TableInfo {
  name: string
  type: 'table' | 'view'
  engine?: string
  rows?: number
  dataSize?: number
  comment?: string
}

export async function getTables(connectionId: string, database: string): Promise<ApiResponse<TableInfo[]>> {
  return request<TableInfo[]>('/db/tables', {
    method: 'POST',
    body: JSON.stringify({ connectionId, database })
  })
}

export interface ColumnInfo {
  name: string
  type: string
  nullable: boolean
  isPrimaryKey: boolean
  isUnique: boolean
  defaultValue: string | null
  extra?: string
  comment?: string
}

export async function getColumns(connectionId: string, database: string, table: string): Promise<ApiResponse<ColumnInfo[]>> {
  return request<ColumnInfo[]>('/db/columns', {
    method: 'POST',
    body: JSON.stringify({ connectionId, database, table })
  })
}

export async function getDDL(connectionId: string, database: string, table: string): Promise<ApiResponse<string>> {
  return request<string>('/db/ddl', {
    method: 'POST',
    body: JSON.stringify({ connectionId, database, table })
  })
}

export interface QueryResult {
  columns: { name: string; type: string; nullable: boolean }[]
  rows: Record<string, unknown>[]
  affectedRows: number
  insertId?: number
  changedRows?: number
  duration: number
  warning?: string
}

export async function executeQuery(connectionId: string, sql: string, database?: string): Promise<ApiResponse<QueryResult>> {
  return request<QueryResult>('/db/query', {
    method: 'POST',
    body: JSON.stringify({ connectionId, sql, database })
  })
}

// ==================== Redis 操作 ====================

export async function getRedisDbSize(connectionId: string): Promise<ApiResponse<number>> {
  return request<number>('/redis/dbsize', {
    method: 'POST',
    body: JSON.stringify({ connectionId })
  })
}

export interface RedisScanResult {
  cursor: number
  keys: { key: string; type: string; ttl: number; size: number }[]
}

export async function redisScan(connectionId: string, pattern: string, cursor: number, count?: number): Promise<ApiResponse<RedisScanResult>> {
  return request<RedisScanResult>('/redis/scan', {
    method: 'POST',
    body: JSON.stringify({ connectionId, pattern, cursor, count })
  })
}

export interface RedisKeyDetail {
  key: string
  type: string
  ttl: number
  value: string
  members?: { field: string; value: string }[]
}

export async function getRedisKey(connectionId: string, key: string): Promise<ApiResponse<RedisKeyDetail>> {
  return request<RedisKeyDetail>('/redis/key', {
    method: 'POST',
    body: JSON.stringify({ connectionId, key })
  })
}

export async function deleteRedisKey(connectionId: string, key: string): Promise<ApiResponse> {
  return request('/redis/delete', {
    method: 'POST',
    body: JSON.stringify({ connectionId, key })
  })
}

// ==================== AI 自然语言转 SQL ====================

export async function generateSqlSSE(
  connectionId: string | undefined,
  database: string | undefined,
  prompt: string,
  existingSql: string | undefined,
  onChunk: (chunk: string) => void
): Promise<string> {
  const token = getToken()
  const res = await fetch('/api/ai/generate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {})
    },
    body: JSON.stringify({ connectionId, database, prompt, existingSql })
  })

  if (!res.ok && (res.status === 401 || res.status === 403)) {
    clearToken()
    throw new Error('授权已失效，请重新配对')
  }

  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let fullSql = ''
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    // stream: true 防止多字节 UTF-8 在 chunk 边界被截断
    buffer += decoder.decode(value, { stream: true })
    // 按 SSE 消息分隔（\n）处理，保留最后一行不完整的部分
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data: ')) continue
      const json = JSON.parse(trimmed.slice(6))
      if (json.error) throw new Error(json.error)
      if (json.done) {
        return json.sql || fullSql
      }
      if (json.chunk) {
        fullSql += json.chunk
        onChunk(json.chunk)
      }
    }
  }

  return fullSql
}
