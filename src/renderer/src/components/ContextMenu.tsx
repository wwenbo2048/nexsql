import { useEffect, useRef } from 'react'
import { useUiStore } from '@stores/ui'

export default function ContextMenu() {
  const contextMenu = useUiStore((s) => s.contextMenu)
  const setContextMenu = useUiStore((s) => s.setContextMenu)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!contextMenu) return

    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setContextMenu(null)
      }
    }

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setContextMenu(null)
      }
    }

    // 延迟添加监听器，避免立即关闭
    setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside)
      document.addEventListener('keydown', handleEscape)
    }, 0)

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [contextMenu, setContextMenu])

  if (!contextMenu) return null

  // 计算菜单位置，避免超出窗口
  const menuWidth = 180
  const menuHeight = contextMenu.items.length * 32 + 8
  let x = contextMenu.x
  let y = contextMenu.y
  if (x + menuWidth > window.innerWidth) {
    x = window.innerWidth - menuWidth - 4
  }
  if (y + menuHeight > window.innerHeight) {
    y = window.innerHeight - menuHeight - 4
  }

  return (
    <div
      ref={menuRef}
      className="fixed z-[100] min-w-[180px] bg-bg-tertiary border border-border rounded-md shadow-2xl py-1 text-sm"
      style={{ left: x, top: y }}
    >
      {contextMenu.items.map((item, idx) => {
        if (item.separator) {
          return <div key={idx} className="h-px bg-border-light my-1" />
        }
        return (
          <button
            key={idx}
            disabled={item.disabled}
            onClick={() => {
              item.onClick?.()
              setContextMenu(null)
            }}
            className={`context-menu-item w-full text-left px-3 py-1.5 transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
              item.danger ? 'text-red-400' : 'text-text-primary'
            }`}
          >
            {item.label}
          </button>
        )
      })}
    </div>
  )
}
