/**
 * esbuild 双产物打包：
 * 1. lib/index.js —— Host 半边（工具 + /nexsql/* 路由），ESM；
 *    mysql2/ioredis/ssh2 外置，安装进 profile 时由 pnpm 解析。
 * 2. client/client.js —— 浏览器半边（数据库面板），CJS 闭包包进
 *    window.__ModuleLoader__.load({ id, factory }) 装载器格式；
 *    React 系列外置，由外壳经 factory 的 require 提供。
 *    文件头必须精确以一行 loader banner 开头（宿主从文件头嗅探 id）。
 */
import { build } from 'esbuild'
import { readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

// ---- Host 半边 ----
await build({
  entryPoints: ['src/index.ts'],
  outfile: 'lib/index.js',
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  external: ['mysql2', 'ioredis', 'ssh2'],
  logLevel: 'info',
})

// ---- Client 半边 ----
await build({
  entryPoints: ['client-src/index.tsx'],
  outfile: 'client/client.js',
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  external: ['react', 'react-dom', 'react/jsx-runtime'],
  banner: {
    js: [
      `window.__ModuleLoader__.load({ id: ${JSON.stringify(pkg.name)}, factory: (require) => {`,
      'var module = { exports: {} };',
      'var exports = module.exports;',
    ].join('\n'),
  },
  footer: { js: 'return module.exports;\n} });' },
  logLevel: 'info',
})

// 校验 loader banner 精确位于文件头
const { execSync } = await import('node:child_process')
const head = execSync('head -c 120 client/client.js', { encoding: 'utf8' })
const required = `window.__ModuleLoader__.load({ id: ${JSON.stringify(pkg.name)}, factory: (require) => {`
if (!head.startsWith(required)) {
  console.error(`build: client/client.js 头部不符合 loader banner 格式:\n${head}`)
  process.exit(1)
}
console.log('client loader banner ✓')
