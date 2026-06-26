/**
 * 密码加密/解密模块
 * 使用 Electron safeStorage（底层：macOS Keychain / Windows DPAPI / Linux libsecret）
 * 加密后的密码以 "enc:" 前缀 + base64 存储，便于与明文密码兼容。
 */
import { safeStorage } from 'electron'

const ENC_PREFIX = 'enc:'

/** 判断字符串是否已经加密 */
export function isEncrypted(value: string | undefined): boolean {
  return !!value && value.startsWith(ENC_PREFIX)
}

/** 加密密码，返回 enc:<base64> 格式 */
export function encryptPassword(plain: string | undefined): string | undefined {
  if (!plain) return plain
  if (isEncrypted(plain)) return plain // 已经加密
  if (!safeStorage.isEncryptionAvailable()) return plain // 系统不支持加密
  try {
    const buf = safeStorage.encryptString(plain)
    return ENC_PREFIX + buf.toString('base64')
  } catch {
    return plain
  }
}

/** 解密密码 */
export function decryptPassword(encrypted: string | undefined): string | undefined {
  if (!encrypted) return encrypted
  if (!isEncrypted(encrypted)) return encrypted
  if (!safeStorage.isEncryptionAvailable()) return encrypted.slice(ENC_PREFIX.length) // fallback
  try {
    const buf = Buffer.from(encrypted.slice(ENC_PREFIX.length), 'base64')
    return safeStorage.decryptString(buf)
  } catch {
    return encrypted.slice(ENC_PREFIX.length) // fallback: strip prefix
  }
}
