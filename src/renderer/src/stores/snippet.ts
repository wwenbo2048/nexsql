import { create } from 'zustand'

export interface SqlSnippet {
  id: string
  name: string
  category: string
  sql: string
  description?: string
  variables?: string[]  // e.g. ['{{table}}', '{{database}}']
  createdAt: number
  updatedAt: number
}

const STORAGE_KEY = 'nexsql-sql-snippets'

function loadSnippets(): SqlSnippet[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    return JSON.parse(raw) as SqlSnippet[]
  } catch {
    return []
  }
}

function persist(snippets: SqlSnippet[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snippets))
  } catch { /* ignore */ }
}

function extractVariables(sql: string): string[] {
  const matches = sql.match(/\{\{(\w+)\}\}/g)
  if (!matches) return []
  return [...new Set(matches)]
}

interface SnippetState {
  snippets: SqlSnippet[]
  selectedSnippetId: string | null
  // Actions
  selectSnippet: (id: string | null) => void
  saveSnippet: (name: string, sql: string, category?: string, description?: string) => void
  updateSnippet: (id: string, updates: Partial<Pick<SqlSnippet, 'name' | 'sql' | 'category' | 'description'>>) => void
  deleteSnippet: (id: string) => void
  getCategories: () => string[]
}

export const useSnippetStore = create<SnippetState>((set, get) => ({
  snippets: loadSnippets(),
  selectedSnippetId: null,

  selectSnippet: (id) => set({ selectedSnippetId: id }),

  saveSnippet: (name, sql, category = '通用', description) => {
    const now = Date.now()
    const snippet: SqlSnippet = {
      id: `snip_${now}_${Math.random().toString(36).slice(2, 8)}`,
      name,
      category,
      sql,
      description,
      variables: extractVariables(sql),
      createdAt: now,
      updatedAt: now
    }
    const snippets = [...get().snippets, snippet]
    persist(snippets)
    set({ snippets, selectedSnippetId: snippet.id })
  },

  updateSnippet: (id, updates) => {
    const snippets = get().snippets.map((s) =>
      s.id === id
        ? { ...s, ...updates, variables: updates.sql ? extractVariables(updates.sql) : s.variables, updatedAt: Date.now() }
        : s
    )
    persist(snippets)
    set({ snippets })
  },

  deleteSnippet: (id) => {
    const snippets = get().snippets.filter((s) => s.id !== id)
    persist(snippets)
    set((state) => ({
      snippets,
      selectedSnippetId: state.selectedSnippetId === id ? null : state.selectedSnippetId
    }))
  },

  getCategories: () => {
    const cats = new Set(get().snippets.map((s) => s.category))
    return [...cats].sort()
  }
}))
