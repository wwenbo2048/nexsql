import { ipcMain, type BrowserWindow, dialog } from 'electron'
import { writeFile, readFile } from 'fs/promises'
import Store from 'electron-store'
import { uuidv4 } from './uuid'
import { encryptPassword, decryptPassword } from './crypto'
import type { ConnectionConfig, IpcResponse } from '../shared/types'
import * as db from './services/db'

const store = new Store<{
  connections: ConnectionConfig[]
}>({
  name: 'nexsql-config',
  defaults: {
    connections: []
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

  // ==================== 数据库备份/恢复 ====================

  // 取消标记
  const cancelFlags = new Set<string>()

  ipcMain.handle('db:cancelOperation', (_event, operationId: string) => {
    cancelFlags.add(operationId)
  })

  ipcMain.handle(
    'db:dumpDatabase',
    async (event, config: ConnectionConfig, database: string, options: { tables: string[]; includeData: boolean; includeStructure: boolean }, operationId: string) => {
      try {
        const sql = await db.dumpDatabase(config, database, options,
          (p) => {
            if (cancelFlags.has(operationId)) return
            event.sender.send('db:backupProgress', { operationId, ...p })
          },
          () => cancelFlags.has(operationId)
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
    async (event, config: ConnectionConfig, database: string, sql: string, operationId: string) => {
      try {
        const pool = await db.getPool(config)
        const conn = await pool.getConnection()
        try {
          await conn.changeUser({ database })
          const statements = sql.split(';').map((s) => s.trim()).filter((s) => s && !s.startsWith('--'))
          let executed = 0
          for (let i = 0; i < statements.length; i++) {
            if (cancelFlags.has(operationId)) {
              cancelFlags.delete(operationId)
              return { success: false, error: '已取消' }
            }
            const stmt = statements[i]
            if (stmt.length > 0) {
              await conn.query(stmt)
              executed++
            }
            if ((i + 1) % 10 === 0 || i === statements.length - 1) {
              event.sender.send('db:restoreProgress', { operationId, current: i + 1, total: statements.length })
            }
          }
          return { success: true, data: { executed } }
        } finally {
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
}

export function getStoredConnections(): ConnectionConfig[] {
  return store.get('connections', []).map((c) => ({
    ...c,
    password: decryptPassword(c.password) ?? '',
    sshPassword: decryptPassword(c.sshPassword)
  }))
}
