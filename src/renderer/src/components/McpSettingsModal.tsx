import { useState, useEffect, useCallback } from 'react'
import {
  X,
  Share2,
  Check,
  Copy,
  Terminal,
  FileJson,
  Server,
  BookOpen,
  AlertCircle,
  CheckCircle2,
  Loader2,
  ChevronRight,
  RefreshCw,
} from 'lucide-react'
import { useUiStore } from '@stores/ui'
import { useConnectionStore } from '@stores/connection'

interface McpInfo {
  serverPath: string
  configPath: string
  built: boolean
}

export default function McpSettingsModal() {
  const show = useUiStore((s) => s.showMcpSettings)
  const close = useUiStore((s) => s.closeMcpSettings)
  const { connections } = useConnectionStore()

  const [mcpInfo, setMcpInfo] = useState<McpInfo | null>(null)
  const [exporting, setExporting] = useState(false)
  const [syncResult, setSyncResult] = useState<string | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)

  // 加载 MCP 信息
  useEffect(() => {
    if (!show) return
    window.api.config.getMcpInfo().then((res) => {
      if (res.success && res.data) {
        setMcpInfo(res.data)
      }
    })
  }, [show])

  const handleExport = useCallback(async () => {
    setExporting(true)
    setExportError(null)
    setSyncResult(null)
    try {
      const result = await window.api.config.exportMcp()
      if (result.success && result.data) {
        setSyncResult(`已同步 ${result.data.count} 个连接`)
      } else {
        setExportError(result.error ?? '同步失败')
      }
    } catch (err) {
      setExportError(err instanceof Error ? err.message : String(err))
    } finally {
      setExporting(false)
    }
  }, [])

  const copyToClipboard = useCallback((text: string, key: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedKey(key)
      setTimeout(() => setCopiedKey(null), 2000)
    })
  }, [])

  if (!show) return null

  // 生成 MCP 客户端配置 JSON
  const serverPath = mcpInfo?.serverPath ?? '/path/to/nexSql/out/mcp/launcher.cjs'
  const configPath = mcpInfo?.configPath ?? '~/.nexsql/mcp-connections.json'

  const claudeDesktopConfig = JSON.stringify(
    {
      mcpServers: {
        nexsql: {
          command: 'node',
          args: [serverPath],
        },
      },
    },
    null,
    2
  )

  const cursorConfig = JSON.stringify(
    {
      mcpServers: {
        nexsql: {
          command: 'node',
          args: [serverPath],
        },
      },
    },
    null,
    2
  )

  const qoderConfig = JSON.stringify(
    {
      mcpServers: {
        nexsql: {
          command: 'node',
          args: [serverPath],
        },
      },
    },
    null,
    2
  )

  return (
    <div
      className="fixed inset-0 z-[250] flex items-center justify-center bg-black/60"
      onClick={close}
    >
      <div
        className="w-[760px] max-h-[85vh] bg-bg-secondary border border-border-light rounded-lg shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border-light flex-shrink-0">
          <div className="flex items-center gap-2">
            <Share2 size={16} className="text-accent" />
            <span className="text-sm font-semibold text-text-primary">MCP 服务配置</span>
            <span className="text-[10px] px-1.5 py-0.5 bg-accent/15 text-accent rounded font-medium">
              Model Context Protocol
            </span>
          </div>
          <button
            onClick={close}
            className="p-1 hover:bg-bg-hover rounded text-text-muted hover:text-text-primary transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* 内容区 */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* 简介 */}
          <div className="bg-bg-tertiary/50 rounded-lg px-4 py-3 border border-border-light">
            <div className="flex items-start gap-2.5">
              <BookOpen size={15} className="text-accent mt-0.5 flex-shrink-0" />
              <div className="text-xs text-text-secondary leading-relaxed">
                <span className="text-text-primary font-medium">MCP (Model Context Protocol)</span>{' '}
                允许 AI 助手（如 Claude Desktop、Cursor、Qoder 等）通过标准化协议连接并操作你的 MySQL 和 Redis 数据库。
                配置完成后，AI 助手可以直接执行 SQL 查询、浏览表结构、管理 Redis 键等操作。
              </div>
            </div>
          </div>

          {/* Step 1: 连接状态 */}
          <Section
            step={1}
            title="连接配置（自动同步）"
            icon={<CheckCircle2 size={14} />}
          >
            <p className="text-xs text-text-secondary mb-3">
              连接配置会在<span className="text-green-400 font-medium">新建、修改、删除连接时自动同步</span>到 MCP 配置文件，无需手动导出。
              当前已同步 <span className="text-text-primary font-medium">{connections.length}</span> 个连接。
            </p>

            <CopyableField
              label="MCP 配置文件路径"
              value={configPath}
              onCopy={() => copyToClipboard(configPath, 'configPath')}
              copied={copiedKey === 'configPath'}
            />

            <div className="mt-3 flex items-center gap-3">
              <button
                onClick={handleExport}
                disabled={exporting || connections.length === 0}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-bg-hover hover:bg-border-light text-text-secondary text-xs rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {exporting ? (
                  <>
                    <Loader2 size={12} className="animate-spin" />
                    手动同步中...
                  </>
                ) : (
                  <>
                    <RefreshCw size={12} />
                    手动重新同步
                  </>
                )}
              </button>

              {syncResult && (
                <div className="flex items-center gap-1.5 text-xs text-green-400">
                  <CheckCircle2 size={12} />
                  {syncResult}
                </div>
              )}
              {exportError && (
                <div className="flex items-center gap-1.5 text-xs text-red-400">
                  <AlertCircle size={12} />
                  {exportError}
                </div>
              )}
            </div>

            {connections.length === 0 && (
              <div className="mt-2 text-xs text-yellow-400 flex items-center gap-1.5">
                <AlertCircle size={12} />
                请先在应用中创建至少一个连接
              </div>
            )}
          </Section>

          {/* Step 2: 安装 MCP 服务器 */}
          <Section
            step={2}
            title="在目标电脑上安装 MCP 服务器"
            icon={<Server size={14} />}
          >
            <p className="text-xs text-text-secondary mb-3">
              在需要使用 MCP 的电脑上，确保已安装 <span className="text-text-primary font-medium">Node.js 18+</span>，然后选择以下方式之一：
            </p>

            {/* 方式 A: 使用项目构建产物 */}
            <div className="space-y-3">
              <div className="bg-bg-tertiary/50 rounded-lg border border-border-light overflow-hidden">
                <div className="px-3 py-2 bg-bg-tertiary border-b border-border-light">
                  <span className="text-xs font-medium text-text-primary">方式 A：复制 MCP 服务器文件（推荐）</span>
                </div>
                <div className="px-3 py-3 space-y-2">
                  <p className="text-[11px] text-text-muted">
                    将 nexSql 项目的 <code className="text-accent">out/mcp/</code> 目录和{' '}
                    <code className="text-accent">node_modules/</code> 复制到目标电脑，然后运行：
                  </p>
                  <CopyableCodeBlock
                    code={`# 1. 复制配置文件到目标电脑\nscp ~/.nexsql/mcp-connections.json target-host:~/.nexsql/\n\n# 2. 在目标电脑启动 MCP 服务器\nnode /path/to/out/mcp/launcher.cjs`}
                    onCopy={() => copyToClipboard('scp ~/.nexsql/mcp-connections.json target-host:~/.nexsql/\n\n# 在目标电脑启动\nnode /path/to/out/mcp/launcher.cjs', 'method-a')}
                    copied={copiedKey === 'method-a'}
                  />
                </div>
              </div>

              {/* 方式 B: 使用源码 */}
              <div className="bg-bg-tertiary/50 rounded-lg border border-border-light overflow-hidden">
                <div className="px-3 py-2 bg-bg-tertiary border-b border-border-light">
                  <span className="text-xs font-medium text-text-primary">方式 B：克隆源码运行</span>
                </div>
                <div className="px-3 py-3 space-y-2">
                  <CopyableCodeBlock
                    code={`# 1. 克隆项目并安装依赖\ngit clone <nexsql-repo> && cd nexsql\nnpm install\n\n# 2. 构建 MCP 服务器\nnpm run mcp:build\n\n# 3. 复制配置文件到 ~/.nexsql/mcp-connections.json\n# 4. 启动\nnpm run mcp:dev  # 或 node out/mcp/index.js`}
                    onCopy={() => copyToClipboard('git clone <nexsql-repo> && cd nexsql\nnpm install\nnpm run mcp:build\nnpm run mcp:dev', 'method-b')}
                    copied={copiedKey === 'method-b'}
                  />
                </div>
              </div>
            </div>

            {/* 服务器路径信息 */}
            {mcpInfo && (
              <div className="mt-3 flex items-center gap-2 text-[11px]">
                {mcpInfo.built ? (
                  <span className="flex items-center gap-1 text-green-400">
                    <CheckCircle2 size={11} />
                    MCP 服务器已构建
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-yellow-400">
                    <AlertCircle size={11} />
                    未构建，请运行 npm run mcp:build
                  </span>
                )}
              </div>
            )}
          </Section>

          {/* Step 3: 配置 MCP 客户端 */}
          <Section
            step={3}
            title="配置 MCP 客户端"
            icon={<FileJson size={14} />}
          >
            <p className="text-xs text-text-secondary mb-3">
              在 AI 助手的配置文件中添加以下内容。选择你使用的客户端：
            </p>

            {/* Tab 切换 */}
            <ConfigTabs
              tabs={[
                {
                  name: 'Claude Desktop',
                  configPath: '~/Library/Application Support/Claude/claude_desktop_config.json (macOS)\n%APPDATA%\\Claude\\claude_desktop_config.json (Windows)',
                  config: claudeDesktopConfig,
                  copyKey: 'claude',
                },
                {
                  name: 'Cursor',
                  configPath: '~/.cursor/mcp.json',
                  config: cursorConfig,
                  copyKey: 'cursor',
                },
                {
                  name: 'Qoder',
                  configPath: '在 Qoder 设置 → MCP 中添加',
                  config: qoderConfig,
                  copyKey: 'qoder',
                },
              ]}
              copiedKey={copiedKey}
              onCopy={copyToClipboard}
            />
          </Section>

          {/* Step 4: 使用说明 */}
          <Section
            step={4}
            title="可用的 MCP 工具"
            icon={<Terminal size={14} />}
          >
            <div className="grid grid-cols-2 gap-2">
              <ToolGroup
                title="MySQL"
                color="text-blue-400"
                tools={[
                  'mysql_query — 执行任意 SQL',
                  'mysql_list_databases — 列出数据库',
                  'mysql_list_tables — 列出表和视图',
                  'mysql_describe_table — 查看表结构',
                  'mysql_show_create_table — 获取 DDL',
                  'mysql_get_table_data — 分页查询数据',
                  'mysql_get_views — 列出视图',
                  'mysql_get_routines — 函数/存储过程',
                  'mysql_server_status — 服务器状态',
                ]}
              />
              <ToolGroup
                title="Redis"
                color="text-red-400"
                tools={[
                  'redis_info — 服务器信息',
                  'redis_dbsize — 键总数',
                  'redis_scan — 扫描键',
                  'redis_get — 获取键值',
                  'redis_set — 设置字符串键',
                  'redis_delete — 删除键',
                  'redis_expire — 设置 TTL',
                  'redis_type — 获取键类型',
                  'redis_ttl — 查询 TTL',
                  'redis_execute — 执行原始命令',
                ]}
              />
            </div>
            <div className="mt-3 text-[11px] text-text-muted">
              通用工具：<code className="text-accent">list_connections</code> 列出所有连接，{' '}
              <code className="text-accent">test_connection</code> 测试连接可用性
            </div>
          </Section>

          {/* 安全提示 */}
          <div className="flex items-start gap-2 px-3 py-2.5 bg-yellow-900/15 border border-yellow-700/30 rounded-lg">
            <AlertCircle size={13} className="text-yellow-400 mt-0.5 flex-shrink-0" />
            <div className="text-[11px] text-yellow-200/80 leading-relaxed">
              <span className="font-medium text-yellow-400">安全注意：</span>
              MCP 配置文件包含数据库明文密码。请仅将配置文件传输到受信任的电脑，不要上传到公共仓库。
              建议通过加密渠道（如 scp、加密压缩包）传输配置文件。
            </div>
          </div>
        </div>

        {/* 底部 */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-border-light flex-shrink-0">
          <div className="text-[10px] text-text-muted">
            配置文件: <code className="text-text-secondary">{configPath}</code>
          </div>
          <button
            onClick={close}
            className="px-4 py-1.5 text-xs bg-bg-hover hover:bg-border-light text-text-primary rounded transition-colors"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  )
}

// ==================== 子组件 ====================

function Section({
  step,
  title,
  icon,
  children,
}: {
  step: number
  title: string
  icon?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2.5">
        <span className="flex items-center justify-center w-5 h-5 bg-accent/15 text-accent text-[10px] font-bold rounded">
          {step}
        </span>
        {icon && <span className="text-text-secondary">{icon}</span>}
        <span className="text-xs font-semibold text-text-primary">{title}</span>
      </div>
      <div className="ml-7">{children}</div>
    </div>
  )
}

function CopyableField({
  label,
  value,
  onCopy,
  copied,
}: {
  label: string
  value: string
  onCopy: () => void
  copied: boolean
}) {
  return (
    <div>
      <label className="text-[10px] text-text-muted uppercase tracking-wide">{label}</label>
      <div className="flex items-center gap-2 mt-0.5">
        <code className="flex-1 px-2 py-1.5 bg-bg-primary border border-border-light rounded text-[11px] text-text-secondary truncate">
          {value}
        </code>
        <button
          onClick={onCopy}
          className="p-1.5 hover:bg-bg-hover rounded text-text-muted hover:text-accent transition-colors flex-shrink-0"
          title="复制"
        >
          {copied ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
        </button>
      </div>
    </div>
  )
}

function CopyableCodeBlock({
  code,
  onCopy,
  copied,
}: {
  code: string
  onCopy: () => void
  copied: boolean
}) {
  return (
    <div className="relative group">
      <pre className="bg-bg-primary border border-border-light rounded px-3 py-2.5 text-[11px] text-text-secondary overflow-x-auto leading-relaxed font-mono">
        {code}
      </pre>
      <button
        onClick={onCopy}
        className="absolute top-2 right-2 p-1.5 bg-bg-tertiary border border-border-light rounded text-text-muted hover:text-accent opacity-0 group-hover:opacity-100 transition-opacity"
        title="复制"
      >
        {copied ? <Check size={11} className="text-green-400" /> : <Copy size={11} />}
      </button>
      {copied && (
        <div className="absolute top-2 right-10 text-[10px] text-green-400 flex items-center gap-1">
          <Check size={10} />
          已复制
        </div>
      )}
    </div>
  )
}

function ConfigTabs({
  tabs,
  copiedKey,
  onCopy,
}: {
  tabs: Array<{ name: string; configPath: string; config: string; copyKey: string }>
  copiedKey: string | null
  onCopy: (text: string, key: string) => void
}) {
  const [activeTab, setActiveTab] = useState(0)
  const tab = tabs[activeTab]

  return (
    <div>
      {/* Tab 按钮 */}
      <div className="flex items-center gap-1 mb-2">
        {tabs.map((t, i) => (
          <button
            key={t.name}
            onClick={() => setActiveTab(i)}
            className={`px-3 py-1.5 text-xs rounded-t transition-colors ${
              activeTab === i
                ? 'bg-bg-primary border-t border-l border-r border-border-light text-accent -mb-px'
                : 'text-text-muted hover:text-text-primary hover:bg-bg-hover'
            }`}
          >
            {t.name}
          </button>
        ))}
      </div>

      {/* 配置路径 */}
      <div className="mb-2 text-[10px] text-text-muted">
        配置文件位置: <code className="text-text-secondary whitespace-pre-line">{tab.configPath}</code>
      </div>

      {/* JSON 配置 */}
      <CopyableCodeBlock
        code={tab.config}
        onCopy={() => onCopy(tab.config, tab.copyKey)}
        copied={copiedKey === tab.copyKey}
      />

      <div className="mt-2 flex items-center gap-1 text-[10px] text-text-muted">
        <ChevronRight size={10} />
        将 <code className="text-accent">{`args[0]`}</code> 中的路径替换为目标电脑上 MCP 服务器的实际路径
      </div>
    </div>
  )
}

function ToolGroup({
  title,
  color,
  tools,
}: {
  title: string
  color: string
  tools: string[]
}) {
  return (
    <div className="bg-bg-tertiary/30 rounded-lg border border-border-light overflow-hidden">
      <div className={`px-3 py-1.5 text-xs font-medium ${color} bg-bg-tertiary/50 border-b border-border-light`}>
        {title}
      </div>
      <div className="px-3 py-2 space-y-1">
        {tools.map((t) => (
          <div key={t} className="text-[10px] text-text-muted leading-relaxed">
            <span className="text-text-secondary">{t}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
