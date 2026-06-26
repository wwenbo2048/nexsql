import { useState, useCallback, useEffect, useMemo } from 'react'
import {
  ChevronRight,
  ChevronDown,
  Database as DatabaseIcon,
  Server,
  Table as TableIcon,
  Eye,
  Folder,
  MoreVertical,
  RefreshCw,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Circle,
  FunctionSquare,
  CalendarClock,
  FolderTree,
  HardDriveDownload,
  HardDriveUpload,
  Tag,
  FolderOpen
} from 'lucide-react'
import { useConnectionStore } from '@stores/connection'
import { useBrowserStore, type DbCategory } from '@stores/browser'
import { useUiStore, type ContextMenuItem } from '@stores/ui'
import { useTabStore } from '@stores/tab'
import type { ConnectionConfig, DatabaseInfo, TableInfo } from '@shared/types'

// 树节点数据缓存
interface NodeData {
  databases?: DatabaseInfo[]
  tables?: Record<string, TableInfo[]>
  loading?: boolean
}

const nodeCache = new Map<string, NodeData>()

const CATEGORIES: { key: DbCategory; label: string; icon: typeof TableIcon }[] = [
  { key: 'tables', label: '表', icon: TableIcon },
  { key: 'views', label: '视图', icon: Eye },
  { key: 'functions', label: '函数', icon: FunctionSquare },
  { key: 'events', label: '事件', icon: CalendarClock }
]

export default function ConnectionTree() {
  const { connections, statuses, errors, expandedConnections } = useConnectionStore()
  const { toggleExpand, setStatus, deleteConnection } = useConnectionStore()
  const openConnectionModal = useUiStore((s) => s.openConnectionModal)
  const setContextMenu = useUiStore((s) => s.setContextMenu)
  const openTab = useTabStore((s) => s.openTab)

  const [, forceUpdate] = useState({})
  // 新建/删除数据库弹窗
  const [dbModal, setDbModal] = useState<{ mode: 'create' | 'delete'; config: ConnectionConfig; dbName?: string; name: string; charset: string; collation: string } | null>(null)
  const selectDatabase = useBrowserStore((s) => s.selectDatabase)
  const selectCategory = useBrowserStore((s) => s.selectCategory)
  const selectTable = useBrowserStore((s) => s.selectTable)

  const handleConnect = useCallback(
    async (config: ConnectionConfig) => {
      setStatus(config.id, 'connecting')
      const res = await window.api.db.connect(config)
      if (res.success) {
        setStatus(config.id, 'connected')
        toggleExpand(config.id)
        // 加载数据库列表
        const dbRes = await window.api.db.getDatabases(config)
        if (dbRes.success && dbRes.data) {
          nodeCache.set(config.id, { databases: dbRes.data })
          forceUpdate({})
        }
      } else {
        setStatus(config.id, 'error', res.error)
      }
    },
    [setStatus, toggleExpand]
  )

  const handleToggleConnection = useCallback(
    async (config: ConnectionConfig) => {
      const status = statuses[config.id] ?? 'disconnected'
      if (status === 'disconnected' || status === 'error' || status === undefined) {
        await handleConnect(config)
      } else {
        // 断开
        await window.api.db.disconnect(config.id)
        setStatus(config.id, 'disconnected')
        nodeCache.delete(config.id)
        toggleExpand(config.id)
        forceUpdate({})
      }
    },
    [statuses, handleConnect, setStatus, toggleExpand]
  )

  const handleToggleDatabase = useCallback(
    async (config: ConnectionConfig, db: DatabaseInfo) => {
      const dbKey = `${config.id}:${db.name}`
      const isExpanded = expandedConnections.has(dbKey)
      toggleExpand(dbKey)
      // 联动中间面板
      selectDatabase(config.id, db.name)
      if (!isExpanded) {
        // 加载表列表（用于左侧树展示表名）
        const cached = nodeCache.get(config.id)
        if (!cached?.tables?.[db.name]) {
          const res = await window.api.db.getTables(config, db.name)
          if (res.success && res.data) {
            nodeCache.set(config.id, {
              ...cached,
              tables: { ...(cached?.tables ?? {}), [db.name]: res.data }
            })
            forceUpdate({})
          }
        }
      }
    },
    [expandedConnections, toggleExpand, selectDatabase]
  )

  const handleCategoryClick = useCallback(
    (config: ConnectionConfig, db: DatabaseInfo, category: DbCategory) => {
      selectDatabase(config.id, db.name)
      selectCategory(category)
    },
    [selectDatabase, selectCategory]
  )

  const handleTableDoubleClick = useCallback(
    (config: ConnectionConfig, database: string, table: TableInfo) => {
      selectDatabase(config.id, database)
      selectTable(table.name)
    },
    [selectDatabase, selectTable]
  )

  const handleNewQuery = useCallback(
    (config: ConnectionConfig, database?: string) => {
      openTab({
        id: `query-${Date.now()}`,
        type: 'query',
        title: database ? `Query - ${database}` : 'Query',
        connectionId: config.id,
        database
      })
    },
    [openTab]
  )

  // ==================== 新建数据库 ====================

  const handleCreateDatabase = useCallback(
    (config: ConnectionConfig) => {
      setDbModal({ mode: 'create', config, name: '', charset: 'utf8mb4', collation: 'utf8mb4_general_ci' })
    },
    []
  )

  const handleDbModalConfirm = useCallback(async () => {
    if (!dbModal) return
    const { config, mode, name, dbName, charset, collation } = dbModal
    if (mode === 'create') {
      const trimmed = name.trim()
      if (!trimmed) return
      let sql = `CREATE DATABASE \`${trimmed}\``
      if (charset) sql += ` CHARACTER SET ${charset}`
      if (collation) sql += ` COLLATE ${collation}`
      const res = await window.api.db.query(config, sql)
      if (res.success) {
        // 刷新数据库列表
        const dbRes = await window.api.db.getDatabases(config)
        if (dbRes.success && dbRes.data) {
          nodeCache.set(config.id, { databases: dbRes.data })
          forceUpdate({})
        }
      } else {
        alert(`创建数据库失败: ${res.error}`)
      }
    } else if (mode === 'delete') {
      if (!dbName) return
      const res = await window.api.db.query(config, `DROP DATABASE \`${dbName}\``)
      if (res.success) {
        // 刷新数据库列表
        const dbRes = await window.api.db.getDatabases(config)
        if (dbRes.success && dbRes.data) {
          nodeCache.set(config.id, { databases: dbRes.data })
          forceUpdate({})
        }
      } else {
        alert(`删除数据库失败: ${res.error}`)
      }
    }
    setDbModal(null)
  }, [dbModal])

  // ==================== 删除数据库 ====================

  const handleDeleteDatabase = useCallback(
    (config: ConnectionConfig, dbName: string) => {
      setDbModal({ mode: 'delete', config, dbName, name: dbName, charset: '', collation: '' })
    },
    []
  )

  // ==================== 数据库备份 ====================

  const handleBackupDatabase = useCallback(
    async (config: ConnectionConfig, dbName: string) => {
      if (!confirm(`确定备份数据库 "${dbName}" 吗？\n将导出所有表结构和数据。`)) return
      try {
        const res = await window.api.db.dumpDatabase(config, dbName, {
          tables: [],
          includeData: true,
          includeStructure: true
        })
        if (!res.success || !res.data) {
          alert(`备份失败: ${res.error}`)
          return
        }
        const saveRes = await window.api.file.saveDialog(
          `${dbName}_backup_${new Date().toISOString().slice(0, 10)}.sql`,
          res.data,
          'sql'
        )
        if (saveRes.success && saveRes.data?.saved) {
          alert(`数据库备份成功！\n保存至: ${saveRes.data.path}`)
        }
      } catch (err) {
        alert(`备份失败: ${(err as Error).message}`)
      }
    },
    []
  )

  // ==================== 数据库恢复 ====================

  const handleRestoreDatabase = useCallback(
    async (config: ConnectionConfig, dbName: string) => {
      if (!confirm(`确定恢复数据库 "${dbName}" 吗？\n将执行 SQL 文件中的所有语句，可能会覆盖现有数据！`)) return
      try {
        const openRes = await window.api.file.openDialog('sql')
        if (!openRes.success || openRes.data?.canceled || !openRes.data?.content) return
        const res = await window.api.db.restoreDatabase(config, dbName, openRes.data.content)
        if (res.success) {
          alert(`数据库恢复成功！执行了 ${res.data?.executed ?? 0} 条语句。`)
          // 刷新数据库列表
          const dbRes = await window.api.db.getDatabases(config)
          if (dbRes.success && dbRes.data) {
            nodeCache.set(config.id, { ...nodeCache.get(config.id), databases: dbRes.data })
            forceUpdate({})
          }
        } else {
          alert(`恢复失败: ${res.error}`)
        }
      } catch (err) {
        alert(`恢复失败: ${(err as Error).message}`)
      }
    },
    []
  )

  // 监听菜单栏新建数据库事件
  useEffect(() => {
    const onCreateDb = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail?.config) handleCreateDatabase(detail.config)
    }
    window.addEventListener('nexsql-create-database', onCreateDb)
    return () => window.removeEventListener('nexsql-create-database', onCreateDb)
  }, [handleCreateDatabase])

  const handleConnectionContextMenu = useCallback(
    (e: React.MouseEvent, config: ConnectionConfig) => {
      e.preventDefault()
      e.stopPropagation()
      const isConnected = statuses[config.id] === 'connected'
      const items: ContextMenuItem[] = [
        {
          label: isConnected ? '断开连接' : '连接',
          onClick: () => handleToggleConnection(config)
        },
        { label: '', separator: true },
        ...(isConnected ? [{
          label: '新建数据库',
          onClick: () => handleCreateDatabase(config)
        }] : []),
        { label: '新建查询', onClick: () => handleNewQuery(config) },
        {
          label: '编辑连接',
          onClick: () => openConnectionModal(config.id)
        },
        { label: '', separator: true },
        {
          label: '删除连接',
          danger: true,
          onClick: () => {
            if (confirm(`确定删除连接 "${config.name}" 吗？`)) {
              deleteConnection(config.id)
              nodeCache.delete(config.id)
            }
          }
        }
      ]
      setContextMenu({ x: e.clientX, y: e.clientY, items })
    },
    [statuses, handleToggleConnection, handleCreateDatabase, handleNewQuery, openConnectionModal, deleteConnection, setContextMenu]
  )

  const handleTableContextMenu = useCallback(
    (e: React.MouseEvent, config: ConnectionConfig, database: string, table: TableInfo) => {
      e.preventDefault()
      e.stopPropagation()
      const items: ContextMenuItem[] = [
        {
          label: '打开表数据',
          onClick: () => handleTableDoubleClick(config, database, table)
        },
        {
          label: '设计表',
          onClick: () =>
            openTab({
              id: `${config.id}-${database}-${table.name}-design-${Date.now()}`,
              type: 'table-design',
              title: `设计 ${table.name}`,
              connectionId: config.id,
              database,
              table: table.name
            })
        },
        { label: '', separator: true },
        {
          label: '复制表名',
          onClick: () => navigator.clipboard.writeText(table.name)
        }
      ]
      setContextMenu({ x: e.clientX, y: e.clientY, items })
    },
    [handleTableDoubleClick, openTab, setContextMenu]
  )

  // 按分组归类连接（必须在条件 return 之前调用，遵守 Hooks 规则）
  const groupedConnections = useMemo(() => {
    const groups: Record<string, ConnectionConfig[]> = { '': [] }
    for (const conn of connections) {
      const g = conn.group ?? ''
      if (!groups[g]) groups[g] = []
      groups[g].push(conn)
    }
    return groups
  }, [connections])

  const groupNames = Object.keys(groupedConnections).filter(Boolean).sort()
  const ungrouped = groupedConnections[''] ?? []

  if (connections.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-text-muted text-sm p-4">
        <Server size={32} className="mb-2 opacity-50" />
        <p className="text-center">暂无连接</p>
        <p className="text-center mt-1">点击上方 + 按钮创建</p>
      </div>
    )
  }

  // 渲染单个连接节点
  const renderConnection = (config: ConnectionConfig) => {
    const status = statuses[config.id] ?? 'disconnected'
    const error = errors[config.id]
    const isExpanded = expandedConnections.has(config.id)
    const cached = nodeCache.get(config.id)

    return (
      <div key={config.id}>
        {/* 连接节点 */}
        <div
          className="flex items-center gap-1 px-2 py-1 cursor-pointer hover:bg-bg-hover group"
          onClick={() => handleToggleConnection(config)}
          onContextMenu={(e) => handleConnectionContextMenu(e, config)}
        >
          {status === 'connecting' ? (
            <Loader2 size={14} className="animate-spin text-accent" />
          ) : isExpanded ? (
            <ChevronDown size={14} className="text-text-muted" />
          ) : (
            <ChevronRight size={14} className="text-text-muted" />
          )}

          {status === 'connected' ? (
            <CheckCircle2 size={14} className="text-green-500 flex-shrink-0" />
          ) : status === 'connecting' ? (
            <CheckCircle2 size={14} className="text-yellow-500 flex-shrink-0" />
          ) : status === 'error' ? (
            <AlertCircle size={14} className="text-red-500 flex-shrink-0" />
          ) : (
            <Circle size={14} className="text-text-muted flex-shrink-0" />
          )}

          <span className="flex-1 truncate text-text-primary">{config.name}</span>
          {/* 标签徽章 */}
          {config.tags && config.tags.length > 0 && (
            <div className="flex items-center gap-0.5 mr-1">
              {config.tags.slice(0, 2).map((tag) => (
                <span
                  key={tag}
                  className="text-[9px] px-1 rounded bg-accent/20 text-accent-light truncate max-w-[48px]"
                  title={tag}
                >
                  {tag}
                </span>
              ))}
              {config.tags.length > 2 && (
                <span className="text-[9px] text-text-muted">+{config.tags.length - 2}</span>
              )}
            </div>
          )}
          <span className="text-text-muted text-xs hidden group-hover:inline">
            {config.host}:{config.port}
          </span>
        </div>

        {/* 错误提示 */}
        {status === 'error' && error && (
          <div className="ml-8 px-2 py-1 text-xs text-red-400 truncate" title={error}>
            {error}
          </div>
        )}

        {/* 数据库列表 */}
        {isExpanded && status === 'connected' && cached?.databases && (
          <div className="ml-4">
            {cached.databases.map((db) => {
              const dbKey = `${config.id}:${db.name}`
              const dbExpanded = expandedConnections.has(dbKey)
              const tables = cached.tables?.[db.name]

              return (
                <div key={db.name}>
                  <div
                    className="flex items-center gap-1 px-2 py-0.5 cursor-pointer hover:bg-bg-hover"
                    onClick={() => handleToggleDatabase(config, db)}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      setContextMenu({
                        x: e.clientX,
                        y: e.clientY,
                        items: [
                          { label: '新建查询', onClick: () => handleNewQuery(config, db.name) },
                          { label: '', separator: true },
                          { label: '备份数据库', onClick: () => handleBackupDatabase(config, db.name) },
                          { label: '恢复数据库', onClick: () => handleRestoreDatabase(config, db.name) },
                          { label: '', separator: true },
                          { label: '复制数据库名', onClick: () => navigator.clipboard.writeText(db.name) },
                          { label: '', separator: true },
                          { label: '删除数据库', danger: true, onClick: () => handleDeleteDatabase(config, db.name) }
                        ]
                      })
                    }}
                  >
                    {dbExpanded ? (
                      <ChevronDown size={12} className="text-text-muted" />
                    ) : (
                      <ChevronRight size={12} className="text-text-muted" />
                    )}
                    <DatabaseIcon size={14} className="text-accent-light flex-shrink-0" />
                    <span className="flex-1 truncate text-text-primary/90">{db.name}</span>
                  </div>

                  {/* 展开后显示分类（表/视图/函数/事件） */}
                  {dbExpanded && (
                    <div className="ml-4">
                      {CATEGORIES.map((cat) => {
                        const tablesOnly = cat.key === 'tables'
                          ? tables?.filter((t) => t.type === 'table').length ?? 0
                          : 0
                        const viewsCount = cat.key === 'views'
                          ? tables?.filter((t) => t.type === 'view').length ?? 0
                          : 0

                        return (
                          <div key={cat.key}>
                            {/* 分类节点 */}
                            <div
                              className="flex items-center gap-1 px-2 py-0.5 cursor-pointer hover:bg-bg-hover"
                              onClick={() => handleCategoryClick(config, db, cat.key)}
                            >
                              <cat.icon size={13} className={`flex-shrink-0 ${
                                cat.key === 'tables' ? 'text-blue-400' :
                                cat.key === 'views' ? 'text-purple-400' :
                                cat.key === 'functions' ? 'text-orange-400' :
                                'text-green-400'
                              }`} />
                              <span className="flex-1 truncate text-text-secondary">{cat.label}</span>
                              {cat.key === 'tables' && tablesOnly > 0 && (
                                <span className="text-[9px] text-text-muted">{tablesOnly}</span>
                              )}
                              {cat.key === 'views' && viewsCount > 0 && (
                                <span className="text-[9px] text-text-muted">{viewsCount}</span>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  return (
    <>
    <div className="py-1 text-sm select-none">
      {/* 有分组的连接 */}
      {groupNames.map((groupName) => (
        <GroupFolder
          key={groupName}
          name={groupName}
          connections={groupedConnections[groupName]}
          renderConnection={renderConnection}
        />
      ))}
      {/* 未分组连接 */}
      {ungrouped.map(renderConnection)}
    </div>

      {/* 新建/删除数据库弹窗 */}
      {dbModal && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40" onClick={() => setDbModal(null)}>
          <div className="bg-bg-tertiary border border-border rounded-lg shadow-2xl p-4 w-96" onClick={(e) => e.stopPropagation()}>
            {dbModal!.mode === 'create' ? (
              <>
                <div className="text-sm font-medium text-text-primary mb-3">新建数据库</div>
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-text-secondary mb-1">数据库名称 <span className="text-red-400">*</span></label>
                    <input
                      type="text"
                      value={dbModal!.name}
                      onChange={(e) => setDbModal({ ...dbModal!, name: e.target.value })}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleDbModalConfirm(); if (e.key === 'Escape') setDbModal(null) }}
                      placeholder="例如：my_database"
                      autoFocus
                      className="w-full px-3 py-2 bg-bg-primary border border-border-light rounded text-sm text-text-primary focus:outline-none focus:border-accent transition-colors"
                    />
                  </div>
                  <div className="flex gap-3">
                    <div className="flex-1">
                      <label className="block text-xs font-medium text-text-secondary mb-1">字符集</label>
                      <select
                        value={dbModal!.charset}
                        onChange={(e) => setDbModal({ ...dbModal!, charset: e.target.value })}
                        className="w-full px-2 py-2 bg-bg-primary border border-border-light rounded text-sm text-text-primary focus:outline-none focus:border-accent"
                      >
                        <option value="utf8mb4">utf8mb4</option>
                        <option value="utf8">utf8</option>
                        <option value="latin1">latin1</option>
                        <option value="ascii">ascii</option>
                        <option value="gbk">gbk</option>
                        <option value="gb2312">gb2312</option>
                        <option value="big5">big5</option>
                      </select>
                    </div>
                    <div className="flex-1">
                      <label className="block text-xs font-medium text-text-secondary mb-1">排序规则</label>
                      <input
                        type="text"
                        value={dbModal!.collation}
                        onChange={(e) => setDbModal({ ...dbModal!, collation: e.target.value })}
                        placeholder="utf8mb4_general_ci"
                        className="w-full px-3 py-2 bg-bg-primary border border-border-light rounded text-sm text-text-primary focus:outline-none focus:border-accent"
                      />
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="text-sm font-medium text-text-primary mb-3">删除数据库</div>
                <div className="flex items-start gap-2 p-3 bg-red-950/30 border border-red-800/40 rounded mb-3">
                  <AlertCircle size={16} className="text-red-400 flex-shrink-0 mt-0.5" />
                  <div className="text-xs text-red-300">
                    确定删除数据库 <span className="font-mono font-bold">"{dbModal!.dbName}"</span> 吗？
                    <br />所有表和数据将被永久删除，此操作不可恢复！
                  </div>
                </div>
              </>
            )}
            <div className="flex items-center justify-end gap-2 mt-4">
              <button
                onClick={() => setDbModal(null)}
                className="px-3 py-1.5 rounded text-xs hover:bg-bg-hover text-text-secondary transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleDbModalConfirm}
                className={`px-3 py-1.5 rounded text-xs text-white transition-colors ${dbModal!.mode === 'delete' ? 'bg-red-600 hover:bg-red-700' : 'bg-accent hover:bg-accent/80'}`}
              >
                {dbModal!.mode === 'create' ? '创建' : '确认删除'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ==================== 分组文件夹组件 ====================

function GroupFolder({
  name,
  connections,
  renderConnection
}: {
  name: string
  connections: ConnectionConfig[]
  renderConnection: (config: ConnectionConfig) => React.ReactNode
}) {
  const [expanded, setExpanded] = useState(true)

  return (
    <div>
      <div
        className="flex items-center gap-1 px-2 py-1 cursor-pointer hover:bg-bg-hover"
        onClick={() => setExpanded((e) => !e)}
      >
        {expanded ? (
          <ChevronDown size={13} className="text-text-muted" />
        ) : (
          <ChevronRight size={13} className="text-text-muted" />
        )}
        {expanded ? (
          <FolderOpen size={14} className="text-yellow-400 flex-shrink-0" />
        ) : (
          <Folder size={14} className="text-yellow-400 flex-shrink-0" />
        )}
        <span className="flex-1 truncate text-text-secondary font-medium text-xs">{name}</span>
        <span className="text-[9px] text-text-muted">{connections.length}</span>
      </div>
      {expanded && (
        <div className="ml-3 border-l border-border-light/40 pl-1">
          {connections.map(renderConnection)}
        </div>
      )}
    </div>
  )
}
