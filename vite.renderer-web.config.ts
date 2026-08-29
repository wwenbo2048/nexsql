/**
 * 独立构建 renderer 为纯 Web SPA（DSH 插件面板用）。
 *
 * 与 electron.vite.config.ts 的 renderer 段保持同一套 alias 与插件，
 * 区别：无 Electron 假设、资源挂到 /nexsql/app/ 基路径、
 * 在应用 bundle 之前注入 window.api 的 fetch 垫片（api-shim.js）。
 * 产物输出到 dsh-plugin/webui/，由 DSH 插件 Host 静态服务。
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/** 垫片内容哈希：垫片一变，index.html 里的引用 URL 跟着变，浏览器缓存自动失效 */
const shimHash = createHash('sha256')
  .update(readFileSync(resolve('dsh-plugin/webui-src/api-shim.js')))
  .digest('hex')
  .slice(0, 10)

export default defineConfig({
  root: resolve('src/renderer'),
  base: '/nexsql/app/',
  plugins: [
    react(),
    {
      // 在模块入口之前注入垫片：window.api 必须先于应用代码存在
      name: 'inject-nexsql-api-shim',
      transformIndexHtml(html) {
        const tag = '<script type="module"'
        const idx = html.indexOf(tag)
        if (idx < 0) throw new Error('renderer index.html 缺少模块入口，无法注入 api-shim')
        return (
          html.slice(0, idx) +
          `<script src="/nexsql/app/api-shim.js?v=${shimHash}"></script>\n    ` +
          html.slice(idx)
        )
      }
    }
  ],
  resolve: {
    alias: {
      '@renderer': resolve('src/renderer/src'),
      '@shared': resolve('src/shared'),
      '@components': resolve('src/renderer/src/components'),
      '@stores': resolve('src/renderer/src/stores'),
      '@types': resolve('src/shared/types')
    }
  },
  css: {
    postcss: resolve('postcss.config.js')
  },
  build: {
    outDir: resolve('dsh-plugin/webui'),
    emptyOutDir: true,
    chunkSizeWarningLimit: 5000
  }
})
