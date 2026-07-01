import { create } from 'zustand'

interface UiState {
  sidebarWidth: number
  rightPanelWidth: number
  resultPanelHeight: number
  showConnectionModal: boolean
  editingConnectionId: string | null
  connectionPresetType: 'mysql' | 'redis' | null
  contextMenu: { x: number; y: number; items: ContextMenuItem[] } | null
  // Actions
  setSidebarWidth: (width: number) => void
  setRightPanelWidth: (width: number) => void
  setResultPanelHeight: (height: number) => void
  openConnectionModal: (editingId?: string, presetType?: 'mysql' | 'redis') => void
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
  rightPanelWidth: 340,
  resultPanelHeight: 260,
  showConnectionModal: false,
  editingConnectionId: null,
  connectionPresetType: null,
  contextMenu: null,

  setSidebarWidth: (width) => set({ sidebarWidth: Math.max(180, Math.min(500, width)) }),
  setRightPanelWidth: (width) => set({ rightPanelWidth: Math.max(200, Math.min(window.innerWidth - 400, width)) }),
  setResultPanelHeight: (height) => set({ resultPanelHeight: Math.max(100, Math.min(600, height)) }),
  openConnectionModal: (editingId, presetType) =>
    set({ showConnectionModal: true, editingConnectionId: editingId ?? null, connectionPresetType: presetType ?? null }),
  closeConnectionModal: () =>
    set({ showConnectionModal: false, editingConnectionId: null, connectionPresetType: null }),
  setContextMenu: (menu) => set({ contextMenu: menu })
}))
