/**
 * 客户端 bundle 冒烟测试：模拟浏览器 __ModuleLoader__ 执行 factory，
 * 验证导出形态与槽位注册（不真正渲染 DOM）。
 */
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'

const nodeRequire = createRequire(import.meta.url)
const shellRequire = (name) => {
  if (name === 'react' || name === 'react/jsx-runtime' || name === 'react-dom') return nodeRequire(name)
  throw new Error(`意外的 require: ${name}`)
}

let loaded = null
globalThis.window = {
  __ModuleLoader__: {
    load(entry) {
      loaded = entry
    },
  },
}

const code = readFileSync(new URL('./client/client.js', import.meta.url), 'utf8')
try {
  // eslint-disable-next-line no-eval
  (0, eval)(code)
} catch (error) {
  console.error('[eval 抛错]', error)
  process.exit(1)
}

if (!loaded) throw new Error('loader 未收到 load()')
if (loaded.id !== 'nexsql-dsh-plugin') throw new Error(`loader id 错误: ${loaded.id}`)
console.log('loader id ✓', loaded.id)

const mod = loaded.factory(shellRequire)
console.log('factory 返回 keys:', Object.keys(mod).sort().join(', '))
if (mod.name !== 'nexsql-dsh-plugin') throw new Error('client name 错误')
if (!Array.isArray(mod.inject) || !mod.inject.includes('slots')) throw new Error('client inject 缺少 slots')
if (typeof mod.apply !== 'function') throw new Error('client apply 不是函数')

const registrations = []
const ctx = {
  slots: {
    inject(name, factory) {
      const disposers = factory()
      const list = Symbol.iterator in Object(disposers) ? [...disposers] : [disposers]
      for (const d of list) registrations.push({ slot: name, dispose: d })
    },
    register(entry, component) {
      registrations.push({ slot: entry.name, id: entry.id, component })
      return () => {}
    },
  },
  effect(fn) {
    return fn()
  },
}

// slots.inject 的 factory 返回单个 disposer 或 iterable —— 我们的实现返回单个
mod.apply(ctx)

const slotNames = registrations.map((r) => `${r.slot}:${r.id ?? 'dispose'}`)
console.log('槽位注册:', slotNames.join(', '))

const button = registrations.find((r) => r.slot === 'settings.section' && r.component)
const overlay = registrations.find((r) => r.slot === 'shell.overlay' && r.component)
if (!button || typeof button.component !== 'function') throw new Error('设置分区组件缺失')
if (!overlay || typeof overlay.component !== 'function') throw new Error('overlay 组件缺失')
// 注：hooks 组件不能在 React 渲染器外直接调用，组件渲染由真实外壳验证

// 二次 apply 幂等
const before = registrations.length
mod.apply(ctx)
if (registrations.length !== before) throw new Error('重复 apply 应被幂等忽略')

console.log('\n客户端冒烟测试通过 ✓')
