import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  appendEvent,
  listManifests,
  readEvents,
  readManifest,
  rebuild,
  stats,
} from '../lib/ledger.js'

/**
 * @param {string} root
 * @param {string} session
 * @param {string} run
 * @param {any} manifest
 */
async function writeRun(root, session, run, manifest) {
  const dir = path.join(root, session, 'runs', run, '_whale-catch')
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(path.join(dir, 'manifest.json'), JSON.stringify(manifest), 'utf8')
}

/**
 * @param {string} root
 * @param {string} session
 * @param {string} run
 * @param {any} manifest
 */
async function writeFlat(root, session, run, manifest) {
  const dir = path.join(root, session, '_whale-catch', 'manifests')
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(path.join(dir, `${run}.json`), JSON.stringify(manifest), 'utf8')
}

/** @returns {Promise<string>} */
async function tempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'whale-ledger-'))
}

test('appendEvent / readEvents 往返，事件按时间顺序返回', async () => {
  const dir = await tempDir()
  try {
    await appendEvent(dir, 'ses_a', { v: 1, t: 'present', at: 1, files: [] })
    await appendEvent(dir, 'ses_a', { v: 1, t: 'archive', at: 2, run: '20260101-000000-000' })
    const events = await readEvents(dir, 'ses_a')
    assert.deepEqual(events.map((event) => event.t), ['present', 'archive'])
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('readEvents 跳过坏行，不让一行损坏拖垮整个台账', async () => {
  const dir = await tempDir()
  try {
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(
      path.join(dir, 'ses_b.jsonl'),
      '{"v":1,"t":"present","at":1}\nnot-json\n{"v":1,"t":"archive","at":3}\n',
      'utf8',
    )
    const events = await readEvents(dir, 'ses_b')
    assert.deepEqual(events.map((event) => event.t), ['present', 'archive'])
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('readEvents 只读尾部：maxLines 限制生效', async () => {
  const dir = await tempDir()
  try {
    for (let i = 0; i < 8; i += 1) {
      await appendEvent(dir, 'ses_c', { v: 1, t: 'mark', at: i, path: `p${i}` })
    }
    const events = await readEvents(dir, 'ses_c', { maxLines: 3 })
    assert.deepEqual(events.map((event) => event.at), [5, 6, 7])
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('非法 session id 不落盘也不读取', async () => {
  const dir = await tempDir()
  try {
    const events = await readEvents(dir, '../escape')
    assert.deepEqual(events, [])
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('listManifests 同时认 runs 与 flat 两种布局，并按时间倒序', async () => {
  const root = await tempDir()
  try {
    await writeRun(root, 'ses_a', '20260101-000000-000', {
      archivedAt: '2026-01-01T00:00:00.000Z',
      files: [{ rel: 'a.txt', size: 10 }],
    })
    await writeFlat(root, 'ses_a', '20260102-000000-000', {
      archivedAt: '2026-01-02T00:00:00.000Z',
      files: [{ rel: 'b.txt', size: 20 }, { rel: 'c.txt', size: 30 }],
    })
    const rows = await listManifests(root, 'ses_a')
    assert.equal(rows.length, 2)
    assert.equal(rows[0].run, '20260102-000000-000')
    assert.equal(rows[0].layout, 'flat')
    assert.equal(rows[0].count, 2)
    assert.equal(rows[0].bytes, 50)
    assert.equal(rows[1].layout, 'runs')
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('readManifest 拒绝非法批次名与归档根外的清单', async () => {
  const root = await tempDir()
  try {
    assert.equal(await readManifest(root, 'ses_a', '../manifest'), undefined)
    assert.equal(await readManifest(root, 'ses_a', 'not-a-run'), undefined)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('rebuild 从清单重建归档事件，同时保留 present / mark', async () => {
  const root = await tempDir()
  const ledger = await tempDir()
  try {
    await writeRun(root, 'ses_a', '20260101-000000-000', {
      archivedAt: '2026-01-01T00:00:00.000Z',
      files: [{ rel: 'a.txt', size: 10 }],
    })
    await appendEvent(ledger, 'ses_a', { v: 1, t: 'present', at: 0, files: [] })
    await appendEvent(ledger, 'ses_a', { v: 1, t: 'mark', at: 5, path: 'a.txt', state: 'done' })
    const result = await rebuild(ledger, root)
    assert.deepEqual(result, { sessions: 1, runs: 1 })
    const events = await readEvents(ledger, 'ses_a')
    assert.deepEqual(events.map((event) => event.t), ['present', 'mark', 'archive'])
    assert.equal(events[2].run, '20260101-000000-000')
  } finally {
    await fs.rm(root, { recursive: true, force: true })
    await fs.rm(ledger, { recursive: true, force: true })
  }
})

test('stats 汇总批次与体积', async () => {
  const root = await tempDir()
  const ledger = await tempDir()
  try {
    await writeRun(root, 'ses_a', '20260101-000000-000', {
      archivedAt: '2026-01-01T00:00:00.000Z',
      files: [{ rel: 'a.txt', size: 10 }],
    })
    await writeRun(root, 'ses_b', '20260102-000000-000', {
      archivedAt: '2026-01-02T00:00:00.000Z',
      files: [{ rel: 'b.txt', size: 20 }],
    })
    await rebuild(ledger, root)
    const value = await stats(ledger, root)
    assert.equal(value.sessions, 2)
    assert.equal(value.runs, 2)
    assert.equal(value.bytes, 30)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
    await fs.rm(ledger, { recursive: true, force: true })
  }
})
