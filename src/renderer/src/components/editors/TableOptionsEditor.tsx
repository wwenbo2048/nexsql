import { useState, useEffect, useCallback } from 'react'
import { Loader2, AlertCircle, Check, Settings, Undo2 } from 'lucide-react'
import { useConnectionStore } from '@stores/connection'
import type { TableOptions } from '@shared/types'

interface Props {
  connectionId: string
  database: string
  table: string
}

const ENGINES = ['InnoDB', 'MyISAM', 'Memory', 'CSV', 'Archive', 'Blackhole', 'Federated', 'Merge']
const CHARSETS = ['utf8mb4', 'utf8mb3', 'utf8', 'latin1', 'ascii', 'binary', 'big5', 'gbk', 'gb2312']
const ROW_FORMATS = ['Dynamic', 'Compact', 'Redundant', 'Compressed', 'Fixed']

export default function TableOptionsEditor({ connectionId, database, table }: Props) {
  const connections = useConnectionStore((s) => s.connections)
  const config = connections.find((c) => c.id === connectionId)
  const [options, setOptions] = useState<TableOptions>({})
  const [origOptions, setOrigOptions] = useState<TableOptions>({})
  const [loading, setLoading] = useState(true)
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const loadData = useCallback(async () => {
    if (!config) return
    setLoading(true)
    try {
      const res = await window.api.db.getTableOptions(config, database, table)
      if (res.success && res.data) {
        setOptions({ ...res.data })
        setOrigOptions({ ...res.data })
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

  const isDirty =
    options.engine !== origOptions.engine ||
    options.charset !== origOptions.charset ||
    options.collation !== origOptions.collation ||
    options.comment !== origOptions.comment ||
    options.autoIncrement !== origOptions.autoIncrement ||
    options.rowFormat !== origOptions.rowFormat

  const handleChange = useCallback(<K extends keyof TableOptions>(field: K, value: TableOptions[K]) => {
    setOptions((prev) => ({ ...prev, [field]: value }))
  }, [])

  const handleRollback = useCallback(() => {
    setOptions({ ...origOptions })
    showMsg('success', '已回滚')
  }, [origOptions, showMsg])

  const handleCommit = useCallback(async () => {
    if (!config || !isDirty) return
    const parts: string[] = []
    if (options.engine && options.engine !== origOptions.engine) parts.push(`ENGINE = ${options.engine}`)
    if (options.charset && options.charset !== origOptions.charset) parts.push(`CHARACTER SET = ${options.charset}`)
    if (options.collation && options.collation !== origOptions.collation) parts.push(`COLLATE = ${options.collation}`)
    if (options.comment !== undefined && options.comment !== origOptions.comment) parts.push(`COMMENT = '${(options.comment ?? '').replace(/'/g, "\\'")}'`)
    if (options.autoIncrement && options.autoIncrement !== origOptions.autoIncrement) parts.push(`AUTO_INCREMENT = ${options.autoIncrement}`)
    if (options.rowFormat && options.rowFormat !== origOptions.rowFormat) parts.push(`ROW_FORMAT = ${options.rowFormat}`)
    if (parts.length === 0) { showMsg('error', '没有待提交的更改'); return }
    const sql = `ALTER TABLE \`${table}\` ${parts.join(', ')};`
    setLoading(true)
    const res = await window.api.db.query(config, sql, database)
    setLoading(false)
    if (res.success) {
      showMsg('success', '表选项已更新')
      await loadData()
    } else {
      showMsg('error', `执行失败: ${res.error}`)
    }
  }, [config, options, origOptions, table, database, loadData, showMsg, isDirty])

  const labelClass = "text-xs text-text-secondary font-medium w-28 flex-shrink-0"
  const inputClass = "flex-1 max-w-xs px-2 py-1.5 bg-bg-primary border border-border-light rounded text-xs text-text-primary focus:outline-none focus:border-accent transition-colors"
  const selectClass = "flex-1 max-w-xs px-2 py-1.5 bg-bg-primary border border-border-light rounded text-xs text-text-primary focus:outline-none focus:border-accent cursor-pointer"

  if (loading) return <div className="flex items-center justify-center h-full text-text-secondary text-sm gap-2"><Loader2 size={16} className="animate-spin text-accent" />加载表选项...</div>

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-1 px-2 py-1 border-b border-border-light bg-bg-secondary flex-shrink-0">
        <Settings size={14} className="text-text-muted" />
        <span className="text-xs text-text-secondary">表选项</span>
        <div className="h-4 w-px bg-border-light mx-1" />
        <button onClick={handleCommit} disabled={!isDirty || loading} className="flex items-center gap-1 px-2 py-1 rounded text-xs hover:bg-green-900/40 text-text-secondary hover:text-green-400 disabled:opacity-30"><Check size={14} /><span>提交</span></button>
        <button onClick={handleRollback} disabled={!isDirty || loading} className="flex items-center gap-1 px-2 py-1 rounded text-xs hover:bg-bg-hover text-text-secondary hover:text-yellow-400 disabled:opacity-30"><Undo2 size={14} /><span>回滚</span></button>
        {isDirty && <span className="ml-1 px-1.5 py-0.5 bg-yellow-900/50 text-yellow-400 rounded text-[10px]">待提交</span>}
      </div>
      {statusMsg && <div className={`flex items-center gap-2 px-3 py-1 text-xs ${statusMsg.type === 'success' ? 'bg-green-950/50 text-green-300' : 'bg-red-950/50 text-red-300'} flex-shrink-0`}>{statusMsg.type === 'success' ? <Check size={14} /> : <AlertCircle size={14} />}<span>{statusMsg.text}</span></div>}
      <div className="flex-1 overflow-auto p-4">
        <div className="space-y-4 max-w-lg">
          {/* 存储引擎 */}
          <div className="flex items-center gap-3">
            <label className={labelClass}>存储引擎</label>
            <select value={options.engine ?? ''} onChange={(e) => handleChange('engine', e.target.value)} className={selectClass}>
              {ENGINES.map((e) => <option key={e} value={e}>{e}</option>)}
            </select>
          </div>
          {/* 字符集 */}
          <div className="flex items-center gap-3">
            <label className={labelClass}>字符集</label>
            <select value={options.charset ?? ''} onChange={(e) => handleChange('charset', e.target.value)} className={selectClass}>
              <option value="">(默认)</option>
              {CHARSETS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          {/* 排序规则 */}
          <div className="flex items-center gap-3">
            <label className={labelClass}>排序规则</label>
            <input type="text" value={options.collation ?? ''} onChange={(e) => handleChange('collation', e.target.value)} className={inputClass} placeholder="utf8mb4_general_ci" />
          </div>
          {/* 自增起始值 */}
          <div className="flex items-center gap-3">
            <label className={labelClass}>AUTO_INCREMENT</label>
            <input type="number" value={options.autoIncrement ?? ''} onChange={(e) => handleChange('autoIncrement', e.target.value ? Number(e.target.value) : undefined)} className={inputClass} placeholder="1" />
          </div>
          {/* 行格式 */}
          <div className="flex items-center gap-3">
            <label className={labelClass}>行格式</label>
            <select value={options.rowFormat ?? ''} onChange={(e) => handleChange('rowFormat', e.target.value)} className={selectClass}>
              <option value="">(默认)</option>
              {ROW_FORMATS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          {/* 表注释 */}
          <div className="flex flex-col gap-1.5">
            <label className={labelClass}>表注释</label>
            <textarea value={options.comment ?? ''} onChange={(e) => handleChange('comment', e.target.value)} rows={3} className="w-full px-2 py-1.5 bg-bg-primary border border-border-light rounded text-xs text-text-primary focus:outline-none focus:border-accent resize-y" placeholder="表注释说明" />
          </div>
        </div>
      </div>
    </div>
  )
}
