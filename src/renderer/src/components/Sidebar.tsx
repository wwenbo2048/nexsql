import { useRef, useCallback, useEffect } from 'react'
import {
  Plus,
  Database as DatabaseIcon,
  Terminal,
  ArrowLeftRight,
  RefreshCw,
  KeyRound,
} from 'lucide-react'
import { useUiStore } from '@stores/ui'
import { useTabStore } from '@stores/tab'
import { useBrowserStore } from '@stores/browser'
import ConnectionTree from './ConnectionTree'

export default function Sidebar() {
  const sidebarWidth = useUiStore((s) => s.sidebarWidth)
  const setSidebarWidth = useUiStore((s) => s.setSidebarWidth)
  const openConnectionModal = useUiStore((s) => s.openConnectionModal)
  const sidebarRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)

  // 快捷操作所需的状态
  const { selectedConnectionId, selectedDatabase, refreshList } = useBrowserStore()
  const openQuery = useTabStore((s) => s.openQuery)
  const openDbSync = useTabStore((s) => s.openDbSync)

  const handleMouseDown = useCallback(() => {
    dragging.current = true
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [])

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!dragging.current) return
      setSidebarWidth(e.clientX)
    },
    [setSidebarWidth]
  )

  const handleMouseUp = useCallback(() => {
    dragging.current = false
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }, [])

  // 全局监听鼠标移动/释放
  useEffect(() => {
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [handleMouseMove, handleMouseUp])

  // 快捷按钮通用样式
  const quickBtn =
    'flex items-center justify-center w-8 h-8 rounded text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors'

  return (
    <>
      <div
        ref={sidebarRef}
        className="flex flex-col h-full bg-bg-secondary border-r border-border-light"
        style={{ width: sidebarWidth }}
      >
        {/* 顶部工具栏 */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-border-light">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-text-secondary uppercase tracking-wide">
            <DatabaseIcon size={14} />
            连接
          </div>
          <button
            onClick={() => openConnectionModal()}
            className="p-1 rounded hover:bg-bg-hover text-text-secondary hover:text-text-primary transition-colors"
            title="新建连接"
          >
            <Plus size={16} />
          </button>
        </div>

        {/* 快捷操作工具栏 */}
        <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-border-light bg-bg-tertiary">
          <button
            onClick={() => openConnectionModal(undefined, 'mysql')}
            className={quickBtn}
            title="新建 MySQL 连接"
          >
            <DatabaseIcon size={15} />
          </button>
          <button
            onClick={() => openConnectionModal(undefined, 'redis')}
            className={quickBtn}
            title="新建 Redis 连接"
          >
            <KeyRound size={15} />
          </button>
          <div className="w-px h-5 bg-border-light mx-0.5" />
          <button
            onClick={() => {
              if (selectedConnectionId) {
                openQuery(selectedConnectionId, selectedDatabase ?? undefined)
              }
            }}
            disabled={!selectedConnectionId}
            className={`${quickBtn} disabled:opacity-30 disabled:cursor-not-allowed`}
            title="新建查询"
          >
            <Terminal size={15} />
          </button>
          <button
            onClick={() => {
              if (selectedConnectionId && selectedDatabase) {
                openDbSync(selectedConnectionId, selectedDatabase)
              }
            }}
            disabled={!selectedConnectionId || !selectedDatabase}
            className={`${quickBtn} disabled:opacity-30 disabled:cursor-not-allowed`}
            title="数据同步"
          >
            <ArrowLeftRight size={15} />
          </button>
          <div className="w-px h-5 bg-border-light mx-0.5" />
          <button
            onClick={() => refreshList()}
            className={`${quickBtn} ml-auto`}
            title="刷新列表"
          >
            <RefreshCw size={14} />
          </button>
        </div>

        {/* 连接树 */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden">
          <ConnectionTree />
        </div>
      </div>

      {/* 拖拽分隔条 */}
      <div
        className="resize-handle"
        data-orientation="vertical"
        onMouseDown={handleMouseDown}
      />
    </>
  )
}
