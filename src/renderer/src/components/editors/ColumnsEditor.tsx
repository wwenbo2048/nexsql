import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Loader2,
  AlertCircle,
  Key,
  Plus,
  Trash2,
  Check,
  Undo2,
  ChevronUp,
  ChevronDown
} from 'lucide-react'
import { useConnectionStore } from '@stores/connection'
import type { ColumnInfo } from '@shared/types'

interface Props {
  connectionId: string
  database: string
  table: string
}

interface EditableColumn extends ColumnInfo {
  _id: string
  _isNew?: boolean
  _isDeleted?: boolean
  _original?: ColumnInfo
}

let colIdCounter = 0
function genColId(): string {
  colIdCounter++
  return `col_${Date.now()}_${colIdCounter}`
}

export default function ColumnsEditor({ connectionId, database, table }: Props) {
  const connections = useConnectionStore((s) => s.connections)
  const config = connections.find((c) => c.id === connectionId)

  const [columns, setColumns] = useState<EditableColumn[]>([])
  const [originalColumns, setOriginalColumns] = useState<EditableColumn[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const msgTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showMsg = useCallback((type: 'success' | 'error', text: string) => {
    setStatusMsg({ type, text })
    if (msgTimerRef.current) clearTimeout(msgTimerRef.current)
    msgTimerRef.current = setTimeout(() => setStatusMsg(null), 4000)
  }, [])

  const loadData = useCallback(async () => {
    if (!config) return
    setLoading(true)
    setError(null)
    try {
      const res = await window.api.db.getTableColumns(config, database, table)
      if (res.success && res.data) {
        const editable: EditableColumn[] = res.data.map((c) => ({
          ...c,
          _id: genColId(),
          _original: { ...c }
        }))
        setColumns(editable)
        setOriginalColumns(editable.map((c) => ({ ...c })))
      } else if (!res.success) {
        setError(res.error ?? '加载失败')
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [config, database, table])

  useEffect(() => {
    loadData()
  }, [loadData])

  const dirtyCount = columns.filter((col) => {
    const orig = originalColumns.find((o) => o._id === col._id)
    if (col._isNew) return true
    if (col._isDeleted) return true
    if (!orig) return false
    return (
      col.name !== orig.name || col.type !== orig.type ||
      col.nullable !== orig.nullable || col.defaultValue !== orig.defaultValue ||
      col.comment !== orig.comment || col.extra !== orig.extra
    )
  }).length

  const handleCellChange = useCallback((colId: string, field: keyof EditableColumn, value: unknown) => {
    setColumns((prev) => prev.map((c) => (c._id === colId ? { ...c, [field]: value } : c)))
  }, [])

  const handleAddColumn = useCallback(() => {
    const newCol: EditableColumn = {
      _id: genColId(),
      name: 'new_column',
      type: 'varchar(255)',
      nullable: true,
      isPrimaryKey: false,
      isUnique: false,
      defaultValue: null,
      extra: '',
      comment: '',
      _isNew: true
    }
    setColumns((prev) => [...prev, newCol])
  }, [])

  const handleDeleteColumn = useCallback((colId: string) => {
    setColumns((prev) =>
      prev.map((c) =>
        c._id === colId
          ? c._isNew ? null : { ...c, _isDeleted: !c._isDeleted }
          : c
      ).filter(Boolean) as EditableColumn[]
    )
  }, [])

  const handleMoveUp = useCallback((idx: number) => {
    if (idx === 0) return
    setColumns((prev) => {
      const arr = [...prev]
      ;[arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]]
      return arr
    })
  }, [])

  const handleMoveDown = useCallback((idx: number) => {
    setColumns((prev) => {
      const arr = [...prev]
      if (idx >= arr.length - 1) return arr
      ;[arr[idx], arr[idx + 1]] = [arr[idx + 1], arr[idx]]
      return arr
    })
  }, [])

  const handleRollback = useCallback(() => {
    setColumns(originalColumns.map((c) => ({ ...c })))
    showMsg('success', '已回滚所有更改')
  }, [originalColumns, showMsg])

  const handleCommit = useCallback(async () => {
    if (!config) return
    const sqls: string[] = []
    for (const col of columns) {
      const orig = originalColumns.find((o) => o._id === col._id)
      if (col._isDeleted && orig && !orig._isNew) {
        sqls.push(`ALTER TABLE \`${table}\` DROP COLUMN \`${orig.name}\`;`)
        continue
      }
      if (col._isNew && !col._isDeleted) {
        const parts = [`\`${col.name}\` ${col.type}`]
        parts.push(col.nullable ? 'NULL' : 'NOT NULL')
        if (col.defaultValue) parts.push(`DEFAULT ${/^-?\d+/.test(col.defaultValue) ? col.defaultValue : `'${col.defaultValue.replace(/'/g, "\\'")}'`}`)
        if (col.extra) parts.push(col.extra)
        if (col.comment) parts.push(`COMMENT '${col.comment.replace(/'/g, "\\'")}'`)
        sqls.push(`ALTER TABLE \`${table}\` ADD COLUMN ${parts.join(' ')};`)
        continue
      }
      if (orig && !col._isDeleted) {
        const changed = col.name !== orig.name || col.type !== orig.type || col.nullable !== orig.nullable || col.defaultValue !== orig.defaultValue || col.comment !== orig.comment || col.extra !== orig.extra
        if (changed) {
          const parts = [`\`${col.name}\` ${col.type}`]
          parts.push(col.nullable ? 'NULL' : 'NOT NULL')
          if (col.defaultValue) parts.push(`DEFAULT ${/^-?\d+/.test(col.defaultValue) ? col.defaultValue : `'${col.defaultValue.replace(/'/g, "\\'")}'`}`)
          if (col.extra) parts.push(col.extra)
          if (col.comment) parts.push(`COMMENT '${col.comment.replace(/'/g, "\\'")}'`)
          sqls.push(`ALTER TABLE \`${table}\` MODIFY COLUMN ${parts.join(' ')};`)
        }
      }
    }
    if (sqls.length === 0) { showMsg('error', '没有待提交的更改'); return }
    setLoading(true)
    for (const sql of sqls) {
      const res = await window.api.db.query(config, sql, database)
      if (!res.success) { showMsg('error', `执行失败: ${res.error}`); setLoading(false); return }
    }
    setLoading(false)
    showMsg('success', `成功提交 ${sqls.length} 条结构更改`)
    await loadData()
  }, [config, columns, originalColumns, table, database, loadData, showMsg])

  const inputClass = "w-full px-1.5 py-0.5 bg-transparent border border-transparent hover:border-border-light focus:border-accent focus:bg-bg-primary rounded text-xs font-mono text-text-primary focus:outline-none transition-colors"

  if (loading && columns.length === 0) {
    return <div className="flex items-center justify-center h-full text-text-secondary text-sm gap-2"><Loader2 size={16} className="animate-spin text-accent" />加载字段...</div>
  }
  if (error) {
    return <div className="flex items-start gap-2 p-3 text-sm text-red-400"><AlertCircle size={16} className="flex-shrink-0 mt-0.5" /><pre className="whitespace-pre-wrap break-words font-mono text-xs">{error}</pre></div>
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-1 px-2 py-1 border-b border-border-light bg-bg-secondary flex-shrink-0">
        <button onClick={handleAddColumn} className="flex items-center gap-1 px-2 py-1 rounded text-xs hover:bg-bg-hover text-text-secondary hover:text-green-400 transition-colors" title="添加字段"><Plus size={14} /><span>添加字段</span></button>
        <div className="h-4 w-px bg-border-light mx-0.5" />
        <button onClick={handleCommit} disabled={dirtyCount === 0 || loading} className="flex items-center gap-1 px-2 py-1 rounded text-xs hover:bg-green-900/40 text-text-secondary hover:text-green-400 transition-colors disabled:opacity-30" title="提交"><Check size={14} /><span>提交</span></button>
        <button onClick={handleRollback} disabled={dirtyCount === 0 || loading} className="flex items-center gap-1 px-2 py-1 rounded text-xs hover:bg-bg-hover text-text-secondary hover:text-yellow-400 transition-colors disabled:opacity-30" title="回滚"><Undo2 size={14} /><span>回滚</span></button>
        {dirtyCount > 0 && <span className="ml-1 px-1.5 py-0.5 bg-yellow-900/50 text-yellow-400 rounded text-[10px] font-medium">{dirtyCount} 待提交</span>}
        {loading && <Loader2 size={12} className="animate-spin text-accent ml-1" />}
      </div>
      {statusMsg && (
        <div className={`flex items-center gap-2 px-3 py-1 text-xs flex-shrink-0 ${statusMsg.type === 'success' ? 'bg-green-950/50 border-b border-green-700/50 text-green-300' : 'bg-red-950/50 border-b border-red-700/50 text-red-300'}`}>
          {statusMsg.type === 'success' ? <Check size={14} /> : <AlertCircle size={14} />}
          <span>{statusMsg.text}</span>
        </div>
      )}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs border-collapse">
          <thead className="sticky top-0 z-10">
            <tr className="bg-bg-secondary">
              <th className="px-2 py-2 text-center text-text-secondary font-medium border-b border-r border-border-light w-10">#</th>
              <th className="px-2 py-2 text-center text-text-secondary font-medium border-b border-r border-border-light w-8"></th>
              <th className="px-2 py-2 text-left text-text-secondary font-medium border-b border-r border-border-light min-w-[120px]">字段名</th>
              <th className="px-2 py-2 text-left text-text-secondary font-medium border-b border-r border-border-light min-w-[120px]">类型</th>
              <th className="px-2 py-2 text-center text-text-secondary font-medium border-b border-r border-border-light w-16">允许空</th>
              <th className="px-2 py-2 text-left text-text-secondary font-medium border-b border-r border-border-light min-w-[100px]">默认值</th>
              <th className="px-2 py-2 text-left text-text-secondary font-medium border-b border-r border-border-light min-w-[80px]">额外</th>
              <th className="px-2 py-2 text-left text-text-secondary font-medium border-b border-r border-border-light min-w-[120px]">注释</th>
              <th className="px-2 py-2 text-center text-text-secondary font-medium border-b border-border-light w-16">操作</th>
            </tr>
          </thead>
          <tbody>
            {columns.map((col, idx) => {
              const orig = originalColumns.find((o) => o._id === col._id)
              const isDirty = col._isNew || (orig && (col.name !== orig.name || col.type !== orig.type || col.nullable !== orig.nullable || col.defaultValue !== orig.defaultValue || col.comment !== orig.comment))
              const rowBg = col._isDeleted ? 'bg-red-950/20 opacity-50' : col._isNew ? 'bg-green-950/15' : isDirty ? 'bg-yellow-950/10' : ''
              return (
                <tr key={col._id} className={`border-b border-border-light/50 ${rowBg}`}>
                  <td className="px-2 py-1 text-center text-text-muted border-r border-border-light">{idx + 1}</td>
                  <td className="px-2 py-1 text-center border-r border-border-light">{col.isPrimaryKey && <Key size={11} className="text-yellow-400 inline" />}</td>
                  <td className="px-1 py-0.5 border-r border-border-light"><input type="text" value={col.name} onChange={(e) => handleCellChange(col._id, 'name', e.target.value)} className={inputClass} disabled={col._isDeleted} /></td>
                  <td className="px-1 py-0.5 border-r border-border-light"><input type="text" value={col.type} onChange={(e) => handleCellChange(col._id, 'type', e.target.value)} className={inputClass} disabled={col._isDeleted} list="mysql-types" /></td>
                  <td className="px-1 py-0.5 text-center border-r border-border-light"><input type="checkbox" checked={col.nullable} onChange={(e) => handleCellChange(col._id, 'nullable', e.target.checked)} className="cursor-pointer" disabled={col._isDeleted || col.isPrimaryKey} /></td>
                  <td className="px-1 py-0.5 border-r border-border-light"><input type="text" value={col.defaultValue ?? ''} onChange={(e) => handleCellChange(col._id, 'defaultValue', e.target.value || null)} className={inputClass} disabled={col._isDeleted} placeholder="NULL" /></td>
                  <td className="px-1 py-0.5 border-r border-border-light"><input type="text" value={col.extra ?? ''} onChange={(e) => handleCellChange(col._id, 'extra', e.target.value)} className={inputClass} disabled={col._isDeleted} placeholder="auto_increment" /></td>
                  <td className="px-1 py-0.5 border-r border-border-light"><input type="text" value={col.comment ?? ''} onChange={(e) => handleCellChange(col._id, 'comment', e.target.value)} className={inputClass} disabled={col._isDeleted} /></td>
                  <td className="px-1 py-0.5 text-center border-r border-border-light">
                    <div className="flex items-center justify-center gap-0.5">
                      <button onClick={() => handleMoveUp(idx)} disabled={idx === 0 || col._isDeleted} className="p-0.5 hover:bg-bg-hover rounded text-text-muted hover:text-text-primary disabled:opacity-20" title="上移"><ChevronUp size={12} /></button>
                      <button onClick={() => handleMoveDown(idx)} disabled={idx >= columns.length - 1 || col._isDeleted} className="p-0.5 hover:bg-bg-hover rounded text-text-muted hover:text-text-primary disabled:opacity-20" title="下移"><ChevronDown size={12} /></button>
                      <button onClick={() => handleDeleteColumn(col._id)} className={`p-0.5 hover:bg-bg-hover rounded ${col._isDeleted ? 'text-green-400' : 'text-text-muted hover:text-red-400'}`} title={col._isDeleted ? '恢复' : '删除'}>{col._isDeleted ? <Undo2 size={12} /> : <Trash2 size={12} />}</button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <datalist id="mysql-types">
          <option value="int" /><option value="bigint" /><option value="tinyint(1)" /><option value="varchar(255)" /><option value="text" /><option value="longtext" /><option value="decimal(10,2)" /><option value="float" /><option value="double" /><option value="datetime" /><option value="timestamp" /><option value="date" /><option value="json" /><option value="blob" />
        </datalist>
      </div>
    </div>
  )
}

