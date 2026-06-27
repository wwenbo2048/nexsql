import { create } from 'zustand'
import type { TableInfo, ViewInfo, RoutineInfo, EventInfo } from '@shared/types'

export type DbCategory = 'tables' | 'views' | 'functions' | 'events' | 'query' | 'er' | 'snippets'
export type DetailTab = 'info' | 'data' | 'structure' | 'ddl' | 'er'

export interface SavedQuery {
  id: string
  name: string
  sql: string
  database: string
  connectionId: string
  createdAt: number
}

// --- localStorage helpers for saved queries ---
const STORAGE_KEY = 'nexsql-saved-queries'

function loadSavedQueries(): SavedQuery[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    return JSON.parse(raw) as SavedQuery[]
  } catch {
    return []
  }
}

function persistSavedQueries(queries: SavedQuery[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(queries))
  } catch {
    // ignore
  }
}

interface BrowserState {
  selectedConnectionId: string | null
  selectedDatabase: string | null
  selectedTable: string | null
  selectedCategory: DbCategory
  tables: TableInfo[]
  views: ViewInfo[]
  routines: RoutineInfo[]
  events: EventInfo[]
  listLoading: boolean
  listVersion: number
  isCreating: boolean
  isEditing: boolean
  preferredDetailTab: DetailTab | null
  savedQueries: SavedQuery[]
  activeQuerySql: string
  selectedQueryId: string | null
  compareSource: { table: string } | null
  search: string

  // Actions
  selectDatabase: (connectionId: string, database: string) => void
  selectCategory: (category: DbCategory) => void
  selectTable: (tableName: string | null, preferredTab?: DetailTab) => void
  setActiveQuerySql: (sql: string) => void
  selectQuery: (id: string | null) => void
  saveQuery: (name: string, sql: string) => void
  updateQuery: (id: string, sql: string) => void
  deleteQuery: (id: string) => void
  setTables: (tables: TableInfo[]) => void
  setViews: (views: ViewInfo[]) => void
  setRoutines: (routines: RoutineInfo[]) => void
  setEvents: (events: EventInfo[]) => void
  setListLoading: (loading: boolean) => void
  refreshList: () => void
  startCreating: () => void
  stopCreating: () => void
  startEditing: () => void
  stopEditing: () => void
  setCompareSource: (source: { table: string } | null) => void
  setSearch: (search: string) => void
  clearSelection: () => void
}

export const useBrowserStore = create<BrowserState>((set, get) => ({
  selectedConnectionId: null,
  selectedDatabase: null,
  selectedTable: null,
  selectedCategory: 'tables',
  tables: [],
  views: [],
  routines: [],
  events: [],
  listLoading: false,
  listVersion: 0,
  isCreating: false,
  isEditing: false,
  preferredDetailTab: null,
  savedQueries: loadSavedQueries(),
  activeQuerySql: '',
  selectedQueryId: null,
  compareSource: null,
  search: '',

  selectDatabase: (connectionId, database) =>
    set({
      selectedConnectionId: connectionId,
      selectedDatabase: database,
      selectedTable: null,
      selectedCategory: 'tables',
      isCreating: false,
      isEditing: false,
      preferredDetailTab: null,
      tables: [],
      views: [],
      routines: [],
      events: [],
      listVersion: 0
    }),

  selectCategory: (category) =>
    set({ selectedCategory: category, selectedTable: null, isCreating: false, isEditing: false, preferredDetailTab: null }),

  selectTable: (tableName, preferredTab) =>
    set({ selectedTable: tableName, isCreating: false, isEditing: false, preferredDetailTab: preferredTab ?? 'info' }),

  setActiveQuerySql: (sql) => set({ activeQuerySql: sql }),

  selectQuery: (id) =>
    set((state) => {
      if (!id) return { selectedQueryId: null }
      const q = state.savedQueries.find((sq) => sq.id === id)
      return { selectedQueryId: id, activeQuerySql: q?.sql ?? '' }
    }),

  saveQuery: (name, sql) => {
    const state = get()
    const newQuery: SavedQuery = {
      id: `q_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name,
      sql,
      database: state.selectedDatabase ?? '',
      connectionId: state.selectedConnectionId ?? '',
      createdAt: Date.now()
    }
    const updated = [...state.savedQueries, newQuery]
    persistSavedQueries(updated)
    set({ savedQueries: updated, selectedQueryId: newQuery.id })
  },

  updateQuery: (id, sql) => {
    const state = get()
    const updated = state.savedQueries.map((q) => q.id === id ? { ...q, sql } : q)
    persistSavedQueries(updated)
    set({ savedQueries: updated })
  },

  deleteQuery: (id) => {
    const state = get()
    const updated = state.savedQueries.filter((q) => q.id !== id)
    persistSavedQueries(updated)
    set({ savedQueries: updated, selectedQueryId: state.selectedQueryId === id ? null : state.selectedQueryId })
  },

  setTables: (tables) => set({ tables }),
  setViews: (views) => set({ views }),
  setRoutines: (routines) => set({ routines }),
  setEvents: (events) => set({ events }),
  setListLoading: (loading) => set({ listLoading: loading }),

  refreshList: () => set((state) => ({ listVersion: state.listVersion + 1 })),

  startCreating: () => set({ isCreating: true, selectedTable: null, isEditing: false }),

  stopCreating: () => set({ isCreating: false }),

  startEditing: () => set({ isEditing: true }),

  stopEditing: () => set({ isEditing: false }),

  setCompareSource: (source) => set({ compareSource: source }),

  setSearch: (search) => set({ search }),

  clearSelection: () =>
    set({
      selectedConnectionId: null,
      selectedDatabase: null,
      selectedTable: null,
      selectedCategory: 'tables',
      isCreating: false,
      isEditing: false,
      preferredDetailTab: null,
      tables: [],
      views: [],
      routines: [],
      events: [],
      listVersion: 0
    })
}))
