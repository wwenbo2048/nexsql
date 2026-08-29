/**
 * nexSql DSH 原生插件
 *
 * 把 nexSql 的 MySQL / Redis 数据库能力注册为 DeepSeek Harness 原生工具。
 * 工具实现复用 nexSql/src/mcp/ 下的同一份源码（连接管理器 + 工具函数），
 * 由 esbuild 打包进本包；连接配置仍读取 ~/.nexsql/mcp-connections.json
 * （由 nexSql 应用「导出到 MCP」生成，或按同一结构手工创建）。
 *
 * 与 MCP 桥接（mcp__nexsql__*）的区别：工具在 DSH 宿主进程内注册，
 * 无子进程和 stdio 协议开销；工具名为原生短名（mysql_query 等）。
 *
 * 形态遵循 DSH 函数插件约定：具名导出 name / inject / apply，无默认导出。
 * 下方局部类型是 DSH ToolDefinition 的最小结构面，权威定义见
 * deepseek-harness packages/core/tools/src/index.ts（raw JSON Schema 注册，
 * 参数校验由工具自负——与原 MCP 实现一致）。
 */
import { getConfigPath, getConnection, listConnectionsSafe, loadConfig } from '../../src/mcp/config.js'
import { closeAll, testConnection } from '../../src/mcp/connection-manager.js'
import * as mysqlTools from '../../src/mcp/mysql-tools.js'
import * as redisTools from '../../src/mcp/redis-tools.js'
import type { McpConnectionConfig, McpToolResult } from '../../src/mcp/types.js'
import type { IncomingHttpHeaders } from 'node:http'
import { isTrustedApiRequest, mountNexsqlRoutes, type WebServerService } from './routes.js'

// ==================== DSH 插件接口的最小结构面 ====================

/** 工具执行上下文：不可变执行身份与取消信号。 */
interface ToolRunContext {
  readonly signal: AbortSignal
}

/** 模型可见文本内容块。 */
interface TextBlock {
  type: 'text'
  text: string
}

/** DSH ToolDefinition 的最小结构面（raw JSON Schema 参数形态）。 */
interface ToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>
  output: {
    schema: Record<string, unknown>
    render: (args: unknown, value: unknown) => TextBlock[]
  }
  execute: (args: unknown, exec: ToolRunContext) => Promise<unknown>
}

/** 插件 ctx 的最小结构面：工具注册表、副作用清理与运行时依赖注入。 */
interface PluginContext {
  readonly tools: { register(definition: ToolDefinition): unknown }
  effect(disposer: () => () => void): void
  inject(deps: readonly string[], callback: (ctx: unknown) => void): void
}

// ==================== 参数读取与结果适配 ====================

/** 读取必填非空字符串参数；缺失或类型不符时抛出（raw 注册自负校验）。 */
function str(args: Record<string, unknown>, key: string, toolName: string): string {
  const v = args[key]
  if (typeof v !== 'string' || v === '') {
    throw new Error(`工具 ${toolName} 的参数 "${key}" 缺失或不是非空字符串`)
  }
  return v
}

/** 读取可选字符串参数。 */
function optStr(args: Record<string, unknown>, key: string): string | undefined {
  const v = args[key]
  return typeof v === 'string' && v !== '' ? v : undefined
}

/** 读取必填数字参数。 */
function num(args: Record<string, unknown>, key: string, toolName: string): number {
  const v = args[key]
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new Error(`工具 ${toolName} 的参数 "${key}" 缺失或不是数字`)
  }
  return v
}

/** 读取可选数字参数。 */
function optNum(args: Record<string, unknown>, key: string): number | undefined {
  const v = args[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

/** 读取必填字符串数组参数。 */
function strArray(args: Record<string, unknown>, key: string, toolName: string): string[] {
  const v = args[key]
  if (!Array.isArray(v) || v.some((item) => typeof item !== 'string')) {
    throw new Error(`工具 ${toolName} 的参数 "${key}" 缺失或不是字符串数组`)
  }
  return v as string[]
}

/** 按连接 ID 解析配置；不存在时抛出可操作的错误。 */
function requireConnection(connectionId: string, toolName: string): McpConnectionConfig {
  const conn = getConnection(loadConfig(), connectionId)
  if (!conn) {
    throw new Error(
      `连接 "${connectionId}" 不存在。请先调用 nexsql_list_connections 查看可用连接。`
    )
  }
  return conn
}

/** 把 MCP 形态的工具结果适配为 DSH 规范值：isError 抛异常，正文文本作为规范字符串。 */
function toCanonical(result: McpToolResult): string {
  const text = result.content.map((c) => c.text).join('\n')
  if (result.isError) {
    throw new Error(text)
  }
  return text
}

// ==================== 工具规格表 ====================

/** 一个工具的声明与实现：kind 决定连接类型约束。 */
interface ToolSpec {
  name: string
  description: string
  parameters: Record<string, unknown>
  kind: 'plain' | 'mysql' | 'redis'
  run(args: Record<string, unknown>, conn: McpConnectionConfig): Promise<McpToolResult>
}

const connectionIdProp = { type: 'string', description: '连接 ID' }
const databaseProp = { type: 'string', description: '数据库名' }
const tableProp = { type: 'string', description: '表名' }

const toolSpecs: ToolSpec[] = [
  // ===== 通用 =====
  {
    name: 'nexsql_list_connections',
    description:
      '列出所有已配置的数据库连接（MySQL 和 Redis）。返回连接 ID、名称、类型和主机信息。在执行其他数据库操作前，先调用此工具获取 connectionId。',
    parameters: { type: 'object', properties: {} },
    kind: 'plain',
    async run() {
      const connections = listConnectionsSafe(loadConfig())
      if (connections.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: `未找到任何连接配置。\n配置文件路径: ${getConfigPath()}\n\n请在 nexSql 应用中使用「导出到 MCP」功能导出连接配置，或手动创建配置文件。`,
            },
          ],
        }
      }
      const lines = connections.map(
        (c) =>
          `  [${c.type.toUpperCase()}] ${c.id} → ${c.name} (${c.host}:${c.port}${c.database ? `/${c.database}` : ''}${c.redisDb !== undefined ? ` db${c.redisDb}` : ''})`
      )
      return {
        content: [
          {
            type: 'text',
            text: `已配置连接 (${connections.length} 个):\n${lines.join('\n')}\n\n配置文件: ${getConfigPath()}`,
          },
        ],
      }
    },
  },
  {
    name: 'nexsql_test_connection',
    description: '测试指定连接是否可用。返回连接是否成功。',
    parameters: {
      type: 'object',
      properties: { connectionId: connectionIdProp },
      required: ['connectionId'],
    },
    kind: 'plain',
    async run(args) {
      const connectionId = str(args, 'connectionId', this.name)
      const conn = requireConnection(connectionId, this.name)
      try {
        const ok = await testConnection(conn)
        return {
          content: [
            {
              type: 'text',
              text: ok ? `连接 "${conn.name}" 测试成功 ✓` : `连接 "${conn.name}" 测试失败`,
            },
          ],
          isError: !ok,
        }
      } catch (err) {
        throw new Error(`连接测试失败: ${err instanceof Error ? err.message : String(err)}`)
      }
    },
  },

  // ===== MySQL =====
  {
    name: 'mysql_query',
    description:
      '在指定的 MySQL 连接上执行 SQL 语句。支持 SELECT、INSERT、UPDATE、DELETE、DDL 等所有 SQL 操作。可指定数据库上下文。结果以表格格式返回。',
    parameters: {
      type: 'object',
      properties: {
        connectionId: connectionIdProp,
        sql: { type: 'string', description: '要执行的 SQL 语句' },
        database: { type: 'string', description: '指定数据库（可选，不指定则使用连接默认数据库）' },
      },
      required: ['connectionId', 'sql'],
    },
    kind: 'mysql',
    async run(args, conn) {
      return mysqlTools.mysqlQuery(conn, str(args, 'sql', this.name), optStr(args, 'database'))
    },
  },
  {
    name: 'mysql_list_databases',
    description: '列出 MySQL 服务器上的所有用户数据库（排除系统数据库）。',
    parameters: {
      type: 'object',
      properties: { connectionId: connectionIdProp },
      required: ['connectionId'],
    },
    kind: 'mysql',
    async run(_args, conn) {
      return mysqlTools.mysqlListDatabases(conn)
    },
  },
  {
    name: 'mysql_list_tables',
    description: '列出指定数据库中的所有表和视图，包括引擎、行数和注释。',
    parameters: {
      type: 'object',
      properties: { connectionId: connectionIdProp, database: databaseProp },
      required: ['connectionId', 'database'],
    },
    kind: 'mysql',
    async run(args, conn) {
      return mysqlTools.mysqlListTables(conn, str(args, 'database', this.name))
    },
  },
  {
    name: 'mysql_describe_table',
    description: '获取表的详细结构信息，包括列定义、主键、索引等。',
    parameters: {
      type: 'object',
      properties: { connectionId: connectionIdProp, database: databaseProp, table: tableProp },
      required: ['connectionId', 'database', 'table'],
    },
    kind: 'mysql',
    async run(args, conn) {
      return mysqlTools.mysqlDescribeTable(
        conn,
        str(args, 'database', this.name),
        str(args, 'table', this.name)
      )
    },
  },
  {
    name: 'mysql_show_create_table',
    description: '获取表的 CREATE TABLE DDL 语句。',
    parameters: {
      type: 'object',
      properties: { connectionId: connectionIdProp, database: databaseProp, table: tableProp },
      required: ['connectionId', 'database', 'table'],
    },
    kind: 'mysql',
    async run(args, conn) {
      return mysqlTools.mysqlShowCreateTable(
        conn,
        str(args, 'database', this.name),
        str(args, 'table', this.name)
      )
    },
  },
  {
    name: 'mysql_get_table_data',
    description: '获取表数据，支持分页和条件过滤。',
    parameters: {
      type: 'object',
      properties: {
        connectionId: connectionIdProp,
        database: databaseProp,
        table: tableProp,
        limit: { type: 'number', description: '返回行数限制（默认 100）' },
        offset: { type: 'number', description: '偏移量（默认 0）' },
        where: {
          type: 'string',
          description: 'WHERE 条件（不含 WHERE 关键字），如 "age > 18 AND status = \'active\'"',
        },
      },
      required: ['connectionId', 'database', 'table'],
    },
    kind: 'mysql',
    async run(args, conn) {
      return mysqlTools.mysqlGetTableData(
        conn,
        str(args, 'database', this.name),
        str(args, 'table', this.name),
        optNum(args, 'limit'),
        optNum(args, 'offset'),
        optStr(args, 'where')
      )
    },
  },
  {
    name: 'mysql_get_views',
    description: '列出指定数据库中的所有视图。',
    parameters: {
      type: 'object',
      properties: { connectionId: connectionIdProp, database: databaseProp },
      required: ['connectionId', 'database'],
    },
    kind: 'mysql',
    async run(args, conn) {
      return mysqlTools.mysqlGetViews(conn, str(args, 'database', this.name))
    },
  },
  {
    name: 'mysql_get_routines',
    description: '列出指定数据库中的所有函数和存储过程。',
    parameters: {
      type: 'object',
      properties: { connectionId: connectionIdProp, database: databaseProp },
      required: ['connectionId', 'database'],
    },
    kind: 'mysql',
    async run(args, conn) {
      return mysqlTools.mysqlGetRoutines(conn, str(args, 'database', this.name))
    },
  },
  {
    name: 'mysql_server_status',
    description: '获取 MySQL 服务器状态信息，包括版本、连接数、内存使用等。',
    parameters: {
      type: 'object',
      properties: { connectionId: connectionIdProp },
      required: ['connectionId'],
    },
    kind: 'mysql',
    async run(_args, conn) {
      return mysqlTools.mysqlServerStatus(conn)
    },
  },

  // ===== Redis =====
  {
    name: 'redis_info',
    description: '获取 Redis 服务器信息，包括版本、内存使用、连接数等。',
    parameters: {
      type: 'object',
      properties: { connectionId: connectionIdProp },
      required: ['connectionId'],
    },
    kind: 'redis',
    async run(_args, conn) {
      return redisTools.redisInfo(conn)
    },
  },
  {
    name: 'redis_dbsize',
    description: '获取当前 Redis 数据库的键总数。',
    parameters: {
      type: 'object',
      properties: { connectionId: connectionIdProp },
      required: ['connectionId'],
    },
    kind: 'redis',
    async run(_args, conn) {
      return redisTools.redisDbsize(conn)
    },
  },
  {
    name: 'redis_scan',
    description: '使用 SCAN 命令扫描匹配模式的键，返回键名、类型和 TTL。',
    parameters: {
      type: 'object',
      properties: {
        connectionId: connectionIdProp,
        pattern: { type: 'string', description: '键匹配模式（如 "user:*"），默认 "*"' },
        count: { type: 'number', description: '最大返回数量（默认 100）' },
        type: {
          type: 'string',
          description: '按键类型过滤（string/hash/list/set/zset/stream）',
        },
      },
      required: ['connectionId'],
    },
    kind: 'redis',
    async run(args, conn) {
      return redisTools.redisScan(
        conn,
        optStr(args, 'pattern'),
        optNum(args, 'count'),
        optStr(args, 'type')
      )
    },
  },
  {
    name: 'redis_get',
    description: '获取键的值和详细信息。自动识别键类型并返回格式化的值。',
    parameters: {
      type: 'object',
      properties: { connectionId: connectionIdProp, key: { type: 'string', description: '键名' } },
      required: ['connectionId', 'key'],
    },
    kind: 'redis',
    async run(args, conn) {
      return redisTools.redisGet(conn, str(args, 'key', this.name))
    },
  },
  {
    name: 'redis_set',
    description: '设置字符串键的值，可设置 TTL。',
    parameters: {
      type: 'object',
      properties: {
        connectionId: connectionIdProp,
        key: { type: 'string', description: '键名' },
        value: { type: 'string', description: '值' },
        ttl: { type: 'number', description: '过期时间（秒），不设置则永久' },
      },
      required: ['connectionId', 'key', 'value'],
    },
    kind: 'redis',
    async run(args, conn) {
      return redisTools.redisSet(
        conn,
        str(args, 'key', this.name),
        str(args, 'value', this.name),
        optNum(args, 'ttl')
      )
    },
  },
  {
    name: 'redis_delete',
    description: '删除一个或多个键。',
    parameters: {
      type: 'object',
      properties: {
        connectionId: connectionIdProp,
        keys: {
          type: 'array',
          items: { type: 'string' },
          description: '要删除的键名列表',
        },
      },
      required: ['connectionId', 'keys'],
    },
    kind: 'redis',
    async run(args, conn) {
      return redisTools.redisDelete(conn, strArray(args, 'keys', this.name))
    },
  },
  {
    name: 'redis_expire',
    description: '设置键的过期时间（TTL），或移除 TTL 使其永久。',
    parameters: {
      type: 'object',
      properties: {
        connectionId: connectionIdProp,
        key: { type: 'string', description: '键名' },
        ttl: { type: 'number', description: '过期时间（秒），设为 0 或负数则移除 TTL' },
      },
      required: ['connectionId', 'key', 'ttl'],
    },
    kind: 'redis',
    async run(args, conn) {
      return redisTools.redisExpire(conn, str(args, 'key', this.name), num(args, 'ttl', this.name))
    },
  },
  {
    name: 'redis_type',
    description: '获取键的数据类型。',
    parameters: {
      type: 'object',
      properties: { connectionId: connectionIdProp, key: { type: 'string', description: '键名' } },
      required: ['connectionId', 'key'],
    },
    kind: 'redis',
    async run(args, conn) {
      return redisTools.redisType(conn, str(args, 'key', this.name))
    },
  },
  {
    name: 'redis_ttl',
    description: '获取键的剩余生存时间（TTL）。',
    parameters: {
      type: 'object',
      properties: { connectionId: connectionIdProp, key: { type: 'string', description: '键名' } },
      required: ['connectionId', 'key'],
    },
    kind: 'redis',
    async run(args, conn) {
      return redisTools.redisTtl(conn, str(args, 'key', this.name))
    },
  },
  {
    name: 'redis_execute',
    description:
      '执行原始 Redis 命令。用于执行未封装的高级命令。命令和参数作为字符串数组传入，如 ["HSET", "myhash", "field1", "value1"]。',
    parameters: {
      type: 'object',
      properties: {
        connectionId: connectionIdProp,
        command: {
          type: 'array',
          items: { type: 'string' },
          description: 'Redis 命令及参数数组，如 ["GET", "mykey"]',
        },
      },
      required: ['connectionId', 'command'],
    },
    kind: 'redis',
    async run(args, conn) {
      return redisTools.redisExecute(conn, strArray(args, 'command', this.name))
    },
  },
]

// ==================== 插件入口 ====================

export const name = 'nexsql'

export const inject = ['tools']

export function apply(ctx: PluginContext) {
  for (const spec of toolSpecs) {
    ctx.tools.register({
      name: spec.name,
      description: spec.description,
      parameters: spec.parameters,
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: String(value) }],
      },
      async execute(args) {
        const a = (args ?? {}) as Record<string, unknown>
        let conn: McpConnectionConfig | undefined
        if (spec.kind !== 'plain') {
          conn = requireConnection(str(a, 'connectionId', spec.name), spec.name)
          if (conn.type !== spec.kind) {
            throw new Error(`连接 "${conn.name}" 是 ${conn.type.toUpperCase()} 连接，不支持工具 "${spec.name}"`)
          }
        }
        return toCanonical(await spec.run(a, conn as McpConnectionConfig))
      },
    })
  }

  // 插件卸载时关闭所有 MySQL 连接池、Redis 客户端和 SSH 隧道
  ctx.effect(() => () => {
    void closeAll()
  })

  // 面板 HTTP 路由（/nexsql/*）：仅当组合提供 webServer 服务时挂载；
  // headless 组合没有该服务，这一层保持沉默，工具照常可用。
  try {
    ctx.inject(['webServer'], (injected: unknown) => {
      const services = injected as {
        webServer: WebServerService
        effect(fn: () => () => void): void
      }
      // 鉴权门：web 组合里有 connection 服务（Host 围栏 + dsh-auth cookie 会话），
      // 到位后立即生效；无该服务的组合保持 undefined，退化为路由层自身的同源校验。
      const gate: { reject?: (request: { url?: string; headers: IncomingHttpHeaders; method?: string }) => number | undefined } = {}
      services.effect(() => {
        const unregister = mountNexsqlRoutes(services.webServer, gate)
        // 围栏的 LAN 字面量与 dsh 自身 /api 围栏同源：webRuntime 服务在绑定时推导。
        let trustedHosts: readonly string[] = []
        try {
          ctx.inject(['webRuntime'], (rt: unknown) => {
            trustedHosts = (rt as { webRuntime?: { trustedHosts?: readonly string[] } }).webRuntime?.trustedHosts ?? []
          })
        } catch {
          // 无 webRuntime：保持空表（仅 loopback 过围栏）
        }
        try {
          ctx.inject(['connection'], (c: unknown) => {
            const connection = (c as { connection: { requestRejection?(request: unknown): number | undefined } }).connection
            const rejectFn = connection.requestRejection
            if (typeof rejectFn === 'function') {
              gate.reject = (request) => rejectFn.call(connection, request)
            } else {
              // 旧运行时无 requestRejection：退化为等强度 Host/Origin 围栏
              // （rc 时代的 /api 也无会话层，保护强度与宿主一致）
              gate.reject = (request) => (isTrustedApiRequest(request, trustedHosts) ? undefined : 403)
            }
          })
        } catch {
          // 无 connection 服务（非 web 组合）：保持同源校验
        }
        return unregister
      })
    })
  } catch (error) {
    console.error('[nexsql] 面板路由层注册失败:', error)
  }

  console.log(
    `[nexsql] ${toolSpecs.length} 个数据库工具已注册 (MySQL 9, Redis 10, 通用 2)；配置: ${getConfigPath()}`
  )
}
