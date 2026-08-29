/**
 * 客户端共享层：开关 store、/nexsql/* API 封装、样式注入。
 * 无外部依赖（React 由外壳经 require 提供）。
 */

// ==================== 开关 store ====================

let open = false
const listeners = new Set<() => void>()

export const panelUi = {
  get: (): boolean => open,
  setOpen(value: boolean): void {
    if (open === value) return
    open = value
    for (const listener of listeners) listener()
  },
  toggle(): void {
    panelUi.setOpen(!open)
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
}

// ==================== API ====================

export interface PanelConnection {
  id: string
  name: string
  type: 'mysql' | 'redis'
  host: string
  port: number
  database?: string
  redisDb?: number
}

export interface PanelTable {
  columns: string[]
  rows: unknown[][]
}

export interface QueryResult {
  table?: PanelTable
  affected?: number
  insertId?: number
  changed?: number
  durationMs: number
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init)
  let body: unknown = undefined
  try {
    body = await response.json()
  } catch {
    /* 非 JSON 响应体 */
  }
  if (!response.ok) {
    const message =
      typeof body === 'object' && body !== null && typeof (body as { error?: unknown }).error === 'string'
        ? (body as { error: string }).error
        : `${path} → ${response.status}`
    throw new Error(message)
  }
  return body as T
}

function q(params: Record<string, string | number | undefined>): string {
  const sp = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') sp.set(key, String(value))
  }
  return sp.toString()
}

export const api = {
  connections(): Promise<{ connections: PanelConnection[] }> {
    return json('/nexsql/connections')
  },
  databases(connectionId: string): Promise<PanelTable> {
    return json(`/nexsql/databases?${q({ connectionId })}`)
  },
  tables(connectionId: string, database: string): Promise<PanelTable> {
    return json(`/nexsql/tables?${q({ connectionId, database })}`)
  },
  columns(connectionId: string, database: string, table: string): Promise<PanelTable> {
    return json(`/nexsql/columns?${q({ connectionId, database, table })}`)
  },
  data(
    connectionId: string,
    database: string,
    table: string,
    limit: number,
    offset: number,
    where?: string
  ): Promise<PanelTable> {
    return json(`/nexsql/data?${q({ connectionId, database, table, limit, offset, where })}`)
  },
  query(connectionId: string, sql: string, database?: string): Promise<QueryResult> {
    return json('/nexsql/query', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ connectionId, sql, database }),
    })
  },
  redisKeys(connectionId: string, pattern: string, count: number): Promise<{ keys: { key: string; type: string; ttl: number }[]; maybeMore: boolean }> {
    return json(`/nexsql/redis/keys?${q({ connectionId, pattern, count })}`)
  },
  redisKey(connectionId: string, key: string): Promise<{ key: string; type: string; ttl: number; value: string }> {
    return json(`/nexsql/redis/key?${q({ connectionId, key })}`)
  },
}

// ==================== 样式注入 ====================

const STYLE_ID = 'nexsql-panel-style'

const CSS = `
.nxp-overlay { position: fixed; inset: 0; z-index: 2200; display: flex; flex-direction: column; background: var(--nxp-bg, rgba(16,18,22,.98)); color: #e8eaf0; font-size: 13px; }
.nxp-header { display: flex; align-items: center; gap: 10px; padding: 10px 16px; border-bottom: 1px solid rgba(255,255,255,.09); flex: none; }
.nxp-title { font-weight: 600; font-size: 14px; }
.nxp-badge { font-size: 11px; padding: 2px 8px; border-radius: 999px; background: rgba(90,140,255,.18); color: #9db9ff; }
.nxp-header-space { flex: 1; }
.nxp-iconbutton { background: none; border: none; color: #aab; cursor: pointer; padding: 4px 6px; border-radius: 6px; font-size: 13px; }
.nxp-iconbutton:hover { background: rgba(255,255,255,.08); }
.nxp-close { font-size: 17px; line-height: 1; padding: 4px 10px; }
.nxp-body { display: flex; flex: 1; min-height: 0; }
.nxp-side { width: 260px; flex: none; border-right: 1px solid rgba(255,255,255,.09); overflow: auto; padding: 8px 6px; }
.nxp-main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.nxp-main-tabs { display: flex; gap: 4px; padding: 8px 14px 0; border-bottom: 1px solid rgba(255,255,255,.09); flex: none; }
.nxp-tab { background: none; border: none; color: #99a; padding: 6px 12px; cursor: pointer; border-bottom: 2px solid transparent; font-size: 13px; }
.nxp-tab-active { color: #e8eaf0; border-bottom-color: #6ea0ff; }
.nxp-content { flex: 1; min-height: 0; overflow: auto; padding: 12px 14px; }
.nxp-conn { display: flex; align-items: center; gap: 6px; padding: 5px 8px; border-radius: 6px; cursor: pointer; color: #cdd3e0; }
.nxp-conn:hover { background: rgba(255,255,255,.06); }
.nxp-conn-selected { background: rgba(110,160,255,.16); }
.nxp-conn-type { font-size: 10px; padding: 1px 5px; border-radius: 4px; flex: none; }
.nxp-type-mysql { background: rgba(0,150,199,.22); color: #7fc6e8; }
.nxp-type-redis { background: rgba(200,60,60,.22); color: #e8a0a0; }
.nxp-tree-row { display: flex; align-items: center; gap: 5px; padding: 3px 8px 3px 26px; border-radius: 5px; cursor: pointer; color: #b8bfcc; white-space: nowrap; }
.nxp-tree-row:hover { background: rgba(255,255,255,.06); }
.nxp-tree-row-selected { background: rgba(110,160,255,.18); color: #e8eaf0; }
.nxp-tree-table { padding-left: 44px; }
.nxp-tree-arrow { width: 12px; flex: none; display: inline-block; color: #778; font-size: 10px; }
.nxp-grid-wrap { border: 1px solid rgba(255,255,255,.1); border-radius: 8px; overflow: auto; max-height: calc(100vh - 210px); }
.nxp-grid { border-collapse: collapse; width: 100%; font-size: 12px; }
.nxp-grid th { position: sticky; top: 0; background: #23262e; color: #9db9ff; text-align: left; padding: 6px 10px; white-space: nowrap; border-bottom: 1px solid rgba(255,255,255,.12); }
.nxp-grid td { padding: 5px 10px; border-bottom: 1px solid rgba(255,255,255,.05); white-space: nowrap; max-width: 420px; overflow: hidden; text-overflow: ellipsis; color: #cdd3e0; }
.nxp-grid tr:hover td { background: rgba(255,255,255,.04); }
.nxp-toolbar { display: flex; align-items: center; gap: 8px; padding: 0 0 10px; flex-wrap: wrap; }
.nxp-input { background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.12); color: #e8eaf0; border-radius: 6px; padding: 5px 9px; font-size: 12px; outline: none; }
.nxp-input:focus { border-color: #6ea0ff; }
.nxp-sql { width: 100%; min-height: 84px; resize: vertical; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.nxp-button { background: rgba(110,160,255,.16); border: 1px solid rgba(110,160,255,.4); color: #bcd2ff; border-radius: 6px; padding: 5px 14px; cursor: pointer; font-size: 12px; }
.nxp-button:hover { background: rgba(110,160,255,.28); }
.nxp-button:disabled { opacity: .5; cursor: default; }
.nxp-meta { color: #889; font-size: 11px; }
.nxp-error { color: #ff9c9c; background: rgba(255,80,80,.1); border: 1px solid rgba(255,120,120,.3); border-radius: 6px; padding: 8px 12px; margin-bottom: 10px; white-space: pre-wrap; }
.nxp-empty { color: #778; padding: 40px; text-align: center; }
.nxp-loading { color: #889; padding: 30px; text-align: center; }
.nxp-pre { background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.1); border-radius: 8px; padding: 10px 12px; white-space: pre-wrap; word-break: break-all; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: #cdd3e0; max-height: 60vh; overflow: auto; }
.nxp-toggle-button { display: flex; align-items: center; justify-content: center; width: 28px; height: 28px; background: none; border: none; color: #aab; cursor: pointer; border-radius: 6px; opacity: .85; }
.nxp-toggle-button:hover { background: rgba(255,255,255,.08); color: #e8eaf0; opacity: 1; }
.nxp-settings { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 48px 24px; }
.nxp-settings-icon { color: #6ea0ff; display: flex; }
.nxp-settings-title { font-size: 16px; font-weight: 600; color: #e8eaf0; }
.nxp-settings-desc { font-size: 13px; color: #8b95a7; max-width: 440px; text-align: center; line-height: 1.8; }
.nxp-settings-open { margin-top: 8px; padding: 9px 26px; background: rgba(110,160,255,.14); border: 1px solid rgba(110,160,255,.4); color: #8ab2ff; font-size: 14px; cursor: pointer; border-radius: 8px; transition: all .12s ease; }
.nxp-settings-open:hover { background: rgba(110,160,255,.22); border-color: rgba(110,160,255,.6); color: #a9c6ff; }
.nxp-settings-hint { margin-top: 4px; font-size: 12px; color: #667; }
.nxp-toggle-button-active { color: #6ea0ff; }
.nxp-toggle-row { display: flex; align-items: center; gap: 8px; width: 100%; padding: 8px 10px; background: none; border: none; color: #aab; cursor: pointer; border-radius: 8px; font-size: 13px; }
.nxp-toggle-row:hover { background: rgba(255,255,255,.08); color: #e8eaf0; }
.nxp-toggle-row-active { color: #6ea0ff; }
`

export function ensureStyles(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = CSS
  document.head.appendChild(style)
}

/** 值的展示形式（null / 长文本截断）。 */
export function displayValue(value: unknown): string {
  if (value === null) return 'NULL'
  const text = typeof value === 'string' ? value : String(value)
  return text.length > 500 ? text.slice(0, 500) + '…' : text
}
