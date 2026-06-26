<div align="center">

# nexSql

**一款现代化的桌面数据库管理客户端**

*基于 Electron + React 构建，专为 MySQL 设计的数据库可视化与开发工具*

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Electron](https://img.shields.io/badge/Electron-29-47848F?logo=electron)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript)](https://www.typescriptlang.org/)

</div>

---

## 功能特性

### 数据库管理
- **多连接管理** — 支持同时管理多个 MySQL 连接，快速切换
- **连接分组与标签** — 按环境（开发/测试/生产）分组显示连接，支持自定义标签徽章
- **数据库浏览** — 树形结构展示：表、视图、函数/存储过程、事件四大分类
- **新建/删除数据库** — 直接在连接树上操作，支持自定义字符集和排序规则
- **连接池管理** — 自动维护数据库连接，支持断线重连
- **安全连接** — 支持 SSH 隧道连接和 SSL 加密连接
- **密码加密存储** — 使用系统级安全存储（Windows DPAPI / macOS Keychain / Linux libsecret）加密保存连接密码

### 数据表格
- **高性能数据展示** — 基于 `react-data-grid`，支持虚拟滚动，轻松处理百万级数据
- **单元格内编辑** — 直接在单元格中编辑数据，支持 NULL、空字符串、时间选择器
- **智能字段识别** — 自动检测 JSON、二进制/BLOB、布尔等字段类型并差异化展示
- **数据预览增强** — JSON 字段格式化预览、BLOB 十六进制显示、布尔值彩色徽章、长文本智能截断
- **多行批量操作** — 支持行选择、批量删除、批量插入，事务保障原子性
- **排序与筛选** — 列排序、Navicat 风格多条件筛选（支持 AND/OR 逻辑组合）

### 查询面板
- **Monaco 编辑器** — VSCode 同款编辑器，语法高亮 + 智能提示
- **SQL 自动补全** — 四级智能提示：关键字、表名、列名、函数
- **多语句执行** — 支持 `;` 分隔的多 SQL 批量执行，智能处理引号内分号
- **SQL 格式化** — 一键美化 SQL（关键字大写、自动缩进），基于 `sql-formatter`
- **查询执行计划** — EXPLAIN 可视化，支持 TREE 格式（MySQL 8.0.16+）和标准表格格式，颜色编码访问类型与效率评估
- **查询历史** — 自动记录执行历史，支持搜索、复用、持久化存储
- **查询结果导出** — 支持导出为 CSV / JSON

### 数据导入导出
- **导出格式** — CSV、JSON、SQL（含 DDL + INSERT）
- **导入支持** — CSV、JSON、SQL 文件导入，支持引号转义等复杂格式
- **数据库备份/恢复** — 纯 SQL dump 导出（DDL + 批量 INSERT），支持一键恢复

### 对象设计
- **表设计器** — 列定义、索引、外键、触发器、表选项可视化编辑
- **视图设计** — 可视化创建和编辑视图
- **函数/存储过程** — 支持创建、编辑、执行存储过程
- **事件调度器** — 创建和管理 MySQL 事件
- **ER 关系图** — 基于外键的 SVG 可视化关系图，支持拖拽表节点、画布平移、滚轮缩放
- **表结构对比** — 跨连接/跨数据库的列差异检测，自动生成 ALTER TABLE 同步 SQL

### SQL 片段管理
- **片段库** — 创建、分类、搜索常用 SQL 模板
- **变量占位符** — 使用 `{{变量名}}` 定义参数化模板，运行时自动提示替换
- **快捷操作** — 一键插入到查询编辑器、直接运行、复制

### 界面体验
- **三栏布局** — 左栏连接树 + 中栏对象列表 + 右栏详情/数据，可拖拽调整宽度
- **顶部菜单栏** — Navicat 风格菜单，含文件/视图/对象/工具/帮助五大类
- **右键菜单** — 全面的上下文菜单操作
- **多标签页** — 支持同时打开多个表/查询，标签页拖拽排序 & 持久化存储
- **深色主题** — 专业深色界面，长时间使用不累眼

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 桌面框架 | Electron 29 |
| 构建工具 | Electron-Vite + Vite 5 |
| 前端框架 | React 18 + TypeScript 5 |
| 状态管理 | Zustand |
| 样式方案 | TailwindCSS 3 |
| 数据表格 | react-data-grid 7 (beta) |
| 代码编辑器 | Monaco Editor |
| 数据库驱动 | mysql2/promise |
| SQL 格式化 | sql-formatter |
| 图标库 | Lucide React |
| 持久化 | electron-store |

---

## 快速开始

### 环境要求

- Node.js >= 18
- npm >= 9

### 安装与运行

```bash
# 克隆项目
git clone https://github.com/your-username/nexsql.git
cd nexsql

# 安装依赖
npm install

# 开发模式
npm run dev

# 构建
npm run build

# 预览构建结果
npm run preview
```

### 打包发布

```bash
# macOS
npm run build:mac

# Windows
npm run build:win

# Linux
npm run build:linux
```

打包产物位于 `release/` 目录。

---

## 项目结构

```
nexSql/
├── src/
│   ├── main/                    # Electron 主进程
│   │   ├── index.ts             # 主进程入口
│   │   ├── ipc.ts               # IPC 通信处理
│   │   ├── crypto.ts            # 密码加密/解密（safeStorage）
│   │   └── services/
│   │       └── db.ts            # 数据库服务层
│   ├── preload/                 # Preload 脚本
│   │   └── index.ts             # 安全 API 暴露
│   ├── renderer/                # 前端渲染进程
│   │   └── src/
│   │       ├── App.tsx          # 根组件
│   │       ├── components/      # UI 组件
│   │       │   ├── MenuBar.tsx           # 顶部菜单栏
│   │       │   ├── Sidebar.tsx           # 侧栏
│   │       │   ├── ConnectionTree.tsx     # 连接树（分组/标签）
│   │       │   ├── MiddlePanel.tsx       # 中间对象列表面板
│   │       │   ├── DataTable.tsx         # 数据表格（增强预览）
│   │       │   ├── QueryPanel.tsx        # SQL 查询面板
│   │       │   ├── QueryEditor.tsx       # 查询编辑器（含 EXPLAIN）
│   │       │   ├── TableDetailPanel.tsx  # 表详情面板
│   │       │   ├── TableDesign.tsx       # 表结构设计师
│   │       │   ├── ConnectionModal.tsx   # 连接配置弹窗
│   │       │   ├── ContextMenu.tsx       # 右键菜单
│   │       │   ├── TabBar.tsx            # 标签栏（拖拽排序）
│   │       │   ├── ERDiagramView.tsx     # ER 关系图
│   │       │   ├── ExplainPlanView.tsx   # 执行计划可视化
│   │       │   ├── TableCompareView.tsx  # 表结构对比
│   │       │   ├── SnippetPanel.tsx      # SQL 片段管理
│   │       │   └── editors/             # 表编辑器子组件
│   │       ├── stores/          # Zustand 状态管理
│   │       │   ├── browser.ts   # 浏览器/对象状态
│   │       │   ├── connection.ts # 连接状态
│   │       │   ├── tab.ts       # 标签页（持久化）
│   │       │   ├── ui.ts        # UI 状态
│   │       │   └── snippet.ts   # SQL 片段
│   │       └── index.css        # 全局样式 + Tailwind
│   └── shared/                  # 主进程与渲染进程共享类型
│       └── types/
│           └── index.ts
├── resources/                   # 应用图标等资源
├── electron.vite.config.ts      # Electron-Vite 配置
├── tailwind.config.js           # Tailwind 配置
├── tsconfig.json                # TypeScript 配置
└── package.json
```

---

## 截图

> 启动后界面包含：顶部菜单栏、左侧连接树、中间对象列表、右侧数据/详情面板，三栏可自由拖拽。

---

## 开发计划

### 已完成

- [x] 多标签页系统（拖拽排序 + 持久化）
- [x] 查询历史记录（持久化存储 + UI 面板）
- [x] SSH 隧道连接 + SSL 加密连接
- [x] 批量操作事务支持
- [x] Monaco SQL 智能补全（表名/列名动态上下文）
- [x] 密码加密存储（系统级 safeStorage）
- [x] 查询执行计划可视化（EXPLAIN）
- [x] ER 关系图（SVG 外键可视化）
- [x] 数据库备份/恢复（纯 SQL dump）
- [x] 表结构对比（跨数据库 diff + ALTER 同步 SQL）
- [x] 连接分组/标签
- [x] 数据预览增强（JSON/BLOB/布尔智能展示）
- [x] SQL 片段管理（分类/变量占位符/快捷运行）

### 规划中

- [ ] 全局搜索
- [ ] 列宽持久化
- [ ] 快捷键系统
- [ ] 主题切换（浅色/深色模式）
- [ ] 数据同步 / 结构同步
- [ ] 支持 PostgreSQL / SQLite

---

## 许可证

[MIT](LICENSE)

---

<div align="center">
  Made with ❤️ by nexSql
</div>
