import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Loader2, AlertCircle, Search, Trash2, Edit3, Plus, RefreshCw,
  ChevronRight, Clock, Hash, List, FileBox, Layers, X, Check, Save, KeyRound, Tag,
  Square, CheckSquare, MinusSquare
} from 'lucide-react'
import type { ConnectionConfig, RedisKeyInfo, RedisKeyValue, RedisKeyType } from '@shared/types'

interface Props {
  config: ConnectionConfig
  onClose: () => void
}

const TYPE_LABELS: Record<RedisKeyType, string> = {
  string: 'String',
  hash: 'Hash',
  list: 'List',
  set: 'Set',
  zset: 'Sorted Set',
  stream: 'Stream',
  none: 'None'
}

const TYPE_ICONS: Record<RedisKeyType, typeof Hash> = {
  string: Tag,
  hash: Hash,
  list: List,
  set: FileBox,
  zset: Layers,
  stream: Layers,
  none: KeyRound
}

const TYPE_COLORS: Record<RedisKeyType, string> = {
  string: 'text-blue-400',
  hash: 'text-green-400',
  list: 'text-yellow-400',
  set: 'text-purple-400',
  zset: 'text-orange-400',
  stream: 'text-cyan-400',
  none: 'text-text-muted'
}

function formatTtl(ttl: number): string {
  if (ttl === -1) return '永久'
  if (ttl === -2) return '不存在'
  if (ttl < 60) return `${ttl}秒`
  if (ttl < 3600) return `${Math.floor(ttl / 60)}分${ttl % 60}秒`
  if (ttl < 86400) return `${Math.floor(ttl / 3600)}小时`
  return `${Math.floor(ttl / 86400)}天`
}

export default function RedisBrowser({ config, onClose }: Props) {
  const [keys, setKeys] = useState<RedisKeyInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searchPattern, setSearchPattern] = useState('*')
  const [cursor, setCursor] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [dbSize, setDbSize] = useState(0)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [keyDetail, setKeyDetail] = useState<RedisKeyValue | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState('')
  const [editTtl, setEditTtl] = useState('')
  const [saving, setSaving] = useState(false)
  const [newKeyModal, setNewKeyModal] = useState(false)
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set())
  const [selectMode, setSelectMode] = useState(false)
  const [batchDeleting, setBatchDeleting] = useState(false)

  // 初始加载
  const loadKeys = useCallback(async (pattern: string) => {
    setLoading(true)
    setError(null)
    setSelectedKey(null)
    setKeyDetail(null)
    setSelectedKeys(new Set())
    try {
      // 先获取 dbsize
      const sizeRes = await window.api.redis.dbsize(config)
      if (sizeRes.success) setDbSize(sizeRes.data ?? 0)

      const res = await window.api.redis.scan(config, pattern, 0, 200)
      if (!res.success || !res.data) throw new Error(res.error)
      setKeys(res.data.keys)
      setCursor(res.data.cursor)
      setHasMore(res.data.cursor !== 0)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [config])

  // 加载更多
  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return
    setLoadingMore(true)
    try {
      const res = await window.api.redis.scan(config, searchPattern, cursor, 200)
      if (res.success && res.data) {
        setKeys((prev) => [...prev, ...res.data.keys])
        setCursor(res.data.cursor)
        setHasMore(res.data.cursor !== 0)
      }
    } finally {
      setLoadingMore(false)
    }
  }, [config, cursor, hasMore, loadingMore, searchPattern])

  useEffect(() => {
    loadKeys('*')
  }, [loadKeys])

  // 查看某个 key 的详情
  const viewKey = useCallback(async (key: string) => {
    setSelectedKey(key)
    setEditing(false)
    setDetailLoading(true)
    try {
      const res = await window.api.redis.getKey(config, key)
      if (res.success && res.data) {
        setKeyDetail(res.data)
        setEditValue(res.data.value)
        setEditTtl(res.data.ttl > 0 ? String(res.data.ttl) : '')
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setDetailLoading(false)
    }
  }, [config])

  // 保存编辑
  const handleSave = useCallback(async () => {
    if (!selectedKey || !keyDetail) return
    setSaving(true)
    try {
      const ttl = editTtl.trim() ? parseInt(editTtl) : undefined
      const res = await window.api.redis.setKey(config, selectedKey, keyDetail.type, editValue, ttl)
      if (!res.success) throw new Error(res.error)
      setEditing(false)
      await viewKey(selectedKey)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }, [selectedKey, keyDetail, editValue, editTtl, config, viewKey])

  // 删除 key
  const handleDelete = useCallback(async (key: string) => {
    if (!confirm(`确定删除 key: "${key}" 吗？`)) return
    try {
      const res = await window.api.redis.deleteKey(config, key)
      if (!res.success) throw new Error(res.error)
      setKeys((prev) => prev.filter((k) => k.key !== key))
      if (selectedKey === key) {
        setSelectedKey(null)
        setKeyDetail(null)
      }
    } catch (err) {
      setError((err as Error).message)
    }
  }, [config, selectedKey])

  // 切换单个 key 的选中状态
  const toggleSelectKey = useCallback((key: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setSelectedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  // 全选/取消全选
  const toggleSelectAll = useCallback(() => {
    setSelectedKeys((prev) => {
      if (prev.size === keys.length) return new Set()
      return new Set(keys.map((k) => k.key))
    })
  }, [keys])

  // 批量删除
  const handleBatchDelete = useCallback(async () => {
    if (selectedKeys.size === 0) return
    if (!confirm(`确定删除选中的 ${selectedKeys.size} 个 key 吗？此操作不可撤销。`)) return
    setBatchDeleting(true)
    try {
      const res = await window.api.redis.batchDeleteKeys(config, Array.from(selectedKeys))
      if (!res.success) throw new Error(res.error)
      const deletedCount = res.data ?? 0
      setKeys((prev) => prev.filter((k) => !selectedKeys.has(k.key)))
      if (selectedKey && selectedKeys.has(selectedKey)) {
        setSelectedKey(null)
        setKeyDetail(null)
      }
      setSelectedKeys(new Set())
      // 更新 dbsize
      setDbSize((prev) => Math.max(0, prev - deletedCount))
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBatchDeleting(false)
    }
  }, [config, selectedKeys, selectedKey])

  // 设置 TTL
  const handleSetTtl = useCallback(async () => {
    if (!selectedKey) return
    const ttlStr = prompt(`设置 TTL（秒），输入 0 表示永久：`, keyDetail && keyDetail.ttl > 0 ? String(keyDetail.ttl) : '0')
    if (ttlStr === null) return
    const ttl = parseInt(ttlStr)
    try {
      const res = await window.api.redis.setTtl(config, selectedKey, ttl)
      if (!res.success) throw new Error(res.error)
      await viewKey(selectedKey)
    } catch (err) {
      setError((err as Error).message)
    }
  }, [config, selectedKey, keyDetail, viewKey])

  return (
    <div className="flex flex-col h-full bg-bg-primary">
      {/* 顶部工具栏 */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border-light bg-bg-secondary flex-shrink-0">
        <KeyRound size={14} className="text-red-400 flex-shrink-0" />
        <span className="text-xs font-medium text-text-primary">{config.name}</span>
        <span className="text-[10px] text-text-muted">DB{config.redisDb ?? 0}</span>
        <span className="text-[10px] text-text-muted">· {dbSize} keys</span>

        {/* 批量选择模式工具栏 */}
        {selectMode ? (
          <div className="flex items-center gap-1">
            <button
              onClick={toggleSelectAll}
              className="flex items-center gap-1 px-2 py-1 rounded text-[11px] text-text-secondary hover:bg-bg-hover transition-colors"
              title="全选/取消全选"
            >
              {selectedKeys.size === keys.length && keys.length > 0 ? <MinusSquare size={12} /> : <CheckSquare size={12} />}
              {selectedKeys.size === keys.length && keys.length > 0 ? '取消全选' : '全选'}
            </button>
            <span className="text-[10px] text-text-muted">已选 {selectedKeys.size} 项</span>
            <button
              onClick={handleBatchDelete}
              disabled={selectedKeys.size === 0 || batchDeleting}
              className="flex items-center gap-1 px-2 py-1 rounded text-[11px] bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors disabled:opacity-30"
            >
              {batchDeleting ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
              批量删除
            </button>
            <button
              onClick={() => { setSelectMode(false); setSelectedKeys(new Set()) }}
              className="flex items-center gap-1 px-2 py-1 rounded text-[11px] text-text-muted hover:bg-bg-hover transition-colors"
              title="退出选择模式"
            >
              <X size={11} /> 取消
            </button>
          </div>
        ) : (
          <button
            onClick={() => setSelectMode(true)}
            disabled={keys.length === 0}
            className="flex items-center gap-1 px-2 py-1 rounded text-[11px] text-text-secondary hover:bg-bg-hover transition-colors disabled:opacity-30"
            title="批量选择"
          >
            <Square size={11} /> 批量选择
          </button>
        )}

        <button
          onClick={() => setNewKeyModal(true)}
          className="flex items-center gap-1 px-2 py-1 rounded text-[11px] bg-accent/10 text-accent hover:bg-accent/20 transition-colors"
        >
          <Plus size={11} /> 新建
        </button>
        <button
          onClick={() => loadKeys(searchPattern)}
          className="flex items-center gap-1 px-2 py-1 rounded text-[11px] text-text-secondary hover:bg-bg-hover transition-colors"
        >
          <RefreshCw size={11} /> 刷新
        </button>
      </div>

      {/* 搜索栏 */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border-light bg-bg-tertiary flex-shrink-0">
        <Search size={13} className="text-text-muted flex-shrink-0" />
        <input
          type="text"
          value={searchPattern}
          onChange={(e) => setSearchPattern(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') loadKeys(searchPattern) }}
          placeholder="key 模式匹配，例如 user:* 或 session:?"
          className="flex-1 bg-bg-primary border border-border-light rounded px-2 py-1 text-xs text-text-primary focus:outline-none focus:border-accent"
        />
        <button
          onClick={() => loadKeys(searchPattern)}
          disabled={loading}
          className="px-3 py-1 bg-accent hover:bg-accent/80 text-white rounded text-xs font-medium transition-colors disabled:opacity-50"
        >
          {loading ? <Loader2 size={11} className="animate-spin" /> : '搜索'}
        </button>
      </div>

      {/* 主区域：左右分栏 */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        {/* 左侧 key 列表 */}
        <div className={`${selectedKey ? 'w-2/5' : 'w-full'} overflow-hidden flex flex-col border-r border-border-light`}>
          <div className="flex-1 overflow-auto">
            {loading && keys.length === 0 ? (
              <div className="flex items-center justify-center h-full text-text-muted text-sm gap-2">
                <Loader2 size={16} className="animate-spin text-accent" /> 加载中...
              </div>
            ) : error ? (
              <div className="flex items-start gap-2 p-3 text-xs text-red-400">
                <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
                <pre className="whitespace-pre-wrap">{error}</pre>
              </div>
            ) : keys.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-text-muted text-sm gap-2">
                <KeyRound size={32} className="opacity-20" />
                <p>没有找到匹配的 key</p>
              </div>
            ) : (
              <>
                {keys.map((k) => {
                  const Icon = TYPE_ICONS[k.type] || KeyRound
                  const isActive = selectedKey === k.key
                  return (
                    <div
                      key={k.key}
                      onClick={() => selectMode ? toggleSelectKey(k.key, { stopPropagation: () => {} } as any) : viewKey(k.key)}
                      className={`group flex items-center gap-2 px-3 py-1.5 cursor-pointer border-b border-border-light/30 hover:bg-bg-hover ${isActive ? 'bg-accent/10' : ''} ${selectMode && selectedKeys.has(k.key) ? 'bg-red-500/10' : ''}`}
                    >
                      {selectMode && (
                        <button
                          onClick={(e) => toggleSelectKey(k.key, e)}
                          className="flex-shrink-0 p-0.5"
                        >
                          {selectedKeys.has(k.key)
                            ? <CheckSquare size={13} className="text-red-400" />
                            : <Square size={13} className="text-text-muted" />}
                        </button>
                      )}
                      <Icon size={12} className={`${TYPE_COLORS[k.type]} flex-shrink-0`} />
                      <span className={`text-xs font-mono truncate flex-1 ${isActive ? 'text-accent' : 'text-text-primary'}`}>
                        {k.key}
                      </span>
                      <span className="text-[9px] text-text-muted flex-shrink-0">{k.size}</span>
                      {k.ttl > 0 && (
                        <span className="text-[9px] text-yellow-400 flex-shrink-0 flex items-center gap-0.5">
                          <Clock size={8} />{formatTtl(k.ttl)}
                        </span>
                      )}
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDelete(k.key) }}
                        className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-red-400 hover:bg-red-500/20 transition-opacity"
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  )
                })}
                {hasMore && (
                  <button
                    onClick={loadMore}
                    disabled={loadingMore}
                    className="w-full py-2 text-center text-xs text-accent hover:bg-bg-hover transition-colors"
                  >
                    {loadingMore ? <Loader2 size={12} className="animate-spin inline" /> : '加载更多...'}
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        {/* 右侧详情/编辑 */}
        {selectedKey && (
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* 详情头部 */}
            <div className="flex items-center gap-2 px-3 py-2 border-b border-border-light bg-bg-tertiary flex-shrink-0">
              {keyDetail && (() => {
                const Icon = TYPE_ICONS[keyDetail.type] || KeyRound
                return <Icon size={14} className={TYPE_COLORS[keyDetail.type]} />
              })()}
              <span className="text-xs font-mono font-medium text-text-primary truncate flex-1">{selectedKey}</span>
              {keyDetail && (
                <>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded bg-bg-primary ${TYPE_COLORS[keyDetail.type]}`}>
                    {TYPE_LABELS[keyDetail.type]}
                  </span>
                  <span className="text-[10px] text-text-muted flex items-center gap-0.5">
                    <Clock size={10} />
                    {keyDetail.ttl > 0 ? formatTtl(keyDetail.ttl) : keyDetail.ttl === -1 ? '永久' : '-'}
                  </span>
                </>
              )}
              <div className="flex items-center gap-0.5 ml-2">
                <button
                  onClick={handleSetTtl}
                  className="p-1 rounded text-text-muted hover:text-yellow-400 hover:bg-bg-hover transition-colors"
                  title="设置 TTL"
                >
                  <Clock size={13} />
                </button>
                <button
                  onClick={() => setEditing(!editing)}
                  disabled={!keyDetail || keyDetail.type === 'none'}
                  className="p-1 rounded text-text-muted hover:text-accent hover:bg-bg-hover transition-colors disabled:opacity-30"
                  title="编辑"
                >
                  <Edit3 size={13} />
                </button>
                <button
                  onClick={() => handleDelete(selectedKey)}
                  className="p-1 rounded text-text-muted hover:text-red-400 hover:bg-bg-hover transition-colors"
                  title="删除"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>

            {/* 内容区 */}
            <div className="flex-1 overflow-auto p-3">
              {detailLoading ? (
                <div className="flex items-center justify-center h-full text-text-muted text-sm gap-2">
                  <Loader2 size={16} className="animate-spin text-accent" /> 加载中...
                </div>
              ) : !keyDetail ? (
                <div className="text-text-muted text-sm text-center mt-8">无数据</div>
              ) : editing ? (
                /* 编辑模式 */
                <div className="flex flex-col h-full gap-3">
                  <div>
                    <label className="block text-xs font-medium text-text-secondary mb-1">
                      值{keyDetail.type === 'hash' ? ' (JSON 格式)' : keyDetail.type === 'list' || keyDetail.type === 'set' ? ' (每行一个元素)' : ''}
                    </label>
                    <textarea
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      className="w-full h-64 bg-bg-secondary border border-border-light rounded p-3 text-xs font-mono text-text-primary focus:outline-none focus:border-accent resize-none"
                      placeholder="输入值..."
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-text-secondary mb-1">TTL (秒，留空为永久)</label>
                    <input
                      type="number"
                      value={editTtl}
                      onChange={(e) => setEditTtl(e.target.value)}
                      placeholder="留空为永久"
                      className="w-40 bg-bg-secondary border border-border-light rounded px-2 py-1.5 text-xs text-text-primary focus:outline-none focus:border-accent"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleSave}
                      disabled={saving}
                      className="flex items-center gap-1 px-3 py-1.5 bg-green-600 hover:bg-green-500 text-white rounded text-xs font-medium transition-colors disabled:opacity-50"
                    >
                      {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                      保存
                    </button>
                    <button
                      onClick={() => setEditing(false)}
                      className="px-3 py-1.5 border border-border-light rounded text-xs text-text-secondary hover:bg-bg-hover transition-colors"
                    >
                      取消
                    </button>
                  </div>
                </div>
              ) : (
                /* 查看模式 */
                <div>
                  {keyDetail.members && keyDetail.members.length > 0 ? (
                    /* Hash/List/Set/Zset 成员表 */
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-bg-secondary">
                        <tr>
                          <th className="px-2 py-1.5 text-left text-text-muted border-b border-border-light w-32">
                            {keyDetail.type === 'hash' ? '字段' : keyDetail.type === 'zset' ? '分数' : '索引'}
                          </th>
                          <th className="px-2 py-1.5 text-left text-text-muted border-b border-border-light">值</th>
                        </tr>
                      </thead>
                      <tbody>
                        {keyDetail.members.map((m, i) => (
                          <tr key={i} className="border-b border-border-light/30 hover:bg-bg-hover">
                            <td className="px-2 py-1.5 font-mono text-accent">{m.field || i}</td>
                            <td className="px-2 py-1.5 font-mono text-text-primary break-all">{m.value}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    /* String 值 */
                    <pre className="text-xs font-mono text-text-primary whitespace-pre-wrap break-words">{keyDetail.value}</pre>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 新建 Key 弹窗 */}
      {newKeyModal && (
        <NewKeyModal
          config={config}
          onClose={() => setNewKeyModal(false)}
          onCreated={(keyName) => {
            setNewKeyModal(false)
            loadKeys(searchPattern)
            viewKey(keyName)
          }}
        />
      )}
    </div>
  )
}

// ==================== 新建 Key 弹窗 ====================
function NewKeyModal({ config, onClose, onCreated }: {
  config: ConnectionConfig
  onClose: () => void
  onCreated: (keyName: string) => void
}) {
  const [keyName, setKeyName] = useState('')
  const [keyType, setKeyType] = useState<RedisKeyType>('string')
  const [value, setValue] = useState('')
  const [ttl, setTtl] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleCreate = async () => {
    if (!keyName.trim()) { setError('请输入 key 名称'); return }
    setCreating(true)
    setError(null)
    try {
      const ttlNum = ttl.trim() ? parseInt(ttl) : undefined
      const res = await window.api.redis.setKey(config, keyName, keyType, value, ttlNum)
      if (!res.success) throw new Error(res.error)
      onCreated(keyName)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="bg-bg-secondary border border-border rounded-lg shadow-2xl w-96 flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-light">
          <span className="text-sm font-semibold text-text-primary">新建 Key</span>
          <button onClick={onClose} className="p-1 hover:bg-bg-hover rounded text-text-muted">
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">Key 名称 <span className="text-red-400">*</span></label>
            <input
              type="text"
              value={keyName}
              onChange={(e) => setKeyName(e.target.value)}
              placeholder="例如：user:1001"
              className="w-full px-2 py-1.5 bg-bg-primary border border-border-light rounded text-xs text-text-primary focus:outline-none focus:border-accent"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">类型</label>
            <select
              value={keyType}
              onChange={(e) => setKeyType(e.target.value as RedisKeyType)}
              className="w-full px-2 py-1.5 bg-bg-primary border border-border-light rounded text-xs text-text-primary focus:outline-none focus:border-accent"
            >
              <option value="string">String</option>
              <option value="hash">Hash (JSON)</option>
              <option value="list">List (每行一个)</option>
              <option value="set">Set (每行一个)</option>
              <option value="zset">Sorted Set (member:score)</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">
              值{keyType === 'hash' ? ' (JSON)' : keyType === 'list' || keyType === 'set' ? ' (每行一个)' : ''}
            </label>
            <textarea
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="w-full h-32 bg-bg-primary border border-border-light rounded p-2 text-xs font-mono text-text-primary focus:outline-none focus:border-accent resize-none"
              placeholder={
                keyType === 'hash' ? '{"field": "value"}' :
                keyType === 'zset' ? 'member:score\nmember2:score2' :
                '输入值...'
              }
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">TTL (秒，留空为永久)</label>
            <input
              type="number"
              value={ttl}
              onChange={(e) => setTtl(e.target.value)}
              placeholder="留空为永久"
              className="w-full px-2 py-1.5 bg-bg-primary border border-border-light rounded text-xs text-text-primary focus:outline-none focus:border-accent"
            />
          </div>
          {error && (
            <div className="text-xs text-red-400 flex items-center gap-1">
              <AlertCircle size={12} /> {error}
            </div>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border-light">
          <button onClick={onClose} className="px-3 py-1.5 text-xs border border-border-light rounded hover:bg-bg-hover transition-colors">取消</button>
          <button
            onClick={handleCreate}
            disabled={creating}
            className="flex items-center gap-1 px-3 py-1.5 bg-accent hover:bg-accent/80 text-white rounded text-xs font-medium transition-colors disabled:opacity-50"
          >
            {creating ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
            创建
          </button>
        </div>
      </div>
    </div>
  )
}
