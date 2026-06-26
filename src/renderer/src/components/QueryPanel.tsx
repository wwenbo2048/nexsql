import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import Editor from '@monaco-editor/react'
import type { editor, languages, IDisposable } from 'monaco-editor'
import { Play, Loader2, Save, AlertCircle, Database, Clock, Check, Download, Code2 } from 'lucide-react'
import { useBrowserStore } from '@stores/browser'
import { useConnectionStore } from '@stores/connection'
import type { ColumnInfo } from '@shared/types'

// MySQL 关键字
const SQL_KEYWORDS = [
  'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'NULL', 'IS', 'IN', 'LIKE', 'BETWEEN',
  'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE', 'JOIN', 'LEFT', 'RIGHT', 'INNER',
  'OUTER', 'FULL', 'ON', 'GROUP', 'BY', 'ORDER', 'HAVING', 'LIMIT', 'OFFSET', 'UNION',
  'ALL', 'DISTINCT', 'AS', 'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'CASE', 'WHEN', 'THEN',
  'ELSE', 'END', 'IF', 'IFNULL', 'COALESCE', 'CONCAT', 'SUBSTRING', 'TRIM', 'LENGTH',
  'CREATE', 'TABLE', 'ALTER', 'DROP', 'INDEX', 'VIEW', 'DATABASE', 'SCHEMA', 'TRIGGER',
  'PRIMARY', 'KEY', 'FOREIGN', 'REFERENCES', 'UNIQUE', 'DEFAULT', 'AUTO_INCREMENT',
  'CONSTRAINT', 'CHECK', 'CASCADE', 'CONSTRAINT', 'ENGINE', 'CHARSET', 'COLLATE',
  'INT', 'INTEGER', 'BIGINT', 'TINYINT', 'SMALLINT', 'MEDIUMINT',
  'VARCHAR', 'CHAR', 'TEXT', 'LONGTEXT', 'MEDIUMTEXT', 'TINYTEXT',
  'DECIMAL', 'FLOAT', 'DOUBLE', 'NUMERIC',
  'DATE', 'DATETIME', 'TIMESTAMP', 'TIME', 'YEAR',
  'BLOB', 'ENUM', 'SET', 'JSON', 'BINARY', 'VARBINARY',
  'BOOLEAN', 'BOOL',
  'SHOW', 'DESCRIBE', 'EXPLAIN', 'USE',
  'BEGIN', 'COMMIT', 'ROLLBACK', 'TRANSACTION',
  'GRANT', 'REVOKE', 'PRIVILEGES',
  'EXISTS', 'ANY', 'SOME',
  'ASC', 'DESC',
  'NOW', 'CURDATE', 'CURTIME', 'UNIX_TIMESTAMP', 'FROM_UNIXTIME', 'DATE_FORMAT',
  'STR_TO_DATE', 'DATEDIFF', 'DATE_ADD', 'DATE_SUB', 'INTERVAL',
  'ROUND', 'CEIL', 'FLOOR', 'ABS', 'POW', 'SQRT', 'RAND',
  'UPPER', 'LOWER', 'REPLACE', 'LEFT', 'RIGHT', 'LPAD', 'RPAD',
  'GROUP_CONCAT', 'DISTINCT', 'HAVING',
  'WITH', 'RECURSIVE',
]

export default function QueryPanel() {
  const connections = useConnectionStore((s) => s.connections)
  const {
    selectedConnectionId, selectedDatabase,
    activeQuerySql, setActiveQuerySql,
    saveQuery, selectedQueryId,
    savedQueries, tables
  } = useBrowserStore()
  const config = connections.find((c) => c.id === selectedConnectionId)

  const [results, setResults] = useState<{ columns: string[]; rows: unknown[][] } | null>(null)
  const [executing, setExecuting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [affectedRows, setAffectedRows] = useState<number | null>(null)
  const [elapsed, setElapsed] = useState<number | null>(null)
  const [showSaveDialog, setShowSaveDialog] = useState(false)
  const [saveName, setSaveName] = useState('')
  const [multiResult, setMultiResult] = useState<{ sql: string; success: boolean; error?: string; rows?: unknown[][]; columns?: string[]; affected?: number }[] | null>(null)

  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const monacoRef = useRef<typeof import('monaco-editor') | null>(null)
  const completionProviderRef = useRef<IDisposable | null>(null)

  // 缓存表字段（避免每次输入都查询）
  const columnsCacheRef = useRef<Map<string, ColumnInfo[]>>(new Map())
  const [tableColumns, setTableColumns] = useState<Record<string, ColumnInfo[]>>({})

  // 加载表字段
  const loadTableColumns = useCallback(async (tableName: string) => {
    if (columnsCacheRef.current.has(tableName)) return
    if (!config || !selectedDatabase) return
    try {
      const res = await window.api.db.getTableColumns(config, selectedDatabase, tableName)
      if (res.success && res.data) {
        columnsCacheRef.current.set(tableName, res.data)
        setTableColumns((prev) => ({ ...prev, [tableName]: res.data! }))
      }
    } catch {
      // 忽略
    }
  }, [config, selectedDatabase])

  // 切换数据库时预加载所有表的字段
  useEffect(() => {
    columnsCacheRef.current.clear()
    setTableColumns({})
    if (tables.length > 0 && config && selectedDatabase) {
      tables.forEach((t) => loadTableColumns(t.name))
    }
  }, [tables, config, selectedDatabase, loadTableColumns])

  // SQL 自动补全数据
  const autoCompleteData = useMemo(() => {
    const tableNames = tables.map((t) => t.name)
    const allColumns = new Set<string>()
    const tableColumnMap: Record<string, string[]> = {}
    Object.entries(tableColumns).forEach(([tableName, cols]) => {
      tableColumnMap[tableName] = cols.map((c) => c.name)
      cols.forEach((c) => allColumns.add(c.name))
    })
    return { tableNames, allColumns: [...allColumns], tableColumnMap }
  }, [tables, tableColumns])

  // 执行查询（支持多语句，按 ; 分割）
  const handleExecute = useCallback(async () => {
    if (!config || !selectedDatabase || !activeQuerySql.trim()) return

    // 获取选中的 SQL 或全部 SQL
    let sqlToExecute = activeQuerySql
    if (editorRef.current) {
      const selection = editorRef.current.getSelection()
      if (selection && !selection.isEmpty()) {
        sqlToExecute = editorRef.current.getModel()?.getValueInRange(selection) ?? activeQuerySql
      }
    }

    if (!sqlToExecute.trim()) return

    // 按分号分割多语句（忽略字符串内的分号）
    const statements: string[] = []
    let current = ''
    let inSingleQuote = false
    let inDoubleQuote = false
    let inBacktick = false
    for (let i = 0; i < sqlToExecute.length; i++) {
      const ch = sqlToExecute[i]
      const next = sqlToExecute[i + 1]
      if (ch === '\\' && next) { current += ch + next; i++; continue }
      if (ch === "'" && !inDoubleQuote && !inBacktick) inSingleQuote = !inSingleQuote
      else if (ch === '"' && !inSingleQuote && !inBacktick) inDoubleQuote = !inDoubleQuote
      else if (ch === '`' && !inSingleQuote && !inDoubleQuote) inBacktick = !inBacktick
      if (ch === ';' && !inSingleQuote && !inDoubleQuote && !inBacktick) {
        const stmt = current.trim()
        if (stmt && !stmt.startsWith('--')) statements.push(stmt)
        current = ''
      } else {
        current += ch
      }
    }
    const lastStmt = current.trim()
    if (lastStmt && !lastStmt.startsWith('--')) statements.push(lastStmt)

    setExecuting(true)
    setError(null)
    setResults(null)
    setAffectedRows(null)
    setElapsed(null)
    setMultiResult(null)

    const multiMode = statements.length > 1
    const allResults: { sql: string; success: boolean; error?: string; rows?: unknown[][]; columns?: string[]; affected?: number }[] = []
    const totalStart = performance.now()

    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i]
      try {
        const res = await window.api.db.query(config, stmt, selectedDatabase)
        if (!res.success) {
          allResults.push({ sql: stmt, success: false, error: res.error ?? '执行失败' })
          break // 遇到错误停止后续执行
        }
        if (res.data && res.data.rows && res.data.rows.length > 0) {
          const cols = (res.data.columns ?? []).map((c) => c.name)
          const arrRows = res.data.rows.map((r) => cols.map((c) => (r as Record<string, unknown>)[c] ?? ''))
          allResults.push({ sql: stmt, success: true, rows: arrRows, columns: cols, affected: arrRows.length })
        } else {
          allResults.push({ sql: stmt, success: true, affected: res.data?.affectedRows ?? 0 })
        }
      } catch (err) {
        allResults.push({ sql: stmt, success: false, error: (err as Error).message })
        break
      }
    }

    const ms = Math.round(performance.now() - totalStart)
    setElapsed(ms)

    // 处理结果展示
    const failed = allResults.find((r) => !r.success)
    if (failed) {
      setError(multiMode
        ? `语句 ${allResults.indexOf(failed) + 1}/${statements.length} 执行失败:\n${failed.error}\n\nSQL: ${failed.sql}`
        : failed.error ?? '执行失败'
      )
      setExecuting(false)
      return
    }

    // 取最后一个有结果集的查询作为显示
    const lastWithRows = [...allResults].reverse().find((r) => r.rows && r.rows.length > 0)
    if (lastWithRows) {
      setResults({ columns: lastWithRows.columns!, rows: lastWithRows.rows! })
      setAffectedRows(lastWithRows.affected ?? 0)
    } else {
      const totalAffected = allResults.reduce((sum, r) => sum + (r.affected ?? 0), 0)
      setAffectedRows(totalAffected)
    }

    if (multiMode) {
      setMultiResult(allResults)
    }
    setExecuting(false)
  }, [config, selectedDatabase, activeQuerySql])

  // 注册自动补全
  const handleEditorMount = useCallback((editorInstance: editor.IStandaloneCodeEditor, monacoInstance: typeof import('monaco-editor')) => {
    editorRef.current = editorInstance
    monacoRef.current = monacoInstance

    // 注册自动补全 Provider
    if (completionProviderRef.current) {
      completionProviderRef.current.dispose()
    }

    completionProviderRef.current = monacoInstance.languages.registerCompletionItemProvider('sql', {
      triggerCharacters: [' ', '.', '`'],
      provideCompletionItems: (model, position) => {
        const word = model.getWordUntilPosition(position)
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn
        }

        // 获取当前行前面的文本，判断上下文
        const textUntilPosition = model.getValueInRange({
          startLineNumber: position.lineNumber,
          startColumn: 1,
          endLineNumber: position.lineNumber,
          endColumn: position.column
        })

        const suggestions: languages.CompletionItem[] = []

        // 检测是否在 表名. 后面（输入字段名）
        const dotMatch = textUntilPosition.match(/(\w+)\.\s*$/)
        if (dotMatch) {
          const tableName = dotMatch[1]
          const cols = autoCompleteData.tableColumnMap[tableName] || []
          cols.forEach((colName) => {
            suggestions.push({
              label: { label: colName, detail: ` ${tableName} 字段` },
              kind: monacoInstance.languages.CompletionItemKind.Field,
              insertText: colName,
              range,
              sortText: '0_' + colName
            })
          })
          return { suggestions }
        }

        // 关键字补全
        SQL_KEYWORDS.forEach((kw) => {
          suggestions.push({
            label: kw,
            kind: monacoInstance.languages.CompletionItemKind.Keyword,
            insertText: kw,
            range,
            sortText: '2_' + kw
          })
        })

        // 表名补全
        autoCompleteData.tableNames.forEach((tableName) => {
          suggestions.push({
            label: { label: tableName, detail: ' 表' },
            kind: monacoInstance.languages.CompletionItemKind.Class,
            insertText: tableName,
            range,
            sortText: '1_' + tableName
          })
        })

        // 字段名补全
        autoCompleteData.allColumns.forEach((colName) => {
          suggestions.push({
            label: { label: colName, detail: ' 字段' },
            kind: monacoInstance.languages.CompletionItemKind.Field,
            insertText: colName,
            range,
            sortText: '1_' + colName
          })
        })

        return { suggestions }
      }
    })

    // Ctrl+Enter / Cmd+Enter 执行
    editorInstance.addCommand(monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.Enter, () => {
      handleExecute()
    })
  }, [autoCompleteData, handleExecute])

  // 清理
  useEffect(() => {
    return () => {
      if (completionProviderRef.current) {
        completionProviderRef.current.dispose()
      }
    }
  }, [])

  const handleSaveClick = useCallback(() => {
    if (!activeQuerySql.trim()) return
    setSaveName('')
    setShowSaveDialog(true)
  }, [activeQuerySql])

  const handleSaveConfirm = useCallback(() => {
    if (!saveName.trim()) return
    saveQuery(saveName.trim(), activeQuerySql)
    setShowSaveDialog(false)
  }, [saveName, activeQuerySql, saveQuery])

  // ==================== 查询结果导出 ====================

  const handleExportResults = useCallback(async (format: 'csv' | 'json') => {
    if (!results || results.rows.length === 0) return
    let content = ''
    if (format === 'csv') {
      content = [results.columns.join(',')].concat(
        results.rows.map((row) => row.map((cell) => {
          if (cell === null || cell === undefined || cell === '') return ''
          const s = String(cell)
          return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
        }).join(','))
      ).join('\n')
    } else {
      const jsonRows = results.rows.map((row) => {
        const obj: Record<string, unknown> = {}
        results.columns.forEach((col, idx) => obj[col] = row[idx])
        return obj
      })
      content = JSON.stringify(jsonRows, null, 2)
    }
    await window.api.file.saveDialog(`query_result.${format}`, content, format)
  }, [results])

  // ==================== SQL 格式化 ====================

  const handleFormatSql = useCallback(() => {
    if (!editorRef.current || !activeQuerySql.trim()) return
    try {
      // 动态导入 sql-formatter
      import('sql-formatter').then(({ format }) => {
        const formatted = format(activeQuerySql, { language: 'mysql', tabWidth: 2, keywordCase: 'upper' })
        setActiveQuerySql(formatted)
      }).catch(() => {
        // 如果 import 失败，尝试使用全局对象
      })
    } catch {
      // ignore
    }
  }, [activeQuerySql, setActiveQuerySql])

  // 监听菜单栏 SQL 格式化事件
  useEffect(() => {
    const onFormat = () => handleFormatSql()
    window.addEventListener('nexsql-format-sql', onFormat)
    return () => window.removeEventListener('nexsql-format-sql', onFormat)
  }, [handleFormatSql])

  if (!config || !selectedDatabase) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-text-muted bg-bg-primary">
        <Database size={48} className="opacity-20 mb-3" />
        <p className="text-sm">请先选择数据库</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-bg-primary">
      {/* 工具栏 */}
      <div className="flex items-center gap-1 px-3 py-1.5 border-b border-border-light bg-bg-secondary flex-shrink-0">
        <button
          onClick={handleExecute}
          disabled={executing || !activeQuerySql.trim()}
          className="flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium bg-green-600/20 text-green-400 hover:bg-green-600/30 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        >
          {executing ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
          执行
        </button>
        <button
          onClick={handleSaveClick}
          disabled={!activeQuerySql.trim()}
          className="flex items-center gap-1 px-2 py-1 rounded text-xs hover:bg-bg-hover text-text-secondary hover:text-text-primary transition-colors disabled:opacity-30"
          title="保存查询"
        >
          <Save size={13} /> 保存
        </button>
        <button
          onClick={handleFormatSql}
          disabled={!activeQuerySql.trim()}
          className="flex items-center gap-1 px-2 py-1 rounded text-xs hover:bg-bg-hover text-text-secondary hover:text-text-primary transition-colors disabled:opacity-30"
          title="SQL 格式化"
        >
          <Code2 size={13} /> 格式化
        </button>
        <span className="ml-1 text-[10px] text-text-muted">⌘+Enter 执行</span>
        {elapsed !== null && (
          <span className="ml-auto flex items-center gap-1 text-[10px] text-text-muted">
            <Clock size={10} /> {elapsed}ms
            {affectedRows !== null && results && ` · ${affectedRows} 行`}
            {results && results.rows.length > 0 && (
              <>
                <button onClick={() => handleExportResults('csv')} className="flex items-center gap-0.5 ml-2 hover:text-accent transition-colors" title="导出 CSV">
                  <Download size={10} /> CSV
                </button>
                <button onClick={() => handleExportResults('json')} className="flex items-center gap-0.5 ml-1 hover:text-accent transition-colors" title="导出 JSON">
                  <Download size={10} /> JSON
                </button>
              </>
            )}
          </span>
        )}
      </div>

      {/* 保存对话框 */}
      {showSaveDialog && (
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border-light bg-bg-tertiary/50">
          <input
            type="text"
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSaveConfirm(); if (e.key === 'Escape') setShowSaveDialog(false) }}
            placeholder="查询名称..."
            autoFocus
            className="flex-1 px-2 py-1 bg-bg-primary border border-border-light rounded text-xs text-text-primary focus:outline-none focus:border-accent transition-colors"
          />
          <button onClick={handleSaveConfirm} className="px-2 py-1 rounded text-xs bg-accent text-white hover:bg-accent/80 transition-colors">确定</button>
          <button onClick={() => setShowSaveDialog(false)} className="px-2 py-1 rounded text-xs hover:bg-bg-hover text-text-secondary transition-colors">取消</button>
        </div>
      )}

      {/* SQL 编辑器（Monaco） */}
      <div className="flex-shrink-0 border-b border-border-light" style={{ height: '40%' }}>
        <Editor
          height="100%"
          defaultLanguage="sql"
          value={activeQuerySql}
          onChange={(val) => setActiveQuerySql(val ?? '')}
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
            smoothScrolling: true,
            suggestOnTriggerCharacters: true,
            quickSuggestions: { other: true, comments: false, strings: true },
            suggestSelection: 'first',
            acceptSuggestionOnEnter: 'on',
            tabCompletion: 'on'
          }}
          loading={<div className="flex items-center justify-center h-full text-text-muted text-sm">加载编辑器...</div>}
        />
      </div>

      {/* 结果区域 */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {error && (
          <div className="flex items-start gap-2 p-3 text-xs text-red-400 bg-red-950/30 border-b border-red-800/40 flex-shrink-0">
            <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
            <pre className="whitespace-pre-wrap break-words font-mono">{error}</pre>
          </div>
        )}

        {!error && !executing && !results && affectedRows === null && (
          <div className="flex flex-col items-center justify-center h-full text-text-muted text-xs">
            <Database size={32} className="opacity-20 mb-2" />
            <p>执行查询后显示结果</p>
          </div>
        )}

        {executing && (
          <div className="flex items-center justify-center h-full text-text-secondary text-sm gap-2">
            <Loader2 size={16} className="animate-spin text-accent" />执行中...
          </div>
        )}

        {!error && !executing && results && (
          <>
            {/* 结果表 */}
            <div className="flex-1 overflow-auto">
              {results.rows.length === 0 ? (
                <div className="flex items-center justify-center h-full text-text-muted text-xs">空结果集</div>
              ) : (
                <table className="w-full text-xs border-collapse">
                  <thead className="sticky top-0 bg-bg-secondary z-10">
                    <tr>
                      {results.columns.map((col) => (
                        <th key={col} className="px-2 py-1.5 text-left font-medium text-text-secondary border-b border-border-light whitespace-nowrap">
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {results.rows.map((row, i) => (
                      <tr key={i} className="hover:bg-bg-hover transition-colors">
                        {row.map((cell, j) => (
                          <td key={j} className="px-2 py-1 text-text-primary/90 border-b border-border-light/30 font-mono whitespace-nowrap max-w-xs truncate" title={String(cell ?? '')}>
                            {cell === null ? <span className="text-text-muted italic">NULL</span> : String(cell)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            {selectedQueryId && (
              <div className="flex items-center gap-1 px-3 py-1 border-t border-border-light bg-bg-secondary flex-shrink-0 text-[10px] text-text-muted">
                <Check size={10} className="text-green-400" />
                {savedQueries.find((q) => q.id === selectedQueryId)?.name ?? '已保存'}
              </div>
            )}
          </>
        )}

        {!error && !executing && !results && affectedRows !== null && (
          <>
            {/* 多语句执行摘要 */}
            {multiResult && multiResult.length > 1 && (
              <div className="flex-1 overflow-auto p-3 space-y-1.5">
                {multiResult.map((r, i) => (
                  <div key={i} className={`flex items-start gap-2 p-2 rounded text-xs ${r.success ? 'bg-green-950/20' : 'bg-red-950/20'}`}>
                    {r.success ? <Check size={12} className="text-green-400 flex-shrink-0 mt-0.5" /> : <AlertCircle size={12} className="text-red-400 flex-shrink-0 mt-0.5" />}
                    <div className="flex-1 min-w-0">
                      <span className="text-text-muted">[{i + 1}] </span>
                      <span className={`font-mono ${r.success ? 'text-text-secondary' : 'text-red-400'}`}>
                        {r.sql.slice(0, 120)}{r.sql.length > 120 ? '...' : ''}
                      </span>
                      {r.success && r.affected !== undefined && (
                        <span className="ml-2 text-[10px] text-text-muted">{r.affected} 行受影响</span>
                      )}
                      {r.success && r.rows && r.rows.length > 0 && (
                        <span className="ml-2 text-[10px] text-accent">{r.rows.length} 行返回</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {/* 单语句或无多结果 */}
            {(!multiResult || multiResult.length <= 1) && (
              <div className="flex flex-col items-center justify-center h-full text-text-muted text-xs gap-1">
                <Check size={24} className="text-green-400 mb-1" />
                <p>执行成功 · 影响 {affectedRows} 行</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
