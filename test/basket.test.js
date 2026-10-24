import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Basket, displayPath } from '../lib/basket.js'

async function tempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'whale-basket-'))
}

test('displayPath：cwd 内给相对路径，cwd 外给绝对路径', async () => {
  const dir = await tempDir()
  try {
    assert.equal(displayPath(dir, path.join(dir, 'a', 'b.txt')), 'a/b.txt')
    assert.equal(displayPath(dir, path.join(os.tmpdir(), 'elsewhere.txt')), path.join(os.tmpdir(), 'elsewhere.txt').replace(/\\/g, '/'))
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('三个来源合并到同一路径，来源取并集，描述保留 presented 的', async () => {
  const dir = await tempDir()
  try {
    const file = path.join(dir, '报告.docx')
    await fs.writeFile(file, 'docx')

    const basket = new Basket({ sessionId: 's1', cwd: dir, sinceMs: 0 })
    basket.addScan({ files: [{ path: file, rel: '报告.docx', name: '报告.docx', size: 4, mtimeMs: Date.now() }], truncated: false, visited: 1, scannedAt: Date.now() })
    basket.addPresented([{ path: '报告.docx', description: '第一次上机报告' }], 3)
    basket.addChanged([{ path: '报告.docx' }], 3)

    assert.equal(basket.size, 1)
    const snapshot = await basket.snapshot()
    assert.equal(snapshot.files.length, 1)
    const entry = snapshot.files[0]
    assert.deepEqual(entry.sources.sort(), ['changed', 'presented', 'scanned'])
    assert.equal(entry.description, '第一次上机报告')
    assert.equal(entry.turn, 3)
    assert.equal(entry.kind, 'doc')
    assert.equal(entry.rel, '报告.docx')
    assert.equal(entry.missing, false)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('present 给的绝对路径也能登记；文件被删后标记 missing 且不计入字节', async () => {
  const dir = await tempDir()
  const outside = await tempDir()
  try {
    const abs = path.join(outside, 'chart.png')
    await fs.writeFile(abs, 'png-bytes')

    const basket = new Basket({ sessionId: 's2', cwd: dir, sinceMs: 0 })
    basket.addPresented([{ path: abs }], 1)
    let snapshot = await basket.snapshot()
    assert.equal(snapshot.totals.bytes, 9)
    assert.equal(snapshot.files[0].kind, 'image')
    assert.equal(snapshot.files[0].rel, abs.replace(/\\/g, '/'))

    await fs.rm(abs)
    snapshot = await basket.snapshot()
    assert.equal(snapshot.files[0].missing, true)
    assert.equal(snapshot.totals.missing, 1)
    assert.equal(snapshot.totals.bytes, 0)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
    await fs.rm(outside, { recursive: true, force: true })
  }
})

test('resolve 只认已登记路径，穿越与任意路径都被拒', async () => {
  const dir = await tempDir()
  try {
    const file = path.join(dir, 'ok.txt')
    await fs.writeFile(file, 'ok')
    const basket = new Basket({ sessionId: 's3', cwd: dir, sinceMs: 0 })
    basket.addScan({ files: [{ path: file, rel: 'ok.txt', name: 'ok.txt', size: 2, mtimeMs: Date.now() }], truncated: false, visited: 1, scannedAt: Date.now() })

    assert.equal(basket.resolve('ok.txt'), file)
    assert.equal(basket.resolve(file), file)
    assert.equal(basket.resolve('../etc/passwd'), undefined)
    assert.equal(basket.resolve(path.join(dir, 'never-seen.txt')), undefined)
    assert.equal(basket.resolve('/etc/passwd'), undefined)
    assert.equal(basket.resolve(''), undefined)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('未登记的文件不会因为扫描到父目录而被误放行', async () => {
  const dir = await tempDir()
  try {
    const seen = path.join(dir, 'seen.txt')
    const hidden = path.join(dir, 'secret.txt')
    await fs.writeFile(seen, 'a')
    await fs.writeFile(hidden, 'b')
    const basket = new Basket({ sessionId: 's4', cwd: dir, sinceMs: 0 })
    basket.addScan({ files: [{ path: seen, rel: 'seen.txt', name: 'seen.txt', size: 1, mtimeMs: Date.now() }], truncated: false, visited: 1, scannedAt: Date.now() })
    assert.equal(basket.resolve('secret.txt'), undefined)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('workspace/changes 的行数、binary 与 seq/index 会留在鱼篓里', async () => {
  const dir = await tempDir()
  try {
    const file = path.join(dir, 'app.js')
    await fs.writeFile(file, 'const a = 1\n')

    const basket = new Basket({ sessionId: 's5', cwd: dir, sinceMs: 0 })
    basket.addChanged([
      { path: 'app.js', display: 'app.js', added: 12, deleted: 3 },
      { path: 'logo.png', display: 'logo.png', added: 0, deleted: 0, binary: true },
      { path: 'huge.log', display: 'huge.log', oversized: true },
    ], 4, 77)

    const snapshot = await basket.snapshot()
    const audit = snapshot.files.find((entry) => entry.name === 'app.js')
    assert.equal(audit.added, 12)
    assert.equal(audit.deleted, 3)
    assert.equal(audit.diffable, true)
    assert.equal(audit.turn, 4)
    assert.deepEqual(audit.sources, ['changed'])

    const binary = snapshot.files.find((entry) => entry.name === 'logo.png')
    assert.equal(binary.binary, true)
    assert.equal(binary.added, 0)
    assert.equal(binary.diffable, true, '二进制文件也有对比，只是内容类型不同')

    assert.equal(snapshot.totals.changed, 3)
    assert.equal(snapshot.totals.added, 12)
    assert.equal(snapshot.totals.deleted, 3)

    assert.deepEqual(basket.resolveChange('app.js'), { path: file, seq: 77, index: 0 })
    assert.equal(basket.resolveChange('logo.png').index, 1)
    assert.equal(basket.resolveChange('huge.log').index, 2)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('present / 扫描没有前后快照：resolveChange 返回 undefined', async () => {
  const dir = await tempDir()
  try {
    const file = path.join(dir, '周报.docx')
    await fs.writeFile(file, 'docx')
    const basket = new Basket({ sessionId: 's6', cwd: dir, sinceMs: 0 })
    basket.addScan({ files: [{ path: file, rel: '周报.docx', name: '周报.docx', size: 4, mtimeMs: Date.now() }], truncated: false, visited: 1, scannedAt: Date.now() })
    basket.addPresented([{ path: '周报.docx', description: '第二周' }], 1)

    assert.equal(basket.resolveChange('周报.docx'), undefined)
    assert.equal(basket.resolveChange('没登记过.txt'), undefined)
    const snapshot = await basket.snapshot()
    assert.equal(snapshot.files[0].added, null, 'null 表示没有改动数据，不是 0 行')
    assert.equal(snapshot.files[0].diffable, false)
    assert.equal(snapshot.files[0].binary, false)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('同一文件再次改动：行数与 seq/index 取最新一次', async () => {
  const dir = await tempDir()
  try {
    const file = path.join(dir, 'notes.md')
    await fs.writeFile(file, '# notes\n')
    const basket = new Basket({ sessionId: 's7', cwd: dir, sinceMs: 0 })
    basket.addChanged([{ path: 'notes.md', added: 1, deleted: 0 }], 2, 10)
    basket.addChanged([{ path: 'notes.md', added: 5, deleted: 4 }], 3, 11)

    const snapshot = await basket.snapshot()
    assert.equal(snapshot.files.length, 1)
    assert.equal(snapshot.files[0].added, 5)
    assert.equal(snapshot.files[0].deleted, 4)
    assert.equal(snapshot.files[0].turn, 3)
    assert.equal(snapshot.totals.changed, 1, '同一路径只算一条改动')
    assert.equal(snapshot.totals.added, 5)
    assert.deepEqual(basket.resolveChange('notes.md'), { path: file, seq: 11, index: 0 })
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})
