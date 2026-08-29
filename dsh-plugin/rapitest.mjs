/**
 * rapi 无头测试：mock req/res，验证 /nexsql/rapi/* 桥接层到真实数据库的完整链路。
 * 连接参数直接用 config.getConnections 的返回值（与 renderer 实际行为一致）。
 */
import { EventEmitter } from 'node:events'
import { existsSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

function makeReq(method, url, body) {
  const req = new EventEmitter()
  req.method = method
  req.url = url
  req.headers = { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080' }
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
    setHeader() {},
    end(payload) { this.body = payload ?? '' },
  }
  return res
}

let handler = null
const fakeCtx = {
  tools: { register: () => {} },
  effect: (fn) => fn(),
  inject: (deps, cb) => {
    if (deps.includes('webServer')) {
      cb({
        webServer: { register: (route) => { handler = route.handler; return () => {} } },
        effect: (fn) => fn(),
      })
    }
  },
}
const mod = await import('./lib/index.js')
mod.apply(fakeCtx)
if (!handler) throw new Error('路由未挂载')

async function call(method, url, body) {
  const res = makeRes()
  await handler(makeReq(method, url, body), res)
  try {
    return { status: res.status, json: JSON.parse(res.body) }
  } catch {
    return { status: res.status, text: res.body }
  }
}
async function rapi(ns, method, ...args) {
  return call('POST', `/nexsql/rapi/${ns}/${method}`, { args })
}
function assert(cond, msg) {
  if (!cond) throw new Error('断言失败: ' + msg)
  console.log(`✓ ${msg}`)
}

// 1. 连接列表（含密码解析）
let r = await rapi('config', 'getConnections')
assert(r.status === 200 && Array.isArray(r.json), 'config.getConnections 返回数组')
const conns = r.json
console.log(`  → ${conns.length} 个连接`)
const mysql = conns.find((c) => c.type === 'mysql')
const redis = conns.find((c) => c.type === 'redis')
assert(conns.every((c) => !String(c.password ?? '').startsWith('enc:')), '密码已从 enc: 解析为明文')
assert(typeof mysql?.color === 'string', '连接带 color 字段（完整 ConnectionConfig）')

// 2. 数据库列表
r = await rapi('db', 'getDatabases', mysql)
assert(r.status === 200 && r.json.success === true && Array.isArray(r.json.data), `db.getDatabases success（${r.json.data?.length} 个库）`)

// 3. 表 + 列 + 行数（走服务层真实查询）
const database = r.json.data[0].name
r = await rapi('db', 'getTables', mysql, database)
assert(r.json.success === true, `db.getTables ${database}（${r.json.data?.length} 张表）`)
if (r.json.data.length > 0) {
  const table = r.json.data[0].name
  r = await rapi('db', 'getTableColumns', mysql, database, table)
  assert(r.json.success === true, `db.getTableColumns ${table}`)
  r = await rapi('db', 'getTableRowCount', mysql, database, table)
  assert(r.json.success === true, `db.getTableRowCount = ${JSON.stringify(r.json.data)}`)
}

// 4. 查询
r = await rapi('db', 'query', mysql, 'SELECT 1 AS one, NOW() AS now')
assert(r.json.success === true && r.json.data, `db.query success（fields=${r.json.data.fields?.length ?? '?'} rows=${r.json.data.rows?.length ?? '?'}）`)

// 5. 错误路径：坏 SQL → IpcResponse error
r = await rapi('db', 'query', mysql, 'SELEC bad')
assert(r.json.success === false && typeof r.json.error === 'string', 'db.query 坏 SQL → {success:false,error}')

// 6. Redis
r = await rapi('redis', 'dbsize', redis)
assert(r.json.success === true && typeof r.json.data === 'number', `redis.dbsize = ${r.json.data}`)
r = await rapi('redis', 'scan', redis, '*', 0, 5)
assert(r.json.success === true && typeof r.json.data?.cursor !== 'undefined', `redis.scan（${r.json.data?.keys?.length ?? 0} 个键）`)

// 7. 对话
r = await rapi('ai', 'getConversations')
assert(r.status === 200 && Array.isArray(r.json), 'ai.getConversations 返回数组')

// 8. 未知方法
r = await rapi('nope', 'x')
assert(r.status === 404, '未知方法 → 404')

// 9. webui 产物存在（静态服务内容）
const webuiIndex = resolve('webui', 'index.html')
assert(existsSync(webuiIndex) && statSync(webuiIndex).size > 500, `webui/index.html 存在（${statSync(webuiIndex).size} 字节）`)

// 10. 连接保存往返（新建 → 读取 → 删除）
const testId = `dsh-test-${Date.now()}`
r = await rapi('config', 'saveConnection', { id: testId, name: 'DSH测试', type: 'mysql', host: '127.0.0.1', port: 3306, user: 'x', password: 'plain', sslEnabled: false, sshEnabled: false })
assert(r.json?.id === testId, 'saveConnection 返回带 id 的配置')
r = await rapi('config', 'getConnections')
assert(r.json.some((c) => c.id === testId && c.password === 'plain'), '保存的明文连接可读回')
r = await rapi('config', 'deleteConnection', testId)
assert(r.json === true, 'deleteConnection 返回 true')
r = await rapi('config', 'getConnections')
assert(!r.json.some((c) => c.id === testId), '删除后列表不再包含')

console.log('\nrapi 无头测试全部通过 ✓')
process.exit(0)
