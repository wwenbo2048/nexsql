import { useState, useRef, useCallback, useEffect } from 'react'
import {
  Sparkles,
  Loader2,
  Settings,
  X,
  Send,
  Check,
  AlertCircle,
  Key,
  Wand2,
  ArrowRight,
  Trash2,
  Eye,
  EyeOff,
  Save
} from 'lucide-react'
import type { ConnectionConfig } from '@shared/types'

interface Props {
  /** 当前连接配置 */
  config?: ConnectionConfig
  /** 当前选中数据库 */
  database?: string
  /** 编辑器中已有的 SQL */
  existingSql?: string
  /** 将生成的 SQL 插入编辑器（替换模式） */
  onInsertSql: (sql: string, mode: 'replace' | 'append') => void
  /** 关闭面板 */
  onClose: () => void
}

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  status?: 'streaming' | 'done' | 'error'
}

export default function AiSqlPanel({ config, database, existingSql, onInsertSql, onClose }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [generating, setGenerating] = useState(false)
  const [streamingText, setStreamingText] = useState('')
  const [showSettings, setShowSettings] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const currentRequestId = useRef<string>('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // 启动时检查 API Key
  const [hasApiKey, setHasApiKey] = useState<boolean | null>(null)

  useEffect(() => {
    window.api.ai.getSettings().then((s) => {
      setHasApiKey(!!s.apiKey)
      if (!s.apiKey) {
        setShowSettings(true)
      }
    })
  }, [])

  // 自动滚动
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, streamingText])

  // 自动聚焦
  useEffect(() => {
    if (hasApiKey && !generating) {
      inputRef.current?.focus()
    }
  }, [hasApiKey, generating])

  const handleGenerate = useCallback(async () => {
    const prompt = input.trim()
    if (!prompt || generating) return

    setError(null)
    setGenerating(true)
    setStreamingText('')

    const userMsgId = `u-${Date.now()}`
    const assistantMsgId = `a-${Date.now()}`
    const requestId = `req-${Date.now()}`
    currentRequestId.current = requestId

    // 添加用户消息
    setMessages((prev) => [...prev, { id: userMsgId, role: 'user', content: prompt }])
    // 添加占位 assistant 消息
    setMessages((prev) => [...prev, { id: assistantMsgId, role: 'assistant', content: '', status: 'streaming' }])

    setInput('')

    // 流式接收
    let accumulated = ''
    const removeListener = window.api.ai.onStreamChunk((data) => {
      if (data.requestId !== requestId) return
      accumulated += data.chunk
      setStreamingText(accumulated)
      // 实时更新 assistant 消息
      setMessages((prev) =>
        prev.map((m) => (m.id === assistantMsgId ? { ...m, content: accumulated } : m))
      )
    })

    try {
      const res = await window.api.ai.generateSql({
        requestId,
        prompt,
        config,
        database,
        existingSql: existingSql?.trim() || undefined,
      })

      removeListener()

      if (res.success && res.data) {
        const finalSql = res.data
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId ? { ...m, content: finalSql, status: 'done' as const } : m
          )
        )
      } else if (res.error === '已取消') {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId
              ? { ...m, content: accumulated || '（已取消）', status: 'done' as const }
              : m
          )
        )
      } else {
        const errMsg = res.error || '生成失败'
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId ? { ...m, content: `❌ ${errMsg}`, status: 'error' as const } : m
          )
        )
        setError(errMsg)
      }
    } catch (err) {
      removeListener()
      const errMsg = (err as Error).message
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsgId ? { ...m, content: `❌ ${errMsg}`, status: 'error' as const } : m
        )
      )
      setError(errMsg)
    } finally {
      setGenerating(false)
      setStreamingText('')
    }
  }, [input, generating, config, database, existingSql])

  const handleCancel = useCallback(() => {
    if (currentRequestId.current) {
      window.api.ai.cancelGenerate(currentRequestId.current)
    }
  }, [])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleGenerate()
    }
  }, [handleGenerate])

  const handleClearChat = useCallback(() => {
    setMessages([])
    setError(null)
  }, [])

  // ==================== 快捷提示词 ====================
  const quickPrompts = [
    '查询所有表的数据量',
    '查看用户表结构',
    '统计每个表的记录数',
  ]

  return (
    <div className="flex flex-col h-full bg-bg-secondary">
      {/* 头部 */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-light bg-bg-tertiary">
        <div className="flex items-center gap-2">
          <Sparkles size={14} className="text-accent" />
          <span className="text-xs font-medium text-text-primary">AI 自然语言转 SQL</span>
          {database && (
            <span className="text-[10px] text-text-muted flex items-center gap-1">
              <ArrowRight size={9} /> {database}
            </span>
          )}
          {hasApiKey === false && (
            <span className="text-[10px] text-yellow-400 flex items-center gap-0.5">
              <AlertCircle size={9} /> 未配置 API Key
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowSettings(true)}
            className="p-1 hover:bg-bg-hover rounded text-text-muted hover:text-text-primary transition-colors"
            title="AI 设置"
          >
            <Settings size={13} />
          </button>
          {messages.length > 0 && (
            <button
              onClick={handleClearChat}
              className="p-1 hover:bg-bg-hover rounded text-text-muted hover:text-red-400 transition-colors"
              title="清空对话"
            >
              <Trash2 size={13} />
            </button>
          )}
          <button
            onClick={onClose}
            className="p-1 hover:bg-bg-hover rounded text-text-muted hover:text-text-primary transition-colors"
            title="关闭"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* 对话区域 */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center gap-3 py-8">
            <div className="w-12 h-12 rounded-full bg-accent/10 flex items-center justify-center">
              <Wand2 size={24} className="text-accent" />
            </div>
            <div>
              <p className="text-sm text-text-secondary mb-1">用自然语言描述你想要的 SQL</p>
              <p className="text-[11px] text-text-muted">AI 会根据当前数据库表结构自动生成</p>
            </div>
            {/* 快捷提示 */}
            <div className="flex flex-wrap gap-1.5 justify-center max-w-xs">
              {quickPrompts.map((qp) => (
                <button
                  key={qp}
                  onClick={() => setInput(qp)}
                  className="px-2 py-1 text-[11px] bg-bg-primary border border-border-light rounded-full text-text-secondary hover:border-accent hover:text-accent transition-colors"
                >
                  {qp}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <MessageBubble
            key={msg.id}
            message={msg}
            onInsert={(mode) => onInsertSql(msg.content, mode)}
          />
        ))}
      </div>

      {/* 输入区域 */}
      <div className="border-t border-border-light p-3">
        {error && (
          <div className="mb-2 flex items-center gap-1.5 text-[11px] text-red-400 bg-red-500/10 rounded px-2 py-1">
            <AlertCircle size={11} />
            <span className="flex-1 truncate">{error}</span>
            <button onClick={() => setError(null)} className="hover:text-red-300">
              <X size={11} />
            </button>
          </div>
        )}
        <div className="relative">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="描述你想要的 SQL，如：查询最近 7 天注册的用户..."
            rows={2}
            disabled={generating}
            className="w-full px-3 py-2 pr-10 bg-bg-primary border border-border-light rounded text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent transition-colors resize-none disabled:opacity-60"
          />
          {generating ? (
            <button
              onClick={handleCancel}
              className="absolute right-2 bottom-2 p-1.5 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded transition-colors"
              title="停止生成"
            >
              <div className="w-3 h-3 bg-red-400 rounded-sm" />
            </button>
          ) : (
            <button
              onClick={handleGenerate}
              disabled={!input.trim()}
              className="absolute right-2 bottom-2 p-1.5 bg-accent hover:bg-accent-hover text-white rounded transition-colors disabled:opacity-30"
              title="生成 SQL (Enter)"
            >
              <Send size={12} />
            </button>
          )}
        </div>
        <div className="flex items-center justify-between mt-1.5">
          <span className="text-[10px] text-text-muted">
            {config && database ? '已加载表结构上下文' : '未连接数据库，无法提供表结构'}
          </span>
          <span className="text-[10px] text-text-muted">Enter 发送 · Shift+Enter 换行</span>
        </div>
      </div>

      {/* 设置弹窗 */}
      {showSettings && (
        <AiSettingsModal
          onClose={() => setShowSettings(false)}
          onSaved={() => {
            setHasApiKey(true)
            setShowSettings(false)
          }}
        />
      )}
    </div>
  )
}

// ==================== 消息气泡 ====================

function MessageBubble({
  message,
  onInsert,
}: {
  message: ChatMessage
  onInsert: (mode: 'replace' | 'append') => void
}) {
  const isUser = message.role === 'user'

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] px-3 py-2 bg-accent/15 rounded-lg text-xs text-text-primary">
          {message.content}
        </div>
      </div>
    )
  }

  // assistant 消息
  const isStreaming = message.status === 'streaming'
  const isError = message.status === 'error'
  const hasContent = message.content.trim().length > 0

  return (
    <div className="flex justify-start">
      <div className="max-w-[90%] w-full">
        <div className="flex items-center gap-1.5 mb-1">
          <Sparkles size={11} className={isError ? 'text-red-400' : 'text-accent'} />
          <span className="text-[10px] text-text-muted">
            {isStreaming ? '生成中...' : isError ? '错误' : 'SQL'}
          </span>
          {isStreaming && <Loader2 size={10} className="animate-spin text-accent" />}
        </div>

        {hasContent ? (
          <>
            <pre
              className={`px-3 py-2 rounded-lg text-xs font-mono overflow-x-auto whitespace-pre-wrap break-all ${
                isError
                  ? 'bg-red-500/10 text-red-300 border border-red-500/20'
                  : 'bg-bg-primary text-text-primary border border-border-light'
              }`}
            >
              {message.content}
              {isStreaming && <span className="inline-block w-1.5 h-3 bg-accent animate-pulse ml-0.5 align-middle" />}
            </pre>

            {!isStreaming && !isError && (
              <div className="flex items-center gap-1.5 mt-1.5">
                <button
                  onClick={() => onInsert('replace')}
                  className="flex items-center gap-1 px-2 py-1 text-[11px] bg-accent hover:bg-accent-hover text-white rounded transition-colors"
                >
                  <Check size={11} />
                  替换编辑器
                </button>
                <button
                  onClick={() => onInsert('append')}
                  className="flex items-center gap-1 px-2 py-1 text-[11px] bg-bg-primary border border-border-light hover:border-accent text-text-secondary rounded transition-colors"
                >
                  <ArrowRight size={11} />
                  追加
                </button>
              </div>
            )}
          </>
        ) : (
          <div className="px-3 py-2 rounded-lg bg-bg-primary border border-border-light">
            {isStreaming ? (
              <div className="flex items-center gap-2 text-xs text-text-muted">
                <Loader2 size={12} className="animate-spin" />
                正在思考...
              </div>
            ) : (
              <span className="text-xs text-text-muted">（空回复）</span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ==================== AI 设置弹窗 ====================

function AiSettingsModal({
  onClose,
  onSaved,
}: {
  onClose: () => void
  onSaved: () => void
}) {
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState('deepseek-chat')
  const [showKey, setShowKey] = useState(false)
  const [saving, setSaving] = useState(false)
  const [validating, setValidating] = useState(false)
  const [validated, setValidated] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    window.api.ai.getSettings().then((s) => {
      setApiKey(s.apiKey)
      setModel(s.model)
    })
  }, [])

  const handleValidate = useCallback(async () => {
    if (!apiKey.trim()) return
    setValidating(true)
    setError(null)
    setValidated(false)
    try {
      const res = await window.api.ai.validateApiKey(apiKey.trim(), model)
      if (res.success && res.data) {
        setValidated(true)
      } else {
        setError(res.error || 'API Key 验证失败')
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setValidating(false)
    }
  }, [apiKey, model])

  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      await window.api.ai.setSettings({ apiKey: apiKey.trim(), model })
      onSaved()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }, [apiKey, model, onSaved])

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="w-[460px] bg-bg-secondary border border-border-light rounded-lg shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-light">
          <div className="flex items-center gap-2">
            <Key size={15} className="text-accent" />
            <span className="text-sm font-medium text-text-primary">DeepSeek API 配置</span>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-bg-hover rounded text-text-muted hover:text-text-primary transition-colors">
            <X size={15} />
          </button>
        </div>

        {/* 内容 */}
        <div className="px-4 py-4 space-y-4">
          {/* API Key */}
          <div>
            <label className="block text-xs text-text-secondary mb-1.5">
              API Key <span className="text-red-400">*</span>
            </label>
            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => { setApiKey(e.target.value); setValidated(false); setError(null) }}
                placeholder="sk-..."
                autoFocus
                className="w-full px-3 py-2 pr-9 bg-bg-primary border border-border-light rounded text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent transition-colors"
              />
              <button
                onClick={() => setShowKey(!showKey)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-text-muted hover:text-text-primary transition-colors"
                title={showKey ? '隐藏' : '显示'}
              >
                {showKey ? <EyeOff size={13} /> : <Eye size={13} />}
              </button>
            </div>
          </div>

          {/* Model */}
          <div>
            <label className="block text-xs text-text-secondary mb-1.5">模型</label>
            <select
              value={model}
              onChange={(e) => { setModel(e.target.value); setValidated(false) }}
              className="w-full px-3 py-2 bg-bg-primary border border-border-light rounded text-xs text-text-primary focus:outline-none focus:border-accent transition-colors"
            >
              <option value="deepseek-chat">deepseek-chat (通用, 推荐)</option>
              <option value="deepseek-reasoner">deepseek-reasoner (推理, 更精准)</option>
            </select>
          </div>

          {/* 验证状态 */}
          {validated && (
            <div className="flex items-center gap-1.5 text-[11px] text-green-400 bg-green-500/10 rounded px-2 py-1.5">
              <Check size={12} />
              API Key 验证成功
            </div>
          )}
          {error && (
            <div className="flex items-center gap-1.5 text-[11px] text-red-400 bg-red-500/10 rounded px-2 py-1.5">
              <AlertCircle size={12} />
              <span className="flex-1">{error}</span>
            </div>
          )}

          {/* 说明 */}
          <div className="text-[11px] text-text-muted bg-bg-tertiary/50 rounded px-3 py-2 leading-relaxed">
            <p className="mb-1">
              <span className="text-text-secondary">获取方式：</span>
              访问{' '}
              <span className="text-accent">platform.deepseek.com</span>
              {' '}注册并创建 API Key
            </p>
            <p>
              <span className="text-text-secondary">安全说明：</span>
              API Key 仅存储在本地，不会上传到任何服务器
            </p>
          </div>

          {/* 操作按钮 */}
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={handleValidate}
              disabled={!apiKey.trim() || validating}
              className="flex items-center gap-1 px-3 py-2 text-xs bg-bg-primary border border-border-light hover:border-accent text-text-secondary rounded transition-colors disabled:opacity-50"
            >
              {validating ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
              验证
            </button>
            <button
              onClick={handleSave}
              disabled={!apiKey.trim() || saving}
              className="flex-1 flex items-center justify-center gap-1 px-3 py-2 text-xs bg-accent hover:bg-accent-hover text-white rounded transition-colors disabled:opacity-50"
            >
              {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
              保存
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
