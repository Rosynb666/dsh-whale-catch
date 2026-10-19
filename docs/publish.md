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
git commit -m "feat: 深海鱼篓 v0.1.1 — 零登记的会话交付物收纳篮"

# 换成你刚建的仓库地址
git remote add origin https://github.com/Rosynb666/dsh-whale-catch.git
git push -u origin main
```

推上去之后，GitHub Actions 的 **CI** 工作流会自动在 Node 22 / 24 上跑 `npm run check` 与 `npm test`。

## 2. 打版本标签

```sh
git tag -a v0.1.1 -m "v0.1.1"
git push origin v0.1.1
```

标签是发布契约：**已经推上去的标签不要改指向**。force-push 一个已发布的标签，会让 GitHub Release、缓存和其他人的 clone 对不上；有修复就发 `0.1.2` 这样的新版本。`0.1.1` 就是这么来的——`v0.1.0` 打完后才发现隐私清单该补，于是向前发版而不是挪标签。

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

本机 `npm pack` 若报 `EPERM`（受限环境常把 `~/.npm` 缓存挡在写权限之外），换一个可写缓存即可，不用 sudo：

```sh
npm pack --dry-run --cache="$(mktemp -d)"
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
- [ ] `npm test` 全绿（35 项）
- [ ] `npm pack --dry-run` 的文件清单符合预期
- [ ] 在干净的 profile 里装一次：`dsh plugin --profile desktop add <tarball 或仓库地址>`
- [ ] 刷新页面，右侧栏 `+` 能看到「打开深海鱼篓」，点开能列出文件
- [ ] 勾两个文件打包，解压后路径与内容正确
- [ ] 归档一次，确认落在 `$DSH_HOME/whale-catch/archive/<sessionId>/` 下
- [ ] 卸载后右侧栏入口消失：`dsh plugin --profile desktop remove dsh-whale-catch`

## 6. 隐私检查（发布前必做）

预览图、示例数据、测试夹具最容易夹带真实工作区信息——文件名、目录结构、项目名。本项目就踩过一次：初版预览图里用的是真实课程作业文件名。

发布前跑一遍文本扫描：

```sh
# 真实路径、个人目录、具体项目名都不该出现在仓库里
git grep -nE "/Users/[a-z]+/(Desktop|Documents)|数据结构|蓝桥杯|能力自检|转换脚本|渲染证据" -- . ':!package-lock.json' ':!docs/publish.md' || echo "✅ 文本干净"
```

两个细节，都是被误报逼出来的：

- 示例路径统一用 `~` 开头（`~/Documents/...`）。写成 `/Users/you/...` 会被上面这条规则当成真实个人目录，扫一次报一次。
- `docs/publish.md` 自己带着 `数据结构`、`蓝桥杯` 这些关键词，必然命中，所以要用 `':!docs/publish.md'` 把自己排除。

图片没法 grep，打开 `docs/preview.png` 肉眼过一遍，确认文件名都是虚构的。本项目 `docs/preview.html` 的示例数据统一使用虚构名称：

| 用途 | 示例文件名 |
|---|---|
| 文档 | `项目周报.docx`、`产品手册.pdf` |
| 表格 | `预算表-2026.xlsx` |
| 演示 | `评审材料.pptx` |
| 代码 | `build.py` |
| 压缩包 | `素材包.zip` |

另外，只要旧版本曾经推到过公开仓库，**git 历史里仍然留着旧图**——force-push 只能断开引用，GitHub 仍会按旧 commit SHA 提供缓存。真要彻底清除，最稳的是删掉仓库重新建一个空仓库再推；只想清理 HEAD 的话，重写历史后记得让仓库主人手动删一次旧仓库。
