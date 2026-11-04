import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { applyRestore, planRestore, safeRelative } from '../lib/restore.js'

/**
 * @param {string[]} parts
 * @returns {Promise<string>}
 */
async function tempDir(parts = []) {
  return fs.mkdtemp(path.join(os.tmpdir(), parts[0] ?? 'whale-restore-'))
}

/**
 * @param {string} root
 * @param {string} rel
 * @param {string} body
 */
async function put(root, rel, body) {
  const file = path.join(root, ...rel.split('/'))
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, body, 'utf8')
  return file
}

/**
 * @param {string} root
 * @param {string} rel
 */
async function read(root, rel) {
  return fs.readFile(path.join(root, ...rel.split('/')), 'utf8')
}

/**
 * @param {string} root
 * @param {string} rel
 */
async function exists(root, rel) {
  try {
    await fs.access(path.join(root, ...rel.split('/')))
    return true
  } catch {
    return false
  }
}

/**
 * @param {any[]} files
 */
function manifestOf(files) {
  return { run: '20261104-133806-123', files }
}

test('safeRelative 拒绝上跳、绝对路径与盘符', () => {
  assert.equal(safeRelative('../x'), undefined)
  assert.equal(safeRelative('/etc/passwd'), undefined)
  assert.equal(safeRelative('C:/Windows'), undefined)
  assert.equal(safeRelative('a/../../b'), undefined)
  assert.equal(safeRelative('a/./b'), 'a/b')
  assert.equal(safeRelative('报告/终稿.docx'), '报告/终稿.docx')
})

test('planRestore：不存在就 create，已存在按 skip 跳过', async () => {
  const cwd = await tempDir()
  const batch = await tempDir()
  try {
    await put(batch, 'a.txt', 'new')
    await put(batch, 'b.txt', 'new-b')
    await put(cwd, 'b.txt', 'old')
    const manifest = manifestOf([
      { rel: 'a.txt', stored: 'a.txt' },
      { rel: 'b.txt', stored: 'b.txt' },
    ])
    const { entries } = await planRestore({ manifest, baseDir: batch, cwd, mode: 'skip' })
    assert.equal(entries.find((entry) => entry.rel === 'a.txt').action, 'create')
    assert.equal(entries.find((entry) => entry.rel === 'b.txt').action, 'skip')
  } finally {
    await fs.rm(cwd, { recursive: true, force: true })
    await fs.rm(batch, { recursive: true, force: true })
  }
})

test('applyRestore：新建文件，dry-run 不落盘', async () => {
  const cwd = await tempDir()
  const batch = await tempDir()
  try {
    await put(batch, '报告/终稿.docx', 'final')
    const manifest = manifestOf([{ rel: '报告/终稿.docx', stored: '报告/终稿.docx' }])

    const dry = await applyRestore({ manifest, baseDir: batch, cwd, dryRun: true })
    assert.equal(dry.dryRun, true)
    assert.equal(await exists(cwd, '报告/终稿.docx'), false)

    const real = await applyRestore({ manifest, baseDir: batch, cwd })
    assert.equal(real.restored.length, 1)
    assert.equal(await read(cwd, '报告/终稿.docx'), 'final')
  } finally {
    await fs.rm(cwd, { recursive: true, force: true })
    await fs.rm(batch, { recursive: true, force: true })
  }
})

test('applyRestore：overwrite 前先备份，备份内容是可找回的旧版', async () => {
  const cwd = await tempDir()
  const batch = await tempDir()
  const backup = await tempDir()
  try {
    await put(batch, 'a.txt', 'new')
    await put(cwd, 'a.txt', 'old')
    const manifest = manifestOf([{ rel: 'a.txt', stored: 'a.txt' }])
    const result = await applyRestore({ manifest, baseDir: batch, cwd, mode: 'overwrite', backupRoot: backup })
    assert.equal(result.restored.length, 1)
    assert.equal(await read(cwd, 'a.txt'), 'new')
    assert.deepEqual(result.backups, ['a.txt'])
    assert.equal(await read(backup, 'a.txt'), 'old')
  } finally {
    await fs.rm(cwd, { recursive: true, force: true })
    await fs.rm(batch, { recursive: true, force: true })
    await fs.rm(backup, { recursive: true, force: true })
  }
})

test('applyRestore：rename 生成不冲突的新名字，原文件不动', async () => {
  const cwd = await tempDir()
  const batch = await tempDir()
  try {
    await put(batch, 'a.txt', 'new')
    await put(cwd, 'a.txt', 'old')
    const manifest = manifestOf([{ rel: 'a.txt', stored: 'a.txt' }])
    const result = await applyRestore({ manifest, baseDir: batch, cwd, mode: 'rename' })
    assert.equal(result.restored.length, 1)
    assert.equal(await read(cwd, 'a.txt'), 'old')
    assert.equal(await read(cwd, 'a (2).txt'), 'new')
  } finally {
    await fs.rm(cwd, { recursive: true, force: true })
    await fs.rm(batch, { recursive: true, force: true })
  }
})

test('路径穿越与越界源都被 blocked，且不写盘', async () => {
  const cwd = await tempDir()
  const batch = await tempDir()
  try {
    const manifest = manifestOf([
      { rel: '../evil.txt', stored: 'a.txt' },
      { rel: 'ok.txt', stored: '../outside.txt' },
    ])
    const result = await applyRestore({ manifest, baseDir: batch, cwd, mode: 'overwrite' })
    assert.equal(result.blocked.length, 2)
    assert.equal(result.restored.length, 0)
    assert.equal(await exists(path.dirname(cwd), 'evil.txt'), false)
  } finally {
    await fs.rm(cwd, { recursive: true, force: true })
    await fs.rm(batch, { recursive: true, force: true })
  }
})

test('目标是符号链接时拒绝覆盖，链接指向的文件不被改写', async (t) => {
  const cwd = await tempDir()
  const batch = await tempDir()
  try {
    await put(batch, 'a.txt', 'new')
    const victim = await put(cwd, 'victim.txt', 'safe')
    try {
      await fs.symlink(victim, path.join(cwd, 'a.txt'))
    } catch (error) {
      if (process.platform === 'win32') {
        t.skip('Windows 上创建符号链接需要额外权限')
        return
      }
      throw error
    }
    const manifest = manifestOf([{ rel: 'a.txt', stored: 'a.txt' }])
    const result = await applyRestore({ manifest, baseDir: batch, cwd, mode: 'overwrite' })
    assert.equal(result.restored.length, 0)
    assert.equal(result.skipped.length, 1)
    assert.equal(await read(cwd, 'victim.txt'), 'safe')
  } finally {
    await fs.rm(cwd, { recursive: true, force: true })
    await fs.rm(batch, { recursive: true, force: true })
  }
})

test('归档里没有源文件时记 missing，不抛错', async () => {
  const cwd = await tempDir()
  const batch = await tempDir()
  try {
    const manifest = manifestOf([{ rel: 'gone.txt', stored: 'gone.txt' }])
    const result = await applyRestore({ manifest, baseDir: batch, cwd, mode: 'skip' })
    assert.equal(result.failed.length, 0)
    assert.equal(result.skipped[0].action, 'missing')
  } finally {
    await fs.rm(cwd, { recursive: true, force: true })
    await fs.rm(batch, { recursive: true, force: true })
  }
})
