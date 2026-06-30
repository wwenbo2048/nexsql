import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
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
  FolderOpen,
  KeyRound
} from 'lucide-react'
import { useConnectionStore } from '@stores/connection'
import { useBrowserStore, type DbCategory } from '@stores/browser'
import { useUiStore, type ContextMenuItem } from '@stores/ui'
import { useTabStore } from '@stores/tab'
import type { ConnectionConfig, DatabaseInfo, TableInfo } from '@shared/types'

// Redis 连接节点缓存
const redisConnected = new Set<string>()

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

  const [, forceUpdate] = useState({})
  // 新建/删除数据库弹窗
  const [dbModal, setDbModal] = useState<{ mode: 'create' | 'delete'; config: ConnectionConfig; dbName?: string; name: string; charset: string; collation: string } | null>(null)
  // 备份/恢复进度弹窗
  const [opProgress, setOpProgress] = useState<{ type: 'backup' | 'restore'; dbName: string; current: number; total: number; label: string; operationId: string } | null>(null)
  const operationIdRef = useRef<string>('')
  const selectDatabase = useBrowserStore((s) => s.selectDatabase)
  const selectCategory = useBrowserStore((s) => s.selectCategory)
  const selectTable = useBrowserStore((s) => s.selectTable)
  const selectedConnectionId = useBrowserStore((s) => s.selectedConnectionId)
  const selectedDatabase = useBrowserStore((s) => s.selectedDatabase)
  const openRedisBrowser = useTabStore((s) => s.openRedisBrowser)
  const openDbSync = useTabStore((s) => s.openDbSync)

  const handleConnect = useCallback(
    async (config: ConnectionConfig) => {
      setStatus(config.id, 'connecting')
      if (config.type === 'redis') {
        const res = await window.api.redis.connect(config)
        if (res.success) {
          setStatus(config.id, 'connected')
          redisConnected.add(config.id)
          toggleExpand(config.id)
          forceUpdate({})
          // 自动打开 Redis 浏览器
          openRedisBrowser(config.id)
        } else {
          setStatus(config.id, 'error', res.error)
        }
        return
      }
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
    [setStatus, toggleExpand, openRedisBrowser]
  )

  const handleToggleConnection = useCallback(
    async (config: ConnectionConfig) => {
      const status = statuses[config.id] ?? 'disconnected'
      if (status === 'disconnected' || status === 'error' || status === undefined) {
        await handleConnect(config)
      } else {
        // 断开
        if (config.type === 'redis') {
          await window.api.redis.disconnect(config.id)
          redisConnected.delete(config.id)
        } else {
          await window.api.db.disconnect(config.id)
        }
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
      // 联动中间面板
      selectDatabase(config.id, db.name)
    },
    [selectDatabase]
  )

  const handleCategoryClick = useCallback(
    (config: ConnectionConfig, db: DatabaseInfo, category: DbCategory) => {
      selectDatabase(config.id, db.name)
      selectCategory(category)
    },
    [selectDatabase, selectCategory]
  )

  const openTableData = useTabStore((s) => s.openTableData)
  const openTableDesign = useTabStore((s) => s.openTableDesign)
  const openQueryTab = useTabStore((s) => s.openQuery)

  const handleTableDoubleClick = useCallback(
    (config: ConnectionConfig, database: string, table: TableInfo) => {
      selectDatabase(config.id, database)
      selectTable(table.name)
      // 双击表 → 在中间区域开数据 Tab
      openTableData(config.id, database, table.name)
    },
    [selectDatabase, selectTable, openTableData]
  )

  const handleNewQuery = useCallback(
    (config: ConnectionConfig, database?: string) => {
      openQueryTab(config.id, database)
    },
    [openQueryTab]
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
    async (config: ConnectionConfig, dbName: string, mode: 'all' | 'structure' | 'data' = 'all') => {
      const modeSuffix = mode === 'structure' ? '_structure' : mode === 'data' ? '_data' : ''
      // 先选择保存位置
      const saveRes = await window.api.file.savePathDialog(
        `${dbName}${modeSuffix}_backup_${new Date().toISOString().slice(0, 10)}.sql`,
        'sql'
      )
      if (!saveRes.success || !saveRes.data?.saved || !saveRes.data.path) return

      const savePath = saveRes.data.path
      const opId = `backup_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
      operationIdRef.current = opId
      const modeLabel = mode === 'structure' ? '仅结构' : mode === 'data' ? '仅数据' : '数据+结构'
      setOpProgress({ type: 'backup', dbName, current: 0, total: 100, label: `正在获取表列表... (${modeLabel})`, operationId: opId })

      const unsub = window.api.db.onBackupProgress((data) => {
        if (data.operationId !== opId) return
        setOpProgress({ type: 'backup', dbName, current: data.index, total: data.total, label: `正在备份表: ${data.current}`, operationId: opId })
      })

      try {
        const res = await window.api.db.dumpDatabase(config, dbName, {
          tables: [],
          includeData: mode === 'all' || mode === 'data',
          includeStructure: mode === 'all' || mode === 'structure'
        }, opId, savePath)
        unsub()
        if (!res.success) {
          setOpProgress(null)
          if (res.error !== '已取消') alert(`备份失败: ${res.error}`)
          return
        }
        setOpProgress(null)
        alert(`数据库备份成功！(${modeLabel})\n保存至: ${savePath}`)
      } catch (err) {
        unsub()
        setOpProgress(null)
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

        const opId = `restore_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
        operationIdRef.current = opId
        setOpProgress({ type: 'restore', dbName, current: 0, total: 100, label: '正在读取并执行 SQL...', operationId: opId })

        const unsub = window.api.db.onRestoreProgress((data) => {
          if (data.operationId !== opId) return
          const pct = data.total > 0 ? Math.round((data.current / data.total) * 100) : 0
          const execLabel = data.executed != null ? `，已执行 ${data.executed} 条` : ''
          setOpProgress({ type: 'restore', dbName, current: pct, total: 100, label: `正在恢复... ${pct}%${execLabel}`, operationId: opId })
        })

        // 直接传文件路径，主进程读取文件（避免大文件通过 IPC 传输截断）
        const res = await window.api.db.restoreDatabase(config, dbName, openRes.data.path!, opId)
        unsub()
        setOpProgress(null)
        if (res.success) {
          alert(`数据库恢复成功！执行了 ${res.data?.executed ?? 0} 条语句。`)
          const dbRes = await window.api.db.getDatabases(config)
          if (dbRes.success && dbRes.data) {
            nodeCache.set(config.id, { ...nodeCache.get(config.id), databases: dbRes.data })
            forceUpdate({})
          }
        } else {
          if (res.error === '已取消') return
          alert(`恢复失败: ${res.error}`)
        }
      } catch (err) {
        setOpProgress(null)
        alert(`恢复失败: ${(err as Error).message}`)
      }
    },
    []
  )

  // 取消操作
  const handleCancelOperation = useCallback(() => {
    if (operationIdRef.current) {
      window.api.db.cancelOperation(operationIdRef.current)
    }
  }, [])

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
        ...(isConnected && config.type !== 'redis' ? [{
          label: '新建数据库',
          onClick: () => handleCreateDatabase(config)
        }] : []),
        ...(isConnected && config.type === 'redis' ? [{
          label: '打开 Redis 浏览器',
          onClick: () => openRedisBrowser(config.id)
        }] : []),
        ...(config.type !== 'redis' ? [{ label: '新建查询', onClick: () => handleNewQuery(config) }] : []),
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
          onClick: () => openTableDesign(config.id, database, table.name)
        },
        { label: '', separator: true },
        {
          label: '复制表名',
          onClick: () => navigator.clipboard.writeText(table.name)
        }
      ]
      setContextMenu({ x: e.clientX, y: e.clientY, items })
    },
    [handleTableDoubleClick, openTableDesign, setContextMenu]
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
            config.type === 'redis'
              ? <KeyRound size={14} className="text-red-400 flex-shrink-0" />
              : <CheckCircle2 size={14} className="text-green-500 flex-shrink-0" />
          ) : status === 'connecting' ? (
            <CheckCircle2 size={14} className="text-yellow-500 flex-shrink-0" />
          ) : status === 'error' ? (
            <AlertCircle size={14} className="text-red-500 flex-shrink-0" />
          ) : (
            config.type === 'redis'
              ? <KeyRound size={14} className="text-red-400/40 flex-shrink-0" />
              : <Circle size={14} className="text-text-muted flex-shrink-0" />
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

        {/* Redis 连接展开 */}
        {isExpanded && status === 'connected' && config.type === 'redis' && (
          <div className="ml-4">
            <div
              className="flex items-center gap-1 px-2 py-0.5 cursor-pointer hover:bg-bg-hover text-red-400"
              onClick={() => openRedisBrowser(config.id)}
            >
              <KeyRound size={13} className="flex-shrink-0" />
              <span className="flex-1 truncate text-xs">打开 Redis 浏览器</span>
            </div>
          </div>
        )}

        {/* 数据库列表（仅 MySQL） */}
        {isExpanded && status === 'connected' && config.type !== 'redis' && cached?.databases && (
          <div className="ml-4">
            {cached.databases.map((db) => {
              const isActive = selectedConnectionId === config.id && selectedDatabase === db.name
              return (
                <div key={db.name}>
                  <div
                    className={`flex items-center gap-1 px-2 py-0.5 cursor-pointer transition-colors ${
                      isActive
                        ? 'bg-accent/15 border-l-2 border-l-accent'
                        : 'hover:bg-bg-hover border-l-2 border-l-transparent'
                    }`}
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
                          { label: '备份（数据+结构）', onClick: () => handleBackupDatabase(config, db.name, 'all') },
                          { label: '备份（仅结构）', onClick: () => handleBackupDatabase(config, db.name, 'structure') },
                          { label: '备份（仅数据）', onClick: () => handleBackupDatabase(config, db.name, 'data') },
                          { label: '恢复数据库', onClick: () => handleRestoreDatabase(config, db.name) },
                          { label: '数据库同步', onClick: () => openDbSync(config.id, db.name) },
                          { label: '', separator: true },
                          { label: '复制数据库名', onClick: () => navigator.clipboard.writeText(db.name) },
                          { label: '', separator: true },
                          { label: '删除数据库', danger: true, onClick: () => handleDeleteDatabase(config, db.name) }
                        ]
                      })
                    }}
                  >
                    <DatabaseIcon size={14} className={`flex-shrink-0 ${isActive ? 'text-accent' : 'text-accent-light'}`} />
                    <span className={`flex-1 truncate ${isActive ? 'text-text-primary font-semibold' : 'text-text-primary/90'}`}>{db.name}</span>
                  </div>
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

      {/* 备份/恢复进度弹窗 */}
      {opProgress && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40">
          <div className="bg-bg-tertiary border border-border rounded-lg shadow-2xl p-5 w-96">
            <div className="flex items-center gap-2 mb-3">
              <Loader2 size={16} className="animate-spin text-accent" />
              <span className="text-sm font-medium text-text-primary">
                {opProgress.type === 'backup' ? '数据库备份' : '数据库恢复'}
              </span>
              <span className="text-xs text-text-muted ml-auto">{opProgress.dbName}</span>
            </div>
            <div className="text-xs text-text-secondary mb-2 truncate">{opProgress.label}</div>
            <div className="h-2 bg-bg-primary rounded-full overflow-hidden mb-3">
              <div
                className="h-full bg-accent rounded-full transition-all duration-200"
                style={{ width: `${opProgress.total > 0 ? Math.min(100, (opProgress.current / opProgress.total) * 100) : 0}%` }}
              />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-text-muted">
                {opProgress.total > 0 ? `${opProgress.current} / ${opProgress.total}` : ''}
              </span>
              <button
                onClick={handleCancelOperation}
                className="px-3 py-1.5 rounded text-xs hover:bg-bg-hover text-red-400 hover:text-red-300 transition-colors"
              >
                取消
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
