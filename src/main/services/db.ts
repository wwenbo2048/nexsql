import mysql, { type Pool, type RowDataPacket, type FieldPacket, type PoolOptions } from 'mysql2/promise'
import { createWriteStream } from 'fs'
import type { ConnectionConfig, DatabaseInfo, TableInfo, ColumnInfo, IndexInfo, ForeignKeyInfo, TriggerInfo, TableOptions, TableDetails, ViewInfo, RoutineInfo, EventInfo, QueryResult } from '../../shared/types'
import { createTunnel, closeTunnel, closeAllTunnels, needsTunnel } from './ssh-tunnel'

// 连接池管理
const pools = new Map<string, Pool>()

function getPoolKey(config: ConnectionConfig): string {
  return config.id
}

/**
 * 构建 mysql2 连接选项，支持 SSH 隧道和 SSL。
 * 调用前需确保 SSH 隧道已创建（使用 await getPool 或 ensureTunnel）。
 */
function buildPoolOptions(config: ConnectionConfig, localPort?: number): PoolOptions {
  const opts: PoolOptions = {
    host: localPort ? '127.0.0.1' : config.host,
    port: localPort ?? config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    connectionLimit: 5,
    connectTimeout: config.connectTimeout ?? 10000,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
    charset: 'utf8mb4',
    timezone: '+00:00',
    dateStrings: true,
    multipleStatements: true // 允许恢复数据库时批量执行多条 SQL
  }
  if (config.sslEnabled) {
    opts.ssl = { rejectUnauthorized: false }
  }
  return opts
}

async function createPool(config: ConnectionConfig): Promise<Pool> {
  let localPort: number | undefined
  if (needsTunnel(config)) {
    localPort = await createTunnel(config)
  }
  const pool = mysql.createPool(buildPoolOptions(config, localPort))
  pools.set(getPoolKey(config), pool)
  return pool
}

export async function getPool(config: ConnectionConfig): Promise<Pool> {
  let pool = pools.get(getPoolKey(config))
  if (!pool) {
    pool = await createPool(config)
  }
  return pool
}

export async function testConnection(config: ConnectionConfig): Promise<boolean> {
  let tunnelPort: number | undefined
  if (needsTunnel(config)) {
    tunnelPort = await createTunnel(config)
  }
  const tempPool = mysql.createPool({
    ...buildPoolOptions(config, tunnelPort),
    connectionLimit: 1
  })
  try {
    const conn = await tempPool.getConnection()
    await conn.ping()
    conn.release()
    return true
  } finally {
    await tempPool.end()
    if (needsTunnel(config)) closeTunnel(config.id)
  }
}

export async function connect(config: ConnectionConfig): Promise<void> {
  const pool = await getPool(config)
  const conn = await pool.getConnection()
  await conn.ping()
  conn.release()
}

export async function disconnect(configId: string): Promise<void> {
  const pool = pools.get(configId)
  if (pool) {
    await pool.end()
    pools.delete(configId)
  }
  closeTunnel(configId)
}

export async function executeQuery(
  config: ConnectionConfig,
  sql: string,
  database?: string
): Promise<QueryResult> {
  const pool = await getPool(config)
  const conn = await pool.getConnection()

  try {
    if (database) {
      await conn.changeUser({ database })
    }

    const startTime = performance.now()
    const [result, fields] = await conn.query(sql)
    const duration = performance.now() - startTime

    // 处理查询结果
    if (Array.isArray(result)) {
      // 多语句 DDL/DML（如 SET; DROP; SET;）的 fields 含有 undefined/null
      const fieldPackets = fields as (FieldPacket | undefined | null)[]
      if (!fieldPackets || fieldPackets.some(f => f == null)) {
        // 多语句非查询操作：取最后一个结果
        const lastResult = result[result.length - 1] as { affectedRows?: number; insertId?: number; changedRows?: number }
        return {
          columns: [],
          rows: [],
          affectedRows: lastResult?.affectedRows ?? 0,
          insertId: lastResult?.insertId,
          changedRows: lastResult?.changedRows,
          duration
        }
      }

      // SELECT 查询
      const rows = result as RowDataPacket[]
      const selectFields = fields as FieldPacket[]

      return {
        columns: selectFields.map((f) => ({
          name: f.name,
          type: f.type !== undefined ? String(f.type) : 'unknown',
          nullable: (typeof f.flags === 'number' ? (f.flags & 0x0001) === 0 : true)
        })),
        rows: rows as Record<string, unknown>[],
        affectedRows: rows.length,
        duration
      }
    } else {
      // INSERT / UPDATE / DELETE
      const r = result as {
        affectedRows: number
        insertId?: number
        changedRows?: number
        warningStatus?: number
      }
      let warning: string | undefined
      if (r.warningStatus && r.warningStatus > 0) {
        const [warnings] = await conn.query('SHOW WARNINGS')
        const w = warnings as RowDataPacket[]
        if (w.length > 0) {
          warning = `${w[0].Level}: ${w[0].Message}`
        }
      }
      return {
        columns: [],
        rows: [],
        affectedRows: r.affectedRows,
        insertId: r.insertId,
        changedRows: r.changedRows,
        duration,
        warning
      }
    }
  } finally {
    conn.release()
  }
}

// ==================== 批量执行（同一连接，支持会话变量） ====================

export interface BatchStatementResult {
  sql: string
  success: boolean
  affectedRows?: number
  rowCount?: number
  insertId?: number
  changedRows?: number
  duration?: number
  error?: string
  columns?: { name: string; type: string; nullable: boolean }[]
  rows?: Record<string, unknown>[]
  warning?: string
}

/**
 * 在同一个连接上批量执行多条 SQL，确保会话变量（@var）跨语句共享。
 * 通过 onProgress 回调实时上报每条语句的执行结果。
 */
export async function executeBatch(
  config: ConnectionConfig,
  statements: string[],
  database: string | undefined,
  onProgress?: (index: number, total: number, result: BatchStatementResult) => void
): Promise<BatchStatementResult[]> {
  const pool = await getPool(config)
  const conn = await pool.getConnection()
  const results: BatchStatementResult[] = []

  try {
    if (database) {
      await conn.changeUser({ database })
    }

    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i]
      const startTime = performance.now()

      try {
        const [result, fields] = await conn.query(stmt)
        const duration = performance.now() - startTime

        if (Array.isArray(result)) {
          const fieldPackets = fields as (FieldPacket | undefined | null)[]
          if (!fieldPackets || fieldPackets.some(f => f == null)) {
            const lastResult = result[result.length - 1] as { affectedRows?: number; insertId?: number; changedRows?: number }
            const r: BatchStatementResult = {
              sql: stmt,
              success: true,
              affectedRows: lastResult?.affectedRows ?? 0,
              insertId: lastResult?.insertId,
              changedRows: lastResult?.changedRows,
              duration,
              rowCount: 0
            }
            results.push(r)
            onProgress?.(i, statements.length, r)
          } else {
            const rows = result as RowDataPacket[]
            const selectFields = fields as FieldPacket[]
            const r: BatchStatementResult = {
              sql: stmt,
              success: true,
              rowCount: rows.length,
              affectedRows: rows.length,
              duration,
              columns: selectFields.map(f => ({
                name: f.name,
                type: f.type !== undefined ? String(f.type) : 'unknown',
                nullable: typeof f.flags === 'number' ? (f.flags & 0x0001) === 0 : true
              })),
              rows: rows as Record<string, unknown>[]
            }
            results.push(r)
            onProgress?.(i, statements.length, r)
          }
        } else {
          const r2 = result as { affectedRows: number; insertId?: number; changedRows?: number; warningStatus?: number }
          let warning: string | undefined
          if (r2.warningStatus && r2.warningStatus > 0) {
            try {
              const [warnings] = await conn.query('SHOW WARNINGS')
              const w = warnings as RowDataPacket[]
              if (w.length > 0) {
                warning = `${w[0].Level}: ${w[0].Message}`
              }
            } catch { /* ignore warning errors */ }
          }
          const r: BatchStatementResult = {
            sql: stmt,
            success: true,
            affectedRows: r2.affectedRows,
            insertId: r2.insertId,
            changedRows: r2.changedRows,
            duration,
            warning
          }
          results.push(r)
          onProgress?.(i, statements.length, r)
        }
      } catch (err) {
        const duration = performance.now() - startTime
        const r: BatchStatementResult = {
          sql: stmt,
          success: false,
          error: err instanceof Error ? err.message : String(err),
          duration
        }
        results.push(r)
        onProgress?.(i, statements.length, r)
        break
      }
    }

    return results
  } finally {
    conn.release()
  }
}

export async function getDatabases(config: ConnectionConfig): Promise<DatabaseInfo[]> {
  const pool = await getPool(config)
  const conn = await pool.getConnection()
  try {
    const [rows] = await conn.query<RowDataPacket[]>(
      `SELECT SCHEMA_NAME, DEFAULT_CHARACTER_SET_NAME, DEFAULT_COLLATION_NAME 
       FROM information_schema.SCHEMATA 
       WHERE SCHEMA_NAME NOT IN ('information_schema', 'performance_schema', 'mysql', 'sys')
       ORDER BY SCHEMA_NAME`
    )
    return rows.map((r) => ({
      name: r.SCHEMA_NAME,
      charset: r.DEFAULT_CHARACTER_SET_NAME,
      collation: r.DEFAULT_COLLATION_NAME
    }))
  } finally {
    conn.release()
  }
}

export async function getTables(
  config: ConnectionConfig,
  database: string
): Promise<TableInfo[]> {
  const pool = await getPool(config)
  const conn = await pool.getConnection()
  try {
    await conn.changeUser({ database })
    const [rows] = await conn.query<RowDataPacket[]>(`
      SELECT 
        TABLE_NAME as name,
        TABLE_TYPE as raw_type,
        ENGINE as engine,
        TABLE_ROWS as \`rows\`,
        DATA_LENGTH as dataSize,
        TABLE_COMMENT as comment
      FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = ?
      ORDER BY TABLE_TYPE, TABLE_NAME
    `, [database])
    return rows.map((r) => ({
      name: r.name,
      type: r.raw_type === 'VIEW' ? 'view' : 'table',
      engine: r.engine,
      rows: r.rows,
      dataSize: r.dataSize,
      comment: r.comment
    }))
  } finally {
    conn.release()
  }
}

export async function getTableColumns(
  config: ConnectionConfig,
  database: string,
  table: string
): Promise<ColumnInfo[]> {
  const pool = await getPool(config)
  const conn = await pool.getConnection()
  try {
    const [rows] = await conn.query<RowDataPacket[]>(`
      SELECT 
        COLUMN_NAME as \`name\`,
        COLUMN_TYPE as \`type\`,
        IS_NULLABLE as nullable,
        COLUMN_KEY as columnKey,
        COLUMN_DEFAULT as defaultValue,
        EXTRA as extra,
        COLUMN_COMMENT as comment
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
      ORDER BY ORDINAL_POSITION
    `, [database, table])
    return rows.map((r) => ({
      name: r.name,
      type: r.type,
      nullable: r.nullable === 'YES',
      isPrimaryKey: r.columnKey === 'PRI',
      isUnique: r.columnKey === 'UNI',
      defaultValue: r.defaultValue,
      extra: r.extra,
      comment: r.comment
    }))
  } finally {
    conn.release()
  }
}

export async function getTableIndexes(
  config: ConnectionConfig,
  database: string,
  table: string
): Promise<IndexInfo[]> {
  const pool = await getPool(config)
  const conn = await pool.getConnection()
  try {
    const [rows] = await conn.query<RowDataPacket[]>(`
      SELECT 
        INDEX_NAME as \`name\`,
        COLUMN_NAME as column_name,
        NON_UNIQUE = 0 as isUnique,
        INDEX_TYPE as \`type\`
      FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
      ORDER BY INDEX_NAME, SEQ_IN_INDEX
    `, [database, table])
    return rows.map((r) => ({
      name: r.name,
      column: r.column_name,
      isUnique: !!r.isUnique,
      type: r.type
    }))
  } finally {
    conn.release()
  }
}

export async function getTableRowCount(
  config: ConnectionConfig,
  database: string,
  table: string
): Promise<number> {
  const pool = await getPool(config)
  const conn = await pool.getConnection()
  try {
    await conn.changeUser({ database })
    const [rows] = await conn.query<RowDataPacket[]>(`SELECT COUNT(*) as cnt FROM \`${table}\``)
    return rows[0].cnt as number
  } finally {
    conn.release()
  }
}

export async function getTableDDL(
  config: ConnectionConfig,
  database: string,
  table: string
): Promise<string> {
  const pool = await getPool(config)
  const conn = await pool.getConnection()
  try {
    await conn.changeUser({ database })
    const [rows] = await conn.query<RowDataPacket[]>(`SHOW CREATE TABLE \`${table}\``)
    if (rows.length > 0) {
      return (rows[0] as Record<string, unknown>)['Create Table'] as string
    }
    return ''
  } finally {
    conn.release()
  }
}

export async function disconnectAll(): Promise<void> {
  for (const [key, pool] of pools) {
    await pool.end()
    pools.delete(key)
  }
  closeAllTunnels()
}

// ==================== 外键 ====================

export async function getForeignKeys(
  config: ConnectionConfig,
  database: string,
  table: string
): Promise<ForeignKeyInfo[]> {
  const pool = await getPool(config)
  const conn = await pool.getConnection()
  try {
    const [rows] = await conn.query<RowDataPacket[]>(`
      SELECT
        kcu.CONSTRAINT_NAME as name,
        kcu.COLUMN_NAME as columnName,
        kcu.REFERENCED_TABLE_NAME as refTable,
        kcu.REFERENCED_COLUMN_NAME as refColumn,
        rc.UPDATE_RULE as onUpdate,
        rc.DELETE_RULE as onDelete
      FROM information_schema.KEY_COLUMN_USAGE kcu
      JOIN information_schema.REFERENTIAL_CONSTRAINTS rc
        ON kcu.CONSTRAINT_NAME = rc.CONSTRAINT_NAME
        AND kcu.CONSTRAINT_SCHEMA = rc.CONSTRAINT_SCHEMA
      WHERE kcu.TABLE_SCHEMA = ? AND kcu.TABLE_NAME = ?
        AND kcu.REFERENCED_TABLE_NAME IS NOT NULL
    `, [database, table])
    return rows.map((r) => ({
      name: r.name,
      columnName: r.columnName,
      referencedTable: r.refTable,
      referencedColumnName: r.refColumn,
      onUpdate: r.onUpdate,
      onDelete: r.onDelete
    }))
  } finally {
    conn.release()
  }
}

// ==================== 触发器 ====================

export async function getTableTriggers(
  config: ConnectionConfig,
  database: string,
  table: string
): Promise<TriggerInfo[]> {
  const pool = await getPool(config)
  const conn = await pool.getConnection()
  try {
    const [rows] = await conn.query<RowDataPacket[]>(`
      SELECT
        TRIGGER_NAME as name,
        EVENT_MANIPULATION as event,
        ACTION_TIMING as timing,
        ACTION_STATEMENT as statement,
        CREATED as created,
        DEFINER as definer
      FROM information_schema.TRIGGERS
      WHERE TRIGGER_SCHEMA = ? AND EVENT_OBJECT_TABLE = ?
      ORDER BY TRIGGER_NAME
    `, [database, table])
    return rows.map((r) => ({
      name: r.name,
      event: r.event,
      timing: r.timing,
      statement: r.statement,
      created: r.created,
      definer: r.definer
    }))
  } finally {
    conn.release()
  }
}

// ==================== 表选项 ====================

export async function getTableOptions(
  config: ConnectionConfig,
  database: string,
  table: string
): Promise<TableOptions> {
  const pool = await getPool(config)
  const conn = await pool.getConnection()
  try {
    const [rows] = await conn.query<RowDataPacket[]>(`
      SELECT
        ENGINE as engine,
        TABLE_COLLATION as collation,
        TABLE_COMMENT as comment,
        AUTO_INCREMENT as autoIncrement,
        ROW_FORMAT as rowFormat
      FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
    `, [database, table])

    if (rows.length === 0) {
      return {}
    }

    const r = rows[0]
    let charset: string | undefined
    if (r.collation) {
      const [csRows] = await conn.query<RowDataPacket[]>(
        `SELECT CHARACTER_SET_NAME as cs FROM information_schema.COLLATIONS WHERE COLLATION_NAME = ?`,
        [r.collation]
      )
      if (csRows.length > 0) charset = csRows[0].cs
    }

    return {
      engine: r.engine,
      charset,
      collation: r.collation,
      comment: r.comment,
      autoIncrement: r.autoIncrement,
      rowFormat: r.rowFormat
    }
  } finally {
    conn.release()
  }
}

// ==================== 表详细信息（常规） ====================

export async function getTableDetails(
  config: ConnectionConfig,
  database: string,
  table: string
): Promise<TableDetails> {
  const pool = await getPool(config)
  const conn = await pool.getConnection()
  try {
    const [rows] = await conn.query<RowDataPacket[]>(`
      SELECT
        TABLE_NAME as name,
        TABLE_ROWS as \`rows\`,
        DATA_LENGTH as dataSize,
        INDEX_LENGTH as indexLength,
        ENGINE as engine,
        CREATE_TIME as createTime,
        UPDATE_TIME as updateTime,
        TABLE_COLLATION as collation,
        ROW_FORMAT as rowFormat,
        AUTO_INCREMENT as autoIncrement,
        TABLE_COMMENT as comment
      FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
    `, [database, table])

    if (rows.length === 0) {
      return {
        name: table, rows: 0, dataSize: 0, indexLength: 0, engine: '',
        createTime: null, updateTime: null, collation: null,
        rowFormat: null, autoIncrement: null, comment: null
      }
    }

    const r = rows[0]
    return {
      name: r.name,
      rows: r.rows ?? 0,
      dataSize: r.dataSize ?? 0,
      indexLength: r.indexLength ?? 0,
      engine: r.engine ?? '',
      createTime: r.createTime ?? null,
      updateTime: r.updateTime ?? null,
      collation: r.collation ?? null,
      rowFormat: r.rowFormat ?? null,
      autoIncrement: r.autoIncrement ?? null,
      comment: r.comment ?? null
    }
  } finally {
    conn.release()
  }
}

// ==================== 视图 ====================

export async function getViews(
  config: ConnectionConfig,
  database: string
): Promise<ViewInfo[]> {
  const pool = await getPool(config)
  const conn = await pool.getConnection()
  try {
    const [rows] = await conn.query<RowDataPacket[]>(`
      SELECT
        TABLE_NAME as name,
        VIEW_DEFINITION as definition,
        CHECK_OPTION as checkOption,
        IS_UPDATABLE as updatable,
        SECURITY_TYPE as security,
        DEFINER as definer
      FROM information_schema.VIEWS
      WHERE TABLE_SCHEMA = ?
      ORDER BY TABLE_NAME
    `, [database])
    return rows.map((r) => ({
      name: r.name,
      definition: r.definition,
      checkOption: r.checkOption,
      updatable: r.updatable === 'YES',
      security: r.security,
      definer: r.definer
    }))
  } finally {
    conn.release()
  }
}

// ==================== 函数/存储过程 ====================

export async function getRoutines(
  config: ConnectionConfig,
  database: string
): Promise<RoutineInfo[]> {
  const pool = await getPool(config)
  const conn = await pool.getConnection()
  try {
    const [rows] = await conn.query<RowDataPacket[]>(`
      SELECT
        ROUTINE_NAME as name,
        ROUTINE_TYPE as type,
        DTD_IDENTIFIER as returnType,
        DEFINER as definer,
        LAST_ALTERED as modified,
        CREATED as created,
        ROUTINE_COMMENT as comment,
        IS_DETERMINISTIC as isDeterministic,
        SECURITY_TYPE as securityType,
        ROUTINE_DEFINITION as body
      FROM information_schema.ROUTINES
      WHERE ROUTINE_SCHEMA = ?
      ORDER BY ROUTINE_TYPE, ROUTINE_NAME
    `, [database])
    return rows.map((r) => ({
      name: r.name,
      type: r.type as 'FUNCTION' | 'PROCEDURE',
      returnType: r.returnType,
      definer: r.definer,
      modified: r.modified,
      created: r.created,
      comment: r.comment,
      deterministic: r.isDeterministic === 'YES',
      security: r.securityType,
      body: r.body
    }))
  } finally {
    conn.release()
  }
}

// ==================== 事件 ====================

export async function getEvents(
  config: ConnectionConfig,
  database: string
): Promise<EventInfo[]> {
  const pool = await getPool(config)
  const conn = await pool.getConnection()
  try {
    const [rows] = await conn.query<RowDataPacket[]>(`
      SELECT
        EVENT_NAME as name,
        DEFINER as definer,
        EVENT_TYPE as type,
        STATUS as status,
        STARTS as starts,
        ENDS as ends,
        LAST_EXECUTED as lastExecuted,
        ON_COMPLETION as onCompletion,
        EVENT_COMMENT as comment,
        EVENT_DEFINITION as body
      FROM information_schema.EVENTS
      WHERE EVENT_SCHEMA = ?
      ORDER BY EVENT_NAME
    `, [database])
    return rows.map((r) => ({
      name: r.name,
      definer: r.definer,
      type: r.type,
      status: r.status,
      starts: r.starts ?? null,
      ends: r.ends ?? null,
      lastExecuted: r.lastExecuted ?? null,
      onCompletion: r.onCompletion,
      comment: r.comment,
      body: r.body
    }))
  } finally {
    conn.release()
  }
}

// ==================== ER 关系（全库外键） ====================

export interface ERRelation {
  fromTable: string
  fromColumn: string
  toTable: string
  toColumn: string
  constraintName: string
}

export async function getAllForeignKeys(
  config: ConnectionConfig,
  database: string
): Promise<ERRelation[]> {
  const pool = await getPool(config)
  const conn = await pool.getConnection()
  try {
    const [rows] = await conn.query<RowDataPacket[]>(`
      SELECT
        kcu.TABLE_NAME as fromTable,
        kcu.COLUMN_NAME as fromColumn,
        kcu.REFERENCED_TABLE_NAME as toTable,
        kcu.REFERENCED_COLUMN_NAME as toColumn,
        kcu.CONSTRAINT_NAME as constraintName
      FROM information_schema.KEY_COLUMN_USAGE kcu
      WHERE kcu.TABLE_SCHEMA = ?
        AND kcu.REFERENCED_TABLE_NAME IS NOT NULL
    `, [database])
    return rows.map((r) => ({
      fromTable: r.fromTable,
      fromColumn: r.fromColumn,
      toTable: r.toTable,
      toColumn: r.toColumn,
      constraintName: r.constraintName
    }))
  } finally {
    conn.release()
  }
}

// ==================== 全库表列（用于 ER 图） ====================

export interface ERTableColumns {
  table: string
  columns: { name: string; type: string; isPK: boolean }[]
}

export async function getAllTableColumns(
  config: ConnectionConfig,
  database: string
): Promise<ERTableColumns[]> {
  const pool = await getPool(config)
  const conn = await pool.getConnection()
  try {
    const [rows] = await conn.query<RowDataPacket[]>(`
      SELECT
        TABLE_NAME as \`table\`,
        COLUMN_NAME as \`name\`,
        COLUMN_TYPE as \`type\`,
        COLUMN_KEY as columnKey
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ?
      ORDER BY TABLE_NAME, ORDINAL_POSITION
    `, [database])
    const map = new Map<string, { name: string; type: string; isPK: boolean }[]>()
    for (const r of rows) {
      const tbl = r.table as string
      if (!map.has(tbl)) map.set(tbl, [])
      map.get(tbl)!.push({ name: r.name as string, type: r.type as string, isPK: r.columnKey === 'PRI' })
    }
    return Array.from(map.entries()).map(([table, columns]) => ({ table, columns }))
  } finally {
    conn.release()
  }
}

// ==================== 数据库备份 (SQL Dump) ====================

export interface DumpOptions {
  tables: string[]        // 要导出的表名，空数组表示全部
  includeData: boolean    // 是否包含数据
  includeStructure: boolean // 是否包含表结构
}

export interface DumpProgress {
  current: string
  index: number
  total: number
}

export async function dumpDatabase(
  config: ConnectionConfig,
  database: string,
  options: DumpOptions,
  onProgress?: (p: DumpProgress) => void,
  shouldCancel?: () => boolean,
  filePath?: string
): Promise<string> {
  const pool = await getPool(config)
  const conn = await pool.getConnection()
  try {
    await conn.changeUser({ database })

    // 获取要导出的表列表
    let tableList = options.tables
    if (tableList.length === 0) {
      const [rows] = await conn.query<RowDataPacket[]>(
        `SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'`,
        [database]
      )
      tableList = rows.map((r) => r.TABLE_NAME as string)
    }

    // 流式写入：避免大文件通过 IPC 传输导致截断
    let writeStream: ReturnType<typeof createWriteStream> | null = null
    if (filePath) {
      writeStream = createWriteStream(filePath, { encoding: 'utf-8' })
    }

    // 收集或写入 SQL
    let sql = ''
    const emit = (chunk: string) => {
      if (writeStream) writeStream.write(chunk)
      else sql += chunk
    }

    emit(`-- nexSQL 数据库备份\n`)
    emit(`-- 数据库: ${database}\n`)
    emit(`-- 服务器: ${config.host}:${config.port}\n`)
    emit(`-- 生成时间: ${new Date().toISOString()}\n\n`)
    emit(`SET NAMES utf8mb4;\n`)
    emit(`SET FOREIGN_KEY_CHECKS = 0;\n\n`)

    for (let i = 0; i < tableList.length; i++) {
      if (shouldCancel?.()) throw new Error('已取消')
      const table = tableList[i]
      onProgress?.({ current: table, index: i + 1, total: tableList.length })

      emit(`-- -------------------------------------------\n`)
      emit(`-- 表: ${table}\n`)
      emit(`-- -------------------------------------------\n\n`)

      if (options.includeStructure) {
        emit(`DROP TABLE IF EXISTS \`${table}\`;\n`)
        const [createRows] = await conn.query<RowDataPacket[]>(`SHOW CREATE TABLE \`${table}\``)
        if (createRows.length > 0) {
          emit((createRows[0] as Record<string, unknown>)['Create Table'] as string)
          emit(';\n\n')
        }
      }

      if (options.includeData) {
        const [dataRows] = await conn.query<RowDataPacket[]>(`SELECT * FROM \`${table}\``)
        if (dataRows.length > 0) {
          emit(`-- 数据: ${dataRows.length} 行\n`)
          const cols = Object.keys(dataRows[0])
          const colNames = cols.map((c) => `\`${c}\``).join(', ')

          // 批量插入 (每 50 行一批)
          const BATCH = 50
          for (let j = 0; j < dataRows.length; j += BATCH) {
            const batch = dataRows.slice(j, j + BATCH)
            const values = batch.map((row) => {
              const vals = cols.map((c) => {
                const v = row[c]
                if (v === null || v === undefined) return 'NULL'
                if (typeof v === 'number') return String(v)
                if (typeof v === 'boolean') return v ? '1' : '0'
                if (v instanceof Date) return `'${v.toISOString().slice(0, 19).replace('T', ' ')}'`
                if (Buffer.isBuffer(v)) return `X'${v.toString('hex')}'`
                if (typeof v === 'object') return `'${JSON.stringify(v).replace(/\\/g, '\\\\').replace(/'/g, "''")}'`
                return `'${String(v).replace(/\\/g, '\\\\').replace(/'/g, "''")}'`
              })
              return `(${vals.join(', ')})`
            })
            emit(`INSERT INTO \`${table}\` (${colNames}) VALUES\n${values.join(',\n')};\n\n`)
          }
        }
      }
    }

    emit(`SET FOREIGN_KEY_CHECKS = 1;\n`)

    if (writeStream) {
      // 等待写入流完成
      await new Promise<void>((resolve, reject) => {
        writeStream!.end(() => resolve())
        writeStream!.on('error', reject)
      })
      return filePath!
    }
    return sql
  } finally {
    conn.release()
  }
}
