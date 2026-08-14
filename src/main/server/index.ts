import express from 'express'
import { join } from 'path'
import { statSync } from 'fs'
import { networkInterfaces } from 'os'
import type { Server } from 'http'
import { createApiRouter } from './routes'
import { generatePairCode, getCurrentPairCode, getTokenCount, clearAllTokens } from './auth'

let server: Server | null = null
let currentPort = 19800

/** 获取局域网 IP 地址 */
export function getLocalIPs(): string[] {
  const nets = networkInterfaces()
  const ips: string[] = []
  for (const interfaces of Object.values(nets)) {
    if (!interfaces) continue
    for (const net of interfaces) {
      // IPv4 且非内部地址
      if (net.family === 'IPv4' && !net.internal) {
        ips.push(net.address)
      }
    }
  }
  return ips
}

/** 获取 mobile 静态文件目录 */
function getMobileDir(): string {
  // __dirname 运行时为 out/main（开发）或 app.asar/out/main（打包）
  // 依次尝试候选路径，取第一个存在 index.html 的目录
  const candidates = [
    join(__dirname, '..', 'mobile'), // out/main -> out/mobile
    join(process.resourcesPath, 'mobile') // 生产环境 extraResources
  ]
  for (const dir of candidates) {
    try {
      statSync(join(dir, 'index.html'))
      return dir
    } catch {
      // 继续尝试下一个
    }
  }
  // 均不存在时返回生产路径（便于错误提示）
  return join(process.resourcesPath, 'mobile')
}

export interface ServerStatus {
  running: boolean
  port: number
  urls: string[]
  pairCode: string | null
  authorizedDevices: number
}

export function getServerStatus(): ServerStatus {
  const running = server !== null
  const pairCode = running ? getCurrentPairCode() : null
  return {
    running,
    port: currentPort,
    urls: running ? getLocalIPs().map(ip => `http://${ip}:${currentPort}`) : [],
    pairCode,
    authorizedDevices: getTokenCount()
  }
}

export function refreshPairCode(): string {
  return generatePairCode()
}

export async function startServer(port: number = 19800): Promise<ServerStatus> {
  if (server) {
    throw new Error('服务器已在运行')
  }

  currentPort = port
  const app = express()

  // 中间件
  app.use(express.json({ limit: '10mb' }))

  // CORS（局域网访问）
  app.use((_req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*')
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    if (_req.method === 'OPTIONS') {
      res.sendStatus(200)
      return
    }
    next()
  })

  // API 路由
  app.use('/api', createApiRouter())

  // 静态文件（mobile web app）
  const mobileDir = getMobileDir()
  app.use(express.static(mobileDir))
  // SPA fallback：所有非 API 请求返回 index.html
  // Express 5（path-to-regexp v8）不再支持裸 '*' 路由，改用无路径中间件
  app.use((_req, res) => {
    res.sendFile(join(mobileDir, 'index.html'))
  })

  return new Promise((resolve, reject) => {
    server = app.listen(port, '0.0.0.0', () => {
      // 启动时自动生成配对码
      generatePairCode()
      console.log(`[LAN Server] 监听端口 ${port}`)
      resolve(getServerStatus())
    })

    server.on('error', (err: NodeJS.ErrnoException) => {
      server = null
      if (err.code === 'EADDRINUSE') {
        reject(new Error(`端口 ${port} 已被占用，请更换端口`))
      } else {
        reject(err)
      }
    })
  })
}

// 重新导出隧道控制函数
export {
  startTunnel,
  stopTunnel,
  getTunnelStatus,
  getTunnelConfig,
  saveTunnelConfig
} from './tunnel'

export async function stopServer(): Promise<void> {
  if (!server) return
  await new Promise<void>((resolve) => {
    server!.close(() => {
      server = null
      clearAllTokens()
      console.log('[LAN Server] 已停止')
      resolve()
    })
  })
}
