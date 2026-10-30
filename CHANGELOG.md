# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与 [SemVer](https://semver.org/lang/zh-CN/)。

## [0.3.2] - 2026-10-30

### 修复

- **桌面端「点预览没反应」**：DSH Desktop 的 Electron 主进程对所有 `window.open` 返回 deny（只把 `https:` 外链交给系统浏览器），鱼篓用 `window.open` 打本机 `/file` 地址一直被静默拦截。
- 预览统一改走 DSH Document Preview：cwd 内文件由 Host 生成 `dsh-resource://file/session/…` 地址，客户端调 `sidebarRight.openResource()`；图片 / PDF / Markdown / 文本 / 源码 / Office 都在右侧栏打开。cwd 外文件明确提示「复制路径或归档」，不再假装能打开。
- 移除单独的「原生」按钮，只保留一个「预览」入口；新增回归测试禁止客户端再出现 `window.open(`。

## [0.3.1] - 2026-10-30

### 修复

- **未知后缀的文本文件不再「点预览没反应」**：`/file` 对 `application/octet-stream` 的文件先读 8 KiB 嗅探 UTF-8 文本，`.patch`、`.bak` 这类文本按 `text/plain` 内联；真正的二进制（tgz、zip 等）仍按附件下载。
- 8 KiB 截断落在多字节字符中间时最多回退 3 个字节再判定，中文文本不会被误判成二进制；NUL 字节与控制字符比例过高仍判二进制。
- `.patch` / `.diff` 加入源码后缀快速通道，直接内联，不用嗅探。

### 文档

- README 预览图按 0.3.0 面板重画：排序框、Office「原生」按钮、行内差异都出现在图里。
- 测试 65 → 67：文本嗅探的 UTF-8 / 截断 / 二进制判定，`/file` 的内联与附件分支。

## [0.3.0] - 2026-10-30

### 新增

- **Office 原生预览**：`/basket` 快照为 cwd 内文件生成 `native` 地址（`dsh-resource://file/session/<sessionId>/<相对路径>`，逐段 `encodeURIComponent`）；面板对 docx / xlsx / pptx 增加「原生」按钮，调用 `ctx.sidebarRight.openResource()` 交给 DSH Document Preview，转换由内核 `officeToPdf` 完成。禁用预览插件、地址被拒或 cwd 外文件时回退普通预览，不新增任何运行时依赖。
- **排序**：最近修改 / 名称 / 体积 / 类型四档；已删除条目永远沉底，切换排序不影响勾选与展开的差异。
- **分批渲染**：列表先铺 200 行，点「显示更多」继续追加，800 条也不再一次渲染；筛选、搜索、排序、分组切换时重置回 200 行。
- **归档保留策略**：新配置 `archiveKeep`（默认 `0` = 关闭，行为与 0.2.2 完全一致）。`> 0` 时每次归档写入 `<archiveDir>/<sessionId>/runs/<YYYYMMDD-HHMMSS-mmm>/`，只保留最近 N 批；`/archive` 响应新增 `pruned` 数组。
- 测试 60 → 65：原生地址编码 / 快照字段、`archiveKeep` 默认与清理边界、配置夹取。

### 安全

- 归档清理只遍历 `<archiveDir>/<sessionId>/runs`，只删除名字匹配批次格式的普通目录；符号链接、手工目录与当前正在写入的批次一律跳过，删除失败不影响本次归档结果。
- 原生预览地址由 Host 统一生成，客户端不拼字符串；cwd 外文件不生成地址，避免猜测路径。

### 文档

- README / README.en / 架构文档同步 0.3.0 的功能、配置项与限制；路线图移除已完成的 Document Preview 与排序条目。

## [0.2.2] - 2026-10-28

### 性能

- **GET /basket 不再每次扫盘**：首次打开（或 cwd 变化）扫一次，之后直接读缓存；面板 5 秒轮询不再触发全量目录遍历。手动「刷新」与 `turn/end` 的延迟扫描仍然生效。
- **zip 改为流式写入**：逐文件读取、异步 deflate、边压边写 HTTP 响应，不再先把整包攒进内存；内存里最多只有一个文件。jpg/png/mp4/zip 等已压缩格式直接 STORE。
- `Basket.snapshot()` 的文件 stat 改为 16 路并发限流，减少大筐轮询的等待。
- 会话表从插入序淘汰改为 LRU，长期在用的会话不会因为创建得早而被挤掉。

### 修复

- cwd 外的文件在 zip 里也统一进 `_external/`，不再镜像 `var/folders/…` 或 `Users/…` 绝对路径；manifest 记录包内真实路径，重名自动加 `(2)`。
- 归档超过单文件上限的文件会进入 `failed`，面板显示「成功 N / 失败 M」，不再静默成功。
- 代码文件（`.py` / `.ts` / `.yml` / `.sh` / `.sql` 等）按 `text/plain` 内联，点「预览」不再触发下载。
- `/file` 支持单段 `Range`（206/416）、`ETag` 与 `Last-Modified`；客户端断开时销毁读取流。
- 同源检查增加 Host 白名单：只接受 `localhost`、IP 字面量与配置的 `allowHosts`，堵住 DNS rebinding 下「Origin 与 Host 同时是攻击者域名」的绕过。
- 客户端修复 diff 双击/切换时旧响应覆盖新状态、5 秒轮询无 in-flight 保护导致请求堆积的问题；zip/archive 的业务错误码补了本地化文案。
- zip 清单文件名预留防撞，工作区里真有同名文件时不再产生重复条目。
- 归档拒绝「archiveDir == 会话 cwd」的配置；归档根目录内的符号链接穿越用 `realpath` 挡掉，不再跟着写到根目录外。
- zip manifest 里的 cwd 会把用户主目录前缀改成 `~`，分享时少泄露一点本机路径。

### 新增

- 配置项 `maxZipBytes` / `maxBodyBytes` / `allowHosts`，README 的「全部可配」现在与实现一致。
- `/archive` 的 `failed` 原因列表、zip 的 `name-too-long` 错误码。
- 面板增加按文件名、路径或描述搜索，和分类 chip 一起过滤。

### 其他

- 测试 50 → 60 项：GET 缓存与 refresh、LRU 淘汰、外部 zip 路径、归档失败、Range/ETag、MIME 代码后缀、Host 白名单、parseRange、请求体上限、归档目录安全、manifest 脱敏。
- 文档同步：扫描边界（点文件）、面板轮询行为、zip/归档外部路径、Host 白名单与 manifest 隐私提示。

## [0.2.1] - 2026-10-28

### 新增

- zip 内附交付清单：`_whale-catch/manifest.json`（会话、cwd、生成时间、每个文件的相对路径、体积、轮次、行数、来源、描述、sha256，以及被跳过的文件）与 `_whale-catch/交付清单.md`（人能直接读的 Markdown 表格）。
- sha256 对着已经读入内存的内容计算，不额外读一遍磁盘；打包途中被删的文件不会进清单，被跳过的文件单独列在 `skipped`。

### 其他

- 测试 49 → 50 项，覆盖 manifest 进包、条目数、sha256 与清单.md 内容。
- `docs/dev/` 增加 0.2.1 开发手册：代码、运行位置、验收点与发布流程。

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
