import { type JSX } from 'react'

// SQL 关键字列表
const SQL_KEYWORDS = new Set([
  'CREATE', 'TABLE', 'ALTER', 'ADD', 'DROP', 'MODIFY', 'COLUMN', 'INDEX', 'KEY',
  'PRIMARY', 'UNIQUE', 'FOREIGN', 'REFERENCES', 'NOT', 'NULL', 'DEFAULT',
  'AUTO_INCREMENT', 'COMMENT', 'CHARSET', 'CHARACTER', 'SET', 'COLLATE',
  'ENGINE', 'IF', 'EXISTS', 'CONSTRAINT', 'ON', 'UPDATE', 'DELETE', 'INSERT',
  'INTO', 'VALUES', 'SELECT', 'FROM', 'WHERE', 'JOIN', 'LEFT', 'RIGHT', 'INNER',
  'OUTER', 'GROUP', 'BY', 'ORDER', 'HAVING', 'LIMIT', 'OFFSET', 'AS', 'AND',
  'OR', 'IN', 'BETWEEN', 'LIKE', 'IS', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END',
  'BEGIN', 'TRIGGER', 'BEFORE', 'AFTER', 'EACH', 'ROW', 'FOR',
  'PROCEDURE', 'FUNCTION', 'RETURNS', 'DECLARE', 'CALL', 'VIEW',
  'CHECK', 'CASCADE', 'RESTRICT', 'UNION', 'ALL', 'DISTINCT',
  'ROW_FORMAT', 'DYNAMIC', 'COMPACT', 'REDUNDANT', 'COMPRESSED',
  'PARTITION', 'PARTITIONS', 'SUBPARTITION'
])

// 数据类型
const SQL_TYPES = new Set([
  'INT', 'TINYINT', 'SMALLINT', 'MEDIUMINT', 'BIGINT', 'DECIMAL', 'NUMERIC',
  'FLOAT', 'DOUBLE', 'BIT', 'BOOLEAN', 'BOOL', 'SERIAL',
  'DATE', 'DATETIME', 'TIMESTAMP', 'TIME', 'YEAR',
  'CHAR', 'VARCHAR', 'BINARY', 'VARBINARY',
  'TINYTEXT', 'TEXT', 'MEDIUMTEXT', 'LONGTEXT',
  'TINYBLOB', 'BLOB', 'MEDIUMBLOB', 'LONGBLOB',
  'ENUM', 'SET', 'JSON', 'GEOMETRY', 'POINT', 'LINESTRING', 'POLYGON'
])

type Token = { type: 'keyword' | 'type' | 'string' | 'backtick' | 'number' | 'comment' | 'function' | 'punctuation' | 'text'; value: string }

function tokenizeSql(sql: string): Token[] {
  const tokens: Token[] = []
  let i = 0

  while (i < sql.length) {
    const remaining = sql.slice(i)

    // 多行注释 /* */
    const blockComment = remaining.match(/^\/\*[\s\S]*?\*\//)
    if (blockComment) {
      tokens.push({ type: 'comment', value: blockComment[0] })
      i += blockComment[0].length
      continue
    }

    // 单行注释 -- 或 #
    const lineComment = remaining.match(/^(--|#)[^\n]*/)
    if (lineComment) {
      tokens.push({ type: 'comment', value: lineComment[0] })
      i += lineComment[0].length
      continue
    }

    // 字符串 '...'
    const str = remaining.match(/^'(?:[^'\\]|\\.)*'?/)
    if (str && str[0].startsWith("'")) {
      tokens.push({ type: 'string', value: str[0] })
      i += str[0].length
      continue
    }

    // 反引号标识符 `...`
    const backtick = remaining.match(/^`[^`]*`?/)
    if (backtick && backtick[0].startsWith('`')) {
      tokens.push({ type: 'backtick', value: backtick[0] })
      i += backtick[0].length
      continue
    }

    // 数字
    const num = remaining.match(/^\d+\.?\d*/)
    if (num) {
      tokens.push({ type: 'number', value: num[0] })
      i += num[0].length
      continue
    }

    // 大写标识符（关键字或类型）
    const upperWord = remaining.match(/^[A-Z_]{2,}/)
    if (upperWord) {
      const word = upperWord[0]
      if (SQL_KEYWORDS.has(word)) {
        tokens.push({ type: 'keyword', value: word })
      } else if (SQL_TYPES.has(word)) {
        tokens.push({ type: 'type', value: word })
      } else {
        tokens.push({ type: 'text', value: word })
      }
      i += word.length
      continue
    }

    // 标点
    const punct = remaining.match(/^[()[\]{};,=<>!+\-*/%&|^~?:.@]+/)
    if (punct) {
      tokens.push({ type: 'punctuation', value: punct[0] })
      i += punct[0].length
      continue
    }

    // 其他字符（空格、换行、普通字母等）
    const other = remaining.match(/^[^'`/*\-#()[\]{};,=<>!+\-*/%&|^~?@0-9]+/)
    if (other) {
      tokens.push({ type: 'text', value: other[0] })
      i += other[0].length
      continue
    }

    // 兜底：单字符
    tokens.push({ type: 'text', value: sql[i] })
    i++
  }

  return tokens
}

const TOKEN_COLORS: Record<Token['type'], string> = {
  keyword: 'text-pink-400',
  type: 'text-sky-400',
  string: 'text-emerald-400',
  backtick: 'text-amber-300',
  number: 'text-orange-400',
  comment: 'text-gray-500 italic',
  function: 'text-violet-400',
  punctuation: 'text-text-muted',
  text: 'text-text-primary'
}

export function SqlHighlight({ sql, className = '' }: { sql: string; className?: string }): JSX.Element {
  const tokens = tokenizeSql(sql)
  return (
    <code className={className}>
      {tokens.map((token, idx) => (
        <span key={idx} className={TOKEN_COLORS[token.type]}>{token.value}</span>
      ))}
    </code>
  )
}

export default SqlHighlight
