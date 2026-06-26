import { useState, useRef, useCallback } from 'react'
import { X, Terminal, Table as TableIcon, Eye } from 'lucide-react'
import { useTabStore } from '@stores/tab'
import type { Tab } from '@shared/types'

export default function TabBar() {
  const tabs = useTabStore((s) => s.tabs)
  const activeTabId = useTabStore((s) => s.activeTabId)
  const setActiveTab = useTabStore((s) => s.setActiveTab)
  const closeTab = useTabStore((s) => s.closeTab)
  const reorderTabs = useTabStore((s) => s.reorderTabs)

  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dropIndex, setDropIndex] = useState<number | null>(null)
  const dragNodeRef = useRef<HTMLDivElement | null>(null)

  const handleDragStart = useCallback((e: React.DragEvent, index: number) => {
    setDragIndex(index)
    dragNodeRef.current = e.currentTarget as HTMLDivElement
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(index))
    // 设置拖拽图像透明度
    if (dragNodeRef.current) dragNodeRef.current.style.opacity = '0.4'
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDropIndex(index)
  }, [])

  const handleDragEnd = useCallback(() => {
    if (dragNodeRef.current) dragNodeRef.current.style.opacity = '1'
    if (dragIndex !== null && dropIndex !== null && dragIndex !== dropIndex) {
      reorderTabs(dragIndex, dropIndex)
    }
    setDragIndex(null)
    setDropIndex(null)
    dragNodeRef.current = null
  }, [dragIndex, dropIndex, reorderTabs])

  if (tabs.length === 0) return null

  const getIcon = (tab: Tab) => {
    const size = 12
    if (tab.type === 'query') return <Terminal size={size} />
    if (tab.type === 'table-data') return <TableIcon size={size} className="text-blue-400" />
    if (tab.type === 'table-design') return <Eye size={size} className="text-purple-400" />
    return null
  }

  return (
    <div className="flex items-stretch bg-bg-secondary border-b border-border-light overflow-x-auto">
      {tabs.map((tab, index) => {
        const isActive = tab.id === activeTabId
        const isDragging = dragIndex === index
        const isDropTarget = dropIndex === index && dragIndex !== index
        return (
          <div
            key={tab.id}
            draggable
            onDragStart={(e) => handleDragStart(e, index)}
            onDragOver={(e) => handleDragOver(e, index)}
            onDragEnd={handleDragEnd}
            onClick={() => setActiveTab(tab.id)}
            className={`group flex items-center gap-2 px-3 py-2 cursor-pointer border-r border-border-light min-w-[120px] max-w-[240px] transition-colors select-none ${
              isActive
                ? 'bg-bg-primary text-text-primary border-t-2 border-t-accent'
                : 'text-text-secondary hover:bg-bg-hover border-t-2 border-t-transparent'
            } ${isDragging ? 'opacity-40' : ''} ${isDropTarget ? 'border-l-2 border-l-accent' : ''}`}
          >
            <span className="flex-shrink-0">{getIcon(tab)}</span>
            <span className="flex-1 truncate text-sm">{tab.title}</span>
            {tab.dirty && <span className="w-2 h-2 rounded-full bg-yellow-400 flex-shrink-0" />}
            <button
              onClick={(e) => {
                e.stopPropagation()
                closeTab(tab.id)
              }}
              className="p-0.5 rounded hover:bg-bg-hover opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
            >
              <X size={14} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
