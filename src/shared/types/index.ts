// ==================== 连接相关类型 ====================

export interface ConnectionConfig {
  id: string
  name: string
  group?: string
  tags?: string[]
  type: 'mysql'
  host: string
  port: number
  user: string
  password: string
  database?: string
  color?: string
  sshEnabled?: boolean
  sshHost?: string
  sshPort?: number
  sshUser?: string
  sshPassword?: string
  sshPrivateKey?: string
  sslEnabled?: boolean
  connectTimeout?: number
}

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

export interface ConnectionInfo {
  config: ConnectionConfig
  status: ConnectionStatus
  error?: string
}

// ==================== 数据库元数据类型 ====================

export interface DatabaseInfo {
  name: string
  charset?: string
  collation?: string
}

export interface TableInfo {
  name: string
  type: 'table' | 'view'
  engine?: string
  rows?: number
  dataSize?: number
  comment?: string
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

export interface IndexInfo {
  name: string
  column: string
  isUnique: boolean
  type: string
}

export interface ForeignKeyInfo {
  name: string
  columnName: string
  referencedTable: string
  referencedColumnName: string
  onUpdate: string
  onDelete: string
}

export interface TriggerInfo {
  name: string
  event: 'INSERT' | 'UPDATE' | 'DELETE'
  timing: 'BEFORE' | 'AFTER'
  statement: string
  created?: string
  definer?: string
}

export interface TableOptions {
  engine?: string
  charset?: string
  collation?: string
  comment?: string
  autoIncrement?: number
  rowFormat?: string
}

export interface TableDetails {
  name: string
  rows: number
  dataSize: number
  indexLength: number
  engine: string
  createTime: string | null
  updateTime: string | null
  collation: string | null
  rowFormat: string | null
  autoIncrement: number | null
  comment: string | null
}

export interface TableSchema {
  columns: ColumnInfo[]
  indexes: IndexInfo[]
}

// ==================== 视图/函数/事件类型 ====================

export interface ViewInfo {
  name: string
  definition?: string
  checkOption?: string
  updatable?: boolean
  security?: string
  comment?: string
  definer?: string
}

export interface RoutineInfo {
  name: string
  type: 'FUNCTION' | 'PROCEDURE'
  returnType?: string
  definer?: string
  modified?: string
  created?: string
  comment?: string
  deterministic?: boolean
  security?: string
  body?: string
}

export interface EventInfo {
  name: string
  definer?: string
  type?: string
  status?: string
  starts?: string | null
  ends?: string | null
  lastExecuted?: string | null
  onCompletion?: string
  comment?: string
  body?: string
}

// ==================== 查询结果类型 ====================

export interface QueryResultColumn {
  name: string
  type: string
  nullable: boolean
}

export interface QueryResult {
  columns: QueryResultColumn[]
  rows: Record<string, unknown>[]
  affectedRows: number
  insertId?: number
  changedRows?: number
  duration: number
  warning?: string
}

export interface QueryHistory {
  id: string
  sql: string
  connectionId: string
  database?: string
  executedAt: number
  duration: number
  rowCount?: number
  hasError: boolean
  error?: string
}

// ==================== IPC 通信类型 ====================

export interface IpcResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

// ==================== Tab 类型 ====================

export type TabType = 'browser' | 'query' | 'table-data' | 'table-design' | 'er' | 'view' | 'routine' | 'event' | 'snippet'

export interface Tab {
  id: string
  type: TabType
  title: string
  connectionId: string
  database?: string
  table?: string
  icon?: string
  dirty?: boolean
  sql?: string
  savedQueryId?: string
}
