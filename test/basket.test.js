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
