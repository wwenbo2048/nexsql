import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Loader2,
  AlertCircle,
  ArrowLeftRight,
  Check,
  Plus,
  Minus,
  RefreshCw,
  Copy,
  CheckCircle2,
  XCircle
} from 'lucide-react'
import { useConnectionStore } from '@stores/connection'
import type { ConnectionConfig, ColumnInfo } from '@shared/types'

interface Props {
  leftConfig: ConnectionConfig
  leftDatabase: string
  leftTable: string
  onClose: () => void
}

interface TableOption {
  configId: string
  configName: string
  database: string
  table: string
}

interface ColumnDiff {
  name: string
  leftCol: ColumnInfo | null
  rightCol: ColumnInfo | null
  status: 'same' | 'different' | 'left-only' | 'right-only'
  differences: string[]
}

export default function TableCompareView({ leftConfig, leftDatabase, leftTable, onClose }: Props) {
  const connections = useConnectionStore((s) => s.connections)

  const [rightConfigId, setRightConfigId] = useState(leftConfig.id)
  const [rightDatabase, setRightDatabase] = useState(leftDatabase)
  const [rightTable, setRightTable] = useState('')
  const [rightTables, setRightTables] = useState<string[]>([])
  const [rightDatabases, setRightDatabases] = useState<string[]>([])

  const [leftColumns, setLeftColumns] = useState<ColumnInfo[]>([])
  const [rightColumns, setRightColumns] = useState<ColumnInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [compared, setCompared] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const rightConfig = connections.find((c) => c.id === rightConfigId)

  // 加载数据库列表
  useEffect(() => {
    if (!rightConfig) return
    window.api.db.getDatabases(rightConfig).then((res) => {
      if (res.success && res.data) setRightDatabases(res.data.map((d) => d.name))
    })
  }, [rightConfig])

  // 加载表列表
  useEffect(() => {
    if (!rightConfig || !rightDatabase) return
    window.api.db.getTables(rightConfig, rightDatabase).then((res) => {
      if (res.success && res.data) setRightTables(res.data.filter((t) => t.type === 'table').map((t) => t.name))
    })
  }, [rightConfig, rightDatabase])

  // 对比
  const handleCompare = useCallback(async () => {
    if (!rightConfig || !rightDatabase || !rightTable) return
    setLoading(true)
    setError(null)
    setCompared(false)
    try {
      const [leftRes, rightRes] = await Promise.all([
        window.api.db.getTableColumns(leftConfig, leftDatabase, leftTable),
        window.api.db.getTableColumns(rightConfig, rightDatabase, rightTable)
      ])
      if (!leftRes.success) throw new Error(`左侧表加载失败: ${leftRes.error}`)
      if (!rightRes.success) throw new Error(`右侧表加载失败: ${rightRes.error}`)
      setLeftColumns(leftRes.data ?? [])
      setRightColumns(rightRes.data ?? [])
      setCompared(true)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [leftConfig, leftDatabase, leftTable, rightConfig, rightDatabase, rightTable])

  // 计算差异
  const diffs = useMemo<ColumnDiff[]>(() => {
    if (!compared) return []
    const leftMap = new Map(leftColumns.map((c) => [c.name, c]))
    const rightMap = new Map(rightColumns.map((c) => [c.name, c]))
    const allNames = new Set([...leftMap.keys(), ...rightMap.keys()])
    const result: ColumnDiff[] = []

    for (const name of allNames) {
      const leftCol = leftMap.get(name) ?? null
      const rightCol = rightMap.get(name) ?? null
      const differences: string[] = []

      if (!leftCol) {
        result.push({ name, leftCol, rightCol, status: 'right-only', differences: ['右侧独有'] })
      } else if (!rightCol) {
        result.push({ name, leftCol, rightCol, status: 'left-only', differences: ['左侧独有'] })
      } else {
        if (leftCol.type !== rightCol.type) differences.push(`类型: ${leftCol.type} ≠ ${rightCol.type}`)
        if (leftCol.nullable !== rightCol.nullable) differences.push(`可空: ${leftCol.nullable ? 'YES' : 'NO'} ≠ ${rightCol.nullable ? 'YES' : 'NO'}`)
        if (leftCol.isPrimaryKey !== rightCol.isPrimaryKey) differences.push(`主键: ${leftCol.isPrimaryKey} ≠ ${rightCol.isPrimaryKey}`)
        if ((leftCol.defaultValue ?? '') !== (rightCol.defaultValue ?? '')) differences.push(`默认值: ${leftCol.defaultValue ?? 'NULL'} ≠ ${rightCol.defaultValue ?? 'NULL'}`)
        if ((leftCol.extra ?? '') !== (rightCol.extra ?? '')) differences.push(`额外: ${leftCol.extra ?? ''} ≠ ${rightCol.extra ?? ''}`)

        result.push({ name, leftCol, rightCol, status: differences.length > 0 ? 'different' : 'same', differences })
      }
    }

    // 排序: different > left-only > right-only > same
    const order = { different: 0, 'left-only': 1, 'right-only': 2, same: 3 }
    result.sort((a, b) => order[a.status] - order[b.status])
    return result
  }, [compared, leftColumns, rightColumns])

  // 生成同步 SQL
  const syncSQL = useMemo(() => {
    if (!compared) return ''
    const lines: string[] = []
    lines.push(`-- 同步 ${rightDatabase}.${rightTable} → 匹配 ${leftDatabase}.${leftTable} 的结构`)
    lines.push(`ALTER TABLE \`${rightTable}\``)

    const parts: string[] = []
    for (const d of diffs) {
      if (d.status === 'right-only' && d.rightCol) {
        parts.push(`  DROP COLUMN \`${d.name}\``)
      } else if (d.status === 'left-only' && d.leftCol) {
        const nullable = d.leftCol.nullable ? 'NULL' : 'NOT NULL'
        const def = d.leftCol.defaultValue !== null ? `DEFAULT ${d.leftCol.defaultValue}` : ''
        const extra = d.leftCol.extra ?? ''
        parts.push(`  ADD COLUMN \`${d.name}\` ${d.leftCol.type} ${nullable} ${def} ${extra}`.trim())
      } else if (d.status === 'different' && d.leftCol) {
        const nullable = d.leftCol.nullable ? 'NULL' : 'NOT NULL'
        const def = d.leftCol.defaultValue !== null ? `DEFAULT ${d.leftCol.defaultValue}` : ''
        const extra = d.leftCol.extra ?? ''
        parts.push(`  MODIFY COLUMN \`${d.name}\` ${d.leftCol.type} ${nullable} ${def} ${extra}`.trim())
      }
    }

    if (parts.length === 0) return ''
    lines.push(parts.join(',\n') + ';')
    return lines.join('\n')
  }, [compared, diffs, leftDatabase, leftTable, rightDatabase, rightTable])

  const handleCopySyncSQL = useCallback(() => {
    navigator.clipboard.writeText(syncSQL)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [syncSQL])

  const diffCount = diffs.filter((d) => d.status !== 'same').length

  return (
    <div className="flex flex-col h-full bg-bg-primary">
      {/* 工具栏 */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border-light bg-bg-secondary flex-shrink-0">
        <ArrowLeftRight size={14} className="text-accent" />
        <span className="text-xs font-medium text-text-primary">表结构对比</span>
        <button onClick={onClose} className="ml-auto p-1 hover:bg-bg-hover rounded text-text-muted text-xs">
          ✕ 关闭
        </button>
      </div>

      {/* 选择器 */}
      <div className="flex items-center gap-3 px-3 py-2 border-b border-border-light bg-bg-tertiary flex-shrink-0">
        {/* 左侧 */}
        <div className="flex items-center gap-1.5 flex-1">
          <span className="text-[10px] font-medium text-blue-400 bg-blue-950/40 px-1.5 py-0.5 rounded">左</span>
          <span className="text-xs text-text-primary font-mono truncate">{leftConfig.name}.{leftDatabase}.{leftTable}</span>
        </div>

        <ArrowLeftRight size={14} className="text-text-muted flex-shrink-0" />

        {/* 右侧 */}
        <div className="flex items-center gap-1.5 flex-1">
          <span className="text-[10px] font-medium text-green-400 bg-green-950/40 px-1.5 py-0.5 rounded">右</span>
          <select
            value={rightConfigId}
            onChange={(e) => { setRightConfigId(e.target.value); setRightDatabase(''); setRightTable('') }}
            className="px-1.5 py-1 bg-bg-primary border border-border-light rounded text-[11px] text-text-primary focus:outline-none focus:border-accent flex-shrink-0"
          >
            {connections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select
            value={rightDatabase}
            onChange={(e) => { setRightDatabase(e.target.value); setRightTable('') }}
            className="px-1.5 py-1 bg-bg-primary border border-border-light rounded text-[11px] text-text-primary focus:outline-none focus:border-accent flex-shrink-0"
          >
            <option value="">数据库...</option>
            {rightDatabases.map((db) => <option key={db} value={db}>{db}</option>)}
          </select>
          <select
            value={rightTable}
            onChange={(e) => setRightTable(e.target.value)}
            className="px-1.5 py-1 bg-bg-primary border border-border-light rounded text-[11px] text-text-primary focus:outline-none focus:border-accent flex-1 min-w-0"
          >
            <option value="">表...</option>
            {rightTables.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>

        <button
          onClick={handleCompare}
          disabled={loading || !rightTable}
          className="flex items-center gap-1 px-3 py-1 bg-accent hover:bg-accent-hover text-white rounded text-xs font-medium transition-colors disabled:opacity-50 flex-shrink-0"
        >
          {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          对比
        </button>
      </div>

      {/* 结果区 */}
      <div className="flex-1 overflow-auto">
        {error && (
          <div className="flex items-start gap-2 p-3 text-sm text-red-400">
            <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
            <pre className="whitespace-pre-wrap font-mono text-xs">{error}</pre>
          </div>
        )}

        {!compared && !error && (
          <div className="flex flex-col items-center justify-center h-full text-text-muted text-sm gap-2">
            <ArrowLeftRight size={32} className="opacity-20" />
            <p>选择右侧表后点击「对比」</p>
          </div>
        )}

        {compared && (
          <>
            {/* 统计 */}
            <div className="flex items-center gap-3 px-3 py-1.5 border-b border-border-light text-xs">
              {diffCount === 0 ? (
                <span className="flex items-center gap-1 text-green-400">
                  <CheckCircle2 size={14} /> 两个表结构完全一致
                </span>
              ) : (
                <span className="flex items-center gap-1 text-yellow-400">
                  <XCircle size={14} /> {diffCount} 处差异
                </span>
              )}
              {syncSQL && (
                <button
                  onClick={handleCopySyncSQL}
                  className="ml-auto flex items-center gap-1 px-2 py-0.5 rounded text-[11px] text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors"
                >
                  {copied ? <Check size={11} className="text-green-400" /> : <Copy size={11} />}
                  {copied ? '已复制' : '复制同步 SQL'}
                </button>
              )}
            </div>

            {/* 差异表格 */}
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-bg-tertiary z-10">
                <tr>
                  <th className="px-2 py-1.5 text-left text-text-muted border-b border-border-light w-8">状态</th>
                  <th className="px-2 py-1.5 text-left text-text-muted border-b border-border-light">字段名</th>
                  <th className="px-2 py-1.5 text-left text-blue-400 border-b border-border-light">左侧类型</th>
                  <th className="px-2 py-1.5 text-left text-blue-400 border-b border-border-light">左侧可空</th>
                  <th className="px-2 py-1.5 text-left text-blue-400 border-b border-border-light">左侧默认值</th>
                  <th className="px-2 py-1.5 text-left text-green-400 border-b border-border-light">右侧类型</th>
                  <th className="px-2 py-1.5 text-left text-green-400 border-b border-border-light">右侧可空</th>
                  <th className="px-2 py-1.5 text-left text-green-400 border-b border-border-light">右侧默认值</th>
                  <th className="px-2 py-1.5 text-left text-text-muted border-b border-border-light">差异</th>
                </tr>
              </thead>
              <tbody>
                {diffs.map((d) => {
                  const bgClass =
                    d.status === 'same' ? '' :
                    d.status === 'different' ? 'bg-yellow-950/20' :
                    d.status === 'left-only' ? 'bg-blue-950/20' :
                    'bg-green-950/20'

                  return (
                    <tr key={d.name} className={`border-b border-border-light/30 ${bgClass}`}>
                      <td className="px-2 py-1.5">
                        {d.status === 'same' && <Check size={12} className="text-green-400" />}
                        {d.status === 'different' && <ArrowLeftRight size={12} className="text-yellow-400" />}
                        {d.status === 'left-only' && <Minus size={12} className="text-blue-400" />}
                        {d.status === 'right-only' && <Plus size={12} className="text-green-400" />}
                      </td>
                      <td className="px-2 py-1.5 font-mono text-text-primary font-medium">{d.name}</td>
                      <td className="px-2 py-1.5 font-mono text-text-secondary">{d.leftCol?.type ?? '-'}</td>
                      <td className="px-2 py-1.5 text-text-secondary">{d.leftCol ? (d.leftCol.nullable ? 'YES' : 'NO') : '-'}</td>
                      <td className="px-2 py-1.5 font-mono text-text-secondary">{d.leftCol?.defaultValue ?? '-'}</td>
                      <td className="px-2 py-1.5 font-mono text-text-secondary">{d.rightCol?.type ?? '-'}</td>
                      <td className="px-2 py-1.5 text-text-secondary">{d.rightCol ? (d.rightCol.nullable ? 'YES' : 'NO') : '-'}</td>
                      <td className="px-2 py-1.5 font-mono text-text-secondary">{d.rightCol?.defaultValue ?? '-'}</td>
                      <td className="px-2 py-1.5">
                        <div className="flex flex-wrap gap-0.5">
                          {d.differences.map((diff, i) => (
                            <span key={i} className="text-[9px] px-1 py-0.5 bg-red-950/40 text-red-300 rounded">{diff}</span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>

            {/* 同步 SQL 预览 */}
            {syncSQL && (
              <div className="border-t border-border-light mt-2">
                <div className="px-3 py-1.5 bg-bg-secondary text-[10px] text-text-muted font-medium">同步 SQL (使右侧表匹配左侧)</div>
                <pre className="px-3 py-2 text-xs font-mono text-text-primary whitespace-pre-wrap leading-relaxed bg-bg-tertiary/50">
                  {syncSQL}
                </pre>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
