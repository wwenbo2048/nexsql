import { useState, useEffect, useCallback } from 'react'
import { Loader2, AlertCircle, Plus, Trash2, Check, Undo2, Link2 } from 'lucide-react'
import { useConnectionStore } from '@stores/connection'
import type { IndexInfo } from '@shared/types'

interface Props {
  connectionId: string
  database: string
  table: string
}

interface EditableIndex extends IndexInfo {
  _id: string
  _isNew?: boolean
  _isDeleted?: boolean
}

let idxCounter = 0
const genId = () => `idx_${Date.now()}_${++idxCounter}`

export default function IndexesEditor({ connectionId, database, table }: Props) {
  const connections = useConnectionStore((s) => s.connections)
  const config = connections.find((c) => c.id === connectionId)
  const [indexes, setIndexes] = useState<EditableIndex[]>([])
  const [origIndexes, setOrigIndexes] = useState<EditableIndex[]>([])
  const [loading, setLoading] = useState(true)
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const loadData = useCallback(async () => {
    if (!config) return
    setLoading(true)
    try {
      const res = await window.api.db.getTableIndexes(config, database, table)
      if (res.success && res.data) {
        const editable = res.data.map((i) => ({ ...i, _id: genId() }))
        setIndexes(editable)
        setOrigIndexes(editable.map((i) => ({ ...i })))
      }
    } finally {
      setLoading(false)
    }
  }, [config, database, table])

  useEffect(() => { loadData() }, [loadData])

  const showMsg = useCallback((type: 'success' | 'error', text: string) => {
    setStatusMsg({ type, text })
    setTimeout(() => setStatusMsg(null), 4000)
  }, [])

  const dirtyCount = indexes.filter((idx) => {
    const orig = origIndexes.find((o) => o._id === idx._id)
    if (idx._isNew) return true
    if (idx._isDeleted) return true
    if (!orig) return false
    return idx.name !== orig.name || idx.column !== orig.column || idx.type !== orig.type || idx.isUnique !== orig.isUnique
  }).length

  const handleCellChange = useCallback((id: string, field: keyof EditableIndex, value: unknown) => {
    setIndexes((prev) => prev.map((i) => (i._id === id ? { ...i, [field]: value } : i)))
  }, [])

  const handleAdd = useCallback(() => {
    setIndexes((prev) => [...prev, { _id: genId(), name: 'idx_new', column: '', isUnique: false, type: 'BTREE', _isNew: true }])
  }, [])

  const handleDelete = useCallback((id: string) => {
    setIndexes((prev) => prev.map((i) => (i._id === id ? (i._isNew ? null : { ...i, _isDeleted: !i._isDeleted }) : i)).filter(Boolean) as EditableIndex[])
  }, [])

  const handleRollback = useCallback(() => {
    setIndexes(origIndexes.map((i) => ({ ...i })))
    showMsg('success', '已回滚')
  }, [origIndexes, showMsg])

  const handleCommit = useCallback(async () => {
    if (!config) return
    const sqls: string[] = []
    for (const idx of indexes) {
      const orig = origIndexes.find((o) => o._id === idx._id)
      if (idx._isDeleted && orig && !orig._isNew) {
        sqls.push(`ALTER TABLE \`${table}\` DROP INDEX \`${orig.name}\`;`)
        continue
      }
      if (idx._isNew && !idx._isDeleted) {
        const idxType = idx.isUnique ? 'UNIQUE' : 'INDEX'
        sqls.push(`ALTER TABLE \`${table}\` ADD ${idxType} \`${idx.name}\` (\`${idx.column}\`);`)
        continue
      }
      if (orig && !idx._isDeleted) {
        const changed = idx.name !== orig.name || idx.column !== orig.column || idx.isUnique !== orig.isUnique
        if (changed) {
          sqls.push(`ALTER TABLE \`${table}\` DROP INDEX \`${orig.name}\`;`)
          const idxType = idx.isUnique ? 'UNIQUE' : 'INDEX'
          sqls.push(`ALTER TABLE \`${table}\` ADD ${idxType} \`${idx.name}\` (\`${idx.column}\`);`)
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
    showMsg('success', `成功提交 ${sqls.length} 条更改`)
    await loadData()
  }, [config, indexes, origIndexes, table, database, loadData, showMsg])

  const inputClass = "w-full px-1.5 py-0.5 bg-transparent border border-transparent hover:border-border-light focus:border-accent focus:bg-bg-primary rounded text-xs font-mono text-text-primary focus:outline-none transition-colors"

  if (loading && indexes.length === 0) return <div className="flex items-center justify-center h-full text-text-secondary text-sm gap-2"><Loader2 size={16} className="animate-spin text-accent" />加载索引...</div>

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-1 px-2 py-1 border-b border-border-light bg-bg-secondary flex-shrink-0">
        <button onClick={handleAdd} className="flex items-center gap-1 px-2 py-1 rounded text-xs hover:bg-bg-hover text-text-secondary hover:text-green-400 transition-colors"><Plus size={14} /><span>添加索引</span></button>
        <div className="h-4 w-px bg-border-light mx-0.5" />
        <button onClick={handleCommit} disabled={dirtyCount === 0 || loading} className="flex items-center gap-1 px-2 py-1 rounded text-xs hover:bg-green-900/40 text-text-secondary hover:text-green-400 disabled:opacity-30"><Check size={14} /><span>提交</span></button>
        <button onClick={handleRollback} disabled={dirtyCount === 0 || loading} className="flex items-center gap-1 px-2 py-1 rounded text-xs hover:bg-bg-hover text-text-secondary hover:text-yellow-400 disabled:opacity-30"><Undo2 size={14} /><span>回滚</span></button>
        {dirtyCount > 0 && <span className="ml-1 px-1.5 py-0.5 bg-yellow-900/50 text-yellow-400 rounded text-[10px]">{dirtyCount} 待提交</span>}
      </div>
      {statusMsg && <div className={`flex items-center gap-2 px-3 py-1 text-xs ${statusMsg.type === 'success' ? 'bg-green-950/50 text-green-300' : 'bg-red-950/50 text-red-300'} flex-shrink-0`}>{statusMsg.type === 'success' ? <Check size={14} /> : <AlertCircle size={14} />}<span>{statusMsg.text}</span></div>}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs border-collapse">
          <thead className="sticky top-0 z-10"><tr className="bg-bg-secondary">
            <th className="px-2 py-2 text-left text-text-secondary font-medium border-b border-r border-border-light w-8"></th>
            <th className="px-2 py-2 text-left text-text-secondary font-medium border-b border-r border-border-light min-w-[120px]">索引名</th>
            <th className="px-2 py-2 text-left text-text-secondary font-medium border-b border-r border-border-light min-w-[120px]">字段</th>
            <th className="px-2 py-2 text-center text-text-secondary font-medium border-b border-r border-border-light w-16">唯一</th>
            <th className="px-2 py-2 text-left text-text-secondary font-medium border-b border-r border-border-light min-w-[80px]">类型</th>
            <th className="px-2 py-2 text-center text-text-secondary font-medium border-b border-border-light w-12">操作</th>
          </tr></thead>
          <tbody>
            {indexes.map((idx) => {
              const orig = origIndexes.find((o) => o._id === idx._id)
              const isDirty = idx._isNew || (orig && (idx.name !== orig.name || idx.column !== orig.column || idx.isUnique !== orig.isUnique))
              const bg = idx._isDeleted ? 'bg-red-950/20 opacity-50' : idx._isNew ? 'bg-green-950/15' : isDirty ? 'bg-yellow-950/10' : ''
              return (
                <tr key={idx._id} className={`border-b border-border-light/50 ${bg}`}>
                  <td className="px-2 py-1 text-center border-r border-border-light"><Link2 size={11} className={idx.isUnique ? 'text-yellow-400' : 'text-blue-400'} /></td>
                  <td className="px-1 py-0.5 border-r border-border-light"><input type="text" value={idx.name} onChange={(e) => handleCellChange(idx._id, 'name', e.target.value)} className={inputClass} disabled={idx._isDeleted || idx.name === 'PRIMARY'} /></td>
                  <td className="px-1 py-0.5 border-r border-border-light"><input type="text" value={idx.column} onChange={(e) => handleCellChange(idx._id, 'column', e.target.value)} className={inputClass} disabled={idx._isDeleted} placeholder="column1, column2" /></td>
                  <td className="px-1 py-0.5 text-center border-r border-border-light"><input type="checkbox" checked={idx.isUnique} onChange={(e) => handleCellChange(idx._id, 'isUnique', e.target.checked)} className="cursor-pointer" disabled={idx._isDeleted || idx.name === 'PRIMARY'} /></td>
                  <td className="px-1 py-0.5 border-r border-border-light"><span className="text-text-muted px-1">{idx.type}</span></td>
                  <td className="px-1 py-0.5 text-center border-r border-border-light">{idx.name !== 'PRIMARY' && <button onClick={() => handleDelete(idx._id)} className={`p-0.5 hover:bg-bg-hover rounded ${idx._isDeleted ? 'text-green-400' : 'text-text-muted hover:text-red-400'}`}>{idx._isDeleted ? <Undo2 size={12} /> : <Trash2 size={12} />}</button>}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {indexes.length === 0 && <div className="flex flex-col items-center justify-center py-12 text-text-muted text-sm gap-3"><span>该表没有索引</span><button onClick={handleAdd} className="flex items-center gap-1 px-3 py-1.5 bg-accent/20 text-accent rounded hover:bg-accent/30"><Plus size={14} /> 添加索引</button></div>}
      </div>
    </div>
  )
}

