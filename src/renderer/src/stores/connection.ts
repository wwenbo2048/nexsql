import { create } from 'zustand'
import type { ConnectionConfig, ConnectionStatus } from '@shared/types'

interface ConnectionState {
  connections: ConnectionConfig[]
  statuses: Record<string, ConnectionStatus>
  errors: Record<string, string | undefined>
  expandedConnections: Set<string>
  // Actions
  loadConnections: () => Promise<void>
  saveConnection: (config: ConnectionConfig) => Promise<void>
  deleteConnection: (id: string) => Promise<void>
  setStatus: (id: string, status: ConnectionStatus, error?: string) => void
  toggleExpand: (id: string) => void
}

export const useConnectionStore = create<ConnectionState>((set, get) => ({
  connections: [],
  statuses: {},
  errors: {},
  expandedConnections: new Set(),

  loadConnections: async () => {
    const connections = await window.api.config.getConnections()
    set({ connections })
  },

  saveConnection: async (config) => {
    await window.api.config.saveConnection(config)
    await get().loadConnections()
  },

  deleteConnection: async (id) => {
    await window.api.config.deleteConnection(id)
    const expanded = new Set(get().expandedConnections)
    expanded.delete(id)
    set((state) => {
      const statuses = { ...state.statuses }
      delete statuses[id]
      const errors = { ...state.errors }
      delete errors[id]
      return { expandedConnections: expanded, statuses, errors }
    })
    await get().loadConnections()
  },

  setStatus: (id, status, error) =>
    set((state) => ({
      statuses: { ...state.statuses, [id]: status },
      errors: { ...state.errors, [id]: error }
    })),

  toggleExpand: (id) =>
    set((state) => {
      const expanded = new Set(state.expandedConnections)
      if (expanded.has(id)) {
        expanded.delete(id)
      } else {
        expanded.add(id)
      }
      return { expandedConnections: expanded }
    })
}))
