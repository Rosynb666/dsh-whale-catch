import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { API_PREFIX, createApi } from '../lib/routes.js'

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
 * 一个只有一条记录的假 store：路由层关心的就是这份快照。
 * @param {string} dir
 */
async function makeStore(dir) {
  const file = path.join(dir, '报告.docx')
  await fs.writeFile(file, 'docx')
  const snapshot = {
    session: 'session-test',
    cwd: dir,
    since: 0,
    archiveDir: path.join(dir, '_archive'),
    files: [{
      path: file,
      rel: '报告.docx',
      name: '报告.docx',
      ext: 'docx',
      kind: 'doc',
      size: 4,
      mtimeMs: Date.now(),
      sources: ['scanned'],
      description: null,
      turn: null,
      missing: false,
    }],
    totals: { count: 1, bytes: 4, missing: 0 },
    scannedAt: Date.now(),
    truncated: false,
  }
  return {
    version: '9.9.9',
    snapshot: async () => snapshot,
    refresh: async () => snapshot,
    resolve: (sessionId, requested) => {
      if (sessionId !== 'session-test') return undefined
      return requested === file || requested === '报告.docx' ? file : undefined
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
