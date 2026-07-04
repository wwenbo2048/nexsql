import { contextBridge, ipcRenderer } from 'electron'
import type {
  ConnectionConfig,
  DatabaseInfo,
  TableInfo,
  ColumnInfo,
  IndexInfo,
  ForeignKeyInfo,
  TriggerInfo,
  TableOptions,
  TableDetails,
  ViewInfo,
  RoutineInfo,
  EventInfo,
  QueryResult,
  IpcResponse,
  RedisKeyInfo,
  RedisKeyValue,
  ServerStatusData
} from '../shared/types'

// ==================== API 接口定义 ====================

const api = {
  // 应用信息
  appVersion: (() => {
    const arg = process.argv.find(a => a.startsWith('--app-version='))
    return arg ? arg.split('=')[1] : 'dev'
  })(),
  platform: process.platform,

  // 配置管理
  config: {
    getConnections: (): Promise<ConnectionConfig[]> =>
      ipcRenderer.invoke('config:getConnections'),
    saveConnection: (config: ConnectionConfig): Promise<ConnectionConfig> =>
      ipcRenderer.invoke('config:saveConnection', config),
    deleteConnection: (id: string): Promise<boolean> =>
      ipcRenderer.invoke('config:deleteConnection', id)
  },

  // 数据库操作
  db: {
    testConnection: (config: ConnectionConfig): Promise<IpcResponse> =>
      ipcRenderer.invoke('db:testConnection', config),
    connect: (config: ConnectionConfig): Promise<IpcResponse> =>
      ipcRenderer.invoke('db:connect', config),
    disconnect: (configId: string): Promise<IpcResponse> =>
      ipcRenderer.invoke('db:disconnect', configId),
    query: (config: ConnectionConfig, sql: string, database?: string): Promise<IpcResponse<QueryResult>> =>
      ipcRenderer.invoke('db:query', config, sql, database),
    executeBatch: (config: ConnectionConfig, statements: string[], database?: string): Promise<IpcResponse> =>
      ipcRenderer.invoke('db:executeBatch', config, statements, database),
    onBatchProgress: (callback: (data: { index: number; total: number; result: any }) => void) => {
      const handler = (_event: any, data: any) => callback(data)
      ipcRenderer.on('db:batchProgress', handler)
      return () => { ipcRenderer.removeListener('db:batchProgress', handler) }
    },
    getDatabases: (config: ConnectionConfig): Promise<IpcResponse<DatabaseInfo[]>> =>
      ipcRenderer.invoke('db:getDatabases', config),
    getTables: (config: ConnectionConfig, database: string): Promise<IpcResponse<TableInfo[]>> =>
      ipcRenderer.invoke('db:getTables', config, database),
    getTableColumns: (config: ConnectionConfig, database: string, table: string): Promise<IpcResponse<ColumnInfo[]>> =>
      ipcRenderer.invoke('db:getTableColumns', config, database, table),
    getTableIndexes: (config: ConnectionConfig, database: string, table: string): Promise<IpcResponse<IndexInfo[]>> =>
      ipcRenderer.invoke('db:getTableIndexes', config, database, table),
    getTableRowCount: (config: ConnectionConfig, database: string, table: string): Promise<IpcResponse<number>> =>
      ipcRenderer.invoke('db:getTableRowCount', config, database, table),
    getTableDDL: (config: ConnectionConfig, database: string, table: string): Promise<IpcResponse<string>> =>
      ipcRenderer.invoke('db:getTableDDL', config, database, table),
    getForeignKeys: (config: ConnectionConfig, database: string, table: string): Promise<IpcResponse<ForeignKeyInfo[]>> =>
      ipcRenderer.invoke('db:getForeignKeys', config, database, table),
    getTableTriggers: (config: ConnectionConfig, database: string, table: string): Promise<IpcResponse<TriggerInfo[]>> =>
      ipcRenderer.invoke('db:getTableTriggers', config, database, table),
    getTableOptions: (config: ConnectionConfig, database: string, table: string): Promise<IpcResponse<TableOptions>> =>
      ipcRenderer.invoke('db:getTableOptions', config, database, table),
    getTableDetails: (config: ConnectionConfig, database: string, table: string): Promise<IpcResponse<TableDetails>> =>
      ipcRenderer.invoke('db:getTableDetails', config, database, table),
    getViews: (config: ConnectionConfig, database: string): Promise<IpcResponse<ViewInfo[]>> =>
      ipcRenderer.invoke('db:getViews', config, database),
    getRoutines: (config: ConnectionConfig, database: string): Promise<IpcResponse<RoutineInfo[]>> =>
      ipcRenderer.invoke('db:getRoutines', config, database),
    getEvents: (config: ConnectionConfig, database: string): Promise<IpcResponse<EventInfo[]>> =>
      ipcRenderer.invoke('db:getEvents', config, database),
    getERRelations: (config: ConnectionConfig, database: string): Promise<IpcResponse> =>
      ipcRenderer.invoke('db:getERRelations', config, database),
    getERTableColumns: (config: ConnectionConfig, database: string): Promise<IpcResponse> =>
      ipcRenderer.invoke('db:getERTableColumns', config, database),
    getServerStatus: (config: ConnectionConfig): Promise<IpcResponse<ServerStatusData>> =>
      ipcRenderer.invoke('db:getServerStatus', config),
    dumpDatabase: (config: ConnectionConfig, database: string, options: { tables: string[]; includeData: boolean; includeStructure: boolean }, operationId: string, filePath?: string): Promise<IpcResponse<string>> =>
      ipcRenderer.invoke('db:dumpDatabase', config, database, options, operationId, filePath),
    restoreDatabase: (config: ConnectionConfig, database: string, sqlOrPath: string, operationId: string): Promise<IpcResponse<{ executed: number }>> =>
      ipcRenderer.invoke('db:restoreDatabase', config, database, sqlOrPath, operationId),
    cancelOperation: (operationId: string): Promise<void> =>
      ipcRenderer.invoke('db:cancelOperation', operationId),
    onBackupProgress: (callback: (data: { operationId: string; current: string; index: number; total: number }) => void) => {
      const handler = (_event: any, data: any) => callback(data)
      ipcRenderer.on('db:backupProgress', handler)
      return () => { ipcRenderer.removeListener('db:backupProgress', handler) }
    },
    onRestoreProgress: (callback: (data: { operationId: string; current: number; total: number; executed?: number }) => void) => {
      const handler = (_event: any, data: any) => callback(data)
      ipcRenderer.on('db:restoreProgress', handler)
      return () => { ipcRenderer.removeListener('db:restoreProgress', handler) }
    }
  },

  // 文件操作
  file: {
    saveDialog: (defaultName: string, content: string, filterExt?: string): Promise<IpcResponse<{ saved: boolean; path?: string }>> =>
      ipcRenderer.invoke('file:saveDialog', defaultName, content, filterExt),
    savePathDialog: (defaultName: string, filterExt?: string): Promise<IpcResponse<{ saved: boolean; path?: string }>> =>
      ipcRenderer.invoke('file:savePathDialog', defaultName, filterExt),
    writeToFile: (filePath: string, content: string): Promise<IpcResponse<boolean>> =>
      ipcRenderer.invoke('file:writeToFile', filePath, content),
    openDialog: (filterExt?: string): Promise<IpcResponse<{ canceled: boolean; content: string; path?: string }>> =>
      ipcRenderer.invoke('file:openDialog', filterExt)
  },

  // AI 自然语言生成 SQL
  ai: {
    getSettings: (): Promise<{ apiKey: string; model: string }> =>
      ipcRenderer.invoke('ai:getSettings'),
    setSettings: (settings: { apiKey: string; model: string }): Promise<boolean> =>
      ipcRenderer.invoke('ai:setSettings', settings),
    validateApiKey: (apiKey: string, model?: string): Promise<{ success: boolean; data?: boolean; error?: string }> =>
      ipcRenderer.invoke('ai:validateApiKey', apiKey, model),
    generateSql: (
      params: { requestId: string; prompt: string; config?: any; database?: string; existingSql?: string }
    ): Promise<{ success: boolean; data?: string; error?: string }> =>
      ipcRenderer.invoke('ai:generateSql', params),
    cancelGenerate: (requestId: string): Promise<void> =>
      ipcRenderer.invoke('ai:cancelGenerate', requestId),
    onStreamChunk: (callback: (data: { requestId: string; chunk: string }) => void) => {
      const handler = (_event: any, data: any) => callback(data)
      ipcRenderer.on('ai:streamChunk', handler)
      return () => { ipcRenderer.removeListener('ai:streamChunk', handler) }
    },
    // 对话持久化
    getConversations: (): Promise<{ id: string; title: string; database?: string; createdAt: number; updatedAt: number }[]> =>
      ipcRenderer.invoke('ai:getConversations'),
    getConversation: (id: string): Promise<{ id: string; title: string; messages: any[]; database?: string; createdAt: number; updatedAt: number } | null> =>
      ipcRenderer.invoke('ai:getConversation', id),
    createConversation: (database?: string): Promise<{ id: string; title: string; messages: any[]; database?: string; createdAt: number; updatedAt: number }> =>
      ipcRenderer.invoke('ai:createConversation', database),
    saveConversation: (conv: { id: string; title: string; messages: any[]; database?: string; createdAt: number; updatedAt: number }): Promise<boolean> =>
      ipcRenderer.invoke('ai:saveConversation', conv),
    deleteConversation: (id: string): Promise<boolean> =>
      ipcRenderer.invoke('ai:deleteConversation', id),
    clearConversations: (): Promise<boolean> =>
      ipcRenderer.invoke('ai:clearConversations')
  },

  // 应用缓存管理
  cache: {
    clearCache: (): Promise<boolean> =>
      ipcRenderer.invoke('app:clearCache')
  },

  // Redis 操作
  redis: {
    testConnection: (config: ConnectionConfig): Promise<IpcResponse> =>
      ipcRenderer.invoke('redis:testConnection', config),
    connect: (config: ConnectionConfig): Promise<IpcResponse> =>
      ipcRenderer.invoke('redis:connect', config),
    disconnect: (configId: string): Promise<IpcResponse> =>
      ipcRenderer.invoke('redis:disconnect', configId),
    dbsize: (config: ConnectionConfig): Promise<IpcResponse<number>> =>
      ipcRenderer.invoke('redis:dbsize', config),
    scan: (config: ConnectionConfig, pattern: string, cursor: number, count?: number): Promise<IpcResponse<{ cursor: number; keys: RedisKeyInfo[] }>> =>
      ipcRenderer.invoke('redis:scan', config, pattern, cursor, count),
    getKey: (config: ConnectionConfig, key: string): Promise<IpcResponse<RedisKeyValue>> =>
      ipcRenderer.invoke('redis:getKey', config, key),
    setKey: (config: ConnectionConfig, key: string, type: string, value: string, ttl?: number): Promise<IpcResponse> =>
      ipcRenderer.invoke('redis:setKey', config, key, type, value, ttl),
    deleteKey: (config: ConnectionConfig, key: string): Promise<IpcResponse> =>
      ipcRenderer.invoke('redis:deleteKey', config, key),
    setTtl: (config: ConnectionConfig, key: string, ttl: number): Promise<IpcResponse> =>
      ipcRenderer.invoke('redis:setTtl', config, key, ttl),
    rename: (config: ConnectionConfig, oldKey: string, newKey: string): Promise<IpcResponse> =>
      ipcRenderer.invoke('redis:rename', config, oldKey, newKey),
    command: (config: ConnectionConfig, command: string[]): Promise<IpcResponse> =>
      ipcRenderer.invoke('redis:command', config, command)
  }
}

export type Api = typeof api

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore - 在非 contextIsolated 环境直接挂载
  window.api = api
}
