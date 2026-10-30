# 架构与设计取舍

这份文档记录**为什么这样写**，免得后来的人（包括三个月后的我）把它"优化"成另一个东西。

## 不变量

1. **零登记。** 任何"请 agent 调个工具登记文件"的设计都不做——历史插件证明它会吃灰。
2. **不新增会话事件类型。** 只消费内核已持久化的 `deliverables/presented` 与 `workspace/changes`；插件新增 `type` 会让整个会话打不开（官方红线）。
3. **路径白名单是唯一准入。** 所有读文件/打包/归档/看差异的接口只接受"已经在鱼篓里"的路径，不做任何"传什么读什么"的便利。
4. **无构建、无服务依赖。** `lib/client.js` 原样交给 `__ModuleLoader__`；唯一运行时依赖是 `@deepseek-ai/schemastery`（纯校验库，不注册服务）。它必须是 `dependencies`：profile 的 pnpm 配置是 `autoInstallPeers: false`，peer 在干净 profile 里不会安装，插件会在加载期直接失败（这条是实测踩出来的）。
5. **服务全部可选，除了 `webServer`。** `agents`、`workspaceChanges` 走 `ctx.get()`，缺了降级而不是炸树。

## 数据流

```text
                     ┌──────────────────────────── Host (lib/index.js) ───────────────────────────┐
  session/event ────►│ observe()                                                                  │
   ├ presented       │   ├ deliverables/presented ──► Basket.addPresented(files, turn)            │
   ├ workspace/      │   ├ workspace/changes ──────► ctx.workspaceChanges.summary()                │
   │   changes       │   │                            └─► Basket.addChanged(files, turn, seq)     │
   └ turn/end        │   └ turn/end ────────────────► scheduleScan()  (debounce 1.2s)            │
                     │                                                                             │
  GET /basket ──────►│ 首次打开才 scanWorkspace()；之后只读缓存 ──► Basket.snapshot()             │
                     │                        │                                                    │
                     │                        └─ 合并三来源（键 = 绝对路径）──► files[] + totals      │
                     │                           └─ 每个 cwd 内文件附 native 预览地址                   │
  POST /refresh ────►│ 强制 scanWorkspace()（等后台扫描结束后再扫）                                │
                     │                                                                             │
  GET /diff ────────►│ resolve(path)+resolveChange() 白名单 ──► workspaceChanges.diff(seq, index)   │
                     │                        └─ trimDiff() ──► hunks（1200 行预算）                 │
  POST /zip ────────►│ resolve(path) 白名单 ──► 逐文件读 + sha256 ──► writeZip() 流式写响应（附清单）│
  POST /archive ────►│ archiveKeep=0 ? <archiveDir>/<sessionId>/…                                  │
                     │               : <archiveDir>/<sessionId>/runs/<stamp>/… 并清理旧批次          │
  GET  /file ───────►│ resolve(path) ──► Range / ETag ──► createReadStream                       │
                     └─────────────────────────────────────────────────────────────────────────────┘
```

## 为什么需要扫描兜底

内核的两条来源都是"事件驱动"的：

- `deliverables/presented` 只在模型调用 `present` 时产生。模型不会为每个文件都调用它。
- `workspace/changes` 由 git 快照 + 文件工具（`write`/`edit`）的整文件捕获得出。

于是最常见的一类产出——`bash` 里跑 `python build_doc.py`、`npm run build`、`pandoc`——**两边都不认**。鱼篓的第三条来源就是按 `mtime >= 会话创建时间` 扫一遍工作目录，把这类文件捞回来。

代价是可能收录到"会话期间你手动改的无关文件"。这是有意的取舍：**宁可多收，不可漏收**，因为界面上有勾选与筛选，多一条的成本远低于"少一条导致你以为没生成出来"。

## 为什么差异不自己算

0.2.0 之前，`workspace/changes` 只被用来取 `path`——行数与对比全扔了。看起来鱼篓可以自己留一份 before/after 快照再算 diff，但那等于把 `workspace-changes` 的活重做一遍：

- 内核已经按 `seq + index` 把每轮的 turn-start / turn-end 内容留在内存里，`diff()` 直接给 unified diff 的 hunk（带 `binary` / `oversized` / `coarse`），不用我们碰 git 或整文件拷贝；
- 自己存快照得处理大文件、二进制、超时与清理，收益只是"重启后还能看"——而重启后连 `present` 描述都丢了，这条不算刚需；
- 代价是多一个缓存目录、多一份磁盘占用，还要解释"为什么这里也有一份历史"。

所以 `/diff` 只是一层**准入 + 转发 + 裁剪**：路径必须在鱼篓里、条目必须有 `seq + index`，然后原样调 `ctx.workspaceChanges.diff()`；Host 版本没有这个能力就回 `no-diff`，面板降级成一句提示。行数徽章同理——`added` / `deleted` 是内核算好的，不重算。

## 为什么原生预览地址由 Host 生成

0.3.0 让 Office 文档能直接在右侧栏看，但鱼篓自己**不写渲染器**：内核的 Document Preview 早就能把 docx / xlsx / pptx 经 `officeToPdf` 转成 PDF，面板只需要把文件"指"给它。指向的方式是 `dsh-resource://file/session/<sessionId>/<相对路径>` 地址，然后调 `ctx.sidebarRight.openResource()`。

地址放在 Host 的 `Basket.snapshot()` 里生成，而不是让客户端拼字符串，原因有三个：

- **只有 Host 知道权威 cwd**：客户端的 cwd 是从会话快照里"借"来的，Host 的 `Basket.cwd` 才是登记文件时用的那个；
- **编码只有一处实现**：逐段 `encodeURIComponent`、Windows 反斜杠转 POSIX、`..` 前缀判断（不能误杀 `..foo` 这种文件名）都集中在 `nativePreviewAddress()`，测试直接锁死；
- **cwd 外文件天然没有地址**：绝对路径虽然地址语法支持 `absolute` scope，但当前 Document Preview 的类型只接受 `session` scope，所以这些文件返回 `native: null`，面板回退 `/file` 预览。以后内核放开 absolute scope，只需要改这一个函数。

客户端只做三件事：判断后缀是不是 Office、在 `sidebarRight` 可用时调 `openResource`、失败时回退普通预览。`sidebarRight` 不做硬性 inject：禁用右侧栏相关插件时鱼篓仍然可用。

## 归档保留策略为什么是可选的

旧布局是 `<archiveDir>/<sessionId>/<相对路径>`，同名文件用 `(2)` 避让——稳定、可预测，但**只增不减**。0.3.0 没有直接改成"每次一个时间戳批次"，因为那会让所有老用户的归档路径一夜之间全部失效；默认 `archiveKeep = 0` 保持原样。

只有显式开启（`> 0`）时才切换到：

```text
<archiveDir>/<sessionId>/runs/<YYYYMMDD-HHMMSS-mmm>/<相对路径>
```

清理边界写死：只遍历 `runs` 目录、只删名字匹配批次格式的**普通目录**、不跟随符号链接、当前正在写入的批次永远跳过（防止系统时间回拨把它排到最后删掉），删除失败不改变本次归档结果。批次名固定宽度，字典序即时间序，不需要额外读 stat。

## 采集时机与性能

- `turn/end` 触发一次延迟 1.2s 的扫描（给写盘留时间），`unref()` 掉，不阻止进程退出。
- `GET /basket` **只在首次打开（或 cwd 变化）时扫一次**，之后直接读缓存；面板 5 秒轮询不会反复扫盘。
- 手动 `POST /refresh` 才强制重扫；如果后台扫描正在跑，先等它结束再扫，避免拿到旧快照。
- 同一会话的并发扫描共用同一个 Promise；扫描只走一遍目录，访问目录项有上限（默认 20000），命中 `maxFiles` 就停并标记 `truncated`。
- `Basket.snapshot()` 的 stat 用 16 路并发限流，避免 800 个文件串行拖慢一次轮询。
- 会话状态最多保留 40 个，按 LRU 淘汰（命中时移到队尾，同时清掉淘汰者的定时器）。

## 安全模型

威胁不是"本机其他进程"（它们本来就能读文件），而是**浏览器里的第三方页面借用户身份打 loopback**：

1. `Origin` 与 `Host` 不一致 → 403；`Sec-Fetch-Site: cross-site` → 403；Host 还必须 `localhost`、IP 字面量或 `allowHosts` 里的名字。DNS rebinding 的攻击者只能用域名，因此“Origin 与 Host 同时是 evil.example”也会被挡住；局域网 IP 不受影响，反代域名走 `allowHosts`。
2. 写操作必须 `application/json`：跨站表单发不出该 content-type；声明它会触发预检，而本路由只接受已声明的写方法与 JSON，预检直接 415。
3. 路径白名单：`Basket.resolve()` 只认登记表里的绝对路径，`../` 与任意路径在入口就返回 404。`/diff` 还要多过一道 `Basket.resolveChange()`：只有带 `seq + index` 的改动条目可读，扫描/`present` 进来的文件即便在筐里也没有对比可看。
4. zip 条目名过 `safeEntryName()`（去 `..`、去前导斜杠），清单名预留防撞；归档路径 `resolve` 后校验 `startsWith(root + sep)`，`mkdir` 后再用 `realpath` 确认父目录仍在归档根内，符号链接穿越记 `unsafe-path`；`archiveDir == cwd` 直接拒绝。cwd 外的文件在 zip 与归档里都进 `_external/<文件名>`，不做绝对路径镜像，重名加 `(2)`。开启 `archiveKeep` 后的清理只遍历 `runs/`，只删批次命名的普通目录，符号链接与当前批次跳过。
5. 归档与 zip 共用单文件上限：超限文件在 zip 里进 `skipped`、在归档里进 `failed`，面板会显示失败数，不再静默成功。
6. 内联预览的脚本隔离：`text/html`、`image/svg+xml` 这类会执行脚本的文档，`/file` 响应带 `Content-Security-Policy: sandbox`——文档照常渲染，但脚本不执行、源变 opaque，无法反手请求本机接口（0.1.2 及以前是裸奔的）。
7. 上限：单文件 64 MB、打包总量 512 MB、条目数 800、请求体 1 MB，均可通过配置调整。超限文件被跳过时用 `X-Whale-Catch-Skipped` 回传数量，界面不会「静默少文件」。
8. 差异的等待与取消：`/diff` 默认 8s 超时回 504；客户端断开时 `AbortSignal` 一路传到内核，读盘会真的停下。回传前按 1200 行裁剪，被截断 hunk 的 `oldLines` / `newLines` 按行首前缀重算，`@@` 头不会撒谎。
9. `/file` 支持单段 `Range`（206/416）与 `ETag`，PDF/大文件可拖动进度；响应关闭时读取流会 `destroy()`，不在后台继续读盘。

## 生命周期

- 路由注册在 `ctx.effect()` 里，disposer 同时清空会话表与定时器；插件卸载/热替换后不残留。
- 不修改 profile 的 `cordis.patch.yml`，配置走 profile 补丁层的 `id: dsh-whale-catch` 覆盖。
- 客户端注册全部走 `ctx.effect()`：字典、tab 类型、pane 席位随插件 fiber 释放。

## 为什么 schemastery 放在 dependencies 而不是 peer

官方指南要求「共享实例的 dsh 包只放 peer」——那条约束针对的是**注册服务、共享单例**的 `@deepseek-ai/dsh-*` 包。schemastery 是纯 schema 校验库，每个插件拿自己的副本没有任何副作用；而 profile 的 `pnpm-workspace.yaml` 写着 `autoInstallPeers: false`，所以写成 peer 就等于「不装」，Host 半边会在 `import` 阶段就抛 `ERR_MODULE_NOT_FOUND`，表现为路由 404、侧栏空白。

同类插件（如 dsh-whale-persona）也把它放在 `dependencies`，这是社区验证过的正确做法。契约自检脚本只允许这一个运行时依赖，出现别的会被拦下。

## 为什么不用 storage 服务持久化

鱼篓的内容可以从"会话事件 + 目录扫描"重建，没有不可推导的状态。重启后丢失的只有 `present` 的描述文本，而为一个描述文本引入 storage domain 的版本与迁移成本不划算。等"跨会话产物台账"真的要做时，再上 `ctx.storageDomain`。

## 已知缺口

- 跨会话视图（现在一个会话一个鱼篓）。
- `present` 描述的持久化。
- 差异只在 Host 存活期间可看：内核不持久化对比，重启后旧轮次只剩文件名。
- 更聪明的类型识别（现在按后缀；Office 文档内部类型没有嗅探）。
- 归档目录的自动整理策略（按日期/按项目/dry-run）；`archiveKeep` 只做了按批保留。
- cwd 外文件没有原生预览（`absolute` scope 当前不被 Document Preview 接受），仍走 `/file` 下载。
- 点开头的文件（`.env`、`.gitignore`）有意不扫描，避免把密钥类文件自动收进筐；需要交付时用 `present`。
- 文件列表按 200 行分批渲染、支持排序，但还没有真正的窗口化；搜索只做名称/路径/描述的子串匹配。
- zip 的 manifest 会写 cwd（主目录前缀脱敏为 `~`）与会话 id，分享前需要自己留意。

## 测试策略

- **纯函数**（`scan` / `basket` / `zip` / `http`）单独测，不碰 Host。
- **路由**用真实 `node:http` 服务 + `fetch` 打过去，测的是客户端实际会发的请求；覆盖 Range/ETag、cwd 外 zip 路径、归档失败与超大文件跳过。
- **client bundle** 用假 `window.__ModuleLoader__` + 假 React 装配一遍，断言注册了正确的 tab/slot/locale，并检查中英文字典键集一致。
- **插件入口**用假 `ctx` 装配，模拟 `deliverables/presented` 事件后真的能从 HTTP 读到文件；并验证 GET /basket 只读缓存、POST /refresh 才重扫。
- **原生预览地址**：纯函数测中文/空格/`#`、`..foo` 边界、cwd 外与空 session；`Basket.snapshot()` 断言 `native` 字段与删除后置空。
- **归档保留**：真实 HTTP 连打三次 `/archive`，断言只留最近两批、`pruned` 数量、手工目录不被误删；`archiveKeep = 0` 断言不建 `runs/` 且响应没有 `pruned`。
- **差异**：`trimDiff` 用纯函数测预算与行数重算；`/diff` 用真实 HTTP 测裁剪、无能力降级与超时中止；插件入口测 `seq + index` 真的透传到 `workspaceChanges.diff()`。
- **zip** 用手写解析 + Python `zipfile` 交叉验证（macOS 自带 unzip 对 UTF-8 条目名的落盘行为不可靠，所以不用它验中文名）；流式写入器用同一套解析验证，已压缩格式断言走 STORE。
