import { create } from 'zustand'

const PAGE_SIZE_KEY = 'nexsql-default-page-size'
function loadPageSize(): number {
  try {
    const v = localStorage.getItem(PAGE_SIZE_KEY)
    return v ? Number(v) : 100
  } catch { return 100 }
}
function savePageSize(v: number) {
  try { localStorage.setItem(PAGE_SIZE_KEY, String(v)) } catch { /* ignore */ }
}

interface UiState {
  sidebarWidth: number
  rightPanelWidth: number
  resultPanelHeight: number
  defaultPageSize: number
  showConnectionModal: boolean
  editingConnectionId: string | null
  connectionPresetType: 'mysql' | 'redis' | null
  showMcpSettings: boolean
  showLanAccess: boolean
  contextMenu: { x: number; y: number; items: ContextMenuItem[] } | null
  // Actions
  setSidebarWidth: (width: number) => void
  setRightPanelWidth: (width: number) => void
  setResultPanelHeight: (height: number) => void
  setDefaultPageSize: (size: number) => void
  openConnectionModal: (editingId?: string, presetType?: 'mysql' | 'redis') => void
  closeConnectionModal: () => void
  openMcpSettings: () => void
  closeMcpSettings: () => void
  openLanAccess: () => void
  closeLanAccess: () => void
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
  defaultPageSize: loadPageSize(),
  showConnectionModal: false,
  editingConnectionId: null,
  connectionPresetType: null,
  showMcpSettings: false,
  showLanAccess: false,
  contextMenu: null,

  setSidebarWidth: (width) => set({ sidebarWidth: Math.max(180, Math.min(500, width)) }),
  setRightPanelWidth: (width) => set({ rightPanelWidth: Math.max(200, Math.min(window.innerWidth - 400, width)) }),
  setResultPanelHeight: (height) => set({ resultPanelHeight: Math.max(100, Math.min(600, height)) }),
  setDefaultPageSize: (size) => { savePageSize(size); set({ defaultPageSize: size }) },
  openConnectionModal: (editingId, presetType) =>
    set({ showConnectionModal: true, editingConnectionId: editingId ?? null, connectionPresetType: presetType ?? null }),
  closeConnectionModal: () =>
    set({ showConnectionModal: false, editingConnectionId: null, connectionPresetType: null }),
  openMcpSettings: () => set({ showMcpSettings: true }),
  closeMcpSettings: () => set({ showMcpSettings: false }),
  openLanAccess: () => set({ showLanAccess: true }),
  closeLanAccess: () => set({ showLanAccess: false }),
  setContextMenu: (menu) => set({ contextMenu: menu })
}))
