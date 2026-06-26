import { useState, useRef, useCallback, useEffect } from 'react'
import Editor from '@monaco-editor/react'
import {
  Play,
  Loader2,
  Clock,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Download,
  Trash2,
  History,
  Activity
} from 'lucide-react'
import { useConnectionStore } from '@stores/connection'
import { useUiStore } from '@stores/ui'
import { useHistoryStore } from '@stores/history'
import type { Tab, QueryResult } from '@shared/types'
import QueryHistoryPanel from './QueryHistoryPanel'
import ExplainPlanView from './ExplainPlanView'

interface Props {
  tab: Tab
}

export default function QueryEditor({ tab }: Props) {
  const [sql, setSql] = useState<string>(
    tab.database ? `-- 在 ${tab.database} 上执行查询\nSELECT * FROM \`\`\nLIMIT 100;` : '-- 输入 SQL 查询\n'
  )
  const [result, setResult] = useState<QueryResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showResult, setShowResult] = useState(true)
  const [showHistory, setShowHistory] = useState(false)
  const [showExplain, setShowExplain] = useState(false)
  const [explainData, setExplainData] = useState<{ rows: Record<string, unknown>[]; columns: { name: string; type: string; nullable: boolean }[]; treeText?: string } | null>(null)
  const [explainLoading, setExplainLoading] = useState(false)
  const editorRef = useRef<Parameters<Parameters<typeof Editor>['0']['onMount']>[0] | null>(null)
  const connections = useConnectionStore((s) => s.connections)
  const resultPanelHeight = useUiStore((s) => s.resultPanelHeight)
  const setResultPanelHeight = useUiStore((s) => s.setResultPanelHeight)
  const addHistoryEntry = useHistoryStore((s) => s.addEntry)

  const config = connections.find((c) => c.id === tab.connectionId)

  const handleExecute = useCallback(async () => {
    if (!config) return

    // 获取选中的 SQL 或全部 SQL
    let sqlToExecute = sql
    if (editorRef.current) {
      const editor = editorRef.current
      const selection = editor.getSelection()
      if (selection && !selection.isEmpty()) {
        sqlToExecute = editor.getModel()?.getValueInRange(selection) ?? sql
      }
    }

    if (!sqlToExecute.trim()) return

    setLoading(true)
    setError(null)
    setShowResult(true)

    const res = await window.api.db.query(config, sqlToExecute, tab.database)
    setLoading(false)

    // 记录查询历史
    addHistoryEntry({
      sql: sqlToExecute,
      connectionId: config.id,
      database: tab.database,
      duration: res.data?.duration ?? 0,
      rowCount: res.data?.rows.length ?? res.data?.affectedRows ?? 0,
      hasError: !res.success,
      error: res.error
    })

    if (res.success && res.data) {
      setResult(res.data)
    } else {
      setError(res.error ?? '查询失败')
      setResult(null)
    }
  }, [config, sql, tab.database, addHistoryEntry])

  const handleExplain = useCallback(async () => {
    if (!config) return
    let sqlToExplain = sql
    if (editorRef.current) {
      const editor = editorRef.current
      const selection = editor.getSelection()
      if (selection && !selection.isEmpty()) {
        sqlToExplain = editor.getModel()?.getValueInRange(selection) ?? sql
      }
    }
    if (!sqlToExplain.trim()) return

    setExplainLoading(true)
    setShowExplain(true)
    setShowResult(true)
    setExplainData(null)

    try {
      // 先尝试 TREE 格式 (MySQL 8.0.16+)
      const treeRes = await window.api.db.query(config, `EXPLAIN FORMAT=TREE ${sqlToExplain}`, tab.database)
      if (treeRes.success && treeRes.data && treeRes.data.rows.length > 0) {
        const treeText = String(treeRes.data.rows[0][Object.keys(treeRes.data.rows[0])[0]] ?? '')
        setExplainData({ rows: [], columns: [], treeText })
        setExplainLoading(false)
        return
      }

      // 回退到标准 EXPLAIN
      const res = await window.api.db.query(config, `EXPLAIN ${sqlToExplain}`, tab.database)
      if (res.success && res.data) {
        setExplainData({ rows: res.data.rows, columns: res.data.columns })
      } else {
        setError(res.error ?? 'EXPLAIN 执行失败')
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setExplainLoading(false)
    }
  }, [config, sql, tab.database])

  const handleEditorMount = useCallback((editor: Parameters<Parameters<typeof Editor>['0']['onMount']>[0]) => {
    editorRef.current = editor
    // Ctrl+Enter / Cmd+Enter 执行查询
    editor.addCommand(
      // @ts-ignore - Monaco monaco.KeyMod.CtrlCmd
      2048 | 3, // KeyMod.CtrlCmd | KeyCode.Enter
      () => handleExecute()
    )
  }, [handleExecute])

  const handleExport = useCallback(() => {
    if (!result || result.rows.length === 0) return
    const headers = result.columns.map((c) => c.name).join(',')
    const rows = result.rows
      .map((row) =>
        result.columns
          .map((c) => {
            const val = row[c.name]
            if (val === null || val === undefined) return ''
            const str = String(val)
            return str.includes(',') || str.includes('"') || str.includes('\n')
              ? `"${str.replace(/"/g, '""')}"`
              : str
          })
          .join(',')
      )
      .join('\n')
    const csv = `${headers}\n${rows}`
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `query-result-${Date.now()}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [result])

  const formatDuration = (ms: number): string => {
    if (ms < 1000) return `${Math.round(ms)}ms`
    return `${(ms / 1000).toFixed(2)}s`
  }

  // 拖拽结果面板高度
  const dragging = useRef(false)
  const onResizeStart = useCallback(() => {
    dragging.current = true
    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'
  }, [])

  const onResizeMove = useCallback(
    (e: MouseEvent) => {
      if (!dragging.current) return
      const windowHeight = window.innerHeight
      setResultPanelHeight(windowHeight - e.clientY - 30) // 减去 tab 栏高度
    },
    [setResultPanelHeight]
  )

  const onResizeEnd = useCallback(() => {
    dragging.current = false
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }, [])

  useEffect(() => {
    window.addEventListener('mousemove', onResizeMove)
    window.addEventListener('mouseup', onResizeEnd)
    return () => {
      window.removeEventListener('mousemove', onResizeMove)
      window.removeEventListener('mouseup', onResizeEnd)
    }
  }, [onResizeMove, onResizeEnd])

  return (
    <div className="flex flex-col h-full">
      {/* 工具栏 */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border-light bg-bg-secondary">
        <button
          onClick={handleExecute}
          disabled={loading || !config}
          className="flex items-center gap-1.5 px-3 py-1 bg-accent hover:bg-accent-hover text-white rounded text-xs font-medium transition-colors disabled:opacity-50"
          title="执行查询 (Ctrl+Enter)"
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
          执行
        </button>
        <button
          onClick={() => setShowResult(!showResult)}
          className="flex items-center gap-1 px-2 py-1 text-text-secondary hover:text-text-primary text-xs transition-colors"
          title={showResult ? '隐藏结果' : '显示结果'}
        >
          {showResult ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          结果
        </button>
        <button
          onClick={() => setShowHistory((v) => !v)}
          className={`flex items-center gap-1 px-2 py-1 text-xs transition-colors ${showHistory ? 'bg-accent/20 text-accent' : 'text-text-secondary hover:text-text-primary'}`}
          title="查询历史"
        >
          <History size={14} />
          历史
        </button>
        <button
          onClick={handleExplain}
          disabled={explainLoading || !config}
          className={`flex items-center gap-1 px-2 py-1 text-xs transition-colors ${showExplain ? 'bg-accent/20 text-accent' : 'text-text-secondary hover:text-text-primary'} disabled:opacity-50`}
          title="执行计划 (EXPLAIN)"
        >
          {explainLoading ? <Loader2 size={14} className="animate-spin" /> : <Activity size={14} />}
          计划
        </button>
        {config && (
          <div className="ml-auto text-xs text-text-muted">
            {config.name}
            {tab.database && <span className="ml-1 text-text-secondary">/ {tab.database}</span>}
          </div>
        )}
      </div>

      {/* 编辑器 */}
      <div className="flex-1 overflow-hidden" style={{ minHeight: 100 }}>
        <Editor
          height="100%"
          defaultLanguage="sql"
          value={sql}
          onChange={(val) => setSql(val ?? '')}
          onMount={handleEditorMount}
          theme="vs-dark"
          options={{
            fontSize: 13,
            fontFamily: "'JetBrains Mono', Menlo, Monaco, monospace",
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            padding: { top: 8, bottom: 8 },
            lineNumbers: 'on',
            folding: true,
            wordWrap: 'on',
            automaticLayout: true,
            tabSize: 2,
            renderLineHighlight: 'all',
            cursorBlinking: 'smooth',
            smoothScrolling: true
          }}
          loading={<div className="flex items-center justify-center h-full text-text-muted text-sm">加载编辑器...</div>}
        />
      </div>

      {/* 拖拽分隔条 */}
      {showResult && (
        <div
          className="resize-handle"
          data-orientation="horizontal"
          onMouseDown={onResizeStart}
        />
      )}

      {/* 结果面板 */}
      {showResult && (
        <div
          className="bg-bg-primary border-t border-border-light flex flex-col overflow-hidden"
          style={{ height: resultPanelHeight }}
        >
          {loading && (
            <div className="flex items-center justify-center h-full text-text-secondary text-sm gap-2">
              <Loader2 size={16} className="animate-spin text-accent" />
              执行中...
            </div>
          )}

          {!loading && error && (
            <div className="flex items-start gap-2 p-3 text-sm text-red-400">
              <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
              <pre className="whitespace-pre-wrap break-words font-mono text-xs">{error}</pre>
            </div>
          )}

          {!loading && !error && result && (
            <>
              {/* 结果统计栏 */}
              <div className="flex items-center gap-3 px-3 py-1 border-b border-border-light text-xs text-text-secondary">
                <span className="flex items-center gap-1">
                  <Clock size={12} />
                  {formatDuration(result.duration)}
                </span>
                {result.rows.length > 0 && (
                  <span>{result.rows.length} 行</span>
                )}
                {result.affectedRows > 0 && (
                  <span>{result.affectedRows} 行受影响</span>
                )}
                {result.changedRows !== undefined && result.changedRows > 0 && (
                  <span>{result.changedRows} 行已修改</span>
                )}
                {result.insertId !== undefined && result.insertId > 0 && (
                  <span>插入ID: {result.insertId}</span>
                )}
                {result.warning && (
                  <span className="text-yellow-400">{result.warning}</span>
                )}
                <button
                  onClick={handleExport}
                  className="ml-auto p-1 hover:bg-bg-hover rounded text-text-muted hover:text-text-primary transition-colors"
                  title="导出 CSV"
                >
                  <Download size={14} />
                </button>
                <button
                  onClick={() => setResult(null)}
                  className="p-1 hover:bg-bg-hover rounded text-text-muted hover:text-text-primary transition-colors"
                  title="清除结果"
                >
                  <Trash2 size={14} />
                </button>
              </div>

              {/* 结果表格 */}
              <div className="flex-1 overflow-auto">
                <table className="w-full text-xs font-mono">
                  <thead className="sticky top-0 bg-bg-secondary">
                    <tr>
                      <th className="px-2 py-1.5 text-right text-text-muted border-b border-border-light w-12">
                        #
                      </th>
                      {result.columns.map((col) => (
                        <th
                          key={col.name}
                          className="px-3 py-1.5 text-left text-text-secondary border-b border-border-light whitespace-nowrap"
                        >
                          {col.name}
                          <span className="ml-1 text-text-muted text-[10px]">{col.type}</span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.length === 0 ? (
                      <tr>
                        <td colSpan={result.columns.length + 1} className="text-center text-text-muted py-4">
                          空结果集
                        </td>
                      </tr>
                    ) : (
                      result.rows.map((row, idx) => (
                        <tr key={idx} className="hover:bg-bg-hover">
                          <td className="px-2 py-1 text-right text-text-muted border-b border-border-light">
                            {idx + 1}
                          </td>
                          {result.columns.map((col) => {
                            const val = row[col.name]
                            return (
                              <td
                                key={col.name}
                                className={`px-3 py-1 border-b border-border-light whitespace-nowrap ${
                                  val === null ? 'text-text-muted italic' : 'text-text-primary'
                                }`}
                              >
                                {val === null ? 'NULL' : String(val)}
                              </td>
                            )
                          })}
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {!loading && !error && !result && (
            <div className="flex items-center justify-center h-full text-text-muted text-sm">
              执行查询以查看结果
            </div>
          )}
        </div>
      )}

      {/* 执行计划面板 */}
      {showExplain && explainData && (
        <div className="flex-1 border-t border-border-light overflow-hidden" style={{ minHeight: 150 }}>
          <ExplainPlanView rows={explainData.rows} columns={explainData.columns} treeText={explainData.treeText} />
        </div>
      )}

      {/* 查询历史面板 */}
      {showHistory && (
        <QueryHistoryPanel
          onSelectSql={(historySql: string) => {
            setSql(historySql)
            setShowHistory(false)
          }}
          onClose={() => setShowHistory(false)}
        />
      )}
    </div>
  )
}
