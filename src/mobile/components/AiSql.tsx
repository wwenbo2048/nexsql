import { useState } from 'react'
import type { MobileConnection } from '../api'
import { generateSqlSSE, executeQuery } from '../api'
import type { QueryResult } from '../api'

interface Props {
  connection: MobileConnection
  database: string | null
  onBack: () => void
}

export default function AiSql({ connection, database, onBack }: Props) {
  const [prompt, setPrompt] = useState('')
  const [generatedSql, setGeneratedSql] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [executing, setExecuting] = useState(false)
  const [result, setResult] = useState<QueryResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleGenerate = async () => {
    if (!prompt.trim() || streaming) return

    setStreaming(true)
    setGeneratedSql('')
    setError(null)
    setResult(null)

    try {
      const fullSql = await generateSqlSSE(
        connection.id,
        database || undefined,
        prompt.trim(),
        undefined,
        (chunk) => {
          setGeneratedSql((prev) => prev + chunk)
        }
      )
      setGeneratedSql(fullSql)
    } catch (err) {
      setError(err instanceof Error ? err.message : '生成失败')
    } finally {
      setStreaming(false)
    }
  }

  const handleExecute = async () => {
    if (!generatedSql.trim() || executing) return

    setExecuting(true)
    setError(null)
    setResult(null)

    const res = await executeQuery(connection.id, generatedSql.trim(), database || undefined)
    setExecuting(false)

    if (res.success && res.data) {
      setResult(res.data)
    } else {
      setError(res.error ?? '执行失败')
    }
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(generatedSql)
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto">
        {/* 输入区 */}
        <div className="p-3 border-b border-border-light">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="用自然语言描述你的需求，例如：&#10;查询最近 7 天注册的用户"
            className="w-full h-24 px-3 py-2 bg-bg-secondary border border-border-light rounded-lg text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent resize-none"
            disabled={streaming}
          />
          <div className="flex items-center justify-between mt-2">
            <span className="text-[10px] text-text-muted">
              AI 会根据当前数据库表结构生成 SQL
            </span>
            <button
              onClick={handleGenerate}
              disabled={streaming || !prompt.trim()}
              className="flex items-center gap-1.5 px-4 py-2 bg-accent text-white text-xs rounded-lg disabled:opacity-40"
            >
              {streaming ? (
                <>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin">
                    <path d="M21 12a9 9 0 1 1-6.2-8.5" />
                  </svg>
                  生成中
                </>
              ) : (
                <>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 2l2 7h7l-5.5 4 2 7L12 16l-5.5 4 2-7L3 9h7z" />
                  </svg>
                  生成 SQL
                </>
              )}
            </button>
          </div>
        </div>

        {/* 生成结果 */}
        {generatedSql && (
          <div className="p-3 border-b border-border-light">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-text-secondary">生成的 SQL</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleCopy}
                  className="text-[10px] text-text-muted hover:text-accent flex items-center gap-1"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="9" y="9" width="13" height="13" rx="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </svg>
                  复制
                </button>
                <button
                  onClick={handleExecute}
                  disabled={executing || streaming}
                  className="flex items-center gap-1 px-2.5 py-1 bg-green-500/15 text-green-400 text-[10px] rounded"
                >
                  {executing ? (
                    <>
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin">
                        <path d="M21 12a9 9 0 1 1-6.2-8.5" />
                      </svg>
                      执行中
                    </>
                  ) : (
                    <>
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polygon points="5 3 19 12 5 21 5 3" />
                      </svg>
                      执行
                    </>
                  )}
                </button>
              </div>
            </div>
            <pre className="text-[11px] text-text-primary font-mono whitespace-pre-wrap break-all bg-bg-secondary p-3 rounded-lg">
              {generatedSql}
              {streaming && <span className="inline-block w-1.5 h-3 bg-accent animate-pulse ml-0.5 align-middle" />}
            </pre>
          </div>
        )}

        {/* 错误 */}
        {error && (
          <div className="m-3 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
            <pre className="text-xs text-red-400 whitespace-pre-wrap break-all">{error}</pre>
          </div>
        )}

        {/* 执行结果 */}
        {result && (
          <div className="p-2">
            <div className="flex items-center gap-3 px-1 py-2 text-[10px] text-text-muted">
              <span>{result.rows.length} 行</span>
              <span>{result.duration}ms</span>
            </div>
            {result.rows.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="text-[11px]">
                  <thead>
                    <tr className="border-b border-border-light">
                      {result.columns.map((col) => (
                        <th key={col.name} className="text-left px-2 py-1.5 text-text-muted font-medium whitespace-nowrap">
                          {col.name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.map((row, i) => (
                      <tr key={i} className="border-b border-border-light/30">
                        {result.columns.map((col) => (
                          <td key={col.name} className="px-2 py-1.5 text-text-secondary whitespace-nowrap max-w-[160px] truncate">
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
            ) : (
              <div className="text-center py-4 text-xs text-text-muted">
                受影响行数: {result.affectedRows}
              </div>
            )}
          </div>
        )}

        {/* 空状态 */}
        {!generatedSql && !error && (
          <div className="flex items-center justify-center py-12 text-text-muted">
            <div className="text-center px-8">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mx-auto mb-3 opacity-40">
                <path d="M12 2l2 7h7l-5.5 4 2 7L12 16l-5.5 4 2-7L3 9h7z" />
              </svg>
              <p className="text-xs leading-relaxed">
                用自然语言描述需求<br />
                AI 会自动生成对应的 SQL
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
