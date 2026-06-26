import { useState } from 'react'
import {
  Search,
  Trash2,
  Clock,
  AlertCircle,
  CheckCircle2,
  Copy,
  Play,
  X,
  Database
} from 'lucide-react'
import { useHistoryStore } from '@stores/history'

interface Props {
  onSelectSql: (sql: string) => void
  onClose: () => void
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

export default function QueryHistoryPanel({ onSelectSql, onClose }: Props) {
  const { history, searchQuery, setSearchQuery, clearHistory, removeEntry, getFilteredHistory } = useHistoryStore()
  const [confirmClear, setConfirmClear] = useState(false)

  const filtered = getFilteredHistory()

  return (
    <div className="flex flex-col border-t border-border-light bg-bg-secondary flex-shrink-0" style={{ height: 220 }}>
      {/* 头部 */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border-light flex-shrink-0">
        <Clock size={13} className="text-text-secondary flex-shrink-0" />
        <span className="text-xs font-medium text-text-primary">查询历史</span>
        <span className="text-[10px] text-text-muted">({history.length} 条)</span>

        {/* 搜索框 */}
        <div className="flex items-center gap-1 flex-1 ml-2 max-w-[240px]">
          <Search size={12} className="text-text-muted flex-shrink-0" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索 SQL..."
            className="flex-1 min-w-0 px-1.5 py-0.5 bg-bg-primary border border-border-light rounded text-[11px] text-text-primary focus:outline-none focus:border-accent transition-colors"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="text-text-muted hover:text-text-primary">
              <X size={11} />
            </button>
          )}
        </div>

        <div className="ml-auto flex items-center gap-1">
          {confirmClear ? (
            <div className="flex items-center gap-1">
              <span className="text-[10px] text-red-400">确认清空？</span>
              <button
                onClick={() => { clearHistory(); setConfirmClear(false) }}
                className="px-1.5 py-0.5 text-[10px] rounded bg-red-600 text-white hover:bg-red-700"
              >
                确认
              </button>
              <button
                onClick={() => setConfirmClear(false)}
                className="px-1.5 py-0.5 text-[10px] rounded hover:bg-bg-hover text-text-secondary"
              >
                取消
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmClear(true)}
              disabled={history.length === 0}
              className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded hover:bg-bg-hover text-text-muted hover:text-red-400 transition-colors disabled:opacity-30"
              title="清空历史"
            >
              <Trash2 size={11} />
              清空
            </button>
          )}
          <button onClick={onClose} className="p-0.5 hover:bg-bg-hover rounded text-text-muted hover:text-text-primary transition-colors">
            <X size={13} />
          </button>
        </div>
      </div>

      {/* 历史列表 */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="flex items-center justify-center h-full text-text-muted text-xs">
            {searchQuery ? '没有匹配的查询记录' : '暂无查询历史'}
          </div>
        ) : (
          filtered.map((entry) => (
            <div
              key={entry.id}
              className="flex items-start gap-2 px-3 py-1.5 border-b border-border-light/50 hover:bg-bg-hover group cursor-pointer"
              onClick={() => onSelectSql(entry.sql)}
              title="点击插入到编辑器"
            >
              {/* 状态图标 */}
              <div className="flex-shrink-0 mt-0.5">
                {entry.hasError ? (
                  <AlertCircle size={12} className="text-red-400" />
                ) : (
                  <CheckCircle2 size={12} className="text-green-400" />
                )}
              </div>

              {/* SQL 内容 */}
              <div className="flex-1 min-w-0">
                <pre className="text-[11px] font-mono text-text-primary truncate leading-relaxed">
                  {entry.sql.replace(/\n/g, ' ').slice(0, 120)}
                </pre>
                <div className="flex items-center gap-2 mt-0.5 text-[10px] text-text-muted">
                  <span>{formatTime(entry.executedAt)}</span>
                  {entry.database && (
                    <span className="flex items-center gap-0.5">
                      <Database size={9} />
                      {entry.database}
                    </span>
                  )}
                  <span>{formatDuration(entry.duration)}</span>
                  {entry.rowCount !== undefined && <span>{entry.rowCount} 行</span>}
                  {entry.hasError && entry.error && (
                    <span className="text-red-400 truncate max-w-[180px]" title={entry.error}>
                      {entry.error}
                    </span>
                  )}
                </div>
              </div>

              {/* 操作按钮 */}
              <div className="flex-shrink-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    navigator.clipboard.writeText(entry.sql)
                  }}
                  className="p-1 rounded hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors"
                  title="复制 SQL"
                >
                  <Copy size={11} />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    onSelectSql(entry.sql)
                  }}
                  className="p-1 rounded hover:bg-bg-hover text-text-muted hover:text-accent transition-colors"
                  title="插入到编辑器"
                >
                  <Play size={11} />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    removeEntry(entry.id)
                  }}
                  className="p-1 rounded hover:bg-bg-hover text-text-muted hover:text-red-400 transition-colors"
                  title="删除"
                >
                  <X size={11} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
