# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与 [SemVer](https://semver.org/lang/zh-CN/)。

## [0.2.0] - 2026-10-24

从"收纳"走向"审阅"：文件名旁边终于能看出改了多少，也能点开看改了什么。

### 新增

- **改动行数**：`workspace/changes` 里的 `added` / `deleted` / `binary` / `oversized` 不再被丢掉，面板每行显示 `+N −M`，头部汇总本次会话的增删行数。
- **行内差异**：新增 `GET /whale-catch/api/diff`，按 `seq + index` 调内核的 `ctx.workspaceChanges.diff()`，返回 unified diff 的 hunk；面板就地展开，`+` / `−` 着色、`@@` 段头、新增/删除文件与 `coarse`（整文件替换）都有说明。二进制与超大文件给明确文案，不画空白框。
- **按轮分组**：把当前列表按"第 N 轮"分段，轮次倒序，没标轮次的沉底。
- **复制 Markdown 清单**：把勾选（或当前筛选）的文件导成 Markdown，含路径、体积、轮次、行数与描述。

### 安全

- `/diff` 沿用路径白名单，且只对带 `workspace/changes` 记录的条目开放；`no-session` / `not-in-basket` / `no-change` / `no-diff` 各自映射到 404，超时映射到 504。
- 差异回传前按 1200 行裁剪，并重算被截断 hunk 的 `oldLines` / `newLines`，`@@` 头不会和实际内容对不上。
- 路由侧用 `AbortController` 兜住超时与客户端断开：请求结束后内核的读盘会真的停下，不会留着跑。

### 修复

- `workspace/changes` 的 `turn` 改为取最新一次观测（原来只在第一次写入）。同一文件跨轮再改时，分组和"第 N 轮"标签不会停在旧轮次。

### 其他

- 测试 40 → 49 项，覆盖改动元数据、diff 裁剪、超时中止、无 diff 能力降级、端到端 `seq + index` 透传。
- 文档补上差异的来源、边界与降级行为；README 的契约表格、界面示意、安全边界同步更新。

## [0.1.3] - 2026-10-22

### 安全

- `/file` 对 HTML / SVG 内联预览加 `Content-Security-Policy: sandbox`。此前工作区里任意 `.html` / `.svg` 被点开预览时，能在 Host 源上执行脚本，进而调用本插件接口把其它文件打包外带——现在这类文档照常渲染，但脚本被禁用、源被置为 opaque。

### 修复

- 拿不到会话工作目录时，从 `500 internal` 改为 `409 no-cwd`；客户端按错误码取本地化文案，英文界面不再突然冒出一段中文。
- 打包 zip 不再静默丢弃超过单文件上限的文件：响应头 `X-Whale-Catch-Skipped` 回传跳过数量，面板提示「已跳过 N 个」；选中的文件全部超限时返回 `413 all-too-large`。
- cwd 之外的 `present` 文件归档到 `<归档根>/<sessionId>/_external/`，不再把绝对路径镜像成 `Users/…`（Windows 上原本还会造出盘符目录）。

### 其他

- `@deepseek-ai/schemastery` 只声明在 `dependencies`：原来同时写进 `devDependencies`，会让 lockfile 把它标成 dev 依赖，与「它必须是运行时依赖」的注释自相矛盾。
- 测试 35 → 40 项，覆盖 CSP 沙箱、`no-cwd` 状态码、超大文件跳过、外置路径归档。

## [0.1.2] - 2026-10-19

### 修复

- `archiveDir` 现在会把开头的 `~` / `~/` 展开到用户主目录。0.1.1 的文档示例写成 `~/Documents/...`，但 `path.resolve` 会把 `~` 当成普通目录名，归档会落到 `<cwd>/~/...`；现在文档和实现对齐了。
- 测试从 34 项加到 35 项，覆盖 `~`、`~/`、带空格以及「只展开开头」四种情况。

## [0.1.1] - 2026-10-19

插件功能与 0.1.0 一致，只有文档与示例路径修正。

### 修复

- 文档里的示例归档路径改用 `~` 开头。原来写 `/Users/you/...`，发布清单的隐私扫描规则会把它当成真实个人目录误报。
- 隐私扫描命令排除 `docs/publish.md` 自身，避免文档里引用的关键词自命中。
- 发布清单补上 `npm pack` 的缓存排障提示，以及「已发布标签不改指向」的约定。

### 说明

- 已发布的 `v0.1.0` 标签保持不动，修复以新版本向前发布。

## [0.1.0] - 2026-10-19

首个可用版本。

### 新增

- 右侧栏「鱼篓」tab：把一场会话产出/改动的文件汇总成一份清单。
- 三条采集来源：`deliverables/presented` 会话事件、`workspace/changes` + `ctx.workspaceChanges.summary()`、工作目录 mtime 扫描兜底。
- 面板能力：按类型筛选（文档/表格/演示/图片/代码/压缩/音视频/其他）、勾选、预览、复制路径。
- 一键打包 zip：零依赖 ZIP 写入器（STORE + DEFLATE，UTF-8 条目名），保留相对路径。
- 一键归档：复制到 `$DSH_HOME/whale-catch/archive/<sessionId>/`，同名不覆盖。
- 配置项：`archiveDir` / `ignore` / `maxFiles` / `maxDepth` / `maxFileBytes` / `lookbackMinutes`。
- 安全栅栏：路径白名单、同源检查、写操作限 `application/json`、zip 与归档的穿越防护。
- 34 项 `node:test` 测试 + 契约自检脚本。
- 运行时依赖只有 `@deepseek-ai/schemastery`，无构建步骤、无框架依赖。

### 已知限制

- 只覆盖当前会话工作目录；不跨会话。
- Host 重启后 `present` 的描述与轮次号不恢复（文件本身靠 mtime 重建）。
- 预览依赖浏览器原生能力，Office 文档走下载。
