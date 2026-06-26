import { useState, useEffect } from 'react'
import { X, Plug, Loader2, CheckCircle2, AlertCircle, Lock, Server } from 'lucide-react'
import { useUiStore } from '@stores/ui'
import { useConnectionStore } from '@stores/connection'
import type { ConnectionConfig } from '@shared/types'

const DEFAULT_CONFIG: ConnectionConfig = {
  id: '',
  name: '',
  type: 'mysql',
  host: '127.0.0.1',
  port: 3306,
  user: 'root',
  password: '',
  database: '',
  color: '#3b82f6'
}

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16']

export default function ConnectionModal() {
  const show = useUiStore((s) => s.showConnectionModal)
  const editingId = useUiStore((s) => s.editingConnectionId)
  const close = useUiStore((s) => s.closeConnectionModal)
  const { connections, saveConnection } = useConnectionStore()

  const [config, setConfig] = useState<ConnectionConfig>(DEFAULT_CONFIG)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (show && editingId) {
      const conn = connections.find((c) => c.id === editingId)
      if (conn) setConfig({ ...conn })
    } else if (show) {
      setConfig({ ...DEFAULT_CONFIG })
    }
    setTestResult(null)
  }, [show, editingId, connections])

  if (!show) return null

  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
    const res = await window.api.db.testConnection(config)
    setTestResult({ ok: res.success, msg: res.success ? '连接成功' : res.error ?? '连接失败' })
    setTesting(false)
  }

  const handleSave = async () => {
    if (!config.name.trim()) {
      setTestResult({ ok: false, msg: '请填写连接名称' })
      return
    }
    if (!config.host.trim()) {
      setTestResult({ ok: false, msg: '请填写主机地址' })
      return
    }
    setSaving(true)
    await saveConnection(config)
    setSaving(false)
    close()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
    >
      <div
        className="w-[520px] max-h-[90vh] bg-bg-secondary rounded-lg shadow-2xl border border-border overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题栏 */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border-light">
          <h2 className="text-base font-semibold text-text-primary">
            {editingId ? '编辑连接' : '新建连接'}
          </h2>
          <button
            onClick={close}
            className="p-1 rounded hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* 表单内容 */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* 连接名称 */}
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">
              连接名称 <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={config.name}
              onChange={(e) => setConfig({ ...config, name: e.target.value })}
              placeholder="例如：本地开发库"
              className="w-full px-3 py-2 bg-bg-primary border border-border rounded text-sm text-text-primary focus:outline-none focus:border-accent transition-colors"
            />
          </div>

          {/* 分组 */}
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">分组</label>
            <input
              type="text"
              value={config.group ?? ''}
              onChange={(e) => setConfig({ ...config, group: e.target.value || undefined })}
              placeholder="例如：开发环境、生产环境"
              className="w-full px-3 py-2 bg-bg-primary border border-border rounded text-sm text-text-primary focus:outline-none focus:border-accent transition-colors"
            />
          </div>

          {/* 标签 */}
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">标签</label>
            <input
              type="text"
              value={(config.tags ?? []).join(', ')}
              onChange={(e) => {
                const tags = e.target.value.split(/[,\uff0c]/).map((s) => s.trim()).filter(Boolean)
                setConfig({ ...config, tags: tags.length > 0 ? tags : undefined })
              }}
              placeholder="多个标签用逗号分隔，例如：核心, 只读, 测试"
              className="w-full px-3 py-2 bg-bg-primary border border-border rounded text-sm text-text-primary focus:outline-none focus:border-accent transition-colors"
            />
          </div>

          {/* 颜色标签 */}
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-2">标签颜色</label>
            <div className="flex gap-2">
              {COLORS.map((color) => (
                <button
                  key={color}
                  onClick={() => setConfig({ ...config, color })}
                  className="w-6 h-6 rounded-full transition-transform hover:scale-110"
                  style={{
                    backgroundColor: color,
                    border: config.color === color ? '2px solid white' : '2px solid transparent'
                  }}
                />
              ))}
            </div>
          </div>

          {/* 主机和端口 */}
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs font-medium text-text-secondary mb-1">主机</label>
              <input
                type="text"
                value={config.host}
                onChange={(e) => setConfig({ ...config, host: e.target.value })}
                placeholder="127.0.0.1"
                className="w-full px-3 py-2 bg-bg-primary border border-border rounded text-sm text-text-primary focus:outline-none focus:border-accent transition-colors"
              />
            </div>
            <div className="w-24">
              <label className="block text-xs font-medium text-text-secondary mb-1">端口</label>
              <input
                type="number"
                value={config.port}
                onChange={(e) => setConfig({ ...config, port: parseInt(e.target.value) || 3306 })}
                className="w-full px-3 py-2 bg-bg-primary border border-border rounded text-sm text-text-primary focus:outline-none focus:border-accent transition-colors"
              />
            </div>
          </div>

          {/* 用户名和密码 */}
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs font-medium text-text-secondary mb-1">用户名</label>
              <input
                type="text"
                value={config.user}
                onChange={(e) => setConfig({ ...config, user: e.target.value })}
                placeholder="root"
                className="w-full px-3 py-2 bg-bg-primary border border-border rounded text-sm text-text-primary focus:outline-none focus:border-accent transition-colors"
              />
            </div>
            <div className="flex-1">
              <label className="block text-xs font-medium text-text-secondary mb-1">密码</label>
              <input
                type="password"
                value={config.password}
                onChange={(e) => setConfig({ ...config, password: e.target.value })}
                className="w-full px-3 py-2 bg-bg-primary border border-border rounded text-sm text-text-primary focus:outline-none focus:border-accent transition-colors"
              />
            </div>
          </div>

          {/* 默认数据库 */}
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">默认数据库</label>
            <input
              type="text"
              value={config.database ?? ''}
              onChange={(e) => setConfig({ ...config, database: e.target.value })}
              placeholder="可选"
              className="w-full px-3 py-2 bg-bg-primary border border-border rounded text-sm text-text-primary focus:outline-none focus:border-accent transition-colors"
            />
          </div>

          {/* SSL 开关 */}
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={!!config.sslEnabled}
                onChange={(e) => setConfig({ ...config, sslEnabled: e.target.checked })}
                className="w-4 h-4 accent-accent"
              />
              <Lock size={14} className="text-text-secondary" />
              <span className="text-sm text-text-primary">启用 SSL 加密连接</span>
            </label>
          </div>

          {/* SSH 隧道 */}
          <div className="border border-border-light rounded-lg">
            <label className="flex items-center gap-2 px-4 py-2.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={!!config.sshEnabled}
                onChange={(e) => setConfig({ ...config, sshEnabled: e.target.checked })}
                className="w-4 h-4 accent-accent"
              />
              <Server size={14} className="text-text-secondary" />
              <span className="text-sm text-text-primary font-medium">通过 SSH 隧道连接</span>
            </label>

            {config.sshEnabled && (
              <div className="px-4 pb-4 space-y-3 border-t border-border-light pt-3">
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="block text-xs font-medium text-text-secondary mb-1">SSH 主机</label>
                    <input
                      type="text"
                      value={config.sshHost ?? ''}
                      onChange={(e) => setConfig({ ...config, sshHost: e.target.value })}
                      placeholder="例如：ssh.example.com"
                      className="w-full px-3 py-2 bg-bg-primary border border-border rounded text-sm text-text-primary focus:outline-none focus:border-accent transition-colors"
                    />
                  </div>
                  <div className="w-24">
                    <label className="block text-xs font-medium text-text-secondary mb-1">端口</label>
                    <input
                      type="number"
                      value={config.sshPort ?? 22}
                      onChange={(e) => setConfig({ ...config, sshPort: parseInt(e.target.value) || 22 })}
                      className="w-full px-3 py-2 bg-bg-primary border border-border rounded text-sm text-text-primary focus:outline-none focus:border-accent transition-colors"
                    />
                  </div>
                </div>
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="block text-xs font-medium text-text-secondary mb-1">SSH 用户名</label>
                    <input
                      type="text"
                      value={config.sshUser ?? ''}
                      onChange={(e) => setConfig({ ...config, sshUser: e.target.value })}
                      placeholder="root"
                      className="w-full px-3 py-2 bg-bg-primary border border-border rounded text-sm text-text-primary focus:outline-none focus:border-accent transition-colors"
                    />
                  </div>
                  <div className="flex-1">
                    <label className="block text-xs font-medium text-text-secondary mb-1">SSH 密码</label>
                    <input
                      type="password"
                      value={config.sshPassword ?? ''}
                      onChange={(e) => setConfig({ ...config, sshPassword: e.target.value })}
                      placeholder="可选"
                      className="w-full px-3 py-2 bg-bg-primary border border-border rounded text-sm text-text-primary focus:outline-none focus:border-accent transition-colors"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1">私钥路径（可选）</label>
                  <input
                    type="text"
                    value={config.sshPrivateKey ?? ''}
                    onChange={(e) => setConfig({ ...config, sshPrivateKey: e.target.value })}
                    placeholder="例如：C:\Users\you\.ssh\id_rsa"
                    className="w-full px-3 py-2 bg-bg-primary border border-border rounded text-sm text-text-primary focus:outline-none focus:border-accent transition-colors"
                  />
                </div>
              </div>
            )}
          </div>

          {/* 测试结果 */}
          {testResult && (
            <div
              className={`flex items-start gap-2 px-3 py-2 rounded text-sm ${
                testResult.ok
                  ? 'bg-green-500/10 text-green-400'
                  : 'bg-red-500/10 text-red-400'
              }`}
            >
              {testResult.ok ? (
                <CheckCircle2 size={16} className="flex-shrink-0 mt-0.5" />
              ) : (
                <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
              )}
              <pre className="whitespace-pre-wrap break-words font-mono text-xs max-h-32 overflow-y-auto">
                {testResult.msg}
              </pre>
            </div>
          )}
        </div>

        {/* 底部按钮 */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-border-light">
          <button
            onClick={handleTest}
            disabled={testing}
            className="flex items-center gap-2 px-4 py-2 text-sm border border-border rounded hover:bg-bg-hover transition-colors disabled:opacity-50"
          >
            {testing ? <Loader2 size={16} className="animate-spin" /> : <Plug size={16} />}
            测试连接
          </button>
          <div className="flex gap-2">
            <button
              onClick={close}
              className="px-4 py-2 text-sm border border-border rounded hover:bg-bg-hover transition-colors"
            >
              取消
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 text-sm bg-accent hover:bg-accent-hover text-white rounded transition-colors disabled:opacity-50"
            >
              {saving ? '保存中...' : '保存'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
