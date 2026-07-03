import { httpsRequest } from '../utils/http'
import type { ERTableColumnsLike } from './ai-types'

// ==================== 类型定义 ====================

export interface GenerateSqlParams {
  prompt: string
  apiKey: string
  model?: string
  /** 数据库名，用于上下文 */
  database?: string
  /** 数据库 schema（表 + 列） */
  schema?: ERTableColumnsLike[]
  /** 当前编辑器中已有的 SQL（可选，用于优化/改写场景） */
  existingSql?: string
}

export interface StreamCallbacks {
  onChunk: (text: string) => void
  signal?: { cancelled: boolean }
}

// ==================== Schema 文本构建 ====================

/**
 * 将数据库 schema 转为简洁的 DDL 风格文本，供 LLM 理解表结构。
 */
export function buildSchemaText(database: string | undefined, schema: ERTableColumnsLike[] | undefined): string {
  if (!schema || schema.length === 0) {
    return database ? `当前数据库: ${database}（未获取到表结构信息）` : ''
  }

  const lines: string[] = []
  if (database) lines.push(`-- 数据库: ${database}`)
  lines.push('-- 表结构如下：')

  for (const tbl of schema) {
    const colDefs = tbl.columns.map((c) => {
      const parts = [c.name, c.type]
      if (c.isPK) parts.push('PRIMARY KEY')
      return `  ${parts.join(' ')}`
    })
    lines.push(`CREATE TABLE ${tbl.table} (\n${colDefs.join(',\n')}\n);`)
  }

  return lines.join('\n')
}

// ==================== System Prompt ====================

const SYSTEM_PROMPT = `你是一个专业的 MySQL 数据库专家和 SQL 开发助手。

你的任务是根据用户的自然语言描述，生成准确、高效的 MySQL SQL 语句。

规则：
1. 只返回纯 SQL 代码，不要包含任何解释、markdown 标记（如 \`\`\`sql）或额外说明。
2. 生成的 SQL 必须兼容 MySQL 5.7+ 语法。
3. 严格使用提供的数据库表名和字段名，不要编造不存在的表或列。
4. 对于查询（SELECT），默认添加合理的 LIMIT（通常 LIMIT 100），除非用户明确要求全部或指定数量。
5. 对于写操作（INSERT/UPDATE/DELETE），生成完整且安全的语句。
6. 如果用户的描述模糊或无法确定意图，生成最合理的 SQL 并在末尾用 -- 注释说明假设。
7. 如果用户提供了已有 SQL，在原有基础上优化或修改，保持风格一致。`

// ==================== DeepSeek API 流式调用 ====================

/**
 * 调用 DeepSeek Chat Completions API（OpenAI 兼容），流式输出。
 * DeepSeek API 文档: https://api-docs.deepseek.com/
 */
export async function generateSqlStream(
  params: GenerateSqlParams,
  callbacks: StreamCallbacks
): Promise<string> {
  const { prompt, apiKey, model = 'deepseek-chat', database, schema, existingSql } = params

  const schemaText = buildSchemaText(database, schema)

  const userContent = [
    schemaText && `数据库上下文:\n${schemaText}`,
    existingSql && `已有SQL（请在此基础上修改/优化）:\n${existingSql}`,
    `用户需求: ${prompt}`,
  ]
    .filter(Boolean)
    .join('\n\n')

  const body = JSON.stringify({
    model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userContent },
    ],
    stream: true,
    max_tokens: 2048,
    temperature: 0.1, // 低温度，保证 SQL 输出稳定
  })

  let fullText = ''

  await httpsRequest({
    hostname: 'api.deepseek.com',
    path: '/v1/chat/completions',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body,
    signal: callbacks.signal,
    onSSEData: (data: string) => {
      // 解析 SSE data 行
      const lines = data.split('\n')
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith(':')) continue
        if (!trimmed.startsWith('data: ')) continue

        const jsonStr = trimmed.slice(6) // 去掉 "data: " 前缀
        if (jsonStr === '[DONE]') return

        try {
          const parsed = JSON.parse(jsonStr)
          const delta = parsed.choices?.[0]?.delta?.content
          if (delta) {
            fullText += delta
            callbacks.onChunk(delta)
          }
        } catch {
          // 忽略 JSON 解析错误
        }
      }
    },
  })

  // 清理可能残留的 markdown 代码块标记
  return fullText
    .replace(/```sql\s*/gi, '')
    .replace(/```\s*/g, '')
    .trim()
}

// ==================== API Key 管理 ====================

/**
 * 验证 API Key 是否有效（发送一个简单请求）。
 */
export async function validateApiKey(apiKey: string, model = 'deepseek-chat'): Promise<boolean> {
  const body = JSON.stringify({
    model,
    messages: [{ role: 'user', content: 'hi' }],
    max_tokens: 5,
    stream: false,
  })

  const result = await httpsRequest({
    hostname: 'api.deepseek.com',
    path: '/v1/chat/completions',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body,
  })

  try {
    const parsed = JSON.parse(result)
    return !parsed.error
  } catch {
    return false
  }
}
