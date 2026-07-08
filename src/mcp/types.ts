/**
 * MCP 连接配置类型
 * 与 nexSql 应用共享的连接配置结构（明文存储）
 */
export interface McpConnectionConfig {
  id: string
  name: string
  type: 'mysql' | 'redis'
  host: string
  port: number
  user?: string
  password?: string
  database?: string
  /** SSL 加密连接 */
  sslEnabled?: boolean
  /** 连接超时（毫秒） */
  connectTimeout?: number
  // Redis 专用
  redisDb?: number
  // SSH 隧道
  sshEnabled?: boolean
  sshHost?: string
  sshPort?: number
  sshUser?: string
  sshPassword?: string
  sshPrivateKey?: string
}

export interface McpConfig {
  connections: McpConnectionConfig[]
}

/** MCP 工具响应内容 */
export interface McpToolResult {
  content: { type: 'text'; text: string }[]
  isError?: boolean
}
