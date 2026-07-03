import { ipcMain, type BrowserWindow, dialog } from 'electron'
import { writeFile, readFile } from 'fs/promises'
import { createReadStream, statSync } from 'fs'
import { Readable } from 'stream'
import Store from 'electron-store'
import { uuidv4 } from './uuid'
import { encryptPassword, decryptPassword } from './crypto'
import type { ConnectionConfig, IpcResponse } from '../shared/types'
import * as db from './services/db'
import * as redis from './services/redis'
import { generateSqlStream, validateApiKey } from './services/ai'

interface AISettings {
  apiKey: string
  model: string
}

const store = new Store<{
  connections: ConnectionConfig[]
  aiSettings: AISettings
}>({
  name: 'nexsql-config',
  defaults: {
    connections: [],
    aiSettings: { apiKey: '', model: 'deepseek-chat' }
  }
})

/** 记录完整错误信息到主进程控制台 */
function logError(channel: string, err: unknown): void {
  const timestamp = new Date().toISOString()
  if (err instanceof Error) {
    console.error(`[${timestamp}] [IPC:${channel}] Error:`, err.message)
    if (err.stack) {
      console.error(err.stack)
    }
  } else {
    console.error(`[${timestamp}] [IPC:${channel}] Unknown error:`, JSON.stringify(err))
  }
}

/** 提取完整的错误信息（包含 require stack 等） */
function getFullErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    let msg = err.message
    // 如果有附加的 require stack 信息，也包含进来
    const errWithExtra = err as Error & { code?: string; requireStack?: string[] }
    if (errWithExtra.code) {
      msg += `\n[Code: ${errWithExtra.code}]`
    }
    if (errWithExtra.requireStack && errWithExtra.requireStack.length > 0) {
      msg += `\nRequire stack:\n  ${errWithExtra.requireStack.join('\n  ')}`
    }
    return msg
  }
  return String(err)
}

/**
 * 流式 SQL 分割器：逐块读取，逐条产出完整 SQL 语句。
 * 支持 DELIMITER 指令和字符串/注释感知的 ; 分割。
 * 内存友好：不会一次性加载整个文件。
 */
class StreamingSqlSplitter {
  private delimiter = ';'
  private buf: string[] = []
  private inSingle = false
  private inDouble = false
  private inBacktick = false
  private inLineComment = false
  private inBlockComment = false
  private lineBuf = ''

  /** 喙入一段文本，返回由此段文本产生的完整语句 */
  feed(text: string): string[] {
    const completed: string[] = []
    for (let i = 0; i < text.length; i++) {
      this.lineBuf += text[i]
      if (text[i] === '\n') {
        this.flushLine(completed)
      }
    }
    return completed
  }

  /** 所有块读完后调用，返回剩余内容（可能含未结束的语句） */
  flush(): string[] {
    const completed: string[] = []
    if (this.lineBuf) {
      this.flushLine(completed)
    }
    const remaining = this.buf.join('').trim()
    if (remaining) completed.push(remaining)
    return completed
  }

  private flushLine(completed: string[]): void {
    const inAny = this.inSingle || this.inDouble || this.inBacktick || this.inBlockComment || this.inLineComment
    if (!inAny) {
      const m = this.lineBuf.trim().match(/^DELIMITER\s+(.+)$/i)
      if (m) {
        const stmt = this.buf.join('').trim()
        if (stmt) completed.push(stmt)
        this.buf.length = 0
        this.delimiter = m[1].trim()
        this.lineBuf = ''
        return
      }
    }
    this.processChars(this.lineBuf, completed)
    this.lineBuf = ''
  }

  private processChars(chars: string, completed: string[]): void {
    if (this.delimiter !== ';') {
      this.buf.push(chars)
      const content = this.buf.join('')
      let startIdx = 0
      let delimIdx: number
      while ((delimIdx = content.indexOf(this.delimiter, startIdx)) !== -1) {
        const stmt = content.slice(startIdx, delimIdx).trim()
        if (stmt) completed.push(stmt)
        startIdx = delimIdx + this.delimiter.length
      }
      const remainder = content.slice(startIdx)
      this.buf.length = 0
      if (remainder) this.buf.push(remainder)
      return
    }

    // 标准 ; 分隔符——字符级状态机
    for (let i = 0; i < chars.length; i++) {
      const ch = chars[i]; const next = chars[i + 1]
      if (this.inLineComment) { if (ch === '\n') { this.inLineComment = false; this.buf.push(' ') } continue }
      if (this.inBlockComment) { if (ch === '*' && next === '/') { this.inBlockComment = false; i++ } continue }
      if (this.inSingle) {
        this.buf.push(ch)
        if (ch === '\\' && next) { this.buf.push(next); i++; continue }
        if (ch === "'" && next === "'") { this.buf.push(next); i++; continue }
        if (ch === "'") this.inSingle = false
        continue
      }
      if (this.inDouble) {
        this.buf.push(ch)
        if (ch === '\\' && next) { this.buf.push(next); i++; continue }
        if (ch === '"') this.inDouble = false
        continue
      }
      if (this.inBacktick) {
        this.buf.push(ch)
        if (ch === '`' && next === '`') { this.buf.push(next); i++; continue }
        if (ch === '`') this.inBacktick = false
        continue
      }
      if (ch === '-' && next === '-') { this.inLineComment = true; i++; continue }
      if (ch === '/' && next === '*') { this.inBlockComment = true; i++; continue }
      if (ch === "'") { this.inSingle = true; this.buf.push(ch); continue }
      if (ch === '"') { this.inDouble = true; this.buf.push(ch); continue }
      if (ch === '`') { this.inBacktick = true; this.buf.push(ch); continue }
      if (ch === ';') {
        const stmt = this.buf.join('').trim()
        if (stmt) completed.push(stmt)
        this.buf.length = 0
        continue
      }
      this.buf.push(ch)
    }
  }
}

export function setupIpcHandlers(_mainWindow: BrowserWindow): void {
  // ==================== 连接配置存储 ====================

  ipcMain.handle('config:getConnections', () => {
    const connections = store.get('connections', [])
    // 返回时解密密码
    return connections.map((c) => ({
      ...c,
      password: decryptPassword(c.password) ?? '',
      sshPassword: decryptPassword(c.sshPassword)
    }))
  })

  ipcMain.handle('config:saveConnection', (_event, config: ConnectionConfig) => {
    const connections = store.get('connections', [])
    const idx = connections.findIndex((c) => c.id === config.id)
    // 保存前加密密码
    const encrypted: ConnectionConfig = {
      ...config,
      password: encryptPassword(config.password) ?? config.password,
      sshPassword: encryptPassword(config.sshPassword)
    }
    if (idx >= 0) {
      connections[idx] = encrypted
    } else {
      encrypted.id = encrypted.id || uuidv4()
      connections.push(encrypted)
    }
    store.set('connections', connections)
    // 返回解密版本给前端
    return {
      ...encrypted,
      password: decryptPassword(encrypted.password) ?? '',
      sshPassword: decryptPassword(encrypted.sshPassword)
    }
  })

  ipcMain.handle('config:deleteConnection', (_event, id: string) => {
    const connections = store.get('connections', [])
    const filtered = connections.filter((c) => c.id !== id)
    store.set('connections', filtered)
    db.disconnect(id)
    return true
  })

  // ==================== 数据库操作 ====================

  ipcMain.handle('db:testConnection', async (_event, config: ConnectionConfig): Promise<IpcResponse> => {
    try {
      await db.testConnection(config)
      return { success: true }
    } catch (err) {
      logError('db:testConnection', err)
      return { success: false, error: getFullErrorMessage(err) }
    }
  })

  ipcMain.handle('db:connect', async (_event, config: ConnectionConfig): Promise<IpcResponse> => {
    try {
      await db.connect(config)
      return { success: true }
    } catch (err) {
      logError('db:connect', err)
      return { success: false, error: getFullErrorMessage(err) }
    }
  })

  ipcMain.handle('db:disconnect', async (_event, configId: string): Promise<IpcResponse> => {
    try {
      await db.disconnect(configId)
      return { success: true }
    } catch (err) {
      logError('db:disconnect', err)
      return { success: false, error: getFullErrorMessage(err) }
    }
  })

  ipcMain.handle(
    'db:query',
    async (_event, config: ConnectionConfig, sql: string, database?: string): Promise<IpcResponse> => {
      try {
        const result = await db.executeQuery(config, sql, database)
        return { success: true, data: result }
      } catch (err) {
        logError('db:query', err)
        return { success: false, error: getFullErrorMessage(err) }
      }
    }
  )

  ipcMain.handle(
    'db:executeBatch',
    async (event, config: ConnectionConfig, statements: string[], database?: string): Promise<IpcResponse> => {
      try {
        const results = await db.executeBatch(config, statements, database, (index, total, result) => {
          // 流式上报每条语句的执行进度
          event.sender.send('db:batchProgress', { index, total, result })
        })
        return { success: true, data: results }
      } catch (err) {
        logError('db:executeBatch', err)
        return { success: false, error: getFullErrorMessage(err) }
      }
    }
  )

  ipcMain.handle('db:getDatabases', async (_event, config: ConnectionConfig) => {
    try {
      const databases = await db.getDatabases(config)
      return { success: true, data: databases }
    } catch (err) {
      logError('db:getDatabases', err)
      return { success: false, error: getFullErrorMessage(err) }
    }
  })

  ipcMain.handle('db:getTables', async (_event, config: ConnectionConfig, database: string) => {
    try {
      const tables = await db.getTables(config, database)
      return { success: true, data: tables }
    } catch (err) {
      logError('db:getTables', err)
      return { success: false, error: getFullErrorMessage(err) }
    }
  })

  ipcMain.handle(
    'db:getTableColumns',
    async (_event, config: ConnectionConfig, database: string, table: string) => {
      try {
        const columns = await db.getTableColumns(config, database, table)
        return { success: true, data: columns }
      } catch (err) {
        logError('db:getTableColumns', err)
        return { success: false, error: getFullErrorMessage(err) }
      }
    }
  )

  ipcMain.handle(
    'db:getTableIndexes',
    async (_event, config: ConnectionConfig, database: string, table: string) => {
      try {
        const indexes = await db.getTableIndexes(config, database, table)
        return { success: true, data: indexes }
      } catch (err) {
        logError('db:getTableIndexes', err)
        return { success: false, error: getFullErrorMessage(err) }
      }
    }
  )

  ipcMain.handle(
    'db:getTableRowCount',
    async (_event, config: ConnectionConfig, database: string, table: string) => {
      try {
        const count = await db.getTableRowCount(config, database, table)
        return { success: true, data: count }
      } catch (err) {
        logError('db:getTableRowCount', err)
        return { success: false, error: getFullErrorMessage(err) }
      }
    }
  )

  ipcMain.handle(
    'db:getTableDDL',
    async (_event, config: ConnectionConfig, database: string, table: string) => {
      try {
        const ddl = await db.getTableDDL(config, database, table)
        return { success: true, data: ddl }
      } catch (err) {
        logError('db:getTableDDL', err)
        return { success: false, error: getFullErrorMessage(err) }
      }
    }
  )

  ipcMain.handle(
    'db:getForeignKeys',
    async (_event, config: ConnectionConfig, database: string, table: string) => {
      try {
        const fks = await db.getForeignKeys(config, database, table)
        return { success: true, data: fks }
      } catch (err) {
        logError('db:getForeignKeys', err)
        return { success: false, error: getFullErrorMessage(err) }
      }
    }
  )

  ipcMain.handle(
    'db:getTableTriggers',
    async (_event, config: ConnectionConfig, database: string, table: string) => {
      try {
        const triggers = await db.getTableTriggers(config, database, table)
        return { success: true, data: triggers }
      } catch (err) {
        logError('db:getTableTriggers', err)
        return { success: false, error: getFullErrorMessage(err) }
      }
    }
  )

  ipcMain.handle(
    'db:getTableOptions',
    async (_event, config: ConnectionConfig, database: string, table: string) => {
      try {
        const options = await db.getTableOptions(config, database, table)
        return { success: true, data: options }
      } catch (err) {
        logError('db:getTableOptions', err)
        return { success: false, error: getFullErrorMessage(err) }
      }
    }
  )

  ipcMain.handle(
    'db:getTableDetails',
    async (_event, config: ConnectionConfig, database: string, table: string) => {
      try {
        const details = await db.getTableDetails(config, database, table)
        return { success: true, data: details }
      } catch (err) {
        logError('db:getTableDetails', err)
        return { success: false, error: getFullErrorMessage(err) }
      }
    }
  )

  ipcMain.handle(
    'db:getViews',
    async (_event, config: ConnectionConfig, database: string) => {
      try {
        const data = await db.getViews(config, database)
        return { success: true, data }
      } catch (err) {
        logError('db:getViews', err)
        return { success: false, error: getFullErrorMessage(err) }
      }
    }
  )

  ipcMain.handle(
    'db:getRoutines',
    async (_event, config: ConnectionConfig, database: string) => {
      try {
        const data = await db.getRoutines(config, database)
        return { success: true, data }
      } catch (err) {
        logError('db:getRoutines', err)
        return { success: false, error: getFullErrorMessage(err) }
      }
    }
  )

  ipcMain.handle(
    'db:getEvents',
    async (_event, config: ConnectionConfig, database: string) => {
      try {
        const data = await db.getEvents(config, database)
        return { success: true, data }
      } catch (err) {
        logError('db:getEvents', err)
        return { success: false, error: getFullErrorMessage(err) }
      }
    }
  )

  // ==================== ER 图数据 ====================

  ipcMain.handle(
    'db:getERRelations',
    async (_event, config: ConnectionConfig, database: string) => {
      try {
        const data = await db.getAllForeignKeys(config, database)
        return { success: true, data }
      } catch (err) {
        logError('db:getERRelations', err)
        return { success: false, error: getFullErrorMessage(err) }
      }
    }
  )

  ipcMain.handle(
    'db:getERTableColumns',
    async (_event, config: ConnectionConfig, database: string) => {
      try {
        const data = await db.getAllTableColumns(config, database)
        return { success: true, data }
      } catch (err) {
        logError('db:getERTableColumns', err)
        return { success: false, error: getFullErrorMessage(err) }
      }
    }
  )

  // ==================== 性能监控 ====================

  ipcMain.handle(
    'db:getServerStatus',
    async (_event, config: ConnectionConfig) => {
      try {
        const data = await db.getServerStatus(config)
        return { success: true, data }
      } catch (err) {
        logError('db:getServerStatus', err)
        return { success: false, error: getFullErrorMessage(err) }
      }
    }
  )

  // ==================== 数据库备份/恢复 ====================

  // 取消标记
  const cancelFlags = new Set<string>()

  ipcMain.handle('db:cancelOperation', (_event, operationId: string) => {
    cancelFlags.add(operationId)
  })

  ipcMain.handle(
    'db:dumpDatabase',
    async (event, config: ConnectionConfig, database: string, options: { tables: string[]; includeData: boolean; includeStructure: boolean }, operationId: string, filePath?: string) => {
      try {
        const sql = await db.dumpDatabase(config, database, options,
          (p) => {
            if (cancelFlags.has(operationId)) return
            event.sender.send('db:backupProgress', { operationId, ...p })
          },
          () => cancelFlags.has(operationId),
          filePath
        )
        if (cancelFlags.has(operationId)) {
          cancelFlags.delete(operationId)
          return { success: false, error: '已取消' }
        }
        return { success: true, data: sql }
      } catch (err) {
        if ((err as Error).message === '已取消') {
          return { success: false, error: '已取消' }
        }
        logError('db:dumpDatabase', err)
        return { success: false, error: getFullErrorMessage(err) }
      } finally {
        cancelFlags.delete(operationId)
      }
    }
  )

  ipcMain.handle(
    'db:restoreDatabase',
    async (event, config: ConnectionConfig, database: string, sqlOrPath: string, operationId: string) => {
      try {
        const pool = await db.getPool(config)
        const conn = await pool.getConnection()
        try {
          await conn.changeUser({ database })

          // 确定输入源：文件路径或 SQL 字符串
          let stream: NodeJS.ReadableStream
          let totalSize: number
          if (sqlOrPath.endsWith('.sql') && !sqlOrPath.includes(';')) {
            totalSize = statSync(sqlOrPath).size
            stream = createReadStream(sqlOrPath, { encoding: 'utf-8', highWaterMark: 128 * 1024 })
          } else {
            totalSize = Buffer.byteLength(sqlOrPath, 'utf-8')
            stream = Readable.from(sqlOrPath, { highWaterMark: 128 * 1024 })
          }

          const splitter = new StreamingSqlSplitter()
          const BATCH_SIZE = 50
          const SKIP_ERRORS = new Set(['Query was empty', 'No database selected'])
          let batch: string[] = []
          let executed = 0
          let bytesRead = 0
          let lastProgressAt = 0

          await conn.query('SET autocommit = 0')
          let inTransaction = true

          // 批量执行辅助函数
          const executeBatch = async (stmts: string[]): Promise<void> => {
            if (stmts.length === 0) return
            const batchSql = stmts.join(';\n')
            try {
              await conn.query(batchSql)
              executed += stmts.length
            } catch {
              // 批量失败，回退逐条执行
              await conn.rollback()
              await conn.query('SET autocommit = 0')
              inTransaction = true
              for (const stmt of stmts) {
                try {
                  await conn.query(stmt)
                  executed++
                } catch (retryErr: any) {
                  const msg = retryErr?.message || String(retryErr)
                  if (SKIP_ERRORS.has(msg)) continue
                  const preview = stmt.length > 200 ? stmt.slice(0, 200) + '...' : stmt
                  throw new Error(`执行失败:\n${msg}\n\nSQL: ${preview}`)
                }
              }
            }
          }

          for await (const chunk of stream) {
            if (cancelFlags.has(operationId)) {
              cancelFlags.delete(operationId)
              if (inTransaction) await conn.rollback()
              return { success: false, error: '已取消' }
            }

            const text = typeof chunk === 'string' ? chunk : (chunk as Buffer).toString('utf-8')
            bytesRead += Buffer.byteLength(text, 'utf-8')

            const stmts = splitter.feed(text)
            for (const s of stmts) batch.push(s)

            // 攒满一批就执行
            while (batch.length >= BATCH_SIZE) {
              const toExec = batch.splice(0, BATCH_SIZE)
              await executeBatch(toExec)
            }

            // 按进度间隔上报（每 256KB 或全部读完）
            if (bytesRead - lastProgressAt >= 256 * 1024 || bytesRead >= totalSize) {
              lastProgressAt = bytesRead
              event.sender.send('db:restoreProgress', {
                operationId,
                current: bytesRead,
                total: totalSize,
                executed
              })
            }
          }

          // flush 分割器中剩余的内容
          const remaining = splitter.flush()
          for (const s of remaining) batch.push(s)

          // 执行最后一批
          if (batch.length > 0) {
            await executeBatch(batch)
            batch.length = 0
          }

          // 提交事务
          if (inTransaction) {
            await conn.commit()
            await conn.query('SET autocommit = 1')
          }

          return { success: true, data: { executed } }
        } finally {
          try { await conn.query('SET autocommit = 1') } catch {}
          conn.release()
        }
      } catch (err) {
        logError('db:restoreDatabase', err)
        return { success: false, error: getFullErrorMessage(err) }
      } finally {
        cancelFlags.delete(operationId)
      }
    }
  )

  // ==================== 文件保存（导出） ====================

  // 仅选择保存路径（不写入内容）
  ipcMain.handle(
    'file:savePathDialog',
    async (_event, defaultName: string, filterExt?: string) => {
      try {
        const filters: Electron.FileFilter[] = []
        if (filterExt === 'csv') {
          filters.push({ name: 'CSV 文件', extensions: ['csv'] })
        } else if (filterExt === 'json') {
          filters.push({ name: 'JSON 文件', extensions: ['json'] })
        } else if (filterExt === 'sql') {
          filters.push({ name: 'SQL 文件', extensions: ['sql'] })
        } else {
          filters.push({ name: 'SQL 文件', extensions: ['sql'] })
        }
        filters.push({ name: '所有文件', extensions: ['*'] })
        const result = await dialog.showSaveDialog(_mainWindow, { defaultPath: defaultName, filters })
        if (result.canceled || !result.filePath) {
          return { success: true, data: { saved: false } }
        }
        return { success: true, data: { saved: true, path: result.filePath } }
      } catch (err) {
        logError('file:savePathDialog', err)
        return { success: false, error: getFullErrorMessage(err) }
      }
    }
  )

  // 写入内容到指定路径
  ipcMain.handle(
    'file:writeToFile',
    async (_event, filePath: string, content: string) => {
      try {
        await writeFile(filePath, content, 'utf-8')
        return { success: true, data: true }
      } catch (err) {
        logError('file:writeToFile', err)
        return { success: false, error: getFullErrorMessage(err) }
      }
    }
  )

  ipcMain.handle(
    'file:saveDialog',
    async (_event, defaultName: string, content: string, filterExt?: string) => {
      try {
        const filters: Electron.FileFilter[] = []
        if (filterExt === 'csv') {
          filters.push({ name: 'CSV 文件', extensions: ['csv'] })
        } else if (filterExt === 'json') {
          filters.push({ name: 'JSON 文件', extensions: ['json'] })
        } else if (filterExt === 'sql') {
          filters.push({ name: 'SQL 文件', extensions: ['sql'] })
        } else if (filterExt === 'xlsx' || filterExt === 'excel') {
          filters.push({ name: 'Excel 文件', extensions: ['xlsx'] })
        } else {
          filters.push({ name: 'SQL 文件', extensions: ['sql'] })
        }
        filters.push({ name: '所有文件', extensions: ['*'] })

        const result = await dialog.showSaveDialog(_mainWindow, {
          defaultPath: defaultName,
          filters
        })
        if (result.canceled || !result.filePath) {
          return { success: true, data: { saved: false } }
        }
        await writeFile(result.filePath, content, 'utf-8')
        return { success: true, data: { saved: true, path: result.filePath } }
      } catch (err) {
        logError('file:saveDialog', err)
        return { success: false, error: getFullErrorMessage(err) }
      }
    }
  )

  // ==================== 文件打开（导入） ====================

  ipcMain.handle(
    'file:openDialog',
    async (_event, filterExt?: string) => {
      try {
        const filters: Electron.FileFilter[] = []
        if (filterExt === 'csv') {
          filters.push({ name: 'CSV 文件', extensions: ['csv'] })
        } else if (filterExt === 'json') {
          filters.push({ name: 'JSON 文件', extensions: ['json'] })
        } else if (filterExt === 'sql') {
          filters.push({ name: 'SQL 文件', extensions: ['sql'] })
        }
        filters.push({ name: '所有文件', extensions: ['*'] })

        const result = await dialog.showOpenDialog(_mainWindow, {
          properties: ['openFile'],
          filters
        })
        if (result.canceled || result.filePaths.length === 0) {
          return { success: true, data: { canceled: true, content: '' } }
        }
        const content = await readFile(result.filePaths[0], 'utf-8')
        return { success: true, data: { canceled: false, content, path: result.filePaths[0] } }
      } catch (err) {
        logError('file:openDialog', err)
        return { success: false, error: getFullErrorMessage(err) }
      }
    }
  )

  // ==================== Redis 操作 ====================

  ipcMain.handle('redis:testConnection',
    async (_event, config: ConnectionConfig) => {
      try {
        await redis.testRedisConnection(config)
        return { success: true }
      } catch (err) {
        logError('redis:testConnection', err)
        return { success: false, error: getFullErrorMessage(err) }
      }
    }
  )

  ipcMain.handle('redis:connect',
    async (_event, config: ConnectionConfig) => {
      try {
        await redis.getClient(config)
        return { success: true }
      } catch (err) {
        logError('redis:connect', err)
        return { success: false, error: getFullErrorMessage(err) }
      }
    }
  )

  ipcMain.handle('redis:disconnect',
    async (_event, configId: string) => {
      try {
        await redis.disconnectRedis(configId)
        return { success: true }
      } catch (err) {
        logError('redis:disconnect', err)
        return { success: false, error: getFullErrorMessage(err) }
      }
    }
  )

  ipcMain.handle('redis:dbsize',
    async (_event, config: ConnectionConfig) => {
      try {
        const size = await redis.getDbSize(config)
        return { success: true, data: size }
      } catch (err) {
        logError('redis:dbsize', err)
        return { success: false, error: getFullErrorMessage(err) }
      }
    }
  )

  ipcMain.handle('redis:scan',
    async (_event, config: ConnectionConfig, pattern: string, cursor: number, count?: number) => {
      try {
        const result = await redis.scanKeys(config, pattern, cursor, count ?? 200)
        return { success: true, data: result }
      } catch (err) {
        logError('redis:scan', err)
        return { success: false, error: getFullErrorMessage(err) }
      }
    }
  )

  ipcMain.handle('redis:getKey',
    async (_event, config: ConnectionConfig, key: string) => {
      try {
        const detail = await redis.getKeyDetail(config, key)
        return { success: true, data: detail }
      } catch (err) {
        logError('redis:getKey', err)
        return { success: false, error: getFullErrorMessage(err) }
      }
    }
  )

  ipcMain.handle('redis:setKey',
    async (_event, config: ConnectionConfig, key: string, type: string, value: string, ttl?: number) => {
      try {
        await redis.setKeyValue(config, key, type as any, value, ttl)
        return { success: true }
      } catch (err) {
        logError('redis:setKey', err)
        return { success: false, error: getFullErrorMessage(err) }
      }
    }
  )

  ipcMain.handle('redis:deleteKey',
    async (_event, config: ConnectionConfig, key: string) => {
      try {
        await redis.deleteKey(config, key)
        return { success: true }
      } catch (err) {
        logError('redis:deleteKey', err)
        return { success: false, error: getFullErrorMessage(err) }
      }
    }
  )

  ipcMain.handle('redis:setTtl',
    async (_event, config: ConnectionConfig, key: string, ttl: number) => {
      try {
        await redis.setTtl(config, key, ttl)
        return { success: true }
      } catch (err) {
        logError('redis:setTtl', err)
        return { success: false, error: getFullErrorMessage(err) }
      }
    }
  )

  ipcMain.handle('redis:rename',
    async (_event, config: ConnectionConfig, oldKey: string, newKey: string) => {
      try {
        await redis.renameKey(config, oldKey, newKey)
        return { success: true }
      } catch (err) {
        logError('redis:rename', err)
        return { success: false, error: getFullErrorMessage(err) }
      }
    }
  )

  ipcMain.handle('redis:command',
    async (_event, config: ConnectionConfig, command: string[]) => {
      try {
        const result = await redis.executeCommand(config, command)
        return { success: true, data: result }
      } catch (err) {
        logError('redis:command', err)
        return { success: false, error: getFullErrorMessage(err) }
      }
    }
  )

  // ==================== AI 自然语言生成 SQL ====================

  // 获取 AI 设置
  ipcMain.handle('ai:getSettings', () => {
    const settings = store.get('aiSettings', { apiKey: '', model: 'deepseek-chat' })
    return { apiKey: settings.apiKey, model: settings.model }
  })

  // 保存 AI 设置
  ipcMain.handle('ai:setSettings', (_event, settings: { apiKey: string; model: string }) => {
    store.set('aiSettings', settings)
    return true
  })

  // 验证 API Key
  ipcMain.handle('ai:validateApiKey', async (_event, apiKey: string, model?: string) => {
    try {
      const valid = await validateApiKey(apiKey, model || 'deepseek-chat')
      return { success: true, data: valid }
    } catch (err) {
      logError('ai:validateApiKey', err)
      return { success: false, error: getFullErrorMessage(err) }
    }
  })

  // 流式生成 SQL
  // 取消标记
  const aiCancelFlags = new Set<string>()

  ipcMain.handle('ai:cancelGenerate', (_event, requestId: string) => {
    aiCancelFlags.add(requestId)
  })

  ipcMain.handle(
    'ai:generateSql',
    async (
      event,
      params: {
        requestId: string
        prompt: string
        config?: ConnectionConfig
        database?: string
        existingSql?: string
      }
    ) => {
      const { requestId, prompt, config, database, existingSql } = params
      const aiSettings = store.get('aiSettings', { apiKey: '', model: 'deepseek-chat' })

      if (!aiSettings.apiKey) {
        return { success: false, error: '请先配置 DeepSeek API Key' }
      }

      // 获取数据库 schema 作为上下文
      let schema: { table: string; columns: { name: string; type: string; isPK: boolean }[] }[] | undefined
      if (config && database) {
        try {
          schema = await db.getAllTableColumns(config, database)
        } catch {
          // schema 获取失败不影响生成，让 AI 在无表结构上下文下工作
        }
      }

      try {
        const fullSql = await generateSqlStream(
          {
            prompt,
            apiKey: aiSettings.apiKey,
            model: aiSettings.model,
            database,
            schema,
            existingSql,
          },
          {
            onChunk: (chunk: string) => {
              if (aiCancelFlags.has(requestId)) return
              event.sender.send('ai:streamChunk', { requestId, chunk })
            },
            signal: {
              get cancelled() {
                return aiCancelFlags.has(requestId)
              },
            },
          }
        )

        const wasCancelled = aiCancelFlags.has(requestId)
        aiCancelFlags.delete(requestId)

        if (wasCancelled) {
          return { success: false, error: '已取消' }
        }

        return { success: true, data: fullSql }
      } catch (err) {
        aiCancelFlags.delete(requestId)
        logError('ai:generateSql', err)
        return { success: false, error: getFullErrorMessage(err) }
      }
    }
  )
}

export function getStoredConnections(): ConnectionConfig[] {
  return store.get('connections', []).map((c) => ({
    ...c,
    password: decryptPassword(c.password) ?? '',
    sshPassword: decryptPassword(c.sshPassword)
  }))
}
