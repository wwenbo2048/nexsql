/**
 * AI 服务相关类型定义
 */

export interface ERTableColumnsLike {
  table: string
  columns: {
    name: string
    type: string
    isPK: boolean
  }[]
}
