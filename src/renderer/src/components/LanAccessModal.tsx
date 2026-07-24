import { useState, useEffect, useCallback } from 'react'
import {
  X,
  Smartphone,
  Wifi,
  Play,
  Square,
  RefreshCw,
  Copy,
  Check,
  AlertCircle,
  Loader2,
  Shield,
} from 'lucide-react'
import { useUiStore } from '@stores/ui'

interface ServerStatusData {
  running: boolean
  port: number
  urls: string[]
  pairCode: string | null
  authorizedDevices: number
}

export default function LanAccessModal() {
  const show = useUiStore((s) => s.showLanAccess)
  const close = useUiStore((s) => s.closeLanAccess)

  const [status, setStatus] = useState<ServerStatusData | null>(null)
  const [loading, setLoading] = useState(false)
  const [port, setPort] = useState(19800)
  const [error, setError] = useState<string | null>(null)
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null)

  // 加载服务器状态
  useEffect(() => {
    if (!show) return
    refreshStatus()
  }, [show])

  const refreshStatus = useCallback(async () => {
    const res = await window.api.server.status()
    if (res.success && res.data) {
      setStatus(res.data as ServerStatusData)
      if ((res.data as ServerStatusData).port) {
        setPort((res.data as ServerStatusData).port)
      }
    }
  }, [])

  const handleStart = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await window.api.server.start(port)
      if (res.success && res.data) {
        setStatus(res.data as ServerStatusData)
      } else {
        setError(res.error ?? '启动失败')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [port])

  const handleStop = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      await window.api.server.stop()
      await refreshStatus()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [refreshStatus])

  const handleRefreshPairCode = useCallback(async () => {
    const res = await window.api.server.refreshPairCode()
    if (res.success && res.data) {
      setStatus(res.data as ServerStatusData)
    }
  }, [])

  const copyToClipboard = useCallback((text: string, key: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedUrl(key)
      setTimeout(() => setCopiedUrl(null), 2000)
    })
  }, [])

  if (!show) return null

  const isRunning = status?.running ?? false

  return (
    <div
      className="fixed inset-0 z-[250] flex items-center justify-center bg-black/60"
      onClick={close}
    >
      <div
        className="w-[520px] max-h-[85vh] bg-bg-secondary border border-border-light rounded-lg shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border-light flex-shrink-0">
          <div className="flex items-center gap-2">
            <Smartphone size={16} className="text-accent" />
            <span className="text-sm font-semibold text-text-primary">局域网访问</span>
            <span className="text-[10px] px-1.5 py-0.5 bg-accent/15 text-accent rounded font-medium">
              手机端
            </span>
          </div>
          <button
            onClick={close}
            className="p-1 hover:bg-bg-hover rounded text-text-muted hover:text-text-primary transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* 内容区 */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* 简介 */}
          <div className="bg-bg-tertiary/50 rounded-lg px-4 py-3 border border-border-light">
            <div className="flex items-start gap-2.5">
              <Wifi size={15} className="text-accent mt-0.5 flex-shrink-0" />
              <div className="text-xs text-text-secondary leading-relaxed">
                在局域网内启动 HTTP 服务器后，手机浏览器访问电脑 IP 即可使用 nexSql 的核心功能：
                <span className="text-text-primary">浏览数据库、执行 SQL 查询、AI 自然语言转 SQL</span>。
                所有数据操作都通过电脑端代理执行，安全可靠。
              </div>
            </div>
          </div>

          {/* 服务器开关 */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold text-text-primary">服务器状态</span>
              {isRunning && (
                <span className="flex items-center gap-1.5 text-[11px] text-green-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                  运行中
                </span>
              )}
            </div>

            <div className="flex items-center gap-3">
              {/* 端口输入 */}
              <div className="flex items-center gap-2">
                <label className="text-[10px] text-text-muted uppercase">端口</label>
                <input
                  type="number"
                  value={port}
                  onChange={(e) => setPort(Number(e.target.value) || 19800)}
                  disabled={isRunning}
                  className="w-20 px-2 py-1.5 bg-bg-primary border border-border-light rounded text-xs text-text-primary disabled:opacity-50 focus:outline-none focus:border-accent"
                />
              </div>

              {/* 启动/停止按钮 */}
              {isRunning ? (
                <button
                  onClick={handleStop}
                  disabled={loading}
                  className="flex items-center gap-1.5 px-4 py-1.5 bg-red-500/15 hover:bg-red-500/25 text-red-400 text-xs rounded transition-colors disabled:opacity-50"
                >
                  {loading ? <Loader2 size={12} className="animate-spin" /> : <Square size={12} />}
                  停止服务器
                </button>
              ) : (
                <button
                  onClick={handleStart}
                  disabled={loading}
                  className="flex items-center gap-1.5 px-4 py-1.5 bg-accent/15 hover:bg-accent/25 text-accent text-xs rounded transition-colors disabled:opacity-50"
                >
                  {loading ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
                  启动服务器
                </button>
              )}
            </div>

            {error && (
              <div className="mt-2 flex items-center gap-1.5 text-xs text-red-400">
                <AlertCircle size={12} />
                {error}
              </div>
            )}
          </div>

          {/* 运行中：显示地址和配对码 */}
          {isRunning && status && (
            <>
              {/* 访问地址 */}
              <div>
                <span className="text-xs font-semibold text-text-primary">访问地址</span>
                <p className="text-[11px] text-text-muted mt-1 mb-2">
                  在手机浏览器中打开以下地址（确保手机和电脑在同一局域网）
                </p>
                {status.urls.length > 0 ? (
                  <div className="space-y-1.5">
                    {status.urls.map((url) => (
                      <div key={url} className="flex items-center gap-2">
                        <code className="flex-1 px-3 py-2 bg-bg-primary border border-border-light rounded text-xs text-accent">
                          {url}
                        </code>
                        <button
                          onClick={() => copyToClipboard(url, url)}
                          className="p-2 hover:bg-bg-hover rounded text-text-muted hover:text-accent transition-colors"
                        >
                          {copiedUrl === url ? <Check size={13} className="text-green-400" /> : <Copy size={13} />}
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="px-3 py-2 bg-bg-primary border border-border-light rounded text-xs text-yellow-400">
                    未检测到局域网 IP，请检查网络连接
                  </div>
                )}
              </div>

              {/* 配对码 */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-text-primary">配对码</span>
                  <button
                    onClick={handleRefreshPairCode}
                    className="flex items-center gap-1 text-[10px] text-text-muted hover:text-accent transition-colors"
                  >
                    <RefreshCw size={11} />
                    刷新
                  </button>
                </div>
                <p className="text-[11px] text-text-muted mb-2">
                  手机端首次访问时输入此配对码完成授权（5 分钟内有效）
                </p>
                <div className="flex items-center justify-center py-4 bg-bg-primary border border-border-light rounded-lg">
                  <span className="text-3xl font-bold tracking-[0.3em] text-accent font-mono">
                    {status.pairCode ?? '------'}
                  </span>
                </div>
              </div>

              {/* 已连接设备 */}
              <div className="flex items-center justify-between px-3 py-2.5 bg-bg-tertiary/50 rounded-lg border border-border-light">
                <span className="text-xs text-text-secondary">已授权设备</span>
                <span className="text-xs font-medium text-text-primary">{status.authorizedDevices} 台</span>
              </div>
            </>
          )}

          {/* 安全提示 */}
          <div className="flex items-start gap-2 px-3 py-2.5 bg-blue-900/15 border border-blue-700/30 rounded-lg">
            <Shield size={13} className="text-blue-400 mt-0.5 flex-shrink-0" />
            <div className="text-[11px] text-blue-200/80 leading-relaxed">
              <span className="font-medium text-blue-400">安全说明：</span>
              服务器仅监听局域网连接，不会暴露到公网。配对码为一次性使用，应用重启后需重新配对。
              连接密码始终在电脑端处理，不会传输到手机。
            </div>
          </div>
        </div>

        {/* 底部 */}
        <div className="flex items-center justify-end px-5 py-3 border-t border-border-light flex-shrink-0">
          <button
            onClick={close}
            className="px-4 py-1.5 text-xs bg-bg-hover hover:bg-border-light text-text-primary rounded transition-colors"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  )
}
