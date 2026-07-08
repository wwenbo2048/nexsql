/**
 * 连接管理器
 *
 * 管理 MySQL 连接池和 Redis 客户端，支持 SSH 隧道。
 * 复用 nexSql 应用的连接逻辑，但独立于 Electron 运行。
 */
import mysql, { type Pool, type RowDataPacket, type FieldPacket, type PoolOptions } from 'mysql2/promise'
import Redis from 'ioredis'
import { Client, type ClientChannel } from 'ssh2'
import { createServer, type Server, type Socket } from 'net'
import type { McpConnectionConfig } from './types.js'

// ==================== SSH 隧道管理 ====================

interface TunnelEntry {
  server: Server
  localPort: number
  sshClient: Client
}

const tunnels = new Map<string, TunnelEntry>()

function needsTunnel(config: McpConnectionConfig): boolean {
  return !!config.sshEnabled && !!config.sshHost
}

async function createTunnel(config: McpConnectionConfig): Promise<number> {
  const existing = tunnels.get(config.id)
  if (existing) return existing.localPort

  const sshHost = config.sshHost ?? ''
  const sshPort = config.sshPort ?? 22
  const sshUser = config.sshUser ?? ''
  const dbHost = config.host
  const dbPort = config.port

  return new Promise((resolve, reject) => {
    const sshClient = new Client()

    sshClient.on('ready', () => {
      const server = createServer((sock: Socket) => {
        sshClient.forwardOut(
          sock.remoteAddress ?? '127.0.0.1',
          sock.remotePort ?? 0,
          dbHost,
          dbPort,
          (err: Error | undefined, stream: ClientChannel) => {
            if (err) {
              sock.end()
              return
            }
            sock.pipe(stream).pipe(sock)
            stream.on('close', () => sock.end())
            sock.on('close', () => stream.end())
            stream.on('error', () => sock.end())
            sock.on('error', () => stream.end())
          }
        )
      })

      server.listen(0, '127.0.0.1', () => {
        const addr = server.address()
        if (addr && typeof addr === 'object') {
          const localPort = addr.port
          tunnels.set(config.id, { server, localPort, sshClient })
          resolve(localPort)
        } else {
          sshClient.end()
          reject(new Error('无法获取本地转发端口'))
        }
      })

      server.on('error', (err) => {
        sshClient.end()
        reject(new Error(`本地转发服务器错误: ${err.message}`))
      })
    })

    sshClient.on('error', (err: Error) => {
      reject(new Error(`SSH 连接失败: ${err.message}`))
    })

    const sshConfig: Record<string, unknown> = {
      host: sshHost,
      port: sshPort,
      username: sshUser,
      readyTimeout: 15000,
      keepaliveInterval: 10000,
    }

    if (config.sshPrivateKey) {
      sshConfig.privateKey = config.sshPrivateKey
    } else {
      sshConfig.password = config.sshPassword ?? ''
    }

    sshClient.connect(sshConfig as Parameters<Client['connect']>[0])
  })
}

function closeTunnel(configId: string): void {
  const entry = tunnels.get(configId)
  if (entry) {
    entry.server.close()
    entry.sshClient.end()
    tunnels.delete(configId)
  }
}

// ==================== MySQL 连接池管理 ====================

const pools = new Map<string, Pool>()

function buildPoolOptions(config: McpConnectionConfig, localPort?: number): PoolOptions {
  const opts: PoolOptions = {
    host: localPort ? '127.0.0.1' : config.host,
    port: localPort ?? config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    connectionLimit: 3,
    connectTimeout: config.connectTimeout ?? 10000,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
    charset: 'utf8mb4',
    timezone: '+00:00',
    dateStrings: true,
    multipleStatements: false,
  }
  if (config.sslEnabled) {
    opts.ssl = { rejectUnauthorized: false }
  }
  return opts
}

export async function getPool(config: McpConnectionConfig): Promise<Pool> {
  let pool = pools.get(config.id)
  if (!pool) {
    let localPort: number | undefined
    if (needsTunnel(config)) {
      localPort = await createTunnel(config)
    }
    pool = mysql.createPool(buildPoolOptions(config, localPort))
    pools.set(config.id, pool)
  }
  return pool
}

export async function closePool(configId: string): Promise<void> {
  const pool = pools.get(configId)
  if (pool) {
    await pool.end()
    pools.delete(configId)
  }
  closeTunnel(configId)
}

// ==================== Redis 客户端管理 ====================

const redisClients = new Map<string, Redis>()

function buildRedisOptions(config: McpConnectionConfig, localPort?: number) {
  return {
    host: '127.0.0.1',
    port: localPort ?? config.port,
    password: config.password || undefined,
    db: config.redisDb ?? 0,
    connectTimeout: config.connectTimeout ?? 10000,
    retryStrategy: () => null,
    lazyConnect: false,
    ...(config.sslEnabled && !localPort ? { tls: { rejectUnauthorized: false } } : {}),
  }
}

export async function getRedisClient(config: McpConnectionConfig): Promise<Redis> {
  const existing = redisClients.get(config.id)
  if (existing) return existing

  let localPort: number | undefined
  if (needsTunnel(config)) {
    localPort = await createTunnel(config)
  }

  const client = new Redis(buildRedisOptions(config, localPort))

  await new Promise<void>((resolve, reject) => {
    client.once('ready', () => resolve())
    client.once('error', (err) => reject(err))
    setTimeout(() => reject(new Error('Redis 连接超时')), 5000)
  })

  redisClients.set(config.id, client)
  return client
}

export async function closeRedisClient(configId: string): Promise<void> {
  const client = redisClients.get(configId)
  if (client) {
    client.disconnect()
    redisClients.delete(configId)
  }
  closeTunnel(configId)
}

// ==================== 测试连接 ====================

export async function testConnection(config: McpConnectionConfig): Promise<boolean> {
  if (config.type === 'redis') {
    const client = new Redis({
      ...buildRedisOptions(config),
      connectTimeout: 5000,
    })
    try {
      await client.ping()
      return true
    } finally {
      client.disconnect()
    }
  } else {
    const tempPool = mysql.createPool({
      ...buildPoolOptions(config),
      connectionLimit: 1,
    })
    try {
      const conn = await tempPool.getConnection()
      await conn.ping()
      conn.release()
      return true
    } finally {
      await tempPool.end()
    }
  }
}

// ==================== 清理所有连接 ====================

export async function closeAll(): Promise<void> {
  for (const [, pool] of pools) {
    await pool.end()
  }
  pools.clear()

  for (const [, client] of redisClients) {
    client.disconnect()
  }
  redisClients.clear()

  for (const [, entry] of tunnels) {
    entry.server.close()
    entry.sshClient.end()
  }
  tunnels.clear()
}

// ==================== 导出查询辅助类型 ====================

export type { RowDataPacket, FieldPacket }
