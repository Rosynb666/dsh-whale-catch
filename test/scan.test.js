import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { scanWorkspace } from '../lib/scan.js'

async function tempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'whale-scan-'))
}

/**
 * 把文件 mtime 设到过去，模拟「会话开始前就存在」的文件。
 * @param {string} file
 * @param {number} minutesAgo
 */
async function age(file, minutesAgo) {
  const when = new Date(Date.now() - minutesAgo * 60 * 1000)
  await fs.utimes(file, when, when)
}

test('只收 mtime 不早于 sinceMs 的文件', async () => {
  const dir = await tempDir()
  try {
    await fs.writeFile(path.join(dir, 'new.txt'), 'new')
    const old = path.join(dir, 'old.txt')
    await fs.writeFile(old, 'old')
    await age(old, 120)

    const result = await scanWorkspace({ cwd: dir, sinceMs: Date.now() - 60 * 1000 })
    assert.deepEqual(result.files.map((file) => file.name), ['new.txt'])
    assert.equal(result.files[0].rel, 'new.txt')
    assert.equal(result.truncated, false)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('跳过 node_modules、点目录与额外 ignore', async () => {
  const dir = await tempDir()
  try {
    await fs.mkdir(path.join(dir, 'node_modules', 'x'), { recursive: true })
    await fs.writeFile(path.join(dir, 'node_modules', 'x', 'skip.js'), 'x')
    await fs.mkdir(path.join(dir, '.git'), { recursive: true })
    await fs.writeFile(path.join(dir, '.git', 'HEAD'), 'x')
    await fs.mkdir(path.join(dir, 'build'), { recursive: true })
    await fs.writeFile(path.join(dir, 'build', 'out.bin'), 'x')
    await fs.writeFile(path.join(dir, 'keep.md'), '# hi')
    await fs.writeFile(path.join(dir, '.env'), 'SECRET=1')

    const result = await scanWorkspace({ cwd: dir, sinceMs: 0, ignore: ['build'] })
    assert.deepEqual(result.files.map((file) => file.name).sort(), ['keep.md'])
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('超过 maxFileBytes 的文件只跳过、不报错', async () => {
  const dir = await tempDir()
  try {
    await fs.writeFile(path.join(dir, 'big.bin'), Buffer.alloc(4096))
    await fs.writeFile(path.join(dir, 'small.txt'), 'ok')
    const result = await scanWorkspace({ cwd: dir, sinceMs: 0, maxFileBytes: 1024 })
    assert.deepEqual(result.files.map((file) => file.name), ['small.txt'])
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('超过 maxDepth 的目录不再下探', async () => {
  const dir = await tempDir()
  try {
    const deep = path.join(dir, 'a', 'b', 'c')
    await fs.mkdir(deep, { recursive: true })
    await fs.writeFile(path.join(deep, 'deep.txt'), 'deep')
    await fs.writeFile(path.join(dir, 'a', 'shallow.txt'), 'shallow')

    const result = await scanWorkspace({ cwd: dir, sinceMs: 0, maxDepth: 1 })
    assert.ok(result.files.some((file) => file.name === 'shallow.txt'))
    assert.ok(!result.files.some((file) => file.name === 'deep.txt'), 'c 目录在 maxDepth=1 之外')
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('达到 maxFiles 就停并标记 truncated，且结果按 mtime 倒序', async () => {
  const dir = await tempDir()
  try {
    for (let i = 0; i < 8; i += 1) {
      const file = path.join(dir, `f${i}.txt`)
      await fs.writeFile(file, String(i))
      await age(file, 10 - i)
    }
    const result = await scanWorkspace({ cwd: dir, sinceMs: 0, maxFiles: 3 })
    assert.equal(result.files.length, 3)
    assert.equal(result.truncated, true)
    for (let i = 1; i < result.files.length; i += 1) {
      assert.ok(result.files[i - 1].mtimeMs >= result.files[i].mtimeMs)
    }
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('ignorePaths 能排除指定目录（例如插件自己的归档目录）', async () => {
  const dir = await tempDir()
  try {
    const archive = path.join(dir, '归档')
    await fs.mkdir(archive, { recursive: true })
    await fs.writeFile(path.join(archive, 'old.zip'), 'zip')
    await fs.writeFile(path.join(dir, 'live.txt'), 'live')

    const result = await scanWorkspace({ cwd: dir, sinceMs: 0, ignorePaths: [archive] })
    assert.deepEqual(result.files.map((file) => file.name), ['live.txt'])
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('cwd 不存在时安静返回空结果', async () => {
  const result = await scanWorkspace({ cwd: path.join(os.tmpdir(), 'definitely-not-here-9f8a'), sinceMs: 0 })
  assert.deepEqual(result.files, [])
  assert.equal(result.truncated, false)
})
