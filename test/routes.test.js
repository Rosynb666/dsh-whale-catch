import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { API_PREFIX, createApi } from '../lib/routes.js'
import { toPosix } from '../lib/kinds.js'

/**
 * 起一个真实的 http 服务，直接把 Host 路由当 handler 用。
 * 这样测的是"客户端真的会发的那种请求"，而不是直接调内部函数。
 * @param {object} store
 */
async function serve(store) {
  const handler = createApi({ store, config: { maxFileBytes: 1024 * 1024, maxZipBytes: 4 * 1024 * 1024 } })
  const server = http.createServer((req, res) => { handler(req, res) })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = /** @type {{port: number}} */ (server.address())
  return {
    base: `http://127.0.0.1:${address.port}${API_PREFIX}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}

/**
 * 一个假 store：路由层关心的就是快照与 resolve。
 * 默认只有一条 `报告.docx`；传 extra 可以追加（或替换）文件清单。
 * @param {string} dir
 * @param {{rel: string, name?: string, path?: string, size?: number, content?: string}[]} [extra]
 */
async function makeStore(dir, extra) {
  const items = extra ?? [{ rel: '报告.docx', content: 'docx' }]
  const files = []
  for (const item of items) {
    const abs = item.path ?? path.join(dir, item.rel)
    if (item.path === undefined && item.content !== undefined) await fs.writeFile(abs, item.content)
    files.push({
      path: abs,
      rel: toPosix(item.rel),
      name: item.name ?? path.basename(item.rel),
      ext: path.extname(item.name ?? item.rel).slice(1),
      kind: 'doc',
      size: item.size ?? (item.content === undefined ? 0 : Buffer.byteLength(item.content)),
      mtimeMs: Date.now(),
      sources: ['scanned'],
      description: null,
      turn: null,
      missing: false,
    })
  }
  const snapshot = {
    session: 'session-test',
    cwd: dir,
    since: 0,
    archiveDir: path.join(dir, '_archive'),
    files,
    totals: {
      count: files.length,
      bytes: files.reduce((sum, file) => sum + file.size, 0),
      missing: 0,
    },
    scannedAt: Date.now(),
    truncated: false,
  }
  return {
    version: '9.9.9',
    snapshot: async () => snapshot,
    refresh: async () => snapshot,
    resolve: (sessionId, requested) => {
      if (sessionId !== 'session-test') return undefined
      const hit = files.find((file) => requested === file.path || requested === file.rel)
      return hit === undefined ? undefined : hit.path
    },
  }
}

test('ping 与 basket 返回统一信封', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'whale-routes-'))
  const server = await serve(await makeStore(dir))
  t.after(async () => {
    await server.close()
    await fs.rm(dir, { recursive: true, force: true })
  })

  const ping = await fetch(`${server.base}ping`).then((r) => r.json())
  assert.equal(ping.ok, true)
  assert.equal(ping.value.name, 'dsh-whale-catch')

  const basket = await fetch(`${server.base}basket?session=session-test`).then((r) => r.json())
  assert.equal(basket.ok, true)
  assert.equal(basket.value.files.length, 1)
  assert.equal(basket.value.files[0].name, '报告.docx')

  const bad = await fetch(`${server.base}basket?session=../evil`).then((r) => r.json())
  assert.equal(bad.ok, false)
  assert.equal(bad.error.code, 'bad-session')
})

test('file 只服务鱼篓里的路径，其它一律 404', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'whale-routes-'))
  const server = await serve(await makeStore(dir))
  t.after(async () => {
    await server.close()
    await fs.rm(dir, { recursive: true, force: true })
  })

  const ok = await fetch(`${server.base}file?session=session-test&path=${encodeURIComponent(path.join(dir, '报告.docx'))}`)
  assert.equal(ok.status, 200)
  assert.equal(await ok.text(), 'docx')

  const denied = await fetch(`${server.base}file?session=session-test&path=${encodeURIComponent('/etc/passwd')}`)
  assert.equal(denied.status, 404)
  assert.equal((await denied.json()).error.code, 'not-in-basket')
})

test('zip 返回真正的 zip；archive 复制到归档目录', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'whale-routes-'))
  const server = await serve(await makeStore(dir))
  t.after(async () => {
    await server.close()
    await fs.rm(dir, { recursive: true, force: true })
  })

  const zipResponse = await fetch(`${server.base}zip`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ session: 'session-test', paths: [] }),
  })
  assert.equal(zipResponse.status, 200)
  assert.match(zipResponse.headers.get('content-type') ?? '', /application\/zip/)
  const bytes = Buffer.from(await zipResponse.arrayBuffer())
  assert.equal(bytes.subarray(0, 2).toString('ascii'), 'PK')

  const archived = await fetch(`${server.base}archive`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ session: 'session-test', paths: [] }),
  }).then((r) => r.json())
  assert.equal(archived.ok, true)
  assert.equal(archived.value.copied.length, 1)
  const target = path.join(dir, '_archive', 'session-test', '报告.docx')
  assert.equal(await fs.readFile(target, 'utf8'), 'docx')
})

test('跨源请求 403，非 JSON 写请求 415，坏 JSON 400', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'whale-routes-'))
  const server = await serve(await makeStore(dir))
  t.after(async () => {
    await server.close()
    await fs.rm(dir, { recursive: true, force: true })
  })

  const cross = await fetch(`${server.base}zip`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://evil.example' },
    body: JSON.stringify({ session: 'session-test' }),
  })
  assert.equal(cross.status, 403)

  const form = await fetch(`${server.base}zip`, {
    method: 'POST',
    headers: { 'content-type': 'text/plain' },
    body: 'session=session-test',
  })
  assert.equal(form.status, 415)

  const broken = await fetch(`${server.base}refresh`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{oops',
  })
  assert.equal(broken.status, 400)
})

test('未知路由 404', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'whale-routes-'))
  const server = await serve(await makeStore(dir))
  t.after(async () => {
    await server.close()
    await fs.rm(dir, { recursive: true, force: true })
  })
  const response = await fetch(`${server.base}nope`)
  assert.equal(response.status, 404)
})

test('file 对 HTML / SVG 加 CSP sandbox，普通文本与 docx 不加', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'whale-routes-'))
  const server = await serve(await makeStore(dir, [
    { rel: '报告.docx', content: 'docx' },
    { rel: 'demo.html', content: '<script>alert(1)</script>' },
    { rel: 'demo.svg', content: '<svg xmlns="http://www.w3.org/2000/svg"/>' },
    { rel: 'note.txt', content: 'hi' },
  ]))
  t.after(async () => {
    await server.close()
    await fs.rm(dir, { recursive: true, force: true })
  })

  const get = (rel) => fetch(`${server.base}file?session=session-test&path=${encodeURIComponent(rel)}`)

  const html = await get('demo.html')
  assert.equal(html.status, 200)
  assert.equal(html.headers.get('content-security-policy'), 'sandbox', 'HTML 必须沙箱，否则脚本能继承 Host 源')
  assert.match(html.headers.get('content-type') ?? '', /text\/html/)

  const svg = await get('demo.svg')
  assert.equal(svg.headers.get('content-security-policy'), 'sandbox', 'SVG 直接导航同样会执行脚本')

  const txt = await get('note.txt')
  assert.equal(txt.headers.get('content-security-policy'), null)

  const docx = await get('报告.docx')
  assert.equal(docx.headers.get('content-security-policy'), null)
})

test('拿不到工作目录时返回 409 + no-cwd，而不是 500', async (t) => {
  const noCwd = async () => {
    const error = new Error('无法确定这个会话的工作目录；请把会话切到前台后重试，或在请求里带上 cwd')
    // @ts-expect-error 模拟 Host 侧的自定义错误码
    error.code = 'no-cwd'
    throw error
  }
  const store = { version: '9.9.9', snapshot: noCwd, refresh: noCwd, resolve: () => undefined }
  const server = await serve(store)
  t.after(() => server.close())

  const response = await fetch(`${server.base}basket?session=session-test`)
  assert.equal(response.status, 409, '这是可重试的状态，不该报 500')
  const payload = await response.json()
  assert.equal(payload.ok, false)
  assert.equal(payload.error.code, 'no-cwd')
})

test('zip 跳过超大文件时用响应头报数；全被跳过时 413', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'whale-routes-'))
  const server = await serve(await makeStore(dir, [
    { rel: '报告.docx', content: 'docx' },
    { rel: '大文件.bin', content: 'x', size: 2 * 1024 * 1024 },
  ]))
  t.after(async () => {
    await server.close()
    await fs.rm(dir, { recursive: true, force: true })
  })

  const mixed = await fetch(`${server.base}zip`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ session: 'session-test', paths: [] }),
  })
  assert.equal(mixed.status, 200)
  assert.equal(mixed.headers.get('x-whale-catch-skipped'), '1')
  assert.equal(mixed.headers.get('content-type'), 'application/zip')

  const allBig = await fetch(`${server.base}zip`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ session: 'session-test', paths: ['大文件.bin'] }),
  })
  assert.equal(allBig.status, 413)
  assert.equal((await allBig.json()).error.code, 'all-too-large')
})

test('cwd 外的文件归档进 _external/，不再镜像绝对路径', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'whale-routes-'))
  const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'whale-outside-'))
  const outside = path.join(outsideDir, '外部交付.pdf')
  await fs.writeFile(outside, 'pdf')
  const server = await serve(await makeStore(dir, [{ rel: toPosix(outside), path: outside }]))
  t.after(async () => {
    await server.close()
    await fs.rm(dir, { recursive: true, force: true })
    await fs.rm(outsideDir, { recursive: true, force: true })
  })

  const archived = await fetch(`${server.base}archive`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ session: 'session-test', paths: [] }),
  }).then((r) => r.json())

  assert.equal(archived.ok, true)
  assert.deepEqual(archived.value.copied, [toPosix(path.join('session-test', '_external', '外部交付.pdf'))])
  const target = path.join(dir, '_archive', 'session-test', '_external', '外部交付.pdf')
  assert.equal(await fs.readFile(target, 'utf8'), 'pdf')
  // 绝对路径没有被拆成 Users/… 镜像进归档目录
  const mirrored = path.join(dir, '_archive', 'session-test', ...toPosix(outside).split('/').slice(1, 2))
  assert.equal(await fs.access(mirrored).then(() => true, () => false), false)
})
