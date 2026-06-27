import { create } from 'zustand'
import type { Tab } from '@shared/types'

const TABS_STORAGE_KEY = 'nexsql-open-tabs'
const BROWSER_TAB_ID = '__browser__'

function loadPersistedTabs(): Tab[] {
  try {
    const raw = localStorage.getItem(TABS_STORAGE_KEY)
    if (!raw) return []
    return JSON.parse(raw) as Tab[]
  } catch {
    return []
  }
}

function persistTabs(tabs: Tab[]) {
  try {
    // 只持久化查询标签，不持久化 table-data / table-design / browser
    const toSave = tabs.filter((t) => t.type === 'query')
    localStorage.setItem(TABS_STORAGE_KEY, JSON.stringify(toSave))
  } catch { /* ignore */ }
}

/** 创建浏览器 Tab（对象列表） */
function createBrowserTab(): Tab {
  return {
    id: BROWSER_TAB_ID,
    type: 'browser',
    title: '对象',
    connectionId: ''
  }
}

interface TabState {
  tabs: Tab[]
  activeTabId: string | null
  // Actions
  openTab: (tab: Tab) => void
  closeTab: (id: string) => void
  closeOtherTabs: (id: string) => void
  closeTabsToRight: (id: string) => void
  closeAllTabs: () => void
  setActiveTab: (id: string) => void
  updateTab: (id: string, updates: Partial<Tab>) => void
  getActiveTab: () => Tab | null
  reorderTabs: (fromIndex: number, toIndex: number) => void
  // 便捷方法
  openTableData: (connectionId: string, database: string, table: string) => void
  openQuery: (connectionId: string, database?: string) => void
  openTableDesign: (connectionId: string, database: string, table: string) => void
  openErDiagram: (connectionId: string, database: string) => void
  /** 确保浏览器 Tab 存在并激活 */
  ensureBrowserTab: () => void
}

export const useTabStore = create<TabState>((set, get) => ({
  // 初始化时确保第一个 Tab 是 browser
  tabs: [createBrowserTab(), ...loadPersistedTabs()],
  activeTabId: BROWSER_TAB_ID,

  openTab: (tab) => {
    // query 类型不去重，每次都打开新 Tab
    if (tab.type !== 'query') {
      const existing = get().tabs.find((t) =>
        t.type === tab.type &&
        t.connectionId === tab.connectionId &&
        t.database === tab.database &&
        t.table === tab.table
      )
      if (existing) {
        set({ activeTabId: existing.id })
        return
      }
    }
    set((state) => {
      // browser Tab 始终在第一位
      const browserIdx = state.tabs.findIndex((t) => t.type === 'browser')
      const tabs = [...state.tabs]
      if (browserIdx >= 0) {
        tabs.splice(browserIdx + 1, 0, tab)
      } else {
        tabs.push(tab)
      }
      persistTabs(tabs)
      return { tabs, activeTabId: tab.id }
    })
  },

  closeTab: (id) => {
    // browser Tab 不可关闭
    if (id === BROWSER_TAB_ID) return
    set((state) => {
      const idx = state.tabs.findIndex((t) => t.id === id)
      const tabs = state.tabs.filter((t) => t.id !== id)
      let activeTabId = state.activeTabId
      if (state.activeTabId === id) {
        if (idx > 0 && state.tabs[idx - 1]) {
          activeTabId = state.tabs[idx - 1].id
        } else if (state.tabs[idx + 1]) {
          activeTabId = state.tabs[idx + 1].id
        } else {
          activeTabId = BROWSER_TAB_ID
        }
      }
      persistTabs(tabs)
      return { tabs, activeTabId }
    })
  },

  closeOtherTabs: (id) => {
    set((state) => {
      const kept = state.tabs.filter((t) => t.type === 'browser' || t.id === id)
      persistTabs(kept)
      return { tabs: kept, activeTabId: id }
    })
  },

  closeTabsToRight: (id) => {
    set((state) => {
      const idx = state.tabs.findIndex((t) => t.id === id)
      if (idx < 0) return state
      const kept = state.tabs.filter((t, i) => t.type === 'browser' || i <= idx)
      const activeTabId = kept.some((t) => t.id === state.activeTabId) ? state.activeTabId : id
      persistTabs(kept)
      return { tabs: kept, activeTabId }
    })
  },

  closeAllTabs: () => {
    set((state) => {
      const kept = state.tabs.filter((t) => t.type === 'browser')
      persistTabs(kept)
      return { tabs: kept, activeTabId: BROWSER_TAB_ID }
    })
  },

  setActiveTab: (id) => set({ activeTabId: id }),

  updateTab: (id, updates) =>
    set((state) => {
      const tabs = state.tabs.map((t) => (t.id === id ? { ...t, ...updates } : t))
      persistTabs(tabs)
      return { tabs }
    }),

  getActiveTab: () => {
    const { tabs, activeTabId } = get()
    return tabs.find((t) => t.id === activeTabId) ?? null
  },

  reorderTabs: (fromIndex, toIndex) =>
    set((state) => {
      const tabs = [...state.tabs]
      const [moved] = tabs.splice(fromIndex, 1)
      tabs.splice(toIndex, 0, moved)
      persistTabs(tabs)
      return { tabs }
    }),

  openTableData: (connectionId, database, table) => {
    get().openTab({
      id: `data-${connectionId}-${database}-${table}`,
      type: 'table-data',
      title: `${table}`,
      connectionId,
      database,
      table
    })
  },

  openQuery: (connectionId, database) => {
    get().openTab({
      id: `query-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type: 'query',
      title: database ? `查询 - ${database}` : '查询',
      connectionId,
      database
    })
  },

  openTableDesign: (connectionId, database, table) => {
    get().openTab({
      id: `design-${connectionId}-${database}-${table}`,
      type: 'table-design',
      title: `设计 ${table}`,
      connectionId,
      database,
      table
    })
  },

  openErDiagram: (connectionId, database) => {
    get().openTab({
      id: `er-${connectionId}-${database}`,
      type: 'er',
      title: `ER 图 - ${database}`,
      connectionId,
      database
    })
  },

  ensureBrowserTab: () => {
    const state = get()
    if (!state.tabs.find((t) => t.type === 'browser')) {
      set({ tabs: [createBrowserTab(), ...state.tabs] })
    }
  }
}))
