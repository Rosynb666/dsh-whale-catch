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
