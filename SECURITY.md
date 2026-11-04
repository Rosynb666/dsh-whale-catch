# 安全说明

深海鱼篓的接口挂在 DSH 本机 Host 的 `/whale-catch/api/` 下，默认只监听 loopback。
威胁模型与更远的“本机其它进程”不同：**重点防的是浏览器里的第三方页面借用户身份打本机接口**（CSRF / DNS rebinding）。

## 已实现的边界

- 路径白名单：所有读文件、打包、归档、diff 接口只接受已在鱼篓登记表里的绝对路径。
- 同源检查：`Origin` 必须与 `Host` 一致；`Sec-Fetch-Site: cross-site` 直接拒绝。
- Host 白名单：只接受 `localhost`、IP 字面量与配置里的 `allowHosts`，用于挡住 DNS rebinding 下“Origin 与 Host 同时是攻击者域名”的情况。反代到自定义域名时，把它加进 `allowHosts`。
- 写操作要求 `application/json`，跨站表单无法直接构造。
- HTML / SVG 内联预览带 `Content-Security-Policy: sandbox`，脚本不执行、源为 opaque。
- zip / 归档路径做了上跳段与根目录校验；cwd 外文件统一进 `_external/`。
- **还原是唯一往工作区写文件的接口**：清单里的 `rel` / `stored` 必须是安全相对路径，源在批次目录内、目标在 cwd 内；符号链接目标拒绝；默认 `skip`，覆盖前先备份到归档目录。
- **回执**全字段 HTML 转义，响应强制 `Content-Disposition: attachment` 与 `CSP: sandbox`；文件名里的脚本不会在应用源上执行。
- **交付体检**的内容扫描只在内存里读文件头 64 KiB，只回传命中的模式名与行号，不回传原文。
- **内容搜索**只搜鱼篓里的文本文件，字面匹配、不支持正则；每文件 64 KiB、总预算 3 秒。
- `/ledger` 的 `run` 必须匹配批次名格式；清单读取用 `realpath` 确认仍在归档根内。
- 单文件、打包总量、请求体、文件数量都有上限，且可通过配置收紧。

## 不在防护范围内

- 本机上能直接读你文件的其它进程。
- 用户主动把会话 id、路径或归档目录分享出去之后造成的泄露。
- zip 内的 `_whale-catch/manifest.json` 会记录 cwd（主目录前缀已脱敏为 `~`）、会话 id 与 sha256；分享前请自行检查。
- `ledger/*.jsonl`、`manifest.json`、回执与交付备注都留在本机；交付备注是明文，别把密码写进去。

## 报告问题

请不要公开提交可利用细节。优先使用 GitHub 仓库的 **Security → Report a vulnerability**（私有安全公告），并附上复现步骤、受影响版本与请求样例。
