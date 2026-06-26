import { useState, useEffect, useCallback } from 'react'
import { Eye, Loader2, AlertCircle, Copy, Check, Info, User, Shield, Database as DBIcon, FileText } from 'lucide-react'
import { useBrowserStore } from '@stores/browser'
import { useConnectionStore } from '@stores/connection'
import type { ViewInfo } from '@shared/types'
import SqlHighlight from './SqlHighlight'

export default function ViewDetailPanel() {
  const connections = useConnectionStore((s) => s.connections)
  const { selectedConnectionId, selectedDatabase, selectedTable, views } = useBrowserStore()
  const config = connections.find((c) => c.id === selectedConnectionId)

  const [activeTab, setActiveTab] = useState<'info' | 'ddl'>('info')
  const [ddl, setDdl] = useState('')
  const [ddlLoading, setDdlLoading] = useState(false)
  const [copied, setCopied] = useState(false)

  const viewInfo: ViewInfo | undefined = views.find((v) => v.name === selectedTable)

  const loadDDL = useCallback(async () => {
    if (!config || !selectedDatabase || !selectedTable) return
    setDdlLoading(true)
    try {
      const res = await window.api.db.query(config, `SHOW CREATE VIEW \`${selectedTable}\``, selectedDatabase)
      if (res.success && res.data && res.data.rows.length > 0) {
        // SHOW CREATE VIEW returns 'Create View' column
        const row = res.data.rows[0] as Record<string, string>
        const keys = Object.keys(row)
        const ddlKey = keys.find((k) => k.toLowerCase().includes('create')) || keys[keys.length - 1]
        setDdl(row[ddlKey] ?? '')
      }
    } catch {
      // fallback
    } finally {
      setDdlLoading(false)
    }
  }, [config, selectedDatabase, selectedTable])

  useEffect(() => {
    if (activeTab === 'ddl' && selectedTable) loadDDL()
  }, [activeTab, selectedTable, loadDDL])

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(ddl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [ddl])

  if (!selectedTable) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-text-muted bg-bg-primary">
        <Eye size={48} className="opacity-20 mb-3" />
        <p className="text-sm">选择一个视图</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-bg-primary">
      {/* Tab 切换 */}
      <div className="flex items-center border-b border-border-light bg-bg-secondary flex-shrink-0">
        {([
          { key: 'info' as const, label: '常规' },
          { key: 'ddl' as const, label: 'DDL' }
        ]).map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`px-4 py-2 text-xs font-medium transition-colors border-b-2 ${
              activeTab === t.key ? 'text-text-primary border-accent bg-bg-primary' : 'text-text-secondary border-transparent hover:text-text-primary'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-hidden">
        {/* 常规 */}
        {activeTab === 'info' && (
          <div className="h-full overflow-auto p-4">
            <div className="flex items-center gap-2 mb-4 pb-3 border-b border-border-light">
              <Eye size={16} className="text-purple-400" />
              <span className="text-sm font-medium text-text-primary">{selectedTable}</span>
            </div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-0">
              <InfoRow icon={<Info size={13} />} label="名称" value={viewInfo?.name ?? '-'} />
              <InfoRow icon={<User size={13} />} label="定义者" value={viewInfo?.definer ?? '-'} />
              <InfoRow icon={<Shield size={13} />} label="安全" value={viewInfo?.security ?? '-'} />
              <InfoRow icon={<DBIcon size={13} />} label="可更新" value={viewInfo?.updatable ? '是' : '否'} />
              <InfoRow icon={<FileText size={13} />} label="检查选项" value={viewInfo?.checkOption ?? '-'} />
            </div>
            {viewInfo?.comment && (
              <div className="mt-4 pt-3 border-t border-border-light">
                <div className="flex items-start gap-2">
                  <FileText size={13} className="text-text-muted mt-0.5 flex-shrink-0" />
                  <div>
                    <span className="text-xs text-text-muted">注释</span>
                    <p className="text-xs text-text-primary mt-0.5">{viewInfo.comment}</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* DDL */}
        {activeTab === 'ddl' && (
          <div className="h-full flex flex-col">
            <div className="flex items-center justify-between px-3 py-1 border-b border-border-light bg-bg-secondary flex-shrink-0">
              <span className="text-xs text-text-muted">SHOW CREATE VIEW</span>
              <button onClick={handleCopy} className="flex items-center gap-1 px-2 py-0.5 text-xs hover:bg-bg-hover rounded text-text-secondary hover:text-text-primary transition-colors">
                {copied ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
                {copied ? '已复制' : '复制'}
              </button>
            </div>
            <div className="flex-1 overflow-auto p-3">
              {ddlLoading ? (
                <div className="flex items-center justify-center h-full text-text-secondary text-sm gap-2">
                  <Loader2 size={16} className="animate-spin text-accent" />加载 DDL...
                </div>
              ) : (
                <pre className="text-xs font-mono whitespace-pre-wrap leading-relaxed"><SqlHighlight sql={ddl} /></pre>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 py-2 border-b border-border-light/30">
      <span className="text-text-muted flex-shrink-0">{icon}</span>
      <span className="text-xs text-text-muted w-20 flex-shrink-0">{label}</span>
      <span className="text-xs text-text-primary font-mono truncate">{value}</span>
    </div>
  )
}
