import { Client, type ClientChannel } from 'ssh2'
import { createServer, type Server, type Socket } from 'net'
import type { ConnectionConfig } from '../../shared/types'

interface TunnelEntry {
  server: Server
  localPort: number
  sshClient: Client
}

// 连接 ID -> 隧道
const tunnels = new Map<string, TunnelEntry>()

/**
 * 为指定连接创建 SSH 隧道，返回本地转发端口。
 * 如果隧道已存在则直接返回。
 */
export async function createTunnel(config: ConnectionConfig): Promise<number> {
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
      // 创建本地 TCP 服务器进行端口转发
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

      // 监听随机可用端口
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

    // 构建 SSH 连接配置
    const sshConfig: Record<string, unknown> = {
      host: sshHost,
      port: sshPort,
      username: sshUser,
      readyTimeout: 15000,
      keepaliveInterval: 10000,
    }

    // 认证方式：私钥优先，否则密码
    if (config.sshPrivateKey) {
      sshConfig.privateKey = config.sshPrivateKey
    } else {
      sshConfig.password = config.sshPassword ?? ''
    }

    sshClient.connect(sshConfig as Parameters<Client['connect']>[0])
  })
}

/**
 * 关闭指定连接的 SSH 隧道
 */
export function closeTunnel(configId: string): void {
  const entry = tunnels.get(configId)
  if (entry) {
    entry.server.close()
    entry.sshClient.end()
    tunnels.delete(configId)
  }
}

/**
 * 关闭所有 SSH 隧道
 */
export function closeAllTunnels(): void {
  for (const [id, entry] of tunnels) {
    entry.server.close()
    entry.sshClient.end()
    tunnels.delete(id)
  }
}

/**
 * 判断连接是否需要 SSH 隧道
 */
export function needsTunnel(config: ConnectionConfig): boolean {
  return !!config.sshEnabled && !!config.sshHost
}
