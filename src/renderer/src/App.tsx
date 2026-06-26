import { useEffect, useRef, useCallback, useState } from 'react'
import { useConnectionStore } from '@stores/connection'
import { useUiStore } from '@stores/ui'
import Sidebar from '@components/Sidebar'
import MiddlePanel from '@components/MiddlePanel'
import TableDetailPanel from '@components/TableDetailPanel'
import ConnectionModal from '@components/ConnectionModal'
import ContextMenu from '@components/ContextMenu'
import MenuBar from '@components/MenuBar'

export default function App() {
  const loadConnections = useConnectionStore((s) => s.loadConnections)
  const sidebarWidth = useUiStore((s) => s.sidebarWidth)
  const middlePanelWidth = useUiStore((s) => s.middlePanelWidth)
  const setSidebarWidth = useUiStore((s) => s.setSidebarWidth)
  const setMiddlePanelWidth = useUiStore((s) => s.setMiddlePanelWidth)

  const leftDragging = useRef(false)
  const midDragging = useRef(false)
  const leftStartX = useRef(0)
  const leftStartWidth = useRef(0)
  const midStartX = useRef(0)
  const midStartWidth = useRef(0)

  // 侧栏/中栏显隐
  const [showSidebar, setShowSidebar] = useState(true)
  const [showMiddle, setShowMiddle] = useState(true)

  // 监听菜单栏的显隐事件
  useEffect(() => {
    const toggleSidebar = () => setShowSidebar((v) => !v)
    const toggleMiddle = () => setShowMiddle((v) => !v)
    window.addEventListener('nexsql-toggle-sidebar', toggleSidebar)
    window.addEventListener('nexsql-toggle-middle', toggleMiddle)
    return () => {
      window.removeEventListener('nexsql-toggle-sidebar', toggleSidebar)
      window.removeEventListener('nexsql-toggle-middle', toggleMiddle)
    }
  }, [])

  useEffect(() => {
    loadConnections()
  }, [loadConnections])

  const handleLeftMouseDown = useCallback(() => {
    leftDragging.current = true
    leftStartX.current = 0
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [])

  const handleMidMouseDown = useCallback(() => {
    midDragging.current = true
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [])

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (leftDragging.current) {
        setSidebarWidth(e.clientX)
      }
      if (midDragging.current) {
        // middle panel right edge = sidebarWidth + middlePanelWidth
        // new middlePanelWidth = e.clientX - sidebarWidth
        const newWidth = e.clientX - sidebarWidth
        setMiddlePanelWidth(newWidth)
      }
    }
    const handleMouseUp = () => {
      if (leftDragging.current || midDragging.current) {
        leftDragging.current = false
        midDragging.current = false
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
  }, [setSidebarWidth, setMiddlePanelWidth, sidebarWidth])

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-bg-primary text-text-primary">
      {/* 顶部菜单栏（兼 macOS 标题栏拖拽区域） */}
      <div className="titlebar-drag flex items-center h-9 bg-bg-secondary border-b border-border-light flex-shrink-0">
        <MenuBar />
      </div>

      {/* 三栏布局 */}
      <div className="flex flex-1 overflow-hidden">
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

        {/* 中栏 - 表列表 */}
        {showMiddle && (
          <>
            <div style={{ width: middlePanelWidth }} className="flex-shrink-0 overflow-hidden">
              <MiddlePanel />
            </div>

            {/* 中间分隔条 */}
            <div
              className="resize-handle w-1 bg-border-light hover:bg-accent cursor-col-resize transition-colors flex-shrink-0"
              onMouseDown={handleMidMouseDown}
            />
          </>
        )}

        {/* 右栏 - 表详情/数据 */}
        <div className="flex-1 overflow-hidden">
          <TableDetailPanel />
        </div>
      </div>

      <ConnectionModal />
      <ContextMenu />
    </div>
  )
}
