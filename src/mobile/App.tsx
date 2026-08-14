import { useState, useEffect } from 'react'
import PairScreen from './components/PairScreen'
import ConnectionList from './components/ConnectionList'
import DatabaseBrowser from './components/DatabaseBrowser'
import QueryEditor from './components/QueryEditor'
import AiSql from './components/AiSql'
import { isAuthenticated } from './api'
import type { MobileConnection } from './api'

type Screen = 'pair' | 'connections' | 'browser' | 'query' | 'ai'

export default function App() {
  const [screen, setScreen] = useState<Screen>('pair')
  const [connection, setConnection] = useState<MobileConnection | null>(null)
  const [database, setDatabase] = useState<string | null>(null)

  useEffect(() => {
    if (isAuthenticated()) {
      setScreen('connections')
    }
  }, [])

  // 配对成功后
  const handlePaired = () => {
    setScreen('connections')
  }

  // 选择连接
  const handleSelectConnection = (conn: MobileConnection) => {
    setConnection(conn)
    if (conn.type === 'redis') {
      // Redis 直接进浏览
      setScreen('browser')
    } else {
      // MySQL 需要先选数据库
      setDatabase(conn.database || null)
      setScreen('browser')
    }
  }

  // 返回连接列表
  const handleBackToConnections = () => {
    setConnection(null)
    setDatabase(null)
    setScreen('connections')
  }

  // 底部导航
  const renderScreen = () => {
    switch (screen) {
      case 'pair':
        return <PairScreen onPaired={handlePaired} />
      case 'connections':
        return (
          <ConnectionList
            onSelect={handleSelectConnection}
            selectedId={connection?.id}
          />
        )
      case 'browser':
        return connection ? (
          <DatabaseBrowser
            connection={connection}
            database={database}
            onDatabaseChange={setDatabase}
            onBack={handleBackToConnections}
          />
        ) : null
      case 'query':
        return connection ? (
          <QueryEditor
            connection={connection}
            database={database}
            onBack={() => setScreen('browser')}
          />
        ) : null
      case 'ai':
        return connection ? (
          <AiSql
            connection={connection}
            database={database}
            onBack={() => setScreen('browser')}
          />
        ) : null
      default:
        return null
    }
  }

  // 配对页面
  if (screen === 'pair') {
    return <div className="min-h-screen safe-top">{renderScreen()}</div>
  }

  // 连接列表页面
  if (screen === 'connections') {
    return <div className="min-h-screen safe-top">{renderScreen()}</div>
  }

  // 主界面：顶部导航栏 + 内容区
  const tabs: { key: Screen; label: string }[] = [
    { key: 'browser', label: '浏览' },
    { key: 'query', label: '查询' },
    { key: 'ai', label: 'AI' }
  ]

  return (
    <div className="min-h-screen flex flex-col safe-top">
      {/* 顶部导航栏 */}
      <header className="flex-shrink-0 bg-bg-secondary border-b border-border-light">
        {/* 第一行：返回 + 连接信息 */}
        <div className="flex items-center gap-2 px-3 pt-2 pb-1.5">
          <button onClick={handleBackToConnections} className="p-1 -ml-1 text-text-muted">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </button>
          <span className="text-sm font-semibold text-text-primary truncate">{connection?.name}</span>
          {database && (
            <span className="text-[10px] text-text-muted px-1.5 py-0.5 bg-bg-tertiary rounded flex-shrink-0">
              {database}
            </span>
          )}
        </div>
        {/* 第二行：Tab 切换 */}
        <div className="flex items-center px-3">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setScreen(tab.key)}
              className={`flex-1 py-2.5 text-xs font-medium transition-colors relative ${
                screen === tab.key ? 'text-accent' : 'text-text-muted'
              }`}
            >
              {tab.label}
              {screen === tab.key && (
                <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-accent rounded-full" />
              )}
            </button>
          ))}
        </div>
      </header>

      {/* 内容区 */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {renderScreen()}
      </div>
    </div>
  )
}
