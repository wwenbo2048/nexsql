import { useState } from 'react'
import ColumnsEditor from './editors/ColumnsEditor'
import IndexesEditor from './editors/IndexesEditor'
import ForeignKeysEditor from './editors/ForeignKeysEditor'
import TriggersEditor from './editors/TriggersEditor'
import TableOptionsEditor from './editors/TableOptionsEditor'

interface Props {
  connectionId: string
  database: string
  table: string
}

type SubTab = 'columns' | 'indexes' | 'foreignKeys' | 'triggers' | 'options'

export default function StructureEditor({ connectionId, database, table }: Props) {
  const [subTab, setSubTab] = useState<SubTab>('columns')

  const tabs: { key: SubTab; label: string }[] = [
    { key: 'columns', label: '字段' },
    { key: 'indexes', label: '索引' },
    { key: 'foreignKeys', label: '外键' },
    { key: 'triggers', label: '触发器' },
    { key: 'options', label: '表选项' }
  ]

  return (
    <div className="flex flex-col h-full">
      {/* 子标签栏 */}
      <div className="flex items-center border-b border-border-light bg-bg-secondary flex-shrink-0">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setSubTab(t.key)}
            className={`px-3 py-1.5 text-xs font-medium transition-colors border-b-2 ${
              subTab === t.key
                ? 'text-text-primary border-accent bg-bg-primary'
                : 'text-text-secondary border-transparent hover:text-text-primary'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* 子内容区 */}
      <div className="flex-1 overflow-hidden">
        {subTab === 'columns' && (
          <ColumnsEditor connectionId={connectionId} database={database} table={table} />
        )}
        {subTab === 'indexes' && (
          <IndexesEditor connectionId={connectionId} database={database} table={table} />
        )}
        {subTab === 'foreignKeys' && (
          <ForeignKeysEditor connectionId={connectionId} database={database} table={table} />
        )}
        {subTab === 'triggers' && (
          <TriggersEditor connectionId={connectionId} database={database} table={table} />
        )}
        {subTab === 'options' && (
          <TableOptionsEditor connectionId={connectionId} database={database} table={table} />
        )}
      </div>
    </div>
  )
}
