/**
 * MySQL MCP 工具定义和处理函数
 */
import { getPool, type RowDataPacket } from './connection-manager.js'
import type { McpConnectionConfig, McpToolResult } from './types.js'

/** 将查询结果格式化为可读文本 */
function formatQueryResult(result: {
  columns: { name: string; type: string }[]
  rows: Record<string, unknown>[]
  affectedRows: number
  insertId?: number
  changedRows?: number
  duration: number
  warning?: string
}): string {
  const lines: string[] = []

  if (result.rows.length > 0) {
    // 表头
    lines.push(result.columns.map((c) => c.name).join(' | '))
    lines.push(result.columns.map(() => '---').join(' | '))

    // 限制输出行数
    const maxRows = 200
    const displayRows = result.rows.slice(0, maxRows)
    for (const row of displayRows) {
      lines.push(
        result.columns
          .map((c) => {
            const v = row[c.name]
            if (v === null) return 'NULL'
            if (v === undefined) return ''
            if (v instanceof Date) return v.toISOString()
            if (Buffer.isBuffer(v)) return `0x${v.toString('hex')}`
            if (typeof v === 'object') return JSON.stringify(v)
            return String(v)
          })
          .join(' | ')
      )
    }

    if (result.rows.length > maxRows) {
      lines.push(`... (${result.rows.length - maxRows} 行未显示)`)
    }
    lines.push('')
    lines.push(`共 ${result.rows.length} 行, 耗时 ${result.duration.toFixed(2)}ms`)
  } else {
    lines.push(`影响行数: ${result.affectedRows}`)
    if (result.insertId) lines.push(`插入 ID: ${result.insertId}`)
    if (result.changedRows !== undefined) lines.push(`修改行数: ${result.changedRows}`)
    lines.push(`耗时: ${result.duration.toFixed(2)}ms`)
    if (result.warning) lines.push(`警告: ${result.warning}`)
  }

  return lines.join('\n')
}

// ==================== 工具处理函数 ====================

/** 执行 SQL 查询 */
export async function mysqlQuery(
  config: McpConnectionConfig,
  sql: string,
  database?: string
): Promise<McpToolResult> {
  const pool = await getPool(config)
  const conn = await pool.getConnection()

  try {
    if (database) {
      await conn.changeUser({ database })
    }

    const startTime = performance.now()
    const [result, fields] = await conn.query(sql)
    const duration = performance.now() - startTime

    if (Array.isArray(result)) {
      const rows = result as RowDataPacket[]
      const selectFields = fields as typeof fields

      const formatted = formatQueryResult({
        columns: (selectFields ?? []).map((f) => ({
          name: f?.name ?? '',
          type: f?.type !== undefined ? String(f.type) : 'unknown',
        })),
        rows: rows as Record<string, unknown>[],
        affectedRows: rows.length,
        duration,
      })

      return { content: [{ type: 'text', text: formatted }] }
    } else {
      const r = result as {
        affectedRows: number
        insertId?: number
        changedRows?: number
        warningStatus?: number
      }
      let warning: string | undefined
      if (r.warningStatus && r.warningStatus > 0) {
        try {
          const [warnings] = await conn.query('SHOW WARNINGS')
          const w = warnings as RowDataPacket[]
          if (w.length > 0) {
            warning = `${w[0].Level}: ${w[0].Message}`
          }
        } catch {
          /* ignore */
        }
      }

      const formatted = formatQueryResult({
        columns: [],
        rows: [],
        affectedRows: r.affectedRows,
        insertId: r.insertId,
        changedRows: r.changedRows,
        duration,
        warning,
      })

      return { content: [{ type: 'text', text: formatted }] }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return {
      content: [{ type: 'text', text: `SQL 执行错误: ${msg}` }],
      isError: true,
    }
  } finally {
    conn.release()
  }
}

/** 列出所有数据库 */
export async function mysqlListDatabases(config: McpConnectionConfig): Promise<McpToolResult> {
  const pool = await getPool(config)
  const conn = await pool.getConnection()
  try {
    const [rows] = await conn.query<RowDataPacket[]>(
      `SELECT SCHEMA_NAME, DEFAULT_CHARACTER_SET_NAME, DEFAULT_COLLATION_NAME
       FROM information_schema.SCHEMATA
       WHERE SCHEMA_NAME NOT IN ('information_schema', 'performance_schema', 'mysql', 'sys')
       ORDER BY SCHEMA_NAME`
    )
    const lines = rows.map(
      (r) => `${r.SCHEMA_NAME}  (charset: ${r.DEFAULT_CHARACTER_SET_NAME ?? '-'})`
    )
    return {
      content: [
        {
          type: 'text',
          text: `数据库列表 (${rows.length} 个):\n${lines.join('\n')}`,
        },
      ],
    }
  } finally {
    conn.release()
  }
}

/** 列出表 */
export async function mysqlListTables(
  config: McpConnectionConfig,
  database: string
): Promise<McpToolResult> {
  const pool = await getPool(config)
  const conn = await pool.getConnection()
  try {
    await conn.changeUser({ database })
    const [rows] = await conn.query<RowDataPacket[]>(
      `SELECT TABLE_NAME, TABLE_TYPE, ENGINE, TABLE_ROWS, DATA_LENGTH, TABLE_COMMENT
       FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = ?
       ORDER BY TABLE_TYPE, TABLE_NAME`,
      [database]
    )
    const lines = rows.map(
      (r) =>
        `${r.TABLE_NAME}  [${r.TABLE_TYPE === 'VIEW' ? 'VIEW' : r.ENGINE ?? 'TABLE'}]  rows: ${r.TABLE_ROWS ?? '-'}  ${r.TABLE_COMMENT ? `  // ${r.TABLE_COMMENT}` : ''}`
    )
    return {
      content: [
        {
          type: 'text',
          text: `表列表 [${database}] (${rows.length} 个):\n${lines.join('\n')}`,
        },
      ],
    }
  } finally {
    conn.release()
  }
}

/** 描述表结构 */
export async function mysqlDescribeTable(
  config: McpConnectionConfig,
  database: string,
  table: string
): Promise<McpToolResult> {
  const pool = await getPool(config)
  const conn = await pool.getConnection()
  try {
    // 列信息
    const [cols] = await conn.query<RowDataPacket[]>(
      `SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY, COLUMN_DEFAULT, EXTRA, COLUMN_COMMENT
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
       ORDER BY ORDINAL_POSITION`,
      [database, table]
    )

    // 索引信息
    const [idx] = await conn.query<RowDataPacket[]>(
      `SELECT INDEX_NAME, COLUMN_NAME, NON_UNIQUE = 0 as isUnique, INDEX_TYPE
       FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
       ORDER BY INDEX_NAME, SEQ_IN_INDEX`,
      [database, table]
    )

    const colLines = cols.map((c) => {
      const flags: string[] = []
      if (c.COLUMN_KEY === 'PRI') flags.push('PK')
      if (c.COLUMN_KEY === 'UNI') flags.push('UNI')
      if (c.IS_NULLABLE === 'NO') flags.push('NOT NULL')
      if (c.EXTRA) flags.push(c.EXTRA)
      const flagStr = flags.length > 0 ? ` [${flags.join(', ')}]` : ''
      const comment = c.COLUMN_COMMENT ? `  // ${c.COLUMN_COMMENT}` : ''
      return `  ${c.COLUMN_NAME}  ${c.COLUMN_TYPE}${flagStr}${comment}`
    })

    const idxLines = idx.map(
      (i) => `  ${i.INDEX_NAME} (${i.INDEX_TYPE}) on ${i.COLUMN_NAME}${i.isUnique ? ' UNIQUE' : ''}`
    )

    const sections = [
      `表结构: ${database}.${table}`,
      '',
      '列:',
      ...colLines,
    ]
    if (idxLines.length > 0) {
      sections.push('', '索引:', ...idxLines)
    }

    return { content: [{ type: 'text', text: sections.join('\n') }] }
  } finally {
    conn.release()
  }
}

/** 获取 CREATE TABLE DDL */
export async function mysqlShowCreateTable(
  config: McpConnectionConfig,
  database: string,
  table: string
): Promise<McpToolResult> {
  const pool = await getPool(config)
  const conn = await pool.getConnection()
  try {
    await conn.changeUser({ database })
    const [rows] = await conn.query<RowDataPacket[]>(`SHOW CREATE TABLE \`${table}\``)
    if (rows.length > 0) {
      const ddl = (rows[0] as Record<string, unknown>)['Create Table'] as string
      return { content: [{ type: 'text', text: ddl }] }
    }
    return { content: [{ type: 'text', text: `表 ${table} 不存在` }], isError: true }
  } finally {
    conn.release()
  }
}

/** 获取表数据（分页） */
export async function mysqlGetTableData(
  config: McpConnectionConfig,
  database: string,
  table: string,
  limit = 100,
  offset = 0,
  where?: string
): Promise<McpToolResult> {
  const pool = await getPool(config)
  const conn = await pool.getConnection()
  try {
    await conn.changeUser({ database })
    const whereClause = where ? ` WHERE ${where}` : ''
    const [rows] = await conn.query<RowDataPacket[]>(
      `SELECT * FROM \`${table}\`${whereClause} LIMIT ? OFFSET ?`,
      [limit, offset]
    )

    if (rows.length === 0) {
      return { content: [{ type: 'text', text: '无数据' }] }
    }

    const columns = Object.keys(rows[0])
    const lines = [
      columns.join(' | '),
      columns.map(() => '---').join(' | '),
    ]
    for (const row of rows) {
      lines.push(
        columns
          .map((c) => {
            const v = row[c]
            if (v === null) return 'NULL'
            if (v instanceof Date) return v.toISOString()
            if (Buffer.isBuffer(v)) return `0x${v.toString('hex')}`
            if (typeof v === 'object') return JSON.stringify(v)
            return String(v)
          })
          .join(' | ')
      )
    }
    lines.push(`\n共 ${rows.length} 行 (limit=${limit}, offset=${offset})`)

    return { content: [{ type: 'text', text: lines.join('\n') }] }
  } finally {
    conn.release()
  }
}

/** 获取视图列表 */
export async function mysqlGetViews(
  config: McpConnectionConfig,
  database: string
): Promise<McpToolResult> {
  const pool = await getPool(config)
  const conn = await pool.getConnection()
  try {
    const [rows] = await conn.query<RowDataPacket[]>(
      `SELECT TABLE_NAME, IS_UPDATABLE, SECURITY_TYPE
       FROM information_schema.VIEWS
       WHERE TABLE_SCHEMA = ?
       ORDER BY TABLE_NAME`,
      [database]
    )
    if (rows.length === 0) {
      return { content: [{ type: 'text', text: '无视图' }] }
    }
    const lines = rows.map(
      (r) => `${r.TABLE_NAME}  (updatable: ${r.IS_UPDATABLE === 'YES'}, security: ${r.SECURITY_TYPE})`
    )
    return {
      content: [{ type: 'text', text: `视图 [${database}] (${rows.length} 个):\n${lines.join('\n')}` }],
    }
  } finally {
    conn.release()
  }
}

/** 获取函数/存储过程列表 */
export async function mysqlGetRoutines(
  config: McpConnectionConfig,
  database: string
): Promise<McpToolResult> {
  const pool = await getPool(config)
  const conn = await pool.getConnection()
  try {
    const [rows] = await conn.query<RowDataPacket[]>(
      `SELECT ROUTINE_NAME, ROUTINE_TYPE, DTD_IDENTIFIER as returnType, ROUTINE_COMMENT
       FROM information_schema.ROUTINES
       WHERE ROUTINE_SCHEMA = ?
       ORDER BY ROUTINE_TYPE, ROUTINE_NAME`,
      [database]
    )
    if (rows.length === 0) {
      return { content: [{ type: 'text', text: '无函数/存储过程' }] }
    }
    const lines = rows.map(
      (r) =>
        `${r.ROUTINE_NAME}  [${r.ROUTINE_TYPE}]${r.returnType ? ` returns ${r.returnType}` : ''}${r.ROUTINE_COMMENT ? `  // ${r.ROUTINE_COMMENT}` : ''}`
    )
    return {
      content: [
        {
          type: 'text',
          text: `函数/存储过程 [${database}] (${rows.length} 个):\n${lines.join('\n')}`,
        },
      ],
    }
  } finally {
    conn.release()
  }
}

/** 获取服务器状态信息 */
export async function mysqlServerStatus(config: McpConnectionConfig): Promise<McpToolResult> {
  const pool = await getPool(config)
  const conn = await pool.getConnection()
  try {
    const [varRows] = await conn.query<RowDataPacket[]>(
      `SELECT VARIABLE_NAME, VARIABLE_VALUE
       FROM performance_schema.global_variables
       WHERE VARIABLE_NAME IN ('version', 'version_comment', 'hostname', 'port', 'datadir',
         'max_connections', 'innodb_buffer_pool_size', 'uptime')`
    )

    const [statusRows] = await conn.query<RowDataPacket[]>(
      `SELECT VARIABLE_NAME, VARIABLE_VALUE
       FROM performance_schema.global_status
       WHERE VARIABLE_NAME IN ('Uptime', 'Threads_connected', 'Threads_running',
         'Questions', 'Slow_queries', 'Bytes_received', 'Bytes_sent')`
    )

    const varLines = varRows.map((r) => `  ${r.VARIABLE_NAME}: ${r.VARIABLE_VALUE}`)
    const statusLines = statusRows.map((r) => `  ${r.VARIABLE_NAME}: ${r.VARIABLE_VALUE}`)

    return {
      content: [
        {
          type: 'text',
          text: `MySQL 服务器状态:\n\n变量:\n${varLines.join('\n')}\n\n状态:\n${statusLines.join('\n')}`,
        },
      ],
    }
  } finally {
    conn.release()
  }
}
