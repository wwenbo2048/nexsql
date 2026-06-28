import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import {
  Plug,
  Plug2,
  RefreshCw,
  Upload,
  Download,
  PanelLeftClose,
  PanelLeft,
  Columns3,
  Database as DatabaseIcon,
  Table as TableIcon,
  Eye,
  FunctionSquare,
  CalendarClock,
  Terminal,
  Code2,
  Sparkles,
  Database as DbIcon,
  Wrench,
  Github,
  Info
} from 'lucide-react'
import { useUiStore, type ContextMenuItem } from '@stores/ui'
import { useConnectionStore } from '@stores/connection'
import { useBrowserStore } from '@stores/browser'
import { useTabStore } from '@stores/tab'

interface MenuItem {
  label: string
  icon?: React.ReactNode
  shortcut?: string
  onClick?: () => void
  separator?: boolean
  disabled?: boolean
  danger?: boolean
}

interface MenuGroup {
  label: string
  items: MenuItem[]
}

export default function MenuBar() {
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const isMac = useMemo(() => window.api?.platform === 'darwin', [])
  const appVersion = useMemo(() => window.api?.appVersion ?? '', [])

  const openConnectionModal = useUiStore((s) => s.openConnectionModal)
  const setContextMenu = useUiStore((s) => s.setContextMenu)
  const { selectedConnectionId, selectedDatabase, selectedTable, selectedCategory, refreshList, startCreating, selectCategory } = useBrowserStore()
  const { connections, statuses } = useConnectionStore()
  const activeTab = useTabStore((s) => s.tabs.find((t) => t.id === s.activeTabId))
  const config = connections.find((c) => c.id === selectedConnectionId)
  const isConnected = config ? statuses[config.id] === 'connected' : false

  // 指示器显示：活跃 Tab 的数据库/表，或浏览器面板的选中状态
  const displayDb = activeTab?.type !== 'browser' && activeTab?.database
    ? activeTab.database
    : selectedDatabase
  const displayTable = activeTab?.type !== 'browser' && activeTab?.table
    ? activeTab.table
    : selectedTable
  const displayConnId = activeTab?.type !== 'browser' && activeTab?.connectionId
    ? activeTab.connectionId
    : selectedConnectionId
  const displayConfig = connections.find((c) => c.id === displayConnId)
  const displayConnected = displayConfig ? statuses[displayConfig.id] === 'connected' : false

  // 关闭菜单（点击外部）
  useEffect(() => {
    if (!openMenu) return
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenMenu(null)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [openMenu])

  const handleMenuClick = useCallback((label: string) => {
    setOpenMenu((prev) => (prev === label ? null : label))
  }, [])

  const triggerContextMenu = useCallback((x: number, y: number, items: ContextMenuItem[]) => {
    // 使用全局 ContextMenu 组件渲染（偏移到菜单项下方）
    setContextMenu({ x, y, items })
    setOpenMenu(null)
  }, [setContextMenu])

  // ==================== 文件菜单 ====================
  const fileItems: MenuItem[] = [
    {
      label: '新建连接',
      icon: <Plug size={13} />,
      onClick: () => { openConnectionModal(); setOpenMenu(null) }
    },
    {
      label: '管理连接...',
      icon: <Plug2 size={13} />,
      shortcut: '⇧⌘C',
      onClick: () => { openConnectionModal(); setOpenMenu(null) }
    },
    { label: '', separator: true },
    {
      label: '导入数据...',
      icon: <Upload size={13} />,
      disabled: !selectedDatabase,
      onClick: () => {
        if (!selectedDatabase) return
        setContextMenu({
          x: 100,
          y: 100,
          items: [
            { label: '从 CSV 导入', onClick: () => { /* 触发 DataTable 导入 */ window.dispatchEvent(new CustomEvent('nexsql-import', { detail: { format: 'csv' } })) } },
            { label: '从 JSON 导入', onClick: () => window.dispatchEvent(new CustomEvent('nexsql-import', { detail: { format: 'json' } })) },
            { label: '从 SQL 导入', onClick: () => window.dispatchEvent(new CustomEvent('nexsql-import', { detail: { format: 'sql' } })) },
          ]
        })
        setOpenMenu(null)
      }
    },
    {
      label: '导出数据...',
      icon: <Download size={13} />,
      disabled: !selectedDatabase,
      onClick: () => {
        if (!selectedDatabase) return
        setContextMenu({
          x: 100,
          y: 100,
          items: [
            { label: '导出为 CSV', onClick: () => window.dispatchEvent(new CustomEvent('nexsql-export', { detail: { format: 'csv' } })) },
            { label: '导出为 JSON', onClick: () => window.dispatchEvent(new CustomEvent('nexsql-export', { detail: { format: 'json' } })) },
            { label: '导出为 SQL', onClick: () => window.dispatchEvent(new CustomEvent('nexsql-export', { detail: { format: 'sql' } })) },
          ]
        })
        setOpenMenu(null)
      }
    },
    { label: '', separator: true },
    {
      label: '刷新',
      icon: <RefreshCw size={13} />,
      shortcut: '⌘R',
      disabled: !selectedDatabase,
      onClick: () => { refreshList(); setOpenMenu(null) }
    },
  ]

  // ==================== 视图菜单 ====================
  const [showSidebar, setShowSidebar] = useState(true)
  const [showMiddle, setShowMiddle] = useState(true)

  const viewItems: MenuItem[] = [
    {
      label: showSidebar ? '隐藏侧栏' : '显示侧栏',
      icon: showSidebar ? <PanelLeftClose size={13} /> : <PanelLeft size={13} />,
      shortcut: '⌘1',
      onClick: () => { setShowSidebar((v) => !v); window.dispatchEvent(new CustomEvent('nexsql-toggle-sidebar')); setOpenMenu(null) }
    },
    {
      label: showMiddle ? '隐藏信息面板' : '显示信息面板',
      icon: <Columns3 size={13} />,
      shortcut: '⌘2',
      onClick: () => { setShowMiddle((v) => !v); window.dispatchEvent(new CustomEvent('nexsql-toggle-middle')); setOpenMenu(null) }
    },
    { label: '', separator: true },
    {
      label: '刷新列表',
      icon: <RefreshCw size={13} />,
      shortcut: '⌘R',
      disabled: !selectedDatabase,
      onClick: () => { refreshList(); setOpenMenu(null) }
    },
  ]

  // ==================== 对象菜单 ====================
  const objectItems: MenuItem[] = [
    {
      label: '新建数据库...',
      icon: <DbIcon size={13} />,
      disabled: !isConnected,
      onClick: () => {
        if (config) window.dispatchEvent(new CustomEvent('nexsql-create-database', { detail: { config } }))
        setOpenMenu(null)
      }
    },
    { label: '', separator: true },
    {
      label: '新建表...',
      icon: <TableIcon size={13} />,
      disabled: !selectedDatabase,
      onClick: () => { if (selectedDatabase) { selectCategory('tables'); startCreating() } setOpenMenu(null) }
    },
    {
      label: '新建视图...',
      icon: <Eye size={13} />,
      disabled: !selectedDatabase,
      onClick: () => { if (selectedDatabase) { selectCategory('views'); startCreating() } setOpenMenu(null) }
    },
    {
      label: '新建函数/存储过程...',
      icon: <FunctionSquare size={13} />,
      disabled: !selectedDatabase,
      onClick: () => { if (selectedDatabase) { selectCategory('functions'); startCreating() } setOpenMenu(null) }
    },
    {
      label: '新建事件...',
      icon: <CalendarClock size={13} />,
      disabled: !selectedDatabase,
      onClick: () => { if (selectedDatabase) { selectCategory('events'); startCreating() } setOpenMenu(null) }
    },
    { label: '', separator: true },
    {
      label: '新建查询',
      icon: <Terminal size={13} />,
      shortcut: '⌘T',
      disabled: !selectedDatabase,
      onClick: () => { if (selectedDatabase) selectCategory('query'); setOpenMenu(null) }
    },
  ]

  // ==================== 工具菜单 ====================
  const toolItems: MenuItem[] = [
    {
      label: 'SQL 格式化',
      icon: <Code2 size={13} />,
      shortcut: '⇧⌘F',
      onClick: () => { window.dispatchEvent(new CustomEvent('nexsql-format-sql')); setOpenMenu(null) }
    },
    {
      label: '美化 SQL（关键字大写）',
      icon: <Sparkles size={13} />,
      onClick: () => { window.dispatchEvent(new CustomEvent('nexsql-format-sql')); setOpenMenu(null) }
    },
    { label: '', separator: true },
    {
      label: '优化表',
      icon: <Wrench size={13} />,
      disabled: !selectedTable || selectedCategory !== 'tables',
      onClick: () => {
        if (config && selectedDatabase && selectedTable) {
          window.api.db.query(config, `OPTIMIZE TABLE \`${selectedTable}\``, selectedDatabase)
        }
        setOpenMenu(null)
      }
    },
  ]

  // ==================== 帮助菜单 ====================
  const helpItems: MenuItem[] = [
    // macOS 原生菜单已有“关于”，自定义菜单仅在非 macOS 显示
    ...(!isMac ? [{
      label: '关于 nexSql',
      icon: <Info size={13} />,
      onClick: () => {
        window.dispatchEvent(new CustomEvent('nexsql-about'))
        setOpenMenu(null)
      }
    } as MenuItem] : []),
    {
      label: 'GitHub',
      icon: <Github size={13} />,
      onClick: () => { setOpenMenu(null) }
    },
  ]

  const menuGroups: MenuGroup[] = [
    { label: '文件', items: fileItems },
    // macOS: 视图菜单隐藏（功能通过快捷键保留），窗口菜单由原生菜单处理
    ...(!isMac ? [{ label: '视图', items: viewItems }] : []),
    { label: '对象', items: objectItems },
    { label: '工具', items: toolItems },
    { label: '帮助', items: helpItems },
  ]

  return (
    <div ref={menuRef} className="flex items-center h-full titlebar-no-drag">
      {/* macOS traffic lights 留白 */}
      {isMac && <div className="w-[72px] flex-shrink-0" />}

      {/* Logo + 版本号 */}
      <div className="flex items-center gap-1.5 px-3 select-none">
        <DatabaseIcon size={14} className="text-accent" />
        <span className="text-xs font-bold text-text-primary tracking-tight">nexSql</span>
        {appVersion && (
          <span className="text-[9px] text-text-muted font-normal mt-px">v{appVersion}</span>
        )}
      </div>

      {/* 菜单组 */}
      <div className="flex items-center">
        {menuGroups.map((group) => (
          <div key={group.label} className="relative">
            <button
              onClick={() => handleMenuClick(group.label)}
              onMouseEnter={() => { if (openMenu) setOpenMenu(group.label) }}
              className={`px-3 py-1 text-xs font-medium transition-colors rounded-sm ${
                openMenu === group.label
                  ? 'bg-accent/20 text-accent'
                  : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover'
              }`}
            >
              {group.label}
            </button>

            {/* 下拉菜单 */}
            {openMenu === group.label && (
              <div className="absolute top-full left-0 mt-0.5 z-[100] min-w-[220px] bg-bg-tertiary border border-border rounded-md shadow-2xl py-1">
                {group.items.map((item, idx) => {
                  if (item.separator) {
                    return <div key={idx} className="h-px bg-border-light my-1" />
                  }
                  return (
                    <button
                      key={idx}
                      disabled={item.disabled}
                      onClick={item.onClick}
                      className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-xs transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
                        item.danger ? 'text-red-400 hover:bg-red-900/30' : 'text-text-primary hover:bg-bg-hover'
                      }`}
                    >
                      <span className="w-4 flex-shrink-0 flex items-center justify-center">
                        {item.icon}
                      </span>
                      <span className="flex-1 text-left">{item.label}</span>
                      {item.shortcut && (
                        <span className="text-[10px] text-text-muted ml-4">{item.shortcut}</span>
                      )}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* 当前数据库状态指示器 */}
      {displayConnId && displayDb && (
        <div className="flex items-center gap-1.5 ml-3 pl-3 border-l border-border-light text-[10px] text-text-muted select-none">
          <span className={`w-1.5 h-1.5 rounded-full ${displayConnected ? 'bg-green-400' : 'bg-text-muted'}`} />
          <span className="text-text-secondary">{displayConfig?.name}</span>
          <span>›</span>
          <span className="text-text-primary">{displayDb}</span>
          {displayTable && (
            <>
              <span>›</span>
              <span className="text-accent">{displayTable}</span>
            </>
          )}
        </div>
      )}
    </div>
  )
}
