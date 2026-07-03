import https from 'https'

// ==================== 类型定义 ====================

export interface HttpRequestOptions {
  hostname: string
  port?: number
  path: string
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  headers: Record<string, string>
  body?: string
  /** 取消信号 */
  signal?: { cancelled: boolean }
  /** SSE 流式数据回调，每个 data 行都会触发 */
  onSSEData?: (data: string) => void
}

// ==================== HTTPS 请求封装 ====================

/**
 * 发送 HTTPS 请求，支持 SSE 流式读取和取消。
 *
 * - 如果提供了 `onSSEData`，则使用流式模式，逐块解析 SSE 事件。
 *   返回值为所有 SSE delta 内容拼接的完整文本。
 * - 否则收集完整响应体后返回。
 */
export function httpsRequest(options: HttpRequestOptions): Promise<string> {
  return new Promise((resolve, reject) => {
    const { signal, onSSEData, body, headers } = options

    const request = https.request(
      {
        hostname: options.hostname,
        port: options.port ?? 443,
        path: options.path,
        method: options.method,
        headers: {
          ...headers,
          ...(body ? { 'Content-Length': Buffer.byteLength(body).toString() } : {}),
        },
      },
      (response) => {
        const statusCode = response.statusCode ?? 0
        if (statusCode < 200 || statusCode >= 300) {
          let errBody = ''
          response.on('data', (chunk) => {
            errBody += chunk.toString()
          })
          response.on('end', () => {
            let errMsg = `HTTP ${statusCode}`
            try {
              const parsed = JSON.parse(errBody)
              errMsg = parsed.error?.message || parsed.error || errMsg
            } catch {
              if (errBody) errMsg += `: ${errBody.slice(0, 500)}`
            }
            reject(new Error(errMsg))
          })
          return
        }

        if (onSSEData) {
          // 流式 SSE 模式
          let sseBuffer = ''

          response.on('data', (chunk: Buffer) => {
            if (signal?.cancelled) {
              request.destroy()
              return
            }

            const text = chunk.toString('utf-8')
            sseBuffer += text

            // SSE 事件以双换行分隔
            const events = sseBuffer.split('\n\n')
            sseBuffer = events.pop() ?? ''

            for (const evt of events) {
              if (evt.trim()) {
                onSSEData(evt)
              }
            }
          })

          response.on('end', () => {
            if (sseBuffer.trim()) {
              onSSEData(sseBuffer)
            }
            resolve('') // 完整文本由调用方在 onChunk 中累积
          })

          response.on('error', (err) => {
            reject(err)
          })
        } else {
          // 非流式模式：收集完整响应
          let data = ''
          response.on('data', (chunk: Buffer) => {
            data += chunk.toString('utf-8')
          })
          response.on('end', () => {
            resolve(data)
          })
          response.on('error', (err) => {
            reject(err)
          })
        }
      }
    )

    request.setTimeout(60000, () => {
      request.destroy(new Error('请求超时（60s）'))
    })

    request.on('error', (err) => {
      reject(err)
    })

    if (body) {
      request.write(body)
    }
    request.end()
  })
}
