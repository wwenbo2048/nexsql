### 1. 核心机制：统一响应契约 (IpcResponse)
该应用采用 Electron 架构，主进程（Main）与渲染进程（Renderer）之间通过 IPC 通信。错误处理的核心在于定义了一个统一的响应接口 `IpcResponse<T>`：

```typescript
export interface IpcResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
}
```

所有涉及数据库操作或配置管理的 IPC 调用均遵循此契约。主进程不直接抛出异常导致渲染进程崩溃，而是捕获所有异常并将其转换为包含 `success: false` 和 `error` 消息的对象。

### 2. 错误传播链路
1. **主进程服务层 (`src/main/services/db.ts`)**：
   - 底层使用 `mysql2` 库。该层函数（如 `executeQuery`, `connect`）通常直接抛出原生 `Error` 或使用 `try/finally` 确保资源（连接池）释放。
   - 该层不负责 UI 层面的错误格式化，仅负责业务逻辑执行和资源管理。

2. **IPC 桥接层 (`src/main/ipc.ts`)**：
   - 这是错误处理的关键边界。每个 `ipcMain.handle` 注册的处理函数都包裹在 `try/catch` 块中。
   - **捕获策略**：捕获任何从服务层抛出的异常，提取其 `message` 属性，并返回 `{ success: false, error: err.message }`。
   - **成功策略**：操作成功时返回 `{ success: true, data: ... }`。

3. **预加载脚本 (`src/preload/index.ts`)**：
   - 通过 `contextBridge` 将 IPC 调用暴露给渲染进程。它透传主进程返回的 `IpcResponse` 对象，不进行额外的错误转换。

4. **渲染进程 UI 层 (`src/renderer/src/components/*.tsx`)**：
   - 组件在调用 API 后，检查返回对象的 `success` 字段。
   - **状态管理**：使用 Zustand store (`connection.ts`) 维护全局的 `errors` 记录，将错误信息与特定的连接 ID 关联。
   - **视觉反馈**：
     - **连接测试**：在 `ConnectionModal` 中，根据 `testResult.ok` 显示绿色（成功）或红色（失败）的提示框，并展示具体的错误消息。
     - **SQL 查询**：在 `QueryEditor` 中，如果 `res.success` 为假，则将错误信息存储在本地 state `error` 中，并在结果面板以红色警告图标和等宽字体展示 SQL 错误详情。

### 3. 关键设计决策
- **错误字符串化**：跨进程通信时，复杂的 Error 对象被简化为字符串消息。这避免了序列化问题，但也意味着堆栈跟踪信息在主进程中丢失（除非专门记录日志）。
- **无自定义错误类**：目前代码库中未定义专门的 `DatabaseError` 或 `ConnectionError` 类，而是依赖 `mysql2` 的原生错误消息。这使得错误处理较为通用，但缺乏结构化的错误码支持。
- **资源安全**：在 `db.ts` 中，广泛使用 `try/finally` 确保 `conn.release()` 被调用，防止因错误导致的连接泄漏。

### 4. 开发者规范
- **IPC 处理器必须捕获异常**：在 `src/main/ipc.ts` 中添加新的 `ipcMain.handle` 时，必须使用 `try/catch` 包裹异步逻辑，并确保返回符合 `IpcResponse` 结构的对象。
- **UI 层检查 success 标志**：渲染进程在调用 `window.api.*` 时，严禁假设调用一定成功。必须先判断 `res.success`，再决定是更新数据状态还是展示错误 UI。
- **错误消息展示**：对于 SQL 执行错误，应保留原始错误消息的格式（如使用 `<pre>` 标签），以便开发者阅读详细的 MySQL 报错信息。