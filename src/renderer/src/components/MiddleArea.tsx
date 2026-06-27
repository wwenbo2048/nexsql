import { useTabStore } from '@stores/tab'
import TabBar from './TabBar'
import MiddlePanel from './MiddlePanel'
import QueryEditor from './QueryEditor'
import DataTable from './DataTable'
import StructureEditor from './StructureEditor'
import ERDiagramView from './ERDiagramView'
import { Database, Terminal } from 'lucide-react'
import type { Tab } from '@shared/types'

export default function MiddleArea() {
  const tabs = useTabStore((s) => s.tabs)
  const activeTabId = useTabStore((s) => s.activeTabId)
  const activeTab = tabs.find((t) => t.id === activeTabId)

  const renderContent = (tab: Tab | undefined) => {
    if (!tab) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center bg-bg-primary text-text-muted">
          <Database size={48} className="opacity-30 mb-3" />
          <p className="text-sm">选择一个连接开始</p>
        </div>
      )
    }

    switch (tab.type) {
      case 'browser':
        return <MiddlePanel />

      case 'query':
        return <QueryEditor tab={tab} />

      case 'table-data':
        return <DataTable tab={tab} />

      case 'table-design':
        if (tab.connectionId && tab.database && tab.table) {
          return (
            <StructureEditor
              connectionId={tab.connectionId}
              database={tab.database}
              table={tab.table}
            />
          )
        }
        return <EmptyTab icon="design" />

      case 'er':
        if (tab.connectionId && tab.database) {
          return <ERDiagramView />
        }
        return <EmptyTab icon="er" />

      default:
        return (
          <div className="flex-1 flex flex-col items-center justify-center bg-bg-primary text-text-muted">
            <Terminal size={48} className="opacity-30 mb-3" />
            <p className="text-sm">未知标签类型</p>
          </div>
        )
    }
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col h-full bg-bg-primary">
      <TabBar />
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">{renderContent(activeTab)}</div>
    </div>
  )
}

function EmptyTab({ icon }: { icon: string }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center bg-bg-primary text-text-muted">
      <Database size={48} className="opacity-30 mb-3" />
      <p className="text-sm">无法加载此标签页</p>
      <p className="text-xs mt-1">请确认已选择数据库</p>
    </div>
  )
}
