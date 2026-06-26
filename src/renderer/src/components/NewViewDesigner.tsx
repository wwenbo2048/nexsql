import { useState, useCallback } from 'react'
import { Save, X, Loader2, AlertCircle, Eye } from 'lucide-react'
import { useConnectionStore } from '@stores/connection'
import { useBrowserStore } from '@stores/browser'

export default function NewViewDesigner() {
  const connections = useConnectionStore((s) => s.connections)
  const { selectedConnectionId, selectedDatabase, stopCreating, refreshList, selectTable } = useBrowserStore()
  const config = connections.find((c) => c.id === selectedConnectionId)

  const [viewName, setViewName] = useState('')
  const [sqlBody, setSqlBody] = useState('SELECT\n  *\nFROM\n  `table_name`\nWHERE\n  1 = 1')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleCreate = useCallback(async () => {
    if (!config || !selectedDatabase) return
    const trimmedName = viewName.trim()
    if (!trimmedName) { setError('请输入视图名'); return }
    if (!sqlBody.trim()) { setError('请输入 SQL 语句'); return }

    const sql = `CREATE VIEW \`${trimmedName}\` AS\n${sqlBody};`
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
  }, [config, selectedDatabase, viewName, sqlBody, stopCreating, refreshList, selectTable])

  const handleCancel = useCallback(() => stopCreating(), [stopCreating])

  return (
    <div className="flex flex-col h-full bg-bg-primary">
      {/* 头部工具栏 */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-border-light bg-bg-secondary flex-shrink-0">
        <Eye size={14} className="text-purple-400 flex-shrink-0" />
        <span className="text-xs font-medium text-text-primary mr-2">新建视图</span>
        <div className="h-4 w-px bg-border-light mx-0.5" />
        <button
          onClick={handleCreate}
          disabled={creating || !viewName.trim()}
          className="flex items-center gap-1 px-2 py-1 rounded text-xs hover:bg-green-900/40 text-text-secondary hover:text-green-400 transition-colors disabled:opacity-30"
          title="保存并创建视图"
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

      {/* 表名 */}
      <div className="flex items-center gap-3 px-3 py-2 border-b border-border-light bg-bg-tertiary/30 flex-shrink-0">
        <div className="flex items-center gap-1.5">
          <label className="text-xs text-text-muted w-10">视图名</label>
          <input
            type="text"
            value={viewName}
            onChange={(e) => setViewName(e.target.value)}
            placeholder="输入视图名"
            autoFocus
            className="w-52 px-2 py-1 bg-bg-primary border border-border-light rounded text-xs font-mono text-text-primary focus:outline-none focus:border-accent transition-colors"
          />
        </div>
      </div>

      {/* SQL 编辑区 */}
      <div className="flex-1 flex flex-col overflow-hidden p-3 gap-2">
        <label className="text-xs text-text-muted flex-shrink-0">SELECT 语句</label>
        <textarea
          value={sqlBody}
          onChange={(e) => setSqlBody(e.target.value)}
          className="flex-1 w-full px-3 py-2 bg-bg-secondary border border-border-light rounded text-xs font-mono text-text-primary focus:outline-none focus:border-accent transition-colors resize-none leading-relaxed"
          spellCheck={false}
          placeholder="SELECT ... FROM ..."
        />
      </div>
    </div>
  )
}
