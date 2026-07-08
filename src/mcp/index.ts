#!/usr/bin/env node
/**
 * nexSql MCP Server
 *
 * 通过 MCP 协议提供 MySQL 和 Redis 数据库访问能力。
 * 支持 AI 助手（如 Claude、Qoder）通过 MCP 连接和管理 nexSql 配置的数据库。
 *
 * 使用方式：
 * 1. 确保 ~/.nexsql/mcp-connections.json 存在（由 nexSql 应用导出）
 * 2. 在 MCP 客户端配置中添加：
 *    {
 *      "mcpServers": {
 *        "nexsql": {
 *          "command": "node",
 *          "args": ["path/to/nexsql/out/mcp/index.js"]
 *        }
 *      }
 *    }
 * 3. 或通过 npx tsx 开发运行：
 *    npx tsx src/mcp/index.ts
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { loadConfig, getConnection, listConnectionsSafe, getConfigPath } from './config.js'
import { testConnection, closeAll } from './connection-manager.js'
import * as mysqlTools from './mysql-tools.js'
import * as redisTools from './redis-tools.js'
import type { McpConnectionConfig, McpToolResult } from './types.js'

// ==================== 工具定义 ====================

const tools = [
  // ===== 通用 =====
  {
    name: 'list_connections',
    description:
      '列出所有已配置的数据库连接（MySQL 和 Redis）。返回连接 ID、名称、类型和主机信息。在执行其他数据库操作前，先调用此工具获取 connectionId。',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'test_connection',
    description: '测试指定连接是否可用。返回连接是否成功。',
    inputSchema: {
      type: 'object',
      properties: {
        connectionId: { type: 'string', description: '连接 ID' },
      },
      required: ['connectionId'],
    },
  },

  // ===== MySQL 工具 =====
  {
    name: 'mysql_query',
    description:
      '在指定的 MySQL 连接上执行 SQL 语句。支持 SELECT、INSERT、UPDATE、DELETE、DDL 等所有 SQL 操作。可指定数据库上下文。结果以表格格式返回。',
    inputSchema: {
      type: 'object',
      properties: {
        connectionId: { type: 'string', description: '连接 ID' },
        sql: { type: 'string', description: '要执行的 SQL 语句' },
        database: { type: 'string', description: '指定数据库（可选，不指定则使用连接默认数据库）' },
      },
      required: ['connectionId', 'sql'],
    },
  },
  {
    name: 'mysql_list_databases',
    description: '列出 MySQL 服务器上的所有用户数据库（排除系统数据库）。',
    inputSchema: {
      type: 'object',
      properties: {
        connectionId: { type: 'string', description: '连接 ID' },
      },
      required: ['connectionId'],
    },
  },
  {
    name: 'mysql_list_tables',
    description: '列出指定数据库中的所有表和视图，包括引擎、行数和注释。',
    inputSchema: {
      type: 'object',
      properties: {
        connectionId: { type: 'string', description: '连接 ID' },
        database: { type: 'string', description: '数据库名' },
      },
      required: ['connectionId', 'database'],
    },
  },
  {
    name: 'mysql_describe_table',
    description: '获取表的详细结构信息，包括列定义、主键、索引等。',
    inputSchema: {
      type: 'object',
      properties: {
        connectionId: { type: 'string', description: '连接 ID' },
        database: { type: 'string', description: '数据库名' },
        table: { type: 'string', description: '表名' },
      },
      required: ['connectionId', 'database', 'table'],
    },
  },
  {
    name: 'mysql_show_create_table',
    description: '获取表的 CREATE TABLE DDL 语句。',
    inputSchema: {
      type: 'object',
      properties: {
        connectionId: { type: 'string', description: '连接 ID' },
        database: { type: 'string', description: '数据库名' },
        table: { type: 'string', description: '表名' },
      },
      required: ['connectionId', 'database', 'table'],
    },
  },
  {
    name: 'mysql_get_table_data',
    description: '获取表数据，支持分页和条件过滤。',
    inputSchema: {
      type: 'object',
      properties: {
        connectionId: { type: 'string', description: '连接 ID' },
        database: { type: 'string', description: '数据库名' },
        table: { type: 'string', description: '表名' },
        limit: { type: 'number', description: '返回行数限制（默认 100）', default: 100 },
        offset: { type: 'number', description: '偏移量（默认 0）', default: 0 },
        where: {
          type: 'string',
          description: 'WHERE 条件（不含 WHERE 关键字），如 "age > 18 AND status = \'active\'"',
        },
      },
      required: ['connectionId', 'database', 'table'],
    },
  },
  {
    name: 'mysql_get_views',
    description: '列出指定数据库中的所有视图。',
    inputSchema: {
      type: 'object',
      properties: {
        connectionId: { type: 'string', description: '连接 ID' },
        database: { type: 'string', description: '数据库名' },
      },
      required: ['connectionId', 'database'],
    },
  },
  {
    name: 'mysql_get_routines',
    description: '列出指定数据库中的所有函数和存储过程。',
    inputSchema: {
      type: 'object',
      properties: {
        connectionId: { type: 'string', description: '连接 ID' },
        database: { type: 'string', description: '数据库名' },
      },
      required: ['connectionId', 'database'],
    },
  },
  {
    name: 'mysql_server_status',
    description: '获取 MySQL 服务器状态信息，包括版本、连接数、内存使用等。',
    inputSchema: {
      type: 'object',
      properties: {
        connectionId: { type: 'string', description: '连接 ID' },
      },
      required: ['connectionId'],
    },
  },

  // ===== Redis 工具 =====
  {
    name: 'redis_info',
    description: '获取 Redis 服务器信息，包括版本、内存使用、连接数等。',
    inputSchema: {
      type: 'object',
      properties: {
        connectionId: { type: 'string', description: '连接 ID' },
      },
      required: ['connectionId'],
    },
  },
  {
    name: 'redis_dbsize',
    description: '获取当前 Redis 数据库的键总数。',
    inputSchema: {
      type: 'object',
      properties: {
        connectionId: { type: 'string', description: '连接 ID' },
      },
      required: ['connectionId'],
    },
  },
  {
    name: 'redis_scan',
    description: '使用 SCAN 命令扫描匹配模式的键，返回键名、类型和 TTL。',
    inputSchema: {
      type: 'object',
      properties: {
        connectionId: { type: 'string', description: '连接 ID' },
        pattern: { type: 'string', description: '键匹配模式（如 "user:*"），默认 "*"', default: '*' },
        count: { type: 'number', description: '最大返回数量（默认 100）', default: 100 },
        type: {
          type: 'string',
          description: '按键类型过滤（string/hash/list/set/zset/stream）',
        },
      },
      required: ['connectionId'],
    },
  },
  {
    name: 'redis_get',
    description: '获取键的值和详细信息。自动识别键类型并返回格式化的值。',
    inputSchema: {
      type: 'object',
      properties: {
        connectionId: { type: 'string', description: '连接 ID' },
        key: { type: 'string', description: '键名' },
      },
      required: ['connectionId', 'key'],
    },
  },
  {
    name: 'redis_set',
    description: '设置字符串键的值，可设置 TTL。',
    inputSchema: {
      type: 'object',
      properties: {
        connectionId: { type: 'string', description: '连接 ID' },
        key: { type: 'string', description: '键名' },
        value: { type: 'string', description: '值' },
        ttl: { type: 'number', description: '过期时间（秒），不设置则永久' },
      },
      required: ['connectionId', 'key', 'value'],
    },
  },
  {
    name: 'redis_delete',
    description: '删除一个或多个键。',
    inputSchema: {
      type: 'object',
      properties: {
        connectionId: { type: 'string', description: '连接 ID' },
        keys: {
          type: 'array',
          items: { type: 'string' },
          description: '要删除的键名列表',
        },
      },
      required: ['connectionId', 'keys'],
    },
  },
  {
    name: 'redis_expire',
    description: '设置键的过期时间（TTL），或移除 TTL 使其永久。',
    inputSchema: {
      type: 'object',
      properties: {
        connectionId: { type: 'string', description: '连接 ID' },
        key: { type: 'string', description: '键名' },
        ttl: { type: 'number', description: '过期时间（秒），设为 0 或负数则移除 TTL' },
      },
      required: ['connectionId', 'key', 'ttl'],
    },
  },
  {
    name: 'redis_type',
    description: '获取键的数据类型。',
    inputSchema: {
      type: 'object',
      properties: {
        connectionId: { type: 'string', description: '连接 ID' },
        key: { type: 'string', description: '键名' },
      },
      required: ['connectionId', 'key'],
    },
  },
  {
    name: 'redis_ttl',
    description: '获取键的剩余生存时间（TTL）。',
    inputSchema: {
      type: 'object',
      properties: {
        connectionId: { type: 'string', description: '连接 ID' },
        key: { type: 'string', description: '键名' },
      },
      required: ['connectionId', 'key'],
    },
  },
  {
    name: 'redis_execute',
    description:
      '执行原始 Redis 命令。用于执行未封装的高级命令。命令和参数作为字符串数组传入，如 ["HSET", "myhash", "field1", "value1"]。',
    inputSchema: {
      type: 'object',
      properties: {
        connectionId: { type: 'string', description: '连接 ID' },
        command: {
          type: 'array',
          items: { type: 'string' },
          description: 'Redis 命令及参数数组，如 ["GET", "mykey"]',
        },
      },
      required: ['connectionId', 'command'],
    },
  },
]

// ==================== 工具处理路由 ====================

function resolveConnection(connectionId: string): McpConnectionConfig | null {
  const config = loadConfig()
  const conn = getConnection(config, connectionId)
  if (!conn) {
    return null
  }
  return conn
}

function errorResult(msg: string): McpToolResult {
  return { content: [{ type: 'text', text: msg }], isError: true }
}

async function handleToolCall(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
  // ===== 通用工具 =====
  if (name === 'list_connections') {
    const config = loadConfig()
    const connections = listConnectionsSafe(config)
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
  }

  if (name === 'test_connection') {
    const conn = resolveConnection(args.connectionId as string)
    if (!conn) return errorResult(`连接 "${args.connectionId}" 不存在`)
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
      return errorResult(
        `连接测试失败: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  }

  // 以下工具都需要 connectionId
  const connectionId = args.connectionId as string
  const conn = resolveConnection(connectionId)
  if (!conn) {
    return errorResult(`连接 "${connectionId}" 不存在。请先调用 list_connections 查看可用连接。`)
  }

  // ===== MySQL 工具 =====
  if (conn.type === 'mysql') {
    switch (name) {
      case 'mysql_query':
        return mysqlTools.mysqlQuery(conn, args.sql as string, args.database as string | undefined)
      case 'mysql_list_databases':
        return mysqlTools.mysqlListDatabases(conn)
      case 'mysql_list_tables':
        return mysqlTools.mysqlListTables(conn, args.database as string)
      case 'mysql_describe_table':
        return mysqlTools.mysqlDescribeTable(conn, args.database as string, args.table as string)
      case 'mysql_show_create_table':
        return mysqlTools.mysqlShowCreateTable(conn, args.database as string, args.table as string)
      case 'mysql_get_table_data':
        return mysqlTools.mysqlGetTableData(
          conn,
          args.database as string,
          args.table as string,
          args.limit as number | undefined,
          args.offset as number | undefined,
          args.where as string | undefined
        )
      case 'mysql_get_views':
        return mysqlTools.mysqlGetViews(conn, args.database as string)
      case 'mysql_get_routines':
        return mysqlTools.mysqlGetRoutines(conn, args.database as string)
      case 'mysql_server_status':
        return mysqlTools.mysqlServerStatus(conn)
      default:
        return errorResult(`MySQL 连接不支持工具 "${name}"`)
    }
  }

  // ===== Redis 工具 =====
  if (conn.type === 'redis') {
    switch (name) {
      case 'redis_info':
        return redisTools.redisInfo(conn)
      case 'redis_dbsize':
        return redisTools.redisDbsize(conn)
      case 'redis_scan':
        return redisTools.redisScan(
          conn,
          args.pattern as string | undefined,
          args.count as number | undefined,
          args.type as string | undefined
        )
      case 'redis_get':
        return redisTools.redisGet(conn, args.key as string)
      case 'redis_set':
        return redisTools.redisSet(conn, args.key as string, args.value as string, args.ttl as number | undefined)
      case 'redis_delete':
        return redisTools.redisDelete(conn, args.keys as string[])
      case 'redis_expire':
        return redisTools.redisExpire(conn, args.key as string, args.ttl as number)
      case 'redis_type':
        return redisTools.redisType(conn, args.key as string)
      case 'redis_ttl':
        return redisTools.redisTtl(conn, args.key as string)
      case 'redis_execute':
        return redisTools.redisExecute(conn, args.command as string[])
      default:
        return errorResult(`Redis 连接不支持工具 "${name}"`)
    }
  }

  return errorResult(`未知工具: ${name}`)
}

// ==================== MCP 服务器启动 ====================

async function main() {
  const server = new Server(
    { name: 'nexsql-mcp', version: '0.1.0' },
    {
      capabilities: {
        tools: {},
      },
    }
  )

  // 注册 ListTools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: tools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema as {
          type: 'object'
          properties?: Record<string, unknown>
          required?: string[]
        },
      })),
    }
  })

  // 注册 CallTool
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params
    try {
      const result = await handleToolCall(name, (args ?? {}) as Record<string, unknown>)
      return { content: result.content, isError: result.isError }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return {
        content: [{ type: 'text' as const, text: `工具执行异常: ${msg}` }],
        isError: true,
      }
    }
  })

  // 使用 stdio 传输
  const transport = new StdioServerTransport()
  await server.connect(transport)

  // 输出到 stderr（不干扰 stdio 通信）
  const config = loadConfig()
  console.error(`[nexSql MCP] 服务器已启动，加载了 ${config.connections.length} 个连接配置`)
  console.error(`[nexSql MCP] 配置文件: ${getConfigPath()}`)

  // 优雅退出
  process.on('SIGINT', async () => {
    await closeAll()
    await server.close()
    process.exit(0)
  })

  process.on('SIGTERM', async () => {
    await closeAll()
    await server.close()
    process.exit(0)
  })
}

main().catch((err) => {
  console.error('[nexSql MCP] 启动失败:', err)
  process.exit(1)
})
