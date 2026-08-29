# nexSql for DeepSeek Harness（DSH）

把 nexSql 的全部数据库能力带进 [DeepSeek Harness](https://github.com/deepseek-harness)：**21 个原生 AI 工具**（模型直接调用，无 MCP 桥开销）+ **完整数据库管理面板**（与桌面应用同一套界面，在 DSH 网页内使用）。

```
┌────────────── DSH 进程 ──────────────┐
│  Host 半边（lib/）                    │
│  ├─ 21 个原生工具（MySQL/Redis/通用） │
│  └─ /nexsql 路由（rapi 桥 + 静态面板）│
│                                      │
│  Client 半边（client/）               │
│  └─ 设置 → nexSql 数据库（面板入口）  │
└──────────────────────────────────────┘
```

## 功能

**AI 原生工具（21 个）** — 模型在对话中直接调用：

- MySQL（9）：`mysql_query`、`mysql_list_databases`、`mysql_list_tables`、`mysql_describe_table`、`mysql_show_create_table`、`mysql_get_table_data`、`mysql_get_views`、`mysql_get_routines`、`mysql_server_status`
- Redis（10）：`redis_info`、`redis_dbsize`、`redis_scan`、`redis_get`、`redis_set`、`redis_delete`、`redis_expire`、`redis_type`、`redis_ttl`
- 通用（2）：`nexsql_list_connections`、`nexsql_test_connection`

**数据库管理面板** — 设置 → nexSql 数据库 → 打开数据库面板：

- 连接管理（增删改、连通性测试、导入/导出，与桌面应用共用同一份连接配置）
- 库/表/视图/存储过程浏览，双击表打开数据页
- 数据表格编辑、SQL 查询（Monaco 编辑器）、表/视图设计器、ER 图
- Redis 键浏览与编辑
- AI 自然语言生成 SQL（对话历史与桌面应用互通）

## 环境要求

- DSH CLI 已安装并能运行 `dsh web`
- Node.js >= 22（与包 `engines` 一致）
- 数据库可从本机网络访问

## 安装

假设 DSH profile 名为 `web`（按需替换）。三种方式任选其一。

### 方式一：npm 安装（已发布时，最简）

```sh
dsh plugin --profile web add nexsql-dsh-plugin
```

### 方式二：tarball 安装（未上 npm / 私有分发）

在 nexSql 仓库根目录完成[克隆构建](#方式三克隆构建)的全部步骤后：

```sh
cd dsh-plugin
pnpm pack          # 产出 nexsql-dsh-plugin-<version>.tgz（含 lib/client/webui）
dsh plugin --profile web add ./nexsql-dsh-plugin-<version>.tgz
```

### 方式三：克隆构建（git 分发）

pnpm 不支持 git 仓库子目录直装，因此 git 分发走「克隆 → 构建 → 本地路径安装」：

```sh
git clone https://github.com/wwenbo2048/nexsql.git && cd nexsql
npm install               # 根目录依赖（renderer 构建需要）
npm run renderer:web      # 构建管理面板 → dsh-plugin/webui/
cd dsh-plugin
npm install
npm run build             # 构建 lib/（Host）与 client/（Client）
dsh plugin --profile web add ./dsh-plugin
```

安装以链接方式指向该 checkout：后续 `git pull` → 重复 `npm run renderer:web` 与 `npm run build` → 重启 `dsh web` 即完成升级。

发布到 npm 前请在仓库根目录运行 `npm run renderer:web`（`prepublishOnly` 会校验 webui 存在，防止发布缺面板的包）。

## 使用

1. `dsh --profile web` 启动（或 `dsh web --profile web`）
2. 浏览器打开后进入 **设置 → nexSql 数据库**，点击「打开数据库面板」
3. 面板中添加/导入连接（也可直接使用桌面应用已保存的连接），即可浏览与操作
4. 对话中让 AI 直接操作：如「列出 zhizhu 连接里的所有库」「查一下 base_test 的用户表结构」

面板与 AI 工具共享连接池与配置：面板里新建的连接，AI 立即可用，反之亦然。

## 架构与安全

- **双半边组合包**：Host（`lib/`，ESM，`apply` 注册工具与 `/nexsql` 路由）+ Client（`client/`，DSH ModuleLoader 加载，React 由外壳提供）
- **鉴权**：所有 `/nexsql/*` 路由复用 DSH 的 `connection.requestRejection`（Host/Origin 校验 + 会话 Cookie），未认证请求一律 401/403，不暴露到局域网
- **密码策略**：桌面应用的系统钥匙串密文（`enc:` 前缀）无法在 DSH 进程解密，Host 按 connectionId 从 `~/.nexsql/mcp-connections.json` 解析明文；面板保存的连接写回明文，桌面应用兼容读取
- **存储**：与桌面应用共用 `~/Library/Application Support/nexSql/nexsql-config.json`（连接、AI 对话），原子写入防止损坏
- **连接池**：按 connectionId 缓存，配置变更自动断开旧池

## 开发

```sh
# 仓库根目录：面板（renderer）
npm run renderer:web

# dsh-plugin/：Host 与 Client
npm run build
node clientsmoke.mjs     # 客户端注册冒烟
node rapitest.mjs        # rapi 桥集成测试（需真实连接配置）
```

改动生效：Host（`lib/`）与 Client（`client/`）需重启 `dsh web`；面板静态文件（`webui/`）按请求实时读盘，硬刷新浏览器（⌘⇧R）即生效。

源码：`src/`（Host）、`client-src/`（Client）、`webui-src/api-shim.js`（面板的 window.api 垫片）、上游实现复用 `../src/main/services` 与 `../src/mcp`。

## 已知限制

- 阶段一未接：备份恢复/批量执行进度流、AI 生成 SQL 的流式 UI（数据接口已通）
- 原生文件对话框降级：保存/导出 → 浏览器下载；打开/导入 → 浏览器文件选择（连接导入导出已完整实现，合并语义与桌面端一致）
- 局域网访问/隧道管理仅桌面应用可用（面板中明确报错）
- `exec.signal` 取消不转发到进行中的驱动操作
- 桌面应用与 DSH 面板同时编辑连接时，后保存者覆盖（共享同一存储文件）
