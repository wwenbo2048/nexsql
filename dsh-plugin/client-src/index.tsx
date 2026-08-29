/**
 * nexSql 客户端入口（浏览器半边）。
 *
 * 注册两个槽位：conversation.input.left（输入框工具行的开关按钮）与
 * shell.overlay（数据库面板本体）。apply 绝不抛异常——外壳在插件 apply
 * 抛错时会让整个 GUI 启动失败（dsh-plugin-market 验证过的策略）。
 *
 * 形态与 dsh-talk-map 一致：具名导出 name / inject / apply；
 * bundle 以 window.__ModuleLoader__.load({ id, factory }) 包装，
 * React 由外壳经 factory 的 require 参数提供。
 */
import { NexsqlSettingsSection, NexsqlOverlay } from './panel'
import { ensureStyles } from './ui'

/** ctx.slots 的最小结构面：inject 等待声明，register 返回注销函数。 */
interface SlotsService {
  inject(name: string, factory: () => (() => void) | Iterable<() => void>): void
  register(entry: { name: string; id?: string; order?: number; label?: string | (() => string) }, component: unknown): () => void
}

interface ClientContext {
  readonly slots: SlotsService
  effect(disposer: () => () => void): void
}

export const name = 'nexsql-dsh-plugin'

export const inject = ['slots']

let applied = false

export function apply(ctx: ClientContext): void {
  // 同一页面生命周期内重复注入只注册一次
  if (applied) return
  applied = true
  try {
    ctx.effect(() => () => {
      applied = false
    }, 'nexsql: apply claim')
  } catch {
    /* effect 不可用时跳过 apply claim */
  }

  try {
    ensureStyles()
    // 入口收进设置：设置对话框左栏的一级分区（settings.section），
    // 分区内容页提供「打开数据库面板」按钮，面板本体仍是 shell.overlay 全屏。
    ctx.slots.inject('settings.section', () =>
      ctx.slots.register(
        { name: 'settings.section', id: 'nexsql', order: 50, label: 'nexSql 数据库' },
        NexsqlSettingsSection
      )
    )
    ctx.slots.inject('shell.overlay', () =>
      ctx.slots.register(
        { name: 'shell.overlay', id: 'nexsql', order: 90, label: 'nexSql 数据库' },
        NexsqlOverlay
      )
    )
  } catch (error) {
    console.error('[nexsql] client apply failed:', error)
  }
}
