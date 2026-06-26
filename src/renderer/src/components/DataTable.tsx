import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import DataGrid, { type Column, type SortColumn, type RowsChangeData, textEditor } from 'react-data-grid'
import 'react-data-grid/lib/styles.css'
import {
  RefreshCw,
  Loader2,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  AlertCircle,
  Filter,
  ArrowUp,
  ArrowDown,
  Key,
  Plus,
  Trash2,
  Check,
  Undo2,
  Square,
  X,
  PanelBottomOpen,
  PanelBottomClose,
  Download,
  Upload,
  ChevronDown
} from 'lucide-react'
import { useConnectionStore } from '@stores/connection'
import type { Tab, ColumnInfo, QueryResult } from '@shared/types'

interface Props {
  tab: Tab
}

const PAGE_SIZE = 100
type SortDir = 'ASC' | 'DESC' | null

type FilterOp = '=' | '!=' | '>' | '>=' | '<' | '<=' | 'LIKE' | 'NOT LIKE' | 'IS NULL' | 'IS NOT NULL'
type FilterLogic = 'AND' | 'OR'

interface FilterCondition {
  id: string
  /** 与上一条件的连接方式（第一个条件忽略此字段） */
  logic: FilterLogic
  column: string
  op: FilterOp
  value: string
}

const FILTER_OPS: { value: FilterOp; label: string; needsValue: boolean }[] = [
  { value: '=', label: '=  等于', needsValue: true },
  { value: '!=', label: '!= 不等于', needsValue: true },
  { value: '>', label: '>  大于', needsValue: true },
  { value: '>=', label: '>= 大于等于', needsValue: true },
  { value: '<', label: '<  小于', needsValue: true },
  { value: '<=', label: '<= 小于等于', needsValue: true },
  { value: 'LIKE', label: 'LIKE 包含', needsValue: true },
  { value: 'NOT LIKE', label: 'NOT LIKE 不包含', needsValue: true },
  { value: 'IS NULL', label: 'IS NULL 为空', needsValue: false },
  { value: 'IS NOT NULL', label: 'IS NOT NULL 不为空', needsValue: false }
]

function isDateType(type: string): boolean {
  const t = type.toLowerCase()
  return t.includes('date') || t.includes('time') || t.includes('timestamp')
}

interface RowData {
  _row_key: string
  _row_num: number
  [key: string]: unknown
}

let rowKeyCounter = 0

function genRowKey(): string {
  rowKeyCounter++
  return `r${Date.now()}_${rowKeyCounter}`
}

function escapeVal(val: unknown): string {
  if (val === null || val === undefined || val === '') return 'NULL'
  const str = String(val)
  if (/^-?\d+(\.\d+)?$/.test(str)) return str
  return `'${str.replace(/'/g, "\\'")}'`
}

export default function DataTable({ tab }: Props) {
  const connections = useConnectionStore((s) => s.connections)
  const config = connections.find((c) => c.id === tab.connectionId)

  const [columns, setColumns] = useState<ColumnInfo[]>([])
  const [result, setResult] = useState<QueryResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const [totalRows, setTotalRows] = useState(0)
  const [sortCol, setSortCol] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<SortDir>(null)
  const [sortColumns, setSortColumns] = useState<SortColumn[]>([])

  // 字段筛选
  const [showFilter, setShowFilter] = useState(false)
  const [conditions, setConditions] = useState<FilterCondition[]>([])
  const [appliedConditions, setAppliedConditions] = useState<FilterCondition[]>([])

  // 工作行数据 + 暂存状态
  const [rows, setRows] = useState<RowData[]>([])
  const [snapshot, setSnapshot] = useState<RowData[]>([])
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set())
  const [dirtyKeys, setDirtyKeys] = useState<Set<string>>(new Set())
  const [newKeys, setNewKeys] = useState<Set<string>>(new Set())
  const [pendingDeletes, setPendingDeletes] = useState<RowData[]>([])
  const [snapshotMap, setSnapshotMap] = useState<Map<string, RowData>>(new Map())
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // 单元格右键菜单
  const [cellMenu, setCellMenu] = useState<{ x: number; y: number; rowKey: string; colName: string; colType: string } | null>(null)
  const [datePicker, setDatePicker] = useState<{ rowKey: string; colName: string; value: string } | null>(null)

  // 底部字段编辑器
  const [showEditor, setShowEditor] = useState(false)
  const [editorRowKey, setEditorRowKey] = useState<string | null>(null)
  const [editorColName, setEditorColName] = useState<string | null>(null)

  // 导出/导入下拉菜单
  const [showExportMenu, setShowExportMenu] = useState(false)

  const abortRef = useRef(false)
  const msgTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const pendingCount = dirtyKeys.size + newKeys.size + pendingDeletes.length

  const showMsg = useCallback((type: 'success' | 'error', text: string) => {
    setStatusMsg({ type, text })
    if (msgTimerRef.current) clearTimeout(msgTimerRef.current)
    msgTimerRef.current = setTimeout(() => setStatusMsg(null), 3000)
  }, [])

  // ==================== 数据加载 ====================

  const loadData = useCallback(async () => {
    if (!config || !tab.database || !tab.table) return
    abortRef.current = false
    setLoading(true)
    setError(null)
    setDirtyKeys(new Set())
    setNewKeys(new Set())
    setPendingDeletes([])
    setSelectedRows(new Set())

    try {
      const colRes = await window.api.db.getTableColumns(config, tab.database, tab.table)
      if (!colRes.success) throw new Error(colRes.error)
      setColumns(colRes.data ?? [])

      if (abortRef.current) return

      const countRes = await window.api.db.getTableRowCount(config, tab.database, tab.table)
      if (countRes.success && countRes.data !== undefined) {
        setTotalRows(countRes.data)
      }

      if (abortRef.current) return

      let sql = `SELECT * FROM \`${tab.table}\``
      if (appliedConditions.length > 0) {
        const whereParts: string[] = []
        appliedConditions.forEach((cond, i) => {
          let part = ''
          if (cond.op === 'IS NULL') {
            part = `\`${cond.column}\` IS NULL`
          } else if (cond.op === 'IS NOT NULL') {
            part = `\`${cond.column}\` IS NOT NULL`
          } else if (cond.op === 'LIKE' || cond.op === 'NOT LIKE') {
            const v = cond.value.replace(/'/g, "\\'")
            part = `\`${cond.column}\` ${cond.op} '%${v}%'`
          } else {
            const v = escapeVal(cond.value)
            part = `\`${cond.column}\` ${cond.op} ${v}`
          }
          if (i === 0) {
            whereParts.push(part)
          } else {
            whereParts.push(`${cond.logic} ${part}`)
          }
        })
        sql += ` WHERE ${whereParts.join(' ')}`
      }
      if (sortCol && sortDir) sql += ` ORDER BY \`${sortCol}\` ${sortDir}`
      sql += ` LIMIT ${PAGE_SIZE} OFFSET ${page * PAGE_SIZE}`

      const res = await window.api.db.query(config, sql, tab.database)
      if (abortRef.current) return
      if (!res.success) throw new Error(res.error)
      setResult(res.data ?? null)
    } catch (err) {
      if (!abortRef.current) setError((err as Error).message)
    } finally {
      if (!abortRef.current) setLoading(false)
    }
  }, [config, tab.database, tab.table, page, appliedConditions, sortCol, sortDir])

  useEffect(() => {
    loadData()
  }, [loadData])

  // 数据加载后初始化 rows + snapshot
  useEffect(() => {
    if (!result?.rows) {
      setRows([])
      setSnapshot([])
      setSnapshotMap(new Map())
      return
    }
    const newRows: RowData[] = result.rows.map((row, idx) => {
      const key = genRowKey()
      return { _row_key: key, _row_num: page * PAGE_SIZE + idx + 1, ...row }
    })
    setRows(newRows)
    setSnapshot(newRows)
    const smap = new Map<string, RowData>()
    newRows.forEach((r) => smap.set(r._row_key, { ...r }))
    setSnapshotMap(smap)
  }, [result, page])

  // ==================== 停止查询 ====================

  const handleStop = useCallback(() => {
    abortRef.current = true
    setLoading(false)
    showMsg('error', '查询已停止')
  }, [showMsg])

  // ==================== 增加 ====================

  const handleAddRow = useCallback(() => {
    const key = genRowKey()
    const emptyRow: RowData = { _row_key: key, _row_num: 0 }
    columns.forEach((col) => {
      emptyRow[col.name] = col.defaultValue ?? null
    })
    setRows((prev) => [...prev, emptyRow])
    setNewKeys((prev) => new Set(prev).add(key))
    setSelectedRows(new Set([key]))
  }, [columns])

  // ==================== 删除 ====================

  const handleDeleteRows = useCallback(() => {
    if (selectedRows.size === 0) {
      showMsg('error', '请先选择要删除的行')
      return
    }
    const toDelete: RowData[] = []
    const remaining: RowData[] = []
    const newDirty = new Set(dirtyKeys)
    const newNewKeys = new Set(newKeys)

    rows.forEach((row) => {
      if (selectedRows.has(row._row_key)) {
        if (newNewKeys.has(row._row_key)) {
          // 新增的行直接移除，不需要 DELETE
          newNewKeys.delete(row._row_key)
          newDirty.delete(row._row_key)
        } else {
          toDelete.push(row)
        }
      } else {
        remaining.push(row)
      }
    })

    setRows(remaining)
    setPendingDeletes((prev) => [...prev, ...toDelete])
    setDirtyKeys(newDirty)
    setNewKeys(newNewKeys)
    setSelectedRows(new Set())
  }, [selectedRows, rows, dirtyKeys, newKeys, showMsg])

  // ==================== 单元格编辑 ====================

  const handleRowsChange = useCallback(
    (newRows: RowData[], changes: RowsChangeData<RowData>) => {
      const { indexes, column } = changes
      const colName = column.key
      if (colName === '_row_num' || colName === '_row_key') {
        setRows(newRows)
        return
      }
      setRows(newRows)

      // 标记脏行（如果不是新增行）
      const newDirty = new Set(dirtyKeys)
      for (const idx of indexes) {
        const r = newRows[idx]
        if (!newKeys.has(r._row_key)) {
          newDirty.add(r._row_key)
        }
      }
      setDirtyKeys(newDirty)
    },
    [dirtyKeys, newKeys]
  )

  // ==================== 单元格右键操作 ====================

  const setCellValue = useCallback((rowKey: string, colName: string, value: unknown) => {
    setRows((prev) => {
      const newRows = [...prev]
      const idx = newRows.findIndex((r) => r._row_key === rowKey)
      if (idx < 0) return prev
      newRows[idx] = { ...newRows[idx], [colName]: value }
      return newRows
    })
    setDirtyKeys((prev) => {
      const next = new Set(prev)
      if (!newKeys.has(rowKey)) next.add(rowKey)
      return next
    })
  }, [newKeys])

  const handleCellContextMenu = useCallback((e: React.MouseEvent, rowKey: string, colName: string, colType: string) => {
    if (colName === '_row_num' || colName === '_row_key') return
    e.preventDefault()
    e.stopPropagation()
    setCellMenu({ x: e.clientX, y: e.clientY, rowKey, colName, colType })
  }, [])

  const handleSetNull = useCallback(() => {
    if (!cellMenu) return
    setCellValue(cellMenu.rowKey, cellMenu.colName, null)
    setCellMenu(null)
  }, [cellMenu, setCellValue])

  const handleSetEmpty = useCallback(() => {
    if (!cellMenu) return
    setCellValue(cellMenu.rowKey, cellMenu.colName, '')
    setCellMenu(null)
  }, [cellMenu, setCellValue])

  const handleOpenDatePicker = useCallback(() => {
    if (!cellMenu) return
    const row = rows.find((r) => r._row_key === cellMenu.rowKey)
    const currentVal = row?.[cellMenu.colName]
    const dateStr = currentVal ? new Date(currentVal as string).toISOString().slice(0, 16) : ''
    setDatePicker({ rowKey: cellMenu.rowKey, colName: cellMenu.colName, value: dateStr })
    setCellMenu(null)
  }, [cellMenu, rows])

  const handleDatePickerConfirm = useCallback(() => {
    if (!datePicker) return
    // 将 datetime-local 格式转换为 MySQL 格式: YYYY-MM-DD HH:MM:SS
    let val: string
    if (datePicker.value) {
      const d = new Date(datePicker.value)
      const pad = (n: number) => String(n).padStart(2, '0')
      val = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
    } else {
      val = ''
    }
    setCellValue(datePicker.rowKey, datePicker.colName, val || null)
    setDatePicker(null)
  }, [datePicker, setCellValue])

  // ==================== Commit ====================

  const handleCommit = useCallback(async () => {
    if (pendingCount === 0) {
      showMsg('error', '没有待提交的更改')
      return
    }
    if (!config || !tab.database || !tab.table) return

    const sqls: string[] = []
    let opCount = 0

    // 1. DELETE
    for (const row of pendingDeletes) {
      const where = buildWhereClause(row, columns)
      if (where) {
        sqls.push(`DELETE FROM \`${tab.table}\` WHERE ${where}`)
        opCount++
      }
    }

    // 2. INSERT
    for (const row of rows) {
      if (newKeys.has(row._row_key)) {
        const colNames = columns.map((c) => `\`${c.name}\``).join(', ')
        const colVals = columns.map((c) => escapeVal(row[c.name])).join(', ')
        sqls.push(`INSERT INTO \`${tab.table}\` (${colNames}) VALUES (${colVals})`)
        opCount++
      }
    }

    // 3. UPDATE
    for (const row of rows) {
      if (dirtyKeys.has(row._row_key)) {
        const orig = snapshotMap.get(row._row_key)
        if (!orig) continue
        const changedCols = columns
          .filter((c) => row[c.name] !== orig[c.name])
          .map((c) => `\`${c.name}\` = ${escapeVal(row[c.name])}`)
        if (changedCols.length === 0) continue
        const where = buildWhereClause(orig, columns)
        if (where) {
          sqls.push(`UPDATE \`${tab.table}\` SET ${changedCols.join(', ')} WHERE ${where}`)
          opCount++
        }
      }
    }

    if (sqls.length === 0) {
      showMsg('error', '没有可执行的更改')
      return
    }

    setLoading(true)
    let failCount = 0
    for (const sql of sqls) {
      const res = await window.api.db.query(config, sql, tab.database)
      if (!res.success) {
        failCount++
        showMsg('error', `执行失败 (${failCount}/${opCount}): ${res.error}`)
        break
      }
    }
    setLoading(false)

    if (failCount === 0) {
      showMsg('success', `成功提交 ${opCount} 条更改`)
      await loadData()
    }
  }, [pendingCount, config, tab.database, tab.table, pendingDeletes, rows, newKeys, dirtyKeys, columns, snapshotMap, loadData, showMsg])

  // ==================== Rollback ====================

  const handleRollback = useCallback(() => {
    if (pendingCount === 0) {
      showMsg('error', '没有待回滚的更改')
      return
    }
    // 恢复到快照
    setRows(snapshot.map((r) => ({ ...r })))
    setDirtyKeys(new Set())
    setNewKeys(new Set())
    setPendingDeletes([])
    setSelectedRows(new Set())
    showMsg('success', '已回滚所有更改')
  }, [pendingCount, snapshot, showMsg])

  // ==================== WHERE 构建 ====================

  function buildWhereClause(row: RowData, cols: ColumnInfo[]): string | null {
    const pkCols = cols.filter((c) => c.isPrimaryKey)
    const useCols = pkCols.length > 0 ? pkCols : cols
    const conds = useCols.map((c) => {
      const v = row[c.name]
      if (v === null || v === undefined) return `\`${c.name}\` IS NULL`
      return `\`${c.name}\` = ${escapeVal(v)}`
    })
    return conds.length > 0 ? conds.join(' AND ') : null
  }

  // ==================== 导出 ====================

  const handleExport = useCallback(async (format: 'csv' | 'json' | 'sql') => {
    setShowExportMenu(false)
    if (!config || !tab.database || !tab.table) return
    try {
      // 查询全表数据（含筛选条件）
      let sql = `SELECT * FROM \`${tab.table}\``
      if (appliedConditions.length > 0) {
        const whereParts: string[] = []
        appliedConditions.forEach((cond, i) => {
          let part = ''
          if (cond.op === 'IS NULL') part = `\`${cond.column}\` IS NULL`
          else if (cond.op === 'IS NOT NULL') part = `\`${cond.column}\` IS NOT NULL`
          else if (cond.op === 'LIKE' || cond.op === 'NOT LIKE') part = `\`${cond.column}\` ${cond.op} '%${cond.value.replace(/'/g, "\\'")}%'`
          else part = `\`${cond.column}\` ${cond.op} ${escapeVal(cond.value)}`
          whereParts.push(i === 0 ? part : `${cond.logic} ${part}`)
        })
        sql += ` WHERE ${whereParts.join(' ')}`
      }
      const res = await window.api.db.query(config, sql, tab.database)
      if (!res.success || !res.data) { showMsg('error', `导出失败: ${res.error}`); return }

      const dataRows = res.data.rows
      const cols = (res.data.columns ?? []).map((c) => c.name)
      let content = ''
      let ext = format

      if (format === 'csv') {
        content = [cols.join(',')].concat(
          dataRows.map((row) => cols.map((c) => {
            const v = row[c]
            if (v === null || v === undefined) return ''
            const s = String(v)
            // 含逗号/引号/换行需加引号转义
            return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
          }).join(','))
        ).join('\n')
      } else if (format === 'json') {
        const jsonRows = dataRows.map((row) => {
          const obj: Record<string, unknown> = {}
          cols.forEach((c) => obj[c] = row[c])
          return obj
        })
        content = JSON.stringify(jsonRows, null, 2)
      } else if (format === 'sql') {
        const colNames = cols.map((c) => `\`${c}\``).join(', ')
        content = `-- nexSQL 导出\n-- 数据库: ${tab.database}\n-- 表: ${tab.table}\n-- 生成时间: ${new Date().toLocaleString()}\n\n`
        content += `DROP TABLE IF EXISTS \`${tab.table}\`;\n`
        const ddlRes = await window.api.db.getTableDDL(config, tab.database, tab.table)
        if (ddlRes.success && ddlRes.data) content += ddlRes.data + ';\n\n'
        if (dataRows.length > 0) {
          for (const row of dataRows) {
            const vals = cols.map((c) => escapeVal(row[c]))
            content += `INSERT INTO \`${tab.table}\` (${colNames}) VALUES (${vals.join(', ')});\n`
          }
        }
      }

      const saveRes = await window.api.file.saveDialog(`${tab.table}_export.${ext}`, content, ext)
      if (saveRes.success && saveRes.data?.saved) {
        showMsg('success', `导出成功 (${dataRows.length} 行)`)
      }
    } catch (err) {
      showMsg('error', `导出失败: ${(err as Error).message}`)
    }
  }, [config, tab, appliedConditions, showMsg])

  // ==================== 导入 ====================

  const handleImport = useCallback(async (format: 'csv' | 'json' | 'sql') => {
    setShowExportMenu(false)
    if (!config || !tab.database || !tab.table) return
    try {
      const openRes = await window.api.file.openDialog(format)
      if (!openRes.success || openRes.data?.canceled) return
      const content = openRes.data!.content
      if (!content.trim()) { showMsg('error', '文件内容为空'); return }

      setLoading(true)
      let insertCount = 0
      const colNames = columns.map((c) => `\`${c.name}\``).join(', ')

      if (format === 'sql') {
        // 按 ; 分割执行
        const statements = content.split(';').map((s) => s.trim()).filter((s) => s && !s.startsWith('--'))
        for (const stmt of statements) {
          const res = await window.api.db.query(config, stmt, tab.database)
          if (res.success) insertCount += res.data?.affectedRows ?? 0
        }
      } else if (format === 'csv') {
        const lines = content.split('\n').filter((l) => l.trim())
        if (lines.length < 2) { showMsg('error', 'CSV 至少需要标题行 + 1 行数据'); setLoading(false); return }
        // CSV 解析（支持引号包裹的逗号）
        const parseCSVLine = (line: string): string[] => {
          const result: string[] = []
          let current = ''
          let inQuotes = false
          for (let i = 0; i < line.length; i++) {
            const ch = line[i]
            if (ch === '"') {
              if (inQuotes && line[i + 1] === '"') { current += '"'; i++ }
              else inQuotes = !inQuotes
            } else if (ch === ',' && !inQuotes) {
              result.push(current); current = ''
            } else {
              current += ch
            }
          }
          result.push(current)
          return result
        }
        const headers = parseCSVLine(lines[0])
        for (let i = 1; i < lines.length; i++) {
          const values = parseCSVLine(lines[i])
          const vals = columns.map((c) => {
            const idx = headers.indexOf(c.name)
            if (idx < 0 || idx >= values.length) return 'NULL'
            const v = values[idx].trim()
            if (v === '') return 'NULL'
            return escapeVal(v)
          }).join(', ')
          const res = await window.api.db.query(config, `INSERT INTO \`${tab.table}\` (${colNames}) VALUES (${vals})`, tab.database)
          if (res.success) insertCount++
        }
      } else if (format === 'json') {
        const items = JSON.parse(content)
        if (!Array.isArray(items)) { showMsg('error', 'JSON 必须是数组'); setLoading(false); return }
        for (const item of items) {
          const vals = columns.map((c) => escapeVal((item as Record<string, unknown>)[c.name])).join(', ')
          const res = await window.api.db.query(config, `INSERT INTO \`${tab.table}\` (${colNames}) VALUES (${vals})`, tab.database)
          if (res.success) insertCount++
        }
      }

      showMsg('success', `导入成功 (${insertCount} 行)`)
      await loadData()
    } catch (err) {
      showMsg('error', `导入失败: ${(err as Error).message}`)
    } finally {
      setLoading(false)
    }
  }, [config, tab, columns, loadData, showMsg])

  // 监听菜单栏导入/导出事件
  useEffect(() => {
    const onImport = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail?.format) handleImport(detail.format)
    }
    const onExport = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail?.format) handleExport(detail.format)
    }
    window.addEventListener('nexsql-import', onImport)
    window.addEventListener('nexsql-export', onExport)
    return () => {
      window.removeEventListener('nexsql-import', onImport)
      window.removeEventListener('nexsql-export', onExport)
    }
  }, [handleImport, handleExport])

  // ==================== 列定义 ====================

  const gridColumns = useMemo((): Column<RowData>[] => {
    const cols: Column<RowData>[] = [
      {
        key: '_row_num',
        name: '#',
        width: 50,
        frozen: true,
        resizable: false
      },
      ...columns.map<Column<RowData>>((col) => ({
        key: col.name,
        name: col.name,
        width: 150,
        resizable: true,
        editable: true,
        renderEditCell: textEditor,
        editorOptions: { commitOnOutsideClick: true },
        renderHeaderCell: () => (
          <div className="flex items-center gap-1 w-full">
            {col.isPrimaryKey && <Key size={10} className="text-yellow-400 flex-shrink-0" />}
            <span className={col.isPrimaryKey ? 'text-yellow-400 font-medium' : ''}>{col.name}</span>
            <span className="text-text-muted text-[10px] font-normal">{col.type}</span>
          </div>
        ),
        renderCell: ({ row }) => {
          const val = row[col.name]
          const isSelected = editorRowKey === row._row_key && editorColName === col.name
          const baseClass = isSelected ? 'ring-1 ring-accent/60' : ''
          if (val === null || val === undefined) {
            return (
              <div
                onClick={() => { setEditorRowKey(row._row_key); setEditorColName(col.name) }}
                onContextMenu={(e) => handleCellContextMenu(e, row._row_key, col.name, col.type)}
                className={`w-full h-full flex items-center ${baseClass}`}
              >
                <span className="text-text-muted italic">NULL</span>
              </div>
            )
          }
          const str = typeof val === 'object' ? JSON.stringify(val) : String(val)
          return (
            <div
              onClick={() => { setEditorRowKey(row._row_key); setEditorColName(col.name) }}
              onContextMenu={(e) => handleCellContextMenu(e, row._row_key, col.name, col.type)}
              className={`w-full h-full flex items-center ${baseClass}`}
              title={str}
            >
              <span className="truncate block">{str}</span>
            </div>
          )
        }
      }))
    ]
    return cols
  }, [columns, editorRowKey, editorColName, handleCellContextMenu])

  const rowKeyGetter = useCallback((row: RowData) => row._row_key, [])

  // ==================== 行样式（标记新增/修改/删除）====================

  const rowClass = useCallback((row: RowData) => {
    if (newKeys.has(row._row_key)) return 'rdg-row-new'
    if (dirtyKeys.has(row._row_key)) return 'rdg-row-dirty'
    return ''
  }, [newKeys, dirtyKeys])

  // ==================== 排序/筛选 ====================

  const handleSortChange = useCallback((newSortColumns: SortColumn[]) => {
    setSortColumns(newSortColumns)
    if (newSortColumns.length > 0) {
      const sc = newSortColumns[0]
      if (sc.columnKey === '_row_num') {
        setSortCol(null)
        setSortDir(null)
      } else {
        setSortCol(sc.columnKey)
        setSortDir(sc.direction === 'ASC' ? 'ASC' : 'DESC')
      }
    } else {
      setSortCol(null)
      setSortDir(null)
    }
    setPage(0)
  }, [])

  // ==================== 字段筛选操作 ====================

  const addCondition = useCallback(() => {
    if (columns.length === 0) return
    const id = `f_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    setConditions((prev) => [...prev, { id, logic: 'AND', column: columns[0].name, op: '=', value: '' }])
  }, [columns])

  const removeCondition = useCallback((id: string) => {
    setConditions((prev) => prev.filter((c) => c.id !== id))
  }, [])

  const updateCondition = useCallback((id: string, field: keyof FilterCondition, value: string) => {
    setConditions((prev) => prev.map((c) => (c.id === id ? { ...c, [field]: value } : c)))
  }, [])

  const applyFilter = useCallback(() => {
    const valid = conditions.filter((c) => {
      const op = FILTER_OPS.find((o) => o.value === c.op)
      if (!op) return false
      if (op.needsValue && !c.value.trim()) return false
      return true
    })
    setAppliedConditions(valid)
    setPage(0)
  }, [conditions])

  const clearFilter = useCallback(() => {
    setConditions([])
    setAppliedConditions([])
    setPage(0)
  }, [])

  const totalPages = Math.max(1, Math.ceil(totalRows / PAGE_SIZE))
  const startRow = totalRows === 0 ? 0 : page * PAGE_SIZE + 1
  const endRow = Math.min((page + 1) * PAGE_SIZE, totalRows)

  // ==================== 工具栏按钮样式 ====================

  const tbBtn = "flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
  const tbIconBtn = "flex items-center justify-center p-1.5 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"

  return (
    <div className="flex flex-col h-full">
      {/* 工具栏 */}
      <div className="flex items-center gap-1 px-2 py-1 border-b border-border-light bg-bg-secondary flex-shrink-0">
        {/* 刷新 / 停止 */}
        {loading ? (
          <button
            onClick={handleStop}
            className={`${tbIconBtn} hover:bg-red-900/50 text-red-400`}
            title="停止查询"
          >
            <Square size={14} fill="currentColor" />
          </button>
        ) : (
          <button
            onClick={loadData}
            className={`${tbIconBtn} hover:bg-bg-hover text-text-secondary hover:text-text-primary`}
            title="刷新"
          >
            <RefreshCw size={14} />
          </button>
        )}

        <div className="h-4 w-px bg-border-light mx-1" />

        {/* 增加 */}
        <button
          onClick={handleAddRow}
          disabled={loading || columns.length === 0}
          className={`${tbBtn} hover:bg-bg-hover text-text-secondary hover:text-green-400`}
          title="增加行"
        >
          <Plus size={14} />
        </button>

        {/* 删除 */}
        <button
          onClick={handleDeleteRows}
          disabled={loading || selectedRows.size === 0}
          className={`${tbBtn} hover:bg-bg-hover text-text-secondary hover:text-red-400`}
          title="删除选中行"
        >
          <Trash2 size={14} />
        </button>

        <div className="h-4 w-px bg-border-light mx-1" />

        {/* Commit */}
        <button
          onClick={handleCommit}
          disabled={loading || pendingCount === 0}
          className={`${tbBtn} hover:bg-green-900/40 text-text-secondary hover:text-green-400`}
          title="提交更改"
        >
          <Check size={14} />
          <span>提交</span>
        </button>

        {/* Rollback */}
        <button
          onClick={handleRollback}
          disabled={loading || pendingCount === 0}
          className={`${tbBtn} hover:bg-bg-hover text-text-secondary hover:text-yellow-400`}
          title="回滚更改"
        >
          <Undo2 size={14} />
          <span>回滚</span>
        </button>

        {/* 待提交计数 */}
        {pendingCount > 0 && (
          <span className="ml-1 px-1.5 py-0.5 bg-yellow-900/50 text-yellow-400 rounded text-[10px] font-medium">
            {pendingCount} 待提交
          </span>
        )}

        <div className="h-4 w-px bg-border-light mx-1" />

        {/* 筛选按钮 */}
        <button
          onClick={() => setShowFilter((v) => !v)}
          className={`${tbBtn} hover:bg-bg-hover text-text-secondary hover:text-text-primary ${showFilter || appliedConditions.length > 0 ? 'bg-accent/20 text-accent' : ''}`}
          title="字段筛选"
        >
          <Filter size={14} />
          {appliedConditions.length > 0 && (
            <span className="text-[10px]">{appliedConditions.length}</span>
          )}
        </button>

        {/* 底部编辑器切换 */}
        <button
          onClick={() => setShowEditor((v) => !v)}
          className={`${tbBtn} hover:bg-bg-hover text-text-secondary hover:text-text-primary ${showEditor ? 'bg-accent/20 text-accent' : ''}`}
          title="底部字段编辑器"
        >
          {showEditor ? <PanelBottomClose size={14} /> : <PanelBottomOpen size={14} />}
        </button>

        {/* 导入 */}
        <button
          onClick={() => handleImport('csv')}
          disabled={loading || columns.length === 0}
          className={`${tbBtn} hover:bg-bg-hover text-text-secondary hover:text-text-primary`}
          title="导入 CSV"
        >
          <Upload size={14} />
        </button>

        {/* 导出（下拉菜单） */}
        <div className="relative">
          <button
            onClick={() => setShowExportMenu((v) => !v)}
            disabled={loading || columns.length === 0}
            className={`${tbBtn} hover:bg-bg-hover text-text-secondary hover:text-text-primary`}
            title="导出数据"
          >
            <Download size={14} />
            <ChevronDown size={10} />
          </button>
          {showExportMenu && (
            <div className="absolute top-full left-0 mt-1 z-50 bg-bg-tertiary border border-border rounded-md shadow-2xl py-1 min-w-[120px]">
              <button onClick={() => handleExport('csv')} className="w-full text-left px-3 py-1.5 text-xs text-text-primary hover:bg-bg-hover transition-colors">导出 CSV</button>
              <button onClick={() => handleExport('json')} className="w-full text-left px-3 py-1.5 text-xs text-text-primary hover:bg-bg-hover transition-colors">导出 JSON</button>
              <button onClick={() => handleExport('sql')} className="w-full text-left px-3 py-1.5 text-xs text-text-primary hover:bg-bg-hover transition-colors">导出 SQL</button>
              <div className="h-px bg-border-light my-1" />
              <button onClick={() => handleImport('csv')} className="w-full text-left px-3 py-1.5 text-xs text-text-primary hover:bg-bg-hover transition-colors">导入 CSV</button>
              <button onClick={() => handleImport('json')} className="w-full text-left px-3 py-1.5 text-xs text-text-primary hover:bg-bg-hover transition-colors">导入 JSON</button>
              <button onClick={() => handleImport('sql')} className="w-full text-left px-3 py-1.5 text-xs text-text-primary hover:bg-bg-hover transition-colors">导入 SQL</button>
            </div>
          )}
        </div>

        {/* 分页 */}
        <div className="ml-auto flex items-center gap-2 text-xs text-text-secondary">
          {loading ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <>
              <span>
                {startRow}-{endRow} / {totalRows}
              </span>
              <div className="flex items-center gap-0.5">
                <button onClick={() => setPage(0)} disabled={page === 0} className="p-1 hover:bg-bg-hover rounded transition-colors disabled:opacity-30">
                  <ChevronsLeft size={14} />
                </button>
                <button onClick={() => setPage(page - 1)} disabled={page === 0} className="p-1 hover:bg-bg-hover rounded transition-colors disabled:opacity-30">
                  <ChevronLeft size={14} />
                </button>
                <span className="px-1">{page + 1}/{totalPages}</span>
                <button onClick={() => setPage(page + 1)} disabled={page >= totalPages - 1} className="p-1 hover:bg-bg-hover rounded transition-colors disabled:opacity-30">
                  <ChevronRight size={14} />
                </button>
                <button onClick={() => setPage(totalPages - 1)} disabled={page >= totalPages - 1} className="p-1 hover:bg-bg-hover rounded transition-colors disabled:opacity-30">
                  <ChevronsRight size={14} />
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* 字段筛选面板 */}
      {showFilter && (
        <div className="border-b border-border-light bg-bg-tertiary/50 flex-shrink-0">
          <div className="px-3 py-2">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-medium text-text-secondary">字段筛选条件</span>
                <div className="flex items-center gap-1">
                  <button onClick={addCondition} className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] hover:bg-bg-hover text-text-secondary hover:text-accent transition-colors">
                    <Plus size={11} /> 添加条件
                  </button>
                  <button onClick={applyFilter} className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] bg-accent/20 text-accent hover:bg-accent/30 transition-colors">
                    <Check size={11} /> 应用
                  </button>
                  {conditions.length > 0 && (
                    <button onClick={clearFilter} className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] hover:bg-bg-hover text-text-secondary hover:text-red-400 transition-colors">
                      <X size={11} /> 清除
                    </button>
                  )}
                </div>
              </div>
            </div>
            {conditions.length === 0 ? (
              <div className="text-[11px] text-text-muted py-2 text-center">点击「添加条件」创建筛选规则</div>
            ) : (
              <div className="flex flex-col gap-1">
                {conditions.map((cond, idx) => {
                  const opInfo = FILTER_OPS.find((o) => o.value === cond.op)
                  return (
                    <div key={cond.id} className="flex items-center gap-1.5">
                      {idx === 0 ? (
                        <span className="text-[10px] w-12 text-center flex-shrink-0 text-text-muted"></span>
                      ) : (
                        <select
                          value={cond.logic}
                          onChange={(e) => updateCondition(cond.id, 'logic', e.target.value)}
                          className={`px-1 py-0.5 bg-bg-primary border border-border-light rounded text-[10px] font-medium w-12 text-center focus:outline-none focus:border-accent ${cond.logic === 'OR' ? 'text-orange-400' : 'text-blue-400'}`}
                        >
                          <option value="AND">AND</option>
                          <option value="OR">OR</option>
                        </select>
                      )}
                      <select
                        value={cond.column}
                        onChange={(e) => updateCondition(cond.id, 'column', e.target.value)}
                        className="px-1.5 py-1 bg-bg-primary border border-border-light rounded text-[11px] text-text-primary focus:outline-none focus:border-accent"
                      >
                        {columns.map((c) => (
                          <option key={c.name} value={c.name}>{c.name}</option>
                        ))}
                      </select>
                      <select
                        value={cond.op}
                        onChange={(e) => updateCondition(cond.id, 'op', e.target.value)}
                        className="px-1.5 py-1 bg-bg-primary border border-border-light rounded text-[11px] text-text-primary focus:outline-none focus:border-accent w-32"
                      >
                        {FILTER_OPS.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                      {opInfo?.needsValue ? (
                        <input
                          type="text"
                          value={cond.value}
                          onChange={(e) => updateCondition(cond.id, 'value', e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') applyFilter() }}
                          placeholder="值..."
                          autoFocus
                          className="flex-1 px-2 py-1 bg-bg-primary border border-border-light rounded text-[11px] text-text-primary focus:outline-none focus:border-accent"
                        />
                      ) : (
                        <div className="flex-1" />
                      )}
                      <button
                        onClick={() => removeCondition(cond.id)}
                        className="p-1 hover:bg-bg-hover rounded text-text-muted hover:text-red-400 transition-colors flex-shrink-0"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
            {appliedConditions.length > 0 && (
              <div className="mt-2 pt-1.5 border-t border-border-light/50 text-[10px] text-text-muted">
                已应用 {appliedConditions.length} 个条件:
                {' '}
                {appliedConditions.map((c, i) => (
                  <span key={c.id}>
                    {i > 0 && (
                      <span className={c.logic === 'OR' ? 'text-orange-400' : 'text-blue-400'}> {c.logic} </span>
                    )}
                    <span className="text-accent">{c.column}</span>
                    {' '}
                    <span className="text-text-secondary">{c.op}</span>
                    {' '}
                    {c.value && <span className="text-text-primary">{c.value}</span>}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 状态提示 */}
      {statusMsg && (
        <div className={`flex items-center gap-2 px-3 py-1 text-xs flex-shrink-0 ${
          statusMsg.type === 'success'
            ? 'bg-green-950/50 border-b border-green-700/50 text-green-300'
            : 'bg-red-950/50 border-b border-red-700/50 text-red-300'
        }`}>
          {statusMsg.type === 'success' ? <Check size={14} /> : <AlertCircle size={14} />}
          <span>{statusMsg.text}</span>
        </div>
      )}

      {/* 错误提示 */}
      {error && (
        <div className="flex items-start gap-2 p-3 text-sm text-red-400 flex-shrink-0">
          <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
          <pre className="whitespace-pre-wrap break-words font-mono text-xs">{error}</pre>
        </div>
      )}

      {/* 数据表格 */}
      <div className="flex-1 overflow-hidden">
        {loading && (
          <div className="flex items-center justify-center h-full text-text-secondary text-sm gap-2">
            <Loader2 size={16} className="animate-spin text-accent" />
            <span>加载中...</span>
            <button onClick={handleStop} className="ml-2 px-2 py-0.5 text-xs bg-red-900/50 text-red-400 rounded hover:bg-red-800/50">
              停止
            </button>
          </div>
        )}

        {!loading && !error && rows.length > 0 && (
          <DataGrid
            columns={gridColumns}
            rows={rows}
            className="rdg-dark fill-grid"
            style={{ height: '100%' }}
            sortColumns={sortColumns}
            onSortColumnsChange={handleSortChange}
            onRowsChange={handleRowsChange}
            rowKeyGetter={rowKeyGetter}
            selectedRows={selectedRows}
            onSelectedRowsChange={setSelectedRows}
            rowClass={rowClass}
            defaultColumnOptions={{ resizable: true, sortable: true, width: 150 }}
          />
        )}

        {!loading && !error && rows.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-text-muted text-sm gap-3">
            <span>{appliedConditions.length > 0 ? '没有匹配的数据' : '表中没有数据'}</span>
            <button onClick={handleAddRow} className="flex items-center gap-1 px-3 py-1.5 bg-accent/20 text-accent rounded hover:bg-accent/30 transition-colors">
              <Plus size={14} /> 添加行
            </button>
          </div>
        )}
      </div>

      {/* 底部字段编辑器 */}
      {showEditor && rows.length > 0 && (
        <FieldEditorPanel
          columns={columns}
          rows={rows}
          editorRowKey={editorRowKey}
          editorColName={editorColName}
          onSelectField={(rowKey, colName) => { setEditorRowKey(rowKey); setEditorColName(colName) }}
          onCellValueChange={setCellValue}
          onClose={() => setShowEditor(false)}
        />
      )}

      {/* 底部状态栏 */}
      <div className="flex items-center gap-3 px-3 py-1 border-t border-border-light bg-bg-secondary text-xs text-text-muted flex-shrink-0">
        {columns.length > 0 && <span>{columns.length} 列</span>}
        {selectedRows.size > 0 && <span className="text-accent">{selectedRows.size} 行已选</span>}
        {newKeys.size > 0 && <span className="text-green-400">{newKeys.size} 新增</span>}
        {dirtyKeys.size > 0 && <span className="text-yellow-400">{dirtyKeys.size} 修改</span>}
        {pendingDeletes.length > 0 && <span className="text-red-400">{pendingDeletes.length} 删除</span>}
        {sortCol && (
          <span className="flex items-center gap-1">
            {sortDir === 'ASC' ? <ArrowUp size={10} /> : <ArrowDown size={10} />}
            排序: {sortCol}
          </span>
        )}
        <span className="ml-auto font-mono">{tab.database}.{tab.table}</span>
      </div>

      {/* 单元格右键菜单 */}
      {cellMenu && (
        <CellContextMenu
          x={cellMenu.x}
          y={cellMenu.y}
          colType={cellMenu.colType}
          onClose={() => setCellMenu(null)}
          onSetNull={handleSetNull}
          onSetEmpty={handleSetEmpty}
          onDatePicker={handleOpenDatePicker}
        />
      )}

      {/* 日期选择器弹窗 */}
      {datePicker && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40" onClick={() => setDatePicker(null)}>
          <div className="bg-bg-tertiary border border-border rounded-lg shadow-2xl p-4 w-72" onClick={(e) => e.stopPropagation()}>
            <div className="text-sm font-medium text-text-primary mb-3">选择日期时间</div>
            <input
              type="datetime-local"
              value={datePicker.value}
              onChange={(e) => setDatePicker({ ...datePicker, value: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleDatePickerConfirm()
                if (e.key === 'Escape') setDatePicker(null)
              }}
              step={1}
              autoFocus
              className="w-full px-3 py-2 bg-bg-primary border border-border-light rounded text-sm text-text-primary focus:outline-none focus:border-accent transition-colors"
            />
            <div className="flex items-center justify-end gap-2 mt-3">
              <button
                onClick={() => setDatePicker(null)}
                className="px-3 py-1.5 rounded text-xs hover:bg-bg-hover text-text-secondary transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleDatePickerConfirm}
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

// ==================== 单元格右键菜单组件 ====================

function CellContextMenu({
  x, y, colType, onClose, onSetNull, onSetEmpty, onDatePicker
}: {
  x: number
  y: number
  colType: string
  onClose: () => void
  onSetNull: () => void
  onSetEmpty: () => void
  onDatePicker: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const isDate = isDateType(colType)

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const handleEscape = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside)
      document.addEventListener('keydown', handleEscape)
    }, 0)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [onClose])

  const menuWidth = 160
  const menuHeight = (isDate ? 5 : 3) * 32 + 8
  let mx = x, my = y
  if (mx + menuWidth > window.innerWidth) mx = window.innerWidth - menuWidth - 4
  if (my + menuHeight > window.innerHeight) my = window.innerHeight - menuHeight - 4

  return (
    <div
      ref={ref}
      className="fixed z-[100] min-w-[160px] bg-bg-tertiary border border-border rounded-md shadow-2xl py-1 text-sm"
      style={{ left: mx, top: my }}
    >
      <button
        onClick={() => { onSetNull(); onClose() }}
        className="w-full text-left px-3 py-1.5 text-xs text-text-primary hover:bg-bg-hover transition-colors"
      >
        设为 <span className="text-text-muted italic">NULL</span>
      </button>
      <button
        onClick={() => { onSetEmpty(); onClose() }}
        className="w-full text-left px-3 py-1.5 text-xs text-text-primary hover:bg-bg-hover transition-colors"
      >
        设为空字符串 <span className="text-text-muted">("")</span>
      </button>
      {isDate && (
        <>
          <div className="h-px bg-border-light my-1" />
          <button
            onClick={() => { onDatePicker(); onClose() }}
            className="w-full text-left px-3 py-1.5 text-xs text-accent hover:bg-bg-hover transition-colors"
          >
            选择日期时间...
          </button>
        </>
      )}
    </div>
  )
}

// ==================== 底部字段编辑器面板 ====================

interface FieldEditorPanelProps {
  columns: ColumnInfo[]
  rows: RowData[]
  editorRowKey: string | null
  editorColName: string | null
  onSelectField: (rowKey: string, colName: string) => void
  onCellValueChange: (rowKey: string, colName: string, value: unknown) => void
  onClose: () => void
}

function FieldEditorPanel({
  columns,
  rows,
  editorRowKey,
  editorColName,
  onSelectField,
  onCellValueChange,
  onClose
}: FieldEditorPanelProps) {
  const [isNull, setIsNull] = useState(false)
  const [textValue, setTextValue] = useState('')
  const [viewMode, setViewMode] = useState<'text' | 'json' | 'html'>('text')

  const selectedRow = useMemo(
    () => rows.find((r) => r._row_key === editorRowKey) ?? null,
    [rows, editorRowKey]
  )
  const selectedCol = useMemo(
    () => columns.find((c) => c.name === editorColName) ?? null,
    [columns, editorColName]
  )

  // 当选中行/列变化时，同步编辑器内容
  useEffect(() => {
    if (!selectedRow || !selectedCol) {
      setTextValue('')
      setIsNull(false)
      return
    }
    // 根据内容自动切换视图模式
    const raw = selectedRow[selectedCol.name]
    const str = raw === null || raw === undefined ? '' : typeof raw === 'object' ? JSON.stringify(raw) : String(raw)
    const trimmed = str.trim()
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      setViewMode('json')
    } else {
      setViewMode('text')
    }
    // NOT NULL 字段永远不设为 null 模式，即使值为空也显示空编辑器
    if ((raw === null || raw === undefined) && selectedCol.nullable) {
      setIsNull(true)
      setTextValue('')
    } else {
      setIsNull(false)
      const str = raw === null || raw === undefined ? '' : typeof raw === 'object' ? JSON.stringify(raw) : String(raw)
      setTextValue(str)
    }
  }, [selectedRow, selectedCol])

  const isDateCol = selectedCol ? isDateType(selectedCol.type) : false
  // 根据内容检测 JSON（以 { 或 [ 开头）
  const isJsonContent = useMemo(() => {
    if (!textValue) return false
    const trimmed = textValue.trim()
    return trimmed.startsWith('{') || trimmed.startsWith('[')
  }, [textValue])
  // 检测内容是否像 HTML
  const isHtmlContent = useMemo(() => {
    if (!textValue) return false
    return /<[^>]+>/.test(textValue) && /<\/[a-zA-Z]/.test(textValue)
  }, [textValue])
  // 是否需要显示视图切换（检测到 JSON 或 HTML）
  const hasSpecialView = (isJsonContent || isHtmlContent) && !isNull

  // 提交编辑器内容到行数据
  const commitValue = useCallback((val: unknown) => {
    if (!editorRowKey || !editorColName) return
    onCellValueChange(editorRowKey, editorColName, val)
  }, [editorRowKey, editorColName, onCellValueChange])

  const handleTextChange = (v: string) => {
    setTextValue(v)
    commitValue(isNull ? null : v)
  }

  const handleToggleNull = () => {
    const newVal = !isNull
    setIsNull(newVal)
    if (newVal) {
      commitValue(null)
    } else {
      commitValue(textValue)
    }
  }

  const handleDateChange = (datetimeLocal: string) => {
    if (!datetimeLocal) {
      setTextValue('')
      commitValue(null)
      return
    }
    const d = new Date(datetimeLocal)
    const pad = (n: number) => String(n).padStart(2, '0')
    const mysqlDate = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
    setTextValue(mysqlDate)
    commitValue(mysqlDate)
  }

  // 格式化 JSON
  const handleFormatJson = useCallback(() => {
    if (!textValue.trim()) return
    try {
      const parsed = JSON.parse(textValue)
      const formatted = JSON.stringify(parsed, null, 2)
      setTextValue(formatted)
      commitValue(formatted)
    } catch {
      // 忽略解析错误
    }
  }, [textValue, commitValue])

  // 压缩 JSON
  const handleMinifyJson = useCallback(() => {
    if (!textValue.trim()) return
    try {
      const parsed = JSON.parse(textValue)
      const minified = JSON.stringify(parsed)
      setTextValue(minified)
      commitValue(minified)
    } catch {
      // 忽略
    }
  }, [textValue, commitValue])

  // 将 MySQL 日期转为 datetime-local 格式
  const datetimeLocalValue = useMemo(() => {
    if (!selectedRow || !selectedCol) return ''
    const v = selectedRow[selectedCol.name]
    if (!v) return ''
    const d = new Date(v as string)
    if (isNaN(d.getTime())) return ''
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  }, [selectedRow, selectedCol])

  return (
    <div className="flex border-t border-border bg-bg-tertiary flex-shrink-0" style={{ height: '180px' }}>
      {/* 左侧：字段列表 */}
      <div className="w-44 border-r border-border-light flex flex-col flex-shrink-0">
        <div className="px-2 py-1 text-[10px] font-medium text-text-muted border-b border-border-light uppercase tracking-wider flex-shrink-0">
          字段列表
        </div>
        <div className="flex-1 overflow-y-auto">
          {selectedRow && columns.map((col) => {
            const isSelected = editorColName === col.name
            const val = selectedRow[col.name]
            const isNullVal = val === null || val === undefined
            return (
              <button
                key={col.name}
                onClick={() => onSelectField(editorRowKey!, col.name)}
                className={`w-full text-left px-2 py-1 text-xs flex items-center gap-1 border-l-2 transition-colors ${
                  isSelected
                    ? 'bg-accent/15 border-l-accent text-text-primary'
                    : 'border-l-transparent hover:bg-bg-hover text-text-secondary'
                }`}
              >
                {col.isPrimaryKey && <Key size={9} className="text-yellow-400 flex-shrink-0" />}
                <span className="truncate flex-1">{col.name}</span>
                <span className={`text-[9px] flex-shrink-0 ${isNullVal ? 'text-text-muted italic' : 'text-text-muted/60'}`}>
                  {isNullVal ? 'NULL' : col.type}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* 右侧：编辑区域 */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border-light flex-shrink-0">
          <span className="text-xs font-medium text-text-primary">
            {selectedCol?.name ?? '未选择字段'}
          </span>
          {selectedCol && (
            <span className="text-[10px] text-text-muted px-1.5 py-0.5 bg-bg-primary rounded border border-border-light">
              {selectedCol.type}
            </span>
          )}
          {selectedCol && (
            <span className={`text-[10px] ${selectedCol.nullable ? 'text-green-400' : 'text-red-400'}`}>
              {selectedCol.nullable ? 'NULLABLE' : 'NOT NULL'}
            </span>
          )}
          <div className="ml-auto flex items-center gap-2">
            {/* 视图切换工具栏（检测到 JSON 或 HTML 内容时显示） */}
            {hasSpecialView && (
              <div className="flex items-center gap-0.5 mr-1">
                {/* 视图切换 */}
                <div className="flex items-center bg-bg-primary border border-border-light rounded overflow-hidden mr-1">
                  <button
                    onClick={() => setViewMode('text')}
                    className={`px-1.5 py-0.5 text-[10px] font-medium transition-colors ${viewMode === 'text' ? 'bg-accent text-white' : 'text-text-muted hover:text-text-primary'}`}
                  >
                    文本
                  </button>
                  {isJsonContent && (
                    <button
                      onClick={() => setViewMode('json')}
                      className={`px-1.5 py-0.5 text-[10px] font-medium transition-colors ${viewMode === 'json' ? 'bg-accent text-white' : 'text-text-muted hover:text-text-primary'}`}
                    >
                      JSON
                    </button>
                  )}
                  {isHtmlContent && (
                    <button
                      onClick={() => setViewMode('html')}
                      className={`px-1.5 py-0.5 text-[10px] font-medium transition-colors ${viewMode === 'html' ? 'bg-accent text-white' : 'text-text-muted hover:text-text-primary'}`}
                    >
                      HTML
                    </button>
                  )}
                </div>
                {/* JSON 格式化/压缩 */}
                {viewMode === 'json' && isJsonContent && (
                  <>
                    <button onClick={handleFormatJson} className="px-1.5 py-0.5 text-[10px] rounded hover:bg-bg-hover text-text-secondary hover:text-accent transition-colors border border-border-light" title="格式化 JSON">
                      格式化
                    </button>
                    <button onClick={handleMinifyJson} className="px-1.5 py-0.5 text-[10px] rounded hover:bg-bg-hover text-text-secondary hover:text-accent transition-colors border border-border-light" title="压缩 JSON">
                      压缩
                    </button>
                  </>
                )}
              </div>
            )}
            {selectedCol?.nullable && (
              <label className="flex items-center gap-1 text-[10px] text-text-secondary cursor-pointer select-none">
                <input type="checkbox" checked={isNull} onChange={handleToggleNull} className="w-3 h-3 accent-accent" />
                NULL
              </label>
            )}
            <button onClick={onClose} className="p-0.5 hover:bg-bg-hover rounded text-text-muted hover:text-text-primary transition-colors">
              <X size={14} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-hidden p-2">
          {!selectedRow || !selectedCol ? (
            <div className="flex items-center justify-center h-full text-text-muted text-xs">
              点击表格中的单元格选择要编辑的字段
            </div>
          ) : isNull ? (
            <div className="flex items-center justify-center h-full text-text-muted italic text-sm">
              NULL
            </div>
          ) : viewMode === 'html' ? (
            <div className="h-full flex flex-col gap-1">
              <iframe
                srcDoc={`<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{font-family:system-ui,sans-serif;font-size:13px;padding:8px;margin:0;color:#333;background:#fff;}img{max-width:100%;}table{border-collapse:collapse;}td,th{border:1px solid #ddd;padding:4px 8px;}</style></head><body>${textValue}</body></html>`}
                className="flex-1 w-full bg-white border border-border-light rounded"
                sandbox="allow-same-origin"
                title="HTML 预览"
              />
            </div>
          ) : viewMode === 'json' ? (
            <textarea
              value={textValue}
              onChange={(e) => handleTextChange(e.target.value)}
              placeholder='{"key": "value"}'
              className="w-full h-full px-2 py-1.5 bg-bg-primary border border-border-light rounded text-xs font-mono text-text-primary focus:outline-none focus:border-accent transition-colors resize-none leading-relaxed"
              spellCheck={false}
            />
          ) : isDateCol ? (
            <div className="flex flex-col gap-2 h-full justify-center">
              <div className="flex items-center gap-2">
                <input
                  type="datetime-local"
                  value={datetimeLocalValue}
                  onChange={(e) => handleDateChange(e.target.value)}
                  step={1}
                  className="px-3 py-1.5 bg-bg-primary border border-border-light rounded text-sm text-text-primary focus:outline-none focus:border-accent transition-colors"
                />
                <span className="text-[10px] text-text-muted">MySQL: {textValue || '(空)'}</span>
              </div>
            </div>
          ) : (
            <textarea
              value={textValue}
              onChange={(e) => handleTextChange(e.target.value)}
              placeholder="输入值..."
              className="w-full h-full px-2 py-1.5 bg-bg-primary border border-border-light rounded text-xs font-mono text-text-primary focus:outline-none focus:border-accent transition-colors resize-none leading-relaxed"
              spellCheck={false}
            />
          )}
        </div>

        {/* 字符计数 */}
        {selectedCol && !isNull && (
          <div className="px-3 py-0.5 border-t border-border-light text-[10px] text-text-muted flex-shrink-0 text-right">
            {textValue.length} 字符
          </div>
        )}
      </div>
    </div>
  )
}
