import { useState, useEffect, useCallback } from 'react'
import { Save, Loader2, AlertCircle, X } from 'lucide-react'
import { useConnectionStore } from '@stores/connection'
import { useBrowserStore } from '@stores/browser'

interface Props {
  /** 对象类型 */
  type: 'view' | 'function' | 'procedure' | 'event'
  /** SHOW CREATE 语句返回的 DDL */
  loadSql: string
  /** DROP 语句 */
  dropSql: string
}

/**
 * 可编辑 DDL 面板 — 用于视图/函数/事件的编辑模式
 * 加载 SHOW CREATE 结果 → 可编辑 → 保存时先 DROP 再执行修改后的 DDL
 */
export default function EditableObjectEditor({ type, loadSql, dropSql }: Props) {
  const connections = useConnectionStore((s) => s.connections)
  const { selectedConnectionId, selectedDatabase, selectedTable, stopEditing, refreshList } = useBrowserStore()
  const config = connections.find((c) => c.id === selectedConnectionId)

  const [ddl, setDdl] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!config || !selectedDatabase || !selectedTable) return
    setLoading(true)
    setError(null)
    try {
      const res = await window.api.db.query(config, loadSql, selectedDatabase)
      if (res.success && res.data && res.data.rows.length > 0) {
        const row = res.data.rows[0] as Record<string, string>
        const keys = Object.keys(row)
        const ddlKey = keys.find((k) => k.toLowerCase().includes('create')) || keys[keys.length - 1]
        setDdl(row[ddlKey] ?? '')
      } else if (!res.success) {
        setError(res.error ?? '加载失败')
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [config, selectedDatabase, selectedTable, loadSql])

  useEffect(() => {
    load()
  }, [load])

  const handleSave = useCallback(async () => {
    if (!config || !selectedDatabase || !selectedTable) return
    setSaving(true)
    setError(null)
    try {
      // 先 DROP 再执行修改后的 DDL
      const dropRes = await window.api.db.query(config, dropSql, selectedDatabase)
      if (!dropRes.success) {
        setError(`删除旧对象失败: ${dropRes.error}`)
        setSaving(false)
        return
      }
      const createRes = await window.api.db.query(config, ddl, selectedDatabase)
      if (!createRes.success) {
        setError(`创建失败: ${createRes.error}`)
        setSaving(false)
        return
      }
      stopEditing()
      refreshList()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }, [config, selectedDatabase, selectedTable, ddl, dropSql, stopEditing, refreshList])

  const handleCancel = useCallback(() => {
    stopEditing()
  }, [stopEditing])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-text-secondary text-sm gap-2">
        <Loader2 size={16} className="animate-spin text-accent" />加载 DDL...
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-bg-primary">
      {/* 工具栏 */}
      <div className="flex items-center gap-1 px-3 py-1 border-b border-border-light bg-bg-secondary flex-shrink-0">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-1 px-2 py-1 rounded text-xs hover:bg-green-900/40 text-text-secondary hover:text-green-400 transition-colors disabled:opacity-30"
          title="保存"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          <span>保存</span>
        </button>
        <button
          onClick={handleCancel}
          disabled={saving}
          className="flex items-center gap-1 px-2 py-1 rounded text-xs hover:bg-bg-hover text-text-secondary hover:text-red-400 transition-colors disabled:opacity-30"
          title="取消"
        >
          <X size={14} /><span>取消</span>
        </button>
        <span className="ml-2 text-xs text-text-muted">
          编辑模式 · 先删除旧对象再创建新对象
        </span>
      </div>

      {error && (
        <div className="flex items-start gap-2 px-3 py-2 text-xs text-red-400 bg-red-950/30 border-b border-red-800/40 flex-shrink-0">
          <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
          <pre className="whitespace-pre-wrap break-words font-mono">{error}</pre>
        </div>
      )}

      {/* 可编辑 DDL */}
      <div className="flex-1 overflow-hidden p-3">
        <textarea
          value={ddl}
          onChange={(e) => setDdl(e.target.value)}
          className="w-full h-full px-3 py-2 bg-bg-secondary border border-border-light rounded text-xs font-mono text-text-primary focus:outline-none focus:border-accent transition-colors resize-none leading-relaxed"
          spellCheck={false}
        />
      </div>
    </div>
  )
}
