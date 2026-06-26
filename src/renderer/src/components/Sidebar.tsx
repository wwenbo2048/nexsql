import { useRef, useCallback, useEffect } from 'react'
import { Plus, Database as DatabaseIcon } from 'lucide-react'
import { useUiStore } from '@stores/ui'
import ConnectionTree from './ConnectionTree'

export default function Sidebar() {
  const sidebarWidth = useUiStore((s) => s.sidebarWidth)
  const setSidebarWidth = useUiStore((s) => s.setSidebarWidth)
  const openConnectionModal = useUiStore((s) => s.openConnectionModal)
  const sidebarRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)

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
