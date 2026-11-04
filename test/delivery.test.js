import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { apply } from '../lib/index.js'
import { API_PREFIX } from '../lib/routes.js'

/**
 * 0.4 的端到端链路：归档落清单 → 台账能查 → 回执能下 → 搜索能中 →
 * 归档对比能读 → 还原能写回 → 交付状态能回填。
 *
 * 用真实的 createStore + apply，不打桩 store：新代码最容易错的地方就是
 * 这几层之间的字段名与路径。
 */
test('0.4 交付链路：归档清单 / 台账 / 回执 / 搜索 / 归档对比 / 还原 / 交付状态', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'whale-delivery-'))
  const cwd = path.join(root, 'work')
  await fs.mkdir(cwd, { recursive: true })
  const file = path.join(cwd, '报告.txt')
  await fs.writeFile(file, 'hello\n毛利率 42%\n', 'utf8')

  const session = { id: 'session-delivery', header: { cwd, createdAt: Date.now() - 60_000 } }
  /** @type {{route?: any}} */
  const captured = {}
  const ctx = {
    get(service) {
      if (service === 'agents') return { get: () => ({ session }) }
      if (service === 'workspaceChanges') return undefined
      return undefined
    },
    effect(factory) {
      const disposer = factory()
      return typeof disposer === 'function' ? disposer : () => {}
    },
    on() {
      return () => {}
    },
    webServer: {
      register(route) {
        captured.route = route
        return () => {}
      },
    },
  }

  apply(ctx, {
    archiveDir: path.join(root, 'archive'),
    ledgerDir: path.join(root, 'ledger'),
    archiveKeep: 1,
  })

  const server = http.createServer((req, res) => captured.route.handler(req, res))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = /** @type {{port: number}} */ (server.address())
  const base = `http://127.0.0.1:${address.port}${API_PREFIX}`
  t.after(async () => {
    await new Promise((resolve) => {
      server.closeAllConnections?.()
      server.close(resolve)
    })
    await fs.rm(root, { recursive: true, force: true })
  })

  const getJson = async (url) => {
    const response = await fetch(base + url)
    return { status: response.status, body: await response.json() }
  }
  const postJson = async (url, body) => {
    const response = await fetch(base + url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    return { status: response.status, body: await response.json() }
  }

  const basket = await getJson('basket?session=session-delivery')
  assert.equal(basket.body.ok, true)
  const entry = basket.body.value.files.find((item) => item.rel === '报告.txt')
  assert.ok(entry, '扫描应该把文件收进筐')

  // 1. 交付体检：干净文件不应报 block
  const preflight = await postJson('preflight', { session: 'session-delivery', paths: [entry.path] })
  assert.equal(preflight.body.ok, true)
  assert.equal(preflight.body.value.summary.block, 0)

  // 2. 交付状态
  const marked = await postJson('delivery', { session: 'session-delivery', path: entry.path, state: 'done' })
  assert.equal(marked.body.ok, true)
  assert.equal(marked.body.value.state, 'done')
  const afterMark = await getJson('basket?session=session-delivery')
  assert.equal(afterMark.body.value.files.find((item) => item.rel === '报告.txt').delivery.state, 'done')

  // 3. 内容搜索
  const search = await getJson('search?session=session-delivery&q=' + encodeURIComponent('毛利率'))
  assert.equal(search.body.ok, true)
  assert.equal(search.body.value.files[0].rel, '报告.txt')
  assert.equal(search.body.value.files[0].hits[0].line, 2)

  // 4. 归档：清单、sha256、台账
  const archived = await postJson('archive', { session: 'session-delivery', paths: [entry.path] })
  assert.equal(archived.body.ok, true)
  assert.ok(archived.body.value.run, '归档响应应带批次号')
  assert.ok(archived.body.value.manifest, '归档响应应带清单相对路径')
  const manifestPath = path.join(root, 'archive', archived.body.value.manifest)
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
  assert.equal(manifest.files[0].rel, '报告.txt')
  assert.equal(manifest.files[0].sha256.length, 64)

  const ledger = await getJson('ledger?session=session-delivery')
  assert.equal(ledger.body.ok, true)
  const archiveEvent = ledger.body.value.events.find((event) => event.t === 'archive')
  assert.ok(archiveEvent, '归档应写进台账')

  const run = await getJson(`ledger/run?session=session-delivery&run=${archived.body.value.run}`)
  assert.equal(run.body.ok, true)
  assert.equal(run.body.value.manifest.files[0].rel, '报告.txt')

  // 5. 回执（HTML）
  const receipt = await fetch(base + `receipt?session=session-delivery&run=${archived.body.value.run}`)
  assert.equal(receipt.status, 200)
  assert.ok((receipt.headers.get('content-disposition') || '').includes('attachment'))
  const html = await receipt.text()
  assert.ok(html.includes('交付回执'))
  assert.ok(html.includes('报告.txt'))

  // 6. 归档对比：改一行，再和归档版比
  await fs.writeFile(file, 'hello\n毛利率 51%\n', 'utf8')
  const diff = await getJson(
    `diff/archive?session=session-delivery&path=${encodeURIComponent(entry.path)}&run=${archived.body.value.run}`,
  )
  assert.equal(diff.body.ok, true)
  assert.ok(diff.body.value.hunks.some((hunk) => hunk.lines.includes('-毛利率 42%')))
  assert.ok(diff.body.value.hunks.some((hunk) => hunk.lines.includes('+毛利率 51%')))

  // 7. 还原：删掉工作区文件，再按 skip 还原
  await fs.rm(file)
  const dry = await postJson('archive/restore', {
    session: 'session-delivery',
    run: archived.body.value.run,
    mode: 'skip',
    dryRun: true,
  })
  assert.equal(dry.body.ok, true)
  assert.equal(dry.body.value.plan[0].action, 'create')

  const restored = await postJson('archive/restore', {
    session: 'session-delivery',
    run: archived.body.value.run,
    mode: 'skip',
    dryRun: false,
  })
  assert.equal(restored.body.ok, true)
  assert.equal(restored.body.value.restored.length, 1)
  assert.equal(await fs.readFile(file, 'utf8'), 'hello\n毛利率 42%\n')
})
