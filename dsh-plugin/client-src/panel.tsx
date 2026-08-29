/**
 * nexSql 数据库面板：全屏 overlay（shell.overlay）+ 侧边栏开关按钮
 * （sidebar.footer.action）。树形浏览 MySQL 库/表，数据分页表格，
 * SQL 快速执行，Redis 键浏览。数据全部来自 Host 的 /nexsql/* 路由。
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import {
  api,
  displayValue,
  ensureStyles,
  panelUi,
  type PanelConnection,
  type PanelTable,
} from './ui'

// ==================== 通用小件 ====================

function DbIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <ellipse cx="12" cy="5" rx="8" ry="3" />
      <path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5" />
      <path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
    </svg>
  )
}

function Loading(): React.JSX.Element {
  return <div className="nxp-loading">载入中…</div>
}

function ErrorBox({ error, onRetry }: { error: string; onRetry?: () => void }): React.JSX.Element {
  return (
    <div className="nxp-error">
      {error}
      {onRetry ? (
        <>
          {' '}
          <button type="button" className="nxp-iconbutton" onClick={onRetry}>
            重试
          </button>
        </>
      ) : null}
    </div>
  )
}

/** 通用数据表格：sticky 表头 + 横向滚动。 */
function DataGrid({ table }: { table: PanelTable }): React.JSX.Element {
  if (table.rows.length === 0) {
    return <div className="nxp-empty">无数据</div>
  }
  return (
    <div className="nxp-grid-wrap">
      <table className="nxp-grid">
        <thead>
          <tr>
            {table.columns.map((column, i) => (
              <th key={i}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j} title={displayValue(cell)}>
                  {displayValue(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ==================== 选择模型 ====================

interface Selection {
  kind: 'table' | 'redis'
  connection: PanelConnection
  database?: string
  table?: string
}

// ==================== 侧边栏按钮 ====================

/** settings.section 槽位组件：设置左栏一级分区「nexSql 数据库」的内容页。 */
export function NexsqlSettingsSection(): React.JSX.Element {
  ensureStyles()
  return (
    <div className="nxp-settings">
      <div className="nxp-settings-icon"><DbIcon /></div>
      <div className="nxp-settings-title">nexSql 数据库</div>
      <div className="nxp-settings-desc">
        与桌面应用同一套完整界面：连接管理、库表浏览、数据编辑、
        SQL 查询（Monaco 编辑器）、表/视图设计器、ER 图、Redis 键浏览。
        连接与桌面应用共用同一份配置。
      </div>
      <button type="button" className="nxp-settings-open" onClick={() => panelUi.setOpen(true)}>
        打开数据库面板
      </button>
      <div className="nxp-settings-hint">面板全屏打开，按 Esc 或右上角 ✕ 关闭；随时从这里再次打开。</div>
    </div>
  )
}

// ==================== 侧栏树 ====================

/** 连接 → 数据库 → 表 的懒加载树。 */
function Sidebar(props: {
  connections: PanelConnection[]
  loading: boolean
  error: string | null
  selection: Selection | null
  onSelect: (selection: Selection | null) => void
  onReload: () => void
}): React.JSX.Element {
  const { connections, loading, error, selection, onSelect, onReload } = props
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const [databases, setDatabases] = useState<Record<string, PanelTable | { error: string }>>({})
  const [tables, setTables] = useState<Record<string, PanelTable | { error: string }>>({})

  const toggleExpanded = useCallback((connectionId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(connectionId)) {
        next.delete(connectionId)
      } else {
        next.add(connectionId)
      }
      return next
    })
  }, [])

  const expandConnection = useCallback((connection: PanelConnection) => {
    toggleExpanded(connection.id)
    if (connection.type === 'redis') {
      onSelect({ kind: 'redis', connection })
      return
    }
    if (!databases[connection.id]) {
      api
        .databases(connection.id)
        .then((table) => setDatabases((prev) => ({ ...prev, [connection.id]: table })))
        .catch((err: Error) =>
          setDatabases((prev) => ({ ...prev, [connection.id]: { error: err.message } }))
        )
    }
  }, [databases, onSelect, toggleExpanded])

  const expandDatabase = useCallback((connection: PanelConnection, database: string) => {
    const cacheKey = `${connection.id}/${database}`
    if (!tables[cacheKey]) {
      api
        .tables(connection.id, database)
        .then((table) => setTables((prev) => ({ ...prev, [cacheKey]: table })))
        .catch((err: Error) => setTables((prev) => ({ ...prev, [cacheKey]: { error: err.message } })))
    }
  }, [tables])

  if (loading) return <Loading />
  if (error) return <ErrorBox error={error} onRetry={onReload} />

  return (
    <div>
      {connections.map((connection) => {
        const isOpen = expanded.has(connection.id)
        const dbTable = databases[connection.id]
        const selected = selection?.connection.id === connection.id
        return (
          <div key={connection.id}>
            <div
              className={selected ? 'nxp-conn nxp-conn-selected' : 'nxp-conn'}
              onClick={() => expandConnection(connection)}
              title={`${connection.name} (${connection.host}:${connection.port})`}
            >
              <span className="nxp-tree-arrow">{connection.type === 'mysql' ? (isOpen ? '▾' : '▸') : '•'}</span>
              <span className={`nxp-conn-type nxp-type-${connection.type}`}>
                {connection.type === 'mysql' ? 'MySQL' : 'Redis'}
              </span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{connection.name}</span>
            </div>
            {isOpen && connection.type === 'mysql' ? (
              <div>
                {dbTable === undefined ? (
                  <div className="nxp-loading">载入中…</div>
                ) : 'error' in dbTable ? (
                  <div className="nxp-error">{dbTable.error}</div>
                ) : (
                  dbTable.rows.map((row) => {
                    const database = String(row[0])
                    const cacheKey = `${connection.id}/${database}`
                    const tableList = tables[cacheKey]
                    const dbOpen = expanded.has(cacheKey)
                    return (
                      <div key={database}>
                        <div
                          className="nxp-tree-row"
                          style={{ paddingLeft: 26 }}
                          onClick={() => {
                            toggleExpanded(cacheKey)
                            expandDatabase(connection, database)
                          }}
                        >
                          <span className="nxp-tree-arrow">{dbOpen ? '▾' : '▸'}</span>
                          <span style={{ color: dbOpen ? '#e8eaf0' : undefined }}>{database}</span>
                        </div>
                        {dbOpen ? (
                          tableList === undefined ? (
                            <div className="nxp-loading">载入中…</div>
                          ) : 'error' in tableList ? (
                            <div className="nxp-error">{tableList.error}</div>
                          ) : (
                            tableList.rows.map((trow) => {
                              const tableName = String(trow[0])
                              const tableType = String(trow[1])
                              const isSelected =
                                selection?.kind === 'table' &&
                                selection.connection.id === connection.id &&
                                selection.database === database &&
                                selection.table === tableName
                              return (
                                <div
                                  key={tableName}
                                  className={
                                    isSelected ? 'nxp-tree-row nxp-tree-table nxp-tree-row-selected' : 'nxp-tree-row nxp-tree-table'
                                  }
                                  title={tableType === 'VIEW' ? '视图' : `表 · ${String(trow[4] ?? '')}`}
                                  onClick={() =>
                                    onSelect({ kind: 'table', connection, database, table: tableName })
                                  }
                                >
                                  <span className="nxp-tree-arrow">{tableType === 'VIEW' ? '◉' : '▫'}</span>
                                  <span>{tableName}</span>
                                </div>
                              )
                            })
                          )
                        ) : null}
                      </div>
                    )
                  })
                )}
              </div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

// ==================== MySQL：表数据 ====================

const PAGE_SIZE = 50

function TableDataView(props: { connection: PanelConnection; database: string; table: string }): React.JSX.Element {
  const { connection, database, table } = props
  const [data, setData] = useState<PanelTable | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [offset, setOffset] = useState(0)
  const [whereInput, setWhereInput] = useState('')
  const [where, setWhere] = useState('')

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    api
      .data(connection.id, database, table, PAGE_SIZE, offset, where || undefined)
      .then((result) => {
        setData(result)
        setLoading(false)
      })
      .catch((err: Error) => {
        setError(err.message)
        setLoading(false)
      })
  }, [connection.id, database, table, offset, where])

  useEffect(() => {
    load()
  }, [load])

  return (
    <div>
      <div className="nxp-toolbar">
        <input
          className="nxp-input"
          style={{ width: 320 }}
          placeholder="WHERE 条件（如 id > 100 AND status = 1）"
          value={whereInput}
          onChange={(event) => setWhereInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              setOffset(0)
              setWhere(whereInput.trim())
            }
          }}
        />
        <button
          type="button"
          className="nxp-button"
          onClick={() => {
            setOffset(0)
            setWhere(whereInput.trim())
          }}
        >
          筛选
        </button>
        <button type="button" className="nxp-button" onClick={load}>
          刷新
        </button>
        <span className="nxp-header-space" />
        <span className="nxp-meta">
          {data ? `${data.rows.length} 行` : ''} · 第 ${offset + 1} 行起
        </span>
        <button type="button" className="nxp-button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
          上一页
        </button>
        <button
          type="button"
          className="nxp-button"
          disabled={!data || data.rows.length < PAGE_SIZE}
          onClick={() => setOffset(offset + PAGE_SIZE)}
        >
          下一页
        </button>
      </div>
      {error ? <ErrorBox error={error} onRetry={load} /> : null}
      {loading ? <Loading /> : data ? <DataGrid table={data} /> : null}
    </div>
  )
}

// ==================== MySQL：表结构 ====================

function ColumnsView(props: { connection: PanelConnection; database: string; table: string }): React.JSX.Element {
  const { connection, database, table } = props
  const [data, setData] = useState<PanelTable | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    setError(null)
    api
      .columns(connection.id, database, table)
      .then(setData)
      .catch((err: Error) => setError(err.message))
  }, [connection.id, database, table])

  useEffect(() => {
    load()
  }, [load])

  if (error) return <ErrorBox error={error} onRetry={load} />
  if (!data) return <Loading />
  return <DataGrid table={data} />
}

// ==================== MySQL：SQL 执行 ====================

function QueryView(props: { connection: PanelConnection; database: string }): React.JSX.Element {
  const { connection, database } = props
  const [sql, setSql] = useState('SELECT 1')
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ table?: PanelTable; affected?: number; insertId?: number; changed?: number; durationMs: number } | null>(null)

  const run = useCallback(() => {
    setRunning(true)
    setError(null)
    api
      .query(connection.id, sql, database)
      .then((r) => {
        setResult(r)
        setRunning(false)
      })
      .catch((err: Error) => {
        setError(err.message)
        setRunning(false)
      })
  }, [connection.id, sql, database])

  return (
    <div>
      <textarea
        className="nxp-input nxp-sql"
        value={sql}
        spellCheck={false}
        placeholder="输入 SQL（Enter+Ctrl 运行）"
        onChange={(event) => setSql(event.target.value)}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault()
            run()
          }
        }}
      />
      <div className="nxp-toolbar" style={{ paddingTop: 10 }}>
        <button type="button" className="nxp-button" disabled={running || sql.trim() === ''} onClick={run}>
          {running ? '执行中…' : '运行 (⌘↵)'}
        </button>
        {result ? (
          <span className="nxp-meta">
            {result.table
              ? `${result.table.rows.length} 行 · ${result.durationMs.toFixed(1)}ms`
              : `影响 ${result.affected ?? 0} 行${result.insertId ? ` · insertId ${result.insertId}` : ''} · ${result.durationMs.toFixed(1)}ms`}
          </span>
        ) : null}
      </div>
      {error ? <ErrorBox error={error} /> : null}
      {result?.table ? <DataGrid table={result.table} /> : null}
    </div>
  )
}

// ==================== Redis 浏览 ====================

function RedisView(props: { connection: PanelConnection }): React.JSX.Element {
  const { connection } = props
  const [pattern, setPattern] = useState('*')
  const [count, setCount] = useState(100)
  const [keys, setKeys] = useState<{ key: string; type: string; ttl: number }[] | null>(null)
  const [maybeMore, setMaybeMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [detail, setDetail] = useState<{ key: string; type: string; ttl: number; value: string } | null>(null)
  const [detailError, setDetailError] = useState<string | null>(null)

  const scan = useCallback(() => {
    setLoading(true)
    setError(null)
    api
      .redisKeys(connection.id, pattern, count)
      .then((r) => {
        setKeys(r.keys)
        setMaybeMore(r.maybeMore)
        setLoading(false)
      })
      .catch((err: Error) => {
        setError(err.message)
        setLoading(false)
      })
  }, [connection.id, pattern, count])

  useEffect(() => {
    scan()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const openKey = useCallback((key: string) => {
    setDetailError(null)
    api
      .redisKey(connection.id, key)
      .then(setDetail)
      .catch((err: Error) => setDetailError(err.message))
  }, [connection.id])

  return (
    <div>
      <div className="nxp-toolbar">
        <input
          className="nxp-input"
          style={{ width: 280 }}
          value={pattern}
          placeholder="键模式（如 user:*）"
          onChange={(event) => setPattern(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') scan()
          }}
        />
        <input
          className="nxp-input"
          style={{ width: 70 }}
          type="number"
          min={1}
          max={500}
          value={count}
          onChange={(event) => setCount(Number(event.target.value) || 100)}
        />
        <button type="button" className="nxp-button" onClick={scan}>
          SCAN
        </button>
        {keys ? (
          <span className="nxp-meta">
            {keys.length} 个键{maybeMore ? '（可能更多）' : ''}
          </span>
        ) : null}
      </div>
      {error ? <ErrorBox error={error} onRetry={scan} /> : null}
      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
        <div style={{ width: 380, minWidth: 0 }}>
          {loading ? (
            <Loading />
          ) : keys && keys.length > 0 ? (
            <div className="nxp-grid-wrap" style={{ maxHeight: 'calc(100vh - 250px)' }}>
              {keys.map((entry) => (
                <div
                  key={entry.key}
                  className={detail?.key === entry.key ? 'nxp-tree-row nxp-tree-row-selected' : 'nxp-tree-row'}
                  style={{ paddingLeft: 10 }}
                  title={entry.key}
                  onClick={() => openKey(entry.key)}
                >
                  <span className="nxp-conn-type nxp-type-string" style={{ fontSize: 10, padding: '1px 5px' }}>
                    {entry.type}
                  </span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{entry.key}</span>
                  <span className="nxp-meta" style={{ marginLeft: 'auto', flex: 'none' }}>
                    {entry.ttl === -1 ? '永久' : entry.ttl === -2 ? '—' : `${entry.ttl}s`}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="nxp-empty">无匹配键</div>
          )}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          {detailError ? <ErrorBox error={detailError} /> : null}
          {detail ? (
            <div>
              <div className="nxp-toolbar">
                <span className="nxp-badge">{detail.type}</span>
                <span style={{ wordBreak: 'break-all' }}>{detail.key}</span>
                <span className="nxp-meta">
                  TTL: {detail.ttl === -1 ? '永久' : `${detail.ttl}s`}
                </span>
              </div>
              <div className="nxp-pre">{detail.value}</div>
            </div>
          ) : (
            <div className="nxp-empty">点击左侧键查看详情</div>
          )}
        </div>
      </div>
    </div>
  )
}

// ==================== 主面板 ====================

/** shell.overlay 槽位组件：关闭时返回 null。 */
export function NexsqlOverlay(): React.JSX.Element | null {
  const open = useSyncExternalStore(panelUi.subscribe, panelUi.get)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!open) {
      setLoaded(false)
      return
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        panelUi.setOpen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => {
      window.removeEventListener('keydown', onKeyDown, { capture: true })
    }
  }, [open])

  if (!open) return null
  ensureStyles()

  return (
    <div className="nxp-overlay" role="dialog" aria-label="nexSql 数据库面板">
      <div className="nxp-header">
        <DbIcon />
        <span className="nxp-title">nexSql 数据库</span>
        <span className="nxp-badge">完整版</span>
        <span className="nxp-header-space" />
        <button
          type="button"
          className="nxp-iconbutton nxp-close"
          title="关闭 (Esc)"
          aria-label="关闭"
          onClick={() => panelUi.setOpen(false)}
        >
          ✕
        </button>
      </div>
      <div className="nxp-body">
        <iframe
          src="/nexsql/app/"
          title="nexSql 数据库管理"
          style={{ width: '100%', height: '100%', border: 0, display: 'block', background: '#0d1117' }}
          allow="clipboard-write"
          onLoad={() => setLoaded(true)}
        />
        {loaded ? null : (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#8b949e',
              fontSize: 14,
              pointerEvents: 'none'
            }}
          >
            正在加载 nexSql 完整界面…
          </div>
        )}
      </div>
    </div>
  )
}
