import { create } from 'zustand'
import type { Tab } from '@shared/types'

interface TabState {
  tabs: Tab[]
  activeTabId: string | null
  // Actions
  openTab: (tab: Tab) => void
  closeTab: (id: string) => void
  setActiveTab: (id: string) => void
  updateTab: (id: string, updates: Partial<Tab>) => void
  getActiveTab: () => Tab | null
}

export const useTabStore = create<TabState>((set, get) => ({
  tabs: [],
  activeTabId: null,

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
      set((state) => ({
        tabs: [...state.tabs, tab],
        activeTabId: tab.id
      }))
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
      return { tabs, activeTabId }
    }),

  setActiveTab: (id) => set({ activeTabId: id }),

  updateTab: (id, updates) =>
    set((state) => ({
      tabs: state.tabs.map((t) => (t.id === id ? { ...t, ...updates } : t))
    })),

  getActiveTab: () => {
    const { tabs, activeTabId } = get()
    return tabs.find((t) => t.id === activeTabId) ?? null
  }
}))
