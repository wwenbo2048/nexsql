import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import DataEditor, {
  GridCellKind,
  type GridCell,
  type GridColumn,
  type GridSelection,
  type Item,
  type EditableGridCell,
  CompactSelection,
  type HeaderClickedEventArgs,
  type CellClickedEventArgs,
  type Theme
} from '@glideapps/glide-data-grid'
import '@glideapps/glide-data-grid/dist/index.css'
import {
  RefreshCw, Loader2, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
  AlertCircle, Filter, ArrowUp, ArrowDown, Key, Plus, Trash2, Check, Undo2,
  Square, X, PanelBottomOpen, PanelBottomClose, Download, Upload, ChevronDown,
  Copy, ClipboardPaste, Search
} from 'lucide-react'
import { useConnectionStore } from '@stores/connection'
import type { Tab, ColumnInfo, QueryResult } from '@shared/types'

interface Props { tab: Tab }
const PAGE_SIZE = 100
type SortDir = 'ASC' | 'DESC' | null
type FilterOp = '=' | '!=' | '>' | '>=' | '<' | '<=' | 'LIKE' | 'NOT LIKE' | 'IS NULL' | 'IS NOT NULL'
type FilterLogic = 'AND' | 'OR'
interface FilterCondition { id: string; logic: FilterLogic; column: string; op: FilterOp; value: string }
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

function isDateType(type: string): boolean { const t = type.toLowerCase(); return t.includes('date') || t.includes('time') || t.includes('timestamp') }
function isBinaryType(type: string): boolean { const t = type.toLowerCase(); return t.includes('blob') || t.includes('binary') || t.includes('bit') }
function isJsonString(val: unknown): boolean { if (typeof val !== 'string') return false; const s = val.trim(); return (s.startsWith('{') && s.endsWith('}')) || (s.startsWith('[') && s.endsWith(']')) }
function formatJsonPreview(val: string): string { try { return JSON.stringify(JSON.parse(val), null, 2) } catch { return val } }
function toHexPreview(val: unknown, maxBytes: number = 16): string {
  if (val instanceof ArrayBuffer || val instanceof Uint8Array) {
    const bytes = val instanceof ArrayBuffer ? new Uint8Array(val) : val
    const hex = Array.from(bytes.slice(0, maxBytes)).map((b) => b.toString(16).padStart(2, '0')).join(' ')
    return bytes.length > maxBytes ? hex + ' …' : hex
  }
  const str = String(val)
  if (/^[\x00-\x1f]+$/.test(str)) return Array.from(str.slice(0, maxBytes)).map((c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join(' ')
  return str
}

interface RowData { _row_key: string; _row_num: number; [key: string]: unknown }
let rowKeyCounter = 0
function genRowKey(): string { rowKeyCounter++; return `r${Date.now()}_${rowKeyCounter}` }

// 字符串感知的 SQL 语句分割（避免字符串内的分号截断）
function splitSqlStatements(sql: string): string[] {
  const statements: string[] = []
  let current = ''; let inSingle = false; let inDouble = false; let inBacktick = false; let inLineComment = false; let inBlockComment = false
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i]; const next = sql[i + 1]
    if (inLineComment) { if (ch === '\n') { inLineComment = false; current += ' ' } continue }
    if (inBlockComment) { if (ch === '*' && next === '/') { inBlockComment = false; i++ } continue }
    if (inSingle) {
      current += ch
      if (ch === '\\' && next) { current += next; i++; continue }
      if (ch === "'" && next === "'") { current += next; i++; continue }
      if (ch === "'") inSingle = false
      continue
    }
    if (inDouble) {
      current += ch
      if (ch === '\\' && next) { current += next; i++; continue }
      if (ch === '"') inDouble = false
      continue
    }
    if (inBacktick) {
      current += ch
      if (ch === '`' && next === '`') { current += next; i++; continue }
      if (ch === '`') inBacktick = false
      continue
    }
    if (ch === '-' && next === '-') { inLineComment = true; i++; continue }
    if (ch === '/' && next === '*') { inBlockComment = true; i++; continue }
    if (ch === "'") { inSingle = true; current += ch; continue }
    if (ch === '"') { inDouble = true; current += ch; continue }
    if (ch === '`') { inBacktick = true; current += ch; continue }
    if (ch === ';') { const stmt = current.trim(); if (stmt) statements.push(stmt); current = ''; continue }
    current += ch
  }
  const last = current.trim()
  if (last) statements.push(last)
  return statements
}
function escapeVal(val: unknown): string {
  if (val === null || val === undefined || val === '') return 'NULL'
  const str = String(val)
  if (/^-?\d+(\.\d+)?$/.test(str)) return str
  return `'${str.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
}
// 从 INSERT SQL 中提取 VALUES 括号内容（支持括号平衡，避免字符串内的括号截断）
function extractValuesFromInsert(sql: string): string[] {
  const results: string[] = []
  // 查找所有 VALUES 关键字
  const valuesRe = /\bVALUES\s*/gi
  let vm: RegExpExecArray | null
  while ((vm = valuesRe.exec(sql)) !== null) {
    const startIdx = vm.index + vm[0].length
    if (startIdx >= sql.length || sql[startIdx] !== '(') continue
    // 括号平衡匹配
    let depth = 0; let inStr = false; let i = startIdx
    for (; i < sql.length; i++) {
      const ch = sql[i]
      if (inStr) {
        if (ch === "'" && sql[i + 1] === "'") { i++; continue }
        if (ch === "'" && sql[i - 1] === '\\') continue
        if (ch === "'") inStr = false
      } else {
        if (ch === "'") inStr = true
        else if (ch === '(') depth++
        else if (ch === ')') { depth--; if (depth === 0) { i++; break } }
      }
    }
    const inner = sql.substring(startIdx + 1, i - 1)
    results.push(inner)
  }
  return results
}

function parseValuesList(valStr: string): unknown[] {
  const values: unknown[] = []; let i = 0; const s = valStr.trim()
  while (i < s.length) {
    while (i < s.length && (s[i] === ' ' || s[i] === ',' || s[i] === '\t')) i++
    if (i >= s.length) break
    if (s[i] === "'") {
      i++; let val = ''
      while (i < s.length) {
        if (s[i] === "'" && s[i + 1] === "'") { val += "'"; i += 2 }
        else if (s[i] === "'" && s[i - 1] === '\\') { val = val.slice(0, -1) + "'"; i++ }
        else if (s[i] === "'") { i++; break }
        else { val += s[i]; i++ }
      }
      values.push(val)
    } else if (s.substring(i, i + 4).toUpperCase() === 'NULL') { values.push(null); i += 4 }
    else {
      let val = ''
      while (i < s.length && s[i] !== ',' && s[i] !== ' ') { val += s[i]; i++ }
      const num = Number(val); values.push(isNaN(num) ? val : num)
    }
  }
  return values
}

// Glide Data Grid 深色主题
const GDG_THEME: Partial<Theme> = {
  accentColor: '#3b82f6', accentFg: '#ffffff', accentLight: 'rgba(59, 130, 246, 0.15)',
  textDark: '#e4e4e7', textMedium: '#a1a1aa', textLight: '#71717a', textBubble: '#a1a1aa',
  bgIconHeader: '#25262b', fgIconHeader: '#a1a1aa', textHeader: '#a1a1aa', textHeaderSelected: '#e4e4e7',
  bgCell: '#1a1b1e', bgCellMedium: '#1f2023', bgHeader: '#25262b', bgHeaderHasFocus: '#2a2b30', bgHeaderHovered: '#2c2e33',
  bgBubble: '#2c2e33', bgBubbleSelected: 'rgba(59, 130, 246, 0.2)', bgSearchResult: 'rgba(234, 179, 8, 0.2)',
  borderColor: '#353839', horizontalBorderColor: '#353839', linkColor: '#60a5fa',
  cellHorizontalPadding: 8, headerFontStyle: 'bold 11px', baseFontStyle: '12px',
  fontFamily: "'JetBrains Mono', Menlo, Monaco, monospace", editorFontSize: '12px'
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
  const [showFilter, setShowFilter] = useState(false)
  const [conditions, setConditions] = useState<FilterCondition[]>([])
  const [appliedConditions, setAppliedConditions] = useState<FilterCondition[]>([])
  const [rows, setRows] = useState<RowData[]>([])
  const [snapshot, setSnapshot] = useState<RowData[]>([])
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set())
  const [dirtyKeys, setDirtyKeys] = useState<Set<string>>(new Set())
  const [newKeys, setNewKeys] = useState<Set<string>>(new Set())
  const [pendingDeletes, setPendingDeletes] = useState<RowData[]>([])
  const [snapshotMap, setSnapshotMap] = useState<Map<string, RowData>>(new Map())
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [progress, setProgress] = useState<{ current: number; total: number; label: string } | null>(null)
  const [cellMenu, setCellMenu] = useState<{ x: number; y: number; rowKey: string; colName: string; colType: string } | null>(null)
  const [datePicker, setDatePicker] = useState<{ rowKey: string; colName: string; value: string } | null>(null)
  const [showEditor, setShowEditor] = useState(true)
  const [quickSearch, setQuickSearch] = useState('')
  const [showExportMenu, setShowExportMenu] = useState(false)
  const [showImportMenu, setShowImportMenu] = useState(false)
  const exportMenuRef = useRef<HTMLDivElement>(null)
  const importMenuRef = useRef<HTMLDivElement>(null)

  // Glide Data Grid 选择状态
  const [gridSelection, setGridSelection] = useState<GridSelection>({ columns: CompactSelection.empty(), rows: CompactSelection.empty() })
  const [colWidths, setColWidths] = useState<Map<number, number>>(new Map())
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const gridRef = useRef<any>(null)

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) setShowExportMenu(false)
      if (importMenuRef.current && !importMenuRef.current.contains(e.target as Node)) setShowImportMenu(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

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
    abortRef.current = false; setLoading(true); setError(null)
    setDirtyKeys(new Set()); setNewKeys(new Set()); setPendingDeletes([]); setSelectedRows(new Set())
    setGridSelection({ columns: CompactSelection.empty(), rows: CompactSelection.empty() })
    try {
      const colRes = await window.api.db.getTableColumns(config, tab.database, tab.table)
      if (!colRes.success) throw new Error(colRes.error)
      setColumns(colRes.data ?? [])
      if (abortRef.current) return
      const countRes = await window.api.db.getTableRowCount(config, tab.database, tab.table)
      if (countRes.success && countRes.data !== undefined) setTotalRows(countRes.data)
      if (abortRef.current) return
      let sql = `SELECT * FROM \`${tab.table}\``
      if (appliedConditions.length > 0) {
        const whereParts: string[] = []
        appliedConditions.forEach((cond, i) => {
          let part = ''
          if (cond.op === 'IS NULL') part = `\`${cond.column}\` IS NULL`
          else if (cond.op === 'IS NOT NULL') part = `\`${cond.column}\` IS NOT NULL`
          else if (cond.op === 'LIKE' || cond.op === 'NOT LIKE') { const v = cond.value.replace(/'/g, "\\'"); part = `\`${cond.column}\` ${cond.op} '%${v}%'` }
          else { const v = escapeVal(cond.value); part = `\`${cond.column}\` ${cond.op} ${v}` }
          whereParts.push(i === 0 ? part : `${cond.logic} ${part}`)
        })
        sql += ` WHERE ${whereParts.join(' ')}`
      }
      if (sortCol && sortDir) sql += ` ORDER BY \`${sortCol}\` ${sortDir}`
      sql += ` LIMIT ${PAGE_SIZE} OFFSET ${page * PAGE_SIZE}`
      const res = await window.api.db.query(config, sql, tab.database)
      if (abortRef.current) return
      if (!res.success) throw new Error(res.error)
      setResult(res.data ?? null)
    } catch (err) { if (!abortRef.current) setError((err as Error).message) }
    finally { if (!abortRef.current) setLoading(false) }
  }, [config, tab.database, tab.table, page, appliedConditions, sortCol, sortDir])

  useEffect(() => { loadData() }, [loadData])

  useEffect(() => {
    if (!result?.rows) { setRows([]); setSnapshot([]); setSnapshotMap(new Map()); return }
    const newRows: RowData[] = result.rows.map((row, idx) => ({ _row_key: genRowKey(), _row_num: page * PAGE_SIZE + idx + 1, ...row }))
    setRows(newRows); setSnapshot(newRows)
    const smap = new Map<string, RowData>(); newRows.forEach((r) => smap.set(r._row_key, { ...r })); setSnapshotMap(smap)
  }, [result, page])

  const handleStop = useCallback(() => { abortRef.current = true; setLoading(false); showMsg('error', '查询已停止') }, [showMsg])

  // ==================== 行操作 ====================
  const handleAddRow = useCallback(() => {
    const key = genRowKey(); const emptyRow: RowData = { _row_key: key, _row_num: 0 }
    columns.forEach((col) => { emptyRow[col.name] = col.defaultValue ?? null })
    setRows((prev) => [...prev, emptyRow]); setNewKeys((prev) => new Set(prev).add(key)); setSelectedRows(new Set([key]))
  }, [columns])

  const isAllSelected = useMemo(() => rows.length > 0 && rows.every((r) => selectedRows.has(r._row_key)), [rows, selectedRows])
  const toggleRow = useCallback((key: string) => {
    setSelectedRows((prev) => { const next = new Set(prev); if (next.has(key)) next.delete(key); else next.add(key); return next })
  }, [])
  const toggleAll = useCallback(() => {
    if (isAllSelected) setSelectedRows(new Set())
    else setSelectedRows(new Set(rows.map((r) => r._row_key)))
  }, [isAllSelected, rows])

  // 同步 gridSelection.rows → selectedRows
  const gridSelectionRef = useRef(gridSelection)
  const handleGridSelectionChange = useCallback((newSelection: GridSelection) => {
    setGridSelection(newSelection)
    gridSelectionRef.current = newSelection
    const rowIndices = newSelection.rows.toArray()
    const newSelected = new Set<string>()
    rowIndices.forEach((idx) => { if (displayRowsRef.current[idx]) newSelected.add(displayRowsRef.current[idx]._row_key) })
    setSelectedRows(newSelected)
  }, [])

  // ==================== 复制/粘贴 ====================
  const handleCopyRows = useCallback(() => {
    if (selectedRows.size === 0) { showMsg('error', '请先选择要复制的行'); return }
    const selectedData = rows.filter((r) => selectedRows.has(r._row_key))
    const colNames = columns.map((c) => `\`${c.name}\``).join(', ')
    const lines = selectedData.map((row) => {
      const colVals = columns.map((c) => escapeVal(row[c.name])).join(', ')
      return `INSERT INTO \`${tab.table}\` (${colNames}) VALUES (${colVals});`
    })
    navigator.clipboard.writeText(lines.join('\n')).then(
      () => showMsg('success', `已复制 ${selectedData.length} 行（INSERT SQL）`),
      () => showMsg('error', '复制到剪贴板失败')
    )
  }, [selectedRows, rows, columns, tab.table, showMsg])

  const handlePasteRows = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (!text || !text.trim()) { showMsg('error', '剪贴板为空'); return }
      // 使用括号平衡匹配提取 VALUES 内容
      const valStrings = extractValuesFromInsert(text)
      let addedCount = 0
      const newRowsList: RowData[] = []; const newKeysSet = new Set(newKeys)
      for (const valStr of valStrings) {
        const values = parseValuesList(valStr)
        if (values.length !== columns.length) continue
        const key = genRowKey(); const newRow: RowData = { _row_key: key, _row_num: 0 }
        columns.forEach((col, idx) => { newRow[col.name] = values[idx] })
        newRowsList.push(newRow); newKeysSet.add(key); addedCount++
      }
      if (addedCount === 0) { showMsg('error', '无法解析剪贴板内容（需要 INSERT SQL 格式）'); return }
      setRows((prev) => [...prev, ...newRowsList]); setNewKeys(newKeysSet)
      showMsg('success', `已粘贴 ${addedCount} 行`)
    } catch (err) { showMsg('error', `粘贴失败: ${(err as Error).message}`) }
  }, [columns, newKeys, showMsg])

  const handleDeleteRows = useCallback(() => {
    if (selectedRows.size === 0) { showMsg('error', '请先选择要删除的行'); return }
    const toDelete: RowData[] = []; const remaining: RowData[] = []
    const newDirty = new Set(dirtyKeys); const newNewKeys = new Set(newKeys)
    rows.forEach((row) => {
      if (selectedRows.has(row._row_key)) {
        if (newNewKeys.has(row._row_key)) { newNewKeys.delete(row._row_key); newDirty.delete(row._row_key) }
        else toDelete.push(row)
      } else remaining.push(row)
    })
    setRows(remaining); setPendingDeletes((prev) => [...prev, ...toDelete])
    setDirtyKeys(newDirty); setNewKeys(newNewKeys); setSelectedRows(new Set())
    setGridSelection({ columns: CompactSelection.empty(), rows: CompactSelection.empty() })
  }, [selectedRows, rows, dirtyKeys, newKeys, showMsg])

  // ==================== 单元格编辑 ====================
  const handleCellEdited = useCallback((cell: Item, newValue: EditableGridCell) => {
    const [col, rowIdx] = cell
    if (col < 0 || col >= columns.length) return
    const colName = columns[col].name
    const row = displayRowsRef.current[rowIdx]
    if (!row) return
    const newVal = (newValue as { data: unknown }).data
    setCellValue(row._row_key, colName, newVal)
  }, [columns])

  const handleCellsEdited = useCallback((newValues: readonly { location: Item; value: EditableGridCell }[]) => {
    for (const edit of newValues) {
      const [col, rowIdx] = edit.location
      if (col < 0 || col >= columns.length) continue
      const colName = columns[col].name
      const row = displayRowsRef.current[rowIdx]
      if (!row) continue
      const newVal = (edit.value as { data: unknown }).data
      setCellValue(row._row_key, colName, newVal)
    }
    return true
  }, [columns])

  // ==================== 单元格右键操作 ====================
  const setCellValue = useCallback((rowKey: string, colName: string, value: unknown) => {
    setRows((prev) => {
      const newRows = [...prev]; const idx = newRows.findIndex((r) => r._row_key === rowKey)
      if (idx < 0) return prev; newRows[idx] = { ...newRows[idx], [colName]: value }; return newRows
    })
    setDirtyKeys((prev) => { const next = new Set(prev); if (!newKeys.has(rowKey)) next.add(rowKey); return next })
  }, [newKeys])

  const handleCellContextMenu = useCallback((_cell: Item, event: CellClickedEventArgs) => {
    const [col, rowIdx] = _cell
    if (col < 0 || col >= columns.length) return
    const colInfo = columns[col]
    const row = displayRowsRef.current[rowIdx]
    if (!row) return
    event.preventDefault()
    const x = event.bounds.x + event.localEventX
    const y = event.bounds.y + event.localEventY
    setCellMenu({ x, y, rowKey: row._row_key, colName: colInfo.name, colType: colInfo.type })
  }, [columns])

  const handleSetNull = useCallback(() => { if (!cellMenu) return; setCellValue(cellMenu.rowKey, cellMenu.colName, null); setCellMenu(null) }, [cellMenu, setCellValue])
  const handleSetEmpty = useCallback(() => { if (!cellMenu) return; setCellValue(cellMenu.rowKey, cellMenu.colName, ''); setCellMenu(null) }, [cellMenu, setCellValue])
  const handleOpenDatePicker = useCallback(() => {
    if (!cellMenu) return
    const row = rows.find((r) => r._row_key === cellMenu.rowKey)
    const currentVal = row?.[cellMenu.colName]
    const dateStr = currentVal ? new Date(currentVal as string).toISOString().slice(0, 16) : ''
    setDatePicker({ rowKey: cellMenu.rowKey, colName: cellMenu.colName, value: dateStr }); setCellMenu(null)
  }, [cellMenu, rows])
  const handleDatePickerConfirm = useCallback(() => {
    if (!datePicker) return
    let val: string
    if (datePicker.value) {
      const d = new Date(datePicker.value); const pad = (n: number) => String(n).padStart(2, '0')
      val = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
    } else val = ''
    setCellValue(datePicker.rowKey, datePicker.colName, val || null); setDatePicker(null)
  }, [datePicker, setCellValue])

  // ==================== Commit ====================
  const handleCommit = useCallback(async () => {
    if (pendingCount === 0) { showMsg('error', '没有待提交的更改'); return }
    if (!config || !tab.database || !tab.table) return
    const sqls: string[] = []; let opCount = 0
    for (const row of pendingDeletes) {
      const where = buildWhereClause(row, columns)
      if (where) { sqls.push(`DELETE FROM \`${tab.table}\` WHERE ${where}`); opCount++ }
    }
    for (const row of rows) {
      if (newKeys.has(row._row_key)) {
        const colNames = columns.map((c) => `\`${c.name}\``).join(', ')
        const colVals = columns.map((c) => escapeVal(row[c.name])).join(', ')
        sqls.push(`INSERT INTO \`${tab.table}\` (${colNames}) VALUES (${colVals})`); opCount++
      }
    }
    for (const row of rows) {
      if (dirtyKeys.has(row._row_key)) {
        const orig = snapshotMap.get(row._row_key); if (!orig) continue
        const changedCols = columns.filter((c) => row[c.name] !== orig[c.name]).map((c) => `\`${c.name}\` = ${escapeVal(row[c.name])}`)
        if (changedCols.length === 0) continue
        const where = buildWhereClause(orig, columns)
        if (where) { sqls.push(`UPDATE \`${tab.table}\` SET ${changedCols.join(', ')} WHERE ${where}`); opCount++ }
      }
    }
    if (sqls.length === 0) { showMsg('error', '没有可执行的更改'); return }
    setLoading(true); let failCount = 0; let committed = false
    const beginRes = await window.api.db.query(config, 'START TRANSACTION', tab.database)
    if (!beginRes.success) { setLoading(false); showMsg('error', `无法开启事务: ${beginRes.error}`); return }
    try {
      for (let i = 0; i < sqls.length; i++) {
        const res = await window.api.db.query(config, sqls[i], tab.database)
        if (!res.success) { failCount = i + 1; throw new Error(res.error ?? '未知错误') }
      }
      const commitRes = await window.api.db.query(config, 'COMMIT', tab.database)
      if (!commitRes.success) throw new Error(`COMMIT 失败: ${commitRes.error}`)
      committed = true
    } catch (err) {
      await window.api.db.query(config, 'ROLLBACK', tab.database)
      showMsg('error', `事务已回滚 (${failCount}/${opCount}): ${(err as Error).message}`)
    } finally { setLoading(false) }
    if (committed) { showMsg('success', `成功提交 ${opCount} 条更改`); await loadData() }
  }, [pendingCount, config, tab.database, tab.table, pendingDeletes, rows, newKeys, dirtyKeys, columns, snapshotMap, loadData, showMsg])

  const handleRollback = useCallback(() => {
    if (pendingCount === 0) { showMsg('error', '没有待回滚的更改'); return }
    setRows(snapshot.map((r) => ({ ...r }))); setDirtyKeys(new Set()); setNewKeys(new Set())
    setPendingDeletes([]); setSelectedRows(new Set())
    setGridSelection({ columns: CompactSelection.empty(), rows: CompactSelection.empty() })
    showMsg('success', '已回滚所有更改')
  }, [pendingCount, snapshot, showMsg])

  function buildWhereClause(row: RowData, cols: ColumnInfo[]): string | null {
    const pkCols = cols.filter((c) => c.isPrimaryKey); const useCols = pkCols.length > 0 ? pkCols : cols
    const conds = useCols.map((c) => { const v = row[c.name]; if (v === null || v === undefined) return `\`${c.name}\` IS NULL`; return `\`${c.name}\` = ${escapeVal(v)}` })
    return conds.length > 0 ? conds.join(' AND ') : null
  }

  // ==================== 导出 ====================
  const handleExport = useCallback(async (format: 'csv' | 'json' | 'sql', mode: 'all' | 'structure' | 'data' = 'all') => {
    setShowExportMenu(false)
    if (!config || !tab.database || !tab.table) return
    try {
      let dataRows: Record<string, unknown>[] = []
      let cols: string[] = []
      // 仅结构模式不需要查询数据
      if (mode !== 'structure') {
        setProgress({ current: 0, total: 100, label: '查询数据...' })
        let sql = `SELECT * FROM \`${tab.table}\``
        if (appliedConditions.length > 0) {
          const whereParts: string[] = []
          appliedConditions.forEach((cond, i) => {
            let part = ''
            if (cond.op === 'IS NULL') part = `\`${cond.column}\` IS NULL`
            else if (cond.op === 'IS NOT NULL') part = `\`${cond.column}\` IS NOT NULL`
            else if (cond.op === 'LIKE' || cond.op === 'NOT LIKE') part = `\`${cond.column}\` ${cond.op} '%${cond.value.replace(/'/g, "\\'")}%\'`
            else part = `\`${cond.column}\` ${cond.op} ${escapeVal(cond.value)}`
            whereParts.push(i === 0 ? part : `${cond.logic} ${part}`)
          })
          sql += ` WHERE ${whereParts.join(' ')}`
        }
        const res = await window.api.db.query(config, sql, tab.database)
        if (!res.success || !res.data) { showMsg('error', `导出失败: ${res.error}`); setProgress(null); return }
        dataRows = res.data.rows; cols = (res.data.columns ?? []).map((c) => c.name)
      } else {
        cols = columns.map((c) => c.name)
      }
      let content = ''; let ext = format; const total = dataRows.length
      if (format === 'csv') {
        setProgress({ current: 0, total, label: '生成 CSV...' })
        const lines: string[] = [cols.join(',')]
        for (let i = 0; i < dataRows.length; i++) {
          lines.push(cols.map((c) => { const v = dataRows[i][c]; if (v === null || v === undefined) return ''; const s = String(v); return /[,"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }).join(','))
          if ((i + 1) % 500 === 0 || i === dataRows.length - 1) { setProgress({ current: i + 1, total, label: '生成 CSV...' }); await new Promise((r) => setTimeout(r, 0)) }
        }
        content = lines.join('\n')
      } else if (format === 'json') {
        setProgress({ current: 0, total, label: '生成 JSON...' })
        const jsonRows: Record<string, unknown>[] = []
        for (let i = 0; i < dataRows.length; i++) {
          const obj: Record<string, unknown> = {}; cols.forEach((c) => obj[c] = dataRows[i][c]); jsonRows.push(obj)
          if ((i + 1) % 500 === 0 || i === dataRows.length - 1) { setProgress({ current: i + 1, total, label: '生成 JSON...' }); await new Promise((r) => setTimeout(r, 0)) }
        }
        content = JSON.stringify(jsonRows, null, 2)
      } else if (format === 'sql') {
        const colNames = cols.map((c) => `\`${c}\``).join(', ')
        content = `-- nexSQL 导出\n-- 数据库: ${tab.database}\n-- 表: ${tab.table}\n-- 生成时间: ${new Date().toLocaleString()}\n\n`
        // 结构部分（数据+结构 或 仅结构）
        if (mode === 'all' || mode === 'structure') {
          setProgress({ current: 0, total: total + 1, label: '获取表结构...' })
          content += `DROP TABLE IF EXISTS \`${tab.table}\`;\n`
          const ddlRes = await window.api.db.getTableDDL(config, tab.database, tab.table)
          if (ddlRes.success && ddlRes.data) content += ddlRes.data + ';\n\n'
        }
        // 数据部分（数据+结构 或 仅数据）
        if ((mode === 'all' || mode === 'data') && dataRows.length > 0) {
          setProgress({ current: 1, total: total + 1, label: '生成 SQL...' })
          for (let i = 0; i < dataRows.length; i++) {
            const vals = cols.map((c) => escapeVal(dataRows[i][c]))
            content += `INSERT INTO \`${tab.table}\` (${colNames}) VALUES (${vals.join(', ')});\n`
            if ((i + 1) % 500 === 0 || i === dataRows.length - 1) { setProgress({ current: i + 2, total: total + 1, label: '生成 SQL...' }); await new Promise((r) => setTimeout(r, 0)) }
          }
        }
      }
      setProgress({ current: total, total, label: '保存文件...' })
      const modeSuffix = format === 'sql' ? (mode === 'structure' ? '_structure' : mode === 'data' ? '_data' : '') : ''
      const saveRes = await window.api.file.saveDialog(`${tab.table}${modeSuffix}_export.${ext}`, content, ext)
      if (saveRes.success && saveRes.data?.saved) showMsg('success', `导出成功${format === 'sql' ? ` (${mode === 'structure' ? '仅结构' : mode === 'data' ? '仅数据' : '数据+结构'})` : ` (${dataRows.length} 行)`}`)
      setProgress(null)
    } catch (err) { setProgress(null); showMsg('error', `导出失败: ${(err as Error).message}`) }
  }, [config, tab, columns, appliedConditions, showMsg])

  // ==================== 导入 ====================
  const handleImport = useCallback(async (format: 'csv' | 'json' | 'sql') => {
    setShowExportMenu(false)
    if (!config || !tab.database || !tab.table) return
    try {
      const openRes = await window.api.file.openDialog(format)
      if (!openRes.success || openRes.data?.canceled) return
      const content = openRes.data!.content
      if (!content.trim()) { showMsg('error', '文件内容为空'); return }
      setLoading(true); let insertCount = 0
      const colNames = columns.map((c) => `\`${c.name}\``).join(', ')
      if (format === 'sql') {
        const statements = splitSqlStatements(content)
        const total = statements.length; setProgress({ current: 0, total, label: '执行 SQL...' })
        for (let i = 0; i < statements.length; i++) {
          const res = await window.api.db.query(config, statements[i], tab.database)
          if (res.success) insertCount += res.data?.affectedRows ?? 0
          if ((i + 1) % 20 === 0 || i === statements.length - 1) { setProgress({ current: i + 1, total, label: '执行 SQL...' }); await new Promise((r) => setTimeout(r, 0)) }
        }
      } else if (format === 'csv') {
        const lines = content.split('\n').filter((l) => l.trim())
        if (lines.length < 2) { showMsg('error', 'CSV 至少需要标题行 + 1 行数据'); setLoading(false); setProgress(null); return }
        const parseCSVLine = (line: string): string[] => {
          const result: string[] = []; let current = ''; let inQuotes = false
          for (let i = 0; i < line.length; i++) {
            const ch = line[i]
            if (ch === '"') { if (inQuotes && line[i + 1] === '"') { current += '"'; i++ } else inQuotes = !inQuotes }
            else if (ch === ',' && !inQuotes) { result.push(current); current = '' }
            else current += ch
          }
          result.push(current); return result
        }
        const headers = parseCSVLine(lines[0]); const dataLines = lines.length - 1
        setProgress({ current: 0, total: dataLines, label: '导入 CSV...' })
        for (let i = 1; i < lines.length; i++) {
          const values = parseCSVLine(lines[i])
          const vals = columns.map((c) => { const idx = headers.indexOf(c.name); if (idx < 0 || idx >= values.length) return 'NULL'; const v = values[idx].trim(); if (v === '') return 'NULL'; return escapeVal(v) }).join(', ')
          const res = await window.api.db.query(config, `INSERT INTO \`${tab.table}\` (${colNames}) VALUES (${vals})`, tab.database)
          if (res.success) insertCount++
          if ((i) % 50 === 0 || i === lines.length - 1) { setProgress({ current: i, total: dataLines, label: '导入 CSV...' }); await new Promise((r) => setTimeout(r, 0)) }
        }
      } else if (format === 'json') {
        const items = JSON.parse(content)
        if (!Array.isArray(items)) { showMsg('error', 'JSON 必须是数组'); setLoading(false); setProgress(null); return }
        const total = items.length; setProgress({ current: 0, total, label: '导入 JSON...' })
        for (let i = 0; i < items.length; i++) {
          const vals = columns.map((c) => escapeVal((items[i] as Record<string, unknown>)[c.name])).join(', ')
          const res = await window.api.db.query(config, `INSERT INTO \`${tab.table}\` (${colNames}) VALUES (${vals})`, tab.database)
          if (res.success) insertCount++
          if ((i + 1) % 50 === 0 || i === items.length - 1) { setProgress({ current: i + 1, total, label: '导入 JSON...' }); await new Promise((r) => setTimeout(r, 0)) }
        }
      }
      setProgress(null); showMsg('success', `导入成功 (${insertCount} 行)`); await loadData()
    } catch (err) { setProgress(null); showMsg('error', `导入失败: ${(err as Error).message}`) }
    finally { setLoading(false) }
  }, [config, tab, columns, loadData, showMsg])

  useEffect(() => {
    const onImport = (e: Event) => { const detail = (e as CustomEvent).detail; if (detail?.format) handleImport(detail.format) }
    const onExport = (e: Event) => { const detail = (e as CustomEvent).detail; if (detail?.format) handleExport(detail.format, detail?.mode) }
    window.addEventListener('nexsql-import', onImport); window.addEventListener('nexsql-export', onExport)
    return () => { window.removeEventListener('nexsql-import', onImport); window.removeEventListener('nexsql-export', onExport) }
  }, [handleImport, handleExport])

  // ==================== Glide Data Grid 回调 ====================
  const displayRowsRef = useRef<RowData[]>(rows)

  // 快捷搜索过滤
  const displayRows = useMemo(() => {
    if (!quickSearch.trim()) return rows
    const keyword = quickSearch.toLowerCase()
    return rows.filter((row) => columns.some((col) => { const val = row[col.name]; if (val === null || val === undefined) return false; return String(val).toLowerCase().includes(keyword) }))
  }, [rows, quickSearch, columns])

  useEffect(() => { displayRowsRef.current = displayRows }, [displayRows])

  // 排序：点击表头
  const handleHeaderClicked = useCallback((colIndex: number, _event: HeaderClickedEventArgs) => {
    if (colIndex < 0 || colIndex >= columns.length) return
    const colName = columns[colIndex].name
    if (sortCol === colName) {
      if (sortDir === 'ASC') setSortDir('DESC')
      else if (sortDir === 'DESC') { setSortCol(null); setSortDir(null) }
      else setSortDir('ASC')
    } else { setSortCol(colName); setSortDir('ASC') }
    setPage(0)
  }, [columns, sortCol, sortDir])

  // 列宽调整
  const handleColumnResize = useCallback((_col: GridColumn, newSize: number, colIndex: number) => {
    setColWidths((prev) => { const next = new Map(prev); next.set(colIndex, newSize); return next })
  }, [])

  // getCellContent
  const getCellContent = useCallback((cell: Item): GridCell => {
    const [col, rowIdx] = cell
    if (col < 0 || col >= columns.length || rowIdx >= displayRowsRef.current.length) {
      return { kind: GridCellKind.Loading, allowOverlay: false }
    }
    const colInfo = columns[col]
    const row = displayRowsRef.current[rowIdx]
    const val = row[colInfo.name]
    if (val === null || val === undefined) {
      return { kind: GridCellKind.Text, data: 'NULL', displayData: 'NULL', allowOverlay: true, style: 'faded' as const, themeOverride: { textLight: '#71717a', baseFontStyle: 'italic 12px' } }
    }
    if (typeof val === 'boolean' || (typeof val === 'number' && (val === 0 || val === 1) && colInfo.type.toLowerCase().includes('tinyint'))) {
      const boolVal = val === true || val === 1
      return { kind: GridCellKind.Boolean, data: boolVal, allowOverlay: false }
    }
    const str = typeof val === 'object' ? JSON.stringify(val) : String(val)
    if (isJsonString(str)) {
      const preview = str.length > 60 ? str.slice(0, 60) + '…' : str
      return { kind: GridCellKind.Text, data: str, displayData: `[JSON] ${preview}`, allowOverlay: true, themeOverride: { textDark: '#c084fc', baseFontStyle: '11px' } }
    }
    if (isBinaryType(colInfo.type)) {
      const hex = toHexPreview(val)
      return { kind: GridCellKind.Text, data: hex, displayData: `[BIN] ${hex}`, allowOverlay: false, themeOverride: { textDark: '#9ca3af', baseFontStyle: '11px' } }
    }
    return { kind: GridCellKind.Text, data: str, displayData: str, allowOverlay: true }
  }, [columns])

  // getCellsForSelection: true 用于复制

  // 行样式
  const getRowThemeOverride = useCallback((row: number): Partial<Theme> | undefined => {
    const dataRow = displayRowsRef.current[row]
    if (!dataRow) return undefined
    if (newKeys.has(dataRow._row_key)) return { bgCell: 'rgba(34, 197, 94, 0.08)', bgCellMedium: 'rgba(34, 197, 94, 0.12)' }
    if (dirtyKeys.has(dataRow._row_key)) return { bgCell: 'rgba(234, 179, 8, 0.06)', bgCellMedium: 'rgba(234, 179, 8, 0.10)' }
    return undefined
  }, [newKeys, dirtyKeys])

  // 自定义表头绘制（字段名 + 类型 双行显示）
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const drawHeader = useCallback((args: any): boolean => {
    const { ctx, rect, columnIndex, theme: t } = args
    const colInfo = columns[columnIndex]
    if (!colInfo) return false
    const name = colInfo.name
    const type = colInfo.type
    const pad = 8
    // 绘制表头背景
    ctx.fillStyle = t.bgHeader ?? '#25262b'
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height)
    // 字段名（第一行）
    ctx.font = `bold 11px ${t.fontFamily ?? 'sans-serif'}`
    ctx.fillStyle = t.textHeader ?? '#a1a1aa'
    ctx.textBaseline = 'middle'
    const nameY = rect.y + rect.height * 0.38
    const maxW = rect.width - pad * 2
    const nameTrunc = name.length > 20 ? name.slice(0, 18) + '…' : name
    ctx.fillText(nameTrunc, rect.x + pad, nameY, maxW)
    // 类型（第二行）
    ctx.font = `10px ${t.fontFamily ?? 'sans-serif'}`
    ctx.fillStyle = t.textMedium ?? '#71717a'
    const typeY = rect.y + rect.height * 0.68
    const typeTrunc = type.length > 24 ? type.slice(0, 22) + '…' : type
    ctx.fillText(typeTrunc, rect.x + pad, typeY, maxW)
    return true
  }, [columns])

  // 自动列宽计算（根据字段名、类型和内容长度）
  useEffect(() => {
    if (columns.length === 0) return
    const CHAR_W = 7.2 // JetBrains Mono 12px 平均字符宽度
    const PAD = 22     // 单元格左右内边距
    const MIN_W = 80
    const MAX_W = 500
    const widths = new Map<number, number>()
    columns.forEach((col, idx) => {
      // 表头宽度（字段名和类型取较长的那个）
      const headerLen = Math.max(col.name.length, col.type.length)
      let maxLen = headerLen
      // 采样前 50 行数据内容
      const sampleCount = Math.min(rows.length, 50)
      for (let i = 0; i < sampleCount; i++) {
        const val = rows[i][col.name]
        if (val === null || val === undefined) continue
        const str = typeof val === 'object' ? JSON.stringify(val) : String(val)
        if (str.length > maxLen) maxLen = str.length
      }
      // 超长内容截断显示，最大按 60 字符计算宽度
      const displayLen = Math.min(maxLen, 60)
      const w = Math.round(displayLen * CHAR_W + PAD)
      widths.set(idx, Math.max(MIN_W, Math.min(MAX_W, w)))
    })
    setColWidths(widths)
  }, [columns, rows])

  // 列定义
  const gridColumns = useMemo((): GridColumn[] => {
    return columns.map((col, idx) => {
      const width = colWidths.get(idx) ?? 150
      return { title: col.name, id: col.name, width, hasMenu: false }
    })
  }, [columns, colWidths])

  // 字段筛选
  const addCondition = useCallback(() => { if (columns.length === 0) return; const id = `f_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`; setConditions((prev) => [...prev, { id, logic: 'AND', column: columns[0].name, op: '=', value: '' }]) }, [columns])
  const removeCondition = useCallback((id: string) => { setConditions((prev) => prev.filter((c) => c.id !== id)) }, [])
  const updateCondition = useCallback((id: string, field: keyof FilterCondition, value: string) => { setConditions((prev) => prev.map((c) => (c.id === id ? { ...c, [field]: value } : c))) }, [])
  const applyFilter = useCallback(() => {
    const valid = conditions.filter((c) => { const op = FILTER_OPS.find((o) => o.value === c.op); if (!op) return false; if (op.needsValue && !c.value.trim()) return false; return true })
    setAppliedConditions(valid); setPage(0)
  }, [conditions])
  const clearFilter = useCallback(() => { setConditions([]); setAppliedConditions([]); setPage(0) }, [])
  const totalPages = Math.max(1, Math.ceil(totalRows / PAGE_SIZE))
  const startRow = totalRows === 0 ? 0 : page * PAGE_SIZE + 1
  const endRow = Math.min((page + 1) * PAGE_SIZE, totalRows)

  // 当前选中单元格（用于底部编辑器）
  const editorRowKey = useMemo(() => {
    const cell = gridSelection.current?.cell
    if (!cell) return null
    const row = displayRowsRef.current[cell[1]]
    return row?._row_key ?? null
  }, [gridSelection])
  const editorColName = useMemo(() => {
    const cell = gridSelection.current?.cell
    if (!cell) return null
    if (cell[0] < 0 || cell[0] >= columns.length) return null
    return columns[cell[0]].name
  }, [gridSelection, columns])

  // 范围选区批量填充辅助函数
  const fillRangeWithValue = useCallback((val: string) => {
    const sel = gridSelectionRef.current
    const range = sel.current?.range
    if (!range || (range.width <= 1 && range.height <= 1)) return false
    for (let r = range.y; r < range.y + range.height; r++) {
      const row = displayRowsRef.current[r]
      if (!row) continue
      for (let c = range.x; c < range.x + range.width; c++) {
        if (c < 0 || c >= columns.length) continue
        setCellValue(row._row_key, columns[c].name, val)
      }
    }
    return true
  }, [columns])

  // 全局键盘事件 (Ctrl+C/V + 范围选区输入填充)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const active = document.activeElement as HTMLElement
      const tag = active?.tagName
      const isEditable = tag === 'INPUT' || tag === 'TEXTAREA' || active?.isContentEditable
      // 仅当焦点明确在非网格的可编辑元素上时才跳过
      if (isEditable) return
      if (active && active !== document.body && active !== document.documentElement && !active.closest('.gdg-theme-override') && !active.closest('.flex.flex-col.h-full')) return

      const sel = gridSelectionRef.current
      const range = sel.current?.range
      const hasRange = range && (range.width > 1 || range.height > 1)

      // 范围选区 + Ctrl+V：粘贴剪贴板文本到所有选中单元格
      if ((e.ctrlKey || e.metaKey) && (e.key === 'v' || e.key === 'V') && hasRange) {
        e.preventDefault(); e.stopPropagation()
        navigator.clipboard.readText().then((text) => {
          if (text) fillRangeWithValue(text)
        }).catch(() => {})
        return
      }

      // 范围选区 + 输入字符：批量填充所有选中单元格
      if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key.length === 1 && hasRange) {
        e.preventDefault(); e.stopPropagation()
        fillRangeWithValue(e.key)
        return
      }

      // Ctrl+C / Ctrl+V（行级操作）
      if ((e.ctrlKey || e.metaKey)) {
        if (e.key === 'c' || e.key === 'C') { e.preventDefault(); handleCopyRows() }
        if (e.key === 'v' || e.key === 'V') { e.preventDefault(); handlePasteRows() }
      }
    }
    window.addEventListener('keydown', handleKeyDown, true); window.addEventListener('keyup', () => {})
    return () => { window.removeEventListener('keydown', handleKeyDown, true) }
  }, [handleCopyRows, handlePasteRows, fillRangeWithValue])

  const tbBtn = "flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
  const tbIconBtn = "flex items-center justify-center p-1.5 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"


  return (
    <div className="flex flex-col h-full">
      {/* 工具栏 */}
      <div className="flex items-center gap-1 px-2 py-1 border-b border-border-light bg-bg-secondary flex-shrink-0">
        {loading ? (
          <button onClick={handleStop} className={`${tbIconBtn} hover:bg-red-900/50 text-red-400`} title="停止查询">
            <Square size={14} fill="currentColor" />
          </button>
        ) : (
          <button onClick={loadData} className={`${tbIconBtn} hover:bg-bg-hover text-text-secondary hover:text-text-primary`} title="刷新">
            <RefreshCw size={14} />
          </button>
        )}
        <div className="h-4 w-px bg-border-light mx-1" />
        <button onClick={handleAddRow} disabled={loading || columns.length === 0} className={`${tbBtn} hover:bg-bg-hover text-text-secondary hover:text-green-400`} title="增加行"><Plus size={14} /></button>
        <button onClick={handleDeleteRows} disabled={loading || selectedRows.size === 0} className={`${tbBtn} hover:bg-bg-hover text-text-secondary hover:text-red-400`} title="删除选中行"><Trash2 size={14} /></button>
        <button onClick={handleCopyRows} disabled={loading || selectedRows.size === 0} className={`${tbBtn} hover:bg-bg-hover text-text-secondary hover:text-accent`} title="复制选中行（INSERT SQL）"><Copy size={14} /></button>
        <button onClick={handlePasteRows} disabled={loading || columns.length === 0} className={`${tbBtn} hover:bg-bg-hover text-text-secondary hover:text-accent`} title="粘贴为新增行"><ClipboardPaste size={14} /></button>
        {selectedRows.size > 0 && <span className="px-1.5 py-0.5 bg-accent/20 text-accent rounded text-[10px] font-medium">已选 {selectedRows.size} 行</span>}
        <div className="h-4 w-px bg-border-light mx-1" />
        <button onClick={handleCommit} disabled={loading || pendingCount === 0} className={`${tbBtn} hover:bg-green-900/40 text-text-secondary hover:text-green-400`} title="提交更改"><Check size={14} /><span>提交</span></button>
        <button onClick={handleRollback} disabled={loading || pendingCount === 0} className={`${tbBtn} hover:bg-bg-hover text-text-secondary hover:text-yellow-400`} title="回滚更改"><Undo2 size={14} /><span>回滚</span></button>
        {pendingCount > 0 && <span className="ml-1 px-1.5 py-0.5 bg-yellow-900/50 text-yellow-400 rounded text-[10px] font-medium">{pendingCount} 待提交</span>}
        <div className="h-4 w-px bg-border-light mx-1" />
        <button onClick={() => setShowFilter((v) => !v)} className={`${tbBtn} hover:bg-bg-hover text-text-secondary hover:text-text-primary ${showFilter || appliedConditions.length > 0 ? 'bg-accent/20 text-accent' : ''}`} title="字段筛选">
          <Filter size={14} />{appliedConditions.length > 0 && <span className="text-[10px]">{appliedConditions.length}</span>}
        </button>
        {/* 快捷搜索 */}
        <div className="flex items-center gap-1 bg-bg-primary border border-border-light rounded px-1.5 py-0.5 focus-within:border-accent transition-colors">
          <Search size={12} className="text-text-muted flex-shrink-0" />
          <input type="text" value={quickSearch} onChange={(e) => setQuickSearch(e.target.value)} placeholder="快速搜索..." className="w-24 bg-transparent text-[11px] text-text-primary outline-none placeholder:text-text-muted/60" />
          {quickSearch && (<>
            <span className="text-[10px] text-text-muted flex-shrink-0">{displayRows.length}/{rows.length}</span>
            <button onClick={() => setQuickSearch('')} className="text-text-muted hover:text-text-primary transition-colors flex-shrink-0"><X size={11} /></button>
          </>)}
        </div>
        <button onClick={() => setShowEditor((v) => !v)} className={`${tbBtn} hover:bg-bg-hover text-text-secondary hover:text-text-primary ${showEditor ? 'bg-accent/20 text-accent' : ''}`} title="底部字段编辑器">
          {showEditor ? <PanelBottomClose size={14} /> : <PanelBottomOpen size={14} />}
        </button>
        {/* 导入 */}
        <div className="relative" ref={importMenuRef}>
          <button onClick={() => setShowImportMenu((v) => !v)} disabled={loading || columns.length === 0} className={`${tbBtn} hover:bg-bg-hover text-text-secondary hover:text-text-primary`} title="导入数据"><Upload size={14} /><ChevronDown size={10} /></button>
          {showImportMenu && (
            <div className="absolute top-full left-0 mt-1 z-50 bg-bg-tertiary border border-border rounded-md shadow-2xl py-1 min-w-[120px]">
              <button onClick={() => { setShowImportMenu(false); handleImport('csv') }} className="w-full text-left px-3 py-1.5 text-xs text-text-primary hover:bg-bg-hover transition-colors">导入 CSV</button>
              <button onClick={() => { setShowImportMenu(false); handleImport('json') }} className="w-full text-left px-3 py-1.5 text-xs text-text-primary hover:bg-bg-hover transition-colors">导入 JSON</button>
              <button onClick={() => { setShowImportMenu(false); handleImport('sql') }} className="w-full text-left px-3 py-1.5 text-xs text-text-primary hover:bg-bg-hover transition-colors">导入 SQL</button>
            </div>
          )}
        </div>
        {/* 导出 */}
        <div className="relative" ref={exportMenuRef}>
          <button onClick={() => setShowExportMenu((v) => !v)} disabled={loading || columns.length === 0} className={`${tbBtn} hover:bg-bg-hover text-text-secondary hover:text-text-primary`} title="导出数据"><Download size={14} /><ChevronDown size={10} /></button>
          {showExportMenu && (
            <div className="absolute top-full right-0 mt-1 z-50 bg-bg-tertiary border border-border rounded-md shadow-2xl py-1 min-w-[160px]">
              <button onClick={() => handleExport('csv')} className="w-full text-left px-3 py-1.5 text-xs text-text-primary hover:bg-bg-hover transition-colors">导出 CSV</button>
              <button onClick={() => handleExport('json')} className="w-full text-left px-3 py-1.5 text-xs text-text-primary hover:bg-bg-hover transition-colors">导出 JSON</button>
              <div className="border-t border-border-light my-1" />
              <div className="px-3 py-1 text-[10px] text-text-muted uppercase tracking-wide">SQL 导出</div>
              <button onClick={() => handleExport('sql', 'all')} className="w-full text-left px-3 py-1.5 text-xs text-text-primary hover:bg-bg-hover transition-colors">数据 + 结构</button>
              <button onClick={() => handleExport('sql', 'structure')} className="w-full text-left px-3 py-1.5 text-xs text-text-primary hover:bg-bg-hover transition-colors">仅结构</button>
              <button onClick={() => handleExport('sql', 'data')} className="w-full text-left px-3 py-1.5 text-xs text-text-primary hover:bg-bg-hover transition-colors">仅数据</button>
            </div>
          )}
        </div>
        {/* 分页 */}
        <div className="ml-auto flex items-center gap-2 text-xs text-text-secondary">
          {loading ? <Loader2 size={12} className="animate-spin" /> : (<>
            <span>{startRow}-{endRow} / {totalRows}</span>
            <div className="flex items-center gap-0.5">
              <button onClick={() => setPage(0)} disabled={page === 0} className="p-1 hover:bg-bg-hover rounded transition-colors disabled:opacity-30"><ChevronsLeft size={14} /></button>
              <button onClick={() => setPage(page - 1)} disabled={page === 0} className="p-1 hover:bg-bg-hover rounded transition-colors disabled:opacity-30"><ChevronLeft size={14} /></button>
              <span className="px-1">{page + 1}/{totalPages}</span>
              <button onClick={() => setPage(page + 1)} disabled={page >= totalPages - 1} className="p-1 hover:bg-bg-hover rounded transition-colors disabled:opacity-30"><ChevronRight size={14} /></button>
              <button onClick={() => setPage(totalPages - 1)} disabled={page >= totalPages - 1} className="p-1 hover:bg-bg-hover rounded transition-colors disabled:opacity-30"><ChevronsRight size={14} /></button>
            </div>
          </>)}
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
                  <button onClick={addCondition} className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] hover:bg-bg-hover text-text-secondary hover:text-accent transition-colors"><Plus size={11} /> 添加条件</button>
                  <button onClick={applyFilter} className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] bg-accent/20 text-accent hover:bg-accent/30 transition-colors"><Check size={11} /> 应用</button>
                  {conditions.length > 0 && <button onClick={clearFilter} className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] hover:bg-bg-hover text-text-secondary hover:text-red-400 transition-colors"><X size={11} /> 清除</button>}
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
                      {idx === 0 ? <span className="text-[10px] w-12 text-center flex-shrink-0 text-text-muted"></span> : (
                        <select value={cond.logic} onChange={(e) => updateCondition(cond.id, 'logic', e.target.value)} className={`px-1 py-0.5 bg-bg-primary border border-border-light rounded text-[10px] font-medium w-12 text-center focus:outline-none focus:border-accent ${cond.logic === 'OR' ? 'text-orange-400' : 'text-blue-400'}`}>
                          <option value="AND">AND</option><option value="OR">OR</option>
                        </select>
                      )}
                      <select value={cond.column} onChange={(e) => updateCondition(cond.id, 'column', e.target.value)} className="px-1.5 py-1 bg-bg-primary border border-border-light rounded text-[11px] text-text-primary focus:outline-none focus:border-accent">
                        {columns.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
                      </select>
                      <select value={cond.op} onChange={(e) => updateCondition(cond.id, 'op', e.target.value)} className="px-1.5 py-1 bg-bg-primary border border-border-light rounded text-[11px] text-text-primary focus:outline-none focus:border-accent w-32">
                        {FILTER_OPS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                      {opInfo?.needsValue ? (
                        <input type="text" value={cond.value} onChange={(e) => updateCondition(cond.id, 'value', e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') applyFilter() }} placeholder="值..." autoFocus className="flex-1 px-2 py-1 bg-bg-primary border border-border-light rounded text-[11px] text-text-primary focus:outline-none focus:border-accent" />
                      ) : <div className="flex-1" />}
                      <button onClick={() => removeCondition(cond.id)} className="p-1 hover:bg-bg-hover rounded text-text-muted hover:text-red-400 transition-colors flex-shrink-0"><X size={12} /></button>
                    </div>
                  )
                })}
              </div>
            )}
            {appliedConditions.length > 0 && (
              <div className="mt-2 pt-1.5 border-t border-border-light/50 text-[10px] text-text-muted">
                已应用 {appliedConditions.length} 个条件: {' '}
                {appliedConditions.map((c, i) => (<span key={c.id}>{i > 0 && <span className={c.logic === 'OR' ? 'text-orange-400' : 'text-blue-400'}> {c.logic} </span>}<span className="text-accent">{c.column}</span> <span className="text-text-secondary">{c.op}</span> {c.value && <span className="text-text-primary">{c.value}</span>}</span>))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 状态提示 */}
      {statusMsg && <div className={`flex items-center gap-2 px-3 py-1 text-xs flex-shrink-0 ${statusMsg.type === 'success' ? 'bg-green-950/50 border-b border-green-700/50 text-green-300' : 'bg-red-950/50 border-b border-red-700/50 text-red-300'}`}>{statusMsg.type === 'success' ? <Check size={14} /> : <AlertCircle size={14} />}<span>{statusMsg.text}</span></div>}
      {error && <div className="flex items-start gap-2 p-3 text-sm text-red-400 flex-shrink-0"><AlertCircle size={16} className="flex-shrink-0 mt-0.5" /><pre className="whitespace-pre-wrap break-words font-mono text-xs">{error}</pre></div>}

      {/* 数据表格 - Glide Data Grid */}
      <div className="flex-1 overflow-hidden">
        {loading && <div className="flex items-center justify-center h-full text-text-secondary text-sm gap-2"><Loader2 size={16} className="animate-spin text-accent" /><span>加载中...</span><button onClick={handleStop} className="ml-2 px-2 py-0.5 text-xs bg-red-900/50 text-red-400 rounded hover:bg-red-800/50">停止</button></div>}
        {!loading && !error && displayRows.length > 0 && (
          <div className="h-full gdg-theme-override">
            <DataEditor
              ref={gridRef}
              getCellContent={getCellContent}
              columns={gridColumns}
              rows={displayRows.length}
              theme={GDG_THEME}
              rowMarkers="checkbox"
              rowSelect="multi"
              rowMarkerWidth={36}
              rangeSelect="rect"
              fillHandle={true}
              getCellsForSelection={true}
              onPaste={true}
              onCellEdited={handleCellEdited}
              onCellsEdited={handleCellsEdited}
              onHeaderClicked={handleHeaderClicked}
              onCellContextMenu={handleCellContextMenu}
              onColumnResize={handleColumnResize}
              gridSelection={gridSelection}
              onGridSelectionChange={handleGridSelectionChange}
              getRowThemeOverride={getRowThemeOverride}
              drawHeader={drawHeader}
              headerHeight={48}
              rowHeight={32}
              freezeColumns={0}
              className="h-full w-full"
            />
          </div>
        )}
        {!loading && !error && rows.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-text-muted text-sm gap-3">
            <span>{appliedConditions.length > 0 ? '没有匹配的数据' : '表中没有数据'}</span>
            <button onClick={handleAddRow} className="flex items-center gap-1 px-3 py-1.5 bg-accent/20 text-accent rounded hover:bg-accent/30 transition-colors"><Plus size={14} /> 添加行</button>
          </div>
        )}
        {!loading && !error && rows.length > 0 && displayRows.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-text-muted text-sm gap-2">
            <Search size={24} className="opacity-30" /><span>没有匹配「{quickSearch}」的行</span>
            <button onClick={() => setQuickSearch('')} className="text-xs text-accent hover:underline">清除搜索</button>
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
          onSelectField={(rowKey, colName) => {
            const rowIdx = displayRowsRef.current.findIndex((r) => r._row_key === rowKey)
            const colIdx = columns.findIndex((c) => c.name === colName)
            if (rowIdx >= 0 && colIdx >= 0) {
              setGridSelection({ current: { cell: [colIdx, rowIdx], range: { x: colIdx, y: rowIdx, width: 1, height: 1 }, rangeStack: [] }, columns: CompactSelection.empty(), rows: CompactSelection.empty() })
            }
          }}
          onCellValueChange={setCellValue}
          onClose={() => setShowEditor(false)}
        />
      )}

      {/* 进度条 */}
      {progress && (
        <div className="flex items-center gap-3 px-3 py-1.5 border-t border-border-light bg-bg-secondary flex-shrink-0">
          <span className="text-[11px] text-text-secondary flex-shrink-0 w-24 truncate">{progress.label}</span>
          <div className="flex-1 h-1.5 bg-bg-tertiary rounded-full overflow-hidden">
            <div className="h-full bg-accent rounded-full transition-all duration-150" style={{ width: `${progress.total > 0 ? Math.min(100, (progress.current / progress.total) * 100) : 0}%` }} />
          </div>
          <span className="text-[11px] text-text-muted flex-shrink-0 w-20 text-right">{progress.current} / {progress.total}</span>
        </div>
      )}

      {/* 底部状态栏 */}
      <div className="flex items-center gap-3 px-3 py-1 border-t border-border-light bg-bg-secondary text-xs text-text-muted flex-shrink-0">
        {columns.length > 0 && <span>{columns.length} 列</span>}
        {selectedRows.size > 0 && <span className="text-accent">{selectedRows.size} 行已选</span>}
        {newKeys.size > 0 && <span className="text-green-400">{newKeys.size} 新增</span>}
        {dirtyKeys.size > 0 && <span className="text-yellow-400">{dirtyKeys.size} 修改</span>}
        {pendingDeletes.length > 0 && <span className="text-red-400">{pendingDeletes.length} 删除</span>}
        {sortCol && <span className="flex items-center gap-1">{sortDir === 'ASC' ? <ArrowUp size={10} /> : <ArrowDown size={10} />}排序: {sortCol}</span>}
        <span className="ml-auto font-mono">{tab.database}.{tab.table}</span>
      </div>

      {/* 单元格右键菜单 */}
      {cellMenu && <CellContextMenu x={cellMenu.x} y={cellMenu.y} colType={cellMenu.colType} onClose={() => setCellMenu(null)} onSetNull={handleSetNull} onSetEmpty={handleSetEmpty} onDatePicker={handleOpenDatePicker} />}

      {/* 日期选择器弹窗 */}
      {datePicker && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40" onClick={() => setDatePicker(null)}>
          <div className="bg-bg-tertiary border border-border rounded-lg shadow-2xl p-4 w-72" onClick={(e) => e.stopPropagation()}>
            <div className="text-sm font-medium text-text-primary mb-3">选择日期时间</div>
            <input type="datetime-local" value={datePicker.value} onChange={(e) => setDatePicker({ ...datePicker, value: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') handleDatePickerConfirm(); if (e.key === 'Escape') setDatePicker(null) }} step={1} autoFocus className="w-full px-3 py-2 bg-bg-primary border border-border-light rounded text-sm text-text-primary focus:outline-none focus:border-accent transition-colors" />
            <div className="flex items-center justify-end gap-2 mt-3">
              <button onClick={() => setDatePicker(null)} className="px-3 py-1.5 rounded text-xs hover:bg-bg-hover text-text-secondary transition-colors">取消</button>
              <button onClick={handleDatePickerConfirm} className="px-3 py-1.5 rounded text-xs bg-accent text-white hover:bg-accent/80 transition-colors">确定</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ==================== 单元格右键菜单组件 ====================
function CellContextMenu({ x, y, colType, onClose, onSetNull, onSetEmpty, onDatePicker }: { x: number; y: number; colType: string; onClose: () => void; onSetNull: () => void; onSetEmpty: () => void; onDatePicker: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const isDate = isDateType(colType)
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose() }
    const handleEscape = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    setTimeout(() => { document.addEventListener('mousedown', handleClickOutside); document.addEventListener('keydown', handleEscape) }, 0)
    return () => { document.removeEventListener('mousedown', handleClickOutside); document.removeEventListener('keydown', handleEscape) }
  }, [onClose])
  const menuWidth = 160; const menuHeight = (isDate ? 5 : 3) * 32 + 8
  let mx = x, my = y
  if (mx + menuWidth > window.innerWidth) mx = window.innerWidth - menuWidth - 4
  if (my + menuHeight > window.innerHeight) my = window.innerHeight - menuHeight - 4
  return (
    <div ref={ref} className="fixed z-[100] min-w-[160px] bg-bg-tertiary border border-border rounded-md shadow-2xl py-1 text-sm" style={{ left: mx, top: my }}>
      <button onClick={() => { onSetNull(); onClose() }} className="w-full text-left px-3 py-1.5 text-xs text-text-primary hover:bg-bg-hover transition-colors">设为 <span className="text-text-muted italic">NULL</span></button>
      <button onClick={() => { onSetEmpty(); onClose() }} className="w-full text-left px-3 py-1.5 text-xs text-text-primary hover:bg-bg-hover transition-colors">设为空字符串 <span className="text-text-muted">("")</span></button>
      {isDate && (<><div className="h-px bg-border-light my-1" /><button onClick={() => { onDatePicker(); onClose() }} className="w-full text-left px-3 py-1.5 text-xs text-accent hover:bg-bg-hover transition-colors">选择日期时间...</button></>)}
    </div>
  )
}

// ==================== 底部字段编辑器面板 ====================
const EDITOR_HEIGHT_KEY = 'nexsql-editor-height'
const DEFAULT_EDITOR_HEIGHT = 220
const MIN_EDITOR_HEIGHT = 100
const MAX_EDITOR_HEIGHT = 600
function loadEditorHeight(): number { try { const v = localStorage.getItem(EDITOR_HEIGHT_KEY); if (v) { const n = parseInt(v, 10); if (n >= MIN_EDITOR_HEIGHT && n <= MAX_EDITOR_HEIGHT) return n } } catch {} return DEFAULT_EDITOR_HEIGHT }
function saveEditorHeight(m: number) { try { localStorage.setItem(EDITOR_HEIGHT_KEY, String(m)) } catch {} }

interface FieldEditorPanelProps { columns: ColumnInfo[]; rows: RowData[]; editorRowKey: string | null; editorColName: string | null; onSelectField: (rowKey: string, colName: string) => void; onCellValueChange: (rowKey: string, colName: string, value: unknown) => void; onClose: () => void }

function FieldEditorPanel({ columns, rows, editorRowKey, editorColName, onSelectField, onCellValueChange, onClose }: FieldEditorPanelProps) {
  const [isNull, setIsNull] = useState(false)
  const [textValue, setTextValue] = useState('')
  const [viewMode, setViewMode] = useState<'text' | 'json' | 'html'>('text')
  const [editorHeight, setEditorHeight] = useState(loadEditorHeight)
  const resizingRef = useRef(false)
  const startYRef = useRef(0)
  const startHRef = useRef(0)
  const curHRef = useRef(editorHeight)

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault(); resizingRef.current = true; startYRef.current = e.clientY; startHRef.current = editorHeight; curHRef.current = editorHeight
    const onMove = (ev: MouseEvent) => { if (!resizingRef.current) return; const delta = startYRef.current - ev.clientY; const newH = Math.min(MAX_EDITOR_HEIGHT, Math.max(MIN_EDITOR_HEIGHT, startHRef.current + delta)); curHRef.current = newH; setEditorHeight(newH) }
    const onUp = () => { resizingRef.current = false; saveEditorHeight(curHRef.current); window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); document.body.style.cursor = ''; document.body.style.userSelect = '' }
    document.body.style.cursor = 'row-resize'; document.body.style.userSelect = 'none'
    window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp)
  }, [editorHeight])

  const selectedRow = useMemo(() => rows.find((r) => r._row_key === editorRowKey) ?? null, [rows, editorRowKey])
  const selectedCol = useMemo(() => columns.find((c) => c.name === editorColName) ?? null, [columns, editorColName])

  useEffect(() => {
    if (!selectedRow || !selectedCol) { setTextValue(''); setIsNull(false); return }
    const raw = selectedRow[selectedCol.name]; const str = raw === null || raw === undefined ? '' : typeof raw === 'object' ? JSON.stringify(raw) : String(raw); const trimmed = str.trim()
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) setViewMode('json'); else setViewMode('text')
    if ((raw === null || raw === undefined) && selectedCol.nullable) { setIsNull(true); setTextValue('') } else { setIsNull(false); setTextValue(str) }
  }, [selectedRow, selectedCol])

  const isDateCol = selectedCol ? isDateType(selectedCol.type) : false
  const isJsonContent = useMemo(() => { if (!textValue) return false; const trimmed = textValue.trim(); return trimmed.startsWith('{') || trimmed.startsWith('[') }, [textValue])
  const isHtmlContent = useMemo(() => { if (!textValue) return false; return /<[^>]+>/.test(textValue) && /<\/[a-zA-Z]/.test(textValue) }, [textValue])
  const hasSpecialView = (isJsonContent || isHtmlContent) && !isNull

  const commitValue = useCallback((val: unknown) => { if (!editorRowKey || !editorColName) return; onCellValueChange(editorRowKey, editorColName, val) }, [editorRowKey, editorColName, onCellValueChange])
  const handleTextChange = (v: string) => { setTextValue(v); commitValue(isNull ? null : v) }
  const handleToggleNull = () => { const newVal = !isNull; setIsNull(newVal); if (newVal) commitValue(null); else commitValue(textValue) }
  const handleDateChange = (datetimeLocal: string) => {
    if (!datetimeLocal) { setTextValue(''); commitValue(null); return }
    const d = new Date(datetimeLocal); const pad = (n: number) => String(n).padStart(2, '0')
    const mysqlDate = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
    setTextValue(mysqlDate); commitValue(mysqlDate)
  }
  const handleFormatJson = useCallback(() => { if (!textValue.trim()) return; try { const parsed = JSON.parse(textValue); const formatted = JSON.stringify(parsed, null, 2); setTextValue(formatted); commitValue(formatted) } catch {} }, [textValue, commitValue])
  const handleMinifyJson = useCallback(() => { if (!textValue.trim()) return; try { const parsed = JSON.parse(textValue); const minified = JSON.stringify(parsed); setTextValue(minified); commitValue(minified) } catch {} }, [textValue, commitValue])
  const datetimeLocalValue = useMemo(() => { if (!selectedRow || !selectedCol) return ''; const v = selectedRow[selectedCol.name]; if (!v) return ''; const d = new Date(v as string); if (isNaN(d.getTime())) return ''; const pad = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` }, [selectedRow, selectedCol])

  return (
    <div className="flex flex-col flex-shrink-0 border-t border-border">
      <div onMouseDown={handleResizeStart} className="h-1.5 bg-bg-tertiary hover:bg-accent/40 cursor-row-resize flex items-center justify-center transition-colors group flex-shrink-0" title="拖拽调整高度"><div className="w-8 h-0.5 bg-border-light rounded group-hover:bg-accent/60 transition-colors" /></div>
      <div className="flex bg-bg-tertiary flex-shrink-0" style={{ height: editorHeight }}>
        <div className="w-44 border-r border-border-light flex flex-col flex-shrink-0">
          <div className="px-2 py-1 text-[10px] font-medium text-text-muted border-b border-border-light uppercase tracking-wider flex-shrink-0">字段列表</div>
          <div className="flex-1 overflow-y-auto">
            {selectedRow && columns.map((col) => {
              const isSelected = editorColName === col.name; const val = selectedRow[col.name]; const isNullVal = val === null || val === undefined
              return (
                <button key={col.name} onClick={() => onSelectField(editorRowKey!, col.name)} className={`w-full text-left px-2 py-1 text-xs flex items-center gap-1 border-l-2 transition-colors ${isSelected ? 'bg-accent/15 border-l-accent text-text-primary' : 'border-l-transparent hover:bg-bg-hover text-text-secondary'}`}>
                  {col.isPrimaryKey && <Key size={9} className="text-yellow-400 flex-shrink-0" />}
                  <span className="truncate flex-1">{col.name}</span>
                  <span className={`text-[9px] flex-shrink-0 ${isNullVal ? 'text-text-muted italic' : 'text-text-muted/60'}`}>{isNullVal ? 'NULL' : col.type}</span>
                </button>
              )
            })}
          </div>
        </div>
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border-light flex-shrink-0">
            <span className="text-xs font-medium text-text-primary">{selectedCol?.name ?? '未选择字段'}</span>
            {selectedCol && <span className="text-[10px] text-text-muted px-1.5 py-0.5 bg-bg-primary rounded border border-border-light">{selectedCol.type}</span>}
            {selectedCol && <span className={`text-[10px] ${selectedCol.nullable ? 'text-green-400' : 'text-red-400'}`}>{selectedCol.nullable ? 'NULLABLE' : 'NOT NULL'}</span>}
            <div className="ml-auto flex items-center gap-2">
              {hasSpecialView && (
                <div className="flex items-center gap-0.5 mr-1">
                  <div className="flex items-center bg-bg-primary border border-border-light rounded overflow-hidden mr-1">
                    <button onClick={() => setViewMode('text')} className={`px-1.5 py-0.5 text-[10px] font-medium transition-colors ${viewMode === 'text' ? 'bg-accent text-white' : 'text-text-muted hover:text-text-primary'}`}>文本</button>
                    {isJsonContent && <button onClick={() => setViewMode('json')} className={`px-1.5 py-0.5 text-[10px] font-medium transition-colors ${viewMode === 'json' ? 'bg-accent text-white' : 'text-text-muted hover:text-text-primary'}`}>JSON</button>}
                    {isHtmlContent && <button onClick={() => setViewMode('html')} className={`px-1.5 py-0.5 text-[10px] font-medium transition-colors ${viewMode === 'html' ? 'bg-accent text-white' : 'text-text-muted hover:text-text-primary'}`}>HTML</button>}
                  </div>
                  {viewMode === 'json' && isJsonContent && (<><button onClick={handleFormatJson} className="px-1.5 py-0.5 text-[10px] rounded hover:bg-bg-hover text-text-secondary hover:text-accent transition-colors border border-border-light" title="格式化 JSON">格式化</button><button onClick={handleMinifyJson} className="px-1.5 py-0.5 text-[10px] rounded hover:bg-bg-hover text-text-secondary hover:text-accent transition-colors border border-border-light" title="压缩 JSON">压缩</button></>)}
                </div>
              )}
              {selectedCol?.nullable && <label className="flex items-center gap-1 text-[10px] text-text-secondary cursor-pointer select-none"><input type="checkbox" checked={isNull} onChange={handleToggleNull} className="w-3 h-3 accent-accent" />NULL</label>}
              <button onClick={onClose} className="p-0.5 hover:bg-bg-hover rounded text-text-muted hover:text-text-primary transition-colors"><X size={14} /></button>
            </div>
          </div>
          <div className="flex-1 overflow-hidden p-2">
            {!selectedRow || !selectedCol ? <div className="flex items-center justify-center h-full text-text-muted text-xs">点击表格中的单元格选择要编辑的字段</div>
            : isNull ? <div className="flex items-center justify-center h-full text-text-muted italic text-sm">NULL</div>
            : viewMode === 'html' ? <div className="h-full flex flex-col gap-1"><iframe srcDoc={`<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{font-family:system-ui,sans-serif;font-size:13px;padding:8px;margin:0;color:#333;background:#fff;}img{max-width:100%;}table{border-collapse:collapse;}td,th{border:1px solid #ddd;padding:4px 8px;}</style></head><body>${textValue}</body></html>`} className="flex-1 w-full bg-white border border-border-light rounded" sandbox="allow-same-origin" title="HTML 预览" /></div>
            : viewMode === 'json' ? <textarea value={textValue} onChange={(e) => handleTextChange(e.target.value)} placeholder='{"key": "value"}' className="w-full h-full px-2 py-1.5 bg-bg-primary border border-border-light rounded text-xs font-mono text-text-primary focus:outline-none focus:border-accent transition-colors resize-none leading-relaxed" spellCheck={false} />
            : isDateCol ? <div className="flex flex-col gap-2 h-full justify-center"><div className="flex items-center gap-2"><input type="datetime-local" value={datetimeLocalValue} onChange={(e) => handleDateChange(e.target.value)} step={1} className="px-3 py-1.5 bg-bg-primary border border-border-light rounded text-sm text-text-primary focus:outline-none focus:border-accent transition-colors" /><span className="text-[10px] text-text-muted">MySQL: {textValue || '(空)'}</span></div></div>
            : <textarea value={textValue} onChange={(e) => handleTextChange(e.target.value)} placeholder="输入值..." className="w-full h-full px-2 py-1.5 bg-bg-primary border border-border-light rounded text-xs font-mono text-text-primary focus:outline-none focus:border-accent transition-colors resize-none leading-relaxed" spellCheck={false} />}
          </div>
          {selectedCol && !isNull && <div className="px-3 py-0.5 border-t border-border-light text-[10px] text-text-muted flex-shrink-0 text-right">{textValue.length} 字符</div>}
        </div>
      </div>
    </div>
  )
}
