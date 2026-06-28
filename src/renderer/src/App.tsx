import { useEffect, useRef, useCallback, useState } from 'react'
import { useConnectionStore } from '@stores/connection'
import { useUiStore } from '@stores/ui'
import { useBrowserStore } from '@stores/browser'
import Sidebar from '@components/Sidebar'
import MiddleArea from '@components/MiddleArea'
import TableDetailPanel from '@components/TableDetailPanel'
import ConnectionModal from '@components/ConnectionModal'
import ContextMenu from '@components/ContextMenu'
import MenuBar from '@components/MenuBar'

export default function App() {
  const loadConnections = useConnectionStore((s) => s.loadConnections)
  const sidebarWidth = useUiStore((s) => s.sidebarWidth)
  const rightPanelWidth = useUiStore((s) => s.rightPanelWidth)
  const setSidebarWidth = useUiStore((s) => s.setSidebarWidth)
  const setRightPanelWidth = useUiStore((s) => s.setRightPanelWidth)

  const leftDragging = useRef(false)
  const rightDragging = useRef(false)

  // 侧栏/右侧面板显隐
  const [showSidebar, setShowSidebar] = useState(true)
  const [showRightPanel, setShowRightPanel] = useState(true)

  // 监听菜单栏的显隐事件
  useEffect(() => {
    const toggleSidebar = () => setShowSidebar((v) => !v)
    const toggleRightPanel = () => setShowRightPanel((v) => !v)
    window.addEventListener('nexsql-toggle-sidebar', toggleSidebar)
    window.addEventListener('nexsql-toggle-middle', toggleRightPanel)
    return () => {
      window.removeEventListener('nexsql-toggle-sidebar', toggleSidebar)
      window.removeEventListener('nexsql-toggle-middle', toggleRightPanel)
    }
  }, [])

  // 视图菜单快捷键（macOS 隐藏视图菜单后保留功能）
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey
      if (!meta) return
      if (e.key === '1') {
        e.preventDefault()
        window.dispatchEvent(new CustomEvent('nexsql-toggle-sidebar'))
      } else if (e.key === '2') {
        e.preventDefault()
        window.dispatchEvent(new CustomEvent('nexsql-toggle-middle'))
      } else if (e.key === 'r' || e.key === 'R') {
        e.preventDefault()
        useBrowserStore.getState().refreshList()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  useEffect(() => {
    loadConnections()
  }, [loadConnections])

  const handleLeftMouseDown = useCallback(() => {
    leftDragging.current = true
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [])

  const handleRightMouseDown = useCallback(() => {
    rightDragging.current = true
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [])

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (leftDragging.current) {
        setSidebarWidth(e.clientX)
      }
      if (rightDragging.current) {
        // right panel width = window width - mouse X
        const newWidth = window.innerWidth - e.clientX
        setRightPanelWidth(newWidth)
      }
    }
    const handleMouseUp = () => {
      if (leftDragging.current || rightDragging.current) {
        leftDragging.current = false
        rightDragging.current = false
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }
    }
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [setSidebarWidth, setRightPanelWidth])

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-bg-primary text-text-primary">
      {/* 顶部菜单栏（兼 macOS 标题栏拖拽区域） */}
      <div className="titlebar-drag flex items-center h-9 bg-bg-secondary border-b border-border-light flex-shrink-0">
        <MenuBar />
      </div>

      {/* 三栏布局 */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* 左栏 - 连接树 */}
        {showSidebar && (
          <>
            <div style={{ width: sidebarWidth }} className="flex-shrink-0 h-full overflow-hidden">
              <Sidebar />
            </div>

            {/* 左侧分隔条 */}
            <div
              className="resize-handle w-1 bg-border-light hover:bg-accent cursor-col-resize transition-colors flex-shrink-0"
              onMouseDown={handleLeftMouseDown}
            />
          </>
        )}

        {/* 中栏 - 主操作区（多标签页） */}
        <div className="flex-1 min-h-0 overflow-hidden">
          <MiddleArea />
        </div>

        {/* 右栏 - 常规/DDL 信息面板 */}
        {showRightPanel && (
          <>
            {/* 右侧分隔条 */}
            <div
              className="resize-handle w-1 bg-border-light hover:bg-accent cursor-col-resize transition-colors flex-shrink-0"
              onMouseDown={handleRightMouseDown}
            />
            <div style={{ width: rightPanelWidth }} className="flex-shrink-0 h-full overflow-hidden">
              <TableDetailPanel />
            </div>
          </>
        )}
      </div>

      <ConnectionModal />
      <ContextMenu />
    </div>
  )
}
