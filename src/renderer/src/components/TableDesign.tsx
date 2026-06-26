import { useState, useEffect, useCallback } from 'react'
import { Loader2, AlertCircle, Key, Hash, Type, Calendar, ToggleLeft } from 'lucide-react'
import { useConnectionStore } from '@stores/connection'
import type { Tab, ColumnInfo, IndexInfo } from '@shared/types'

interface Props {
  tab: Tab
}

export default function TableDesign({ tab }: Props) {
  const connections = useConnectionStore((s) => s.connections)
  const config = connections.find((c) => c.id === tab.connectionId)

  const [columns, setColumns] = useState<ColumnInfo[]>([])
  const [indexes, setIndexes] = useState<IndexInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'columns' | 'indexes' | 'info'>('columns')

  const loadData = useCallback(async () => {
    if (!config || !tab.database || !tab.table) return
    setLoading(true)
    setError(null)

    try {
      const [colRes, idxRes] = await Promise.all([
        window.api.db.getTableColumns(config, tab.database, tab.table),
        window.api.db.getTableIndexes(config, tab.database, tab.table)
      ])

      if (!colRes.success) throw new Error(colRes.error)
      setColumns(colRes.data ?? [])

      if (idxRes.success) {
        setIndexes(idxRes.data ?? [])
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [config, tab.database, tab.table])

  useEffect(() => {
    loadData()
  }, [loadData])

  const getColumnIcon = (type: string) => {
    const baseType = type.toLowerCase()
    if (baseType.includes('int') || baseType.includes('float') || baseType.includes('double') || baseType.includes('decimal')) {
      return <Hash size={12} className="text-blue-400" />
    }
    if (baseType.includes('char') || baseType.includes('text')) {
      return <Type size={12} className="text-green-400" />
    }
    if (baseType.includes('date') || baseType.includes('time')) {
      return <Calendar size={12} className="text-orange-400" />
    }
    if (baseType.includes('bool') || baseType.includes('tinyint(1)')) {
      return <ToggleLeft size={12} className="text-purple-400" />
    }
    return <Hash size={12} className="text-text-muted" />
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-text-secondary text-sm gap-2">
        <Loader2 size={16} className="animate-spin text-accent" />
        加载表结构...
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-start gap-2 p-4 text-sm text-red-400">
        <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
        <pre className="whitespace-pre-wrap break-words font-mono text-xs">{error}</pre>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Tab 切换 */}
      <div className="flex items-center border-b border-border-light bg-bg-secondary">
        {([
          { key: 'columns', label: '字段', count: columns.length },
          { key: 'indexes', label: '索引', count: indexes.length },
          { key: 'info', label: '信息' }
        ] as const).map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`px-4 py-2 text-xs font-medium transition-colors border-b-2 ${
              activeTab === t.key
                ? 'text-text-primary border-accent'
                : 'text-text-secondary border-transparent hover:text-text-primary'
            }`}
          >
            {t.label}
            {t.count !== undefined && (
              <span className="ml-1 text-text-muted">({t.count})</span>
            )}
          </button>
        ))}
      </div>

      {/* 内容区 */}
      <div className="flex-1 overflow-auto">
        {/* 字段列表 */}
        {activeTab === 'columns' && (
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-bg-secondary z-10">
              <tr>
                <th className="px-3 py-2 text-left text-text-secondary font-medium border-b border-border-light w-8"></th>
                <th className="px-3 py-2 text-left text-text-secondary font-medium border-b border-border-light">字段名</th>
                <th className="px-3 py-2 text-left text-text-secondary font-medium border-b border-border-light">类型</th>
                <th className="px-3 py-2 text-center text-text-secondary font-medium border-b border-border-light w-16">允许空</th>
                <th className="px-3 py-2 text-left text-text-secondary font-medium border-b border-border-light">默认值</th>
                <th className="px-3 py-2 text-left text-text-secondary font-medium border-b border-border-light">额外</th>
                <th className="px-3 py-2 text-left text-text-secondary font-medium border-b border-border-light">注释</th>
              </tr>
            </thead>
            <tbody>
              {columns.map((col, idx) => (
                <tr key={col.name} className="hover:bg-bg-hover">
                  <td className="px-3 py-1.5 border-b border-border-light text-center">
                    {col.isPrimaryKey ? (
                      <Key size={12} className="text-yellow-400 inline" />
                    ) : (
                      <span className="text-text-muted">{idx + 1}</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 border-b border-border-light font-mono text-text-primary">
                    {col.name}
                  </td>
                  <td className="px-3 py-1.5 border-b border-border-light font-mono text-accent-light">
                    <span className="flex items-center gap-1">
                      {getColumnIcon(col.type)}
                      {col.type}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 border-b border-border-light text-center">
                    {col.nullable ? (
                      <span className="text-green-400">YES</span>
                    ) : (
                      <span className="text-red-400">NO</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 border-b border-border-light font-mono text-text-muted">
                    {col.defaultValue ?? (col.nullable ? 'NULL' : '')}
                  </td>
                  <td className="px-3 py-1.5 border-b border-border-light font-mono text-text-muted text-[10px]">
                    {col.extra || '-'}
                  </td>
                  <td className="px-3 py-1.5 border-b border-border-light text-text-secondary max-w-xs truncate">
                    {col.comment || '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* 索引列表 */}
        {activeTab === 'indexes' && (
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-bg-secondary z-10">
              <tr>
                <th className="px-3 py-2 text-left text-text-secondary font-medium border-b border-border-light">索引名</th>
                <th className="px-3 py-2 text-left text-text-secondary font-medium border-b border-border-light">字段</th>
                <th className="px-3 py-2 text-center text-text-secondary font-medium border-b border-border-light w-20">唯一</th>
                <th className="px-3 py-2 text-left text-text-secondary font-medium border-b border-border-light">类型</th>
              </tr>
            </thead>
            <tbody>
              {indexes.length === 0 ? (
                <tr>
                  <td colSpan={4} className="text-center text-text-muted py-4">
                    无索引
                  </td>
                </tr>
              ) : (
                indexes.map((idx, i) => (
                  <tr key={i} className="hover:bg-bg-hover">
                    <td className="px-3 py-1.5 border-b border-border-light font-mono text-text-primary">
                      {idx.name}
                    </td>
                    <td className="px-3 py-1.5 border-b border-border-light font-mono text-accent-light">
                      {idx.column}
                    </td>
                    <td className="px-3 py-1.5 border-b border-border-light text-center">
                      {idx.isUnique ? (
                        <span className="text-green-400">YES</span>
                      ) : (
                        <span className="text-text-muted">NO</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 border-b border-border-light font-mono text-text-muted">
                      {idx.type}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}

        {/* 表信息 */}
        {activeTab === 'info' && (
          <div className="p-4 space-y-2 text-sm">
            <div className="flex gap-4">
              <span className="text-text-secondary w-32">数据库:</span>
              <span className="font-mono text-text-primary">{tab.database}</span>
            </div>
            <div className="flex gap-4">
              <span className="text-text-secondary w-32">表名:</span>
              <span className="font-mono text-text-primary">{tab.table}</span>
            </div>
            <div className="flex gap-4">
              <span className="text-text-secondary w-32">字段数:</span>
              <span className="font-mono text-text-primary">{columns.length}</span>
            </div>
            <div className="flex gap-4">
              <span className="text-text-secondary w-32">索引数:</span>
              <span className="font-mono text-text-primary">{indexes.length}</span>
            </div>
            <div className="flex gap-4">
              <span className="text-text-secondary w-32">主键:</span>
              <span className="font-mono text-text-primary">
                {columns.filter((c) => c.isPrimaryKey).map((c) => c.name).join(', ') || '无'}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
