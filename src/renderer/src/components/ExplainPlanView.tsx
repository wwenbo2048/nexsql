import { useMemo } from 'react'
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Info
} from 'lucide-react'

interface ExplainRow {
  id: number | null
  select_type: string
  table: string
  partitions: string | null
  type: string
  possible_keys: string | null
  key: string | null
  key_len: string | null
  ref: string | null
  rows: number | null
  filtered: number | null
  Extra: string
}

interface Props {
  rows: Record<string, unknown>[]
  columns: { name: string; type: string; nullable: boolean }[]
  /** 是否包含 TREE 格式的文本输出 */
  treeText?: string
}

/** type 列的颜色映射 */
const TYPE_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  system:   { bg: 'bg-purple-900/40', text: 'text-purple-300', label: '系统表' },
  const:    { bg: 'bg-green-900/40',  text: 'text-green-300',  label: '常量' },
  eq_ref:   { bg: 'bg-green-900/40',  text: 'text-green-300',  label: '唯一索引' },
  ref:      { bg: 'bg-blue-900/40',   text: 'text-blue-300',   label: '普通索引' },
  fulltext: { bg: 'bg-blue-900/40',   text: 'text-blue-300',   label: '全文索引' },
  range:    { bg: 'bg-yellow-900/40', text: 'text-yellow-300', label: '范围' },
  index:    { bg: 'bg-orange-900/40', text: 'text-orange-300', label: '索引扫描' },
  ALL:      { bg: 'bg-red-900/40',    text: 'text-red-300',    label: '全表扫描' }
}

function getTypeColor(type: string): { bg: string; text: string } {
  return TYPE_COLORS[type] ?? { bg: 'bg-bg-primary', text: 'text-text-secondary' }
}

/** 检测 Extra 中的警告信号 */
function getExtraWarnings(extra: string): { level: 'good' | 'warn' | 'bad'; items: string[] } {
  if (!extra) return { level: 'good', items: [] }
  const items: string[] = []
  let level: 'good' | 'warn' | 'bad' = 'good'

  if (extra.includes('Using filesort')) { items.push('filesort'); level = 'warn' }
  if (extra.includes('Using temporary')) { items.push('临时表'); level = 'bad' }
  if (extra.includes('Using where')) { items.push('WHERE 过滤') }
  if (extra.includes('Using index')) { items.push('覆盖索引'); level = 'good' }
  if (extra.includes('Using index condition')) { items.push('ICP') }
  if (extra.includes('Using join buffer')) { items.push('join buffer'); level = 'warn' }

  return { level, items }
}

export default function ExplainPlanView({ rows, columns, treeText }: Props) {
  const explainRows = useMemo<ExplainRow[]>(() => {
    return rows.map((r) => ({
      id: r.id as number | null,
      select_type: String(r.select_type ?? ''),
      table: String(r.table ?? ''),
      partitions: r.partitions as string | null,
      type: String(r.type ?? ''),
      possible_keys: r.possible_keys as string | null,
      key: r.key as string | null,
      key_len: r.key_len as string | null,
      ref: r.ref as string | null,
      rows: r.rows as number | null,
      filtered: r.filtered as number | null,
      Extra: String(r.Extra ?? '')
    }))
  }, [rows])

  // 总体评估
  const summary = useMemo(() => {
    let hasFullScan = false
    let hasTempTable = false
    let hasFilesort = false
    let totalRows = 0
    let usedIndex = 0

    for (const r of explainRows) {
      if (r.type === 'ALL') hasFullScan = true
      if (r.Extra?.includes('Using temporary')) hasTempTable = true
      if (r.Extra?.includes('Using filesort')) hasFilesort = true
      totalRows += r.rows ?? 0
      if (r.key) usedIndex++
    }

    const score = hasFullScan ? 2 : hasTempTable ? 2 : hasFilesort ? 1 : 0
    return { hasFullScan, hasTempTable, hasFilesort, totalRows, usedIndex, score, count: explainRows.length }
  }, [explainRows])

  // TREE 格式输出
  if (treeText) {
    return (
      <div className="h-full overflow-auto p-3">
        <div className="flex items-center gap-2 mb-3">
          <Activity size={14} className="text-accent" />
          <span className="text-xs font-medium text-text-primary">执行计划 (TREE)</span>
        </div>
        <pre className="text-xs font-mono whitespace-pre-wrap text-text-primary leading-relaxed bg-bg-secondary rounded p-3 border border-border-light">
          {treeText}
        </pre>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* 总体评估 */}
      <div className="flex items-center gap-3 px-3 py-1.5 border-b border-border-light bg-bg-secondary flex-shrink-0">
        <Activity size={14} className="text-accent" />
        <span className="text-xs font-medium text-text-primary">执行计划</span>
        <span className="text-[10px] text-text-muted">{summary.count} 步骤 · 预估扫描 {summary.totalRows.toLocaleString()} 行</span>

        <div className="ml-auto flex items-center gap-2">
          {summary.score === 0 && (
            <span className="flex items-center gap-1 text-[10px] text-green-400 bg-green-950/40 px-2 py-0.5 rounded">
              <CheckCircle2 size={10} /> 高效
            </span>
          )}
          {summary.score === 1 && (
            <span className="flex items-center gap-1 text-[10px] text-yellow-400 bg-yellow-950/40 px-2 py-0.5 rounded">
              <Info size={10} /> 一般
            </span>
          )}
          {summary.score >= 2 && (
            <span className="flex items-center gap-1 text-[10px] text-red-400 bg-red-950/40 px-2 py-0.5 rounded">
              <AlertTriangle size={10} /> 低效
            </span>
          )}
          {summary.hasFullScan && (
            <span className="text-[10px] text-red-400 bg-red-950/40 px-2 py-0.5 rounded">全表扫描</span>
          )}
          {summary.hasTempTable && (
            <span className="text-[10px] text-red-400 bg-red-950/40 px-2 py-0.5 rounded">临时表</span>
          )}
          {summary.hasFilesort && (
            <span className="text-[10px] text-yellow-400 bg-yellow-950/40 px-2 py-0.5 rounded">filesort</span>
          )}
        </div>
      </div>

      {/* 执行计划表格 */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs font-mono">
          <thead className="sticky top-0 bg-bg-tertiary z-10">
            <tr>
              <th className="px-2 py-1.5 text-left text-text-muted border-b border-border-light w-8">#</th>
              <th className="px-2 py-1.5 text-left text-text-muted border-b border-border-light">SELECT</th>
              <th className="px-2 py-1.5 text-left text-text-muted border-b border-border-light">表</th>
              <th className="px-2 py-1.5 text-left text-text-muted border-b border-border-light">访问类型</th>
              <th className="px-2 py-1.5 text-left text-text-muted border-b border-border-light">索引</th>
              <th className="px-2 py-1.5 text-right text-text-muted border-b border-border-light">预估行数</th>
              <th className="px-2 py-1.5 text-right text-text-muted border-b border-border-light">过滤%</th>
              <th className="px-2 py-1.5 text-left text-text-muted border-b border-border-light">附加信息</th>
            </tr>
          </thead>
          <tbody>
            {explainRows.map((r, idx) => {
              const typeColor = getTypeColor(r.type)
              const extraInfo = getExtraWarnings(r.Extra)
              return (
                <tr key={idx} className="hover:bg-bg-hover border-b border-border-light/30">
                  <td className="px-2 py-1.5 text-text-muted">{r.id ?? idx + 1}</td>
                  <td className="px-2 py-1.5">
                    <span className="text-[10px] px-1.5 py-0.5 bg-bg-primary rounded text-text-secondary">
                      {r.select_type}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-text-primary font-medium">{r.table}</td>
                  <td className="px-2 py-1.5">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${typeColor.bg} ${typeColor.text}`} title={TYPE_COLORS[r.type]?.label}>
                      {r.type}
                    </span>
                  </td>
                  <td className="px-2 py-1.5">
                    {r.key ? (
                      <span className="text-accent">{r.key}</span>
                    ) : (
                      <span className="text-red-400 italic text-[10px]">无</span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-right text-text-secondary">
                    {r.rows !== null ? r.rows.toLocaleString() : '-'}
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    {r.filtered !== null ? (
                      <span className={r.filtered >= 80 ? 'text-green-400' : r.filtered >= 30 ? 'text-yellow-400' : 'text-red-400'}>
                        {r.filtered.toFixed(1)}%
                      </span>
                    ) : '-'}
                  </td>
                  <td className="px-2 py-1.5">
                    <div className="flex items-center gap-1 flex-wrap">
                      {extraInfo.items.map((item, i) => (
                        <span
                          key={i}
                          className={`text-[9px] px-1 py-0.5 rounded ${
                            item === '覆盖索引' ? 'bg-green-950/40 text-green-400' :
                            item === '临时表' ? 'bg-red-950/40 text-red-400' :
                            item === 'filesort' ? 'bg-yellow-950/40 text-yellow-400' :
                            item === 'join buffer' ? 'bg-orange-950/40 text-orange-400' :
                            'bg-bg-primary text-text-muted'
                          }`}
                        >
                          {item}
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* 图例 */}
      <div className="flex items-center gap-2 px-3 py-1 border-t border-border-light bg-bg-secondary text-[9px] text-text-muted flex-shrink-0">
        <span className="font-medium">访问类型:</span>
        {Object.entries(TYPE_COLORS).map(([key, val]) => (
          <span key={key} className={`${val.text} ${val.bg} px-1 py-0.5 rounded`}>
            {key}
          </span>
        ))}
      </div>
    </div>
  )
}
