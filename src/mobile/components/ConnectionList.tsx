import { useState, useEffect } from 'react'
import { getConnections, clearToken } from '../api'
import type { MobileConnection } from '../api'

export default function ConnectionList({
  onSelect,
  selectedId
}: {
  onSelect: (conn: MobileConnection) => void
  selectedId?: string
}) {
  const [connections, setConnections] = useState<MobileConnection[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadConnections()
  }, [])

  const loadConnections = async () => {
    setLoading(true)
    const res = await getConnections()
    setLoading(false)
    if (res.success && res.data) {
      setConnections(res.data)
    } else {
      setError(res.error ?? '加载失败')
    }
  }

  const handleDisconnect = () => {
    clearToken()
    window.location.reload()
  }

  return (
    <div className="flex flex-col h-full">
      {/* 头部 */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-border-light bg-bg-secondary">
        <h1 className="text-base font-semibold">连接</h1>
        <button
          onClick={loadConnections}
          className="p-2 text-text-muted hover:text-accent"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 2v6h-6M3 12a9 9 0 0 1 15-6.7L21 8M3 22v-6h6M21 12a9 9 0 0 1-15 6.7L3 16" />
          </svg>
        </button>
      </header>

      {/* 列表 */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-10 text-text-muted text-sm">
            加载中...
          </div>
        ) : error ? (
          <div className="px-4 py-6 text-center">
            <p className="text-sm text-red-400 mb-3">{error}</p>
            <button
              onClick={loadConnections}
              className="text-xs text-accent"
            >
              重试
            </button>
          </div>
        ) : connections.length === 0 ? (
          <div className="px-6 py-10 text-center">
            <p className="text-sm text-text-muted">暂无连接</p>
            <p className="text-xs text-text-muted mt-2">
              请在电脑端 nexSql 中添加数据库连接
            </p>
          </div>
        ) : (
          <div className="py-1">
            {connections.map((conn) => (
              <button
                key={conn.id}
                onClick={() => onSelect(conn)}
                className={`w-full flex items-center gap-3 px-4 py-3.5 transition-colors text-left ${
                  selectedId === conn.id
                    ? 'bg-accent/10'
                    : 'hover:bg-bg-secondary'
                }`}
              >
                {/* 类型图标 */}
                <div
                  className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{
                    backgroundColor: (conn.color || (conn.type === 'redis' ? '#dc2626' : '#3b82f6')) + '22'
                  }}
                >
                  <span
                    className="text-xs font-bold"
                    style={{ color: conn.color || (conn.type === 'redis' ? '#dc2626' : '#3b82f6') }}
                  >
                    {conn.type === 'redis' ? 'RS' : 'SQ'}
                  </span>
                </div>

                {/* 信息 */}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-text-primary truncate">
                    {conn.name}
                  </div>
                  <div className="text-xs text-text-muted truncate">
                    {conn.host}:{conn.port}
                    {conn.database ? ` · ${conn.database}` : ''}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 底部：断开配对 */}
      <div className="px-4 py-3 border-t border-border-light safe-bottom">
        <button
          onClick={handleDisconnect}
          className="w-full py-2.5 text-xs text-text-muted hover:text-red-400 transition-colors"
        >
          断开配对
        </button>
      </div>
    </div>
  )
}
