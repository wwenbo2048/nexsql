import { useState, useEffect, useCallback, type ReactNode } from 'react'
import { Table as TableIcon, Database as DatabaseIcon, Loader2, AlertCircle, Copy, Check, Info, Hash, HardDrive, Cog, Clock, Calendar, Type as TypeIcon, Layers, Key, MessageSquare, Zap } from 'lucide-react'
import { useBrowserStore, type DetailTab as StoreDetailTab } from '@stores/browser'
import { useConnectionStore } from '@stores/connection'
import type { Tab, TableDetails, TriggerInfo } from '@shared/types'
import DataTable from './DataTable'
import StructureEditor from './StructureEditor'
import SqlHighlight from './SqlHighlight'
import NewTableDesigner from './NewTableDesigner'
import NewViewDesigner from './NewViewDesigner'
import NewRoutineDesigner from './NewRoutineDesigner'
import NewEventDesigner from './NewEventDesigner'
import ViewDetailPanel from './ViewDetailPanel'
import RoutineDetailPanel from './RoutineDetailPanel'
import EventDetailPanel from './EventDetailPanel'
import EditableObjectEditor from './EditableObjectEditor'
import QueryPanel from './QueryPanel'
import ERDiagramView from './ERDiagramView'
import TableCompareView from './TableCompareView'
import SnippetPanel from './SnippetPanel'

type DetailTab = 'info' | 'data' | 'structure' | 'ddl' | 'er'

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${units[i]}`
}

function formatNumber(n: number | null | undefined): string {
  if (n === null || n === undefined) return '-'
  return n.toLocaleString()
}

export default function TableDetailPanel() {
  const connections = useConnectionStore((s) => s.connections)
  const { selectedConnectionId, selectedDatabase, selectedTable, isCreating, isEditing, selectedCategory, routines, preferredDetailTab, compareSource, setCompareSource } = useBrowserStore()
  const [activeTab, setActiveTab] = useState<DetailTab>('info')

  // 单击/双击表时，根据 store 的 preferredDetailTab 切换标签页
  useEffect(() => {
    if (preferredDetailTab) {
      setActiveTab(preferredDetailTab)
    }
  }, [preferredDetailTab, selectedTable])

  // 表编辑模式 — 自动切换到结构标签页
  useEffect(() => {
    if (isEditing && selectedCategory === 'tables') {
      setActiveTab('structure')
    }
  }, [isEditing, selectedCategory])

  const config = connections.find((c) => c.id === selectedConnectionId)

  // Table details data
  const [details, setDetails] = useState<TableDetails | null>(null)
  const [detailsLoading, setDetailsLoading] = useState(false)

  // DDL data
  const [ddl, setDdl] = useState('')
  const [ddlLoading, setDdlLoading] = useState(false)
  const [triggers, setTriggers] = useState<TriggerInfo[]>([])
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const loadDetails = useCallback(async () => {
    if (!config || !selectedDatabase || !selectedTable) return
    setDetailsLoading(true)
    setError(null)
    try {
      const res = await window.api.db.getTableDetails(config, selectedDatabase, selectedTable)
      if (res.success) setDetails(res.data ?? null)
      else setError(res.error ?? '加载失败')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setDetailsLoading(false)
    }
  }, [config, selectedDatabase, selectedTable])

  const loadDDL = useCallback(async () => {
    if (!config || !selectedDatabase || !selectedTable) return
    setDdlLoading(true)
    try {
      const [ddlRes, trgRes] = await Promise.all([
        window.api.db.getTableDDL(config, selectedDatabase, selectedTable),
        window.api.db.getTableTriggers(config, selectedDatabase, selectedTable)
      ])
      if (ddlRes.success) setDdl(ddlRes.data ?? '')
      if (trgRes.success) setTriggers(trgRes.data ?? [])
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setDdlLoading(false)
    }
  }, [config, selectedDatabase, selectedTable])

  // Load details when table changes or info tab selected
  useEffect(() => {
    if (selectedTable && activeTab === 'info') {
      loadDetails()
    }
  }, [selectedTable, activeTab, loadDetails])

  // Load DDL when tab is ddl
  useEffect(() => {
    if (selectedTable && activeTab === 'ddl') {
      loadDDL()
    }
  }, [selectedTable, activeTab, loadDDL])

  const handleCopyDDL = useCallback(() => {
    navigator.clipboard.writeText(ddl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [ddl])

  // 构造虚拟 Tab 传给 DataTable
  const dataTableTab: Tab | null =
    selectedTable && config && selectedDatabase
      ? {
          id: `detail-data-${selectedConnectionId}-${selectedDatabase}-${selectedTable}`,
          type: 'table-data',
          title: selectedTable,
          connectionId: selectedConnectionId!,
          database: selectedDatabase,
          table: selectedTable
        }
      : null

  // 新建设计器模式 — 根据分类路由
  if (isCreating && selectedConnectionId && selectedDatabase) {
    if (selectedCategory === 'tables') return <NewTableDesigner />
    if (selectedCategory === 'views') return <NewViewDesigner />
    if (selectedCategory === 'functions') return <NewRoutineDesigner />
    if (selectedCategory === 'events') return <NewEventDesigner />
  }

  // 编辑模式 — 非表分类显示可编辑 DDL 编辑器
  if (isEditing && selectedTable && selectedConnectionId && selectedDatabase) {
    if (selectedCategory === 'views') {
      return (
        <EditableObjectEditor
          type="view"
          loadSql={`SHOW CREATE VIEW \`${selectedTable}\``}
          dropSql={`DROP VIEW IF EXISTS \`${selectedTable}\``}
        />
      )
    }
    if (selectedCategory === 'functions') {
      // 判断是 FUNCTION 还是 PROCEDURE
      const routine = routines.find((r) => r.name === selectedTable)
      const isFunc = routine?.type === 'FUNCTION'
      return (
        <EditableObjectEditor
          type={isFunc ? 'function' : 'procedure'}
          loadSql={isFunc ? `SHOW CREATE FUNCTION \`${selectedTable}\`` : `SHOW CREATE PROCEDURE \`${selectedTable}\``}
          dropSql={isFunc ? `DROP FUNCTION IF EXISTS \`${selectedTable}\`` : `DROP PROCEDURE IF EXISTS \`${selectedTable}\``}
        />
      )
    }
    if (selectedCategory === 'events') {
      return (
        <EditableObjectEditor
          type="event"
          loadSql={`SHOW CREATE EVENT \`${selectedTable}\``}
          dropSql={`DROP EVENT IF EXISTS \`${selectedTable}\``}
        />
      )
    }
  }

  // 查询分类 — 直接显示查询面板（不依赖 selectedTable）
  if (selectedCategory === 'query' && selectedConnectionId && selectedDatabase) {
    return <QueryPanel />
  }

  // ER 图分类
  if (selectedCategory === 'er' && selectedConnectionId && selectedDatabase) {
    return <ERDiagramView />
  }

  // SQL 片段分类
  if (selectedCategory === 'snippets' && selectedConnectionId && selectedDatabase) {
    return <SnippetPanel />
  }

  // 表结构对比模式
  if (compareSource && config && selectedConnectionId && selectedDatabase) {
    return (
      <div className="flex flex-col h-full bg-bg-primary">
        <div className="flex items-center justify-between px-3 py-1.5 border-b border-border-light bg-bg-secondary flex-shrink-0">
          <span className="text-xs font-medium text-text-primary">表结构对比：{compareSource.table}</span>
          <button
            onClick={() => setCompareSource(null)}
            className="px-2 py-0.5 text-xs rounded hover:bg-bg-hover text-text-secondary hover:text-text-primary transition-colors"
          >
            关闭
          </button>
        </div>
        <div className="flex-1 overflow-hidden">
          <TableCompareView
            leftConfig={config}
            leftDatabase={selectedDatabase}
            leftTable={compareSource.table}
            onClose={() => setCompareSource(null)}
          />
        </div>
      </div>
    )
  }

  // 非表分类 — 路由到各自的详情面板
  if (selectedTable && selectedCategory === 'views') return <ViewDetailPanel />
  if (selectedTable && selectedCategory === 'functions') return <RoutineDetailPanel />
  if (selectedTable && selectedCategory === 'events') return <EventDetailPanel />

  // 空状态
  if (!selectedConnectionId || !selectedDatabase) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-text-muted bg-bg-primary">
        <DatabaseIcon size={48} className="opacity-20 mb-3" />
        <p className="text-sm">选择一个数据库和表</p>
        <p className="text-xs mt-1">在左侧展开连接 → 选择数据库 → 点击表</p>
      </div>
    )
  }

  if (!selectedTable) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-text-muted bg-bg-primary">
        <TableIcon size={48} className="opacity-20 mb-3" />
        <p className="text-sm">未选择表</p>
        <p className="text-xs mt-1">在中间面板点击一张表查看详情</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-bg-primary">
      {/* Tab 切换 */}
      <div className="flex items-center border-b border-border-light bg-bg-secondary flex-shrink-0">
        {([
          { key: 'info' as const, label: '常规' },
          { key: 'data' as const, label: '数据' },
          { key: 'structure' as const, label: '结构' },
          { key: 'ddl' as const, label: 'DDL' }
        ]).map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`px-4 py-2 text-xs font-medium transition-colors border-b-2 ${
              activeTab === t.key
                ? 'text-text-primary border-accent bg-bg-primary'
                : 'text-text-secondary border-transparent hover:text-text-primary'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* 内容区 */}
      <div className="flex-1 overflow-hidden">
        {error && (
          <div className="flex items-start gap-2 p-3 text-sm text-red-400">
            <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
            <pre className="whitespace-pre-wrap break-words font-mono text-xs">{error}</pre>
          </div>
        )}

        {/* 常规标签页 — 只读基本信息 */}
        {activeTab === 'info' && (
          <div className="h-full overflow-auto">
            {detailsLoading ? (
              <div className="flex items-center justify-center h-full text-text-secondary text-sm gap-2">
                <Loader2 size={16} className="animate-spin text-accent" />
                加载表信息...
              </div>
            ) : details ? (
              <div className="p-4">
                {/* 表名标题 */}
                <div className="flex items-center gap-2 mb-4 pb-3 border-b border-border-light">
                  <Info size={16} className="text-accent" />
                  <span className="text-sm font-medium text-text-primary">{details.name}</span>
                </div>

                {/* 信息网格 */}
                <div className="grid grid-cols-2 gap-x-6 gap-y-0">
                  <InfoRow icon={<Hash size={13} />} label="行数" value={formatNumber(details.rows)} />
                  <InfoRow icon={<HardDrive size={13} />} label="数据长度" value={formatBytes(details.dataSize)} />
                  <InfoRow icon={<HardDrive size={13} />} label="索引长度" value={formatBytes(details.indexLength)} />
                  <InfoRow icon={<Cog size={13} />} label="引擎" value={details.engine || '-'} />
                  <InfoRow icon={<Clock size={13} />} label="创建时间" value={details.createTime ?? '-'} />
                  <InfoRow icon={<Calendar size={13} />} label="修改时间" value={details.updateTime ?? '-'} />
                  <InfoRow icon={<TypeIcon size={13} />} label="排序规则" value={details.collation ?? '-'} />
                  <InfoRow icon={<Layers size={13} />} label="行格式" value={details.rowFormat ?? '-'} />
                  <InfoRow icon={<Key size={13} />} label="自动递增" value={details.autoIncrement ? formatNumber(details.autoIncrement) : '-'} />
                </div>

                {/* 注释 — 单独一行 */}
                <div className="mt-4 pt-3 border-t border-border-light">
                  <div className="flex items-start gap-2">
                    <MessageSquare size={13} className="text-text-muted mt-0.5 flex-shrink-0" />
                    <div className="flex-1">
                      <span className="text-xs text-text-muted">注释</span>
                      <p className="text-xs text-text-primary mt-0.5">{details.comment || '(无)'}</p>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center h-full text-text-muted text-sm">无数据</div>
            )}
          </div>
        )}

        {/* 数据标签页 */}
        {activeTab === 'data' && dataTableTab && <DataTable tab={dataTableTab} />}

        {/* 结构标签页 — 可编辑 */}
        {activeTab === 'structure' && selectedConnectionId && selectedDatabase && selectedTable && (
          <StructureEditor
            connectionId={selectedConnectionId}
            database={selectedDatabase}
            table={selectedTable}
          />
        )}

        {/* DDL 标签页 */}
        {activeTab === 'ddl' && (
          <div className="h-full flex flex-col">
            <div className="flex items-center justify-between px-3 py-1 border-b border-border-light bg-bg-secondary flex-shrink-0">
              <span className="text-xs text-text-muted">SHOW CREATE TABLE</span>
              <button
                onClick={handleCopyDDL}
                className="flex items-center gap-1 px-2 py-0.5 text-xs hover:bg-bg-hover rounded text-text-secondary hover:text-text-primary transition-colors"
                title="复制 DDL"
              >
                {copied ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
                {copied ? '已复制' : '复制'}
              </button>
            </div>
            <div className="flex-1 overflow-auto p-3">
              {ddlLoading ? (
                <div className="flex items-center justify-center h-full text-text-secondary text-sm gap-2">
                  <Loader2 size={16} className="animate-spin text-accent" />
                  加载 DDL...
                </div>
              ) : (
                <>
                  {/* 表 DDL */}
                  <pre className="text-xs font-mono whitespace-pre-wrap leading-relaxed"><SqlHighlight sql={ddl} /></pre>

                  {/* 触发器 DDL */}
                  {triggers.length > 0 && (
                    <div className="mt-6">
                      <div className="flex items-center gap-1.5 mb-2 pb-1 border-b border-border-light">
                        <Zap size={12} className="text-yellow-400" />
                        <span className="text-xs font-medium text-text-secondary">触发器 ({triggers.length})</span>
                      </div>
                      {triggers.map((trg, idx) => (
                        <div key={idx} className="mb-4">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-[10px] px-1.5 py-0.5 bg-yellow-900/40 text-yellow-400 rounded font-mono">{trg.timing} {trg.event}</span>
                            <span className="text-xs font-mono text-accent">{trg.name}</span>
                          </div>
                          <pre className="text-xs font-mono whitespace-pre-wrap leading-relaxed pl-3 border-l-2 border-border-light"><SqlHighlight sql={`CREATE TRIGGER \`${trg.name}\` ${trg.timing} ${trg.event} ON \`${selectedTable}\` FOR EACH ROW ${trg.statement}`} /></pre>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}

      </div>
    </div>
  )
}

// ==================== 信息行子组件 ====================

function InfoRow({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 py-2 border-b border-border-light/30">
      <span className="text-text-muted flex-shrink-0">{icon}</span>
      <span className="text-xs text-text-muted w-20 flex-shrink-0">{label}</span>
      <span className="text-xs text-text-primary font-mono truncate">{value}</span>
    </div>
  )
}
