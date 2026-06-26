## 1. 核心构建系统
项目采用 **electron-vite** 作为核心构建工具，结合 **Vite** 进行前端资源编译，并使用 **electron-builder** 负责最终的应用打包与分发。这种架构利用了 Vite 的极速冷启动和热更新特性，同时通过 electron-vite 插件处理 Electron 特有的主进程（Main）、预加载脚本（Preload）和渲染进程（Renderer）的构建隔离。

## 2. 关键配置文件
- `package.json`: 定义了生命周期脚本。开发环境使用 `electron-vite dev`，生产构建使用 `electron-vite build`。针对不同操作系统提供了专门的打包命令（如 `build:mac`, `build:win`），这些命令会先执行编译再触发 electron-builder。
- `electron.vite.config.ts`: 配置了多入口构建逻辑。通过 `externalizeDepsPlugin` 将 Node.js 原生模块（如 `mysql2`）外部化，避免在渲染进程中错误打包。同时配置了路径别名（如 `@main`, `@renderer`），简化模块引用。
- `electron-builder.yml`: 定义了打包产物规则。设置了输出目录为 `release`，并针对不同平台定制了安装包格式：
  - **macOS**: 生成 `.dmg` 和 `.zip`。
  - **Windows**: 生成 NSIS 安装程序 (`.exe`) 和便携版 `.zip`。
  - **Linux**: 生成 `.AppImage` 和 `.deb`。
  - **文件过滤**: 明确排除了源码目录 `src/`、配置文件及编辑器特定文件夹，确保发布包体积精简。

## 3. 架构与约定
- **三进程构建隔离**: 构建系统严格区分 main, preload, renderer 三个部分。main 和 preload 进程被配置为外部化依赖，以兼容 Electron 的沙箱机制和 Node.js 集成；renderer 进程则通过 React 插件进行标准的 Web 资源打包。
- **版本管理**: 当前版本号硬编码在 `package.json` 中 (`1.0.0`)。打包产物名称通过 `${productName}-${version}` 模板动态生成，确保了发布文件的可追溯性。
- **资源处理**: `asarUnpack` 配置允许特定资源（如 `resources/**`）不被打包进 ASAR 档案，这通常用于存放需要在运行时被原生模块直接访问的文件。

## 4. 开发者规范
- **构建命令**: 严禁直接调用 `vite` 或 `webpack`，必须使用 `npm run dev` 或 `npm run build:[platform]` 以确保 Electron 上下文正确初始化。
- **依赖管理**: 任何涉及 Node.js 原生 API 的依赖（如数据库驱动）必须安装在 `dependencies` 中，并确保在 `electron.vite.config.ts` 中被正确外部化，防止渲染进程构建失败。
- **打包产物**: 所有正式发布的安装包均位于 `release/` 目录下，开发者不应手动修改该目录内容。