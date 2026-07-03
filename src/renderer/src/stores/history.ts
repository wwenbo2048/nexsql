import { create } from 'zustand'
import type { QueryHistory } from '@shared/types'

const STORAGE_KEY = 'nexsql-query-history'
const MAX_HISTORY = 20

function loadHistory(): QueryHistory[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as QueryHistory[]
    // 兼容旧数据：将 savedAt 迁移到 executedAt
    return parsed.map((h) => ({
      ...h,
      executedAt: h.executedAt ?? (h as Record<string, unknown>).savedAt as number ?? Date.now(),
      duration: h.duration ?? 0,
      hasError: h.hasError ?? false
    }))
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
  /** 自动记录执行结果 */
  addEntry: (entry: Omit<QueryHistory, 'id' | 'executedAt'>) => void
  /** 手动保存 SQL（不执行） */
  saveSql: (sql: string, connectionId: string, database?: string) => void
  clearHistory: () => void
  removeEntry: (id: string) => void
}

export const useHistoryStore = create<HistoryState>((set, get) => ({
  history: loadHistory(),

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

  saveSql: (sql, connectionId, database) => {
    const newEntry: QueryHistory = {
      id: `h_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      sql,
      connectionId,
      database,
      executedAt: Date.now(),
      duration: 0,
      hasError: false
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
  }
}))
