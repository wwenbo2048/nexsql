/**
 * window.api 的 Web 垫片 —— 在 DSH 面板 iframe 里替代 Electron preload。
 *
 * 原理：preload 的每个方法都是 ipcRenderer.invoke(channel, ...args)；
 * 垫片把调用转发为 POST /nexsql/rapi/<ns>/<method>（JSON body {args}），
 * Host 端（dsh-plugin/src/rapi.ts）用与 ipc.ts 相同的约定返回结果：
 *   - IpcResponse 方法：{ success, data? | error? }
 *   - 原始值方法（如 config.getConnections）：直接返回 JSON
 * 因此本文件不做任何形状转换，保持与 preload 行为一致。
 *
 * Electron 专属能力（on* 事件流、原生对话框、局域网服务器）在此降级：
 *   - 事件订阅 → 立即返回退订函数（阶段二接 SSE）
 *   - 保存对话框 → 浏览器下载
 *   - 打开对话框 → 返回 canceled
 *   - server/tunnel → 明确报错「仅在桌面应用可用」
 */
;(function () {
  if (window.api) return // 已有（Electron 环境）则不覆盖

  var RAPI = '/nexsql/rapi'

  function call(ns, method) {
    var args = Array.prototype.slice.call(arguments, 2)
    return fetch(RAPI + '/' + ns + '/' + method, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ args: args })
    }).then(function (res) {
      if (res.ok) return res.json()
      return res.text().catch(function () { return '' }).then(function (text) {
        return { success: false, error: text || 'HTTP ' + res.status }
      })
    })
  }

  function invoke(ns, method) {
    return function () {
      return call.apply(null, [ns, method].concat(Array.prototype.slice.call(arguments)))
    }
  }

  function noopUnsub() { return function () {} }

  /** 保存对话框 → 浏览器下载文件 */
  function saveDialog(defaultName, content, filterExt) {
    try {
      var blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
      var url = URL.createObjectURL(blob)
      var a = document.createElement('a')
      a.href = url
      a.download = defaultName || 'export.txt'
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(function () { URL.revokeObjectURL(url) }, 5000)
      return Promise.resolve({ success: true, data: { saved: true } })
    } catch (err) {
      return Promise.resolve({ success: false, error: String(err) })
    }
  }

  /** 浏览器文件选择 → 文本内容（取消返回 null） */
  function pickFileText(accept) {
    return new Promise(function (resolve) {
      var input = document.createElement('input')
      input.type = 'file'
      input.accept = accept || ''
      input.style.display = 'none'
      document.body.appendChild(input)
      var done = false
      var cleanup = function () {
        if (!done) { done = true; input.remove() }
      }
      input.addEventListener('change', function () {
        var file = input.files && input.files[0]
        if (!file) { cleanup(); resolve(null); return }
        var reader = new FileReader()
        reader.onload = function () { cleanup(); resolve(String(reader.result || '')) }
        reader.onerror = function () { cleanup(); resolve(null) }
        reader.readAsText(file, 'utf-8')
      })
      input.addEventListener('cancel', function () { cleanup(); resolve(null) })
      input.click()
    })
  }

  /** 内容 → 浏览器下载 */
  function downloadText(filename, content, mime) {
    var blob = new Blob([content], { type: mime || 'application/json;charset=utf-8' })
    var url = URL.createObjectURL(blob)
    var a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(function () { URL.revokeObjectURL(url) }, 5000)
  }

  /** 连接导入：浏览器选文件 → Host 合并（与桌面端同语义） */
  function importConnections() {
    return pickFileText('.json,application/json').then(function (content) {
      if (content === null) {
        return { success: true, data: { canceled: true, added: 0, updated: 0, skipped: 0, updatedIds: [] } }
      }
      return call('config', 'importConnectionsData', content)
    })
  }

  /** 连接导出：Host 生成载荷（明文，与桌面端同格式）→ 浏览器下载 */
  function exportConnections() {
    return call('config', 'exportConnectionsData').then(function (res) {
      if (!res.success || !res.data) return res
      downloadText(res.data.filename, res.data.content)
      return { success: true, data: { canceled: false, count: res.data.count } }
    })
  }

  var notInWeb = function () {
    return Promise.resolve({ success: false, error: '该功能仅在 nexSql 桌面应用中可用' })
  }

  var phase2 = function () {
    return Promise.resolve({ success: false, error: '此能力将在 DSH 面板的后续阶段接入' })
  }

  window.api = {
    appVersion: 'dsh-web',
    platform: 'darwin',

    config: {
      getConnections: invoke('config', 'getConnections'),
      saveConnection: invoke('config', 'saveConnection'),
      deleteConnection: invoke('config', 'deleteConnection'),
      exportConnections: exportConnections,
      importConnections: importConnections,
      exportMcp: invoke('config', 'exportMcp'),
      getMcpInfo: invoke('config', 'getMcpInfo')
    },

    db: {
      testConnection: invoke('db', 'testConnection'),
      connect: invoke('db', 'connect'),
      disconnect: invoke('db', 'disconnect'),
      query: invoke('db', 'query'),
      executeBatch: invoke('db', 'executeBatch'),
      onBatchProgress: noopUnsub,
      getDatabases: invoke('db', 'getDatabases'),
      getTables: invoke('db', 'getTables'),
      getTableColumns: invoke('db', 'getTableColumns'),
      getTableIndexes: invoke('db', 'getTableIndexes'),
      getTableRowCount: invoke('db', 'getTableRowCount'),
      getTableDDL: invoke('db', 'getTableDDL'),
      getForeignKeys: invoke('db', 'getForeignKeys'),
      getTableTriggers: invoke('db', 'getTableTriggers'),
      getTableOptions: invoke('db', 'getTableOptions'),
      getTableDetails: invoke('db', 'getTableDetails'),
      getViews: invoke('db', 'getViews'),
      getRoutines: invoke('db', 'getRoutines'),
      getEvents: invoke('db', 'getEvents'),
      getERRelations: invoke('db', 'getERRelations'),
      getERTableColumns: invoke('db', 'getERTableColumns'),
      getServerStatus: invoke('db', 'getServerStatus'),
      dumpDatabase: phase2,
      restoreDatabase: phase2,
      cancelOperation: function () { return Promise.resolve() },
      onBackupProgress: noopUnsub,
      onRestoreProgress: noopUnsub
    },

    file: {
      saveDialog: saveDialog,
      savePathDialog: function () {
        return Promise.resolve({ success: true, data: { canceled: true } })
      },
      writeToFile: phase2,
      openDialog: function () {
        return Promise.resolve({ success: true, data: { canceled: true, content: '' } })
      }
    },

    ai: {
      getSettings: invoke('ai', 'getSettings'),
      setSettings: invoke('ai', 'setSettings'),
      validateApiKey: phase2,
      generateSql: phase2,
      cancelGenerate: function () { return Promise.resolve() },
      onStreamChunk: noopUnsub,
      getConversations: invoke('ai', 'getConversations'),
      getConversation: invoke('ai', 'getConversation'),
      createConversation: invoke('ai', 'createConversation'),
      saveConversation: invoke('ai', 'saveConversation'),
      deleteConversation: invoke('ai', 'deleteConversation'),
      clearConversations: invoke('ai', 'clearConversations')
    },

    cache: {
      clearCache: function () { return Promise.resolve(true) }
    },

    server: { start: notInWeb, stop: notInWeb, status: notInWeb, refreshPairCode: notInWeb },
    tunnel: { getConfig: notInWeb, saveConfig: notInWeb, start: notInWeb, stop: notInWeb, status: notInWeb },

    redis: {
      testConnection: invoke('redis', 'testConnection'),
      connect: invoke('redis', 'connect'),
      disconnect: invoke('redis', 'disconnect'),
      dbsize: invoke('redis', 'dbsize'),
      scan: invoke('redis', 'scan'),
      getKey: invoke('redis', 'getKey'),
      setKey: invoke('redis', 'setKey'),
      deleteKey: invoke('redis', 'deleteKey'),
      batchDeleteKeys: invoke('redis', 'batchDeleteKeys'),
      setTtl: invoke('redis', 'setTtl'),
      rename: invoke('redis', 'rename'),
      command: invoke('redis', 'command')
    }
  }
})()
