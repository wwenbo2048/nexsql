import { ipcMain, type BrowserWindow, dialog, app } from 'electron'
import { writeFile, readFile, mkdir, chmod } from 'fs/promises'
import { createReadStream, statSync } from 'fs'
import { Readable } from 'stream'
import { join } from 'path'
import { homedir } from 'os'
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

interface AiConversationMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  status?: 'streaming' | 'done' | 'error'
}

interface AiConversation {
  id: string
  title: string
  messages: AiConversationMessage[]
  database?: string
  createdAt: number
  updatedAt: number
}

const store = new Store<{
  connections: ConnectionConfig[]
  aiSettings: AISettings
  aiConversations: AiConversation[]
}>({
  name: 'nexsql-config',
  defaults: {
    connections: [],
    aiSettings: { apiKey: '', model: 'deepseek-chat' },
    aiConversations: []
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

  /** 将当前所有连接同步导出到 MCP 配置文件（静默，失败不阻塞） */
  async function syncMcpConnections(): Promise<void> {
    try {
      const connections = store.get('connections', []).map((c) => ({
        ...c,
        password: decryptPassword(c.password) ?? '',
        sshPassword: decryptPassword(c.sshPassword) ?? ''
      }))

      const mcpConnections = connections.map((c) => ({
        id: c.id,
        name: c.name,
        type: c.type,
        host: c.host,
        port: c.port,
        user: c.user,
        password: c.password,
        database: c.database,
        sslEnabled: c.sslEnabled,
        connectTimeout: c.connectTimeout,
        redisDb: c.redisDb,
        sshEnabled: c.sshEnabled,
        sshHost: c.sshHost,
        sshPort: c.sshPort,
        sshUser: c.sshUser,
        sshPassword: c.sshPassword,
        sshPrivateKey: c.sshPrivateKey
      }))

      const mcpDir = join(homedir(), '.nexsql')
      const mcpPath = join(mcpDir, 'mcp-connections.json')
      await mkdir(mcpDir, { recursive: true })
      await writeFile(mcpPath, JSON.stringify({ connections: mcpConnections }, null, 2), 'utf-8')
    } catch (err) {
      // 静默失败：MCP 配置同步不应阻塞连接保存操作
      console.error('[MCP] 自动同步连接配置失败:', err)
    }
  }

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
    // 自动同步到 MCP 配置文件
    syncMcpConnections()
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
    // 自动同步到 MCP 配置文件
    syncMcpConnections()
    return true
  })

  /** 导出所有连接配置到 JSON 文件（密码为明文，便于跨设备导入） */
  ipcMain.handle(
    'config:exportConnections',
    async (): Promise<IpcResponse<{ canceled: boolean; path?: string; count: number }>> => {
      try {
        const connections = store.get('connections', [])
        if (connections.length === 0) {
          return { success: false, error: '没有可导出的连接' }
        }
        // 解密密码，导出明文便于在其他设备导入
        const plain = connections.map((c) => ({
          ...c,
          password: decryptPassword(c.password) ?? '',
          sshPassword: decryptPassword(c.sshPassword) ?? ''
        }))
        const now = new Date()
        const pad = (n: number) => String(n).padStart(2, '0')
        const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`
        const result = await dialog.showSaveDialog(_mainWindow, {
          defaultPath: `nexsql-connections-${stamp}.json`,
          filters: [
            { name: 'JSON 文件', extensions: ['json'] },
            { name: '所有文件', extensions: ['*'] }
          ]
        })
        if (result.canceled || !result.filePath) {
          return { success: true, data: { canceled: true, count: 0 } }
        }
        const payload = {
          app: 'nexsql',
          version: 1,
          exportedAt: now.toISOString(),
          connections: plain
        }
        await writeFile(result.filePath, JSON.stringify(payload, null, 2), 'utf-8')
        // 文件包含明文密码，收紧权限为仅当前用户可读写（Windows 上为空操作）
        try {
          await chmod(result.filePath, 0o600)
        } catch (permErr) {
          // 权限收紧失败不阻塞导出（部分文件系统不支持）
          console.error('[config:exportConnections] chmod 0600 失败:', permErr)
        }
        return { success: true, data: { canceled: false, path: result.filePath, count: plain.length } }
      } catch (err) {
        logError('config:exportConnections', err)
        return { success: false, error: getFullErrorMessage(err) }
      }
    }
  )

  /** 从 JSON 文件导入连接配置（按 id 合并：已存在则更新，不存在则新增） */
  ipcMain.handle(
    'config:importConnections',
    async (): Promise<
      IpcResponse<{
        canceled: boolean
        added: number
        updated: number
        skipped: number
        updatedIds: string[]
        path?: string
      }>
    > => {
      try {
        const result = await dialog.showOpenDialog(_mainWindow, {
          properties: ['openFile'],
          filters: [
            { name: 'JSON 文件', extensions: ['json'] },
            { name: '所有文件', extensions: ['*'] }
          ]
        })
        if (result.canceled || result.filePaths.length === 0) {
          return { success: true, data: { canceled: true, added: 0, updated: 0, skipped: 0, updatedIds: [] } }
        }
        const filePath = result.filePaths[0]
        const content = await readFile(filePath, 'utf-8')

        let parsed: unknown
        try {
          parsed = JSON.parse(content)
        } catch {
          return { success: false, error: '文件不是有效的 JSON 格式' }
        }
        // 兼容三种格式：{ connections: [...] }（本应用导出 / MCP 配置）/ [ ... ] 纯数组
        let list: unknown[]
        if (Array.isArray(parsed)) {
          list = parsed
        } else if (
          parsed &&
          typeof parsed === 'object' &&
          Array.isArray((parsed as { connections?: unknown }).connections)
        ) {
          list = (parsed as { connections: unknown[] }).connections
        } else {
          return { success: false, error: '文件格式不正确：未找到 connections 连接数组' }
        }
        if (list.length === 0) {
          return { success: false, error: '文件中没有连接配置' }
        }

        const validTypes = ['mysql', 'redis']
        const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined)
        const connections = store.get('connections', [])
        let added = 0
        let updated = 0
        let skipped = 0
        const updatedIds: string[] = []
        // 同一批次内按 id 去重：重复 id 仅保留首条，避免计数虚高
        const batchIds = new Set<string>()

        for (const raw of list) {
          if (!raw || typeof raw !== 'object') {
            skipped++
            continue
          }
          const item = raw as Record<string, unknown>
          if (
            !str(item.name) ||
            !str(item.host) ||
            !validTypes.includes(item.type as string)
          ) {
            skipped++
            continue
          }
          const type = item.type as ConnectionConfig['type']
          const imported: ConnectionConfig = {
            id: str(item.id) ?? uuidv4(),
            name: (item.name as string).trim(),
            ...(str(item.group) ? { group: str(item.group) } : {}),
            ...(Array.isArray(item.tags)
              ? { tags: item.tags.filter((t): t is string => typeof t === 'string') }
              : {}),
            type,
            host: (item.host as string).trim(),
            port: typeof item.port === 'number' && item.port > 0 ? item.port : type === 'redis' ? 6379 : 3306,
            user: typeof item.user === 'string' ? item.user : '',
            password: encryptPassword(typeof item.password === 'string' ? item.password : '') ?? '',
            ...(str(item.database) ? { database: str(item.database) } : {}),
            ...(str(item.color) ? { color: str(item.color) } : {}),
            sshEnabled: item.sshEnabled === true,
            ...(str(item.sshHost) ? { sshHost: str(item.sshHost) } : {}),
            ...(typeof item.sshPort === 'number' && item.sshPort > 0 ? { sshPort: item.sshPort } : {}),
            ...(str(item.sshUser) ? { sshUser: str(item.sshUser) } : {}),
            sshPassword: encryptPassword(typeof item.sshPassword === 'string' ? item.sshPassword : '') ?? '',
            ...(str(item.sshPrivateKey) ? { sshPrivateKey: str(item.sshPrivateKey) } : {}),
            sslEnabled: item.sslEnabled === true,
            ...(typeof item.connectTimeout === 'number' && item.connectTimeout > 0
              ? { connectTimeout: item.connectTimeout }
              : {}),
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

        if (added + updated === 0) {
          return { success: false, error: `没有可导入的有效连接（共 ${skipped} 条无效记录）` }
        }
        store.set('connections', connections)
        // 断开被更新连接的旧连接池/SSH 隧道，确保新配置生效（未连接时为空操作）
        // 否则连接池按 id 缓存会继续复用旧配置，导致后续操作打到错误实例
        await Promise.all(updatedIds.map((id) => Promise.allSettled([db.disconnect(id), redis.disconnectRedis(id)])))
        // 自动同步到 MCP 配置文件
        syncMcpConnections()
        return { success: true, data: { canceled: false, added, updated, skipped, updatedIds, path: filePath } }
      } catch (err) {
        logError('config:importConnections', err)
        return { success: false, error: getFullErrorMessage(err) }
      }
    }
  )

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

  ipcMain.handle('redis:batchDeleteKeys',
    async (_event, config: ConnectionConfig, keys: string[]) => {
      try {
        const deleted = await redis.batchDeleteKeys(config, keys)
        return { success: true, data: deleted }
      } catch (err) {
        logError('redis:batchDeleteKeys', err)
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

  // ==================== AI 对话持久化 ====================

  // 获取所有对话列表（不含消息体，减少 IPC 传输）
  ipcMain.handle('ai:getConversations', () => {
    const conversations = store.get('aiConversations', [])
    return conversations
      .map(({ id, title, database, createdAt, updatedAt }) => ({ id, title, database, createdAt, updatedAt }))
      .sort((a, b) => b.updatedAt - a.updatedAt)
  })

  // 获取单个对话的完整消息
  ipcMain.handle('ai:getConversation', (_event, id: string) => {
    const conversations = store.get('aiConversations', [])
    return conversations.find((c) => c.id === id) ?? null
  })

  // 创建新对话
  ipcMain.handle('ai:createConversation', (_event, database?: string) => {
    const conversations = store.get('aiConversations', [])
    const now = Date.now()
    const conv: AiConversation = {
      id: `conv-${now}-${Math.random().toString(36).slice(2, 8)}`,
      title: '新对话',
      messages: [],
      database,
      createdAt: now,
      updatedAt: now,
    }
    conversations.push(conv)
    store.set('aiConversations', conversations)
    return conv
  })

  // 保存（更新）对话
  ipcMain.handle('ai:saveConversation', (_event, conv: AiConversation) => {
    const conversations = store.get('aiConversations', [])
    const idx = conversations.findIndex((c) => c.id === conv.id)
    conv.updatedAt = Date.now()
    if (idx >= 0) {
      conversations[idx] = conv
    } else {
      conversations.push(conv)
    }
    store.set('aiConversations', conversations)
    return true
  })

  // 删除对话
  ipcMain.handle('ai:deleteConversation', (_event, id: string) => {
    const conversations = store.get('aiConversations', [])
    const filtered = conversations.filter((c) => c.id !== id)
    store.set('aiConversations', filtered)
    return true
  })

  // 清空所有对话
  ipcMain.handle('ai:clearConversations', () => {
    store.set('aiConversations', [])
    return true
  })

  // 清除应用缓存数据
  ipcMain.handle('app:clearCache', () => {
    // 清除 AI 对话
    store.set('aiConversations', [])
    return true
  })

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

  // ==================== MCP 配置导出 ====================

  ipcMain.handle('config:exportMcp', async (): Promise<IpcResponse<{ path: string; count: number }>> => {
    try {
      const count = store.get('connections', []).length
      const mcpDir = join(homedir(), '.nexsql')
      const mcpPath = join(mcpDir, 'mcp-connections.json')
      await syncMcpConnections()
      return { success: true, data: { path: mcpPath, count } }
    } catch (err) {
      logError('config:exportMcp', err)
      return { success: false, error: getFullErrorMessage(err) }
    }
  })

  // 获取 MCP 服务器路径和状态
  ipcMain.handle('config:getMcpInfo', (): IpcResponse<{ serverPath: string; configPath: string; built: boolean }> => {
    try {
      const resourcesPath = app.isPackaged
        ? join(process.resourcesPath, 'mcp')
        : join(__dirname, '..', '..', 'mcp')  // dev: src/mcp -> project root -> out/mcp
      const devBuildPath = join(app.getAppPath(), 'out', 'mcp', 'index.js')
      // 生产环境使用 launcher.cjs（设置 NODE_PATH），开发环境直接用 index.js
      const serverPath = app.isPackaged
        ? join(resourcesPath, 'launcher.cjs')
        : devBuildPath

      // 检查是否已构建
      let built = false
      try {
        statSync(serverPath)
        built = true
      } catch {
        // 开发环境回退检查 index.js
        try {
          statSync(devBuildPath)
          built = true
        } catch {
          built = false
        }
      }

      const configPath = join(homedir(), '.nexsql', 'mcp-connections.json')
      return { success: true, data: { serverPath, configPath, built } }
    } catch (err) {
      logError('config:getMcpInfo', err)
      return { success: false, error: getFullErrorMessage(err) }
    }
  })
}

export function getStoredConnections(): ConnectionConfig[] {
  return store.get('connections', []).map((c) => ({
    ...c,
    password: decryptPassword(c.password) ?? '',
    sshPassword: decryptPassword(c.sshPassword)
  }))
}
