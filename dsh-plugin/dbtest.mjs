/**
 * 数据库连通性验证：在打包产物上执行真实 MySQL 查询。
 * 取配置中第一个本地 (127.0.0.1) MySQL 连接。
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'

const { connections } = JSON.parse(
  readFileSync(homedir() + '/.nexsql/mcp-connections.json', 'utf8')
)
const mysql = process.argv[2]
  ? connections.find((c) => c.id === process.argv[2])
  : connections.find((c) => c.type === 'mysql' && c.host === '127.0.0.1' && !c.sshEnabled)
if (!mysql) throw new Error('未找到指定连接')
console.log('测试连接:', mysql.id, mysql.name)

const registered = []
const ctx = { tools: { register: (d) => registered.push(d) }, effect: () => {} }
const mod = await import('./lib/index.js')
mod.apply(ctx)

const list = registered.find((t) => t.name === 'mysql_list_databases')
const v = await list.execute({ connectionId: mysql.id }, { signal: new AbortController().signal })
console.log('=== mysql_list_databases ===')
console.log(list.output.render({}, v)[0].text)

const q = registered.find((t) => t.name === 'mysql_query')
const v2 = await q.execute(
  { connectionId: mysql.id, sql: 'SELECT VERSION() AS v' },
  { signal: new AbortController().signal }
)
console.log('=== mysql_query ===')
console.log(q.output.render({}, v2)[0].text)
process.exit(0)
