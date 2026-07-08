const fs = require('fs')
const path = require('path')

const src = path.join(__dirname, '..', 'src', 'mcp', 'launcher.cjs')
const destDir = path.join(__dirname, '..', 'out', 'mcp')
const dest = path.join(destDir, 'launcher.cjs')

if (!fs.existsSync(destDir)) {
  fs.mkdirSync(destDir, { recursive: true })
}

fs.copyFileSync(src, dest)
console.log('[MCP] Copied launcher.cjs → out/mcp/')
