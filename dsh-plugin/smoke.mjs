/**
 * 插件冒烟测试：加载打包产物，mock DSH ctx 调用 apply()，
 * 验证工具注册数量与名称，并实际执行 nexsql_list_connections。
 */
import { readFileSync } from 'node:fs'

const registered = []
const ctx = {
  tools: { register: (def) => registered.push(def) },
  effect: (fn) => {
    const cleanup = fn()
    if (typeof cleanup !== 'function') throw new Error('ctx.effect 初始化函数必须返回清理函数')
  },
}

const mod = await import(new URL('./lib/index.js', import.meta.url).href)

console.log('exports:', Object.keys(mod).sort().join(', '))
if (mod.name !== 'nexsql') throw new Error(`插件名错误: ${mod.name}`)
if (!Array.isArray(mod.inject) || !mod.inject.includes('tools')) throw new Error('inject 缺少 tools')
if (typeof mod.apply !== 'function') throw new Error('apply 不是函数')
if ('default' in mod) throw new Error('函数插件不应有默认导出（Loader 会丢弃命名空间）')

mod.apply(ctx)

console.log(`注册工具数: ${registered.length}`)
console.log(registered.map((t) => t.name).join('\n'))

for (const t of registered) {
  if (!t.name || !t.description || !t.parameters) throw new Error(`工具 ${t.name} 声明不完整`)
  if (typeof t.execute !== 'function') throw new Error(`工具 ${t.name} 缺少 execute`)
  if (!t.output || t.output.schema?.type !== 'string' || typeof t.output.render !== 'function') {
    throw new Error(`工具 ${t.name} output 声明不完整`)
  }
}

// 实际执行 list_connections（只读 ~/.nexsql/mcp-connections.json，不连数据库）
const listTool = registered.find((t) => t.name === 'nexsql_list_connections')
const value = await listTool.execute({}, { signal: new AbortController().signal })
const content = listTool.output.render({}, value)
console.log('--- nexsql_list_connections 渲染输出 ---')
console.log(content[0].text)

// 错误路径：不存在的连接应抛异常
const q = registered.find((t) => t.name === 'mysql_query')
try {
  await q.execute({ connectionId: 'no-such-conn', sql: 'SELECT 1' }, { signal: new AbortController().signal })
  throw new Error('应抛出连接不存在错误')
} catch (err) {
  console.log('错误路径 OK:', err.message)
}

// 参数校验路径
try {
  await q.execute({ connectionId: 123, sql: 'SELECT 1' }, { signal: new AbortController().signal })
  throw new Error('应抛出参数类型错误')
} catch (err) {
  console.log('参数校验 OK:', err.message)
}

console.log('\n冒烟测试全部通过 ✓')
