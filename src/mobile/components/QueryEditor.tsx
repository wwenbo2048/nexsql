import { useState, useRef } from 'react'
import type { MobileConnection } from '../api'
import { executeQuery } from '../api'
import type { QueryResult } from '../api'

interface Props {
  connection: MobileConnection
  database: string | null
  onBack: () => void
}

export default function QueryEditor({ connection, database, onBack }: Props) {
  const [sql, setSql] = useState('')
  const [result, setResult] = useState<QueryResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handleExecute = async () => {
    const trimmed = sql.trim()
    if (!trimmed) return

    setLoading(true)
    setError(null)
    setResult(null)

    const res = await executeQuery(connection.id, trimmed, database || undefined)
    setLoading(false)

    if (res.success && res.data) {
      setResult(res.data)
    } else {
      setError(res.error ?? '执行失败')
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* 工具栏：执行按钮 */}
      <div className="flex items-center justify-end px-3 py-2 border-b border-border-light bg-bg-secondary">
        <button
          onClick={handleExecute}
          disabled={loading || !sql.trim()}
          className="flex items-center gap-1 px-3 py-1.5 bg-accent text-white text-xs rounded-lg disabled:opacity-40"
        >
          {loading ? (
            <>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin">
                <path d="M21 12a9 9 0 1 1-6.2-8.5" />
              </svg>
              执行中
            </>
          ) : (
            <>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
              执行
            </>
          )}
        </button>
      </div>

      {/* SQL 输入区 */}
      <div className="border-b border-border-light">
        <textarea
          ref={textareaRef}
          value={sql}
          onChange={(e) => setSql(e.target.value)}
          placeholder="输入 SQL 语句..."
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          className="w-full h-32 px-3 py-2 bg-bg-primary text-xs text-text-primary font-mono resize-none focus:outline-none placeholder:text-text-muted"
        />
        {/* 快捷输入 */}
        <div className="flex items-center gap-1.5 px-3 pb-2 overflow-x-auto">
          <QuickSql label="SELECT *" onClick={() => setSql(`SELECT * FROM table_name LIMIT 100;\n`)} />
          <QuickSql label="SHOW TABLES" onClick={() => setSql('SHOW TABLES;')} />
          <QuickSql label="SHOW STATUS" onClick={() => setSql('SHOW GLOBAL STATUS;')} />
        </div>
      </div>

      {/* 结果区 */}
      <div className="flex-1 overflow-y-auto">
        {error ? (
          <div className="m-3 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
            <div className="flex items-start gap-2">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" className="flex-shrink-0 mt-0.5">
                <circle cx="12" cy="12" r="10" />
                <path d="M15 9l-6 6M9 9l6 6" />
              </svg>
              <pre className="text-xs text-red-400 whitespace-pre-wrap break-all">{error}</pre>
            </div>
          </div>
        ) : result ? (
          <ResultView result={result} />
        ) : !loading && (
          <div className="flex items-center justify-center py-12 text-text-muted text-sm">
            <div className="text-center">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mx-auto mb-2 opacity-50">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
              <p className="text-xs">输入 SQL 并点击执行</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function QuickSql({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex-shrink-0 px-2.5 py-1 text-[10px] text-text-secondary bg-bg-secondary border border-border-light rounded hover:border-accent hover:text-accent transition-colors"
    >
      {label}
    </button>
  )
}

function ResultView({ result }: { result: QueryResult }) {
  if (result.rows.length === 0) {
    return (
      <div className="m-3 p-4 bg-bg-secondary rounded-lg text-center">
        <p className="text-xs text-text-secondary">
          查询执行成功
        </p>
        <p className="text-[11px] text-text-muted mt-1">
          受影响行数: {result.affectedRows} · 耗时 {result.duration}ms
        </p>
      </div>
    )
  }

  return (
    <div className="p-2">
      {/* 统计信息 */}
      <div className="flex items-center gap-3 px-1 py-2 text-[10px] text-text-muted">
        <span>{result.rows.length} 行</span>
        <span>{result.columns.length} 列</span>
        <span>{result.duration}ms</span>
      </div>

      {/* 数据表 */}
      <div className="overflow-x-auto">
        <table className="text-[11px]">
          <thead>
            <tr className="border-b border-border-light">
              {result.columns.map((col) => (
                <th key={col.name} className="text-left px-2 py-1.5 text-text-muted font-medium whitespace-nowrap">
                  {col.name}
                  <span className="text-text-muted/50 ml-1">{col.type}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row, i) => (
              <tr key={i} className="border-b border-border-light/30">
                {result.columns.map((col) => (
                  <td key={col.name} className="px-2 py-1.5 text-text-secondary whitespace-nowrap max-w-[180px] truncate">
                    {row[col.name] === null ? (
                      <span className="text-text-muted italic">NULL</span>
                    ) : (
                      String(row[col.name])
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
