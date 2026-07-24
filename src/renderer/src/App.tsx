import { useEffect, useRef, useCallback, useState } from 'react'
import { AlertTriangle, X } from 'lucide-react'
import { useConnectionStore } from '@stores/connection'
import { useUiStore } from '@stores/ui'
import { useBrowserStore } from '@stores/browser'
import Sidebar from '@components/Sidebar'
import MiddleArea from '@components/MiddleArea'
import TableDetailPanel from '@components/TableDetailPanel'
import ConnectionModal from '@components/ConnectionModal'
import ContextMenu from '@components/ContextMenu'
import MenuBar from '@components/MenuBar'
import McpSettingsModal from '@components/McpSettingsModal'
import LanAccessModal from '@components/LanAccessModal'

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
  const [showClearCache, setShowClearCache] = useState(false)

  // 监听菜单栏的显隐事件
  useEffect(() => {
    const toggleSidebar = () => setShowSidebar((v) => !v)
    const toggleRightPanel = () => setShowRightPanel((v) => !v)
    const handleClearCache = () => setShowClearCache(true)
    window.addEventListener('nexsql-toggle-sidebar', toggleSidebar)
    window.addEventListener('nexsql-toggle-middle', toggleRightPanel)
    window.addEventListener('nexsql-clear-cache', handleClearCache)
    return () => {
      window.removeEventListener('nexsql-toggle-sidebar', toggleSidebar)
      window.removeEventListener('nexsql-toggle-middle', toggleRightPanel)
      window.removeEventListener('nexsql-clear-cache', handleClearCache)
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
      <McpSettingsModal />
      <LanAccessModal />
      <ContextMenu />

      {/* 清除缓存确认弹窗 */}
      {showClearCache && (
        <ClearCacheModal
          onConfirm={async () => {
            // 1. 清除主进程缓存（AI 对话等）
            try {
              await window.api.cache.clearCache()
            } catch {}
            // 2. 清除前端 localStorage 缓存
            const keysToRemove = [
              'nexsql-query-history',
              'nexsql-sql-snippets',
              'nexsql-open-tabs',
              'nexsql-default-page-size',
              'nexsql-saved-queries',
            ]
            keysToRemove.forEach((key) => localStorage.removeItem(key))
            // 3. 刷新页面
            window.location.reload()
          }}
          onClose={() => setShowClearCache(false)}
        />
      )}
    </div>
  )
}

// ==================== 清除缓存确认弹窗 ====================

function ClearCacheModal({
  onConfirm,
  onClose,
}: {
  onConfirm: () => void
  onClose: () => void
}) {
  const [clearing, setClearing] = useState(false)

  const handleConfirm = async () => {
    setClearing(true)
    onConfirm()
  }

  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="w-[420px] bg-bg-secondary border border-border-light rounded-lg shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-light">
          <div className="flex items-center gap-2">
            <AlertTriangle size={15} className="text-yellow-400" />
            <span className="text-sm font-medium text-text-primary">清除应用缓存数据</span>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-bg-hover rounded text-text-muted hover:text-text-primary transition-colors"
          >
            <X size={15} />
          </button>
        </div>

        {/* 内容 */}
        <div className="px-4 py-4 space-y-3">
          <div className="text-xs text-text-secondary leading-relaxed">
            此操作将清除以下本地缓存数据，<span className="text-red-400 font-medium">不可恢复</span>：
          </div>
          <div className="space-y-1.5 text-xs text-text-muted bg-bg-tertiary/50 rounded px-3 py-2.5">
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-text-muted" />
              AI 对话历史记录
            </div>
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-text-muted" />
              SQL 查询历史记录
            </div>
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-text-muted" />
              SQL 代码片段
            </div>
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-text-muted" />
              界面布局偏好（标签页等）
            </div>
          </div>
          <div className="text-[11px] text-text-muted leading-relaxed">
            连接配置和 AI API Key 设置不受影响。
          </div>
        </div>

        {/* 操作按钮 */}
        <div className="flex items-center gap-2 px-4 py-3 border-t border-border-light">
          <button
            onClick={onClose}
            className="px-3 py-2 text-xs border border-border-light hover:bg-bg-hover text-text-secondary rounded transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleConfirm}
            disabled={clearing}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs bg-red-500 hover:bg-red-600 text-white rounded transition-colors disabled:opacity-50"
          >
            {clearing ? '清除中...' : '确认清除'}
          </button>
        </div>
      </div>
    </div>
  )
}
