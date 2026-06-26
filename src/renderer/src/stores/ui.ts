import { create } from 'zustand'

interface UiState {
  sidebarWidth: number
  middlePanelWidth: number
  resultPanelHeight: number
  showConnectionModal: boolean
  editingConnectionId: string | null
  contextMenu: { x: number; y: number; items: ContextMenuItem[] } | null
  // Actions
  setSidebarWidth: (width: number) => void
  setMiddlePanelWidth: (width: number) => void
  setResultPanelHeight: (height: number) => void
  openConnectionModal: (editingId?: string) => void
  closeConnectionModal: () => void
  setContextMenu: (menu: { x: number; y: number; items: ContextMenuItem[] } | null) => void
}

export interface ContextMenuItem {
  label: string
  icon?: string
  onClick?: () => void
  separator?: boolean
  danger?: boolean
  disabled?: boolean
}

export const useUiStore = create<UiState>((set) => ({
  sidebarWidth: 280,
  middlePanelWidth: 300,
  resultPanelHeight: 260,
  showConnectionModal: false,
  editingConnectionId: null,
  contextMenu: null,

  setSidebarWidth: (width) => set({ sidebarWidth: Math.max(180, Math.min(500, width)) }),
  setMiddlePanelWidth: (width) => set({ middlePanelWidth: Math.max(200, Math.min(500, width)) }),
  setResultPanelHeight: (height) => set({ resultPanelHeight: Math.max(100, Math.min(600, height)) }),
  openConnectionModal: (editingId) =>
    set({ showConnectionModal: true, editingConnectionId: editingId ?? null }),
  closeConnectionModal: () =>
    set({ showConnectionModal: false, editingConnectionId: null }),
  setContextMenu: (menu) => set({ contextMenu: menu })
}))
