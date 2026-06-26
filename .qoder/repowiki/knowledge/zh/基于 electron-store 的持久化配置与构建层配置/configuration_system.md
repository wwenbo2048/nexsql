## 1. 系统概述
NexSql 采用分层配置策略，将**应用运行时配置**（如数据库连接信息）与**工程构建配置**（如打包选项、路径别名）分离。核心运行时配置通过 `electron-store` 实现本地持久化，而开发/构建环境则依赖标准的 Node.js/Electron 配置文件。

## 2. 核心组件与文件
- **运行时配置存储**: `src/main/ipc.ts`
  - 使用 `electron-store` 库创建名为 `nexsql-config` 的存储实例。
  - 负责管理 `connections`（数据库连接数组）的增删改查。
- **构建与工程配置**:
  - `electron.vite.config.ts`: 定义 Vite 构建流程、路径别名（如 `@main`, `@renderer`）及插件。
  - `electron-builder.yml`: 定义应用 ID、产品名称、打包目标（dmg, nsis, AppImage）及资源过滤规则。
  - `tsconfig.json`: 定义 TypeScript 编译选项及模块解析路径。
- **状态同步**: `src/renderer/src/stores/connection.ts`
  - 渲染进程通过 Zustand 管理连接状态，并通过 IPC 桥接与主进程的 `electron-store` 进行数据同步。

## 3. 架构设计
- **持久化机制**: 采用 `electron-store`（底层通常为 JSON 文件）在主进程中存储用户配置。这种方式避免了直接操作文件系统带来的复杂性，并提供了类型安全的 API。
- **IPC 桥接模式**: 
  - 渲染进程不直接访问配置文件，而是通过 `window.api.config.*` 发送 IPC 请求。
  - 主进程在 `ipc.ts` 中监听这些事件，执行 `store.get()` 或 `store.set()` 操作，确保配置修改的原子性和安全性。
- **配置隔离**: 敏感的连接配置仅存在于主进程内存及本地加密/未加密存储中（取决于 `electron-store` 的具体配置，默认通常为明文 JSON），不暴露给渲染进程的全局作用域。

## 4. 开发者规范
- **新增配置项**: 若需增加新的全局配置（如主题设置、窗口位置），应在 `src/main/ipc.ts` 中扩展 `Store` 的泛型定义，并添加对应的 IPC 处理函数。
- **类型安全**: 所有配置数据结构必须在 `src/shared/types/index.ts` 中定义，确保主进程与渲染进程对配置结构的理解一致。
- **避免硬编码**: 数据库连接等动态数据严禁硬编码在源码中，必须通过 `electron-store` 进行持久化管理。
- **构建配置修改**: 修改 `electron.vite.config.ts` 中的别名后，需同步更新 `tsconfig.json` 中的 `paths` 以保持 IDE 提示正常。