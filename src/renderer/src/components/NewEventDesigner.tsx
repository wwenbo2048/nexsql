import { useState, useCallback } from 'react'
import { Save, X, Loader2, AlertCircle, CalendarClock } from 'lucide-react'
import { useConnectionStore } from '@stores/connection'
import { useBrowserStore } from '@stores/browser'

export default function NewEventDesigner() {
  const connections = useConnectionStore((s) => s.connections)
  const { selectedConnectionId, selectedDatabase, stopCreating, refreshList, selectTable } = useBrowserStore()
  const config = connections.find((c) => c.id === selectedConnectionId)

  const [eventName, setEventName] = useState('')
  const [scheduleType, setScheduleType] = useState<'AT' | 'EVERY'>('EVERY')
  const [interval, setInterval] = useState('1')
  const [intervalUnit, setIntervalUnit] = useState('DAY')
  const [atTime, setAtTime] = useState('2025-12-31 23:59:00')
  const [body, setBody] = useState('UPDATE `table_name` SET `updated_at` = NOW() WHERE 1 = 1;')
  const [onCompletion, setOnCompletion] = useState<'NOT PRESERVE' | 'PRESERVE'>('NOT PRESERVE')
  const [status, setStatus] = useState<'ENABLE' | 'DISABLE'>('ENABLE')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleCreate = useCallback(async () => {
    if (!config || !selectedDatabase) return
    const trimmedName = eventName.trim()
    if (!trimmedName) { setError('请输入事件名'); return }
    if (!body.trim()) { setError('请输入事件体'); return }

    const schedule = scheduleType === 'AT'
      ? `AT TIMESTAMP '${atTime}'`
      : `EVERY ${interval} ${intervalUnit}`

    const sql = `CREATE EVENT ${status === 'DISABLE' ? '' : ''}\nIF NOT EXISTS \`${trimmedName}\`\nON SCHEDULE ${schedule}\nON COMPLETION ${onCompletion}\n${status}\nDO\n${body};`

    setCreating(true)
    setError(null)
    try {
      const res = await window.api.db.query(config, sql, selectedDatabase)
      if (res.success) {
        stopCreating()
        refreshList()
        selectTable(trimmedName)
      } else {
        setError(res.error ?? '创建失败')
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setCreating(false)
    }
  }, [config, selectedDatabase, eventName, scheduleType, interval, intervalUnit, atTime, body, onCompletion, status, stopCreating, refreshList, selectTable])

  const handleCancel = useCallback(() => stopCreating(), [stopCreating])

  const inputClass = "px-2 py-1 bg-bg-primary border border-border-light rounded text-xs font-mono text-text-primary focus:outline-none focus:border-accent transition-colors"

  return (
    <div className="flex flex-col h-full bg-bg-primary">
      {/* 头部工具栏 */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-border-light bg-bg-secondary flex-shrink-0">
        <CalendarClock size={14} className="text-green-400 flex-shrink-0" />
        <span className="text-xs font-medium text-text-primary mr-2">新建事件</span>
        <div className="h-4 w-px bg-border-light mx-0.5" />
        <button
          onClick={handleCreate}
          disabled={creating || !eventName.trim()}
          className="flex items-center gap-1 px-2 py-1 rounded text-xs hover:bg-green-900/40 text-text-secondary hover:text-green-400 transition-colors disabled:opacity-30"
          title="保存并创建事件"
        >
          {creating ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          <span>保存</span>
        </button>
        <button
          onClick={handleCancel}
          disabled={creating}
          className="flex items-center gap-1 px-2 py-1 rounded text-xs hover:bg-bg-hover text-text-secondary hover:text-red-400 transition-colors disabled:opacity-30"
          title="取消"
        >
          <X size={14} /><span>取消</span>
        </button>
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="flex items-start gap-2 px-3 py-2 text-xs text-red-400 bg-red-950/30 border-b border-red-800/40 flex-shrink-0">
          <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
          <pre className="whitespace-pre-wrap break-words font-mono">{error}</pre>
        </div>
      )}

      {/* 参数区 */}
      <div className="flex items-center gap-3 px-3 py-2 border-b border-border-light bg-bg-tertiary/30 flex-shrink-0 flex-wrap">
        <div className="flex items-center gap-1.5">
          <label className="text-xs text-text-muted">名称</label>
          <input
            type="text"
            value={eventName}
            onChange={(e) => setEventName(e.target.value)}
            placeholder="事件名"
            autoFocus
            className="w-40 px-2 py-1 bg-bg-primary border border-border-light rounded text-xs font-mono text-text-primary focus:outline-none focus:border-accent transition-colors"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <label className="text-xs text-text-muted">调度</label>
          <select
            value={scheduleType}
            onChange={(e) => setScheduleType(e.target.value as 'AT' | 'EVERY')}
            className={inputClass}
          >
            <option value="EVERY">周期执行 (EVERY)</option>
            <option value="AT">定时执行 (AT)</option>
          </select>
        </div>
        {scheduleType === 'EVERY' ? (
          <>
            <div className="flex items-center gap-1">
              <span className="text-xs text-text-muted">每</span>
              <input type="number" value={interval} onChange={(e) => setInterval(e.target.value)} className={`w-16 ${inputClass}`} />
              <select value={intervalUnit} onChange={(e) => setIntervalUnit(e.target.value)} className={inputClass}>
                <option value="SECOND">秒</option>
                <option value="MINUTE">分钟</option>
                <option value="HOUR">小时</option>
                <option value="DAY">天</option>
                <option value="WEEK">周</option>
                <option value="MONTH">月</option>
                <option value="YEAR">年</option>
              </select>
            </div>
          </>
        ) : (
          <div className="flex items-center gap-1.5">
            <label className="text-xs text-text-muted">执行时间</label>
            <input type="text" value={atTime} onChange={(e) => setAtTime(e.target.value)} className={`w-44 ${inputClass}`} placeholder="2025-12-31 23:59:00" />
          </div>
        )}
        <div className="flex items-center gap-1.5">
          <label className="text-xs text-text-muted">完成后</label>
          <select value={onCompletion} onChange={(e) => setOnCompletion(e.target.value as 'NOT PRESERVE' | 'PRESERVE')} className={inputClass}>
            <option value="NOT PRESERVE">删除</option>
            <option value="PRESERVE">保留</option>
          </select>
        </div>
        <div className="flex items-center gap-1.5">
          <label className="text-xs text-text-muted">状态</label>
          <select value={status} onChange={(e) => setStatus(e.target.value as 'ENABLE' | 'DISABLE')} className={inputClass}>
            <option value="ENABLE">启用</option>
            <option value="DISABLE">禁用</option>
          </select>
        </div>
      </div>

      {/* 事件体编辑区 */}
      <div className="flex-1 flex flex-col overflow-hidden p-3 gap-2">
        <label className="text-xs text-text-muted flex-shrink-0">事件体 (DO ...)</label>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          className="flex-1 w-full px-3 py-2 bg-bg-secondary border border-border-light rounded text-xs font-mono text-text-primary focus:outline-none focus:border-accent transition-colors resize-none leading-relaxed"
          spellCheck={false}
          placeholder="SQL 语句"
        />
      </div>
    </div>
  )
}
