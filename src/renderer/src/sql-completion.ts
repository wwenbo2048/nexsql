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

      const suggestions: MonacoType.languages.CompletionItem[] = []

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

      // 2. 字段名补全
      if (needsColumn || !needsTable) {
        const allColumns = new Set<string>()
        Object.values(completionContext.columns).forEach((cols) => {
          cols.forEach((col) => allColumns.add(col))
        })
        allColumns.forEach((col) => {
          // 找出字段属于哪些表
          const ownerTables: string[] = []
          Object.entries(completionContext.columns).forEach(([tbl, cols]) => {
            if (cols.includes(col)) ownerTables.push(tbl)
          })
          suggestions.push({
            label: col,
            kind: monaco.languages.CompletionItemKind.Field,
            insertText: `\`${col}\``,
            filterText: col,
            range,
            sortText: `1_${col}`,
            detail: ownerTables.length > 0 ? `字段 (${ownerTables.join(', ')})` : '字段',
          })
        })
      }

      // 3. SQL 关键字补全
      SQL_KEYWORDS.forEach((kw) => {
        suggestions.push({
          label: kw,
          kind: monaco.languages.CompletionItemKind.Keyword,
          insertText: kw,
          filterText: kw,
          range,
          sortText: `2_${kw}`,
          detail: '关键字',
        })
        // 同时添加小写版本
        suggestions.push({
          label: kw.toLowerCase(),
          kind: monaco.languages.CompletionItemKind.Keyword,
          insertText: kw.toLowerCase(),
          filterText: kw.toLowerCase(),
          range,
          sortText: `2_${kw.toLowerCase()}`,
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
          sortText: `3_${snippet.label}`,
          detail: snippet.detail,
          documentation: snippet.documentation,
        })
      })

      return { suggestions }
    }
  })
}
