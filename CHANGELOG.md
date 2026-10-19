# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与 [SemVer](https://semver.org/lang/zh-CN/)。

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
