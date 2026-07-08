/**
 * MCP 连接配置加载器
 *
 * 配置文件查找顺序：
 * 1. 环境变量 NEXSQL_MCP_CONFIG 指定的路径
 * 2. ~/.nexsql/mcp-connections.json （nexSql 应用导出）
 * 3. 项目根目录 mcp-connections.json
 */
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import type { McpConfig, McpConnectionConfig } from './types.js'

const CONFIG_DIR = join(homedir(), '.nexsql')
const DEFAULT_CONFIG_PATH = join(CONFIG_DIR, 'mcp-connections.json')

/**
 * 获取配置文件路径
 */
export function getConfigPath(): string {
  // 1. 环境变量
  const envPath = process.env.NEXSQL_MCP_CONFIG
  if (envPath) return envPath

  // 2. 默认路径
  if (existsSync(DEFAULT_CONFIG_PATH)) return DEFAULT_CONFIG_PATH

  // 3. 项目根目录
  const localPath = join(process.cwd(), 'mcp-connections.json')
  return localPath
}

/**
 * 加载连接配置
 */
export function loadConfig(): McpConfig {
  const configPath = getConfigPath()

  if (!existsSync(configPath)) {
    return { connections: [] }
  }

  try {
    const raw = readFileSync(configPath, 'utf-8')
    const parsed = JSON.parse(raw) as McpConfig
    if (!parsed.connections || !Array.isArray(parsed.connections)) {
      return { connections: [] }
    }
    return parsed
  } catch (err) {
    console.error(`[MCP] 配置文件加载失败 (${configPath}):`, err)
    return { connections: [] }
  }
}

/**
 * 根据 ID 获取连接配置
 */
export function getConnection(config: McpConfig, connectionId: string): McpConnectionConfig | undefined {
  return config.connections.find((c) => c.id === connectionId)
}

/**
 * 列出所有连接（隐藏密码）
 */
export function listConnectionsSafe(config: McpConfig): Array<Omit<McpConnectionConfig, 'password' | 'sshPassword' | 'sshPrivateKey'>> {
  return config.connections.map((c) => {
    const { password: _p, sshPassword: _sp, sshPrivateKey: _sk, ...safe } = c
    return safe
  })
}
