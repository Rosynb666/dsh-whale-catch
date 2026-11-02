# 参与开发

## 环境

- Node `^22.19 || >=24`
- 无构建步骤：`lib/index.js` 是 Host 半边，`lib/client.js` 原样交给 `window.__ModuleLoader__`
- 唯一运行时依赖是 `@deepseek-ai/schemastery`

## 本地检查

```sh
npm ci
npm run check   # 契约自检：包结构、patch、client.inject、locale meta、icon、依赖纪律
npm test        # node:test，纯函数 + 真实 http 路由 + client bundle 注册
npm run verify  # 两个都跑（发布前必须）
```

## 改动约定

- 新增路由参数或错误码时，同步补 `lib/http.js` 的 MIME / 错误码映射、客户端文案与 README。
- 文件读取、打包、归档、diff 一律经过 `Basket.resolve()` 白名单；不要在路由里直接拼路径读盘。
- 新增配置项要同时改 `Config`、`normalizeConfig`、README 配置表和归档/打包的上限检查。
- 客户端不引入构建依赖，不 require `react` 之外的模块；样式用 `--dsw-alias-*` / `--dsw-static-*` token。
- 改 zip / 路由 / 扫描行为时补测试；测试数变化要同步 README 与 `docs/publish.md`。

## 提交

Conventional Commits 风格（`feat:` / `fix:` / `docs:` / `ci:`），一次提交只做一件事。
发版走 tag + Release workflow，不要手动改已发布的 tag。

## 第一次提 PR

1. `git clone https://github.com/Rosynb666/dsh-whale-catch.git && cd dsh-whale-catch`
2. `npm ci`
3. 从 `main` 切分支：`git switch -c fix/说明你改了什么`
4. 改完本地自检：`npm run verify`（= `npm run check` + `npm test`）
5. 提交（规范见上一节），推分支后开 PR
6. PR 描述按 `.github/pull_request_template.md` 填，尤其是「怎么验证」——CI 只证明测试过了，不证明问题真的被修好
7. 等 CI 三平台（macOS / Windows / Linux × Node 22、24）全绿再合并

几个容易漏的点：

- 改动带上了新测试，README「开发与测试」与 `docs/publish.md` 里的测试数要一起改；契约自检不校验这个数字，漏了会静默失配。
- 不要手动改版本号，也不要在 PR 里动已发布的 tag；发版流程见 `docs/publish.md`。
- 碰 `/file`、`/zip`、`/archive`、`/diff` 的改动，PR 里要写清威胁模型与降级行为——这几条路由直接读用户磁盘，评审重点在边界而不是功能。
- 客户端不引入构建依赖；改 `lib/client.js` 后没有构建步骤，重装插件即可看到效果。
