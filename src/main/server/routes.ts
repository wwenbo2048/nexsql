import { Router } from 'express'
import type { Response } from 'express'
import { join } from 'path'
import { statSync } from 'fs'
import { app } from 'electron'
import type { ConnectionConfig, IpcResponse } from '../../shared/types'
import * as db from '../services/db'
import * as redis from '../services/redis'
import { generateSqlStream, validateApiKey } from '../services/ai'
import Store from 'electron-store'
import { encryptPassword, decryptPassword } from '../crypto'
import { verifyPairCode, authMiddleware, getTokenCount } from './auth'

// ==================== Store (与 ipc.ts 共享配置) ====================

interface AISettings {
  apiKey: string
  model: string
}

const store = new Store<{
  connections: ConnectionConfig[]
  aiSettings: AISettings
}>({
  name: 'nexsql-config',
  defaults: {
    connections: [],
    aiSettings: { apiKey: '', model: 'deepseek-chat' }
  }
})

/** 根据 connectionId 获取完整连接配置（含解密密码） */
function getConnectionById(connectionId: string): ConnectionConfig | null {
  const connections = store.get('connections', [])
  const conn = connections.find((c) => c.id === connectionId)
  if (!conn) return null
  return {
    ...conn,
    password: decryptPassword(conn.password) ?? '',
    sshPassword: decryptPassword(conn.sshPassword) ?? ''
  }
}

/** 返回连接列表（隐藏密码） */
function getSafeConnections() {
  const connections = store.get('connections', [])
  return connections.map((c) => ({
    id: c.id,
    name: c.name,
    type: c.type,
    host: c.host,
    port: c.port,
    user: c.user,
    database: c.database,
    color: c.color,
    group: c.group,
    tags: c.tags,
    sshEnabled: c.sshEnabled,
    sslEnabled: c.sslEnabled,
    redisDb: c.redisDb
  }))
}

// ==================== 辅助函数 ====================

function sendResponse<T>(res: Response, result: IpcResponse<T>): void {
  res.json(result)
}

/** 统一的错误处理包装器 */
function wrapAsync<T extends Record<string, any>>(
  handler: (body: T) => Promise<IpcResponse>
) {
  return async (req: any, res: Response) => {
    try {
      const result = await handler(req.body || {})
      sendResponse(res, result)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[Server API] Error:', msg)
      sendResponse(res, { success: false, error: msg })
    }
  }
}

// ==================== 路由注册 ====================

export function createApiRouter(): Router {
  const router = Router()

  // ---------- 配对（无需 token） ----------
  router.post('/pair', (req, res) => {
    const { code } = req.body || {}
    if (!code) {
      res.status(400).json({ success: false, error: '请输入配对码' })
      return
    }
    const token = verifyPairCode(String(code).trim())
    if (!token) {
      res.status(403).json({ success: false, error: '配对码无效或已过期' })
      return
    }
    res.json({ success: true, data: { token } })
  })

  // ---------- 以下所有路由需要 token ----------
  router.use(authMiddleware)

  // 服务器状态
  router.get('/status', (_req, res) => {
    res.json({
      success: true,
      data: {
        appVersion: app.getVersion(),
        platform: process.platform,
        authorizedDevices: getTokenCount()
      }
    })
  })

  // ---------- 连接列表 ----------
  router.get('/connections', (_req, res) => {
    res.json({ success: true, data: getSafeConnections() })
  })

  // ---------- 数据库操作 ----------
  router.post('/db/databases', wrapAsync<{ connectionId: string }>(
    async ({ connectionId }) => {
      const config = getConnectionById(connectionId)
      if (!config) return { success: false, error: '连接不存在' }
      const data = await db.getDatabases(config)
      return { success: true, data }
    }
  ))

  router.post('/db/tables', wrapAsync<{ connectionId: string; database: string }>(
    async ({ connectionId, database }) => {
      const config = getConnectionById(connectionId)
      if (!config) return { success: false, error: '连接不存在' }
      const data = await db.getTables(config, database)
      return { success: true, data }
    }
  ))

  router.post('/db/columns', wrapAsync<{ connectionId: string; database: string; table: string }>(
    async ({ connectionId, database, table }) => {
      const config = getConnectionById(connectionId)
      if (!config) return { success: false, error: '连接不存在' }
      const data = await db.getTableColumns(config, database, table)
      return { success: true, data }
    }
  ))

  router.post('/db/ddl', wrapAsync<{ connectionId: string; database: string; table: string }>(
    async ({ connectionId, database, table }) => {
      const config = getConnectionById(connectionId)
      if (!config) return { success: false, error: '连接不存在' }
      const data = await db.getTableDDL(config, database, table)
      return { success: true, data }
    }
  ))

  router.post('/db/details', wrapAsync<{ connectionId: string; database: string; table: string }>(
    async ({ connectionId, database, table }) => {
      const config = getConnectionById(connectionId)
      if (!config) return { success: false, error: '连接不存在' }
      const data = await db.getTableDetails(config, database, table)
      return { success: true, data }
    }
  ))

  router.post('/db/query', wrapAsync<{ connectionId: string; sql: string; database?: string }>(
    async ({ connectionId, sql, database }) => {
      const config = getConnectionById(connectionId)
      if (!config) return { success: false, error: '连接不存在' }
      const data = await db.executeQuery(config, sql, database)
      return { success: true, data }
    }
  ))

  router.post('/db/rowcount', wrapAsync<{ connectionId: string; database: string; table: string }>(
    async ({ connectionId, database, table }) => {
      const config = getConnectionById(connectionId)
      if (!config) return { success: false, error: '连接不存在' }
      const data = await db.getTableRowCount(config, database, table)
      return { success: true, data }
    }
  ))

  // ---------- Redis 操作 ----------
  router.post('/redis/dbsize', wrapAsync<{ connectionId: string }>(
    async ({ connectionId }) => {
      const config = getConnectionById(connectionId)
      if (!config) return { success: false, error: '连接不存在' }
      const data = await redis.getDbSize(config)
      return { success: true, data }
    }
  ))

  router.post('/redis/scan', wrapAsync<{ connectionId: string; pattern: string; cursor: number; count?: number }>(
    async ({ connectionId, pattern, cursor, count }) => {
      const config = getConnectionById(connectionId)
      if (!config) return { success: false, error: '连接不存在' }
      const data = await redis.scanKeys(config, pattern, cursor, count ?? 200)
      return { success: true, data }
    }
  ))

  router.post('/redis/key', wrapAsync<{ connectionId: string; key: string }>(
    async ({ connectionId, key }) => {
      const config = getConnectionById(connectionId)
      if (!config) return { success: false, error: '连接不存在' }
      const data = await redis.getKeyDetail(config, key)
      return { success: true, data }
    }
  ))

  router.post('/redis/delete', wrapAsync<{ connectionId: string; key: string }>(
    async ({ connectionId, key }) => {
      const config = getConnectionById(connectionId)
      if (!config) return { success: false, error: '连接不存在' }
      await redis.deleteKey(config, key)
      return { success: true }
    }
  ))

  // ---------- AI 自然语言转 SQL ----------
  router.post('/ai/generate', async (req, res) => {
    const { connectionId, database, prompt, existingSql } = req.body || {}

    const aiSettings = store.get('aiSettings', { apiKey: '', model: 'deepseek-chat' })
    if (!aiSettings.apiKey) {
      res.json({ success: false, error: '桌面端尚未配置 AI API Key' })
      return
    }

    // 获取 schema 作为上下文
    let schema: { table: string; columns: { name: string; type: string; isPK: boolean }[] }[] | undefined
    if (connectionId && database) {
      const config = getConnectionById(connectionId)
      if (config) {
        try {
          schema = await db.getAllTableColumns(config, database)
        } catch {
          // schema 获取失败不影响生成
        }
      }
    }

    // 设置 SSE
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')

    try {
      const fullSql = await generateSqlStream(
        {
          prompt,
          apiKey: aiSettings.apiKey,
          model: aiSettings.model,
          database,
          schema,
          existingSql
        },
        {
          onChunk: (chunk: string) => {
            res.write(`data: ${JSON.stringify({ chunk })}\n\n`)
          }
        }
      )
      res.write(`data: ${JSON.stringify({ done: true, sql: fullSql })}\n\n`)
      res.end()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      res.write(`data: ${JSON.stringify({ error: msg })}\n\n`)
      res.end()
    }
  })

  return router
}
