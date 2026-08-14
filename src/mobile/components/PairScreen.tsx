import { useState } from 'react'
import { pair, setToken } from '../api'

export default function PairScreen({ onPaired }: { onPaired: () => void }) {
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = code.trim()
    if (trimmed.length !== 6) {
      setError('请输入 6 位配对码')
      return
    }

    setLoading(true)
    setError(null)
    const res = await pair(trimmed)
    setLoading(false)

    if (res.success && res.data) {
      setToken(res.data.token)
      onPaired()
    } else {
      setError(res.error ?? '配对失败')
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-8">
      {/* Logo */}
      <div className="flex items-center gap-2 mb-12">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2">
          <ellipse cx="12" cy="5" rx="9" ry="3" />
          <path d="M3 5v14a9 3 0 0 0 18 0V5" />
          <path d="M3 12a9 3 0 0 0 18 0" />
        </svg>
        <span className="text-xl font-bold">nexSql</span>
      </div>

      <div className="w-full max-w-xs">
        <p className="text-sm text-text-secondary text-center mb-6">
          请在电脑端 nexSql 的「局域网访问」中查看配对码
        </p>

        <form onSubmit={handleSubmit}>
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            placeholder="请输入 6 位配对码"
            className="w-full text-center text-2xl tracking-[0.5em] font-mono px-4 py-4 bg-bg-secondary border border-border-light rounded-lg text-text-primary placeholder:text-text-muted placeholder:tracking-normal placeholder:text-sm focus:outline-none focus:border-accent"
            autoFocus
          />

          {error && (
            <p className="text-xs text-red-400 text-center mt-3">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading || code.length !== 6}
            className="w-full mt-6 py-3.5 bg-accent text-white text-sm font-medium rounded-lg disabled:opacity-40 transition-opacity active:scale-[0.98]"
          >
            {loading ? '配对中...' : '配对'}
          </button>
        </form>
      </div>
    </div>
  )
}
