import { useState, useCallback, useMemo } from 'react'
import {
  Plus,
  Trash2,
  Copy,
  Check,
  Play,
  Save,
  Search,
  FolderPlus,
  Pencil,
  ChevronDown,
  ChevronRight,
  FileCode2
} from 'lucide-react'
import { useSnippetStore, type SqlSnippet } from '@stores/snippet'
import { useTabStore } from '@stores/tab'
import { useBrowserStore } from '@stores/browser'
import SqlHighlight from './SqlHighlight'

const DEFAULT_CATEGORIES = ['通用', '查询', '维护', '统计', '安全']

export default function SnippetPanel() {
  const {
    snippets,
    selectedSnippetId,
    selectSnippet,
    saveSnippet,
    updateSnippet,
    deleteSnippet,
    getCategories
  } = useSnippetStore()

  const openTab = useTabStore((s) => s.openTab)
  const { selectedConnectionId, selectedDatabase } = useBrowserStore()

  const [search, setSearch] = useState('')
  const [filterCategory, setFilterCategory] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState('')
  const [editCategory, setEditCategory] = useState('通用')
  const [editSql, setEditSql] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [copied, setCopied] = useState<string | null>(null)
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set())
  const [showNewCategory, setShowNewCategory] = useState(false)
  const [newCategory, setNewCategory] = useState('')

  const categories = useMemo(() => {
    const cats = getCategories()
    const all = new Set([...DEFAULT_CATEGORIES, ...cats])
    return [...all]
  }, [getCategories, snippets])

  const filteredSnippets = useMemo(() => {
    let result = snippets
    if (filterCategory) result = result.filter((s) => s.category === filterCategory)
    if (search) {
      const q = search.toLowerCase()
      result = result.filter((s) =>
        s.name.toLowerCase().includes(q) ||
        s.sql.toLowerCase().includes(q) ||
        (s.description ?? '').toLowerCase().includes(q)
      )
    }
    return result
  }, [snippets, filterCategory, search])

  const groupedSnippets = useMemo(() => {
    const groups: Record<string, SqlSnippet[]> = {}
    for (const s of filteredSnippets) {
      if (!groups[s.category]) groups[s.category] = []
      groups[s.category].push(s)
    }
    return groups
  }, [filteredSnippets])

  const selectedSnippet = snippets.find((s) => s.id === selectedSnippetId)

  const handleNew = useCallback(() => {
    setEditing(true)
    setEditName('')
    setEditCategory(filterCategory ?? '通用')
    setEditSql('')
    setEditDescription('')
    selectSnippet(null)
  }, [filterCategory, selectSnippet])

  const handleEdit = useCallback((snippet: SqlSnippet) => {
    setEditing(true)
    setEditName(snippet.name)
    setEditCategory(snippet.category)
    setEditSql(snippet.sql)
    setEditDescription(snippet.description ?? '')
    selectSnippet(snippet.id)
  }, [selectSnippet])

  const handleSave = useCallback(() => {
    if (!editName.trim() || !editSql.trim()) return
    if (selectedSnippetId && editing && snippets.find((s) => s.id === selectedSnippetId)) {
      updateSnippet(selectedSnippetId, {
        name: editName.trim(),
        category: editCategory,
        sql: editSql,
        description: editDescription || undefined
      })
    } else {
      saveSnippet(editName.trim(), editSql, editCategory, editDescription || undefined)
    }
    setEditing(false)
  }, [editName, editCategory, editSql, editDescription, selectedSnippetId, editing, snippets, saveSnippet, updateSnippet])

  const handleDelete = useCallback((id: string) => {
    if (confirm('确定删除此 SQL 片段？')) {
      deleteSnippet(id)
      if (selectedSnippetId === id) setEditing(false)
    }
  }, [deleteSnippet, selectedSnippetId])

  const handleCopy = useCallback((sql: string, id: string) => {
    navigator.clipboard.writeText(sql)
    setCopied(id)
    setTimeout(() => setCopied(null), 2000)
  }, [])

  const handleInsertToQuery = useCallback((sql: string) => {
    if (!selectedConnectionId || !selectedDatabase) {
      alert('请先选择一个数据库')
      return
    }
    // 替换变量占位符
    let finalSql = sql
    const vars = sql.match(/\{\{(\w+)\}\}/g)
    if (vars) {
      for (const v of vars) {
        const name = v.slice(2, -2)
        const value = prompt(`请输入变量 ${name} 的值：`, name)
        if (value === null) return
        finalSql = finalSql.replace(new RegExp(v.replace(/[{}]/g, '\\$&'), 'g'), value)
      }
    }
    openTab({
      id: `query-${Date.now()}`,
      type: 'query',
      title: `Query - ${selectedDatabase}`,
      connectionId: selectedConnectionId,
      database: selectedDatabase
    })
    // 将 SQL 设到活动查询
    useBrowserStore.getState().setActiveQuerySql(finalSql)
  }, [selectedConnectionId, selectedDatabase, openTab])

  const handleRunSnippet = useCallback((sql: string) => {
    if (!selectedConnectionId || !selectedDatabase) {
      alert('请先选择一个数据库')
      return
    }
    let finalSql = sql
    const vars = sql.match(/\{\{(\w+)\}\}/g)
    if (vars) {
      for (const v of vars) {
        const name = v.slice(2, -2)
        const value = prompt(`请输入变量 ${name} 的值：`, name)
        if (value === null) return
        finalSql = finalSql.replace(new RegExp(v.replace(/[{}]/g, '\\$&'), 'g'), value)
      }
    }
    openTab({
      id: `query-${Date.now()}`,
      type: 'query',
      title: `Run - ${selectedDatabase}`,
      connectionId: selectedConnectionId,
      database: selectedDatabase
    })
    useBrowserStore.getState().setActiveQuerySql(finalSql)
  }, [selectedConnectionId, selectedDatabase, openTab])

  const toggleCategory = (cat: string) => {
    setCollapsedCategories((prev) => {
      const next = new Set(prev)
      if (next.has(cat)) next.delete(cat)
      else next.add(cat)
      return next
    })
  }

  return (
    <div className="flex flex-col h-full bg-bg-primary">
      {/* 工具栏 */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-border-light bg-bg-secondary">
        <button
          onClick={handleNew}
          className="flex items-center gap-1 px-1.5 py-1 rounded text-xs hover:bg-bg-hover text-text-secondary hover:text-text-primary transition-colors"
          title="新建片段"
        >
          <Plus size={13} />
        </button>
        <div className="flex-1" />
        <select
          value={filterCategory ?? ''}
          onChange={(e) => setFilterCategory(e.target.value || null)}
          className="px-1.5 py-0.5 text-xs bg-bg-primary border border-border-light rounded text-text-primary focus:outline-none"
        >
          <option value="">全部分类</option>
          {categories.map((cat) => (
            <option key={cat} value={cat}>{cat}</option>
          ))}
        </select>
        <div className="relative">
          <Search size={11} className="absolute left-1.5 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索…"
            className="w-20 pl-5 pr-1 py-0.5 text-xs bg-bg-primary border border-border-light rounded text-text-primary focus:outline-none focus:border-accent"
          />
        </div>
      </div>

      {/* 主区域 */}
      <div className="flex-1 flex overflow-hidden">
        {/* 左侧列表 */}
        <div className="w-56 border-r border-border-light overflow-y-auto flex-shrink-0">
          {filteredSnippets.length === 0 && (
            <div className="flex flex-col items-center justify-center py-8 text-text-muted text-xs gap-2">
              <FileCode2 size={24} className="opacity-30" />
              <span>{snippets.length === 0 ? '暂无 SQL 片段' : '没有匹配结果'}</span>
              <span className="text-[10px]">点击 + 创建第一个片段</span>
            </div>
          )}
          {Object.entries(groupedSnippets).map(([cat, items]) => (
            <div key={cat}>
              <div
                className="flex items-center gap-1 px-2 py-1 bg-bg-tertiary/50 border-b border-border-light cursor-pointer hover:bg-bg-hover"
                onClick={() => toggleCategory(cat)}
              >
                {collapsedCategories.has(cat) ? (
                  <ChevronRight size={11} className="text-text-muted" />
                ) : (
                  <ChevronDown size={11} className="text-text-muted" />
                )}
                <span className="flex-1 text-[10px] font-semibold text-text-secondary uppercase tracking-wide">{cat}</span>
                <span className="text-[9px] text-text-muted">{items.length}</span>
              </div>
              {!collapsedCategories.has(cat) && items.map((s) => (
                <div
                  key={s.id}
                  onClick={() => { selectSnippet(s.id); setEditing(false) }}
                  className={`px-2 py-1.5 cursor-pointer border-b border-border-light/30 transition-colors group ${
                    selectedSnippetId === s.id
                      ? 'bg-accent/20 border-l-2 border-l-accent'
                      : 'hover:bg-bg-hover border-l-2 border-l-transparent'
                  }`}
                >
                  <div className="flex items-center gap-1">
                    <FileCode2 size={11} className="text-blue-400 flex-shrink-0" />
                    <span className={`flex-1 truncate text-xs ${selectedSnippetId === s.id ? 'text-text-primary font-medium' : 'text-text-primary/90'}`}>
                      {s.name}
                    </span>
                  </div>
                  <div className="text-[10px] text-text-muted truncate mt-0.5 font-mono pl-4">
                    {s.sql.split('\n')[0].slice(0, 40)}{s.sql.length > 40 ? '…' : ''}
                  </div>
                  {s.variables && s.variables.length > 0 && (
                    <div className="flex gap-0.5 mt-0.5 pl-4">
                      {s.variables.slice(0, 3).map((v) => (
                        <span key={v} className="text-[8px] px-0.5 rounded bg-yellow-900/40 text-yellow-400">{v}</span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>

        {/* 右侧内容区 */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {editing ? (
            /* 编辑模式 */
            <div className="flex flex-col h-full">
              <div className="px-3 py-2 border-b border-border-light bg-bg-secondary space-y-2">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    placeholder="片段名称"
                    className="flex-1 px-2 py-1 bg-bg-primary border border-border-light rounded text-xs text-text-primary focus:outline-none focus:border-accent"
                  />
                  <div className="flex items-center gap-1">
                    <select
                      value={editCategory}
                      onChange={(e) => setEditCategory(e.target.value)}
                      className="px-2 py-1 text-xs bg-bg-primary border border-border-light rounded text-text-primary focus:outline-none"
                    >
                      {categories.map((cat) => (
                        <option key={cat} value={cat}>{cat}</option>
                      ))}
                    </select>
                    {showNewCategory ? (
                      <div className="flex gap-1">
                        <input
                          type="text"
                          value={newCategory}
                          onChange={(e) => setNewCategory(e.target.value)}
                          placeholder="新分类"
                          className="w-20 px-2 py-1 text-xs bg-bg-primary border border-border-light rounded text-text-primary focus:outline-none"
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && newCategory.trim()) {
                              setEditCategory(newCategory.trim())
                              setShowNewCategory(false)
                              setNewCategory('')
                            }
                            if (e.key === 'Escape') setShowNewCategory(false)
                          }}
                          autoFocus
                        />
                      </div>
                    ) : (
                      <button
                        onClick={() => setShowNewCategory(true)}
                        className="p-1 rounded hover:bg-bg-hover text-text-muted"
                        title="新建分类"
                      >
                        <FolderPlus size={12} />
                      </button>
                    )}
                  </div>
                </div>
                <input
                  type="text"
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  placeholder="描述（可选）"
                  className="w-full px-2 py-1 bg-bg-primary border border-border-light rounded text-xs text-text-primary focus:outline-none focus:border-accent"
                />
              </div>
              <textarea
                value={editSql}
                onChange={(e) => setEditSql(e.target.value)}
                placeholder={"-- 输入 SQL 模板\n-- 使用 {{变量名}} 作为占位符\nSELECT * FROM {{table}} WHERE id = {{id}}"}
                className="flex-1 p-3 bg-bg-primary text-sm font-mono text-text-primary resize-none focus:outline-none border-b border-border-light"
                spellCheck={false}
              />
              <div className="flex items-center justify-between px-3 py-2 bg-bg-secondary">
                <span className="text-[10px] text-text-muted">
                  {editSql.length > 0 && editSql.match(/\{\{(\w+)\}\}/g)
                    ? `变量: ${[...new Set(editSql.match(/\{\{(\w+)\}\}/g))].join(', ')}`
                    : '使用 {{name}} 插入变量占位符'
                  }
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => setEditing(false)}
                    className="px-3 py-1 text-xs rounded hover:bg-bg-hover text-text-secondary transition-colors"
                  >
                    取消
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={!editName.trim() || !editSql.trim()}
                    className="flex items-center gap-1 px-3 py-1 text-xs bg-accent text-white rounded hover:bg-accent/80 transition-colors disabled:opacity-50"
                  >
                    <Save size={11} /> 保存
                  </button>
                </div>
              </div>
            </div>
          ) : selectedSnippet ? (
            /* 查看模式 */
            <div className="flex flex-col h-full">
              <div className="px-3 py-2 border-b border-border-light bg-bg-secondary">
                <div className="flex items-center gap-2">
                  <FileCode2 size={13} className="text-blue-400" />
                  <span className="text-sm font-medium text-text-primary flex-1">{selectedSnippet.name}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-bg-primary text-text-secondary">{selectedSnippet.category}</span>
                </div>
                {selectedSnippet.description && (
                  <p className="text-xs text-text-muted mt-1">{selectedSnippet.description}</p>
                )}
                {selectedSnippet.variables && selectedSnippet.variables.length > 0 && (
                  <div className="flex gap-1 mt-1.5">
                    {selectedSnippet.variables.map((v) => (
                      <span key={v} className="text-[10px] px-1 py-0.5 rounded bg-yellow-900/40 text-yellow-400 font-mono">{v}</span>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex-1 overflow-auto p-3">
                <pre className="text-xs font-mono whitespace-pre-wrap leading-relaxed">
                  <SqlHighlight sql={selectedSnippet.sql} />
                </pre>
              </div>
              <div className="flex items-center gap-2 px-3 py-2 border-t border-border-light bg-bg-secondary">
                <button
                  onClick={() => handleCopy(selectedSnippet.sql, selectedSnippet.id)}
                  className="flex items-center gap-1 px-2 py-1 text-xs rounded hover:bg-bg-hover text-text-secondary transition-colors"
                >
                  {copied === selectedSnippet.id ? <Check size={11} className="text-green-400" /> : <Copy size={11} />}
                  {copied === selectedSnippet.id ? '已复制' : '复制'}
                </button>
                <button
                  onClick={() => handleInsertToQuery(selectedSnippet.sql)}
                  className="flex items-center gap-1 px-2 py-1 text-xs rounded hover:bg-bg-hover text-text-secondary transition-colors"
                  title="插入到查询编辑器"
                >
                  <Pencil size={11} /> 插入查询
                </button>
                <button
                  onClick={() => handleRunSnippet(selectedSnippet.sql)}
                  className="flex items-center gap-1 px-2 py-1 text-xs rounded hover:bg-bg-hover text-blue-400 transition-colors"
                  title="直接运行"
                >
                  <Play size={11} /> 运行
                </button>
                <div className="flex-1" />
                <button
                  onClick={() => handleEdit(selectedSnippet)}
                  className="flex items-center gap-1 px-2 py-1 text-xs rounded hover:bg-bg-hover text-text-secondary transition-colors"
                >
                  <Pencil size={11} /> 编辑
                </button>
                <button
                  onClick={() => handleDelete(selectedSnippet.id)}
                  className="flex items-center gap-1 px-2 py-1 text-xs rounded hover:bg-bg-hover text-red-400 transition-colors"
                >
                  <Trash2 size={11} /> 删除
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-text-muted gap-3">
              <FileCode2 size={36} className="opacity-20" />
              <p className="text-sm">选择一个 SQL 片段</p>
              <p className="text-xs">或点击 + 创建新片段</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
