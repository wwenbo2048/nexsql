import { useTabStore } from '@stores/tab'
import TabBar from './TabBar'
import QueryEditor from './QueryEditor'
import DataTable from './DataTable'
import TableDesign from './TableDesign'
import RedisBrowser from './RedisBrowser'
import { Terminal, Database } from 'lucide-react'
import { useConnectionStore } from '@stores/connection'

export default function MainContent() {
  const tabs = useTabStore((s) => s.tabs)
  const activeTabId = useTabStore((s) => s.activeTabId)
  const activeTab = tabs.find((t) => t.id === activeTabId)
  const connections = useConnectionStore((s) => s.connections)

  if (!activeTab) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-bg-primary text-text-muted">
        <Database size={48} className="opacity-30 mb-3" />
        <p className="text-sm">选择一个连接开始</p>
        <p className="text-xs mt-1">双击表名查看数据，或右键新建查询</p>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-bg-primary">
      <TabBar />
      <div className="flex-1 overflow-hidden">
        {activeTab.type === 'query' && <QueryEditor tab={activeTab} />}
        {activeTab.type === 'table-data' && <DataTable tab={activeTab} />}
        {activeTab.type === 'table-design' && <TableDesign tab={activeTab} />}
        {activeTab.type === 'redis-browser' && (() => {
          const conn = connections.find((c) => c.id === activeTab.connectionId)
          return conn ? <RedisBrowser config={conn} onClose={() => useTabStore.getState().closeTab(activeTab.id)} /> : null
        })()}
      </div>
    </div>
  )
}
