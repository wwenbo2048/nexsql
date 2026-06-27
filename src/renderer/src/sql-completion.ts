import type * as MonacoType from 'monaco-editor'

// ==================== SQL 关键字列表 ====================

const SQL_KEYWORDS = [
  'SELECT', 'FROM', 'WHERE', 'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET',
  'DELETE', 'CREATE', 'ALTER', 'DROP', 'TABLE', 'DATABASE', 'INDEX', 'VIEW',
  'FUNCTION', 'PROCEDURE', 'TRIGGER', 'EVENT', 'IF', 'EXISTS', 'NOT', 'NULL',
  'AND', 'OR', 'LIKE', 'IN', 'BETWEEN', 'IS', 'AS', 'ON', 'JOIN', 'LEFT',
  'RIGHT', 'INNER', 'OUTER', 'FULL', 'CROSS', 'GROUP', 'BY', 'ORDER', 'ASC',
  'DESC', 'HAVING', 'LIMIT', 'OFFSET', 'UNION', 'ALL', 'DISTINCT', 'CASE',
  'WHEN', 'THEN', 'ELSE', 'END', 'BEGIN', 'COMMIT', 'ROLLBACK', 'TRANSACTION',
  'PRIMARY', 'KEY', 'FOREIGN', 'REFERENCES', 'CONSTRAINT', 'UNIQUE', 'CHECK',
  'DEFAULT', 'AUTO_INCREMENT', 'COMMENT', 'ENGINE', 'CHARSET', 'COLLATE',
  'INT', 'BIGINT', 'TINYINT', 'SMALLINT', 'MEDIUMINT', 'VARCHAR', 'CHAR',
  'TEXT', 'MEDIUMTEXT', 'LONGTEXT', 'BLOB', 'MEDIUMBLOB', 'LONGBLOB',
  'DECIMAL', 'FLOAT', 'DOUBLE', 'DATE', 'DATETIME', 'TIMESTAMP', 'TIME',
  'YEAR', 'JSON', 'ENUM', 'BIT', 'BOOLEAN',
  'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'COALESCE', 'IFNULL', 'NULLIF',
  'CONCAT', 'SUBSTRING', 'REPLACE', 'TRIM', 'UPPER', 'LOWER', 'LENGTH',
  'NOW', 'CURDATE', 'CURTIME', 'DATE_FORMAT', 'DATEDIFF', 'DATE_ADD',
  'CAST', 'CONVERT', 'EXPLAIN', 'SHOW', 'DESCRIBE', 'USE', 'GRANT', 'REVOKE',
  'TRUNCATE', 'RENAME', 'ADD', 'COLUMN', 'MODIFY', 'CHANGE', 'AFTER', 'FIRST',
  'WITH', 'RECURSIVE', 'OVER', 'PARTITION', 'ROW_NUMBER', 'RANK', 'DENSE_RANK',
  'FETCH', 'NEXT', 'ROWS', 'ONLY', 'FOR', 'EACH', 'ROW', 'BEFORE', 'AFTER',
  'REPLACE', 'IGNORE', 'DUPLICATE', 'OPTIMIZE', 'ANALYZE', 'REPAIR',
  'START', 'SAVEPOINT', 'RELEASE', 'LOCK', 'UNLOCK', 'TABLES', 'READ', 'WRITE'
]

const SQL_SNIPPETS = [
  {
    label: 'SELECT *',
    insertText: 'SELECT * FROM ${1:table_name} WHERE ${2:condition} LIMIT ${3:100};',
    detail: '查询所有列',
    documentation: 'SELECT * FROM table WHERE condition LIMIT n'
  },
  {
    label: 'INSERT INTO',
    insertText: 'INSERT INTO ${1:table_name} (${2:columns}) VALUES (${3:values});',
    detail: '插入数据',
    documentation: 'INSERT INTO table (col1, col2) VALUES (val1, val2)'
  },
  {
    label: 'UPDATE SET',
    insertText: 'UPDATE ${1:table_name} SET ${2:column} = ${3:value} WHERE ${4:condition};',
    detail: '更新数据',
    documentation: 'UPDATE table SET col = val WHERE condition'
  },
  {
    label: 'DELETE FROM',
    insertText: 'DELETE FROM ${1:table_name} WHERE ${2:condition};',
    detail: '删除数据',
    documentation: 'DELETE FROM table WHERE condition'
  },
  {
    label: 'CREATE TABLE',
    insertText: [
      'CREATE TABLE ${1:table_name} (',
      '  `id` BIGINT NOT NULL AUTO_INCREMENT,',
      '  ${2:column_name} ${3:VARCHAR(255)},',
      '  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,',
      '  PRIMARY KEY (`id`)',
      ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT=\'${4:注释}\';'
    ].join('\n'),
    detail: '创建新表',
    documentation: 'CREATE TABLE with common columns'
  },
  {
    label: 'LEFT JOIN',
    insertText: 'LEFT JOIN ${1:table_name} ON ${2:condition}',
    detail: '左连接',
    documentation: 'LEFT JOIN table ON a.id = b.foreign_id'
  },
  {
    label: 'GROUP BY HAVING',
    insertText: 'GROUP BY ${1:column} HAVING ${2:condition}',
    detail: '分组聚合',
    documentation: 'GROUP BY column HAVING COUNT(*) > n'
  },
  {
    label: 'CASE WHEN',
    insertText: 'CASE\n  WHEN ${1:condition} THEN ${2:result}\n  ELSE ${3:default}\nEND',
    detail: '条件表达式',
    documentation: 'CASE WHEN cond THEN val ELSE default END'
  },
  {
    label: 'EXPLAIN SELECT',
    insertText: 'EXPLAIN SELECT * FROM ${1:table_name} WHERE ${2:condition};',
    detail: '执行计划分析',
    documentation: 'EXPLAIN SELECT ...'
  }
]

// ==================== 上下文数据（表名 + 字段名） ====================

interface CompletionContext {
  tables: string[]
  /** 表名 -> 字段名列表 */
  columns: Record<string, string[]>
  /** 当前数据库（用于优先显示相关表） */
  database?: string
}

let completionContext: CompletionContext = { tables: [], columns: {} }

/**
 * 更新补全上下文。应在数据库切换或表列表刷新时调用。
 */
export function setCompletionContext(ctx: CompletionContext): void {
  completionContext = ctx
}

/**
 * 获取当前补全上下文（供外部读取）。
 */
export function getCompletionContext(): CompletionContext {
  return completionContext
}

// ==================== 异步加载字段的回调 ====================

type LoadColumnsFn = (table: string) => Promise<string[]>
let loadColumnsFn: LoadColumnsFn | null = null

/**
 * 注册异步加载字段的回调函数。当补全引擎遇到未知表的字段需求时调用。
 */
export function setLoadColumnsFn(fn: LoadColumnsFn): void {
  loadColumnsFn = fn
}

// ==================== SQL 解析辅助函数 ====================

interface TableRef {
  table: string   // 真实表名
  alias?: string  // 别名（可选）
}

const SQL_KW_SET = new Set(SQL_KEYWORDS.map(k => k.toUpperCase()))

/**
 * 从 SQL 文本中解析 FROM / JOIN 子句，提取表名和别名。
 * 支持：FROM table, FROM table alias, FROM table AS alias,
 *       JOIN table alias, JOIN table AS alias
 */
function parseTableRefs(sql: string): TableRef[] {
  const refs: TableRef[] = []
  const seen = new Set<string>()

  // 将 SQL 压缩为单行，移除多余空格
  const normalized = sql.replace(/\s+/g, ' ').trim()

  // 匹配 FROM/JOIN 后面的表引用
  // 支持：`table`, table, `table` alias, table alias, `table` AS alias, table AS alias
  const pattern = /\b(?:FROM|JOIN)\s+`?(\w+)`?(?:\s+(?:AS\s+)?`?(\w+)`?)?/gi
  let match: RegExpExecArray | null

  while ((match = pattern.exec(normalized)) !== null) {
    const tableName = match[1]
    let alias = match[2] ?? ''

    // 过滤掉 SQL 关键字被误识别为别名的情况
    if (alias && SQL_KW_SET.has(alias.toUpperCase())) {
      alias = ''
    }

    const key = alias ? `${tableName}:${alias}` : tableName
    if (!seen.has(key)) {
      seen.add(key)
      refs.push({ table: tableName, alias: alias || undefined })
    }
  }

  // 也解析 FROM table1, table2 的多表逗号分隔形式
  const fromMultiPattern = /\bFROM\s+([^;]*?)(?:\bWHERE\b|\bGROUP\b|\bORDER\b|\bLIMIT\b|\bHAVING\b|\bUNION\b|$)/gi
  let fromMatch: RegExpExecArray | null
  while ((fromMatch = fromMultiPattern.exec(normalized)) !== null) {
    const fromClause = fromMatch[1]
    // 按逗号拆分
    const parts = fromClause.split(',')
    parts.forEach((part, idx) => {
      // 第一个已经由上面的 FROM 正则处理了，只处理逗号后面的
      if (idx === 0) return
      const trimmed = part.trim()
      const tableAliasMatch = trimmed.match(/^`?(\w+)`?(?:\s+(?:AS\s+)?`?(\w+)`?)?/)
      if (tableAliasMatch) {
        const tableName = tableAliasMatch[1]
        let alias = tableAliasMatch[2] ?? ''
        if (alias && SQL_KW_SET.has(alias.toUpperCase())) {
          alias = ''
        }
        const key = alias ? `${tableName}:${alias}` : tableName
        if (!seen.has(key)) {
          seen.add(key)
          refs.push({ table: tableName, alias: alias || undefined })
        }
      }
    })
  }

  return refs
}

/**
 * 获取光标所在语句的 SQL 文本（从上一个分号或文本开头到光标位置）。
 */
function getCurrentStatement(model: MonacoType.editor.ITextModel, position: MonacoType.Position): string {
  const fullText = model.getValueInRange({
    startLineNumber: 1,
    startColumn: 1,
    endLineNumber: position.lineNumber,
    endColumn: position.column
  })
  // 找到最后一个分号，取其后的文本作为当前语句
  const lastSemicolon = fullText.lastIndexOf(';')
  return lastSemicolon >= 0 ? fullText.substring(lastSemicolon + 1) : fullText
}

/**
 * 根据别名或表名查找对应的真实表名。
 */
function resolveTableFromIdentifier(identifier: string, tableRefs: TableRef[]): string | null {
  const lowerId = identifier.toLowerCase()
  // 先精确匹配别名
  for (const ref of tableRefs) {
    if (ref.alias && ref.alias.toLowerCase() === lowerId) {
      return ref.table
    }
  }
  // 再匹配表名（大小写不敏感）
  for (const ref of tableRefs) {
    if (ref.table.toLowerCase() === lowerId) {
      return ref.table
    }
  }
  return null
}

// ==================== 注册补全 Provider ====================

let registered = false

/**
 * 注册 SQL 补全 Provider（仅注册一次）。
 */
export function registerSqlCompletionProvider(monaco: typeof MonacoType): void {
  if (registered) return
  registered = true

  monaco.languages.registerCompletionItemProvider('sql', {
    triggerCharacters: ['.', ' ', '`'],

    provideCompletionItems(
      model: MonacoType.editor.ITextModel,
      position: MonacoType.Position,
      _context: MonacoType.languages.CompletionContext,
      _token: MonacoType.CancellationToken
    ): MonacoType.languages.ProviderResult<MonacoType.languages.CompletionList> {
      const wordInfo = model.getWordUntilPosition(position)
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: wordInfo.startColumn,
        endColumn: wordInfo.endColumn
      }

      const lineContent = model.getLineContent(position.lineNumber)
      const textBeforeCursor = lineContent.substring(0, position.column - 1)

      // 获取当前语句（用于解析 FROM/JOIN）
      const currentStmt = getCurrentStatement(model, position)
      const tableRefs = parseTableRefs(currentStmt)

      const suggestions: MonacoType.languages.CompletionItem[] = []

      // ==================== A. 点号（.）触发：精确字段补全 ====================
      const dotMatch = textBeforeCursor.match(/`?(\w+)`?\.\s*`?(\w*)$/)
      if (dotMatch) {
        const identifier = dotMatch[1]
        // 尝试从语句中的别名/表名解析
        let resolvedTable = resolveTableFromIdentifier(identifier, tableRefs)
        // 尝试直接从已知表中匹配
        if (!resolvedTable) {
          const lowerId = identifier.toLowerCase()
          resolvedTable = completionContext.tables.find(t => t.toLowerCase() === lowerId) ?? null
        }
        // 尝试从 columns 缓存中匹配
        if (!resolvedTable && completionContext.columns[identifier]) {
          resolvedTable = identifier
        }

        if (resolvedTable) {
          const columns = completionContext.columns[resolvedTable]
          if (!columns || columns.length === 0) {
            // 触发异步加载
            if (loadColumnsFn) {
              loadColumnsFn(resolvedTable).catch(() => {})
            }
          } else {
            columns.forEach((col) => {
              suggestions.push({
                label: col,
                kind: monaco.languages.CompletionItemKind.Field,
                insertText: `\`${col}\``,
                filterText: col,
                range,
                sortText: `0_${col}`,
                detail: `字段 (${resolvedTable!})`,
              })
            })
          }

          // 点号触发时只返回字段，不返回关键字和表名
          return { suggestions }
        }

        // 即使未解析到表，如果只有一张表有字段缓存，返回该表字段
        const knownTables = Object.keys(completionContext.columns)
        if (knownTables.length === 1) {
          const cols = completionContext.columns[knownTables[0]]
          cols.forEach((col) => {
            suggestions.push({
              label: col,
              kind: monaco.languages.CompletionItemKind.Field,
              insertText: `\`${col}\``,
              filterText: col,
              range,
              sortText: `0_${col}`,
              detail: `字段 (${knownTables[0]})`,
            })
          })
          return { suggestions }
        }
      }

      // ==================== B. 常规补全（非点号触发） ====================

      // 检测是否在 FROM / JOIN / INTO / UPDATE / TABLE 后面（需要表名补全）
      const needsTable = /\b(FROM|JOIN|INTO|UPDATE|TABLE|TRUNCATE|OPTIMIZE|ANALYZE)\s+`?[\w]*$/i.test(textBeforeCursor)

      // 检测是否在 SELECT / WHERE / SET / ON / BY / AND / OR 后面（需要字段名补全）
      const needsColumn = /\b(SELECT|WHERE|SET|ON|BY|AND|OR|HAVING|,)\s+`?[\w]*$/i.test(textBeforeCursor)

      // 1. 表名补全
      if (needsTable || !needsColumn) {
        completionContext.tables.forEach((table, idx) => {
          suggestions.push({
            label: table,
            kind: monaco.languages.CompletionItemKind.Struct,
            insertText: `\`${table}\``,
            filterText: table,
            range,
            sortText: `0_${String(idx).padStart(4, '0')}_${table}`,
            detail: '表',
          })
        })
      }

      // 2. 字段名补全（智能排序：当前语句引用的表字段优先）
      if (needsColumn || !needsTable) {
        // 收集当前语句中引用的所有表
        const referencedTables = new Set<string>()
        tableRefs.forEach((ref) => {
          const tableName = completionContext.tables.find(
            (t) => t.toLowerCase() === ref.table.toLowerCase()
          )
          if (tableName) referencedTables.add(tableName)
        })

        // 优先显示当前语句中引用表的字段
        const prioritizedColumns: MonacoType.languages.CompletionItem[] = []
        const otherColumns: MonacoType.languages.CompletionItem[] = []

        Object.entries(completionContext.columns).forEach(([tbl, cols]) => {
          const isReferenced = referencedTables.has(tbl)
          cols.forEach((col) => {
            const item: MonacoType.languages.CompletionItem = {
              label: col,
              kind: monaco.languages.CompletionItemKind.Field,
              insertText: `\`${col}\``,
              filterText: col,
              range,
              sortText: isReferenced ? `1_${col}` : `2_${col}`,
              detail: `字段 (${tbl})`,
            }
            if (isReferenced) {
              prioritizedColumns.push(item)
            } else {
              otherColumns.push(item)
            }
          })
        })

        // 如果只有一张表且没有通过别名引用，也将其字段优先
        if (prioritizedColumns.length === 0 && referencedTables.size === 0 && tableRefs.length === 1) {
          const singleTable = completionContext.tables.find(
            (t) => t.toLowerCase() === tableRefs[0].table.toLowerCase()
          )
          if (singleTable && completionContext.columns[singleTable]) {
            completionContext.columns[singleTable].forEach((col) => {
              prioritizedColumns.push({
                label: col,
                kind: monaco.languages.CompletionItemKind.Field,
                insertText: `\`${col}\``,
                filterText: col,
                range,
                sortText: `1_${col}`,
                detail: `字段 (${singleTable})`,
              })
            })
          }
        }

        // 去重（同名字段只保留优先级最高的）
        const seenCols = new Set<string>()
        const addUnique = (items: MonacoType.languages.CompletionItem[]) => {
          items.forEach((item) => {
            const label = item.label as string
            if (!seenCols.has(label)) {
              seenCols.add(label)
              suggestions.push(item)
            }
          })
        }
        addUnique(prioritizedColumns)
        addUnique(otherColumns)
      }

      // 3. SQL 关键字补全
      SQL_KEYWORDS.forEach((kw) => {
        suggestions.push({
          label: kw,
          kind: monaco.languages.CompletionItemKind.Keyword,
          insertText: kw,
          filterText: kw,
          range,
          sortText: `3_${kw}`,
          detail: '关键字',
        })
        // 同时添加小写版本
        suggestions.push({
          label: kw.toLowerCase(),
          kind: monaco.languages.CompletionItemKind.Keyword,
          insertText: kw.toLowerCase(),
          filterText: kw.toLowerCase(),
          range,
          sortText: `3_${kw.toLowerCase()}`,
          detail: '关键字',
        })
      })

      // 4. SQL 片段补全
      SQL_SNIPPETS.forEach((snippet) => {
        suggestions.push({
          label: snippet.label,
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: snippet.insertText,
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          filterText: snippet.label,
          range,
          sortText: `4_${snippet.label}`,
          detail: snippet.detail,
          documentation: snippet.documentation,
        })
      })

      return { suggestions }
    }
  })
}
