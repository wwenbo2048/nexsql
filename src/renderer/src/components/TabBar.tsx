import { useState, useRef, useCallback, useEffect } from 'react'
import { X, Terminal, Table as TableIcon, Eye, Network, FolderTree, Plus } from 'lucide-react'
import { useTabStore } from '@stores/tab'
import { useBrowserStore } from '@stores/browser'
import type { Tab } from '@shared/types'

interface TabContextMenu {
  x: number
  y: number
  tabId: string
  index: number
}

export default function TabBar() {
  const tabs = useTabStore((s) => s.tabs)
  const activeTabId = useTabStore((s) => s.activeTabId)
  const setActiveTab = useTabStore((s) => s.setActiveTab)
  const closeTab = useTabStore((s) => s.closeTab)
  const closeOtherTabs = useTabStore((s) => s.closeOtherTabs)
  const closeTabsToRight = useTabStore((s) => s.closeTabsToRight)
  const closeAllTabs = useTabStore((s) => s.closeAllTabs)
  const reorderTabs = useTabStore((s) => s.reorderTabs)
  const openQuery = useTabStore((s) => s.openQuery)

  const { selectedConnectionId, selectedDatabase } = useBrowserStore()

  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dropIndex, setDropIndex] = useState<number | null>(null)
  const dragNodeRef = useRef<HTMLDivElement | null>(null)
  const [ctxMenu, setCtxMenu] = useState<TabContextMenu | null>(null)

  // 点击其他地方关闭右键菜单
  useEffect(() => {
    if (!ctxMenu) return
    const close = () => setCtxMenu(null)
    window.addEventListener('click', close)
    window.addEventListener('contextmenu', close)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('contextmenu', close)
    }
  }, [ctxMenu])

  const handleDragStart = useCallback((e: React.DragEvent, index: number) => {
    setDragIndex(index)
    dragNodeRef.current = e.currentTarget as HTMLDivElement
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(index))
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
      // 不允许拖到 browser tab 之前（index 0）
      if (dropIndex > 0) {
        reorderTabs(dragIndex, dropIndex)
      }
    }
    setDragIndex(null)
    setDropIndex(null)
    dragNodeRef.current = null
  }, [dragIndex, dropIndex, reorderTabs])

  const handleAddTab = useCallback(() => {
    if (selectedConnectionId && selectedDatabase) {
      openQuery(selectedConnectionId, selectedDatabase)
    } else {
      // 没有选择数据库时，仍然打开一个空查询 tab
      if (selectedConnectionId) {
        openQuery(selectedConnectionId)
      }
    }
  }, [selectedConnectionId, selectedDatabase, openQuery])

  const getIcon = (tab: Tab) => {
    const size = 12
    if (tab.type === 'browser') return <FolderTree size={size} className="text-accent-light" />
    if (tab.type === 'query') return <Terminal size={size} />
    if (tab.type === 'table-data') return <TableIcon size={size} className="text-blue-400" />
    if (tab.type === 'table-design') return <Eye size={size} className="text-purple-400" />
    if (tab.type === 'er') return <Network size={size} className="text-green-400" />
    return null
  }

  return (
    <div className="flex items-stretch bg-bg-secondary border-b border-border-light overflow-x-auto flex-shrink-0">
      {tabs.map((tab, index) => {
        const isActive = tab.id === activeTabId
        const isDragging = dragIndex === index
        const isDropTarget = dropIndex === index && dragIndex !== index
        const isBrowser = tab.type === 'browser'
        return (
          <div
            key={tab.id}
            draggable={!isBrowser}
            onDragStart={(e) => !isBrowser && handleDragStart(e, index)}
            onDragOver={(e) => handleDragOver(e, index)}
            onDragEnd={handleDragEnd}
            onClick={() => setActiveTab(tab.id)}
            onContextMenu={(e) => {
              if (isBrowser) return
              e.preventDefault()
              e.stopPropagation()
              setCtxMenu({ x: e.clientX, y: e.clientY, tabId: tab.id, index })
            }}
            title={tab.database ? `${tab.database} › ${tab.title}` : tab.title}
            className={`group flex items-center gap-2 px-3 py-2 cursor-pointer border-r border-border-light min-w-[100px] max-w-[240px] transition-colors select-none ${
              isActive
                ? 'bg-bg-primary text-text-primary border-t-2 border-t-accent'
                : 'text-text-secondary hover:bg-bg-hover border-t-2 border-t-transparent'
            } ${isDragging ? 'opacity-40' : ''} ${isDropTarget ? 'border-l-2 border-l-accent' : ''}`}
          >
            <span className="flex-shrink-0">{getIcon(tab)}</span>
            <div className="flex-1 min-w-0 flex items-center gap-1.5">
              <span className="truncate text-sm">{tab.title}</span>
              {tab.database && !isBrowser && tab.type !== 'query' && (
                <span className="flex-shrink-0 text-[10px] text-text-muted bg-bg-tertiary/60 px-1 py-px rounded truncate max-w-[80px]">
                  {tab.database}
                </span>
              )}
            </div>
            {tab.dirty && <span className="w-2 h-2 rounded-full bg-yellow-400 flex-shrink-0" />}
            {!isBrowser && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  closeTab(tab.id)
                }}
                className="p-0.5 rounded hover:bg-bg-hover opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
              >
                <X size={14} />
              </button>
            )}
          </div>
        )
      })}

      {/* + 按钮：新建查询标签 */}
      <button
        onClick={handleAddTab}
        disabled={!selectedConnectionId}
        className="flex items-center justify-center w-9 flex-shrink-0 text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors disabled:opacity-30 disabled:cursor-not-allowed border-r border-border-light"
        title="新建查询"
      >
        <Plus size={16} />
      </button>

      {/* 右键菜单 */}
      {ctxMenu && (() => {
        const targetIdx = tabs.findIndex((t) => t.id === ctxMenu.tabId)
        const hasTabsToRight = targetIdx >= 0 && targetIdx < tabs.length - 1
        const closableCount = tabs.filter((t) => t.type !== 'browser').length
        const menuItemCls = 'px-3 py-1.5 text-xs hover:bg-bg-hover text-text-primary cursor-pointer transition-colors whitespace-nowrap'
        const disabledCls = 'px-3 py-1.5 text-xs text-text-muted cursor-not-allowed whitespace-nowrap'
        return (
          <div
            className="fixed z-[9999] bg-bg-tertiary border border-border rounded-md shadow-2xl py-1 min-w-[130px]"
            style={{ left: ctxMenu.x, top: ctxMenu.y }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className={menuItemCls}
              onClick={() => { closeTab(ctxMenu.tabId); setCtxMenu(null) }}
            >关闭</div>
            <div
              className={closableCount > 1 ? menuItemCls : disabledCls}
              onClick={() => { if (closableCount > 1) { closeOtherTabs(ctxMenu.tabId); setCtxMenu(null) } }}
            >关闭其他</div>
            <div
              className={hasTabsToRight ? menuItemCls : disabledCls}
              onClick={() => { if (hasTabsToRight) { closeTabsToRight(ctxMenu.tabId); setCtxMenu(null) } }}
            >关闭右侧</div>
            <div className="my-1 border-t border-border-light" />
            <div
              className={closableCount > 0 ? menuItemCls : disabledCls}
              onClick={() => { if (closableCount > 0) { closeAllTabs(); setCtxMenu(null) } }}
            >关闭全部</div>
          </div>
        )
      })()}
    </div>
  )
}
