# nexSql

> **AI 驱动的现代化数据库管理工具**，用自然语言驾驭你的数据库。

基于 Electron + React 构建，深度集成 AI 能力，让数据库操作从"写 SQL"变成"说需求"。

---

## AI 驱动的核心能力

nexSql 不是一个传统的数据库客户端。AI 不是附属功能，而是贯穿核心工作流的设计理念：

### 自然语言转 SQL
> 不用记语法，不用查文档。直接用中文描述你的需求，AI 自动生成精准的 SQL。

- **对话式生成**：输入"查询最近 7 天注册的用户，按时间倒序"，AI 自动生成完整 SQL
- **Schema 感知**：AI 实时读取你当前数据库的表结构（表名、字段名、主键、类型），生成的 SQL 精确匹配你的实际结构，不会编造不存在的表或列
- **增量改写**：已有 SQL？直接说"加一个按用户名分组的条件"，AI 在原有 SQL 基础上优化和修改
- **流式输出**：实时流式显示生成过程，无需等待
- **安全可控**：API Key 本地加密存储，数据不经第三方服务器（仅发送表结构和需求描述到 AI）

### AI 上下文理解
- 自动提取当前数据库的完整 DDL 结构作为 AI 上下文
- AI 理解字段类型、主键、索引关系，生成更优的查询方案
- 支持复杂多表关联查询的自然语言描述

### 对话历史管理
- 多轮对话上下文记忆，AI 理解你的后续修改意图
- 对话列表本地持久化，随时回顾历史对话
- 支持新建 / 切换 / 删除对话

### AI 模型配置
- 默认集成 **DeepSeek**（OpenAI 兼容协议）
- 支持自定义 API Key 和模型名称
- 低温度参数（temperature: 0.1）确保 SQL 输出稳定可靠

---

## 支持的数据库

| 数据库 | 支持状态 | 最低版本 | 推荐版本 | 说明 |
|--------|:-------:|---------|---------|------|
| **MySQL** | ✅ 完整支持 | 5.6 | 8.0+ | 核心适配对象，全功能可用 |
| **MariaDB** | ⚠️ 兼容可用 | 10.0 | 10.5+ | MySQL 协议兼容，理论可用（未正式测试） |
| **Redis** | ✅ 支持 | 4.0 | 6.0+ | Stream 类型需 5.0+ |

**不支持**：PostgreSQL、SQLite、SQL Server、Oracle、MongoDB 等。

### MySQL 版本兼容性细节

| 功能 | MySQL 5.6 | MySQL 5.7 | MySQL 8.0+ |
|------|:---------:|:---------:|:----------:|
| 连接、查询、表格编辑 | ✅ | ✅ | ✅ |
| 对象浏览（表/视图/存储过程/事件/触发器） | ✅ | ✅ | ✅ |
| 数据库同步 | ✅ | ✅ | ✅ |
| 备份与恢复 | ✅ | ✅ | ✅ |
| 性能监控 | ⚠️ 部分 | ✅ | ✅ |
| EXPLAIN TREE 格式 | ❌ | ❌ | ✅ (8.0.16+) |
| SSH 隧道 / SSL 连接 | ✅ | ✅ | ✅ |

---

## 完整功能列表

### 连接管理
- 多连接管理，支持分组、颜色标签
- SSH 隧道连接（密码 / 私钥认证）
- SSL 加密连接
- 密码安全存储（macOS Keychain / Windows DPAPI / Linux libsecret）
- 连接配置导出 / 导入（JSON 格式，支持跨设备迁移；导出时密码以明文写入，导入后自动用本机凭据重新加密；同 id 连接自动合并更新，被更新的连接会断开并需重连生效）

### SQL 查询
- **Monaco Editor** 编辑器，语法高亮、代码折叠
- 四级 SQL 自动补全（关键字、表名、字段名、SQL 模板）
- 多语句执行（支持 `;` 分隔）
- `DELIMITER` 命令支持（触发器、存储过程的客户端命令解析）
- 选中执行 / 全部执行
- 查询执行计划（EXPLAIN），MySQL 8.0+ 自动使用 TREE 格式
- 实时流式执行日志
- 查询历史记录（本地持久化，最近 20 条）
- 保存的查询管理

### 数据表格
- 高性能虚拟滚动（基于 Glide Data Grid）
- 单元格内联编辑（双击编辑）
- 字段筛选查询（多条件 AND/OR 组合）
- JSON / BLOB 数据智能预览
- 可配置分页大小（本地持久化）
- 批量操作

### 对象设计
- **表设计器**：可视化创建/编辑表结构（字段、类型、默认值、注释、索引、外键）
- **视图设计器**：查看/编辑视图定义
- **存储过程设计器**：函数 / 存储过程管理
- **事件设计器**：定时任务管理
- **ER 关系图**：自动生成表关系图，可视化外键关联

### 数据库同步
- 跨连接/跨数据库表结构对比
- 差异分析（新增表/缺失表/字段差异）
- 一键同步（生成并执行 DDL）
- 后台执行，支持取消

### 数据库备份与恢复
- 全量备份（数据 + 结构）
- 仅结构备份
- 仅数据备份
- 数据库恢复

### Redis 浏览器
- Key 浏览与搜索
- 支持 String / Hash / List / Set / ZSet / Stream 类型
- TTL 管理
- 实时数据查看与编辑
- 多选批量删除

### MCP 服务（AI 工具集成）
> 让外部 AI 客户端（Claude Desktop、Cursor、Qoder 等）通过 MCP 协议连接和管理你的数据库。

- **独立进程**：MCP 服务是独立 Node.js 进程，不需要启动 nexSql 应用即可运行
- **自动同步**：新建/修改/删除连接时自动同步到 MCP 配置文件（`~/.nexsql/mcp-connections.json`）
- **代理架构**：MCP 服务器持有连接密码并代理执行，AI 客户端仅传递 connectionId，密码不经过 MCP 协议暴露
- **19 个工具函数**：
  - MySQL（10 个）：`mysql_query`、`mysql_list_databases`、`mysql_list_tables`、`mysql_describe_table`、`mysql_show_create_table`、`mysql_get_table_data`、`mysql_get_views`、`mysql_get_routines`、`mysql_server_status`
  - Redis（9 个）：`redis_info`、`redis_dbsize`、`redis_scan`、`redis_get`、`redis_set`、`redis_delete`、`redis_expire`、`redis_type`、`redis_ttl`
- **应用内配置页面**：提供可视化教程弹窗，引导在其他电脑上安装部署
- **安全设计**：`listConnectionsSafe` 接口剥离密码等敏感字段，仅返回 connectionId、名称、类型

### DeepSeek Harness（DSH）插件
> 让 [DeepSeek Harness](https://github.com/deepseek-harness) 的 AI 助手直接操作你的数据库，并在 DSH 网页里使用 nexSql 完整管理界面。

- **21 个原生工具**：MySQL / Redis 全套操作以进程内原生工具提供（无 MCP 桥开销），AI 对话中直接调用
- **内置管理面板**：DSH 设置 → 「nexSql 数据库」→ 打开面板，即桌面应用同一套 UI（连接管理、SQL 查询、Monaco 编辑器、表设计器、ER 图、Redis 浏览）
- **配置互通**：与桌面应用、MCP 服务共用同一份连接配置，一处添加三处可用
- 安装方式见 [作为 DSH 插件安装](#作为-dsh-插件安装)，详细文档见 [`dsh-plugin/README.md`](./dsh-plugin/README.md)

### 性能监控
- 服务器状态变量（连接数、缓冲池、线程等）
- 实时进程列表（SHOW PROCESSLIST）
- 各数据库大小统计
- 关键性能指标可视化

### 其他
- SQL 片段管理（模板分类、快捷插入）
- 深色 / 浅色主题
- 多 Tab 页面，支持拖拽排列
- 可调整面板布局（侧边栏宽度、结果面板高度等，本地持久化）
- 快捷键支持（Ctrl+Enter 执行、Ctrl+S 保存等）

---

## 作为 DSH 插件安装

nexSql 可作为 [DeepSeek Harness](https://github.com/deepseek-harness) 插件安装：AI 助手获得 21 个原生 MySQL/Redis 工具，DSH 网页内置完整数据库管理面板。假设 profile 名为 `web`：

**npm 安装**（已发布时）：

```sh
dsh plugin --profile web add nexsql-dsh-plugin
```

**克隆构建安装**（git 分发）：

```sh
git clone https://github.com/wwenbo2048/nexsql.git && cd nexsql
npm install
npm run renderer:web      # 构建管理面板
cd dsh-plugin && npm install && npm run build
dsh plugin --profile web add ./dsh-plugin
```

安装后 `dsh --profile web` 启动，进入 **设置 → nexSql 数据库** 打开面板；AI 工具即刻可用。tarball 分发、升级方式与详细说明见 [`dsh-plugin/README.md`](./dsh-plugin/README.md)。

---

## 技术栈

| 层 | 技术 | 版本 |
|----|------|------|
| 框架 | Electron | 29.x |
| 构建工具 | electron-vite | 2.x |
| 前端框架 | React | 18.x |
| 状态管理 | Zustand | 4.x |
| 编辑器 | Monaco Editor | 0.46.x |
| 数据表格 | Glide Data Grid | 6.x |
| MySQL 驱动 | mysql2 | 3.x |
| Redis 驱动 | ioredis | 5.x |
| SSH 隧道 | ssh2 | 1.x |
| AI 模型 | DeepSeek (OpenAI 兼容) | - |
| MCP 协议 | @modelcontextprotocol/sdk | - |
| 样式 | Tailwind CSS | 3.x |
| 语言 | TypeScript | 5.x |

---

## 环境要求

- **Node.js** >= 18
- **npm** >= 9（或使用 yarn / pnpm）
- 操作系统：macOS / Windows / Linux

---

## 开发与构建

### 安装依赖

```bash
npm install
```

> 国内网络环境可使用镜像源加速 Electron 下载（已配置在 `.npmrc` 中）。

### 开发模式

```bash
npm run dev
```

启动热重载开发服务器。

### 打包构建

```bash
# macOS
npm run build:mac

# Windows
npm run build:win

# Linux
npm run build:linux
```

构建产物输出到 `release/` 目录：
- **macOS**：`.dmg` + `.zip`
- **Windows**：`.exe`（NSIS 安装包）+ `.zip`
- **Linux**：`.AppImage` + `.deb`

### 普通构建（不打包）

```bash
npm run build
```

仅编译代码到 `out/` 目录，用于调试。

---

## 项目结构

```
nexSql/
├── src/
│   ├── main/                 # Electron 主进程
│   │   ├── index.ts          # 应用入口
│   │   ├── ipc.ts            # IPC 通信注册
│   │   ├── crypto.ts         # 密码加密/解密
│   │   ├── uuid.ts           # UUID 生成
│   │   ├── services/         # 业务服务层
│   │   │   ├── db.ts         # MySQL 数据库服务
│   │   │   ├── redis.ts      # Redis 服务
│   │   │   ├── ai.ts         # AI 自然语言转 SQL 服务
│   │   │   └── ssh-tunnel.ts # SSH 隧道
│   │   └── utils/
│   │       └── http.ts       # HTTP 工具
│   ├── mcp/                  # MCP 服务（独立进程）
│   │   ├── index.ts          # MCP 服务入口（stdio transport）
│   │   ├── config.ts         # 配置加载器
│   │   ├── connection-manager.ts # MySQL/Redis 连接管理
│   │   ├── mysql-tools.ts    # MySQL 工具函数
│   │   ├── redis-tools.ts    # Redis 工具函数
│   │   └── types.ts          # MCP 类型定义
│   ├── preload/              # 预加载脚本（IPC 桥接）
│   │   ├── index.ts
│   │   └── index.d.ts        # 类型声明
│   ├── renderer/             # 渲染进程（React 前端）
│   │   └── src/
│   │       ├── components/   # UI 组件
│   │       ├── stores/       # Zustand 状态管理
│   │       ├── App.tsx       # 根组件
│   │       └── main.tsx      # 渲染进程入口
│   └── shared/
│       └── types/
│           └── index.ts      # 共享类型定义
├── electron.vite.config.ts   # electron-vite 配置
├── electron-builder.yml      # 打包配置
├── tailwind.config.js        # Tailwind CSS 配置
└── package.json
```

---

## 后续计划

### AI 能力增强（优先级最高）
- [ ] AI 驱动的查询性能优化建议（分析慢查询，自动推荐索引）
- [ ] AI 驱动的表结构设计（描述业务场景，自动生成建表方案）
- [ ] AI 驱动的数据异常检测（自动发现脏数据、重复数据）
- [ ] AI 驱动的数据库健康检查报告（一键生成诊断报告）
- [ ] 支持更多 AI 模型（OpenAI GPT、Claude、通义千问等）
- [ ] AI 对话中直接预览和执行生成的 SQL
- [ ] AI 驱动的数据库文档自动生成

### 数据库扩展
- [ ] PostgreSQL 支持
- [ ] SQLite 支持
- [ ] MongoDB 支持
- [ ] SQL Server 支持

### SQL 查询增强
- [ ] SQL 格式化与美化（集成 sql-formatter）
- [ ] SQL 语法检查与错误提示
- [ ] 查询结果导出（CSV / JSON / Excel）
- [ ] 可视化查询构建器（拖拽式）

### 数据表格
- [ ] 多行编辑模式
- [ ] 外键关联数据预览
- [ ] 数据图表可视化（柱状图/折线图/饼图）

### 数据库管理
- [ ] 数据迁移工具（跨数据库类型）
- [ ] 数据生成器（测试数据填充）
- [ ] 表数据对比与合并

### 协作与云端
- [x] MCP 服务（AI 工具集成）✅ 已实现
- [ ] 连接配置云同步
- [ ] 团队共享 SQL 片段
- [ ] 查询历史云备份

### 用户体验
- [ ] 插件系统
- [ ] 自定义快捷键
- [ ] 命令面板（Cmd+K）
- [ ] 工作区多开

---

## License

MIT
