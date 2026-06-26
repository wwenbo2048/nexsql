import { useState, useCallback } from 'react'
import {
  Plus,
  Trash2,
  Check,
  X,
  Key,
  ChevronUp,
  ChevronDown,
  Loader2,
  AlertCircle,
  Save,
  Database as DatabaseIcon
} from 'lucide-react'
import { useConnectionStore } from '@stores/connection'
import { useBrowserStore } from '@stores/browser'

interface NewColumn {
  _id: string
  name: string
  type: string
  nullable: boolean
  isPrimaryKey: boolean
  defaultValue: string | null
  extra: string
  comment: string
}

let colIdCounter = 0
function genColId(): string {
  colIdCounter++
  return `nc_${Date.now()}_${colIdCounter}`
}

export default function NewTableDesigner() {
  const connections = useConnectionStore((s) => s.connections)
  const {
    selectedConnectionId, selectedDatabase,
    stopCreating, refreshList, selectTable
  } = useBrowserStore()

  const config = connections.find((c) => c.id === selectedConnectionId)

  const [tableName, setTableName] = useState('')
  const [columns, setColumns] = useState<NewColumn[]>([
    { _id: genColId(), name: 'id', type: 'bigint', nullable: false, isPrimaryKey: true, defaultValue: null, extra: 'AUTO_INCREMENT', comment: '' }
  ])
  const [engine, setEngine] = useState('InnoDB')
  const [charset, setCharset] = useState('utf8mb4')
  const [comment, setComment] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleCellChange = useCallback((colId: string, field: keyof NewColumn, value: unknown) => {
    setColumns((prev) => prev.map((c) => (c._id === colId ? { ...c, [field]: value } : c)))
  }, [])

  const handleAddColumn = useCallback(() => {
    setColumns((prev) => [...prev, {
      _id: genColId(),
      name: '',
      type: 'varchar(255)',
      nullable: true,
      isPrimaryKey: false,
      defaultValue: null,
      extra: '',
      comment: ''
    }])
  }, [])

  const handleDeleteColumn = useCallback((colId: string) => {
    setColumns((prev) => prev.filter((c) => c._id !== colId))
  }, [])

  const handleMoveUp = useCallback((idx: number) => {
    if (idx === 0) return
    setColumns((prev) => {
      const arr = [...prev]
      ;[arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]]
      return arr
    })
  }, [])

  const handleMoveDown = useCallback((idx: number) => {
    setColumns((prev) => {
      const arr = [...prev]
      if (idx >= arr.length - 1) return arr
      ;[arr[idx], arr[idx + 1]] = [arr[idx + 1], arr[idx]]
      return arr
    })
  }, [])

  const handleCreate = useCallback(async () => {
    if (!config || !selectedDatabase) return
    const trimmedName = tableName.trim()
    if (!trimmedName) { setError('请输入表名'); return }
    const validCols = columns.filter((c) => c.name.trim())
    if (validCols.length === 0) { setError('至少需要添加一个字段'); return }

    // Build CREATE TABLE SQL
    const colDefs: string[] = []
    const primaryKeys: string[] = []
    for (const col of validCols) {
      const parts: string[] = []
      parts.push(`\`${col.name.trim()}\``)
      parts.push(col.type)
      parts.push(col.nullable ? 'NULL' : 'NOT NULL')
      if (col.defaultValue !== null && col.defaultValue !== '') {
        parts.push(`DEFAULT ${/^-?\d+/.test(col.defaultValue) ? col.defaultValue : `'${col.defaultValue.replace(/'/g, "\\'")}'`}`)
      }
      if (col.extra.trim()) parts.push(col.extra.trim().toUpperCase())
      if (col.comment.trim()) parts.push(`COMMENT '${col.comment.replace(/'/g, "\\'")}'`)
      colDefs.push('  ' + parts.join(' '))
      if (col.isPrimaryKey) primaryKeys.push(col.name.trim())
    }
    if (primaryKeys.length > 0) {
      colDefs.push(`  PRIMARY KEY (${primaryKeys.map((k) => `\`${k}\``).join(', ')})`)
    }

    const tableOptions: string[] = []
    tableOptions.push(`ENGINE=${engine}`)
    tableOptions.push(`DEFAULT CHARSET=${charset}`)
    if (comment.trim()) tableOptions.push(`COMMENT='${comment.replace(/'/g, "\\'")}'`)

    const sql = `CREATE TABLE \`${trimmedName}\` (\n${colDefs.join(',\n')}\n) ${tableOptions.join(' ')};`

    setCreating(true)
    setError(null)
    try {
      const res = await window.api.db.query(config, sql, selectedDatabase)
      if (res.success) {
        stopCreating()
        refreshList()
        selectTable(trimmedName)
      } else {
        setError(res.error ?? '创建失败')
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setCreating(false)
    }
  }, [config, selectedDatabase, tableName, columns, engine, charset, comment, stopCreating, refreshList, selectTable])

  const handleCancel = useCallback(() => {
    stopCreating()
  }, [stopCreating])

  const inputClass = "w-full px-1.5 py-0.5 bg-transparent border border-transparent hover:border-border-light focus:border-accent focus:bg-bg-primary rounded text-xs font-mono text-text-primary focus:outline-none transition-colors"

  return (
    <div className="flex flex-col h-full bg-bg-primary">
      {/* 头部工具栏 */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-border-light bg-bg-secondary flex-shrink-0">
        <DatabaseIcon size={14} className="text-accent flex-shrink-0" />
        <span className="text-xs font-medium text-text-primary mr-2">新建表</span>
        <div className="h-4 w-px bg-border-light mx-0.5" />
        <button
          onClick={handleCreate}
          disabled={creating || !tableName.trim()}
          className="flex items-center gap-1 px-2 py-1 rounded text-xs hover:bg-green-900/40 text-text-secondary hover:text-green-400 transition-colors disabled:opacity-30"
          title="保存并创建表"
        >
          {creating ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          <span>保存</span>
        </button>
        <button
          onClick={handleCancel}
          disabled={creating}
          className="flex items-center gap-1 px-2 py-1 rounded text-xs hover:bg-bg-hover text-text-secondary hover:text-red-400 transition-colors disabled:opacity-30"
          title="取消"
        >
          <X size={14} />
          <span>取消</span>
        </button>
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="flex items-start gap-2 px-3 py-2 text-xs text-red-400 bg-red-950/30 border-b border-red-800/40 flex-shrink-0">
          <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
          <pre className="whitespace-pre-wrap break-words font-mono">{error}</pre>
        </div>
      )}

      {/* 表名和选项区 */}
      <div className="flex items-center gap-3 px-3 py-2 border-b border-border-light bg-bg-tertiary/30 flex-shrink-0">
        <div className="flex items-center gap-1.5">
          <label className="text-xs text-text-muted w-10">表名</label>
          <input
            type="text"
            value={tableName}
            onChange={(e) => setTableName(e.target.value)}
            placeholder="输入表名"
            autoFocus
            className="w-44 px-2 py-1 bg-bg-primary border border-border-light rounded text-xs font-mono text-text-primary focus:outline-none focus:border-accent transition-colors"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <label className="text-xs text-text-muted">引擎</label>
          <select
            value={engine}
            onChange={(e) => setEngine(e.target.value)}
            className="px-2 py-1 bg-bg-primary border border-border-light rounded text-xs text-text-primary focus:outline-none focus:border-accent transition-colors"
          >
            <option value="InnoDB">InnoDB</option>
            <option value="MyISAM">MyISAM</option>
            <option value="Memory">Memory</option>
            <option value="CSV">CSV</option>
            <option value="Archive">Archive</option>
          </select>
        </div>
        <div className="flex items-center gap-1.5">
          <label className="text-xs text-text-muted">字符集</label>
          <select
            value={charset}
            onChange={(e) => setCharset(e.target.value)}
            className="px-2 py-1 bg-bg-primary border border-border-light rounded text-xs text-text-primary focus:outline-none focus:border-accent transition-colors"
          >
            <option value="utf8mb4">utf8mb4</option>
            <option value="utf8">utf8</option>
            <option value="latin1">latin1</option>
            <option value="ascii">ascii</option>
          </select>
        </div>
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <label className="text-xs text-text-muted">注释</label>
          <input
            type="text"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="表注释（可选）"
            className="flex-1 min-w-0 px-2 py-1 bg-bg-primary border border-border-light rounded text-xs text-text-primary focus:outline-none focus:border-accent transition-colors"
          />
        </div>
      </div>

      {/* 字段编辑工具栏 */}
      <div className="flex items-center gap-1 px-2 py-1 border-b border-border-light bg-bg-secondary flex-shrink-0">
        <button onClick={handleAddColumn} className="flex items-center gap-1 px-2 py-1 rounded text-xs hover:bg-bg-hover text-text-secondary hover:text-green-400 transition-colors" title="添加字段">
          <Plus size={14} /><span>添加字段</span>
        </button>
        <span className="ml-1 px-1.5 py-0.5 bg-blue-900/40 text-blue-400 rounded text-[10px] font-medium">{columns.length} 个字段</span>
      </div>

      {/* 字段表格 */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs border-collapse">
          <thead className="sticky top-0 z-10">
            <tr className="bg-bg-secondary">
              <th className="px-2 py-2 text-center text-text-secondary font-medium border-b border-r border-border-light w-10">#</th>
              <th className="px-2 py-2 text-center text-text-secondary font-medium border-b border-r border-border-light w-8">PK</th>
              <th className="px-2 py-2 text-left text-text-secondary font-medium border-b border-r border-border-light min-w-[120px]">字段名</th>
              <th className="px-2 py-2 text-left text-text-secondary font-medium border-b border-r border-border-light min-w-[120px]">类型</th>
              <th className="px-2 py-2 text-center text-text-secondary font-medium border-b border-r border-border-light w-16">允许空</th>
              <th className="px-2 py-2 text-left text-text-secondary font-medium border-b border-r border-border-light min-w-[100px]">默认值</th>
              <th className="px-2 py-2 text-left text-text-secondary font-medium border-b border-r border-border-light min-w-[100px]">额外</th>
              <th className="px-2 py-2 text-left text-text-secondary font-medium border-b border-r border-border-light min-w-[120px]">注释</th>
              <th className="px-2 py-2 text-center text-text-secondary font-medium border-b border-border-light w-16">操作</th>
            </tr>
          </thead>
          <tbody>
            {columns.map((col, idx) => (
              <tr key={col._id} className="border-b border-border-light/50 hover:bg-bg-hover/30">
                <td className="px-2 py-1 text-center text-text-muted border-r border-border-light">{idx + 1}</td>
                <td className="px-2 py-1 text-center border-r border-border-light">
                  <input
                    type="checkbox"
                    checked={col.isPrimaryKey}
                    onChange={(e) => {
                      handleCellChange(col._id, 'isPrimaryKey', e.target.checked)
                      if (e.target.checked) handleCellChange(col._id, 'nullable', false)
                    }}
                    className="cursor-pointer"
                  />
                  {col.isPrimaryKey && <Key size={10} className="text-yellow-400 inline ml-0.5" />}
                </td>
                <td className="px-1 py-0.5 border-r border-border-light">
                  <input type="text" value={col.name} onChange={(e) => handleCellChange(col._id, 'name', e.target.value)} className={inputClass} placeholder="字段名" />
                </td>
                <td className="px-1 py-0.5 border-r border-border-light">
                  <input type="text" value={col.type} onChange={(e) => handleCellChange(col._id, 'type', e.target.value)} className={inputClass} list="mysql-types-new" placeholder="类型" />
                </td>
                <td className="px-1 py-0.5 text-center border-r border-border-light">
                  <input type="checkbox" checked={col.nullable} onChange={(e) => handleCellChange(col._id, 'nullable', e.target.checked)} className="cursor-pointer" disabled={col.isPrimaryKey} />
                </td>
                <td className="px-1 py-0.5 border-r border-border-light">
                  <input type="text" value={col.defaultValue ?? ''} onChange={(e) => handleCellChange(col._id, 'defaultValue', e.target.value || null)} className={inputClass} placeholder="NULL" disabled={col.isPrimaryKey && col.extra.toUpperCase().includes('AUTO_INCREMENT')} />
                </td>
                <td className="px-1 py-0.5 border-r border-border-light">
                  <input type="text" value={col.extra} onChange={(e) => handleCellChange(col._id, 'extra', e.target.value)} className={inputClass} placeholder="如 auto_increment" />
                </td>
                <td className="px-1 py-0.5 border-r border-border-light">
                  <input type="text" value={col.comment} onChange={(e) => handleCellChange(col._id, 'comment', e.target.value)} className={inputClass} placeholder="注释" />
                </td>
                <td className="px-1 py-0.5 text-center border-r border-border-light">
                  <div className="flex items-center justify-center gap-0.5">
                    <button onClick={() => handleMoveUp(idx)} disabled={idx === 0} className="p-0.5 hover:bg-bg-hover rounded text-text-muted hover:text-text-primary disabled:opacity-20" title="上移"><ChevronUp size={12} /></button>
                    <button onClick={() => handleMoveDown(idx)} disabled={idx >= columns.length - 1} className="p-0.5 hover:bg-bg-hover rounded text-text-muted hover:text-text-primary disabled:opacity-20" title="下移"><ChevronDown size={12} /></button>
                    <button onClick={() => handleDeleteColumn(col._id)} className="p-0.5 hover:bg-bg-hover rounded text-text-muted hover:text-red-400" title="删除"><Trash2 size={12} /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {columns.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-text-muted text-xs gap-2">
            <Plus size={24} className="opacity-30" />
            <span>点击「添加字段」开始设计</span>
          </div>
        )}
        <datalist id="mysql-types-new">
          <option value="int" /><option value="bigint" /><option value="tinyint(1)" /><option value="smallint" /><option value="varchar(255)" /><option value="char(36)" /><option value="text" /><option value="longtext" /><option value="mediumtext" /><option value="decimal(10,2)" /><option value="float" /><option value="double" /><option value="datetime" /><option value="timestamp" /><option value="date" /><option value="time" /><option value="json" /><option value="blob" /><option value="enum" />
        </datalist>
      </div>
    </div>
  )
}
