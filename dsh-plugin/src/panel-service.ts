/**
 * 面板数据服务：为浏览器管理页面提供结构化 JSON 查询。
 *
 * 与模型工具（src/mcp/，文本输出）不同，这里直接使用连接管理器
 * 返回原始行数据，供 /nexsql/* HTTP 路由序列化为 JSON。
 */
import { getPool, getRedisClient, type RowDataPacket } from '../../src/mcp/connection-manager.js'
import type { McpConnectionConfig } from '../../src/mcp/types.js'

/** 安全连接条目（隐藏凭据）。 */
export interface PanelConnection {
  id: string
  name: string
  type: 'mysql' | 'redis'
  host: string
  port: number
  database?: string
  redisDb?: number
}

/** 表格结果：列名 + 行数组的紧凑形态（行是 JSON 值的数组）。 */
export interface PanelTable {
  columns: string[]
  rows: unknown[][]
}

/** 把任意驱动返回值转为可 JSON 序列化的值。 */
export function serializeValue(v: unknown): unknown {
  if (v === null || v === undefined) return null
  if (v instanceof Date) return v.toISOString()
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(v)) return `0x${v.toString('hex')}`
  if (typeof v === 'object') {
    try {
      return JSON.stringify(v)
    } catch {
      return String(v)
    }
  }
  return v
}

function toTable(rows: RowDataPacket[]): PanelTable {
  const columns = rows.length > 0 ? Object.keys(rows[0]) : []
  return {
    columns,
    rows: rows.map((row) => columns.map((c) => serializeValue(row[c]))),
  }
}

function assertMysql(conn: McpConnectionConfig): void {
  if (conn.type !== 'mysql') throw new Error(`连接 "${conn.name}" 不是 MySQL 连接`)
}

function assertRedis(conn: McpConnectionConfig): void {
  if (conn.type !== 'redis') throw new Error(`连接 "${conn.name}" 不是 Redis 连接`)
}

/** 列出所有连接（脱敏）。 */
export async function panelConnections(
  connections: McpConnectionConfig[]
): Promise<PanelConnection[]> {
  return connections.map((c) => ({
    id: c.id,
    name: c.name,
    type: c.type,
    host: c.host,
    port: c.port,
    database: c.database,
    redisDb: c.redisDb,
  }))
}

/** MySQL：用户数据库列表。 */
export async function panelDatabases(conn: McpConnectionConfig): Promise<PanelTable> {
  assertMysql(conn)
  const pool = await getPool(conn)
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT SCHEMA_NAME AS name, DEFAULT_CHARACTER_SET_NAME AS charset
     FROM information_schema.SCHEMATA
     WHERE SCHEMA_NAME NOT IN ('information_schema', 'performance_schema', 'mysql', 'sys')
     ORDER BY SCHEMA_NAME`
  )
  return toTable(rows)
}

/** MySQL：库内表与视图。 */
export async function panelTables(
  conn: McpConnectionConfig,
  database: string
): Promise<PanelTable> {
  assertMysql(conn)
  const pool = await getPool(conn)
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT TABLE_NAME AS name, TABLE_TYPE AS type, ENGINE AS engine,
            TABLE_ROWS AS rows_, TABLE_COMMENT AS comment
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = ?
     ORDER BY TABLE_TYPE, TABLE_NAME`,
    [database]
  )
  return toTable(rows)
}

/** MySQL：表列定义。 */
export async function panelColumns(
  conn: McpConnectionConfig,
  database: string,
  table: string
): Promise<PanelTable> {
  assertMysql(conn)
  const pool = await getPool(conn)
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT COLUMN_NAME AS name, COLUMN_TYPE AS type, IS_NULLABLE AS nullable,
            COLUMN_KEY AS key_, COLUMN_DEFAULT AS default_, EXTRA AS extra, COLUMN_COMMENT AS comment
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
     ORDER BY ORDINAL_POSITION`,
    [database, table]
  )
  return toTable(rows)
}

/** MySQL：表数据分页（LIMIT/OFFSET 参数化；库名表名反引号转义；WHERE 为受限拼接，来自面板输入）。 */
export async function panelData(
  conn: McpConnectionConfig,
  database: string,
  table: string,
  limit = 50,
  offset = 0,
  where?: string
): Promise<PanelTable> {
  assertMysql(conn)
  const pool = await getPool(conn)
  const safeLimit = Math.min(Math.max(1, Math.floor(limit)), 500)
  const safeOffset = Math.max(0, Math.floor(offset))
  const dbPart = '`' + database.replace(/`/g, '``') + '`'
  const tablePart = '`' + table.replace(/`/g, '``') + '`'
  const whereClause = where ? ` WHERE ${where}` : ''
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT * FROM ${dbPart}.${tablePart}${whereClause} LIMIT ? OFFSET ?`,
    [safeLimit, safeOffset]
  )
  return toTable(rows)
}

/** MySQL：执行任意 SQL，返回结构化结果（写操作返回受影响行数摘要）。 */
export async function panelQuery(
  conn: McpConnectionConfig,
  sql: string,
  database?: string
): Promise<{ table?: PanelTable; affected?: number; insertId?: number; changed?: number; durationMs: number }> {
  assertMysql(conn)
  const pool = await getPool(conn)
  const conn_ = await pool.getConnection()
  try {
    if (database) await conn_.changeUser({ database })
    const start = performance.now()
    const [result, fields] = await conn_.query(sql)
    const durationMs = performance.now() - start
    if (Array.isArray(result)) {
      const rows = result as RowDataPacket[]
      const fieldNames = (fields ?? []).map((f) => f?.name ?? '')
      const columns = fieldNames.length > 0 ? fieldNames : rows.length > 0 ? Object.keys(rows[0]) : []
      return {
        table: { columns, rows: rows.map((row) => columns.map((c) => serializeValue(row[c]))) },
        durationMs,
      }
    }
    const r = result as { affectedRows: number; insertId?: number; changedRows?: number }
    return { affected: r.affectedRows, insertId: r.insertId, changed: r.changedRows, durationMs }
  } finally {
    conn_.release()
  }
}

/** Redis：SCAN 键（带类型与 TTL）。 */
export async function panelRedisKeys(
  conn: McpConnectionConfig,
  pattern = '*',
  count = 100
): Promise<{ keys: { key: string; type: string; ttl: number }[]; maybeMore: boolean }> {
  assertRedis(conn)
  const client = await getRedisClient(conn)
  const all: { key: string; type: string; ttl: number }[] = []
  let cursor = 0
  const max = Math.min(Math.max(1, Math.floor(count)), 500)
  do {
    const [next, keys] = await client.scan(cursor, 'MATCH', pattern, 'COUNT', Math.min(max, 200))
    cursor = parseInt(next)
    for (const key of keys) {
      try {
        const type = await client.type(key)
        const ttl = await client.ttl(key)
        all.push({ key, type, ttl })
      } catch {
        all.push({ key, type: 'unknown', ttl: -2 })
      }
    }
  } while (cursor !== 0 && all.length < max)
  return { keys: all.slice(0, max), maybeMore: all.length >= max }
}

/** Redis：单键详情（类型化文本表示，复用 MCP 的格式化逻辑语义）。 */
export async function panelRedisKey(
  conn: McpConnectionConfig,
  key: string
): Promise<{ key: string; type: string; ttl: number; value: string }> {
  assertRedis(conn)
  const client = await getRedisClient(conn)
  const type = (await client.type(key)) as string
  const ttl = await client.ttl(key)
  let value: string
  switch (type) {
    case 'string':
      value = (await client.get(key)) ?? '(nil)'
      break
    case 'hash': {
      const data = await client.hgetall(key)
      value = Object.entries(data)
        .map(([f, v]) => `${f}: ${v}`)
        .join('\n')
      break
    }
    case 'list': {
      const data = await client.lrange(key, 0, 199)
      value = data.map((v, i) => `${i}: ${v}`).join('\n')
      break
    }
    case 'set': {
      const data = await client.smembers(key)
      value = data.join('\n')
      break
    }
    case 'zset': {
      const data = await client.zrange(key, 0, 199, 'WITHSCORES')
      value = Array.from({ length: data.length / 2 }, (_, i) => `${data[i * 2]} (score: ${data[i * 2 + 1]})`).join('\n')
      break
    }
    case 'stream': {
      const data = (await client.xrange(key, '-', '+')) as [string, string[]][]
      value = data
        .slice(0, 200)
        .map(([id, fields]) => {
          const pairs: string[] = []
          for (let j = 0; j < fields.length; j += 2) pairs.push(`${fields[j]}=${fields[j + 1]}`)
          return `${id}: ${pairs.join(' ')}`
        })
        .join('\n')
      break
    }
    case 'none':
      value = '键不存在'
      break
    default:
      value = `未知类型: ${type}`
  }
  return { key, type, ttl, value }
}

/** Redis：INFO 文本。 */
export async function panelRedisInfo(conn: McpConnectionConfig): Promise<string> {
  assertRedis(conn)
  const client = await getRedisClient(conn)
  return client.info()
}
