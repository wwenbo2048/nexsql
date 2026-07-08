#!/usr/bin/env node
/**
 * MCP Launcher
 *
 * Sets up NODE_PATH so the bundled MCP server can find external
 * dependencies (mysql2, ioredis, ssh2) in the app's Resources/node_modules.
 *
 * Packaged location: Contents/Resources/mcp/launcher.cjs
 * node_modules:      Contents/Resources/node_modules/
 */
const path = require('path')

// In packaged app: launcher is at Resources/mcp/launcher.cjs
// node_modules is at Resources/node_modules/
const resourcesDir = path.join(__dirname, '..', '..')
const nodeModulesPath = path.join(resourcesDir, 'node_modules')

// Add node_modules to module resolution paths
const fs = require('fs')
if (fs.existsSync(nodeModulesPath)) {
  module.paths.unshift(nodeModulesPath)
}

// Load the bundled MCP server
require('./index.js')
