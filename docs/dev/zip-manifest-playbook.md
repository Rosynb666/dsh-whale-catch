# 深海鱼篓 0.2.1 开发手册：zip 交付清单

> 适用起点：`main` = `24bca76`（0.2.0）
> 目标版本：`0.2.1`，给打出来的 zip 附上 `manifest.json` 与 `交付清单.md`
> 使用方式：在 IDEA 里打开仓库，照阶段 0 → 阶段 8 走；每阶段结尾都有检查点
> 状态：0.2.1 已实现（2026-10-28），本手册保留为同类改动的参考流程

---

## 0. 速览

**项目**：`dsh-whale-catch` / 深海鱼篓，DeepSeek Harness 的右侧栏插件，零登记收集本场会话产出或改动的文件，支持预览、看差异、打包 zip、归档。

- 仓库：https://github.com/Rosynb666/dsh-whale-catch
- npm：https://www.npmjs.com/package/dsh-whale-catch
- 当前发布版：`0.2.0`（2026-10-24 发布，provenance 由 OIDC 签发）

**四条不变量**（改任何东西都不能破）：

1. 不新增 session event 类型
2. 所有读文件 / 打包 / 看差异都走路径白名单
3. 无构建步骤，`lib/client.js` 原样交给 `__ModuleLoader__`
4. 运行时依赖只有 `@deepseek-ai/schemastery`

**当前状态**：

| 项 | 值 |
|---|---|
| 本地分支 | `main`，干净，`24bca76` |
| 远端 main | `24bca76` |
| npm latest | `0.2.0` |
| 桌面端 profile | `0.2.0` |

---

## 1. 这次要做的事（一张图）

```text
建分支 feat/zip-manifest
   ↓
改 lib/routes.js（3 处：import、helper、zip 分支）
   ↓
加 test/routes.test.js（1 条测试 + 复用 zip 解析器）
   ↓
npm run verify            → 契约自检 + 50 项测试
   ↓
装本地目录 + 重启应用      → 真机打包验收
   ↓
commit → push 分支 → CI 双绿 → 合并 main
   ↓
npm version patch → 改 CHANGELOG/README → tag v0.2.1 → 推 tag
   ↓
Release 工作流 → npm 0.2.1 + GitHub Release
```

**验收标准**：解压后多出 `_whale-catch/manifest.json` 与 `_whale-catch/交付清单.md`；`manifest.files` 条数 = 包内业务文件数；每个 `sha256` 与文件对得上；中文名不乱码；`npm run verify` 全绿且测试 50 项。

---

## 2. 在哪运行 / 用什么工具

### 2.1 目录

| 用途 | 路径 |
|---|---|
| 仓库根（大部分命令在这里） | `/Users/leiou/Desktop/鲸鱼娘的工作区💦/dsh-whale-catch` |
| IDEA 打开的目录 | 上面这个仓库根，**不要**打开外层工作区 |
| DSH profile | `~/.dsh/profiles/desktop` |
| 下载的 zip | `~/Downloads` |

### 2.2 IDEA 配置

1. `File → Open` → 选 `dsh-whale-catch`
2. `Settings → Languages & Frameworks → Node.js` → Node interpreter 选 `/usr/local/bin/node`（v24.16.0）
3. 终端：`Option + F12`（`View → Tool Windows → Terminal`）
4. 跑测试：`package.json` 左边沟里的 ▶，或终端 `npm test`
5. 调试单文件：Run → Edit Configurations → Node.js，`Node parameters` 填 `--test`，JS file 选测试文件
6. 代码风格（可选）：`Settings → Editor → Code Style → JavaScript`，Tab 2 空格、分号 Never

### 2.3 推送钥匙（一次配置，永久生效）

仓库远端走 SSH，本机用仓库专用 deploy key：

```sh
# 在仓库根目录运行
git config core.sshCommand "ssh -i '/Users/leiou/Desktop/鲸鱼娘的工作区💦/_github_deploy/dsh-whale-catch_ed25519' -o IdentitiesOnly=yes -o UserKnownHostsFile='/Users/leiou/Desktop/鲸鱼娘的工作区💦/_github_deploy/known_hosts' -o StrictHostKeyChecking=accept-new"
```

IDEA 里推不上去：`Settings → Version Control → Git → SSH executable` 改 `Native`。

### 2.4 命令速查（在哪跑）

| 命令 | 在哪运行 | 作用 |
|---|---|---|
| `npm test` | 仓库根 | 跑全部测试 |
| `node --test test/routes.test.js` | 仓库根 | 只跑路由测试 |
| `node --check lib/routes.js` | 仓库根 | 只做语法检查 |
| `npm run check` | 仓库根 | 契约自检 |
| `npm run verify` | 仓库根 | 自检 + 全部测试 |
| `dsh plugin --profile desktop add "<仓库绝对路径>"` | 任意目录 | 把本地目录装进桌面端 |
| `dsh plugin --profile desktop add dsh-whale-catch@0.2.0` | 任意目录 | 换回 npm 正式版 |
| `curl -s http://127.0.0.1:<端口>/whale-catch/api/ping` | 任意目录 | 看运行中的 Host 版本 |
| `unzip -l/-p` | `~/Downloads` | 检查打出来的 zip |
| `git ...` | 仓库根 | 分支、提交、推送、打 tag |

> `dsh` 不在 PATH 里，完整路径是：
> `/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh`
> 想省事可以在 `~/.zshrc` 里加一个 alias。

---

## 3. 阶段 0：开工检查

**目的**：确认起点干净、基线是绿的。

```sh
# 在仓库根目录运行
cd "/Users/leiou/Desktop/鲸鱼娘的工作区💦/dsh-whale-catch"
git status --short          # 期望：无输出
git log --oneline -1        # 期望：24bca76 feat: 0.2.0 —— …
git switch -c feat/zip-manifest
npm test                    # 期望：ℹ tests 49 / ℹ pass 49 / ℹ fail 0
```

✅ **检查点**：`49 pass`，分支切到 `feat/zip-manifest`。

**不绿怎么办**：先别改代码。`node -v` 看是不是 ≥ 22.19；`npm install` 之后重试。

---

## 4. 阶段 1：加 import（1 分钟）

**文件**：`lib/routes.js`
**位置**：文件顶部 import 区，`import fs from 'node:fs'` 的上一行

```js
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
```

**在仓库根运行**：

```sh
node --check lib/routes.js
```

✅ **检查点**：无输出。

---

## 5. 阶段 2：加清单渲染函数（5 分钟）

**文件**：`lib/routes.js`
**位置**：`function stampName(name)` 结束之后、`async function uniquePath(file)` 之前

```js
/**
 * zip 里的「交付清单.md」：不打开插件也能看懂这一包是什么。
 * @param {any} manifest
 * @returns {string}
 */
function buildChecklist(manifest) {
  const lines = [
    '# 交付清单',
    '',
    `- 会话：\`${manifest.session}\``,
    `- 目录：\`${manifest.cwd}\``,
    `- 生成：${manifest.generatedAt}`,
    '',
    '| 文件 | 体积 | 轮次 | 行数 | 来源 |',
    '| --- | --- | --- | --- | --- |',
  ]
  for (const file of manifest.files) {
    const delta = typeof file.added === 'number' ? `+${file.added} −${file.deleted}` : '—'
    const name = String(file.name).replace(/\|/g, '\\|')
    lines.push(`| ${name} | ${file.size} B | ${file.turn ?? '—'} | ${delta} | ${file.sources.join('/')} |`)
  }
  if (manifest.skipped.length > 0) {
    lines.push('', `跳过（超过单文件上限）：${manifest.skipped.join('、')}`)
  }
  return lines.join('\n')
}
```

**在仓库根运行**：

```sh
node --check lib/routes.js
```

✅ **检查点**：无输出。

---

## 6. 阶段 3：改 zip 分支（核心，20 分钟）

**文件**：`lib/routes.js`
**位置**：搜 `if (route === 'zip' && method === 'POST')`

### 6.1 把「读文件」拆成 `packed`

**找到并整段替换**：

```js
        /** @type {{name: string, data: Buffer, mtimeMs: number}[]} */
        const entries = []
        /** @type {string[]} 超过单文件上限、被跳过的文件（0.1.3 起不再静默吞掉） */
        const skipped = []
        let total = 0
        for (const file of selected) {
          if (file.size > config.maxFileBytes) {
            skipped.push(file.name)
            continue
          }
          total += file.size
          if (total > config.maxZipBytes) {
            sendError(res, 413, 'zip-too-large', '选中的文件总量超过打包上限')
            return
          }
          try {
            entries.push({ name: toPosix(file.rel), data: await fsp.readFile(file.path), mtimeMs: file.mtimeMs })
          } catch {
            // 打包途中被删：跳过，不让整包失败
          }
        }
        if (entries.length === 0) {
          if (skipped.length > 0) {
            sendError(res, 413, 'all-too-large', `选中的 ${skipped.length} 个文件都超过单文件上限`)
            return
          }
          sendError(res, 400, 'empty', '没有可打包的文件')
          return
        }
```

**替换为**：

```js
        /** @type {{file: any, data: Buffer}[]} 真正读进内存、要进包的文件 */
        const packed = []
        /** @type {string[]} 超过单文件上限、被跳过的文件（0.1.3 起不再静默吞掉） */
        const skipped = []
        let total = 0
        for (const file of selected) {
          if (file.size > config.maxFileBytes) {
            skipped.push(file.name)
            continue
          }
          total += file.size
          if (total > config.maxZipBytes) {
            sendError(res, 413, 'zip-too-large', '选中的文件总量超过打包上限')
            return
          }
          try {
            packed.push({ file, data: await fsp.readFile(file.path) })
          } catch {
            // 打包途中被删：跳过，不让整包失败
          }
        }
        if (packed.length === 0) {
          if (skipped.length > 0) {
            sendError(res, 413, 'all-too-large', `选中的 ${skipped.length} 个文件都超过单文件上限`)
            return
          }
          sendError(res, 400, 'empty', '没有可打包的文件')
          return
        }
```

> ⚠️ 空判断必须从 `entries.length` 改成 `packed.length`，否则后面 `entries` 还没定义就会 `ReferenceError`。

### 6.2 拼 manifest 与 entries

**找到这一行**：

```js
        const archive = buildZip(entries)
```

**替换为**：

```js
        const manifest = {
          generatedBy: 'dsh-whale-catch',
          session: snapshot.session,
          cwd: snapshot.cwd,
          generatedAt: new Date().toISOString(),
          files: packed.map(({ file, data }) => ({
            path: file.rel,
            name: file.name,
            size: data.length,
            mtime: new Date(file.mtimeMs).toISOString(),
            sources: file.sources,
            turn: file.turn,
            description: file.description,
            added: file.added,
            deleted: file.deleted,
            sha256: createHash('sha256').update(data).digest('hex'),
          })),
          skipped,
        }

        const entries = packed.map(({ file, data }) => ({
          name: toPosix(file.rel),
          data,
          mtimeMs: file.mtimeMs,
        }))
        entries.push({
          name: '_whale-catch/manifest.json',
          data: Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'),
          mtimeMs: Date.now(),
        })
        entries.push({
          name: '_whale-catch/交付清单.md',
          data: Buffer.from(buildChecklist(manifest), 'utf8'),
          mtimeMs: Date.now(),
        })

        const archive = buildZip(entries)
```

### 6.3 自检

```sh
# 在仓库根运行
node --check lib/routes.js
npm test
```

✅ **检查点**：`49 pass`（老测试只验 PK 头和归档，不数条目，所以应该还是 49）。

**常见错误**：

| 症状 | 原因 | 修法 |
|---|---|---|
| `ReferenceError: entries is not defined` | 6.2 没做，或 6.1 没改 `packed.length` | 对照 6.1/6.2 完整替换 |
| `ReferenceError: skipped is not defined` | 把 `const skipped` 删了 | 保留声明 |
| 包里文件变少 | `packed.push` 写成了别的东西 | 检查 push 目标 |
| 语法错在 `})` 附近 | 大括号配对错 | 让 IDEA 自动格式化（`⌥⌘L`）后看红波浪线 |

---

## 7. 阶段 4：写测试（20 分钟）

**文件**：`test/routes.test.js`

### 7.1 顶部补 import

**位置**：`import path from 'node:path'` 下面

```js
import { createHash } from 'node:crypto'
import { inflateRawSync } from 'node:zlib'
```

### 7.2 复用 zip 解析器

**位置**：`async function serve(store, overrides) {` 之前

```js
/**
 * 手工解析 zip：从 EOCD 找中央目录，再按偏移读本地头。
 * 不依赖任何 zip 库，这样测试本身也在验证格式而不是验证同一个实现。
 * @param {Buffer} buffer
 */
function readZip(buffer) {
  let eocd = -1
  for (let i = buffer.length - 22; i >= 0; i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  assert.notEqual(eocd, -1, '找不到 EOCD')
  const count = buffer.readUInt16LE(eocd + 10)
  const centralOffset = buffer.readUInt32LE(eocd + 16)

  const entries = []
  let cursor = centralOffset
  for (let i = 0; i < count; i += 1) {
    assert.equal(buffer.readUInt32LE(cursor), 0x02014b50)
    const method = buffer.readUInt16LE(cursor + 10)
    const crc = buffer.readUInt32LE(cursor + 16)
    const compressedSize = buffer.readUInt32LE(cursor + 20)
    const size = buffer.readUInt32LE(cursor + 24)
    const nameLength = buffer.readUInt16LE(cursor + 28)
    const localOffset = buffer.readUInt32LE(cursor + 42)
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8')

    const localNameLength = buffer.readUInt16LE(localOffset + 26)
    const localExtraLength = buffer.readUInt16LE(localOffset + 28)
    const dataStart = localOffset + 30 + localNameLength + localExtraLength
    const raw = buffer.subarray(dataStart, dataStart + compressedSize)
    const data = method === 8 ? inflateRawSync(raw) : raw

    entries.push({ name, method, crc, size, data })
    cursor += 46 + nameLength + buffer.readUInt16LE(cursor + 30) + buffer.readUInt16LE(cursor + 32)
  }
  return entries
}
```

### 7.3 追加测试

**位置**：`test/routes.test.js` 文件末尾

```js
test('zip 里带交付清单：manifest 与清单.md 都在，sha256 对得上', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'whale-routes-'))
  const server = await serve(await makeStore(dir, [
    { rel: '报告.docx', content: 'docx' },
    { rel: 'note.txt', content: 'hello' },
  ]))
  t.after(async () => {
    await server.close()
    await fs.rm(dir, { recursive: true, force: true })
  })

  const response = await fetch(`${server.base}zip`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ session: 'session-test', paths: [] }),
  })
  assert.equal(response.status, 200)

  const entries = readZip(Buffer.from(await response.arrayBuffer()))
  const manifestEntry = entries.find((entry) => entry.name === '_whale-catch/manifest.json')
  assert.ok(manifestEntry, 'manifest 必须进包')

  const manifest = JSON.parse(manifestEntry.data.toString('utf8'))
  assert.equal(manifest.session, 'session-test')
  assert.equal(manifest.files.length, 2, '清单只数业务文件，不含清单自己')

  const doc = manifest.files.find((file) => file.name === '报告.docx')
  assert.equal(doc.sha256, createHash('sha256').update('docx').digest('hex'))

  const checklist = entries.find((entry) => entry.name === '_whale-catch/交付清单.md')
  assert.ok(checklist, '清单.md 必须进包')
  assert.match(checklist.data.toString('utf8'), /\| 报告\.docx \|/)
})
```

### 7.4 跑单文件

```sh
# 在仓库根运行
node --test test/routes.test.js
```

✅ **检查点**：`ℹ tests 14` / `ℹ pass 14`（原来是 13）。

---

## 8. 阶段 5：全量验证

```sh
# 在仓库根运行
npm run verify
```

✅ **检查点**：

```text
全部通过
ℹ tests 50
ℹ pass 50
ℹ fail 0
```

顺手看发布包内容（不会真的生成文件）：

```sh
npm pack --dry-run --cache="$(mktemp -d)" | tail -6
```

---

## 9. 阶段 6：装进桌面端真机验

### 9.1 装本地目录

```sh
# 任意目录运行；dsh 不在 PATH，用完整路径
"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" \
  plugin --profile desktop add "/Users/leiou/Desktop/鲸鱼娘的工作区💦/dsh-whale-catch"
```

### 9.2 判断是链接还是拷贝

```sh
ls -l ~/.dsh/profiles/desktop/node_modules/ | grep dsh-whale-catch
```

- 带 `->`：链接，改代码后重启应用即生效
- 不带：拷贝，每次改完都要重跑 9.1

### 9.3 重启应用

**⌘Q 退出 DeepSeek Harness，再打开**（不是 ⌘R；⌘R 只刷新浏览器半边，会出现客户端 0.2.0 + Host 旧代码的错配）。

### 9.4 造一次交付

在会话里生成两个文件 → 右栏鱼篓 → 全选 → 打包 zip。

### 9.5 验包

```sh
# 在 ~/Downloads 运行
unzip -l 你的包.zip | grep _whale-catch
unzip -p 你的包.zip _whale-catch/manifest.json | python3 -m json.tool | head -30
unzip -p 你的包.zip _whale-catch/交付清单.md | head -20
```

✅ **检查点**：两个条目都在；`files` 条数正确；中文名正常；清单里 sha256 有值。

### 9.6 换回 npm 正式版

```sh
"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" \
  plugin --profile desktop add dsh-whale-catch@0.2.0
```

再重启一次应用。

---

## 10. 阶段 7：提交、推送、合并

```sh
# 在仓库根运行
git add -A
git diff --cached --stat
git commit -m "feat: zip 内附交付清单（manifest + 清单.md）"
git push -u origin feat/zip-manifest
```

打开 https://github.com/Rosynb666/dsh-whale-catch/actions ，等 node 22/24 两个 job 绿。

```sh
# 在仓库根运行
git switch main
git merge --ff-only feat/zip-manifest
git push origin main
```

✅ **检查点**：main 的 CI 也绿。

---

## 11. 阶段 8：发 0.2.1

### 11.1 改版本号

```sh
# 在仓库根运行
npm version patch --no-git-tag-version   # 0.2.0 → 0.2.1，同步 package-lock
```

### 11.2 手改三处文档

| 文件 | 改什么 |
|---|---|
| `CHANGELOG.md` | 顶部加 `## [0.2.1] - 2026-10-27`，写新增与测试数 |
| `README.md` | `49 项` → `50 项`；`界面` 一节可补一句「zip 内附交付清单」 |
| `README.en.md` | `49 tests` → `50 tests` |
| `docs/publish.md` | `49 项` → `50 项` |

### 11.3 验证并发布

```sh
# 在仓库根运行
npm run verify
git add -A
git commit -m "chore: release 0.2.1"
git push origin main
git tag -a v0.2.1 -m "v0.2.1"
git push origin v0.2.1
```

✅ **检查点**：

- Release 工作流成功
- `npm view dsh-whale-catch version` 输出 `0.2.1`
- GitHub Releases 页面出现 v0.2.1

---

## 12. 附录 A：下一个功能「只看本轮」

### 12.1 Host 侧

`lib/basket.js` 的 `snapshot()`：

```js
// 计数器附近
let lastTurn = null

// 循环里，change 统计旁边
if (Number.isFinite(entry.turn)) {
  lastTurn = lastTurn === null ? entry.turn : Math.max(lastTurn, entry.turn)
}

// return 的 totals 里
totals: { count: files.length, bytes, missing, changed, added, deleted, lastTurn },
```

### 12.2 客户端

`lib/client.js` 状态区（`groupedState` 附近）：

```js
var onlyLatestState = React.useState(false)
var onlyLatest = onlyLatestState[0]
var setOnlyLatest = onlyLatestState[1]
```

过滤逻辑（现在的 `visible`）：

```js
var lastTurn = data && data.totals && Number(data.totals.lastTurn) > 0
  ? Number(data.totals.lastTurn)
  : null

var visible = files.filter(function (file) {
  if (filter !== 'all' && file.kind !== filter) return false
  if (onlyLatest && lastTurn !== null) return file.turn === lastTurn
  return true
})
```

工具栏加 chip（`copyList` 按钮旁边）：

```js
lastTurn === null ? null : h('button', {
  type: 'button',
  onClick: function () { setOnlyLatest(!onlyLatest) },
  style: chipStyle(onlyLatest),
}, format(t('onlyTurn'), { n: lastTurn })),
```

两份词典都加：

```js
'onlyTurn': '仅第 {n} 轮',        // zh
'onlyTurn': 'Turn {n} only',      // en
```

### 12.3 测试

`test/basket.test.js`：两轮改动后 `totals.lastTurn` 取较大值；只有扫描文件时是 `null`。

---

## 13. 附录 B：present 描述持久化（sidecar）

### 13.1 `lib/basket.js`

构造函数里加：

```js
this.restored = new Map()
```

新增两个方法（放在 `#touch` 之前）：

```js
restore(items) {
  for (const item of items ?? []) {
    if (!item || typeof item.rel !== 'string') continue
    const abs = path.isAbsolute(item.rel) ? path.normalize(item.rel) : path.resolve(this.cwd, item.rel)
    this.restored.set(abs, { description: item.description, turn: item.turn })
  }
}

descriptors() {
  const out = []
  for (const [abs, entry] of this.entries) {
    if (entry.description === undefined && entry.turn === undefined) continue
    out.push({ rel: displayPath(this.cwd, abs), description: entry.description ?? null, turn: entry.turn ?? null })
  }
  return out
}
```

`#touch` 里，新建 entry 时回填：

```js
const memo = this.restored.get(abs)
if (memo !== undefined) {
  if (typeof memo.description === 'string') entry.description = memo.description
  if (Number.isFinite(memo.turn)) entry.turn = memo.turn
  this.restored.delete(abs)
}
```

### 13.2 `lib/index.js`

顶部加：

```js
import fsp from 'node:fs/promises'
```

`createStore()` 里：

```js
const sidecarDir = path.join(dshHome(), 'whale-catch', 'sessions')
const sidecarTimers = new Map()

function readSidecar(sessionId) {
  try {
    const raw = readFileSync(path.join(sidecarDir, `${sessionId}.json`), 'utf8')
    const parsed = JSON.parse(raw)
    return parsed && Array.isArray(parsed.files) ? parsed.files : undefined
  } catch {
    return undefined
  }
}

function saveSoon(sessionId) {
  if (sidecarTimers.has(sessionId)) return
  const timer = setTimeout(() => {
    sidecarTimers.delete(sessionId)
    persist(sessionId).catch(() => {})
  }, 500)
  if (typeof timer.unref === 'function') timer.unref()
  sidecarTimers.set(sessionId, timer)
}

async function persist(sessionId) {
  const record = baskets.get(sessionId)
  if (record === undefined) return
  await fsp.mkdir(sidecarDir, { recursive: true })
  const target = path.join(sidecarDir, `${sessionId}.json`)
  const tmp = `${target}.${process.pid}.tmp`
  await fsp.writeFile(tmp, JSON.stringify({ cwd: record.basket.cwd, files: record.basket.descriptors() }), 'utf8')
  await fsp.rename(tmp, target)
}
```

`ensure()` 里，`new Basket(...)` 之后：

```js
const memo = readSidecar(sessionId)
if (memo !== undefined) record.basket.restore(memo)
```

`observe()` 里，`addPresented` 与 `addChanged` 之后调用 `saveSoon(sessionId)`。

`dispose()` 里：

```js
for (const timer of sidecarTimers.values()) clearTimeout(timer)
sidecarTimers.clear()
```

---

## 14. 附录 C：常见错误速查

| 现象 | 大概率原因 | 处理 |
|---|---|---|
| `npm test` 一开始就红 | 依赖没装 / Node 太旧 | `npm install`；`node -v` ≥ 22.19 |
| `ReferenceError: entries is not defined` | 6.1 改了循环但没改 6.2 | 按 6.1 + 6.2 完整替换 |
| `找不到 EOCD` | 响应不是 zip / 空 Buffer | 打日志看 status 与长度 |
| 测试里 `manifest 必须进包` 失败 | `entries.push` 在 `buildZip` 之后 | 调整顺序 |
| `git push` 报 publickey | `core.sshCommand` 没配 / IDEA 用 Built-in SSH | 按 2.3 配；IDEA 改 Native |
| CI `npm ci` 失败 | 改了依赖但没更新 lockfile | 在仓库根 `npm install` 后提交 `package-lock.json` |
| 真机看不到新代码 | 没重启 / 装的是 npm 版 | 确认 9.2 是链接，然后 ⌘Q 重开 |
| zip 中清单乱码 | 用了对 UTF-8 支持差的解压工具 | 换 macOS 归档工具 / `unzip` 验证 |
| 工作区恰好有 `_whale-catch/` 目录 | 条目名冲突 | 改前缀（如 `_whale-catch-basket/`）或提示用户 |

---

## 15. 附录 D：发布前验收清单

- [ ] `npm run verify` 全绿（契约自检 + 50 项测试）
- [ ] `npm pack --dry-run` 文件清单符合预期
- [ ] 版本号已改：`package.json`、`package-lock.json`、CHANGELOG
- [ ] 真机验证：打包含 `_whale-catch/`，清单内容正确
- [ ] 桌面端换回 npm 正式版
- [ ] main 的 CI 绿
- [ ] tag 指向的 commit 是发布提交
- [ ] Release 工作流成功，npm 版本已更新
- [ ] 隐私扫描干净：

```sh
# 在仓库根运行
git grep -nE "/Users/[a-z]+/(Desktop|Documents)|数据结构|蓝桥杯|能力自检|转换脚本|渲染证据" -- . ':!package-lock.json' ':!docs/publish.md' || echo "文本干净"
```

---

## 16. 附录 E：钥匙、回滚、求助

### 16.1 deploy key

- 私钥：`/Users/leiou/Desktop/鲸鱼娘的工作区💦/_github_deploy/dsh-whale-catch_ed25519`（600，仓库外，不进 git）
- 撤销：GitHub → 仓库 Settings → Deploy keys → Remove；再删本地 `_github_deploy/`
- 泄露处理：先撤销 GitHub 那把，再重新生成

### 16.2 回滚

```sh
# 丢掉没提交的改动
git restore .

# 丢掉整个分支（还没合并时）
git switch main
git branch -D feat/zip-manifest

# 已经合并但没发版：revert 那个 commit
git revert <sha>
```

已经发了 npm 的版本不要改 tag 指向；有修就发 `0.2.2`。

### 16.3 求助格式

卡住时把这三行发出来：

```text
阶段：6.1
命令：npm test
报错：<完整报错，别截断>
```

或者直接 `git diff` 贴出来，我帮你逐行看。
