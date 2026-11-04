import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { checkFiles, scanSensitive } from '../lib/preflight.js'

const base = { maxFileBytes: 1024, maxZipBytes: 4096 }

test('缺文件、超大、空文件、敏感名、外置文件都能识别', () => {
  const issues = checkFiles(
    [
      { rel: 'gone.txt', name: 'gone.txt', path: '/tmp/gone.txt', size: 0, missing: true },
      { rel: 'big.bin', name: 'big.bin', path: '/tmp/big.bin', size: 2048 },
      { rel: 'empty.txt', name: 'empty.txt', path: '/tmp/empty.txt', size: 0 },
      { rel: '.env', name: '.env', path: '/tmp/.env', size: 12 },
      { rel: '/Users/me/out.txt', name: 'out.txt', path: '/Users/me/out.txt', size: 10 },
    ],
    base,
  )
  const codes = issues.map((issue) => issue.code)
  assert.ok(codes.includes('missing'))
  assert.ok(codes.includes('too-large'))
  assert.ok(codes.includes('empty'))
  assert.ok(codes.includes('sensitive-name'))
  assert.ok(codes.includes('external-file'))
})

test('总量超限只报一条', () => {
  const issues = checkFiles(
    [
      { rel: 'a.txt', name: 'a.txt', path: '/tmp/a', size: 3000 },
      { rel: 'b.txt', name: 'b.txt', path: '/tmp/b', size: 3000 },
    ],
    { maxFileBytes: 4096, maxZipBytes: 4096 },
  )
  assert.equal(issues.filter((issue) => issue.code === 'zip-total-too-large').length, 1)
})

test('归档后改过只给 info，不阻断', () => {
  const latestManifest = {
    manifest: {
      files: [{ rel: 'a.txt', size: 10, mtimeMs: 1000 }],
    },
  }
  const issues = checkFiles(
    [{ rel: 'a.txt', name: 'a.txt', path: '/tmp/a', size: 20, mtimeMs: 5000 }],
    { ...base, latestManifest },
  )
  const hit = issues.find((issue) => issue.code === 'dirty-since-archive')
  assert.equal(hit?.level, 'info')
})

test('额外敏感文件名通配符生效', () => {
  const issues = checkFiles(
    [{ rel: 'secret.tok', name: 'secret.tok', path: '/tmp/secret.tok', size: 10 }],
    { ...base, sensitivePatterns: ['*.tok'] },
  )
  assert.ok(issues.some((issue) => issue.code === 'sensitive-name'))
})

test('内容扫描命中私钥只回传模式与行号，不回传原文', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'whale-preflight-'))
  try {
    const file = path.join(dir, 'key.txt')
    await fs.writeFile(file, '第一行\n-----BEGIN RSA PRIVATE KEY-----\nMIIE...\n', 'utf8')
    const issues = await scanSensitive(
      [{ rel: 'key.txt', name: 'key.txt', path: file, size: 60 }],
      { maxFileBytes: 1024 },
    )
    assert.equal(issues.length, 1)
    assert.equal(issues[0].code, 'sensitive-content')
    assert.equal(issues[0].pattern, 'private-key')
    assert.equal(issues[0].line, 2)
    const serialized = JSON.stringify(issues)
    assert.equal(serialized.includes('MIIE'), false)
    assert.equal(serialized.includes('PRIVATE KEY'), false)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('内容扫描跳过二进制与超大文件', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'whale-preflight-'))
  try {
    const binary = path.join(dir, 'blob.bin')
    await fs.writeFile(binary, Buffer.from([0, 1, 2, 3]))
    const text = path.join(dir, 'big.txt')
    await fs.writeFile(text, 'x'.repeat(2048))
    const issues = await scanSensitive(
      [
        { rel: 'blob.bin', path: binary, size: 4 },
        { rel: 'big.txt', path: text, size: 2048 },
      ],
      { maxFileBytes: 1024 },
    )
    assert.deepEqual(issues, [])
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})
