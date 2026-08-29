import { useRef, useCallback, useEffect, useState } from 'react'
import {
  Plus,
  Database as DatabaseIcon,
  Terminal,
  ArrowLeftRight,
  RefreshCw,
  Upload,
  Download,
} from 'lucide-react'
import { useUiStore } from '@stores/ui'
import { useTabStore } from '@stores/tab'
import { useBrowserStore } from '@stores/browser'
import { useConnectionStore } from '@stores/connection'
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
  const loadConnections = useConnectionStore((s) => s.loadConnections)
  const setStatus = useConnectionStore((s) => s.setStatus)
  const toggleExpand = useConnectionStore((s) => s.toggleExpand)
  const expandedConnections = useConnectionStore((s) => s.expandedConnections)
  const [importExporting, setImportExporting] = useState<'import' | 'export' | null>(null)

  // 导出连接配置到 JSON 文件（密码为明文，需用户确认）
  const handleExportConnections = useCallback(async () => {
    if (!confirm('导出的文件包含明文密码，请妥善保管。\n确定要导出所有连接配置吗？')) return
    try {
      setImportExporting('export')
      const res = await window.api.config.exportConnections()
      if (!res.success) {
        alert(`导出失败: ${res.error}`)
        return
      }
      if (!res.data?.canceled) {
        alert(`导出成功！共 ${res.data?.count ?? 0} 个连接。\n保存至: ${res.data?.path}`)
      }
    } catch (err) {
      alert(`导出失败: ${(err as Error).message}`)
    } finally {
      setImportExporting(null)
    }
  }, [])

  // 从 JSON 文件导入连接配置（按 id 合并）
  const handleImportConnections = useCallback(async () => {
    try {
      setImportExporting('import')
      const res = await window.api.config.importConnections()
      if (!res.success) {
        alert(`导入失败: ${res.error}`)
        return
      }
      if (res.data && !res.data.canceled) {
        await loadConnections()
        // 主进程已断开被更新连接的旧连接池，同步重置前端状态并收起节点
        res.data.updatedIds.forEach((id) => {
          setStatus(id, 'disconnected')
          if (expandedConnections.has(id)) toggleExpand(id)
        })
        const parts: string[] = [`新增 ${res.data.added} 个，更新 ${res.data.updated} 个`]
        if (res.data.updated > 0) parts.push('被更新的连接已断开，需重新连接生效')
        if (res.data.skipped > 0) parts.push(`跳过 ${res.data.skipped} 条无效记录`)
        alert(`导入成功！${parts.join('；')}。`)
      }
    } catch (err) {
      alert(`导入失败: ${(err as Error).message}`)
    } finally {
      setImportExporting(null)
    }
  }, [loadConnections, setStatus, toggleExpand, expandedConnections])

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

  // 快捷按钮通用样式（带文字）
  const quickBtn =
    'flex items-center gap-1 px-2.5 h-7 rounded text-xs text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors'
  // 快捷按钮通用样式（仅图标）
  const iconBtn =
    'flex items-center justify-center w-7 h-7 rounded text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors'

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
          <div className="flex items-center gap-0.5">
            <button
              onClick={handleImportConnections}
              disabled={importExporting !== null}
              className="p-1 rounded hover:bg-bg-hover text-text-secondary hover:text-text-primary transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              title="导入连接"
            >
              <Download size={14} />
            </button>
            <button
              onClick={handleExportConnections}
              disabled={importExporting !== null}
              className="p-1 rounded hover:bg-bg-hover text-text-secondary hover:text-text-primary transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              title="导出连接"
            >
              <Upload size={14} />
            </button>
            <button
              onClick={() => openConnectionModal()}
              className="p-1 rounded hover:bg-bg-hover text-text-secondary hover:text-text-primary transition-colors"
              title="新建连接"
            >
              <Plus size={16} />
            </button>
          </div>
        </div>

        {/* 快捷操作工具栏 */}
        <div className="flex items-center gap-1 px-2 py-1.5 border-b border-border-light bg-bg-tertiary">
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
            <Terminal size={13} />
            新建查询
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
            <ArrowLeftRight size={13} />
            数据同步
          </button>
          <button
            onClick={() => refreshList()}
            className={`${iconBtn} ml-auto`}
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
