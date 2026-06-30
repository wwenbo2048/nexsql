import Redis from 'ioredis'
import type { ConnectionConfig, RedisKeyInfo, RedisKeyType, RedisKeyValue } from '../../shared/types'
import { createTunnel, closeTunnel, needsTunnel } from './ssh-tunnel'

// Redis 连接池
const clients = new Map<string, Redis>()

function buildRedisOptions(config: ConnectionConfig, localPort?: number) {
  return {
    host: '127.0.0.1',
    port: localPort ?? config.port,
    password: config.password || undefined,
    db: config.redisDb ?? 0,
    connectTimeout: config.connectTimeout ?? 10000,
    retryStrategy: () => null,
    lazyConnect: false,
    ...(config.sslEnabled && !localPort ? { tls: { rejectUnauthorized: false } } : {})
  }
}

export async function getClient(config: ConnectionConfig): Promise<Redis> {
  const existing = clients.get(config.id)
  if (existing) return existing

  let localPort: number | undefined
  if (needsTunnel(config)) {
    localPort = await createTunnel(config)
  }

  const client = new Redis(buildRedisOptions(config, localPort))

  // 等待连接
  await new Promise<void>((resolve, reject) => {
    client.once('ready', () => resolve())
    client.once('error', (err) => reject(err))
    // 超时保护
    setTimeout(() => reject(new Error('连接超时')), 5000)
  })

  clients.set(config.id, client)
  return client
}

export async function testRedisConnection(config: ConnectionConfig): Promise<boolean> {
  let localPort: number | undefined
  let createdTunnel = false
  if (needsTunnel(config)) {
    localPort = await createTunnel(config)
    createdTunnel = true
  }

  const client = new Redis({
    ...buildRedisOptions(config, localPort),
    connectTimeout: 5000
  })

  try {
    await client.ping()
    return true
  } finally {
    client.disconnect()
    if (createdTunnel) closeTunnel(config.id)
  }
}

export async function disconnectRedis(configId: string): Promise<void> {
  const client = clients.get(configId)
  if (client) {
    client.disconnect()
    clients.delete(configId)
  }
  closeTunnel(configId)
}

// SCAN keys（支持模式匹配，分批加载）
export async function scanKeys(
  config: ConnectionConfig,
  pattern: string,
  cursor = 0,
  count = 200
): Promise<{ cursor: number; keys: RedisKeyInfo[] }> {
  const client = await getClient(config)
  const [nextCursor, keys] = await client.scan(
    cursor, 'MATCH', pattern, 'COUNT', count
  )

  const result: RedisKeyInfo[] = []
  for (const key of keys) {
    try {
      const type = await client.type(key) as RedisKeyType
      const ttl = await client.ttl(key)
      let size = 0
      if (type === 'string') {
        size = await client.strlen(key)
      } else if (type === 'hash') {
        size = await client.hlen(key)
      } else if (type === 'list') {
        size = await client.llen(key)
      } else if (type === 'set') {
        size = await client.scard(key)
      } else if (type === 'zset') {
        size = await client.zcard(key)
      }
      result.push({ key, type, ttl, size })
    } catch {
      // 单个 key 出错跳过，不影响整体
      result.push({ key, type: 'none', ttl: -2, size: 0 })
    }
  }

  return { cursor: parseInt(nextCursor), keys: result }
}

// DBSIZE
export async function getDbSize(config: ConnectionConfig): Promise<number> {
  const client = await getClient(config)
  return client.dbsize()
}

// 获取 key 的值
export async function getKeyDetail(config: ConnectionConfig, key: string): Promise<RedisKeyValue> {
  const client = await getClient(config)
  const type = await client.type(key) as RedisKeyType
  const ttl = await client.ttl(key)

  let value = ''
  let members: { field: string; value: string }[] | undefined

  switch (type) {
    case 'string':
      value = await client.get(key) ?? ''
      break
    case 'hash':
      const hashData = await client.hgetall(key)
      members = Object.entries(hashData).map(([field, v]) => ({ field, value: v }))
      value = JSON.stringify(hashData, null, 2)
      break
    case 'list':
      const listData = await client.lrange(key, 0, 499)
      members = listData.map((v, i) => ({ field: String(i), value: v }))
      value = listData.join('\n')
      break
    case 'set':
      const setData = await client.smembers(key)
      members = setData.map((v) => ({ field: '', value: v }))
      value = setData.join('\n')
      break
    case 'zset':
      const zsetData = await client.zrange(key, 0, 499, 'WITHSCORES')
      members = []
      for (let i = 0; i < zsetData.length; i += 2) {
        members.push({ field: zsetData[i + 1], value: zsetData[i] })
      }
      value = zsetData.join('\n')
      break
    default:
      value = '(empty)'
  }

  return { key, type, ttl, value, members }
}

// 设置 key 的值
export async function setKeyValue(
  config: ConnectionConfig,
  key: string,
  type: RedisKeyType,
  value: string,
  ttl?: number
): Promise<void> {
  const client = await getClient(config)

  // 先删除旧值（类型可能变了）
  await client.del(key)

  switch (type) {
    case 'string':
      await client.set(key, value)
      break
    case 'hash':
      const hashObj: Record<string, string> = {}
      const parsed = JSON.parse(value) as Record<string, string>
      for (const [k, v] of Object.entries(parsed)) hashObj[k] = v
      if (Object.keys(hashObj).length > 0) await client.hset(key, hashObj)
      break
    case 'list':
      const lines = value.split('\n').filter(Boolean)
      if (lines.length > 0) await client.rpush(key, ...lines)
      break
    case 'set':
      const setLines = value.split('\n').filter(Boolean)
      if (setLines.length > 0) await client.sadd(key, ...setLines)
      break
    case 'zset':
      const zLines = value.split('\n').filter(Boolean)
      const zArgs: (string | number)[] = [key]
      for (const line of zLines) {
        const idx = line.lastIndexOf(':')
        if (idx > 0) {
          zArgs.push(parseFloat(line.slice(idx + 1)), line.slice(0, idx))
        }
      }
      if (zArgs.length > 1) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (client as any).zadd(...zArgs)
      }
      break
  }

  if (ttl && ttl > 0) {
    await client.expire(key, ttl)
  }
}

// 设置单个 hash 字段 / list 元素
export async function setHashField(
  config: ConnectionConfig,
  key: string,
  field: string,
  value: string
): Promise<void> {
  const client = await getClient(config)
  await client.hset(key, field, value)
}

// 删除 key
export async function deleteKey(config: ConnectionConfig, key: string): Promise<void> {
  const client = await getClient(config)
  await client.del(key)
}

// 设置 TTL
export async function setTtl(config: ConnectionConfig, key: string, ttl: number): Promise<void> {
  const client = await getClient(config)
  if (ttl <= 0) {
    await client.persist(key)
  } else {
    await client.expire(key, ttl)
  }
}

// 重命名 key
export async function renameKey(config: ConnectionConfig, oldKey: string, newKey: string): Promise<void> {
  const client = await getClient(config)
  await client.rename(oldKey, newKey)
}

// 执行原始 Redis 命令
export async function executeCommand(
  config: ConnectionConfig,
  command: string[]
): Promise<unknown> {
  const client = await getClient(config)
  return client.call(command[0], ...command.slice(1))
}
