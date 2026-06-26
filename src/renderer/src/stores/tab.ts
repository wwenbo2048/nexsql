import { create } from 'zustand'
import type { Tab } from '@shared/types'

const TABS_STORAGE_KEY = 'nexsql-open-tabs'

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
    // 只持久化查询标签，不持久化 table-data / table-design
    const toSave = tabs.filter((t) => t.type === 'query')
    localStorage.setItem(TABS_STORAGE_KEY, JSON.stringify(toSave))
  } catch { /* ignore */ }
}

interface TabState {
  tabs: Tab[]
  activeTabId: string | null
  // Actions
  openTab: (tab: Tab) => void
  closeTab: (id: string) => void
  setActiveTab: (id: string) => void
  updateTab: (id: string, updates: Partial<Tab>) => void
  getActiveTab: () => Tab | null
  reorderTabs: (fromIndex: number, toIndex: number) => void
}

export const useTabStore = create<TabState>((set, get) => ({
  tabs: loadPersistedTabs(),
  activeTabId: loadPersistedTabs()[0]?.id ?? null,

  openTab: (tab) => {
    const existing = get().tabs.find((t) => 
      t.connectionId === tab.connectionId &&
      t.database === tab.database &&
      t.table === tab.table &&
      t.type === tab.type
    )
    if (existing) {
      set({ activeTabId: existing.id })
    } else {
      set((state) => {
        const tabs = [...state.tabs, tab]
        persistTabs(tabs)
        return { tabs, activeTabId: tab.id }
      })
    }
  },

  closeTab: (id) =>
    set((state) => {
      const idx = state.tabs.findIndex((t) => t.id === id)
      const tabs = state.tabs.filter((t) => t.id !== id)
      let activeTabId = state.activeTabId
      if (state.activeTabId === id) {
        if (tabs.length === 0) {
          activeTabId = null
        } else if (idx >= tabs.length) {
          activeTabId = tabs[tabs.length - 1].id
        } else {
          activeTabId = tabs[idx].id
        }
      }
      persistTabs(tabs)
      return { tabs, activeTabId }
    }),

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
    })
}))
