import { useState, useEffect, useCallback } from 'react'
import { Loader2, AlertCircle, Plus, Trash2, Check, Undo2, Link } from 'lucide-react'
import { useConnectionStore } from '@stores/connection'
import type { ForeignKeyInfo } from '@shared/types'

interface Props {
  connectionId: string
  database: string
  table: string
}

interface EditableFK extends ForeignKeyInfo {
  _id: string
  _isNew?: boolean
  _isDeleted?: boolean
}

let fkCounter = 0
const genId = () => `fk_${Date.now()}_${++fkCounter}`

const REF_ACTIONS = ['RESTRICT', 'CASCADE', 'SET NULL', 'NO ACTION', 'SET DEFAULT']

export default function ForeignKeysEditor({ connectionId, database, table }: Props) {
  const connections = useConnectionStore((s) => s.connections)
  const config = connections.find((c) => c.id === connectionId)
  const [fks, setFks] = useState<EditableFK[]>([])
  const [origFks, setOrigFks] = useState<EditableFK[]>([])
  const [loading, setLoading] = useState(true)
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const loadData = useCallback(async () => {
    if (!config) return
    setLoading(true)
    try {
      const res = await window.api.db.getForeignKeys(config, database, table)
      if (res.success && res.data) {
        const editable = res.data.map((f) => ({ ...f, _id: genId() }))
        setFks(editable)
        setOrigFks(editable.map((f) => ({ ...f })))
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

  const dirtyCount = fks.filter((fk) => {
    const orig = origFks.find((o) => o._id === fk._id)
    if (fk._isNew || fk._isDeleted) return true
    if (!orig) return false
    return fk.name !== orig.name || fk.columnName !== orig.columnName || fk.referencedTable !== orig.referencedTable || fk.onUpdate !== orig.onUpdate || fk.onDelete !== orig.onDelete
  }).length

  const handleCellChange = useCallback((id: string, field: keyof EditableFK, value: unknown) => {
    setFks((prev) => prev.map((f) => (f._id === id ? { ...f, [field]: value } : f)))
  }, [])

  const handleAdd = useCallback(() => {
    setFks((prev) => [...prev, { _id: genId(), name: 'fk_new', columnName: '', referencedTable: '', referencedColumnName: 'id', onUpdate: 'RESTRICT', onDelete: 'RESTRICT', _isNew: true }])
  }, [])

  const handleDelete = useCallback((id: string) => {
    setFks((prev) => prev.map((f) => (f._id === id ? (f._isNew ? null : { ...f, _isDeleted: !f._isDeleted }) : f)).filter(Boolean) as EditableFK[])
  }, [])

  const handleRollback = useCallback(() => {
    setFks(origFks.map((f) => ({ ...f })))
    showMsg('success', '已回滚')
  }, [origFks, showMsg])

  const handleCommit = useCallback(async () => {
    if (!config) return
    const sqls: string[] = []
    for (const fk of fks) {
      const orig = origFks.find((o) => o._id === fk._id)
      if (fk._isDeleted && orig && !orig._isNew) {
        sqls.push(`ALTER TABLE \`${table}\` DROP FOREIGN KEY \`${orig.name}\`;`)
        continue
      }
      if (fk._isNew && !fk._isDeleted) {
        sqls.push(`ALTER TABLE \`${table}\` ADD CONSTRAINT \`${fk.name}\` FOREIGN KEY (\`${fk.columnName}\`) REFERENCES \`${fk.referencedTable}\`(\`${fk.referencedColumnName}\`) ON UPDATE ${fk.onUpdate} ON DELETE ${fk.onDelete};`)
        continue
      }
      if (orig && !fk._isDeleted) {
        const changed = fk.columnName !== orig.columnName || fk.referencedTable !== orig.referencedTable || fk.onUpdate !== orig.onUpdate || fk.onDelete !== orig.onDelete
        if (changed) {
          sqls.push(`ALTER TABLE \`${table}\` DROP FOREIGN KEY \`${orig.name}\`;`)
          sqls.push(`ALTER TABLE \`${table}\` ADD CONSTRAINT \`${fk.name}\` FOREIGN KEY (\`${fk.columnName}\`) REFERENCES \`${fk.referencedTable}\`(\`${fk.referencedColumnName}\`) ON UPDATE ${fk.onUpdate} ON DELETE ${fk.onDelete};`)
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
  }, [config, fks, origFks, table, database, loadData, showMsg])

  const inputClass = "w-full px-1.5 py-0.5 bg-transparent border border-transparent hover:border-border-light focus:border-accent focus:bg-bg-primary rounded text-xs font-mono text-text-primary focus:outline-none transition-colors"
  const selectClass = "w-full px-1 py-0.5 bg-transparent border border-transparent hover:border-border-light focus:border-accent focus:bg-bg-primary rounded text-xs text-text-primary focus:outline-none transition-colors cursor-pointer"

  if (loading && fks.length === 0) return <div className="flex items-center justify-center h-full text-text-secondary text-sm gap-2"><Loader2 size={16} className="animate-spin text-accent" />加载外键...</div>

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-1 px-2 py-1 border-b border-border-light bg-bg-secondary flex-shrink-0">
        <button onClick={handleAdd} className="flex items-center gap-1 px-2 py-1 rounded text-xs hover:bg-bg-hover text-text-secondary hover:text-green-400 transition-colors"><Plus size={14} /><span>添加外键</span></button>
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
            <th className="px-2 py-2 text-left text-text-secondary font-medium border-b border-r border-border-light min-w-[100px]">名称</th>
            <th className="px-2 py-2 text-left text-text-secondary font-medium border-b border-r border-border-light min-w-[100px]">字段</th>
            <th className="px-2 py-2 text-left text-text-secondary font-medium border-b border-r border-border-light min-w-[100px]">引用表</th>
            <th className="px-2 py-2 text-left text-text-secondary font-medium border-b border-r border-border-light min-w-[80px]">引用字段</th>
            <th className="px-2 py-2 text-left text-text-secondary font-medium border-b border-r border-border-light min-w-[90px]">ON UPDATE</th>
            <th className="px-2 py-2 text-left text-text-secondary font-medium border-b border-r border-border-light min-w-[90px]">ON DELETE</th>
            <th className="px-2 py-2 text-center text-text-secondary font-medium border-b border-border-light w-12">操作</th>
          </tr></thead>
          <tbody>
            {fks.map((fk) => {
              const orig = origFks.find((o) => o._id === fk._id)
              const isDirty = fk._isNew || (orig && (fk.columnName !== orig.columnName || fk.referencedTable !== orig.referencedTable))
              const bg = fk._isDeleted ? 'bg-red-950/20 opacity-50' : fk._isNew ? 'bg-green-950/15' : isDirty ? 'bg-yellow-950/10' : ''
              return (
                <tr key={fk._id} className={`border-b border-border-light/50 ${bg}`}>
                  <td className="px-2 py-1 text-center border-r border-border-light"><Link size={11} className="text-orange-400" /></td>
                  <td className="px-1 py-0.5 border-r border-border-light"><input type="text" value={fk.name} onChange={(e) => handleCellChange(fk._id, 'name', e.target.value)} className={inputClass} disabled={fk._isDeleted} /></td>
                  <td className="px-1 py-0.5 border-r border-border-light"><input type="text" value={fk.columnName} onChange={(e) => handleCellChange(fk._id, 'columnName', e.target.value)} className={inputClass} disabled={fk._isDeleted} /></td>
                  <td className="px-1 py-0.5 border-r border-border-light"><input type="text" value={fk.referencedTable} onChange={(e) => handleCellChange(fk._id, 'referencedTable', e.target.value)} className={inputClass} disabled={fk._isDeleted} /></td>
                  <td className="px-1 py-0.5 border-r border-border-light"><input type="text" value={fk.referencedColumnName} onChange={(e) => handleCellChange(fk._id, 'referencedColumnName', e.target.value)} className={inputClass} disabled={fk._isDeleted} /></td>
                  <td className="px-1 py-0.5 border-r border-border-light"><select value={fk.onUpdate} onChange={(e) => handleCellChange(fk._id, 'onUpdate', e.target.value)} className={selectClass} disabled={fk._isDeleted}>{REF_ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}</select></td>
                  <td className="px-1 py-0.5 border-r border-border-light"><select value={fk.onDelete} onChange={(e) => handleCellChange(fk._id, 'onDelete', e.target.value)} className={selectClass} disabled={fk._isDeleted}>{REF_ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}</select></td>
                  <td className="px-1 py-0.5 text-center border-r border-border-light"><button onClick={() => handleDelete(fk._id)} className={`p-0.5 hover:bg-bg-hover rounded ${fk._isDeleted ? 'text-green-400' : 'text-text-muted hover:text-red-400'}`}>{fk._isDeleted ? <Undo2 size={12} /> : <Trash2 size={12} />}</button></td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {fks.length === 0 && <div className="flex flex-col items-center justify-center py-12 text-text-muted text-sm gap-3"><span>该表没有外键</span><button onClick={handleAdd} className="flex items-center gap-1 px-3 py-1.5 bg-accent/20 text-accent rounded hover:bg-accent/30"><Plus size={14} /> 添加外键</button></div>}
      </div>
    </div>
  )
}

