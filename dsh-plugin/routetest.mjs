/**
 * 路由无头测试：mock webServer/req/res，真实执行 /nexsql/* 到数据库的完整链路。
 */
import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'

// ---- mock req/res ----
function makeReq(method, url, body) {
  const req = new EventEmitter()
  req.method = method
  req.url = url
  req.headers = { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080' }
  // 真实 IncomingMessage 是 Readable（async iterable）；mock 补上迭代器
  req[Symbol.asyncIterator] = async function* () {
    if (body !== undefined) yield Buffer.from(JSON.stringify(body))
  }
  queueMicrotask(() => req.emit('end'))
  return req
}
function makeRes() {
  const res = {
    status: 0,
    body: '',
    writeHead(status, headers) { this.status = status; this.headers = headers },
    end(payload) { this.body = payload ?? '' },
  }
  return res
}

// ---- 加载插件，捕获 webServer 注册 ----
let handler = null
const registeredRoutes = []
const fakeCtx = {
  tools: { register: () => {} },
  effect: (fn) => fn(),
  inject: (deps, cb) => {
    if (deps.includes('webServer')) {
      cb({
        webServer: { register: (route) => { registeredRoutes.push(route); handler = route.handler; return () => {} } },
        effect: (fn) => fn(),
      })
    }
  },
}
const mod = await import('./lib/index.js')
mod.apply(fakeCtx)

if (!handler) throw new Error('路由未挂载')
console.log('路由注册:', registeredRoutes.map((r) => `${r.kind} ${r.path}`).join(', '))

async function call(method, url, body) {
  const res = makeRes()
  await handler(makeReq(method, url, body), res)
  try {
    return { status: res.status, json: JSON.parse(res.body) }
  } catch {
    return { status: res.status, text: res.body }
  }
}

// ---- 测试序列 ----
const conns = JSON.parse(readFileSync(homedir() + '/.nexsql/mcp-connections.json', 'utf8')).connections
const localMysql = conns.find((c) => c.type === 'mysql')
const localRedis = conns.find((c) => c.type === 'redis')

let r = await call('GET', '/nexsql/connections')
console.log(`[/connections] ${r.status} → ${r.json.connections.length} 个连接`)

r = await call('GET', `/nexsql/databases?connectionId=${localMysql.id}`)
console.log(`[/databases] ${r.status} →`, r.json.columns, r.json.rows.slice(0, 3))
const db = r.json.rows[0][0]

r = await call('GET', `/nexsql/tables?connectionId=${localMysql.id}&database=${db}`)
console.log(`[/tables] ${r.status} → ${r.json.rows.length} 张表:`, r.json.rows.slice(0, 3).map((t) => t[0]))

if (r.json.rows.length > 0) {
  const table = r.json.rows.find((t) => t[1] === 'BASE TABLE')?.[0] ?? r.json.rows[0][0]
  r = await call('GET', `/nexsql/data?connectionId=${localMysql.id}&database=${db}&table=${table}&limit=3`)
  console.log(`[/data ${db}.${table}] ${r.status} → 列:`, r.json.columns, `行数: ${r.json.rows.length}`)
}

r = await call('POST', '/nexsql/query', { connectionId: localMysql.id, sql: 'SELECT 1 AS one, NOW() AS now' })
console.log(`[/query] ${r.status} →`, JSON.stringify(r.json).slice(0, 150))

r = await call('POST', '/nexsql/query', { connectionId: localMysql.id, sql: 'SELECT * FROM information_schema.TABLES LIMIT 1', database: 'mysql' })
console.log(`[/query 指定库] ${r.status} → 列数 ${r.json.table?.columns?.length}`)

// 错误路径
r = await call('GET', '/nexsql/databases?connectionId=bad-id')
console.log(`[/databases 不存在连接] ${r.status} → ${r.json.error}`)

r = await call('GET', '/nexsql/unknown')
console.log(`[/unknown] ${r.status} → ${r.json.error}`)

// Redis
if (localRedis) {
  r = await call('GET', `/nexsql/redis/keys?connectionId=${localRedis.id}&count=5`)
  console.log(`[/redis/keys] ${r.status} → ${r.json.keys.length} 个键:`, r.json.keys.slice(0, 3).map((k) => k.key))
  if (r.json.keys.length > 0) {
    r = await call('GET', `/nexsql/redis/key?connectionId=${localRedis.id}&key=${encodeURIComponent(r.json.keys[0].key)}`)
    console.log(`[/redis/key] ${r.status} → type=${r.json.type} value 前 80 字: ${r.json.value.slice(0, 80)}`)
  }
}

console.log('\n路由无头测试完成 ✓')
process.exit(0)
