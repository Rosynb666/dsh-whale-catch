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

**Release** 工作流会被触发，按顺序尝试两条发布路径：

1. **Trusted Publishing（OIDC）**——不需要任何 secret。先在 npm 包设置里把 GitHub 仓库绑上（见下一节），CI 用 `id-token` 换发布凭证，provenance 由 OIDC 签发。
2. **回落 `NPM_TOKEN`**——OIDC 没配好、或绑定信息对不上时才会用到。两条都不可用时工作流直接失败并报错，不再「静默跳过、只出 Release」（0.1.3 之前就是那样，很容易误以为发上去了）。

标签推上去之后也可以手动补发：**Actions → Release → Run workflow**，填要发布的 tag。适合「标签已经推了，但 npm 那步没成功」的场景，不用为补发再打一个空版本。

## 3. 发布到 npm

### 3.1 首选：Trusted Publishing（OIDC，无 secret）

npmjs.com → 你的包 → **Settings** → **Trusted Publishing** → Add a trusted publisher：

| 字段 | 值 |
|---|---|
| Provider | GitHub Actions |
| Organization or user | `Rosynb666` |
| Repository | `dsh-whale-catch` |
| Workflow filename | `release.yml` |
| Environment | 留空 |

配好之后 `release.yml` 的 OIDC 步骤就能直接发布，仓库里不用存 token。workflow 里已经写了 `permissions.id-token: write`，这是换取 OIDC 令牌的前提。

> npm 从 2027 年 1 月起收紧「绕过 2FA 的 token 直接发布」，OIDC 是官方方向。token 回落只是过渡期保险。

### 3.2 过渡：仓库 secret `NPM_TOKEN`

在 `Settings → Secrets and variables → Actions` → **Repository secrets**（不是 Environment secrets）加 `NPM_TOKEN`：

- Classic token 选 **Automation**，或 Granular token 勾 **Read and write** + 选中 `dsh-whale-catch`；
- **Bypass two-factor authentication (2FA)** 要勾——CI 里没人能输 OTP；
- 设一个过期时间，到期前换新的，别用永不过期的 token。

### 3.3 手动发（应急）

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

应该看到：`lib/`、`locale/`、`cordis.patch.yml`、`icon.svg`、`README*`、`CHANGELOG.md`、`docs/architecture.md`、`screenshots.json`、`LICENSE`。

## 4. 让社区能找到

- 给仓库加 topics：`dsh` `dsh-plugin` `deepseek-harness` `cordis` `deliverables` `zip`。
- 向 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 提 PR 收录（按它的模板填：名称、一句话简介、安装命令、分类 `tools` / `session`）。
- 在 README 里贴一张真实截图（把右侧栏鱼篓展开截下来就行），比任何徽章都有说服力。

## 5. 发版前自检

```sh
npm run verify
```

- [ ] `npm run check` 全绿（包结构 / patch / client.inject / meta / icon / 依赖纪律）
- [ ] `npm test` 全绿（68 项）
- [ ] npm 发布路径可用：npm 包里已绑定 Trusted Publishing，或仓库里有有效的 `NPM_TOKEN` 回落
- [ ] `npm pack --dry-run` 的文件清单符合预期
- [ ] 在干净的 profile 里装一次（Desktop 走 设置 → 插件 → 安装，CLI 用 `dsh plugin --profile <profile> add <tarball 或仓库地址>`）
- [ ] 刷新页面，右侧栏 `+` 能看到「打开深海鱼篓」，点开能列出文件
- [ ] 勾两个文件打包，解压后路径与内容正确，且包含 `_whale-catch/manifest.json` 与 `交付清单.md`
- [ ] 点开一条改动文件的「差异」能看到 hunk（`+` / `−` 着色）；扫描进来的文件没有「差异」按钮
- [ ] 任意 cwd 内文件点「预览」能在右侧栏打开 DSH Document Preview（md / 图片 / PDF / Office）；cwd 外文件提示不可预览
- [ ] 切换排序、点「显示更多」、搜索 / 分组组合工作正常
- [ ] 归档一次，确认落在 `$DSH_HOME/whale-catch/archive/<sessionId>/` 下；设 `archiveKeep: 2` 后连归档三次只剩两个批次
- [ ] 卸载后右侧栏入口消失（Desktop：设置 → 插件 → 卸载）

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
