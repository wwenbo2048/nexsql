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
  Activity,
  Save,
  CheckCircle2,
  Terminal,
  Server,
  Database as DatabaseIcon
} from 'lucide-react'
import { useConnectionStore } from '@stores/connection'
import { useUiStore } from '@stores/ui'
import { useHistoryStore } from '@stores/history'
import { useBrowserStore } from '@stores/browser'
import type { Tab, QueryResult, DatabaseInfo } from '@shared/types'
import QueryHistoryPanel from './QueryHistoryPanel'
import ExplainPlanView from './ExplainPlanView'

/**
 * 智能 SQL 语句分割：
 * 1. 跳过 -- 行注释、# 行注释、slash-star 块注释
 * 2. 尊重字符串（单引号、双引号、反引号）内的分号
 * 3. 按分号拆分为独立语句
 */
function splitSqlStatements(raw: string): string[] {
  const statements: string[] = []
  let current = ''
  let i = 0
  const len = raw.length

  while (i < len) {
    const ch = raw[i]

    // -- 行注释：跳过到行尾
    if (ch === '-' && i + 1 < len && raw[i + 1] === '-') {
      while (i < len && raw[i] !== '\n') i++
      current += ' '
      continue
    }

    // # 行注释：跳过到行尾
    if (ch === '#') {
      while (i < len && raw[i] !== '\n') i++
      current += ' '
      continue
    }

    // /* */ 块注释：跳过到 */
    if (ch === '/' && i + 1 < len && raw[i + 1] === '*') {
      i += 2
      while (i < len && !(raw[i] === '*' && i + 1 < len && raw[i + 1] === '/')) i++
      i += 2 // skip */
      current += ' '
      continue
    }

    // 字符串（单引号、双引号、反引号）
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch
      current += ch
      i++
      while (i < len) {
        if (raw[i] === '\\') {
          // 转义字符：保留两个字符
          current += raw[i] + (raw[i + 1] ?? '')
          i += 2
          continue
        }
        if (raw[i] === quote) {
          // 检查双引号转义 ''、""、``
          if (i + 1 < len && raw[i + 1] === quote) {
            current += quote + quote
            i += 2
            continue
          }
          current += quote
          i++
          break
        }
        current += raw[i]
        i++
      }
      continue
    }

    // 分号：语句分隔符
    if (ch === ';') {
      const stmt = current.trim()
      if (stmt) statements.push(stmt)
      current = ''
      i++
      continue
    }

    current += ch
    i++
  }

  // 最后一条（可能没有分号结尾）
  const last = current.trim()
  if (last) statements.push(last)

  return statements
}

interface ExecutionLogEntry {
  sql: string
  status: 'running' | 'success' | 'error'
  affectedRows?: number
  rowCount?: number
  duration?: number
  error?: string
  insertId?: number
  columnCount?: number
}

interface Props {
  tab: Tab
}

export default function QueryEditor({ tab }: Props) {
  const [sql, setSql] = useState<string>(tab.sql ?? '')
  const [result, setResult] = useState<QueryResult | null>(null)
  const [multiResults, setMultiResults] = useState<{ sql: string; result?: QueryResult; error?: string }[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadingProgress, setLoadingProgress] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [selectedSql, setSelectedSql] = useState<string | null>(null)
  const [showResult, setShowResult] = useState(true)
  const [showHistory, setShowHistory] = useState(false)
  const [showExplain, setShowExplain] = useState(false)
  const [explainData, setExplainData] = useState<{ rows: Record<string, unknown>[]; columns: { name: string; type: string; nullable: boolean }[]; treeText?: string } | null>(null)
  const [explainLoading, setExplainLoading] = useState(false)
  const [showSaveDialog, setShowSaveDialog] = useState(false)
  const [saveName, setSaveName] = useState('')
  const [executionLogs, setExecutionLogs] = useState<ExecutionLogEntry[]>([])
  const [showLog, setShowLog] = useState(false)
  // 工具栏服务器/数据库联动选择
  const [selectedConnId, setSelectedConnId] = useState(tab.connectionId)
  const [selectedDb, setSelectedDb] = useState(tab.database ?? '')
  const [dbList, setDbList] = useState<DatabaseInfo[]>([])
  const [dbListLoading, setDbListLoading] = useState(false)
  const editorRef = useRef<any>(null)
  const logRef = useRef<HTMLDivElement>(null)
  const connections = useConnectionStore((s) => s.connections)
  const resultPanelHeight = useUiStore((s) => s.resultPanelHeight)
  const setResultPanelHeight = useUiStore((s) => s.setResultPanelHeight)
  const addHistoryEntry = useHistoryStore((s) => s.addEntry)
  const { saveQuery, updateQuery } = useBrowserStore()

  const isSavedQuery = !!tab.savedQueryId
  const [saveFlash, setSaveFlash] = useState(false)

  const config = connections.find((c) => c.id === selectedConnId)
  const statuses = useConnectionStore((s) => s.statuses)

  // 切换服务器时加载数据库列表
  useEffect(() => {
    if (!config || config.type === 'redis') {
      setDbList([])
      return
    }
    // 只为已连接的服务器加载数据库列表
    if (statuses[config.id] !== 'connected') {
      setDbList([])
      return
    }
    setDbListLoading(true)
    window.api.db.getDatabases(config).then((res) => {
      if (res.success && res.data) {
        setDbList(res.data)
      }
      setDbListLoading(false)
    }).catch(() => setDbListLoading(false))
  }, [selectedConnId, config, statuses])

  // 服务器下拉切换
  const handleConnChange = useCallback((connId: string) => {
    setSelectedConnId(connId)
    const conn = connections.find((c) => c.id === connId)
    if (conn?.database) {
      setSelectedDb(conn.database)
    } else {
      setSelectedDb('')
    }
  }, [connections])

  const handleDbChange = useCallback((dbName: string) => {
    setSelectedDb(dbName)
  }, [])

  const handleExecute = useCallback(async (overrideSql?: string) => {
    if (!config) return

    // 获取 SQL：优先使用传入参数，其次选中内容，最后全部
    let rawSql = overrideSql ?? sql
    if (!overrideSql && editorRef.current) {
      const editor = editorRef.current
      const selection = editor.getSelection()
      if (selection && !selection.isEmpty()) {
        rawSql = editor.getModel()?.getValueInRange(selection) ?? sql
      }
    }

    if (!rawSql.trim()) return

    // 智能分割语句（剥离注释 + 按分号拆分）
    const statements = splitSqlStatements(rawSql)
    if (statements.length === 0) return

    setLoading(true)
    setError(null)
    setResult(null)
    setMultiResults(null)
    setShowResult(true)
    setShowLog(true)
    setExecutionLogs([])

    // 流式日志：通过 IPC 事件实时接收每条语句的执行结果
    const allLogs: ExecutionLogEntry[] = []
    const batchResults: { sql: string; result?: QueryResult; error?: string }[] = []

    // 先填充“执行中”状态，让用户看到所有待执行语句
    for (const stmt of statements) {
      allLogs.push({ sql: stmt, status: 'running' })
    }
    setExecutionLogs([...allLogs])

    // 监听 IPC 进度事件
    const removeListener = window.api.db.onBatchProgress((data: { index: number; total: number; result: any }) => {
      const { index, result } = data
      setLoadingProgress(`执行第 ${index + 1}/${statements.length} 条...`)

      if (result.success) {
        // 将 BatchStatementResult 转为 QueryResult 格式
        const qr: QueryResult = {
          columns: result.columns ?? [],
          rows: result.rows ?? [],
          affectedRows: result.affectedRows ?? 0,
          insertId: result.insertId,
          changedRows: result.changedRows,
          duration: result.duration ?? 0,
          warning: result.warning
        }
        batchResults.push({ sql: statements[index], result: qr })
        allLogs[index] = {
          sql: statements[index],
          status: 'success',
          affectedRows: result.affectedRows,
          rowCount: result.rowCount,
          duration: result.duration,
          insertId: result.insertId,
          columnCount: result.columns?.length ?? 0
        }
      } else {
        batchResults.push({ sql: statements[index], error: result.error })
        allLogs[index] = {
          sql: statements[index],
          status: 'error',
          error: result.error
        }
      }
      setExecutionLogs([...allLogs])
    })

    try {
      const res = await window.api.db.executeBatch(config, statements, selectedDb || undefined)
      removeListener()

      const batchData = (res.success ? res.data : []) as any[]
      const totalDuration = batchData.reduce((sum: number, r: any) => sum + (r.duration ?? 0), 0)
      const hasError = batchData.some((r: any) => !r.success)

      setLoading(false)
      setLoadingProgress('')

      // 结果展示逻辑
      if (batchResults.length === 1 && batchResults[0].result) {
        setResult(batchResults[0].result)
      } else if (batchResults.length > 1) {
        setMultiResults(batchResults)
        const lastSelect = [...batchResults].reverse().find(r => r.result && r.result.rows.length > 0)
        if (lastSelect?.result) {
          setResult(lastSelect.result)
        }
      }

      if (hasError) {
        const failed = batchResults.find(r => r.error)
        setError(failed?.error ?? '执行失败')
      } else if (!res.success) {
        setError(res.error ?? '执行失败')
      }

      addHistoryEntry({
        sql: rawSql,
        connectionId: config.id,
        database: selectedDb,
        duration: totalDuration,
        rowCount: batchResults.reduce((sum, r) => sum + (r.result?.rows.length ?? r.result?.affectedRows ?? 0), 0),
        hasError,
        error: batchResults.find(r => r.error)?.error
      })
    } catch (err) {
      removeListener()
      setLoading(false)
      setLoadingProgress('')
      setError((err as Error).message)
    }
  }, [config, sql, selectedDb, addHistoryEntry])

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
      const treeRes = await window.api.db.query(config, `EXPLAIN FORMAT=TREE ${sqlToExplain}`, selectedDb || undefined)
      if (treeRes.success && treeRes.data && treeRes.data.rows.length > 0) {
        const treeText = String(treeRes.data.rows[0][Object.keys(treeRes.data.rows[0])[0]] ?? '')
        setExplainData({ rows: [], columns: [], treeText })
        setExplainLoading(false)
        return
      }

      // 回退到标准 EXPLAIN
      const res = await window.api.db.query(config, `EXPLAIN ${sqlToExplain}`, selectedDb || undefined)
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
  }, [config, sql, selectedDb])

  // 保存查询：已保存的直接更新，未保存的弹对话框
  const handleSave = useCallback(() => {
    if (!sql.trim()) return
    if (isSavedQuery) {
      updateQuery(tab.savedQueryId!, sql)
      setSaveFlash(true)
      setTimeout(() => setSaveFlash(false), 1200)
    } else {
      setSaveName('')
      setShowSaveDialog(true)
    }
  }, [sql, isSavedQuery, tab.savedQueryId, updateQuery])

  // Ctrl+S 快捷键
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        handleSave()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [handleSave])

  // 执行日志自动滚动到底部
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [executionLogs])

  // Monaco 编辑器内也拦截快捷键
  const handleEditorMount = useCallback((editor: any) => {
    editorRef.current = editor

    // 监听选区变化，显示"执行选择"按钮
    editor.onDidChangeCursorSelection(() => {
      const sel = editor.getSelection()
      if (sel && !sel.isEmpty()) {
        const text = editor.getModel()?.getValueInRange(sel)
        setSelectedSql(text?.trim() || null)
      } else {
        setSelectedSql(null)
      }
    })

    editor.addCommand(
      // @ts-ignore
      2048 | 3, // Ctrl+Enter 执行全部/选中
      () => handleExecute()
    )
    editor.addCommand(
      // @ts-ignore
      2048 | 1024 | 3, // Ctrl+Shift+Enter 执行选中
      () => {
        const sel = editor.getSelection()
        if (sel && !sel.isEmpty()) {
          const text = editor.getModel()?.getValueInRange(sel)
          if (text?.trim()) handleExecute(text.trim())
        }
      }
    )
    editor.addCommand(
      // @ts-ignore
      2048 | 49, // Ctrl+S (KeyCode.KeyS = 49)
      () => handleSave()
    )
  }, [handleExecute, handleSave])

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
          onClick={() => handleExecute()}
          disabled={loading || !config}
          className="flex items-center gap-1.5 px-3 py-1 bg-accent hover:bg-accent-hover text-white rounded text-xs font-medium transition-colors disabled:opacity-50"
          title="执行查询 (Ctrl+Enter)"
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
          执行
        </button>
        {selectedSql && (
          <button
            onClick={() => handleExecute(selectedSql)}
            disabled={loading || !config}
            className="flex items-center gap-1.5 px-3 py-1 bg-green-600 hover:bg-green-500 text-white rounded text-xs font-medium transition-colors disabled:opacity-50"
            title="执行选中的 SQL (Ctrl+Shift+Enter)"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
            执行选择
          </button>
        )}
        <button
          onClick={() => setShowResult(!showResult)}
          className="flex items-center gap-1 px-2 py-1 text-text-secondary hover:text-text-primary text-xs transition-colors"
          title={showResult ? '隐藏结果' : '显示结果'}
        >
          {showResult ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          结果
        </button>
        {executionLogs.length > 0 && (
          <button
            onClick={() => setShowLog(!showLog)}
            className={`flex items-center gap-1 px-2 py-1 text-xs transition-colors ${showLog ? 'bg-accent/20 text-accent' : 'text-text-secondary hover:text-text-primary'}`}
            title={showLog ? '隐藏执行日志' : '显示执行日志'}
          >
            <Terminal size={14} />
            日志
          </button>
        )}
        <button
          onClick={() => setShowHistory((v) => !v)}
          className={`flex items-center gap-1 px-2 py-1 text-xs transition-colors ${showHistory ? 'bg-accent/20 text-accent' : 'text-text-secondary hover:text-text-primary'}`}
          title="查询历史"
        >
          <History size={14} />
          历史
        </button>
        <button
          onClick={handleSave}
          disabled={!sql.trim()}
          className={`flex items-center gap-1 px-2 py-1 text-xs transition-colors disabled:opacity-50 ${
            saveFlash ? 'text-green-400' : 'text-text-secondary hover:text-text-primary'
          }`}
          title={isSavedQuery ? '保存修改 (Ctrl+S)' : '另存为新查询'}
        >
          <Save size={14} />
          {saveFlash ? '已保存' : isSavedQuery ? '保存' : '另存为'}
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
        {/* 服务器 + 数据库 联动选择 */}
        <div className="ml-auto flex items-center gap-1.5">
          {/* 服务器下拉 */}
          <div className="relative flex items-center">
            <Server size={12} className="absolute left-1.5 text-text-muted pointer-events-none" />
            <select
              value={selectedConnId}
              onChange={(e) => handleConnChange(e.target.value)}
              className="appearance-none bg-bg-primary border border-border-light rounded text-xs pl-7 pr-2 py-1 text-text-primary hover:border-accent focus:outline-none focus:border-accent transition-colors cursor-pointer max-w-[140px]"
              title="选择服务器"
            >
              {connections.filter(c => c.type !== 'redis').map(c => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <ChevronDown size={10} className="absolute right-1 text-text-muted pointer-events-none" />
          </div>

          {/* 数据库下拉 */}
          <div className="relative flex items-center">
            <DatabaseIcon size={12} className="absolute left-1.5 text-text-muted pointer-events-none" />
            {dbListLoading ? (
              <div className="flex items-center gap-1 px-2 py-1 text-xs text-text-muted">
                <Loader2 size={10} className="animate-spin" />
                加载...
              </div>
            ) : dbList.length > 0 ? (
              <>
                <select
                  value={selectedDb}
                  onChange={(e) => handleDbChange(e.target.value)}
                  className="appearance-none bg-bg-primary border border-border-light rounded text-xs pl-7 pr-2 py-1 text-text-primary hover:border-accent focus:outline-none focus:border-accent transition-colors cursor-pointer max-w-[140px]"
                  title="选择数据库"
                >
                  {!selectedDb && <option value="">未选择</option>}
                  {dbList.map(db => (
                    <option key={db.name} value={db.name}>
                      {db.name}
                    </option>
                  ))}
                </select>
                <ChevronDown size={10} className="absolute right-1 text-text-muted pointer-events-none" />
              </>
            ) : (
              <select
                disabled
                className="appearance-none bg-bg-primary border border-border-light rounded text-xs pl-7 pr-2 py-1 text-text-muted cursor-not-allowed max-w-[140px]"
                title="请先连接服务器"
              >
                <option value="">未连接</option>
              </select>
            )}
          </div>
        </div>
      </div>

      {/* 保存查询对话框 */}
      {showSaveDialog && (
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border-light bg-bg-tertiary/50">
          <input
            type="text"
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && saveName.trim()) {
                saveQuery(saveName.trim(), sql)
                setShowSaveDialog(false)
              }
              if (e.key === 'Escape') setShowSaveDialog(false)
            }}
            placeholder="查询名称..."
            autoFocus
            className="flex-1 px-2 py-1 bg-bg-primary border border-border-light rounded text-xs text-text-primary focus:outline-none focus:border-accent transition-colors"
          />
          <button
            onClick={() => {
              if (saveName.trim()) {
                saveQuery(saveName.trim(), sql)
                setShowSaveDialog(false)
              }
            }}
            className="px-2 py-1 rounded text-xs bg-accent text-white hover:bg-accent/80 transition-colors"
          >
            确定
          </button>
          <button
            onClick={() => setShowSaveDialog(false)}
            className="px-2 py-1 rounded text-xs hover:bg-bg-hover text-text-secondary transition-colors"
          >
            取消
          </button>
        </div>
      )}

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
          {/* 执行日志面板 */}
          {executionLogs.length > 0 && showLog && (
            <div
              className="border-b border-border-light bg-bg-secondary flex flex-col overflow-hidden"
              style={result ? { maxHeight: '50%' } : { flex: 1 }}
            >
              <div className="flex items-center justify-between px-3 py-1 border-b border-border-light flex-shrink-0">
                <div className="flex items-center gap-2 text-xs">
                  <Terminal size={12} className="text-accent" />
                  <span className="text-text-secondary font-medium">执行日志</span>
                  {loading && loadingProgress && <span className="text-text-muted">{loadingProgress}</span>}
                </div>
                <div className="flex items-center gap-3 text-[11px] text-text-muted">
                  <span className="text-green-400">{executionLogs.filter(l => l.status === 'success').length} 成功</span>
                  {executionLogs.some(l => l.status === 'error') && (
                    <span className="text-red-400">{executionLogs.filter(l => l.status === 'error').length} 失败</span>
                  )}
                  {loading && <Loader2 size={11} className="animate-spin text-accent" />}
                </div>
              </div>
              <div ref={logRef} className="overflow-y-auto flex-1">
                {executionLogs.map((log, idx) => (
                  <div key={idx} className={`px-3 py-1.5 border-b border-border-light/20 ${log.status === 'error' ? 'bg-red-500/5' : ''}`}>
                    <div className="flex items-start gap-2">
                      <span className="text-text-muted flex-shrink-0 text-[11px] leading-relaxed select-none">{idx + 1}</span>
                      <div className="flex-1 min-w-0">
                        <pre className="whitespace-pre-wrap break-words text-text-primary text-[11px] leading-relaxed font-mono mb-0.5">{log.sql.length > 300 ? log.sql.slice(0, 300) + '\n...' : log.sql}</pre>
                        <div className="text-[11px] font-mono">
                          {log.status === 'running' && (
                            <span className="text-yellow-400 flex items-center gap-1">
                              <Loader2 size={10} className="animate-spin" />
                              执行中...
                            </span>
                          )}
                          {log.status === 'success' && (
                            <div className="flex items-center gap-3 flex-wrap text-[11px]">
                              {log.columnCount && log.columnCount > 0 && log.rowCount !== undefined ? (
                                <span className="text-green-400">{'>'} {log.rowCount} 行返回</span>
                              ) : log.affectedRows !== undefined && log.affectedRows > 0 ? (
                                <span className="text-green-400">{'>'} Affected rows: {log.affectedRows}</span>
                              ) : (
                                <span className="text-green-400">{'>'} OK</span>
                              )}
                              {log.insertId !== undefined && log.insertId > 0 && (
                                <span className="text-text-muted">{'>'} Insert ID: {log.insertId}</span>
                              )}
                              {log.duration !== undefined && (
                                <span className="text-text-muted">{'>'} Time: {(log.duration / 1000).toFixed(3)}s</span>
                              )}
                            </div>
                          )}
                          {log.status === 'error' && (
                            <span className="text-red-400">{'>'} ERROR: {log.error}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 加载指示器（无日志时的简单 spinner） */}
          {loading && executionLogs.length === 0 && (
            <div className="flex items-center justify-center h-full text-text-secondary text-sm gap-2">
              <Loader2 size={16} className="animate-spin text-accent" />
              {loadingProgress || '执行中...'}
            </div>
          )}

          {!loading && error && executionLogs.length === 0 && (
            <div className="flex items-start gap-2 p-3 text-sm text-red-400">
              <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
              <pre className="whitespace-pre-wrap break-words font-mono text-xs">{error}</pre>
            </div>
          )}

          {!loading && result && (
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
                {result.columns.length === 0 && result.affectedRows === 0 && (
                  <span className="flex items-center gap-1 text-green-400">
                    <CheckCircle2 size={12} /> 执行成功
                  </span>
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
                          {result.columns.length === 0
                            ? <span className="flex items-center justify-center gap-1.5 text-green-400"><CheckCircle2 size={14} /> 执行成功</span>
                            : '空结果集'}
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

          {!loading && !error && !result && executionLogs.length === 0 && (
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
