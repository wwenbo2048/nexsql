import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import {
  Loader2, AlertCircle, ArrowLeftRight, Check, Plus, Minus, RefreshCw,
  CheckCircle2, XCircle, Database, ChevronRight, ChevronDown, Play, X, Copy
} from 'lucide-react'
import { useConnectionStore } from '@stores/connection'
import type { ConnectionConfig, ColumnInfo } from '@shared/types'

interface Props {
  onClose: () => void
  initialConfig?: ConnectionConfig
  initialDatabase?: string
}

interface ColumnDiff {
  name: string
  leftCol: ColumnInfo | null
  rightCol: ColumnInfo | null
  status: 'same' | 'different' | 'left-only' | 'right-only'
  differences: string[]
}

interface TableDiff {
  name: string
  status: 'same' | 'different' | 'left-only' | 'right-only'
  columnDiffs: ColumnDiff[]
  ddl?: string // left-only 时存放源表 DDL
}

export default function DatabaseSyncView({ onClose, initialConfig, initialDatabase }: Props) {
  const connections = useConnectionStore((s) => s.connections)

  // 源（左）
  const [leftConfigId, setLeftConfigId] = useState(initialConfig?.id ?? connections[0]?.id ?? '')
  const [leftDatabase, setLeftDatabase] = useState(initialDatabase ?? '')
  const [leftDatabases, setLeftDatabases] = useState<string[]>([])

  // 目标（右）
  const [rightConfigId, setRightConfigId] = useState(connections[0]?.id ?? '')
  const [rightDatabase, setRightDatabase] = useState('')
  const [rightDatabases, setRightDatabases] = useState<string[]>([])

  const [loading, setLoading] = useState(false)
  const [compared, setCompared] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tableDiffs, setTableDiffs] = useState<TableDiff[]>([])
  const [expandedTable, setExpandedTable] = useState<string | null>(null)
  const [executing, setExecuting] = useState(false)
  const [execResult, setExecResult] = useState<{ success: number; failed: string[] } | null>(null)
  const [copied, setCopied] = useState(false)

  const leftConfig = connections.find((c) => c.id === leftConfigId)
  const rightConfig = connections.find((c) => c.id === rightConfigId)

  // 加载数据库列表
  useEffect(() => {
    if (!leftConfig) return
    window.api.db.getDatabases(leftConfig).then((res) => {
      if (res.success && res.data) setLeftDatabases(res.data.map((d) => d.name))
    })
  }, [leftConfig])

  useEffect(() => {
    if (!rightConfig) return
    window.api.db.getDatabases(rightConfig).then((res) => {
      if (res.success && res.data) setRightDatabases(res.data.map((d) => d.name))
    })
  }, [rightConfig])

  const handleCompare = useCallback(async () => {
    if (!leftConfig || !rightConfig || !leftDatabase || !rightDatabase) return
    setLoading(true)
    setError(null)
    setCompared(false)
    setExecResult(null)
    try {
      const [leftTablesRes, rightTablesRes] = await Promise.all([
        window.api.db.getTables(leftConfig, leftDatabase),
        window.api.db.getTables(rightConfig, rightDatabase)
      ])
      if (!leftTablesRes.success) throw new Error(`源数据库加载失败: ${leftTablesRes.error}`)
      if (!rightTablesRes.success) throw new Error(`目标数据库加载失败: ${rightTablesRes.error}`)

      const leftTableNames = leftTablesRes.data!.filter((t) => t.type === 'table').map((t) => t.name)
      const rightTableNames = rightTablesRes.data!.filter((t) => t.type === 'table').map((t) => t.name)
      const allTableNames = [...new Set([...leftTableNames, ...rightTableNames])].sort()

      const results: TableDiff[] = []
      for (const tableName of allTableNames) {
        const inLeft = leftTableNames.includes(tableName)
        const inRight = rightTableNames.includes(tableName)

        if (inLeft && !inRight) {
          // 源有目标没有 → 需要 CREATE
          const ddlRes = await window.api.db.getTableDDL(leftConfig, leftDatabase, tableName)
          results.push({ name: tableName, status: 'left-only', columnDiffs: [], ddl: ddlRes.success ? ddlRes.data : '' })
        } else if (!inLeft && inRight) {
          // 目标有源没有 → 可以 DROP
          results.push({ name: tableName, status: 'right-only', columnDiffs: [] })
        } else {
          // 两边都有 → 比较列
          const [leftColRes, rightColRes] = await Promise.all([
            window.api.db.getTableColumns(leftConfig, leftDatabase, tableName),
            window.api.db.getTableColumns(rightConfig, rightDatabase, tableName)
          ])
          const leftCols = leftColRes.success ? leftColRes.data! : []
          const rightCols = rightColRes.success ? rightColRes.data! : []
          const colDiffs = compareColumns(leftCols, rightCols)
          const hasDiff = colDiffs.some((d) => d.status !== 'same')
          results.push({ name: tableName, status: hasDiff ? 'different' : 'same', columnDiffs: colDiffs })
        }
      }

      setTableDiffs(results)
      setCompared(true)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [leftConfig, rightConfig, leftDatabase, rightDatabase])

  // 生成同步 SQL（目标匹配源）
  const syncSQL = useMemo(() => {
    if (!compared) return ''
    const lines: string[] = []
    lines.push(`-- 数据库同步: ${leftConfig?.name}.${leftDatabase} → ${rightConfig?.name}.${rightDatabase}`)
    lines.push(`-- 生成时间: ${new Date().toISOString()}`)
    lines.push('SET FOREIGN_KEY_CHECKS = 0;')
    lines.push('')

    for (const td of tableDiffs) {
      if (td.status === 'same') continue

      if (td.status === 'left-only' && td.ddl) {
        lines.push(`-- 新增表: ${td.name}`)
        lines.push(`DROP TABLE IF EXISTS \`${td.name}\`;`)
        lines.push(td.ddl + ';')
        lines.push('')
      } else if (td.status === 'right-only') {
        lines.push(`-- 删除多余表: ${td.name}`)
        lines.push(`DROP TABLE IF EXISTS \`${td.name}\`;`)
        lines.push('')
      } else if (td.status === 'different') {
        const parts: string[] = []
        for (const d of td.columnDiffs) {
          if (d.status === 'right-only' && d.rightCol) {
            parts.push(`  DROP COLUMN \`${d.name}\``)
          } else if (d.status === 'left-only' && d.leftCol) {
            parts.push(`  ADD COLUMN ${colToDef(d.leftCol)}`)
          } else if (d.status === 'different' && d.leftCol) {
            parts.push(`  MODIFY COLUMN ${colToDef(d.leftCol)}`)
          }
        }
        if (parts.length > 0) {
          lines.push(`-- 修改表: ${td.name}`)
          lines.push(`ALTER TABLE \`${td.name}\``)
          lines.push(parts.join(',\n') + ';')
          lines.push('')
        }
      }
    }

    lines.push('SET FOREIGN_KEY_CHECKS = 1;')
    return lines.join('\n')
  }, [compared, tableDiffs, leftConfig, leftDatabase, rightConfig, rightDatabase])

  const diffCount = tableDiffs.filter((d) => d.status !== 'same').length

  const handleExecute = useCallback(async () => {
    if (!rightConfig || !rightDatabase || !syncSQL) return
    if (!confirm(`确定要将 "${leftDatabase}" 的结构同步到 "${rightDatabase}" 吗？\n目标数据库将被修改，此操作不可恢复！`)) return

    setExecuting(true)
    setExecResult(null)
    const failed: string[] = []
    let success = 0

    try {
      for (const td of tableDiffs) {
        if (td.status === 'same') continue

        let sql = ''
        if (td.status === 'left-only' && td.ddl) {
          sql = `DROP TABLE IF EXISTS \`${td.name}\`;`
          let res = await window.api.db.query(rightConfig, sql, rightDatabase)
          if (res.success) { success++ } else { failed.push(`${td.name}: ${res.error}`) }

          sql = td.ddl
          res = await window.api.db.query(rightConfig, sql, rightDatabase)
          if (res.success) { success++ } else { failed.push(`${td.name}: ${res.error}`) }
        } else if (td.status === 'right-only') {
          sql = `DROP TABLE IF EXISTS \`${td.name}\``
          const res = await window.api.db.query(rightConfig, sql, rightDatabase)
          if (res.success) { success++ } else { failed.push(`${td.name}: ${res.error}`) }
        } else if (td.status === 'different') {
          const parts: string[] = []
          for (const d of td.columnDiffs) {
            if (d.status === 'right-only' && d.rightCol) {
              parts.push(`  DROP COLUMN \`${d.name}\``)
            } else if (d.status === 'left-only' && d.leftCol) {
              parts.push(`  ADD COLUMN ${colToDef(d.leftCol)}`)
            } else if (d.status === 'different' && d.leftCol) {
              parts.push(`  MODIFY COLUMN ${colToDef(d.leftCol)}`)
            }
          }
          if (parts.length > 0) {
            sql = `ALTER TABLE \`${td.name}\`\n${parts.join(',\n')}`
            const res = await window.api.db.query(rightConfig, sql, rightDatabase)
            if (res.success) { success++ } else { failed.push(`${td.name}: ${res.error}`) }
          }
        }
      }
      setExecResult({ success, failed })
    } catch (err) {
      setExecResult({ success, failed: [...failed, (err as Error).message] })
    } finally {
      setExecuting(false)
    }
  }, [rightConfig, rightDatabase, syncSQL, tableDiffs, leftDatabase])

  const handleCopySQL = useCallback(() => {
    navigator.clipboard.writeText(syncSQL)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [syncSQL])

  const sel = "px-1.5 py-1 bg-bg-primary border border-border-light rounded text-[11px] text-text-primary focus:outline-none focus:border-accent"

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="bg-bg-secondary border border-border rounded-lg shadow-2xl w-[90vw] h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        {/* 标题栏 */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border-light flex-shrink-0">
          <ArrowLeftRight size={16} className="text-accent" />
          <span className="text-sm font-semibold text-text-primary">数据库结构同步</span>
          <button onClick={onClose} className="ml-auto p-1 hover:bg-bg-hover rounded text-text-muted">
            <X size={16} />
          </button>
        </div>

        {/* 配置区 */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border-light bg-bg-tertiary flex-shrink-0">
          {/* 源 */}
          <div className="flex items-center gap-1.5 flex-1">
            <span className="text-[10px] font-bold text-blue-400 bg-blue-950/40 px-2 py-0.5 rounded">源（参考）</span>
            <select value={leftConfigId} onChange={(e) => { setLeftConfigId(e.target.value); setLeftDatabase('') }} className={sel}>
              {connections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select value={leftDatabase} onChange={(e) => setLeftDatabase(e.target.value)} className={sel}>
              <option value="">数据库...</option>
              {leftDatabases.map((db) => <option key={db} value={db}>{db}</option>)}
            </select>
          </div>

          <ArrowLeftRight size={16} className="text-accent flex-shrink-0" />

          {/* 目标 */}
          <div className="flex items-center gap-1.5 flex-1">
            <span className="text-[10px] font-bold text-orange-400 bg-orange-950/40 px-2 py-0.5 rounded">目标（被修改）</span>
            <select value={rightConfigId} onChange={(e) => { setRightConfigId(e.target.value); setRightDatabase('') }} className={sel}>
              {connections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select value={rightDatabase} onChange={(e) => setRightDatabase(e.target.value)} className={sel}>
              <option value="">数据库...</option>
              {rightDatabases.map((db) => <option key={db} value={db}>{db}</option>)}
            </select>
          </div>

          <button
            onClick={handleCompare}
            disabled={loading || !leftDatabase || !rightDatabase || leftDatabase === rightDatabase && leftConfigId === rightConfigId}
            className="flex items-center gap-1 px-3 py-1.5 bg-accent hover:bg-accent/80 text-white rounded text-xs font-medium transition-colors disabled:opacity-40 flex-shrink-0"
          >
            {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            {loading ? '比较中...' : '开始比较'}
          </button>
        </div>

        {/* 内容区 */}
        <div className="flex-1 min-h-0 overflow-hidden flex">
          {/* 左侧：差异列表 */}
          <div className={`${syncSQL && compared ? 'w-1/2' : 'w-full'} overflow-auto border-r border-border-light`}>
            {error && (
              <div className="flex items-start gap-2 p-4 text-sm text-red-400">
                <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
                <pre className="whitespace-pre-wrap font-mono text-xs">{error}</pre>
              </div>
            )}

            {!compared && !error && (
              <div className="flex flex-col items-center justify-center h-full text-text-muted text-sm gap-3">
                <Database size={48} className="opacity-20" />
                <p>选择源数据库和目标数据库后点击「开始比较」</p>
                <p className="text-xs text-text-muted">同步将修改目标数据库以匹配源数据库的结构</p>
              </div>
            )}

            {compared && (
              <>
                {/* 统计栏 */}
                <div className="flex items-center gap-3 px-3 py-2 border-b border-border-light text-xs bg-bg-tertiary sticky top-0 z-10">
                  {diffCount === 0 ? (
                    <span className="flex items-center gap-1 text-green-400">
                      <CheckCircle2 size={14} /> 两个数据库结构完全一致
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-yellow-400">
                      <XCircle size={14} /> {diffCount} 个表有差异
                    </span>
                  )}
                  <div className="ml-auto flex items-center gap-3 text-[10px] text-text-muted">
                    <span className="flex items-center gap-0.5"><Plus size={10} className="text-blue-400" />新增: {tableDiffs.filter((d) => d.status === 'left-only').length}</span>
                    <span className="flex items-center gap-0.5"><ArrowLeftRight size={10} className="text-yellow-400" />修改: {tableDiffs.filter((d) => d.status === 'different').length}</span>
                    <span className="flex items-center gap-0.5"><Minus size={10} className="text-red-400" />删除: {tableDiffs.filter((d) => d.status === 'right-only').length}</span>
                    <span className="flex items-center gap-0.5"><Check size={10} className="text-green-400" />一致: {tableDiffs.filter((d) => d.status === 'same').length}</span>
                  </div>
                </div>

                {/* 差异列表 */}
                {tableDiffs.map((td) => (
                  <div key={td.name} className="border-b border-border-light/30">
                    {/* 表级行 */}
                    <div
                      className="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-bg-hover"
                      onClick={() => setExpandedTable(expandedTable === td.name ? null : td.name)}
                    >
                      {td.columnDiffs.length > 0 ? (
                        expandedTable === td.name
                          ? <ChevronDown size={12} className="text-text-muted flex-shrink-0" />
                          : <ChevronRight size={12} className="text-text-muted flex-shrink-0" />
                      ) : (
                        <span className="w-3 flex-shrink-0" />
                      )}
                      <span className="text-[10px] w-6 text-center">
                        {td.status === 'same' && <Check size={12} className="text-green-400 inline" />}
                        {td.status === 'different' && <ArrowLeftRight size={12} className="text-yellow-400 inline" />}
                        {td.status === 'left-only' && <Plus size={12} className="text-blue-400 inline" />}
                        {td.status === 'right-only' && <Minus size={12} className="text-red-400 inline" />}
                      </span>
                      <span className={`font-mono text-xs font-medium ${td.status === 'same' ? 'text-text-muted' : 'text-text-primary'}`}>
                        {td.name}
                      </span>
                      <span className="ml-auto text-[9px] text-text-muted">
                        {td.status === 'left-only' && '源独有 → 建表'}
                        {td.status === 'right-only' && '目标独有 → 删表'}
                        {td.status === 'different' && `${td.columnDiffs.filter((d) => d.status !== 'same').length} 处列差异`}
                        {td.status === 'same' && '一致'}
                      </span>
                    </div>

                    {/* 展开后的列级详情 */}
                    {expandedTable === td.name && td.columnDiffs.length > 0 && (
                      <div className="pl-8 pb-2">
                        <table className="w-full text-[11px]">
                          <thead>
                            <tr className="text-text-muted">
                              <th className="px-2 py-1 text-left w-6">　</th>
                              <th className="px-2 py-1 text-left">字段</th>
                              <th className="px-2 py-1 text-left text-blue-400">源类型</th>
                              <th className="px-2 py-1 text-left text-orange-400">目标类型</th>
                              <th className="px-2 py-1 text-left">差异</th>
                            </tr>
                          </thead>
                          <tbody>
                            {td.columnDiffs.map((d) => {
                              const bgClass =
                                d.status === 'same' ? '' :
                                d.status === 'different' ? 'bg-yellow-950/20' :
                                d.status === 'left-only' ? 'bg-blue-950/20' :
                                'bg-red-950/20'
                              return (
                                <tr key={d.name} className={bgClass}>
                                  <td className="px-2 py-1">
                                    {d.status === 'different' && <ArrowLeftRight size={10} className="text-yellow-400" />}
                                    {d.status === 'left-only' && <Plus size={10} className="text-blue-400" />}
                                    {d.status === 'right-only' && <Minus size={10} className="text-red-400" />}
                                    {d.status === 'same' && <Check size={10} className="text-green-400" />}
                                  </td>
                                  <td className="px-2 py-1 font-mono text-text-primary">{d.name}</td>
                                  <td className="px-2 py-1 font-mono text-text-secondary">{d.leftCol?.type ?? '-'}</td>
                                  <td className="px-2 py-1 font-mono text-text-secondary">{d.rightCol?.type ?? '-'}</td>
                                  <td className="px-2 py-1">
                                    <div className="flex flex-wrap gap-0.5">
                                      {d.differences.map((diff, i) => (
                                        <span key={i} className="text-[8px] px-1 py-0.5 bg-red-950/40 text-red-300 rounded">{diff}</span>
                                      ))}
                                    </div>
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                ))}
              </>
            )}
          </div>

          {/* 右侧：SQL 预览 + 执行 */}
          {compared && syncSQL && (
            <div className="w-1/2 flex flex-col min-h-0">
              {/* 操作栏 */}
              <div className="flex items-center gap-2 px-3 py-2 border-b border-border-light bg-bg-tertiary flex-shrink-0">
                <span className="text-xs font-medium text-text-primary">同步 SQL</span>
                <span className="text-[10px] text-text-muted">→ {rightConfig?.name}.{rightDatabase}</span>
                <div className="ml-auto flex items-center gap-1.5">
                  <button
                    onClick={handleCopySQL}
                    className="flex items-center gap-1 px-2 py-1 rounded text-[11px] text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors"
                  >
                    {copied ? <Check size={11} className="text-green-400" /> : <Copy size={11} />}
                    {copied ? '已复制' : '复制'}
                  </button>
                  <button
                    onClick={handleExecute}
                    disabled={executing || diffCount === 0}
                    className="flex items-center gap-1 px-3 py-1 bg-green-600 hover:bg-green-500 text-white rounded text-[11px] font-medium transition-colors disabled:opacity-40"
                  >
                    {executing ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} />}
                    {executing ? '执行中...' : '执行同步'}
                  </button>
                </div>
              </div>

              {/* 执行结果 */}
              {execResult && (
                <div className={`px-3 py-2 border-b text-xs ${execResult.failed.length > 0 ? 'border-yellow-500/30 bg-yellow-950/20' : 'border-green-500/30 bg-green-950/20'}`}>
                  {execResult.failed.length === 0 ? (
                    <span className="flex items-center gap-1 text-green-400">
                      <CheckCircle2 size={14} /> 同步完成！成功执行 {execResult.success} 条语句
                    </span>
                  ) : (
                    <div>
                      <span className="flex items-center gap-1 text-yellow-400">
                        <AlertCircle size={14} /> 成功 {execResult.success} 条，失败 {execResult.failed.length} 条
                      </span>
                      <div className="mt-1 space-y-0.5">
                        {execResult.failed.map((f, i) => (
                          <div key={i} className="text-[10px] text-red-300 font-mono">{f}</div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* SQL 内容 */}
              <div className="flex-1 overflow-auto p-3 bg-bg-primary">
                <pre className="text-[11px] font-mono text-text-primary whitespace-pre leading-relaxed">{syncSQL}</pre>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ==================== 辅助函数 ====================

function compareColumns(leftCols: ColumnInfo[], rightCols: ColumnInfo[]): ColumnDiff[] {
  const leftMap = new Map(leftCols.map((c) => [c.name, c]))
  const rightMap = new Map(rightCols.map((c) => [c.name, c]))
  const allNames = new Set([...leftMap.keys(), ...rightMap.keys()])
  const result: ColumnDiff[] = []

  for (const name of allNames) {
    const leftCol = leftMap.get(name) ?? null
    const rightCol = rightMap.get(name) ?? null
    const differences: string[] = []

    if (!leftCol) {
      result.push({ name, leftCol, rightCol, status: 'right-only', differences: ['目标独有'] })
    } else if (!rightCol) {
      result.push({ name, leftCol, rightCol, status: 'left-only', differences: ['源独有'] })
    } else {
      if (leftCol.type !== rightCol.type) differences.push(`类型: ${leftCol.type} ≠ ${rightCol.type}`)
      if (leftCol.nullable !== rightCol.nullable) differences.push(`可空: ${leftCol.nullable ? 'YES' : 'NO'} ≠ ${rightCol.nullable ? 'YES' : 'NO'}`)
      if (leftCol.isPrimaryKey !== rightCol.isPrimaryKey) differences.push(`主键: ${leftCol.isPrimaryKey} ≠ ${rightCol.isPrimaryKey}`)
      if ((leftCol.defaultValue ?? '') !== (rightCol.defaultValue ?? '')) differences.push(`默认值: ${leftCol.defaultValue ?? 'NULL'} ≠ ${rightCol.defaultValue ?? 'NULL'}`)
      if ((leftCol.extra ?? '') !== (rightCol.extra ?? '')) differences.push(`额外: ${leftCol.extra ?? ''} ≠ ${rightCol.extra ?? ''}`)

      result.push({ name, leftCol, rightCol, status: differences.length > 0 ? 'different' : 'same', differences })
    }
  }

  const order = { different: 0, 'left-only': 1, 'right-only': 2, same: 3 }
  result.sort((a, b) => order[a.status] - order[b.status])
  return result
}

function colToDef(col: ColumnInfo): string {
  const nullable = col.nullable ? 'NULL' : 'NOT NULL'
  const def = col.defaultValue !== null && col.defaultValue !== undefined ? `DEFAULT ${col.defaultValue}` : ''
  const extra = col.extra ?? ''
  return `\`${col.name}\` ${col.type} ${nullable} ${def} ${extra}`.replace(/\s+/g, ' ').trim()
}

