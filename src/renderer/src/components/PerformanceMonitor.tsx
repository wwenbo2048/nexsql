import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Activity, Server, Cpu, HardDrive, Zap, Clock, RefreshCw,
  Database, AlertTriangle, Loader2, TrendingUp, MemoryStick,
  Network, ChevronDown, ChevronRight
} from 'lucide-react'
import type { Tab, ConnectionConfig, ServerStatusData, ServerVariable, ProcessListItem } from '@shared/types'
import { useConnectionStore } from '@stores/connection'

// ==================== 工具函数 ====================

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 2 ? 2 : 1)} ${units[i]}`
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  return `${days}d ${hours}h`
}

function formatNumber(n: number): string {
  return n.toLocaleString()
}

function getStatusValue(status: ServerVariable[], name: string): number {
  const item = status.find((s) => s.name === name)
  return item ? Number(item.value) || 0 : 0
}

function getVariableValue(variables: ServerVariable[], name: string): string {
  const item = variables.find((v) => v.name === name)
  return item ? item.value : '-'
}

// ==================== 指标卡片 ====================

function MetricCard({
  icon, label, value, subValue, color, trend
}: {
  icon: React.ReactNode
  label: string
  value: string
  subValue?: string
  color: string
  trend?: string
}) {
  return (
    <div className="flex items-center gap-3 p-3 rounded-lg bg-bg-secondary border border-border-light">
      <div className={`flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center ${color}`}>
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] text-text-muted truncate">{label}</div>
        <div className="text-lg font-semibold text-text-primary leading-tight">{value}</div>
        {subValue && <div className="text-[10px] text-text-muted truncate">{subValue}</div>}
      </div>
      {trend && (
        <div className="flex items-center gap-0.5 text-[10px] text-green-400 flex-shrink-0">
          <TrendingUp size={10} />{trend}
        </div>
      )}
    </div>
  )
}

// ==================== 折叠面板 ====================

function CollapsibleSection({
  title, icon, children, defaultOpen = true, right
}: {
  title: string
  icon: React.ReactNode
  children: React.ReactNode
  defaultOpen?: boolean
  right?: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="rounded-lg border border-border-light bg-bg-secondary overflow-hidden">
      <div
        className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-bg-hover transition-colors"
        onClick={() => setOpen(!open)}
      >
        {open ? <ChevronDown size={14} className="text-text-muted" /> : <ChevronRight size={14} className="text-text-muted" />}
        <span className="text-text-muted flex-shrink-0">{icon}</span>
        <span className="text-sm font-medium text-text-primary flex-1">{title}</span>
        {right}
      </div>
      {open && <div className="px-3 pb-3 pt-1">{children}</div>}
    </div>
  )
}

// ==================== 主组件 ====================

export default function PerformanceMonitor({ tab }: { tab: Tab }) {
  const connections = useConnectionStore((s) => s.connections)
  const config = connections.find((c) => c.id === tab.connectionId) as ConnectionConfig | undefined

  const [data, setData] = useState<ServerStatusData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchData = useCallback(async () => {
    if (!config) return
    try {
      setError(null)
      const res = await window.api.db.getServerStatus(config)
      if (res.success && res.data) {
        setData(res.data)
        setLastUpdate(new Date())
      } else {
        setError(res.error ?? '获取性能数据失败')
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [config])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  useEffect(() => {
    if (autoRefresh) {
      intervalRef.current = setInterval(fetchData, 5000)
      return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
    }
  }, [autoRefresh, fetchData])

  if (!config) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-text-muted">
        <Server size={48} className="opacity-20 mb-3" />
        <p className="text-sm">未找到连接配置</p>
      </div>
    )
  }

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center h-full text-text-muted gap-2">
        <Loader2 size={16} className="animate-spin text-accent" />
        <span className="text-sm">加载性能数据...</span>
      </div>
    )
  }

  if (error && !data) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-red-400 gap-2">
        <AlertTriangle size={32} className="opacity-50" />
        <p className="text-sm">{error}</p>
        <button
          onClick={fetchData}
          className="mt-2 px-3 py-1.5 rounded text-xs bg-accent text-white hover:bg-accent/80 transition-colors"
        >
          重试
        </button>
      </div>
    )
  }

  if (!data) return null

  // ==================== 计算关键指标 ====================

  const uptime = getStatusValue(data.status, 'Uptime')
  const questions = getStatusValue(data.status, 'Questions')
  const qps = uptime > 0 ? (questions / uptime).toFixed(2) : '0'
  const threadsConnected = getStatusValue(data.status, 'Threads_connected')
  const threadsRunning = getStatusValue(data.status, 'Threads_running')
  const maxUsedConnections = getStatusValue(data.status, 'Max_used_connections')
  const maxConnections = Number(getVariableValue(data.variables, 'max_connections')) || 0
  const slowQueries = getStatusValue(data.status, 'Slow_queries')
  const bytesReceived = getStatusValue(data.status, 'Bytes_received')
  const bytesSent = getStatusValue(data.status, 'Bytes_sent')

  // Buffer pool hit rate
  const bpReadRequests = getStatusValue(data.status, 'Innodb_buffer_pool_read_requests')
  const bpReads = getStatusValue(data.status, 'Innodb_buffer_pool_reads')
  const bpHitRate = bpReadRequests > 0
    ? (((bpReadRequests - bpReads) / bpReadRequests) * 100).toFixed(2)
    : '0.00'

  // Key buffer hit rate
  const keyReadRequests = getStatusValue(data.status, 'Key_read_requests')
  const keyReads = getStatusValue(data.status, 'Key_reads')
  const keyHitRate = keyReadRequests > 0
    ? (((keyReadRequests - keyReads) / keyReadRequests) * 100).toFixed(2)
    : 'N/A'

  // Temp tables on disk ratio
  const tmpDiskTables = getStatusValue(data.status, 'Created_tmp_disk_tables')
  const tmpTables = getStatusValue(data.status, 'Created_tmp_tables')
  const tmpDiskRatio = tmpTables > 0
    ? ((tmpDiskTables / tmpTables) * 100).toFixed(2)
    : '0.00'

  const innodbBufferPoolSize = Number(getVariableValue(data.variables, 'innodb_buffer_pool_size')) || 0
  const version = getVariableValue(data.variables, 'version')
  const versionComment = getVariableValue(data.variables, 'version_comment')
  const hostname = getVariableValue(data.variables, 'hostname')
  const port = getVariableValue(data.variables, 'port')

  const connUsagePercent = maxConnections > 0 ? Math.min(100, (threadsConnected / maxConnections) * 100) : 0
  const totalDataSize = data.databaseSizes.reduce((sum, d) => sum + d.size, 0)

  return (
    <div className="flex flex-col h-full bg-bg-primary">
      {/* 工具栏 */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border-light bg-bg-secondary flex-shrink-0">
        <Activity size={14} className="text-accent" />
        <span className="text-sm font-medium text-text-primary">性能监控</span>
        <span className="text-xs text-text-muted">{config.name} ({hostname}:{port})</span>
        <div className="ml-auto flex items-center gap-2">
          {lastUpdate && (
            <span className="text-[10px] text-text-muted">
              更新于 {lastUpdate.toLocaleTimeString()}
            </span>
          )}
          <button
            onClick={fetchData}
            className="flex items-center gap-1 px-2 py-1 rounded text-xs hover:bg-bg-hover text-text-secondary hover:text-text-primary transition-colors"
            title="手动刷新"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            刷新
          </button>
          <label className="flex items-center gap-1 text-xs text-text-secondary cursor-pointer">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="accent-accent"
            />
            自动刷新(5s)
          </label>
        </div>
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-red-400 bg-red-950/30 border-b border-red-800/40">
          <AlertTriangle size={12} />
          {error}
        </div>
      )}

      {/* 滚动内容 */}
      <div className="flex-1 overflow-auto p-3 space-y-3">
        {/* 服务器信息 */}
        <div className="flex items-center gap-4 px-3 py-2 rounded-lg bg-gradient-to-r from-accent/10 to-transparent border border-border-light">
          <Server size={20} className="text-accent flex-shrink-0" />
          <div className="flex-1 flex items-center gap-4 text-xs flex-wrap">
            <span className="text-text-primary font-medium">{versionComment} MySQL {version}</span>
            <span className="text-text-muted">|</span>
            <span className="text-text-secondary">运行时长: <span className="text-green-400 font-mono">{formatDuration(uptime)}</span></span>
            <span className="text-text-muted">|</span>
            <span className="text-text-secondary">主机: <span className="text-text-primary font-mono">{hostname}:{port}</span></span>
          </div>
        </div>

        {/* 关键指标卡片 */}
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
          <MetricCard
            icon={<Zap size={18} className="text-yellow-400" />}
            label="QPS (每秒查询)"
            value={qps}
            subValue={`总查询 ${formatNumber(questions)}`}
            color="bg-yellow-500/10"
          />
          <MetricCard
            icon={<Network size={18} className="text-blue-400" />}
            label="当前连接数"
            value={`${threadsConnected}`}
            subValue={`最大 ${maxConnections} · 峰值 ${maxUsedConnections}`}
            color="bg-blue-500/10"
          />
          <MetricCard
            icon={<Cpu size={18} className={threadsRunning > 10 ? 'text-red-400' : 'text-green-400'} />}
            label="活跃线程"
            value={`${threadsRunning}`}
            subValue={`缓存线程 ${getStatusValue(data.status, 'Threads_cached')}`}
            color="bg-green-500/10"
          />
          <MetricCard
            icon={<Clock size={18} className={slowQueries > 0 ? 'text-orange-400' : 'text-text-muted'} />}
            label="慢查询"
            value={formatNumber(slowQueries)}
            subValue={`阈值 ${getVariableValue(data.variables, 'long_query_time')}s`}
            color="bg-orange-500/10"
          />
          <MetricCard
            icon={<MemoryStick size={18} className="text-purple-400" />}
            label="InnoDB 缓冲池命中率"
            value={`${bpHitRate}%`}
            subValue={innodbBufferPoolSize > 0 ? `大小 ${formatBytes(innodbBufferPoolSize)}` : undefined}
            color="bg-purple-500/10"
          />
          <MetricCard
            icon={<HardDrive size={18} className="text-cyan-400" />}
            label="Key Buffer 命中率"
            value={keyHitRate === 'N/A' ? 'N/A' : `${keyHitRate}%`}
            subValue={`读请求 ${formatNumber(keyReadRequests)}`}
            color="bg-cyan-500/10"
          />
          <MetricCard
            icon={<Database size={18} className="text-accent" />}
            label="数据总大小"
            value={formatBytes(totalDataSize)}
            subValue={`${data.databaseSizes.length} 个数据库`}
            color="bg-accent/10"
          />
          <MetricCard
            icon={<Activity size={18} className="text-pink-400" />}
            label="网络 I/O"
            value={formatBytes(bytesReceived + bytesSent)}
            subValue={`入 ${formatBytes(bytesReceived)} / 出 ${formatBytes(bytesSent)}`}
            color="bg-pink-500/10"
          />
        </div>

        {/* 连接使用率进度条 */}
        <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-bg-secondary border border-border-light">
          <Network size={14} className="text-blue-400 flex-shrink-0" />
          <span className="text-xs text-text-secondary flex-shrink-0">连接使用率</span>
          <div className="flex-1 h-3 bg-bg-tertiary rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                connUsagePercent > 80 ? 'bg-red-500' : connUsagePercent > 60 ? 'bg-orange-400' : 'bg-green-500'
              }`}
              style={{ width: `${connUsagePercent}%` }}
            />
          </div>
          <span className="text-xs text-text-primary font-mono flex-shrink-0">
            {threadsConnected} / {maxConnections} ({connUsagePercent.toFixed(1)}%)
          </span>
        </div>

        {/* 实时会话 */}
        <CollapsibleSection
          title="实时会话"
          icon={<Cpu size={14} />}
          right={<span className="text-[10px] text-text-muted">{data.processList.length} 个连接</span>}
        >
          {data.processList.length === 0 ? (
            <div className="text-center py-4 text-xs text-text-muted">无活跃会话</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="border-b border-border-light text-text-muted">
                    <th className="px-2 py-1.5 text-left font-medium">ID</th>
                    <th className="px-2 py-1.5 text-left font-medium">用户</th>
                    <th className="px-2 py-1.5 text-left font-medium">主机</th>
                    <th className="px-2 py-1.5 text-left font-medium">数据库</th>
                    <th className="px-2 py-1.5 text-left font-medium">命令</th>
                    <th className="px-2 py-1.5 text-right font-medium">时间(s)</th>
                    <th className="px-2 py-1.5 text-left font-medium">状态</th>
                    <th className="px-2 py-1.5 text-left font-medium max-w-[300px]">SQL</th>
                  </tr>
                </thead>
                <tbody>
                  {data.processList.map((p: ProcessListItem) => (
                    <tr key={p.id} className="border-b border-border-light/30 hover:bg-bg-hover transition-colors">
                      <td className="px-2 py-1 text-text-muted font-mono">{p.id}</td>
                      <td className="px-2 py-1 text-text-primary">{p.user}</td>
                      <td className="px-2 py-1 text-text-muted font-mono text-[11px]">{p.host}</td>
                      <td className="px-2 py-1 text-accent">{p.db ?? '-'}</td>
                      <td className="px-2 py-1">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                          p.command === 'Sleep' ? 'bg-text-muted/20 text-text-muted'
                          : p.command === 'Query' ? 'bg-blue-500/20 text-blue-400'
                          : 'bg-accent/20 text-accent'
                        }`}>
                          {p.command}
                        </span>
                      </td>
                      <td className={`px-2 py-1 text-right font-mono ${p.time > 10 ? 'text-orange-400' : 'text-text-secondary'}`}>
                        {p.time}
                      </td>
                      <td className="px-2 py-1 text-text-muted text-[11px]">{p.state ?? '-'}</td>
                      <td className="px-2 py-1 text-text-muted font-mono text-[11px] max-w-[300px] truncate" title={p.info ?? ''}>
                        {p.info ?? '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CollapsibleSection>

        {/* 数据库大小概览 */}
        <CollapsibleSection
          title="数据库大小概览"
          icon={<Database size={14} />}
          right={<span className="text-[10px] text-text-muted">总计 {formatBytes(totalDataSize)}</span>}
        >
          {data.databaseSizes.length === 0 ? (
            <div className="text-center py-4 text-xs text-text-muted">无用户数据库</div>
          ) : (
            <div className="space-y-1.5">
              {data.databaseSizes.map((db) => {
                const maxDbSize = data.databaseSizes[0]?.size || 1
                const barWidth = maxDbSize > 0 ? (db.size / maxDbSize) * 100 : 0
                return (
                  <div key={db.database} className="flex items-center gap-2">
                    <span className="text-xs text-text-primary font-mono w-32 truncate flex-shrink-0">{db.database}</span>
                    <div className="flex-1 h-4 bg-bg-tertiary rounded overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-accent/60 to-accent rounded transition-all duration-500"
                        style={{ width: `${barWidth}%` }}
                      />
                    </div>
                    <span className="text-[11px] text-text-secondary font-mono w-20 text-right flex-shrink-0">{formatBytes(db.size)}</span>
                    <span className="text-[10px] text-text-muted w-12 text-right flex-shrink-0">{db.tables} 表</span>
                  </div>
                )
              })}
            </div>
          )}
        </CollapsibleSection>

        {/* 性能告警 */}
        <CollapsibleSection title="性能告警" icon={<AlertTriangle size={14} />} defaultOpen={false}>
          <div className="space-y-1.5">
            {(() => {
              const alerts: { level: 'warning' | 'danger'; msg: string }[] = []

              if (Number(bpHitRate) < 95 && bpReadRequests > 0) {
                alerts.push({ level: 'warning', msg: `InnoDB 缓冲池命中率偏低 (${bpHitRate}%)，建议增大 innodb_buffer_pool_size` })
              }
              if (keyHitRate !== 'N/A' && Number(keyHitRate) < 95 && keyReadRequests > 0) {
                alerts.push({ level: 'warning', msg: `Key Buffer 命中率偏低 (${keyHitRate}%)，建议增大 key_buffer_size` })
              }
              if (Number(tmpDiskRatio) > 25) {
                alerts.push({ level: 'warning', msg: `临时表使用磁盘比例较高 (${tmpDiskRatio}%)，建议增大 tmp_table_size/max_heap_table_size` })
              }
              if (connUsagePercent > 80) {
                alerts.push({ level: 'danger', msg: `连接使用率过高 (${connUsagePercent.toFixed(1)}%)，接近 max_connections (${maxConnections})` })
              }
              if (slowQueries > 100) {
                alerts.push({ level: 'warning', msg: `慢查询数量较多 (${formatNumber(slowQueries)})，建议检查 long_query_time 设置和索引` })
              }
              const abortedConnects = getStatusValue(data.status, 'Aborted_connects')
              if (abortedConnects > 100) {
                alerts.push({ level: 'warning', msg: `中止连接数较多 (${formatNumber(abortedConnects)})，可能存在网络问题或认证失败` })
              }
              const tableLocksWaited = getStatusValue(data.status, 'Table_locks_waited')
              if (tableLocksWaited > 0) {
                alerts.push({ level: 'warning', msg: `表锁等待 ${formatNumber(tableLocksWaited)} 次，建议优化查询或考虑行级锁` })
              }
              const selectFullJoin = getStatusValue(data.status, 'Select_full_join')
              if (selectFullJoin > 0) {
                alerts.push({ level: 'warning', msg: `存在全表扫描 JOIN (${formatNumber(selectFullJoin)} 次)，建议添加合适的索引` })
              }
              if (alerts.length === 0) {
                return <div className="flex items-center gap-2 py-2 text-xs text-green-400"><Activity size={14} /> 各项指标正常</div>
              }
              return alerts.map((a, i) => (
                <div key={i} className={`flex items-start gap-2 px-2 py-1.5 rounded text-xs ${
                  a.level === 'danger' ? 'bg-red-950/30 text-red-400' : 'bg-orange-950/20 text-orange-400'
                }`}>
                  <AlertTriangle size={12} className="flex-shrink-0 mt-0.5" />
                  <span>{a.msg}</span>
                </div>
              ))
            })()}
          </div>
        </CollapsibleSection>

        {/* 服务器变量 */}
        <CollapsibleSection title="关键服务器变量" icon={<Server size={14} />} defaultOpen={false}>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-1">
            {data.variables.map((v) => (
              <div key={v.name} className="flex items-center justify-between py-0.5 border-b border-border-light/20 text-xs">
                <span className="text-text-muted truncate pr-2" title={v.name}>{v.name}</span>
                <span className="text-text-primary font-mono text-[11px] truncate max-w-[150px]" title={v.value}>{v.value}</span>
              </div>
            ))}
          </div>
        </CollapsibleSection>

        {/* 所有状态指标 */}
        <CollapsibleSection
          title="所有状态指标"
          icon={<Activity size={14} />}
          defaultOpen={false}
          right={<span className="text-[10px] text-text-muted">{data.status.length} 项</span>}
        >
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-1">
            {data.status.map((s) => (
              <div key={s.name} className="flex items-center justify-between py-0.5 border-b border-border-light/20 text-xs">
                <span className="text-text-muted truncate pr-2" title={s.name}>{s.name}</span>
                <span className="text-text-primary font-mono text-[11px] truncate max-w-[150px]" title={s.value}>{s.value}</span>
              </div>
            ))}
          </div>
        </CollapsibleSection>
      </div>
    </div>
  )
}
