# 发布清单

从本地仓库到 GitHub Release（再到 npm）的完整步骤。每一步都能单独验证。

## 0. 仓库元数据（已完成）

`package.json` 的 `repository` / `homepage` / `bugs` 与两份 README 的安装示例已填为 `Rosynb666/dsh-whale-catch`。若以后换 owner 或改名，用下面的脚本一次替换，再跑一遍自检：

```sh
# 在仓库根目录，把旧 owner 换成新 owner
python3 - <<'PY'
import pathlib
for p in ['package.json', 'README.md', 'README.en.md']:
    f = pathlib.Path(p)
    f.write_text(f.read_text().replace('Rosynb666', 'your-github-name'))
    print('patched', p)
PY

npm run verify   # 改完再跑一次契约自检 + 测试
```

## 1. 建仓库并推上去

在 GitHub 网页上新建一个**空仓库**（不要勾 README / .gitignore / license，否则首次推送要处理冲突），例如 `dsh-whale-catch`。然后：

```sh
cd dsh-whale-catch
git init -b main
git add -A
git commit -m "feat: 深海鱼篓 v0.1.0 — 零登记的会话交付物收纳篮"

# 换成你刚建的仓库地址
git remote add origin https://github.com/Rosynb666/dsh-whale-catch.git
git push -u origin main
```

推上去之后，GitHub Actions 的 **CI** 工作流会自动在 Node 22 / 24 上跑 `npm run check` 与 `npm test`。

## 2. 打版本标签

```sh
git tag -a v0.1.0 -m "v0.1.0"
git push origin v0.1.0
```

**Release** 工作流会被触发：跑一遍 `npm run verify`，然后在有 `NPM_TOKEN` 时发布到 npm，并创建 GitHub Release（自动生成变更说明）。

在仓库 `Settings → Secrets and variables → Actions` 里加 `NPM_TOKEN`（npm 账号的 Automation token）才会真的发 npm；不加就只出 GitHub Release。

## 3. 发布到 npm（可选但推荐）

```sh
npm login
npm publish --access public
```

发布前先本地看一眼包内容，确认 `files` 白名单没漏东西：

```sh
npm pack --dry-run
```

应该看到：`lib/`、`locale/`、`cordis.patch.yml`、`icon.svg`、`README*`、`CHANGELOG.md`、`docs/architecture.md`、`LICENSE`。

## 4. 让社区能找到

- 给仓库加 topics：`dsh` `dsh-plugin` `deepseek-harness` `cordis` `deliverables` `zip`。
- 向 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 提 PR 收录（按它的模板填：名称、一句话简介、安装命令、分类 `tools` / `session`）。
- 在 README 里贴一张真实截图（把右侧栏鱼篓展开截下来就行），比任何徽章都有说服力。

## 5. 发版前自检

```sh
npm run verify
```

- [ ] `npm run check` 全绿（包结构 / patch / client.inject / meta / icon / 依赖纪律）
- [ ] `npm test` 全绿（34 项）
- [ ] `npm pack --dry-run` 的文件清单符合预期
- [ ] 在干净的 profile 里装一次：`dsh plugin --profile desktop add <tarball 或仓库地址>`
- [ ] 刷新页面，右侧栏 `+` 能看到「打开深海鱼篓」，点开能列出文件
- [ ] 勾两个文件打包，解压后路径与内容正确
- [ ] 归档一次，确认落在 `$DSH_HOME/whale-catch/archive/<sessionId>/` 下
- [ ] 卸载后右侧栏入口消失：`dsh plugin --profile desktop remove dsh-whale-catch`
