## 1. 依赖管理系统
本项目采用 **npm** 作为包管理器，基于 **Electron-Vite** 框架构建。依赖管理遵循标准的 Node.js 生态规范，通过 `package.json` 声明依赖，并利用 `.npmrc` 进行环境优化。

### 核心工具链
- **包管理器**: npm (由 `package-lock.json` 隐式支持，虽未在树中显示但为 npm 默认行为)
- **构建与打包**: `electron-vite` 负责开发/构建流程，`electron-builder` 负责多平台分发打包。
- **类型系统**: TypeScript，通过 `tsconfig.json` 系列文件管理编译上下文。

## 2. 关键配置文件

### `package.json`
定义了项目的核心依赖结构：
- **生产依赖 (`dependencies`)**:
  - **数据库驱动**: `mysql2` (^3.9.2)，用于主进程连接 MySQL 数据库。
  - **UI 框架**: `react`, `react-dom`, `lucide-react` (图标)。
  - **状态管理**: `zustand` (^4.5.2)，轻量级状态管理库。
  - **代码编辑器**: `monaco-editor` 及其 React 封装 `@monaco-editor/react`，用于 SQL 查询编辑。
  - **数据表格**: `react-data-grid`，用于展示数据库表内容。
  - **持久化存储**: `electron-store`，用于保存用户连接配置等本地数据。
- **开发依赖 (`devDependencies`)**:
  - **Electron 核心**: `electron` (^29.1.5)。
  - **构建工具**: `electron-vite`, `vite`, `@vitejs/plugin-react`。
  - **样式处理**: `tailwindcss`, `postcss`, `autoprefixer`。
  - **类型定义**: `@types/node`, `@types/react` 等。

### `.npmrc`
配置了 Electron 二进制文件的下载镜像，以加速国内开发环境的依赖安装：
```ini
electron_mirror=https://npmmirror.com/mirrors/electron/
```
这表明项目针对中国开发者进行了优化，避免直接从 GitHub 下载 Electron 二进制文件时可能出现的网络问题。

### `electron-builder.yml`
配置了应用打包策略：
- **资源排除**: 明确排除了源码目录 (`src/*`)、配置文件 (`.env`, `tsconfig.json` 等) 和 IDE 配置，以减小最终安装包体积。
- **多平台目标**:
  - **macOS**: dmg, zip
  - **Windows**: nsis (安装程序), zip
  - **Linux**: AppImage, deb
- **ASAR  unpack**: 配置 `resources/**` 不打包进 ASAR，通常用于存放需要原生访问的资源或动态链接库。

## 3. 架构与约定

### 依赖外部化 (Externalization)
在 `electron.vite.config.ts` 中，主进程 (`main`) 和预加载脚本 (`preload`) 使用了 `externalizeDepsPlugin()`。
- **目的**: 将 `node_modules` 中的依赖标记为外部依赖，不在 Vite 构建时打包进 bundle，而是在运行时由 Node.js 模块系统解析。
- **优势**: 加快构建速度，避免原生模块 (如 `mysql2` 中的 C++ 绑定) 在打包过程中出现兼容性问题。

### 路径别名 (Aliases)
通过 `resolve.alias` 统一管理模块导入路径，提高代码可维护性：
- `@main`: 指向主进程源码
- `@renderer`: 指向渲染进程源码
- `@shared`: 指向共享类型定义
- `@components`, `@stores`: 指向渲染进程特定模块

## 4. 开发者规范

1. **依赖安装**: 
   - 运行 `npm install` 即可自动使用 `.npmrc` 中的镜像配置下载 Electron。
   - 若遇到 `mysql2` 等原生模块编译问题，确保本地安装了正确的 Python 和 C++ 构建工具链。

2. **添加新依赖**:
   - **主进程使用的 Node.js 模块** (如新的数据库驱动): 应安装在 `dependencies` 中，并依靠 `externalizeDepsPlugin` 处理。
   - **渲染进程使用的 UI 库**: 同样安装在 `dependencies` 中，Vite 会将其打包进前端 bundle。

3. **版本管理**:
   - 所有依赖均使用 caret (`^`) 版本前缀，允许小版本和补丁版本的自动更新，但在生产环境中建议配合 `package-lock.json` 锁定确切版本以确保一致性。

4. **打包优化**:
   - 新增静态资源若需在运行时通过文件系统路径访问，应放置在 `resources/` 目录下，并在 `electron-builder.yml` 的 `asarUnpack` 中确认包含该路径。