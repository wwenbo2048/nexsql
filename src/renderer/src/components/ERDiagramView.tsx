import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import {
  Loader2,
  AlertCircle,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Key,
  ArrowRight,
  Table as TableIcon
} from 'lucide-react'
import { useConnectionStore } from '@stores/connection'
import { useBrowserStore } from '@stores/browser'

interface ERTable {
  name: string
  columns: { name: string; type: string; isPK: boolean }[]
  x: number
  y: number
  w: number
  h: number
}

interface ERRelation {
  fromTable: string
  fromColumn: string
  toTable: string
  toColumn: string
  constraintName: string
}

const TABLE_W = 200
const HEADER_H = 28
const ROW_H = 20
const COL_GAP = 16
const ROW_GAP = 20

function calcTableHeight(cols: number): number {
  return HEADER_H + cols * ROW_H + 8
}

/** 简单网格布局 */
function layoutTables(tables: ERTable[]): ERTable[] {
  const cols = Math.ceil(Math.sqrt(tables.length))
  let maxRowH = 0
  return tables.map((t, i) => {
    const col = i % cols
    const row = Math.floor(i / cols)
    const x = col * (TABLE_W + COL_GAP) + 40
    const yBase = row === 0 ? 40 : 0
    if (row === 0) maxRowH = Math.max(maxRowH, t.h)
    const y = yBase + row * (maxRowH + ROW_GAP + 40)
    return { ...t, x, y: y || 40 + row * 200 }
  })
}

/** 计算连线锚点 */
function getAnchor(table: ERTable, colName: string, side: 'left' | 'right'): { x: number; y: number } {
  const colIdx = table.columns.findIndex((c) => c.name === colName)
  const y = table.y + HEADER_H + (colIdx >= 0 ? colIdx : 0) * ROW_H + ROW_H / 2 + 4
  return { x: side === 'left' ? table.x : table.x + table.w, y }
}

export default function ERDiagramView() {
  const connections = useConnectionStore((s) => s.connections)
  const selectedConnectionId = useBrowserStore((s) => s.selectedConnectionId)
  const selectedDatabase = useBrowserStore((s) => s.selectedDatabase)
  const config = connections.find((c) => c.id === selectedConnectionId)

  const [tables, setTables] = useState<ERTable[]>([])
  const [relations, setRelations] = useState<ERRelation[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [zoom, setZoom] = useState(0.8)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState<{ tableIdx: number; startX: number; startY: number; origX: number; origY: number } | null>(null)
  const [hoveredTable, setHoveredTable] = useState<string | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const panStartRef = useRef<{ x: number; y: number; origPan: { x: number; y: number } } | null>(null)

  const loadData = useCallback(async () => {
    if (!config || !selectedDatabase) return
    setLoading(true)
    setError(null)
    try {
      const [relRes, colRes] = await Promise.all([
        window.api.db.getERRelations(config, selectedDatabase),
        window.api.db.getERTableColumns(config, selectedDatabase)
      ])
      if (!colRes.success) throw new Error(colRes.error)
      const rawTables = colRes.data as { table: string; columns: { name: string; type: string; isPK: boolean }[] }[]
      const rawRels = (relRes.success ? relRes.data : []) as ERRelation[]

      const tbls: ERTable[] = rawTables.map((t) => ({
        name: t.table,
        columns: t.columns,
        x: 0,
        y: 0,
        w: TABLE_W,
        h: calcTableHeight(t.columns.length)
      }))

      const laid = layoutTables(tbls)
      setTables(laid)
      setRelations(rawRels)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [config, selectedDatabase])

  useEffect(() => { loadData() }, [loadData])

  // 拖拽表
  const handleTableMouseDown = useCallback((e: React.MouseEvent, idx: number) => {
    e.stopPropagation()
    const t = tables[idx]
    setDragging({ tableIdx: idx, startX: e.clientX, startY: e.clientY, origX: t.x, origY: t.y })
  }, [tables])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (dragging) {
      const dx = (e.clientX - dragging.startX) / zoom
      const dy = (e.clientY - dragging.startY) / zoom
      setTables((prev) => {
        const next = [...prev]
        next[dragging.tableIdx] = { ...next[dragging.tableIdx], x: dragging.origX + dx, y: dragging.origY + dy }
        return next
      })
    } else if (panStartRef.current) {
      setPan({
        x: panStartRef.current.origPan.x + e.clientX - panStartRef.current.x,
        y: panStartRef.current.origPan.y + e.clientY - panStartRef.current.y
      })
    }
  }, [dragging, zoom])

  const handleMouseUp = useCallback(() => {
    setDragging(null)
    panStartRef.current = null
  }, [])

  const handleBgMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.target === svgRef.current || (e.target as Element).classList.contains('er-bg')) {
      panStartRef.current = { x: e.clientX, y: e.clientY, origPan: { ...pan } }
    }
  }, [pan])

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    setZoom((z) => Math.max(0.2, Math.min(2, z - e.deltaY * 0.001)))
  }, [])

  // 相关关系
  const highlightedRelations = useMemo(() => {
    if (!hoveredTable) return new Set<number>()
    const set = new Set<number>()
    relations.forEach((r, i) => {
      if (r.fromTable === hoveredTable || r.toTable === hoveredTable) set.add(i)
    })
    return set
  }, [hoveredTable, relations])

  if (!config || !selectedDatabase) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-text-muted text-sm">
        <TableIcon size={32} className="opacity-30 mb-2" />
        <p>选择数据库查看 ER 关系图</p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-text-secondary gap-2">
        <Loader2 size={16} className="animate-spin text-accent" />
        加载 ER 数据...
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-start gap-2 p-4 text-sm text-red-400">
        <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
        <pre className="whitespace-pre-wrap font-mono text-xs">{error}</pre>
      </div>
    )
  }

  if (tables.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-text-muted text-sm">
        <TableIcon size={32} className="opacity-30 mb-2" />
        <p>该数据库没有表</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-bg-primary">
      {/* 工具栏 */}
      <div className="flex items-center gap-2 px-3 py-1 border-b border-border-light bg-bg-secondary flex-shrink-0">
        <TableIcon size={14} className="text-accent" />
        <span className="text-xs font-medium text-text-primary">ER 关系图</span>
        <span className="text-[10px] text-text-muted">{tables.length} 表 · {relations.length} 关系</span>
        <div className="ml-auto flex items-center gap-1">
          <button onClick={() => setZoom((z) => Math.min(2, z + 0.1))} className="p-1 hover:bg-bg-hover rounded text-text-secondary" title="放大">
            <ZoomIn size={14} />
          </button>
          <span className="text-[10px] text-text-muted w-8 text-center">{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom((z) => Math.max(0.2, z - 0.1))} className="p-1 hover:bg-bg-hover rounded text-text-secondary" title="缩小">
            <ZoomOut size={14} />
          </button>
          <button onClick={() => { setZoom(0.8); setPan({ x: 0, y: 0 }) }} className="p-1 hover:bg-bg-hover rounded text-text-secondary" title="重置视图">
            <Maximize2 size={14} />
          </button>
        </div>
      </div>

      {/* SVG 画布 */}
      <div className="flex-1 overflow-hidden">
        <svg
          ref={svgRef}
          className="w-full h-full er-bg"
          style={{ cursor: dragging ? 'grabbing' : panStartRef.current ? 'grabbing' : 'default' }}
          onMouseDown={handleBgMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onWheel={handleWheel}
        >
          <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
            {/* 连线 */}
            {relations.map((rel, idx) => {
              const fromTable = tables.find((t) => t.name === rel.fromTable)
              const toTable = tables.find((t) => t.name === rel.toTable)
              if (!fromTable || !toTable) return null

              const fromSide: 'left' | 'right' = fromTable.x < toTable.x ? 'right' : 'left'
              const toSide: 'left' | 'right' = fromSide === 'right' ? 'left' : 'right'
              const from = getAnchor(fromTable, rel.fromColumn, fromSide)
              const to = getAnchor(toTable, rel.toColumn, toSide)
              const midX = (from.x + to.x) / 2
              const isHighlighted = highlightedRelations.has(idx)

              return (
                <g key={idx}>
                  <path
                    d={`M ${from.x} ${from.y} C ${midX} ${from.y}, ${midX} ${to.y}, ${to.x} ${to.y}`}
                    fill="none"
                    stroke={isHighlighted ? '#60a5fa' : '#4b5563'}
                    strokeWidth={isHighlighted ? 2 : 1}
                    opacity={hoveredTable && !isHighlighted ? 0.2 : 1}
                  />
                  {/* 箭头 */}
                  <circle cx={to.x} cy={to.y} r={3} fill={isHighlighted ? '#60a5fa' : '#6b7280'} />
                </g>
              )
            })}

            {/* 表 */}
            {tables.map((t, idx) => {
              const isHovered = hoveredTable === t.name
              const isRelated = hoveredTable ? highlightedRelations.size > 0 && relations.some(
                (r) => (r.fromTable === hoveredTable && r.toTable === t.name) || (r.toTable === hoveredTable && r.fromTable === t.name)
              ) : false
              const dimmed = hoveredTable && !isHovered && !isRelated

              return (
                <g
                  key={t.name}
                  transform={`translate(${t.x}, ${t.y})`}
                  opacity={dimmed ? 0.3 : 1}
                  onMouseEnter={() => setHoveredTable(t.name)}
                  onMouseLeave={() => setHoveredTable(null)}
                  onMouseDown={(e) => handleTableMouseDown(e, idx)}
                  style={{ cursor: 'grab' }}
                >
                  {/* 表体 */}
                  <rect width={t.w} height={t.h} rx={4} fill="#1e1e2e" stroke={isHovered ? '#60a5fa' : '#3f3f46'} strokeWidth={isHovered ? 1.5 : 1} />
                  {/* 表头 */}
                  <rect width={t.w} height={HEADER_H} rx={4} fill="#2a2a3e" />
                  <rect y={HEADER_H - 4} width={t.w} height={4} fill="#2a2a3e" />
                  <text x={8} y={HEADER_H / 2 + 4} fontSize={11} fontWeight="bold" fill="#e2e8f0">
                    {t.name}
                  </text>
                  <text x={t.w - 8} y={HEADER_H / 2 + 4} fontSize={9} fill="#64748b" textAnchor="end">
                    {t.columns.length} 列
                  </text>

                  {/* 列 */}
                  {t.columns.map((col, ci) => (
                    <g key={col.name} transform={`translate(0, ${HEADER_H + ci * ROW_H})`}>
                      <text x={8} y={ROW_H / 2 + 4} fontSize={10} fill={col.isPK ? '#fbbf24' : '#a1a1aa'}>
                        {col.isPK && <tspan fontSize={8}>🔑 </tspan>}
                        {col.name}
                      </text>
                      <text x={t.w - 8} y={ROW_H / 2 + 4} fontSize={9} fill="#64748b" textAnchor="end">
                        {col.type}
                      </text>
                    </g>
                  ))}
                </g>
              )
            })}
          </g>
        </svg>
      </div>

      {/* 图例 */}
      <div className="flex items-center gap-3 px-3 py-1 border-t border-border-light bg-bg-secondary text-[10px] text-text-muted flex-shrink-0">
        <span className="flex items-center gap-1"><Key size={10} className="text-yellow-400" /> 主键</span>
        <span className="flex items-center gap-1"><ArrowRight size={10} /> 外键关系</span>
        <span className="ml-auto">滚轮缩放 · 拖拽平移 · 拖拽表重新布局</span>
      </div>
    </div>
  )
}
