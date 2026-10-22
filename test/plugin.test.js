import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { readFileSync } from 'node:fs'
import { Config, apply, inject, name, normalizeConfig, version } from '../lib/index.js'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

test('导出的 name / version / inject 与 package.json 和契约一致', () => {
  assert.equal(name, 'dsh-whale-catch')
  assert.equal(version, pkg.version)
  assert.deepEqual(inject, ['webServer'], '只强制依赖 webServer，其余服务必须可选')
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(pkg.dsh.client.platform, 'web')
  assert.ok(Array.isArray(pkg.dsh.client.inject))
})

test('Config 接受空对象并给出默认值（profile 行没写 config 也不能炸）', () => {
  assert.doesNotThrow(() => Config({}))
  const normalized = normalizeConfig({})
  assert.equal(normalized.maxFiles, 800)
  assert.equal(normalized.maxDepth, 6)
  assert.equal(normalized.maxFileBytes, 64 * 1024 * 1024)
  assert.ok(normalized.archiveDir.endsWith(path.join('whale-catch', 'archive')))
})

test('normalizeConfig 把越界与脏值夹回安全区间', () => {
  const normalized = normalizeConfig({
    archiveDir: '/tmp/鱼篓',
    ignore: ['dist', '', 42, 'build'],
    maxFiles: -3,
    maxDepth: 999,
    maxFileBytes: 'big',
    lookbackMinutes: 0,
  })
  assert.equal(normalized.archiveDir, '/tmp/鱼篓')
  assert.deepEqual(normalized.ignore, ['dist', 'build'])
  assert.equal(normalized.maxFiles, 800, '非法 maxFiles 回落到默认值')
  assert.equal(normalized.maxDepth, 24, '过大的 maxDepth 被夹到上限')
  assert.equal(normalized.maxFileBytes, 64 * 1024 * 1024)
  assert.equal(normalized.lookbackMinutes, 720)
})

test('archiveDir 开头的 ~ 会展开到用户主目录', () => {
  assert.equal(normalizeConfig({ archiveDir: '~' }).archiveDir, os.homedir())
  assert.equal(
    normalizeConfig({ archiveDir: '  ~/Documents/鱼篓归档  ' }).archiveDir,
    path.join(os.homedir(), 'Documents', '鱼篓归档'),
  )
  // 只有开头才展开，别把普通目录名里的 ~ 也改坏
  assert.equal(normalizeConfig({ archiveDir: '/tmp/~/鱼篓' }).archiveDir, path.resolve('/tmp/~/鱼篓'))
})

test('apply 注册前缀路由与会话事件监听；present 的文件真的会出现在鱼篓里', async (t) => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'whale-plugin-'))
  t.after(async () => fs.rm(cwd, { recursive: true, force: true }))

  const report = path.join(cwd, '报告.docx')
  await fs.writeFile(report, 'docx-bytes')

  /** @type {{route?: any, listener?: any}} */
  const captured = {}
  const session = { id: 'session-plugin', header: { cwd, createdAt: Date.now() - 60_000 } }
  const agent = { session }
  const ctx = {
    get(service) {
      if (service === 'agents') return { get: () => agent }
      if (service === 'workspaceChanges') return undefined
      return undefined
    },
    effect(factory) {
      const disposer = factory()
      return typeof disposer === 'function' ? disposer : () => {}
    },
    on(event, listener) {
      if (event === 'session/event') captured.listener = listener
      return () => {}
    },
    webServer: {
      register(route) {
        captured.route = route
        return () => {}
      },
    },
  }

  apply(ctx, { lookbackMinutes: 60 })
  assert.equal(captured.route.kind, 'prefix')
  assert.equal(captured.route.path, '/whale-catch/api')
  assert.equal(typeof captured.listener, 'function')

  // 模拟内核的 deliverables/presented 事件
  captured.listener(session, {
    seq: 1,
    type: 'deliverables/presented',
    data: { turn: 2, callId: 'call-1', files: [{ path: '报告.docx', description: '第一次上机报告' }] },
  })

  const server = http.createServer((req, res) => captured.route.handler(req, res))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = /** @type {{port: number}} */ (server.address())
  t.after(() => new Promise((resolve) => server.close(resolve)))

  const response = await fetch(`http://127.0.0.1:${address.port}/whale-catch/api/basket?session=session-plugin`)
  const payload = await response.json()
  assert.equal(payload.ok, true)
  const entry = payload.value.files.find((file) => file.name === '报告.docx')
  assert.ok(entry, 'present 的文件应当出现在鱼篓里')
  assert.equal(entry.description, '第一次上机报告')
  assert.ok(entry.sources.includes('presented'))
})

test('没有活跃 agent 且没给 cwd 时，basket 返回可读错误而不是崩', async (t) => {
  const captured = {}
  const ctx = {
    get: () => undefined,
    effect: (factory) => { factory(); return () => {} },
    on: (event, listener) => { captured.listener = listener; return () => {} },
    webServer: { register: (route) => { captured.route = route; return () => {} } },
  }
  apply(ctx, {})
  const server = http.createServer((req, res) => captured.route.handler(req, res))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = /** @type {{port: number}} */ (server.address())
  t.after(() => new Promise((resolve) => server.close(resolve)))

  const response = await fetch(`http://127.0.0.1:${address.port}/whale-catch/api/basket?session=ghost`)
  const payload = await response.json()
  assert.equal(payload.ok, false)
  assert.equal(response.status, 409, '拿不到 cwd 是可重试状态，不该报 500')
  assert.equal(payload.error.code, 'no-cwd')
  assert.match(payload.error.message, /工作目录/)
})
