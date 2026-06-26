import { create } from 'zustand'
import type { QueryHistory } from '@shared/types'

const STORAGE_KEY = 'nexsql-query-history'
const MAX_HISTORY = 200

function loadHistory(): QueryHistory[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    return JSON.parse(raw) as QueryHistory[]
  } catch {
    return []
  }
}

function persistHistory(history: QueryHistory[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history))
  } catch {
    // ignore quota errors
  }
}

interface HistoryState {
  history: QueryHistory[]
  searchQuery: string
  // Actions
  addEntry: (entry: Omit<QueryHistory, 'id' | 'executedAt'>) => void
  clearHistory: () => void
  removeEntry: (id: string) => void
  setSearchQuery: (q: string) => void
  getFilteredHistory: () => QueryHistory[]
}

export const useHistoryStore = create<HistoryState>((set, get) => ({
  history: loadHistory(),
  searchQuery: '',

  addEntry: (entry) => {
    const newEntry: QueryHistory = {
      ...entry,
      id: `h_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      executedAt: Date.now()
    }
    const updated = [newEntry, ...get().history].slice(0, MAX_HISTORY)
    persistHistory(updated)
    set({ history: updated })
  },

  clearHistory: () => {
    persistHistory([])
    set({ history: [] })
  },

  removeEntry: (id) => {
    const updated = get().history.filter((h) => h.id !== id)
    persistHistory(updated)
    set({ history: updated })
  },

  setSearchQuery: (q) => set({ searchQuery: q }),

  getFilteredHistory: () => {
    const { history, searchQuery } = get()
    if (!searchQuery.trim()) return history
    const lower = searchQuery.toLowerCase()
    return history.filter(
      (h) =>
        h.sql.toLowerCase().includes(lower) ||
        h.database?.toLowerCase().includes(lower) ||
        h.error?.toLowerCase().includes(lower)
    )
  }
}))
