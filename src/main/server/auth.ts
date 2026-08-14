import type { Request, Response, NextFunction } from 'express'
import { uuidv4 } from '../uuid'

// ==================== 配对码管理 ====================

interface PairCodeEntry {
  code: string
  expiresAt: number
}

let currentPairCode: PairCodeEntry | null = null

/** 生成 6 位数字配对码 */
export function generatePairCode(): string {
  const code = String(Math.floor(100000 + Math.random() * 900000))
  currentPairCode = {
    code,
    expiresAt: Date.now() + 5 * 60 * 1000 // 5 分钟有效期
  }
  return code
}

/** 获取当前配对码（未过期时返回，否则返回 null） */
export function getCurrentPairCode(): string | null {
  if (!currentPairCode) return null
  if (Date.now() > currentPairCode.expiresAt) {
    currentPairCode = null
    return null
  }
  return currentPairCode.code
}

/** 验证配对码，成功后消费该配对码并返回 token */
export function verifyPairCode(inputCode: string): string | null {
  if (!currentPairCode) return null
  if (Date.now() > currentPairCode.expiresAt) {
    currentPairCode = null
    return null
  }
  if (inputCode !== currentPairCode.code) return null

  // 配对码一次性使用
  currentPairCode = null

  // 生成长期 token
  const token = uuidv4()
  tokens.set(token, { createdAt: Date.now() })
  return token
}

// ==================== Token 管理 ====================

interface TokenEntry {
  createdAt: number
}

const tokens = new Map<string, TokenEntry>()

/** 检查 token 是否有效 */
export function isValidToken(token: string): boolean {
  return tokens.has(token)
}

/** 撤销 token */
export function revokeToken(token: string): void {
  tokens.delete(token)
}

/** 获取已授权 token 数量 */
export function getTokenCount(): number {
  return tokens.size
}

/** 清除所有 token */
export function clearAllTokens(): void {
  tokens.clear()
}

// ==================== Express 中间件 ====================

/** 从请求中提取并验证 token */
export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const auth = req.headers.authorization
  if (!auth || !auth.startsWith('Bearer ')) {
    res.status(401).json({ success: false, error: '未授权' })
    return
  }
  const token = auth.slice(7)
  if (!isValidToken(token)) {
    res.status(403).json({ success: false, error: '授权已失效，请重新配对' })
    return
  }
  next()
}
