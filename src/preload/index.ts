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
  IpcResponse
} from '../shared/types'

// ==================== API 接口定义 ====================

const api = {
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
    dumpDatabase: (config: ConnectionConfig, database: string, options: { tables: string[]; includeData: boolean; includeStructure: boolean }): Promise<IpcResponse<string>> =>
      ipcRenderer.invoke('db:dumpDatabase', config, database, options),
    restoreDatabase: (config: ConnectionConfig, database: string, sql: string): Promise<IpcResponse<{ executed: number }>> =>
      ipcRenderer.invoke('db:restoreDatabase', config, database, sql)
  },

  // 文件操作
  file: {
    saveDialog: (defaultName: string, content: string, filterExt?: string): Promise<IpcResponse<{ saved: boolean; path?: string }>> =>
      ipcRenderer.invoke('file:saveDialog', defaultName, content, filterExt),
    openDialog: (filterExt?: string): Promise<IpcResponse<{ canceled: boolean; content: string; path?: string }>> =>
      ipcRenderer.invoke('file:openDialog', filterExt)
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
