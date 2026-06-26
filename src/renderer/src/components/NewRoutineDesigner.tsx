import { useState, useCallback } from 'react'
import { Save, X, Loader2, AlertCircle, FunctionSquare } from 'lucide-react'
import { useConnectionStore } from '@stores/connection'
import { useBrowserStore } from '@stores/browser'

export default function NewRoutineDesigner() {
  const connections = useConnectionStore((s) => s.connections)
  const { selectedConnectionId, selectedDatabase, stopCreating, refreshList, selectTable } = useBrowserStore()
  const config = connections.find((c) => c.id === selectedConnectionId)

  const [routineName, setRoutineName] = useState('')
  const [routineType, setRoutineType] = useState<'FUNCTION' | 'PROCEDURE'>('FUNCTION')
  const [params, setParams] = useState('')
  const [returnType, setReturnType] = useState('INT')
  const [body, setBody] = useState('BEGIN\n  -- 函数体\n  RETURN 1;\nEND')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleCreate = useCallback(async () => {
    if (!config || !selectedDatabase) return
    const trimmedName = routineName.trim()
    if (!trimmedName) { setError('请输入函数名'); return }
    if (!body.trim()) { setError('请输入函数体'); return }

    let sql = ''
    if (routineType === 'FUNCTION') {
      sql = `CREATE FUNCTION \`${trimmedName}\`(${params})\nRETURNS ${returnType}\nDETERMINISTIC\nREADS SQL DATA\n${body};`
    } else {
      sql = `CREATE PROCEDURE \`${trimmedName}\`(${params})\nBEGIN\n${body};\nEND;`
    }

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
  }, [config, selectedDatabase, routineName, routineType, params, returnType, body, stopCreating, refreshList, selectTable])

  const handleCancel = useCallback(() => stopCreating(), [stopCreating])

  return (
    <div className="flex flex-col h-full bg-bg-primary">
      {/* 头部工具栏 */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-border-light bg-bg-secondary flex-shrink-0">
        <FunctionSquare size={14} className="text-orange-400 flex-shrink-0" />
        <span className="text-xs font-medium text-text-primary mr-2">新建函数/存储过程</span>
        <div className="h-4 w-px bg-border-light mx-0.5" />
        <button
          onClick={handleCreate}
          disabled={creating || !routineName.trim()}
          className="flex items-center gap-1 px-2 py-1 rounded text-xs hover:bg-green-900/40 text-text-secondary hover:text-green-400 transition-colors disabled:opacity-30"
          title="保存并创建"
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
            value={routineName}
            onChange={(e) => setRoutineName(e.target.value)}
            placeholder="函数名"
            autoFocus
            className="w-40 px-2 py-1 bg-bg-primary border border-border-light rounded text-xs font-mono text-text-primary focus:outline-none focus:border-accent transition-colors"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <label className="text-xs text-text-muted">类型</label>
          <select
            value={routineType}
            onChange={(e) => {
              const t = e.target.value as 'FUNCTION' | 'PROCEDURE'
              setRoutineType(t)
              if (t === 'FUNCTION') setBody('BEGIN\n  -- 函数体\n  RETURN 1;\nEND')
              else setBody('BEGIN\n  -- 存储过程体\n  SELECT 1;\nEND')
            }}
            className="px-2 py-1 bg-bg-primary border border-border-light rounded text-xs text-text-primary focus:outline-none focus:border-accent transition-colors"
          >
            <option value="FUNCTION">FUNCTION</option>
            <option value="PROCEDURE">PROCEDURE</option>
          </select>
        </div>
        <div className="flex items-center gap-1.5">
          <label className="text-xs text-text-muted">参数</label>
          <input
            type="text"
            value={params}
            onChange={(e) => setParams(e.target.value)}
            placeholder="如 p_id INT, p_name VARCHAR(255)"
            className="w-56 px-2 py-1 bg-bg-primary border border-border-light rounded text-xs font-mono text-text-primary focus:outline-none focus:border-accent transition-colors"
          />
        </div>
        {routineType === 'FUNCTION' && (
          <div className="flex items-center gap-1.5">
            <label className="text-xs text-text-muted">返回类型</label>
            <input
              type="text"
              value={returnType}
              onChange={(e) => setReturnType(e.target.value)}
              className="w-28 px-2 py-1 bg-bg-primary border border-border-light rounded text-xs font-mono text-text-primary focus:outline-none focus:border-accent transition-colors"
            />
          </div>
        )}
      </div>

      {/* 函数体编辑区 */}
      <div className="flex-1 flex flex-col overflow-hidden p-3 gap-2">
        <label className="text-xs text-text-muted flex-shrink-0">
          {routineType === 'FUNCTION' ? '函数体 (BEGIN ... END)' : '存储过程体 (BEGIN ... END)'}
        </label>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          className="flex-1 w-full px-3 py-2 bg-bg-secondary border border-border-light rounded text-xs font-mono text-text-primary focus:outline-none focus:border-accent transition-colors resize-none leading-relaxed"
          spellCheck={false}
        />
      </div>
    </div>
  )
}
