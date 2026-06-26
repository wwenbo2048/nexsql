import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  RefreshCw,
  Loader2,
  Plus,
  Table as TableIcon,
  Eye,
  Trash2,
  Pencil,
  Database as DatabaseIcon,
  Search,
  AlertCircle,
  FunctionSquare,
  CalendarClock,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  Terminal,
  Bookmark,
  Network,
  FileCode2
} from 'lucide-react'
import { useBrowserStore, type DbCategory } from '@stores/browser'
import { useConnectionStore } from '@stores/connection'
import { useUiStore, type ContextMenuItem } from '@stores/ui'
import { useSnippetStore } from '@stores/snippet'
import { setCompletionContext, getCompletionContext } from '@renderer/sql-completion'
import type { TableInfo, ViewInfo, RoutineInfo, EventInfo } from '@shared/types'

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '-'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function formatRows(rows: number): string {
  if (rows === undefined || rows === null) return '-'
  if (rows < 1000) return String(rows)
  if (rows < 1000000) return `${(rows / 1000).toFixed(1)}K`
  return `${(rows / 1000000).toFixed(1)}M`
}

const CATEGORY_LABELS: Record<DbCategory, string> = {
  tables: '表',
  views: '视图',
  functions: '函数',
  events: '事件',
  query: '查询',
  er: 'ER 图',
  snippets: '片段'
}

export default function MiddlePanel() {
  const connections = useConnectionStore((s) => s.connections)
  const {
    selectedConnectionId, selectedDatabase, selectedTable, selectedCategory,
    selectTable, selectCategory,
    startCreating, startEditing,
    tables, views, routines, events,
    setTables, setViews, setRoutines, setEvents,
    listLoading, setListLoading,
    listVersion, refreshList,
    setCompareSource
  } = useBrowserStore()

  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [renameState, setRenameState] = useState<{ oldName: string; newName: string } | null>(null)

  const config = connections.find((c) => c.id === selectedConnectionId)
  const setContextMenu = useUiStore((s) => s.setContextMenu)

  const loadData = useCallback(async () => {
    if (!config || !selectedDatabase) return
    setListLoading(true)
    setError(null)
    try {
      if (selectedCategory === 'tables') {
        const res = await window.api.db.getTables(config, selectedDatabase)
        if (res.success && res.data) setTables(res.data.filter((t) => t.type === 'table'))
        else if (!res.success) setError(res.error ?? '加载失败')
      } else if (selectedCategory === 'views') {
        const res = await window.api.db.getViews(config, selectedDatabase)
        if (res.success && res.data) setViews(res.data)
        else if (!res.success) setError(res.error ?? '加载失败')
      } else if (selectedCategory === 'functions') {
        const res = await window.api.db.getRoutines(config, selectedDatabase)
        if (res.success && res.data) setRoutines(res.data)
        else if (!res.success) setError(res.error ?? '加载失败')
      } else if (selectedCategory === 'events') {
        const res = await window.api.db.getEvents(config, selectedDatabase)
        if (res.success && res.data) setEvents(res.data)
        else if (!res.success) setError(res.error ?? '加载失败')
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setListLoading(false)
    }
  }, [config, selectedDatabase, selectedCategory, setTables, setViews, setRoutines, setEvents, setListLoading])

  useEffect(() => {
    if (config && selectedDatabase) {
      loadData()
    }
  }, [config, selectedDatabase, selectedCategory, listVersion, loadData])

  // 更新 SQL 补全上下文（表名 + 字段名）
  useEffect(() => {
    if (tables.length > 0) {
      const ctx = getCompletionContext()
      setCompletionContext({
        tables: tables.map((t) => t.name),
        columns: ctx.columns,
        database: selectedDatabase ?? undefined
      })
    }
  }, [tables, selectedDatabase])

  // 选中表时加载字段名用于补全
  useEffect(() => {
    if (!config || !selectedDatabase || !selectedTable) return
    const loadColumnsForCompletion = async () => {
      const res = await window.api.db.getTableColumns(config, selectedDatabase, selectedTable)
      if (res.success && res.data) {
        const ctx = getCompletionContext()
        setCompletionContext({
          ...ctx,
          columns: {
            ...ctx.columns,
            [selectedTable]: res.data!.map((c) => c.name)
          }
        })
      }
    }
    loadColumnsForCompletion()
  }, [config, selectedDatabase, selectedTable])

  const handleDelete = useCallback(async () => {
    if (!config || !selectedDatabase || !selectedTable) return
    const catLabel = CATEGORY_LABELS[selectedCategory]
    if (!confirm(`确定删除${catLabel} "${selectedTable}" 吗？此操作不可恢复！`)) return
    let sql = ''
    if (selectedCategory === 'tables') sql = `DROP TABLE \`${selectedTable}\``
    else if (selectedCategory === 'views') sql = `DROP VIEW IF EXISTS \`${selectedTable}\``
    else if (selectedCategory === 'functions') sql = `DROP FUNCTION IF EXISTS \`${selectedTable}\``
    else if (selectedCategory === 'events') sql = `DROP EVENT IF EXISTS \`${selectedTable}\``
    else return
    const res = await window.api.db.query(config, sql, selectedDatabase)
    if (res.success) {
      selectTable(null)
      refreshList()
    } else {
      alert(`删除失败: ${res.error}`)
    }
  }, [config, selectedDatabase, selectedTable, selectedCategory, selectTable, refreshList])

  const handleAdd = useCallback(() => {
    startCreating()
  }, [startCreating])

  const handleEdit = useCallback(() => {
    if (!selectedTable) return
    startEditing()
  }, [selectedTable, startEditing])

  // ==================== 表右键菜单操作 ====================

  const handleCopyTable = useCallback(async (tableName: string, withData: boolean) => {
    if (!config || !selectedDatabase) return
    const newName = `${tableName}_copy`
    try {
      // CREATE TABLE new LIKE old
      const createRes = await window.api.db.query(config, `CREATE TABLE \`${newName}\` LIKE \`${tableName}\``, selectedDatabase)
      if (!createRes.success) { alert(`复制表结构失败: ${createRes.error}`); return }
      if (withData) {
        const dataRes = await window.api.db.query(config, `INSERT INTO \`${newName}\` SELECT * FROM \`${tableName}\``, selectedDatabase)
        if (!dataRes.success) { alert(`复制数据失败: ${dataRes.error}`); return }
      }
      refreshList()
    } catch (err) {
      alert(`复制表失败: ${(err as Error).message}`)
    }
  }, [config, selectedDatabase, refreshList])

  const handleTruncateTable = useCallback(async (tableName: string) => {
    if (!config || !selectedDatabase) return
    if (!confirm(`确定清空表 "${tableName}" 的所有数据吗？此操作不可恢复！`)) return
    const res = await window.api.db.query(config, `TRUNCATE TABLE \`${tableName}\``, selectedDatabase)
    if (res.success) {
      refreshList()
    } else {
      alert(`清空表失败: ${res.error}`)
    }
  }, [config, selectedDatabase, refreshList])

  const handleRenameTable = useCallback(async (tableName: string) => {
    if (!config || !selectedDatabase) return
    setRenameState({ oldName: tableName, newName: tableName })
  }, [config, selectedDatabase])

  const handleRenameConfirm = useCallback(async () => {
    if (!config || !selectedDatabase || !renameState) return
    const trimmed = renameState.newName.trim()
    if (!trimmed || trimmed === renameState.oldName) {
      setRenameState(null)
      return
    }
    const res = await window.api.db.query(config, `RENAME TABLE \`${renameState.oldName}\` TO \`${trimmed}\``, selectedDatabase)
    if (res.success) {
      if (selectedTable === renameState.oldName) selectTable(trimmed, 'info')
      refreshList()
    } else {
      alert(`重命名失败: ${res.error}`)
    }
    setRenameState(null)
  }, [config, selectedDatabase, renameState, selectedTable, selectTable, refreshList])

  const handleOptimizeTable = useCallback(async (tableName: string) => {
    if (!config || !selectedDatabase) return
    const res = await window.api.db.query(config, `OPTIMIZE TABLE \`${tableName}\``, selectedDatabase)
    if (!res.success) {
      alert(`优化表失败: ${res.error}`)
    }
  }, [config, selectedDatabase])

  const handleExportSQL = useCallback(async (tableName: string, withData: boolean) => {
    if (!config || !selectedDatabase) return
    try {
      // 获取表 DDL
      const ddlRes = await window.api.db.getTableDDL(config, selectedDatabase, tableName)
      if (!ddlRes.success || !ddlRes.data) {
        alert(`获取表结构失败: ${ddlRes.error}`)
        return
      }
      let sql = `-- nexSQL 导出\n-- 数据库: ${selectedDatabase}\n-- 表: ${tableName}\n-- 生成时间: ${new Date().toLocaleString()}\n\n`
      sql += `DROP TABLE IF EXISTS \`${tableName}\`;\n`
      sql += ddlRes.data
      sql += ';\n\n'

      if (withData) {
        // 查询所有数据
        const dataRes = await window.api.db.query(config, `SELECT * FROM \`${tableName}\``, selectedDatabase)
        if (dataRes.success && dataRes.data && dataRes.data.rows.length > 0) {
          const cols = (dataRes.data.columns ?? []).map((c) => c.name)
          sql += `-- 数据: ${dataRes.data.rows.length} 行\n`
          for (const row of dataRes.data.rows) {
            const values = cols.map((c) => {
              const v = row[c]
              if (v === null || v === undefined) return 'NULL'
              if (typeof v === 'number') return String(v)
              if (typeof v === 'boolean') return v ? '1' : '0'
              return `'${String(v).replace(/'/g, "''")}'`
            })
            sql += `INSERT INTO \`${tableName}\` (\`${cols.join('`, `')}\`) VALUES (${values.join(', ')});\n`
          }
        }
      }

      const saveRes = await window.api.file.saveDialog(`${tableName}${withData ? '' : '_structure'}.sql`, sql)
      if (!saveRes.success) {
        alert(`导出失败: ${saveRes.error}`)
      }
    } catch (err) {
      alert(`导出失败: ${(err as Error).message}`)
    }
  }, [config, selectedDatabase])

  const handleDropTable = useCallback(async (tableName: string) => {
    if (!config || !selectedDatabase) return
    if (!confirm(`确定删除表 "${tableName}" 吗？此操作不可恢复！`)) return
    const res = await window.api.db.query(config, `DROP TABLE \`${tableName}\``, selectedDatabase)
    if (res.success) {
      if (selectedTable === tableName) selectTable(null)
      refreshList()
    } else {
      alert(`删除表失败: ${res.error}`)
    }
  }, [config, selectedDatabase, selectedTable, selectTable, refreshList])

  const handleTableContextMenu = useCallback((e: React.MouseEvent, tableName: string) => {
    e.preventDefault()
    e.stopPropagation()
    selectTable(tableName, 'info')
    const items: ContextMenuItem[] = [
      {
        label: '打开表数据',
        onClick: () => selectTable(tableName, 'data')
      },
      {
        label: '查看表结构',
        onClick: () => selectTable(tableName, 'structure' as any)
      },
      { separator: true, label: '' },
      {
        label: '复制表结构',
        onClick: () => handleCopyTable(tableName, false)
      },
      {
        label: '复制表（含数据）',
        onClick: () => handleCopyTable(tableName, true)
      },
      { separator: true, label: '' },
      {
        label: '重命名表',
        onClick: () => handleRenameTable(tableName)
      },
      {
        label: '清空表数据',
        danger: true,
        onClick: () => handleTruncateTable(tableName)
      },
      {
        label: '优化表',
        onClick: () => handleOptimizeTable(tableName)
      },
      { separator: true, label: '' },
      {
        label: '导出 SQL（仅结构）',
        onClick: () => handleExportSQL(tableName, false)
      },
      {
        label: '导出 SQL（含数据）',
        onClick: () => handleExportSQL(tableName, true)
      },
      { separator: true, label: '' },
      {
        label: '对比表结构…',
        onClick: () => setCompareSource({ table: tableName })
      },
      { separator: true, label: '' },
      {
        label: '删除表',
        danger: true,
        onClick: () => handleDropTable(tableName)
      }
    ]
    setContextMenu({ x: e.clientX, y: e.clientY, items })
  }, [selectTable, handleCopyTable, handleRenameTable, handleTruncateTable, handleOptimizeTable, handleExportSQL, handleDropTable, setContextMenu, setCompareSource])

  const tbBtn = "flex items-center gap-1 px-1.5 py-1 rounded text-xs transition-colors disabled:opacity-30 disabled:cursor-not-allowed hover:bg-bg-hover text-text-secondary hover:text-text-primary"

  if (!selectedConnectionId || !selectedDatabase) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-text-muted text-sm p-4 gap-2">
        <DatabaseIcon size={32} className="opacity-30" />
        <p className="text-center">点击左侧数据库</p>
        <p className="text-center text-xs">查看表列表</p>
      </div>
    )
  }

  // 分类标签
  const categories: { key: DbCategory; label: string; icon: typeof TableIcon }[] = [
    { key: 'tables', label: '表', icon: TableIcon },
    { key: 'views', label: '视图', icon: Eye },
    { key: 'functions', label: '函数', icon: FunctionSquare },
    { key: 'events', label: '事件', icon: CalendarClock },
    { key: 'query', label: '查询', icon: Terminal },
    { key: 'er', label: 'ER 图', icon: Network },
    { key: 'snippets', label: '片段', icon: FileCode2 }
  ]

  return (
    <div className="flex flex-col h-full bg-bg-secondary">
      {/* 头部 */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-light">
        <div className="flex items-center gap-1.5 min-w-0">
          <DatabaseIcon size={14} className="text-accent-light flex-shrink-0" />
          <span className="text-xs font-semibold text-text-primary truncate">{selectedDatabase}</span>
        </div>
      </div>

      {/* 分类标签栏 */}
      <div className="flex items-center border-b border-border-light bg-bg-tertiary flex-shrink-0">
        {categories.map((cat) => (
          <button
            key={cat.key}
            onClick={() => selectCategory(cat.key)}
            className={`flex items-center gap-1 px-3 py-1.5 text-xs font-medium transition-colors border-b-2 ${
              selectedCategory === cat.key
                ? 'text-text-primary border-accent bg-bg-primary'
                : 'text-text-secondary border-transparent hover:text-text-primary'
            }`}
          >
            <cat.icon size={12} />
            {cat.label}
          </button>
        ))}
      </div>

      {/* 工具栏 */}
      <div className="flex items-center gap-0.5 px-2 py-1 border-b border-border-light">
        <button onClick={loadData} disabled={listLoading} className={tbBtn} title="刷新">
          {listLoading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
        </button>
        <button onClick={handleAdd} className={tbBtn} title={`新建${CATEGORY_LABELS[selectedCategory]}`}>
          <Plus size={14} />
        </button>
        <button onClick={handleEdit} className={tbBtn} title="编辑" disabled={!selectedTable}>
          <Pencil size={14} />
        </button>
        <button onClick={handleDelete} className={`${tbBtn} hover:text-red-400`} title="删除" disabled={!selectedTable}>
          <Trash2 size={14} />
        </button>

        <div className="ml-auto flex items-center gap-1">
          <Search size={12} className="text-text-muted" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={`搜索${CATEGORY_LABELS[selectedCategory]}...`}
            className="w-24 px-1.5 py-0.5 bg-bg-primary border border-border-light rounded text-xs text-text-primary focus:outline-none focus:border-accent transition-colors"
          />
        </div>
      </div>

      {/* 错误 */}
      {error && (
        <div className="flex items-start gap-2 p-2 text-xs text-red-400">
          <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* 列表内容 */}
      <div className="flex-1 overflow-y-auto">
        {listLoading && (
          <div className="flex items-center justify-center py-4 text-text-muted text-xs gap-1.5">
            <Loader2 size={14} className="animate-spin" />
            加载中...
          </div>
        )}

        {!listLoading && (
          <>
            {/* 表列表 */}
            {selectedCategory === 'tables' && (
              <TableList
                tables={tables}
                filteredTables={search ? tables.filter((t) => t.name.toLowerCase().includes(search.toLowerCase())) : tables}
                selectedTable={selectedTable}
                onSelect={(name) => selectTable(name, 'info')}
                onDoubleClick={(name) => selectTable(name, 'data')}
                onContextMenu={handleTableContextMenu}
              />
            )}

            {/* 视图列表 */}
            {selectedCategory === 'views' && (
              <ViewList
                views={views}
                filteredViews={search ? views.filter((v) => v.name.toLowerCase().includes(search.toLowerCase())) : views}
                selectedTable={selectedTable}
                onSelect={selectTable}
              />
            )}

            {/* 函数列表 */}
            {selectedCategory === 'functions' && (
              <FunctionList
                routines={routines}
                filteredRoutines={search ? routines.filter((r) => r.name.toLowerCase().includes(search.toLowerCase())) : routines}
                selectedTable={selectedTable}
                onSelect={selectTable}
              />
            )}

            {/* 事件列表 */}
            {selectedCategory === 'events' && (
              <EventList
                events={events}
                filteredEvents={search ? events.filter((e) => e.name.toLowerCase().includes(search.toLowerCase())) : events}
                selectedTable={selectedTable}
                onSelect={selectTable}
              />
            )}

            {/* 查询列表 */}
            {selectedCategory === 'query' && (
              <QueryList />
            )}

            {/* SQL 片段列表 */}
            {selectedCategory === 'snippets' && (
              <SnippetList />
            )}
          </>
        )}
      </div>

      {/* 重命名弹窗 */}
      {renameState && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40" onClick={() => setRenameState(null)}>
          <div className="bg-bg-tertiary border border-border rounded-lg shadow-2xl p-4 w-80" onClick={(e) => e.stopPropagation()}>
            <div className="text-sm font-medium text-text-primary mb-3">重命名表</div>
            <input
              type="text"
              value={renameState.newName}
              onChange={(e) => setRenameState({ ...renameState, newName: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleRenameConfirm()
                if (e.key === 'Escape') setRenameState(null)
              }}
              autoFocus
              className="w-full px-3 py-2 bg-bg-primary border border-border-light rounded text-sm text-text-primary focus:outline-none focus:border-accent transition-colors"
            />
            <div className="flex items-center justify-end gap-2 mt-3">
              <button
                onClick={() => setRenameState(null)}
                className="px-3 py-1.5 rounded text-xs hover:bg-bg-hover text-text-secondary transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleRenameConfirm}
                className="px-3 py-1.5 rounded text-xs bg-accent text-white hover:bg-accent/80 transition-colors"
              >
                确定
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ==================== 子组件 ====================

type TableSortKey = 'name' | 'rows' | 'dataSize'
type SortDir = 'asc' | 'desc'

function TableList({ tables, filteredTables, selectedTable, onSelect, onDoubleClick, onContextMenu }: {
  tables: TableInfo[]
  filteredTables: TableInfo[]
  selectedTable: string | null
  onSelect: (name: string) => void
  onDoubleClick: (name: string) => void
  onContextMenu: (e: React.MouseEvent, tableName: string) => void
}) {
  const [sortKey, setSortKey] = useState<TableSortKey | null>(null)
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  const handleSort = useCallback((key: TableSortKey) => {
    if (sortKey === key) {
      setSortDir((d) => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }, [sortKey])

  const sortedTables = useMemo(() => {
    if (!sortKey) return filteredTables
    const sorted = [...filteredTables].sort((a, b) => {
      let cmp = 0
      if (sortKey === 'name') cmp = a.name.localeCompare(b.name)
      else if (sortKey === 'rows') cmp = (a.rows ?? 0) - (b.rows ?? 0)
      else if (sortKey === 'dataSize') cmp = (a.dataSize ?? 0) - (b.dataSize ?? 0)
      return sortDir === 'asc' ? cmp : -cmp
    })
    return sorted
  }, [filteredTables, sortKey, sortDir])

  if (tables.length === 0 && filteredTables.length === 0) {
    return <EmptyState text="该数据库没有表" />
  }

  const sortIcon = (key: TableSortKey) => {
    if (sortKey !== key) return <ArrowUpDown size={10} className="opacity-30" />
    return sortDir === 'asc' ? <ArrowUp size={10} className="text-accent" /> : <ArrowDown size={10} className="text-accent" />
  }

  return (
    <>
      {/* 列表头 */}
      <div className="flex items-center gap-2 px-3 py-1 border-b border-border-light bg-bg-tertiary/50 text-[10px] text-text-muted select-none flex-shrink-0">
        <span className="flex-1 flex items-center gap-1 cursor-pointer hover:text-text-primary transition-colors" onClick={() => handleSort('name')}>
          <TableIcon size={11} /> 表名 {sortIcon('name')}
        </span>
        <button className="flex items-center gap-0.5 cursor-pointer hover:text-text-primary transition-colors w-14 justify-end" onClick={() => handleSort('rows')} title="按行数排序">
          行数 {sortIcon('rows')}
        </button>
        <button className="flex items-center gap-0.5 cursor-pointer hover:text-text-primary transition-colors w-16 justify-end" onClick={() => handleSort('dataSize')} title="按数据大小排序">
          大小 {sortIcon('dataSize')}
        </button>
      </div>
      {sortedTables.map((table) => (
        <div
          key={table.name}
          onClick={() => onSelect(table.name)}
          onDoubleClick={() => onDoubleClick(table.name)}
          onContextMenu={(e) => onContextMenu(e, table.name)}
          className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer border-b border-border-light/30 transition-colors group ${
            selectedTable === table.name
              ? 'bg-accent/20 border-l-2 border-l-accent'
              : 'hover:bg-bg-hover border-l-2 border-l-transparent'
          }`}
        >
          <TableIcon size={13} className="text-blue-400 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className={`text-xs truncate ${selectedTable === table.name ? 'text-text-primary font-medium' : 'text-text-primary/90'}`}>
                {table.name}
              </span>
              {table.engine && (
                <span className="text-[9px] text-text-muted bg-bg-primary px-1 rounded flex-shrink-0">
                  {table.engine}
                </span>
              )}
            </div>
            {table.comment && (
              <div className="text-[10px] text-text-muted truncate mt-0.5">{table.comment}</div>
            )}
          </div>
          <div className="flex items-center gap-2 text-[10px] text-text-muted flex-shrink-0">
            <span className="w-14 text-right" title="行数">{formatRows(table.rows ?? 0)}</span>
            <span className="w-16 text-right" title="数据大小">{formatBytes(table.dataSize ?? 0)}</span>
          </div>
        </div>
      ))}
    </>
  )
}

function ViewList({ views, filteredViews, selectedTable, onSelect }: {
  views: ViewInfo[]
  filteredViews: ViewInfo[]
  selectedTable: string | null
  onSelect: (name: string) => void
}) {
  if (views.length === 0 && filteredViews.length === 0) {
    return <EmptyState text="该数据库没有视图" />
  }
  return (
    <>
      {filteredViews.map((v) => (
        <div
          key={v.name}
          onClick={() => onSelect(v.name)}
          className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer border-b border-border-light/30 transition-colors ${
            selectedTable === v.name
              ? 'bg-accent/20 border-l-2 border-l-accent'
              : 'hover:bg-bg-hover border-l-2 border-l-transparent'
          }`}
        >
          <Eye size={13} className="text-purple-400 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <span className={`text-xs truncate ${selectedTable === v.name ? 'text-text-primary font-medium' : 'text-text-primary/90'}`}>
              {v.name}
            </span>
          </div>
          {v.updatable && <span className="text-[9px] text-green-400 bg-green-950/40 px-1 rounded">可更新</span>}
          {v.security && <span className="text-[9px] text-text-muted bg-bg-primary px-1 rounded">{v.security}</span>}
        </div>
      ))}
    </>
  )
}

function FunctionList({ routines, filteredRoutines, selectedTable, onSelect }: {
  routines: RoutineInfo[]
  filteredRoutines: RoutineInfo[]
  selectedTable: string | null
  onSelect: (name: string) => void
}) {
  if (routines.length === 0 && filteredRoutines.length === 0) {
    return <EmptyState text="该数据库没有函数或存储过程" />
  }
  return (
    <>
      {filteredRoutines.map((r) => (
        <div
          key={`${r.type}-${r.name}`}
          onClick={() => onSelect(r.name)}
          className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer border-b border-border-light/30 transition-colors ${
            selectedTable === r.name
              ? 'bg-accent/20 border-l-2 border-l-accent'
              : 'hover:bg-bg-hover border-l-2 border-l-transparent'
          }`}
        >
          <FunctionSquare size={13} className={`flex-shrink-0 ${r.type === 'FUNCTION' ? 'text-orange-400' : 'text-yellow-400'}`} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className={`text-xs truncate ${selectedTable === r.name ? 'text-text-primary font-medium' : 'text-text-primary/90'}`}>
                {r.name}
              </span>
              <span className={`text-[9px] px-1 rounded ${r.type === 'FUNCTION' ? 'text-orange-400 bg-orange-950/40' : 'text-yellow-400 bg-yellow-950/40'}`}>
                {r.type === 'FUNCTION' ? 'FN' : 'PROC'}
              </span>
            </div>
            {r.returnType && (
              <div className="text-[10px] text-text-muted truncate mt-0.5">返回: {r.returnType}</div>
            )}
          </div>
          {r.definer && <span className="text-[9px] text-text-muted truncate max-w-[80px]">{r.definer}</span>}
        </div>
      ))}
    </>
  )
}

function EventList({ events, filteredEvents, selectedTable, onSelect }: {
  events: EventInfo[]
  filteredEvents: EventInfo[]
  selectedTable: string | null
  onSelect: (name: string) => void
}) {
  if (events.length === 0 && filteredEvents.length === 0) {
    return <EmptyState text="该数据库没有事件" />
  }
  return (
    <>
      {filteredEvents.map((e) => (
        <div
          key={e.name}
          onClick={() => onSelect(e.name)}
          className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer border-b border-border-light/30 transition-colors ${
            selectedTable === e.name
              ? 'bg-accent/20 border-l-2 border-l-accent'
              : 'hover:bg-bg-hover border-l-2 border-l-transparent'
          }`}
        >
          <CalendarClock size={13} className="text-green-400 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className={`text-xs truncate ${selectedTable === e.name ? 'text-text-primary font-medium' : 'text-text-primary/90'}`}>
                {e.name}
              </span>
              {e.status && (
                <span className={`text-[9px] px-1 rounded ${e.status === 'ENABLED' ? 'text-green-400 bg-green-950/40' : 'text-red-400 bg-red-950/40'}`}>
                  {e.status}
                </span>
              )}
            </div>
            {(e.type || e.lastExecuted) && (
              <div className="text-[10px] text-text-muted truncate mt-0.5">
                {e.type === 'RECURRING' ? '循环' : '一次性'}
                {e.lastExecuted && ` · 最后执行: ${e.lastExecuted}`}
              </div>
            )}
          </div>
        </div>
      ))}
    </>
  )
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-8 text-text-muted text-xs gap-2">
      <span>{text}</span>
    </div>
  )
}

function QueryList() {
  const {
    savedQueries,
    selectedDatabase,
    selectedQueryId,
    selectQuery,
    deleteQuery,
    setActiveQuerySql,
    selectedTable,
    selectTable
  } = useBrowserStore()

  // 只显示当前数据库的查询
  const dbQueries = savedQueries.filter((q) => q.database === selectedDatabase)

  if (dbQueries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-text-muted text-xs gap-2">
        <Terminal size={28} className="opacity-20" />
        <span>暂无保存的查询</span>
        <span className="text-[10px]">在右侧编辑器输入 SQL 后点击「保存」</span>
      </div>
    )
  }

  return (
    <>
      {dbQueries.map((q) => (
        <div
          key={q.id}
          onClick={() => { selectQuery(q.id); selectTable(null) }}
          className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer border-b border-border-light/30 transition-colors group ${
            selectedQueryId === q.id
              ? 'bg-accent/20 border-l-2 border-l-accent'
              : 'hover:bg-bg-hover border-l-2 border-l-transparent'
          }`}
        >
          <Bookmark size={13} className="text-yellow-400 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <span className={`text-xs truncate block ${selectedQueryId === q.id ? 'text-text-primary font-medium' : 'text-text-primary/90'}`}>
              {q.name}
            </span>
            <span className="text-[10px] text-text-muted truncate block font-mono mt-0.5">
              {q.sql.split('\n')[0].slice(0, 60)}
              {q.sql.length > 60 ? '...' : ''}
            </span>
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); deleteQuery(q.id) }}
            className="opacity-0 group-hover:opacity-100 text-text-muted hover:text-red-400 transition-all flex-shrink-0"
            title="删除查询"
          >
            <Trash2 size={12} />
          </button>
        </div>
      ))}
    </>
  )
}

function SnippetList() {
  const { snippets, selectedSnippetId, selectSnippet, deleteSnippet } = useSnippetStore()
  const selectTable = useBrowserStore((s) => s.selectTable)

  if (snippets.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-text-muted text-xs gap-2">
        <FileCode2 size={28} className="opacity-20" />
        <span>暂无 SQL 片段</span>
        <span className="text-[10px]">在右侧面板创建常用 SQL 模板</span>
      </div>
    )
  }

  return (
    <>
      {snippets.map((s: any) => (
        <div
          key={s.id}
          onClick={() => { selectSnippet(s.id); selectTable(s.name) }}
          className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer border-b border-border-light/30 transition-colors group ${
            selectedSnippetId === s.id
              ? 'bg-accent/20 border-l-2 border-l-accent'
              : 'hover:bg-bg-hover border-l-2 border-l-transparent'
          }`}
        >
          <FileCode2 size={13} className="text-blue-400 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <span className={`text-xs truncate block ${selectedSnippetId === s.id ? 'text-text-primary font-medium' : 'text-text-primary/90'}`}>
              {s.name}
            </span>
            <span className="text-[10px] text-text-muted truncate block font-mono mt-0.5">
              {s.sql.split('\n')[0].slice(0, 50)}{s.sql.length > 50 ? '…' : ''}
            </span>
          </div>
          <span className="text-[9px] text-text-muted bg-bg-primary px-1 rounded flex-shrink-0">{s.category}</span>
          <button
            onClick={(e) => { e.stopPropagation(); if (confirm('删除此片段？')) deleteSnippet(s.id) }}
            className="opacity-0 group-hover:opacity-100 text-text-muted hover:text-red-400 transition-all flex-shrink-0"
            title="删除片段"
          >
            <Trash2 size={12} />
          </button>
        </div>
      ))}
    </>
  )
}
