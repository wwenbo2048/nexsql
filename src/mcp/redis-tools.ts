/**
 * Redis MCP 工具定义和处理函数
 */
import { getRedisClient } from './connection-manager.js'
import type { McpConnectionConfig, McpToolResult } from './types.js'

/** 获取 Redis INFO */
export async function redisInfo(config: McpConnectionConfig): Promise<McpToolResult> {
  const client = await getRedisClient(config)
  const info = await client.info()
  // 提取关键信息
  const sections = info.split('\r\n').filter((line) => line && !line.startsWith('#'))
  const keys = [
    'redis_version',
    'redis_mode',
    'os',
    'arch_bits',
    'tcp_port',
    'uptime_in_seconds',
    'uptime_in_days',
    'connected_clients',
    'used_memory_human',
    'used_memory_peak_human',
    'total_connections_received',
    'total_commands_processed',
    'instantaneous_ops_per_sec',
    'db0',
  ]
  const filtered = sections.filter((line) => {
    const key = line.split(':')[0]
    return keys.some((k) => key === k || key.startsWith('db'))
  })
  return {
    content: [{ type: 'text', text: `Redis 服务器信息:\n${filtered.join('\n')}` }],
  }
}

/** 获取键总数 */
export async function redisDbsize(config: McpConnectionConfig): Promise<McpToolResult> {
  const client = await getRedisClient(config)
  const size = await client.dbsize()
  return { content: [{ type: 'text', text: `当前数据库键总数: ${size}` }] }
}

/** SCAN 键 */
export async function redisScan(
  config: McpConnectionConfig,
  pattern = '*',
  count = 100,
  type?: string
): Promise<McpToolResult> {
  const client = await getRedisClient(config)
  const allKeys: { key: string; type: string; ttl: number }[] = []
  let cursor = 0

  do {
    const [nextCursor, keys] = await client.scan(
      cursor,
      'MATCH',
      pattern,
      'COUNT',
      Math.min(count, 200)
    )
    cursor = parseInt(nextCursor)

    for (const key of keys) {
      try {
        const keyType = await client.type(key)
        if (type && keyType !== type) continue
        const ttl = await client.ttl(key)
        allKeys.push({ key, type: keyType, ttl })
      } catch {
        allKeys.push({ key, type: 'unknown', ttl: -2 })
      }
    }
  } while (cursor !== 0 && allKeys.length < count)

  const lines = allKeys.map(
    (k) =>
      `  ${k.key}  [${k.type}]  TTL: ${k.ttl === -1 ? '永久' : k.ttl === -2 ? '不存在' : `${k.ttl}s`}`
  )

  return {
    content: [
      {
        type: 'text',
        text: `SCAN "${pattern}" (${allKeys.length} 个键${allKeys.length >= count ? ', 可能更多' : ''}):\n${lines.join('\n') || '无匹配键'}`,
      },
    ],
  }
}

/** 获取键的值和详情 */
export async function redisGet(
  config: McpConnectionConfig,
  key: string
): Promise<McpToolResult> {
  const client = await getRedisClient(config)
  const type = (await client.type(key)) as string
  const ttl = await client.ttl(key)
  const ttlStr = ttl === -1 ? '永久' : ttl === -2 ? '不存在' : `${ttl}s`

  const lines: string[] = [`键: ${key}`, `类型: ${type}`, `TTL: ${ttlStr}`, '']

  switch (type) {
    case 'string': {
      const value = await client.get(key)
      lines.push(`值:\n${value}`)
      break
    }
    case 'hash': {
      const data = await client.hgetall(key)
      const entries = Object.entries(data)
      lines.push(`字段 (${entries.length} 个):`)
      for (const [field, value] of entries) {
        lines.push(`  ${field}: ${value}`)
      }
      break
    }
    case 'list': {
      const data = await client.lrange(key, 0, 99)
      lines.push(`元素 (${data.length} 个, 最多显示 100):`)
      data.forEach((v, i) => lines.push(`  ${i}: ${v}`))
      break
    }
    case 'set': {
      const data = await client.smembers(key)
      lines.push(`成员 (${data.length} 个):`)
      data.forEach((v) => lines.push(`  ${v}`))
      break
    }
    case 'zset': {
      const data = await client.zrange(key, 0, 99, 'WITHSCORES')
      lines.push(`成员 (${data.length / 2} 个, 最多显示 100):`)
      for (let i = 0; i < data.length; i += 2) {
        lines.push(`  ${data[i]} (score: ${data[i + 1]})`)
      }
      break
    }
    case 'stream': {
      const data = (await client.xrange(key, '-', '+')) as [string, string[]][]
      const streamData = data.slice(0, 100)
      lines.push(`消息 (${streamData.length} 条, 最多显示 100):`)
      for (const [id, fields] of streamData) {
        const pairs: string[] = []
        for (let j = 0; j < fields.length; j += 2) {
          pairs.push(`${fields[j]}=${fields[j + 1]}`)
        }
        lines.push(`  ${id}: ${pairs.join(' ')}`)
      }
      break
    }
    case 'none': {
      lines.push('键不存在')
      break
    }
    default:
      lines.push(`未知类型: ${type}`)
  }

  return { content: [{ type: 'text', text: lines.join('\n') }] }
}

/** 设置字符串键 */
export async function redisSet(
  config: McpConnectionConfig,
  key: string,
  value: string,
  ttl?: number
): Promise<McpToolResult> {
  const client = await getRedisClient(config)
  if (ttl && ttl > 0) {
    await client.set(key, value, 'EX', ttl)
  } else {
    await client.set(key, value)
  }
  return {
    content: [{ type: 'text', text: `已设置 ${key} = ${value.length > 100 ? value.slice(0, 100) + '...' : value}${ttl ? ` (TTL: ${ttl}s)` : ''}` }],
  }
}

/** 删除键 */
export async function redisDelete(
  config: McpConnectionConfig,
  keys: string[]
): Promise<McpToolResult> {
  const client = await getRedisClient(config)
  if (keys.length === 0) {
    return { content: [{ type: 'text', text: '未指定要删除的键' }], isError: true }
  }
  const deleted = await client.del(...keys)
  return {
    content: [{ type: 'text', text: `已删除 ${deleted} 个键 (请求删除 ${keys.length} 个)` }],
  }
}

/** 设置 TTL */
export async function redisExpire(
  config: McpConnectionConfig,
  key: string,
  ttl: number
): Promise<McpToolResult> {
  const client = await getRedisClient(config)
  if (ttl <= 0) {
    await client.persist(key)
    return { content: [{ type: 'text', text: `已移除 ${key} 的 TTL (永久)` }] }
  }
  const ok = await client.expire(key, ttl)
  return {
    content: [
      { type: 'text', text: ok ? `已设置 ${key} TTL = ${ttl}s` : `键 ${key} 不存在` },
    ],
    isError: !ok,
  }
}

/** 获取键类型 */
export async function redisType(
  config: McpConnectionConfig,
  key: string
): Promise<McpToolResult> {
  const client = await getRedisClient(config)
  const type = await client.type(key)
  return { content: [{ type: 'text', text: `${key}: ${type}` }] }
}

/** 获取 TTL */
export async function redisTtl(
  config: McpConnectionConfig,
  key: string
): Promise<McpToolResult> {
  const client = await getRedisClient(config)
  const ttl = await client.ttl(key)
  const ttlStr = ttl === -1 ? '永久' : ttl === -2 ? '键不存在' : `${ttl}s`
  return { content: [{ type: 'text', text: `${key} TTL: ${ttlStr}` }] }
}

/** 执行原始 Redis 命令 */
export async function redisExecute(
  config: McpConnectionConfig,
  command: string[]
): Promise<McpToolResult> {
  const client = await getRedisClient(config)
  if (command.length === 0) {
    return { content: [{ type: 'text', text: '命令不能为空' }], isError: true }
  }

  const result = await client.call(command[0], ...command.slice(1))

  let output: string
  if (result === null) {
    output = '(nil)'
  } else if (typeof result === 'string') {
    output = result
  } else if (typeof result === 'number') {
    output = `(integer) ${result}`
  } else if (Array.isArray(result)) {
    const items = result.map((v, i) => `${i + 1}) ${v === null ? '(nil)' : v}`)
    output = items.length > 0 ? items.join('\n') : '(empty array)'
  } else {
    output = JSON.stringify(result, null, 2)
  }

  return {
    content: [
      {
        type: 'text',
        text: `> ${command.join(' ')}\n${output}`,
      },
    ],
  }
}
