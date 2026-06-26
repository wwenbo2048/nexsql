import { useState, useEffect, useCallback, Fragment } from 'react'
import { Loader2, AlertCircle, Plus, Trash2, Check, Zap, Code } from 'lucide-react'
import { useConnectionStore } from '@stores/connection'
import type { TriggerInfo } from '@shared/types'

interface Props {
  connectionId: string
  database: string
  table: string
}

interface EditableTrigger extends TriggerInfo {
  _id: string
  _isNew?: boolean
  _isDeleted?: boolean
  _expanded?: boolean
}

let trgCounter = 0
const genId = () => `trg_${Date.now()}_${++trgCounter}`

export default function TriggersEditor({ connectionId, database, table }: Props) {
  const connections = useConnectionStore((s) => s.connections)
  const config = connections.find((c) => c.id === connectionId)
  const [triggers, setTriggers] = useState<EditableTrigger[]>([])
  const [origTriggers, setOrigTriggers] = useState<EditableTrigger[]>([])
  const [loading, setLoading] = useState(true)
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const loadData = useCallback(async () => {
    if (!config) return
    setLoading(true)
    try {
      const res = await window.api.db.getTableTriggers(config, database, table)
      if (res.success && res.data) {
        const editable = res.data.map((t) => ({ ...t, _id: genId() }))
        setTriggers(editable)
        setOrigTriggers(editable.map((t) => ({ ...t })))
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

  const dirtyCount = triggers.filter((t) => t._isNew || t._isDeleted).length

  const handleCellChange = useCallback((id: string, field: keyof EditableTrigger, value: unknown) => {
    setTriggers((prev) => prev.map((t) => (t._id === id ? { ...t, [field]: value } : t)))
  }, [])

  const handleAdd = useCallback(() => {
    setTriggers((prev) => [...prev, { _id: genId(), name: 'trg_new', event: 'INSERT', timing: 'BEFORE', statement: 'BEGIN\n  -- 触发器逻辑\nEND', _isNew: true, _expanded: true }])
  }, [])

  const handleDelete = useCallback((id: string) => {
    setTriggers((prev) => prev.map((t) => (t._id === id ? (t._isNew ? null : { ...t, _isDeleted: !t._isDeleted }) : t)).filter(Boolean) as EditableTrigger[])
  }, [])

  const handleToggleExpand = useCallback((id: string) => {
    setTriggers((prev) => prev.map((t) => (t._id === id ? { ...t, _expanded: !t._expanded } : t)))
  }, [])

  const handleCommit = useCallback(async () => {
    if (!config) return
    const sqls: string[] = []
    for (const trg of triggers) {
      const orig = origTriggers.find((o) => o._id === trg._id)
      if (trg._isDeleted && orig && !orig._isNew) {
        sqls.push(`DROP TRIGGER IF EXISTS \`${orig.name}\`;`)
        continue
      }
      if (trg._isNew && !trg._isDeleted) {
        sqls.push(`CREATE TRIGGER \`${trg.name}\` ${trg.timing} ${trg.event} ON \`${table}\` FOR EACH ROW ${trg.statement};`)
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
  }, [config, triggers, origTriggers, table, database, loadData, showMsg])

  const inputClass = "w-full px-1.5 py-0.5 bg-transparent border border-transparent hover:border-border-light focus:border-accent focus:bg-bg-primary rounded text-xs font-mono text-text-primary focus:outline-none transition-colors"
  const selectClass = "px-1 py-0.5 bg-bg-secondary border border-border-light rounded text-xs text-text-primary focus:outline-none focus:border-accent cursor-pointer"

  if (loading && triggers.length === 0) return <div className="flex items-center justify-center h-full text-text-secondary text-sm gap-2"><Loader2 size={16} className="animate-spin text-accent" />加载触发器...</div>

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-1 px-2 py-1 border-b border-border-light bg-bg-secondary flex-shrink-0">
        <button onClick={handleAdd} className="flex items-center gap-1 px-2 py-1 rounded text-xs hover:bg-bg-hover text-text-secondary hover:text-green-400 transition-colors"><Plus size={14} /><span>添加触发器</span></button>
        <div className="h-4 w-px bg-border-light mx-0.5" />
        <button onClick={handleCommit} disabled={dirtyCount === 0 || loading} className="flex items-center gap-1 px-2 py-1 rounded text-xs hover:bg-green-900/40 text-text-secondary hover:text-green-400 disabled:opacity-30"><Check size={14} /><span>提交</span></button>
        {dirtyCount > 0 && <span className="ml-1 px-1.5 py-0.5 bg-yellow-900/50 text-yellow-400 rounded text-[10px]">{dirtyCount} 待提交</span>}
      </div>
      {statusMsg && <div className={`flex items-center gap-2 px-3 py-1 text-xs ${statusMsg.type === 'success' ? 'bg-green-950/50 text-green-300' : 'bg-red-950/50 text-red-300'} flex-shrink-0`}>{statusMsg.type === 'success' ? <Check size={14} /> : <AlertCircle size={14} />}<span>{statusMsg.text}</span></div>}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs border-collapse">
          <thead className="sticky top-0 z-10"><tr className="bg-bg-secondary">
            <th className="px-2 py-2 text-left text-text-secondary font-medium border-b border-r border-border-light w-8"></th>
            <th className="px-2 py-2 text-left text-text-secondary font-medium border-b border-r border-border-light min-w-[120px]">名称</th>
            <th className="px-2 py-2 text-left text-text-secondary font-medium border-b border-r border-border-light min-w-[80px]">时机</th>
            <th className="px-2 py-2 text-left text-text-secondary font-medium border-b border-r border-border-light min-w-[80px]">事件</th>
            <th className="px-2 py-2 text-left text-text-secondary font-medium border-b border-border-light min-w-[150px]">定义者</th>
            <th className="px-2 py-2 text-center text-text-secondary font-medium border-b border-border-light w-12">操作</th>
          </tr></thead>
          <tbody>
            {triggers.map((trg) => {
              const bg = trg._isDeleted ? 'bg-red-950/20 opacity-50' : trg._isNew ? 'bg-green-950/15' : ''
              return (
                <Fragment key={trg._id}>
                  <tr className={`border-b border-border-light/50 ${bg}`}>
                    <td className="px-2 py-1 text-center border-r border-border-light">
                      <button onClick={() => handleToggleExpand(trg._id)} className="p-0.5 hover:bg-bg-hover rounded text-yellow-400"><Zap size={12} /></button>
                    </td>
                    <td className="px-1 py-0.5 border-r border-border-light"><input type="text" value={trg.name} onChange={(e) => handleCellChange(trg._id, 'name', e.target.value)} className={inputClass} disabled={trg._isDeleted || !trg._isNew} /></td>
                    <td className="px-1 py-0.5 border-r border-border-light"><select value={trg.timing} onChange={(e) => handleCellChange(trg._id, 'timing', e.target.value)} className={selectClass} disabled={trg._isDeleted || !trg._isNew}><option value="BEFORE">BEFORE</option><option value="AFTER">AFTER</option></select></td>
                    <td className="px-1 py-0.5 border-r border-border-light"><select value={trg.event} onChange={(e) => handleCellChange(trg._id, 'event', e.target.value)} className={selectClass} disabled={trg._isDeleted || !trg._isNew}><option value="INSERT">INSERT</option><option value="UPDATE">UPDATE</option><option value="DELETE">DELETE</option></select></td>
                    <td className="px-1 py-0.5 border-r border-border-light"><span className="text-text-muted px-1 font-mono text-[10px]">{trg.definer ?? '-'}</span></td>
                    <td className="px-1 py-0.5 text-center border-r border-border-light"><button onClick={() => handleDelete(trg._id)} className={`p-0.5 hover:bg-bg-hover rounded ${trg._isDeleted ? 'text-green-400' : 'text-text-muted hover:text-red-400'}`}>{trg._isDeleted ? <Check size={12} /> : <Trash2 size={12} />}</button></td>
                  </tr>
                  {trg._expanded && (
                    <tr className={`border-b border-border-light ${bg}`}>
                      <td colSpan={6} className="px-2 py-2">
                        <div className="flex items-center gap-1 mb-1 text-[10px] text-text-muted"><Code size={10} /> 触发器主体 (FOR EACH ROW)</div>
                        <textarea value={trg.statement} onChange={(e) => handleCellChange(trg._id, 'statement', e.target.value)} disabled={trg._isDeleted || !trg._isNew} rows={6} className="w-full px-2 py-1 bg-bg-primary border border-border-light rounded text-xs font-mono text-text-primary focus:outline-none focus:border-accent resize-y" placeholder="BEGIN&#10;  -- 触发器逻辑&#10;END" />
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
        {triggers.length === 0 && <div className="flex flex-col items-center justify-center py-12 text-text-muted text-sm gap-3"><Zap size={32} className="text-text-muted/50" /><span>该表没有触发器</span><button onClick={handleAdd} className="flex items-center gap-1 px-3 py-1.5 bg-accent/20 text-accent rounded hover:bg-accent/30"><Plus size={14} /> 添加触发器</button></div>}
      </div>
    </div>
  )
}

