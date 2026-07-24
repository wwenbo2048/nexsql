import { useState, useEffect, useCallback } from 'react'
import type { MobileConnection } from '../api'
import {
  getDatabases,
  getTables,
  getColumns,
  getDDL,
  getRedisDbSize,
  redisScan,
  getRedisKey,
  executeQuery,
} from '../api'
import type { TableInfo, ColumnInfo, DatabaseInfo, RedisScanResult, RedisKeyDetail, QueryResult } from '../api'

interface Props {
  connection: MobileConnection
  database: string | null
  onDatabaseChange: (db: string | null) => void
  onBack: () => void
}

export default function DatabaseBrowser({ connection, database, onDatabaseChange, onBack }: Props) {
  // Redis 连接
  if (connection.type === 'redis') {
    return <RedisBrowser connection={connection} />
  }

  // MySQL 连接
  return (
    <MySQLBrowser
      connection={connection}
      database={database}
      onDatabaseChange={onDatabaseChange}
      onBack={onBack}
    />
  )
}

// ==================== MySQL 浏览器 ====================

function MySQLBrowser({ connection, database, onDatabaseChange, onBack }: Props) {
  const [databases, setDatabases] = useState<DatabaseInfo[]>([])
  const [showDbPicker, setShowDbPicker] = useState(false)
  const [tables, setTables] = useState<TableInfo[]>([])
  const [selectedTable, setSelectedTable] = useState<string | null>(null)
  const [tab, setTab] = useState<'structure' | 'data' | 'ddl'>('structure')
  const [columns, setColumns] = useState<ColumnInfo[]>([])
  const [ddl, setDdl] = useState<string | null>(null)
  const [tableData, setTableData] = useState<QueryResult | null>(null)
  const [loading, setLoading] = useState(false)

  // 加载数据库列表
  useEffect(() => {
    if (!database) {
      loadDatabases()
    }
  }, [])

  // 数据库变化时加载表
  useEffect(() => {
    if (database) {
      loadTables()
      setSelectedTable(null)
    }
  }, [database])

  const loadDatabases = async () => {
    const res = await getDatabases(connection.id)
    if (res.success && res.data) {
      setDatabases(res.data)
      setShowDbPicker(true)
    }
  }

  const loadTables = async () => {
    if (!database) return
    setLoading(true)
    const res = await getTables(connection.id, database)
    setLoading(false)
    if (res.success && res.data) {
      setTables(res.data)
    }
  }

  // 选中表后加载结构
  useEffect(() => {
    if (selectedTable && database) {
      setTab('structure')
      setColumns([])
      setDdl(null)
      setTableData(null)
      loadColumns()
    }
  }, [selectedTable])

  const loadColumns = async () => {
    if (!selectedTable || !database) return
    const res = await getColumns(connection.id, database, selectedTable)
    if (res.success && res.data) {
      setColumns(res.data)
    }
  }

  const loadDDL = async () => {
    if (!selectedTable || !database || ddl) return
    const res = await getDDL(connection.id, database, selectedTable)
    if (res.success && res.data !== undefined) {
      setDdl(res.data)
    }
  }

  const loadTableData = async () => {
    if (!selectedTable || !database || tableData) return
    setLoading(true)
    const res = await executeQuery(connection.id, `SELECT * FROM \`${selectedTable}\` LIMIT 50`, database)
    setLoading(false)
    if (res.success && res.data) {
      setTableData(res.data)
    }
  }

  const handleTabChange = (t: 'structure' | 'data' | 'ddl') => {
    setTab(t)
    if (t === 'ddl') loadDDL()
    if (t === 'data') loadTableData()
  }

  // 数据库选择器
  if (showDbPicker && !database) {
    return (
      <DatabasePicker
        databases={databases}
        onPick={(db) => {
          onDatabaseChange(db)
          setShowDbPicker(false)
        }}
        onBack={onBack}
      />
    )
  }

  // 没有数据库
  if (!database) {
    return (
      <div className="flex flex-col h-full">
        <Header title={connection.name} onBack={onBack} />
        <div className="flex-1 flex items-center justify-center text-text-muted text-sm">
          {loading ? '加载中...' : '未选择数据库'}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* 数据库切换条 */}
      <div className="flex items-center px-3 py-2 border-b border-border-light bg-bg-secondary">
        <button
          onClick={() => { setShowDbPicker(true); loadDatabases() }}
          className="flex items-center gap-1.5 text-sm"
        >
          <span className="text-text-muted">{connection.name}</span>
          <span className="text-text-muted">›</span>
          <span className="text-accent">{database}</span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-text-muted">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
      </div>

      {/* 表列表 */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-10 text-text-muted text-sm">
            加载中...
          </div>
        ) : tables.length === 0 ? (
          <div className="px-6 py-10 text-center text-sm text-text-muted">
            暂无表
          </div>
        ) : (
          <div className="py-1">
            {tables.map((t) => (
              <button
                key={t.name}
                onClick={() => setSelectedTable(t.name)}
                className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-left transition-colors ${
                  selectedTable === t.name
                    ? 'bg-accent/10'
                    : 'hover:bg-bg-secondary'
                }`}
              >
                <span className="text-text-muted">
                  {t.type === 'view' ? (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="3" y="3" width="18" height="18" rx="2" />
                      <path d="M3 9h18M3 15h18M9 3v18M15 3v18" />
                    </svg>
                  )}
                </span>
                <span className="flex-1 text-sm truncate">{t.name}</span>
                {t.rows !== undefined && (
                  <span className="text-[10px] text-text-muted">{t.rows.toLocaleString()} 行</span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 表详情底部抽屉 */}
      {selectedTable && (
        <TableSheet
          table={selectedTable}
          tab={tab}
          onTabChange={handleTabChange}
          onClose={() => setSelectedTable(null)}
          columns={columns}
          ddl={ddl}
          tableData={tableData}
          loading={loading}
        />
      )}

      {/* 数据库选择器弹层 */}
      {showDbPicker && databases.length > 0 && (
        <DatabasePicker
          databases={databases}
          currentDb={database}
          onPick={(db) => {
            onDatabaseChange(db)
            setShowDbPicker(false)
          }}
          onBack={() => setShowDbPicker(false)}
        />
      )}
    </div>
  )
}

// ==================== 数据库选择器 ====================

function DatabasePicker({
  databases,
  currentDb,
  onPick,
  onBack
}: {
  databases: DatabaseInfo[]
  currentDb?: string
  onPick: (db: string) => void
  onBack: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 bg-bg-primary flex flex-col">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-border-light bg-bg-secondary">
        <button onClick={onBack} className="p-1.5 text-text-muted">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </button>
        <h1 className="text-base font-semibold">选择数据库</h1>
      </header>
      <div className="flex-1 overflow-y-auto py-1">
        {databases.map((db) => (
          <button
            key={db.name}
            onClick={() => onPick(db.name)}
            className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${
              currentDb === db.name ? 'bg-accent/10' : 'hover:bg-bg-secondary'
            }`}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-text-muted">
              <ellipse cx="12" cy="5" rx="9" ry="3" />
              <path d="M3 5v14a9 3 0 0 0 18 0V5" />
              <path d="M3 12a9 3 0 0 0 18 0" />
            </svg>
            <span className="flex-1 text-sm">{db.name}</span>
            {currentDb === db.name && (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2">
                <path d="M20 6L9 17l-5-5" />
              </svg>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}

// ==================== 表详情底部抽屉 ====================

function TableSheet({
  table,
  tab,
  onTabChange,
  onClose,
  columns,
  ddl,
  tableData,
  loading
}: {
  table: string
  tab: 'structure' | 'data' | 'ddl'
  onTabChange: (t: 'structure' | 'data' | 'ddl') => void
  onClose: () => void
  columns: ColumnInfo[]
  ddl: string | null
  tableData: QueryResult | null
  loading: boolean
}) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 bg-bg-secondary border-t border-border-light rounded-t-xl max-h-[70vh] flex flex-col">
      {/* 拖拽指示 */}
      <div className="flex justify-center py-1.5">
        <div className="w-10 h-1 rounded-full bg-border-light" />
      </div>

      {/* 标题 */}
      <div className="flex items-center justify-between px-4 pb-2">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="M3 9h18M3 15h18M9 3v18M15 3v18" />
          </svg>
          {table}
        </h2>
        <button onClick={onClose} className="p-1.5 text-text-muted">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Tab 切换 */}
      <div className="flex items-center gap-1 px-4 pb-2">
        {(['structure', 'data', 'ddl'] as const).map((t) => (
          <button
            key={t}
            onClick={() => onTabChange(t)}
            className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
              tab === t
                ? 'bg-accent/15 text-accent'
                : 'text-text-muted hover:text-text-primary'
            }`}
          >
            {t === 'structure' ? '结构' : t === 'data' ? '数据' : 'DDL'}
          </button>
        ))}
      </div>

      {/* 内容 */}
      <div className="flex-1 overflow-y-auto px-4 pb-4 safe-bottom">
        {tab === 'structure' && (
          <div className="space-y-1">
            {columns.length === 0 ? (
              <div className="text-center py-6 text-xs text-text-muted">加载中...</div>
            ) : (
              columns.map((col) => (
                <div key={col.name} className="flex items-center gap-2 py-2 border-b border-border-light/50">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      {col.isPrimaryKey && (
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="#f59e0b" className="flex-shrink-0">
                          <circle cx="8" cy="16" r="5" />
                          <path d="M11 14l9-9M16 9l3 3" stroke="#f59e0b" strokeWidth="2" fill="none" />
                        </svg>
                      )}
                      <span className="text-xs font-medium text-text-primary">{col.name}</span>
                    </div>
                  </div>
                  <span className="text-[10px] text-text-muted font-mono">{col.type}</span>
                  {!col.nullable && (
                    <span className="text-[9px] text-red-400 px-1 py-0.5 bg-red-500/10 rounded">NOT NULL</span>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {tab === 'data' && (
          <div>
            {loading ? (
              <div className="text-center py-6 text-xs text-text-muted">查询中...</div>
            ) : tableData ? (
              <DataTableView result={tableData} />
            ) : (
              <div className="text-center py-6 text-xs text-text-muted">加载中...</div>
            )}
          </div>
        )}

        {tab === 'ddl' && (
          <pre className="text-[11px] text-text-secondary font-mono whitespace-pre-wrap break-all bg-bg-primary p-3 rounded-lg">
            {ddl ?? '加载中...'}
          </pre>
        )}
      </div>
    </div>
  )
}

// ==================== 数据表格视图 ====================

function DataTableView({ result }: { result: QueryResult }) {
  if (result.rows.length === 0) {
    return (
      <div className="text-center py-6 text-xs text-text-muted">
        无数据（受影响行数: {result.affectedRows}）
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="text-[11px]">
        <thead>
          <tr className="border-b border-border-light">
            {result.columns.map((col) => (
              <th key={col.name} className="text-left px-2 py-1.5 text-text-muted font-medium whitespace-nowrap">
                {col.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.rows.map((row, i) => (
            <tr key={i} className="border-b border-border-light/30">
              {result.columns.map((col) => (
                <td key={col.name} className="px-2 py-1.5 text-text-secondary whitespace-nowrap max-w-[200px] truncate">
                  {row[col.name] === null ? (
                    <span className="text-text-muted italic">NULL</span>
                  ) : (
                    String(row[col.name])
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="text-[10px] text-text-muted mt-2 pb-2">
        显示 {result.rows.length} 行 · 耗时 {result.duration}ms
      </div>
    </div>
  )
}

// ==================== Redis 浏览器 ====================

function RedisBrowser({ connection }: { connection: MobileConnection }) {
  const [dbSize, setDbSize] = useState<number | null>(null)
  const [pattern, setPattern] = useState('*')
  const [scanResult, setScanResult] = useState<RedisScanResult | null>(null)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [keyDetail, setKeyDetail] = useState<RedisKeyDetail | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    loadDbSize()
    handleScan()
  }, [])

  const loadDbSize = async () => {
    const res = await getRedisDbSize(connection.id)
    if (res.success && res.data !== undefined) {
      setDbSize(res.data)
    }
  }

  const handleScan = async () => {
    setLoading(true)
    const res = await redisScan(connection.id, pattern || '*', 0)
    setLoading(false)
    if (res.success && res.data) {
      setScanResult(res.data)
    }
  }

  const handleSelectKey = async (key: string) => {
    setSelectedKey(key)
    setKeyDetail(null)
    const res = await getRedisKey(connection.id, key)
    if (res.success && res.data) {
      setKeyDetail(res.data)
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* 头部 */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-border-light bg-bg-secondary">
        <div className="flex items-center gap-2">
          <h1 className="text-sm font-semibold">{connection.name}</h1>
          {dbSize !== null && (
            <span className="text-[10px] text-text-muted px-1.5 py-0.5 bg-bg-tertiary rounded">
              {dbSize.toLocaleString()} keys
            </span>
          )}
        </div>
      </header>

      {/* 搜索 */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border-light">
        <input
          type="text"
          value={pattern}
          onChange={(e) => setPattern(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleScan()}
          placeholder="SCAN 模式（如 user:*）"
          className="flex-1 px-3 py-2 bg-bg-secondary border border-border-light rounded-lg text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
        />
        <button
          onClick={handleScan}
          disabled={loading}
          className="px-3 py-2 bg-accent/15 text-accent text-xs rounded-lg disabled:opacity-50"
        >
          扫描
        </button>
      </div>

      {/* Key 列表 */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-10 text-text-muted text-sm">
            扫描中...
          </div>
        ) : scanResult && scanResult.keys.length > 0 ? (
          <div className="py-1">
            {scanResult.keys.map((keyInfo) => (
              <button
                key={keyInfo.key}
                onClick={() => handleSelectKey(keyInfo.key)}
                className={`w-full flex items-center gap-2 px-4 py-2.5 text-left transition-colors ${
                  selectedKey === keyInfo.key
                    ? 'bg-accent/10'
                    : 'hover:bg-bg-secondary'
                }`}
              >
                <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${
                  keyInfo.type === 'string' ? 'bg-green-500/15 text-green-400'
                  : keyInfo.type === 'hash' ? 'bg-blue-500/15 text-blue-400'
                  : keyInfo.type === 'list' ? 'bg-yellow-500/15 text-yellow-400'
                  : keyInfo.type === 'set' ? 'bg-purple-500/15 text-purple-400'
                  : 'bg-gray-500/15 text-gray-400'
                }`}>
                  {keyInfo.type}
                </span>
                <span className="flex-1 text-xs truncate">{keyInfo.key}</span>
                {keyInfo.ttl > 0 && (
                  <span className="text-[9px] text-text-muted">{keyInfo.ttl}s</span>
                )}
              </button>
            ))}
          </div>
        ) : (
          <div className="px-6 py-10 text-center text-sm text-text-muted">
            无匹配 Key
          </div>
        )}
      </div>

      {/* Key 详情底部抽屉 */}
      {selectedKey && (
        <RedisKeySheet
          keyName={selectedKey}
          detail={keyDetail}
          onClose={() => setSelectedKey(null)}
        />
      )}
    </div>
  )
}

// ==================== Redis Key 详情抽屉 ====================

function RedisKeySheet({
  keyName,
  detail,
  onClose
}: {
  keyName: string
  detail: RedisKeyDetail | null
  onClose: () => void
}) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 bg-bg-secondary border-t border-border-light rounded-t-xl max-h-[60vh] flex flex-col">
      {/* 拖拽指示 */}
      <div className="flex justify-center py-1.5">
        <div className="w-10 h-1 rounded-full bg-border-light" />
      </div>

      {/* 标题 */}
      <div className="flex items-center justify-between px-4 pb-2">
        <h2 className="text-sm font-semibold flex-1 truncate">{keyName}</h2>
        <button onClick={onClose} className="p-1.5 text-text-muted flex-shrink-0">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* 内容 */}
      <div className="flex-1 overflow-y-auto px-4 pb-4 safe-bottom">
        {!detail ? (
          <div className="text-center py-6 text-xs text-text-muted">加载中...</div>
        ) : (
          <>
            <div className="flex items-center gap-2 mb-3 text-[10px]">
              {detail.type !== 'none' && (
                <span className="px-1.5 py-0.5 bg-accent/15 text-accent rounded">{detail.type}</span>
              )}
              <span className="text-text-muted">
                TTL: {detail.ttl === -1 ? '永久' : detail.ttl === -2 ? '不存在' : `${detail.ttl}s`}
              </span>
            </div>

            {detail.members && detail.members.length > 0 ? (
              <div className="space-y-1">
                {detail.members.map((m, i) => (
                  <div key={i} className="bg-bg-primary rounded p-2">
                    <div className="text-[10px] text-accent font-mono mb-0.5">{m.field}</div>
                    <div className="text-xs text-text-secondary break-all">{m.value}</div>
                  </div>
                ))}
              </div>
            ) : (
              <pre className="text-xs text-text-secondary font-mono whitespace-pre-wrap break-all bg-bg-primary p-3 rounded-lg">
                {detail.value}
              </pre>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ==================== 通用头部 ====================

function Header({ title, onBack }: { title: string; onBack?: () => void }) {
  return (
    <header className="flex items-center gap-2 px-4 py-3 border-b border-border-light bg-bg-secondary">
      {onBack && (
        <button onClick={onBack} className="p-1.5 text-text-muted">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </button>
      )}
      <h1 className="text-base font-semibold">{title}</h1>
    </header>
  )
}
