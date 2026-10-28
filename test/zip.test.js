import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { inflateRawSync } from 'node:zlib'
import { buildZip, crc32, dosTimestamp, safeEntryName } from '../lib/zip.js'

const run = promisify(execFile)

/**
 * 手工解析 zip：从 EOCD 找中央目录，再按偏移读本地头。
 * 不依赖任何 zip 库，这样测试本身也在验证格式而不是验证同一个实现。
 * @param {Buffer} buffer
 */
function readZip(buffer) {
  let eocd = -1
  for (let i = buffer.length - 22; i >= 0; i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  assert.notEqual(eocd, -1, '找不到 EOCD')
  const count = buffer.readUInt16LE(eocd + 10)
  const centralOffset = buffer.readUInt32LE(eocd + 16)

  const entries = []
  let cursor = centralOffset
  for (let i = 0; i < count; i += 1) {
    assert.equal(buffer.readUInt32LE(cursor), 0x02014b50)
    const method = buffer.readUInt16LE(cursor + 10)
    const crc = buffer.readUInt32LE(cursor + 16)
    const compressedSize = buffer.readUInt32LE(cursor + 20)
    const size = buffer.readUInt32LE(cursor + 24)
    const nameLength = buffer.readUInt16LE(cursor + 28)
    const localOffset = buffer.readUInt32LE(cursor + 42)
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8')

    const localNameLength = buffer.readUInt16LE(localOffset + 26)
    const localExtraLength = buffer.readUInt16LE(localOffset + 28)
    const dataStart = localOffset + 30 + localNameLength + localExtraLength
    const raw = buffer.subarray(dataStart, dataStart + compressedSize)
    const data = method === 8 ? inflateRawSync(raw) : raw

    entries.push({ name, method, crc, size, data })
    cursor += 46 + nameLength + buffer.readUInt16LE(cursor + 30) + buffer.readUInt16LE(cursor + 32)
  }
  return entries
}

test('crc32 与已知值一致', () => {
  // "123456789" 的 CRC-32 是 0xCBF43926，这是 CRC 的标准测试向量
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926)
})

test('dosTimestamp 把 1980 年之前夹到 1980', () => {
  const { dosDate } = dosTimestamp(Date.UTC(1970, 0, 1))
  const year = ((dosDate >> 9) & 0x7f) + 1980
  assert.ok(year >= 1980)
})

test('safeEntryName 去掉上跳段与前导斜杠', () => {
  assert.equal(safeEntryName('/a/b/../c.txt'), 'a/b/c.txt')
  assert.equal(safeEntryName('..\\..\\etc\\passwd'), 'etc/passwd')
  assert.equal(safeEntryName(''), 'file')
})

test('自解析：中文名与内容都能原样读回', async () => {
  const zip = await buildZip([
    { name: '报告/第一次.docx', data: Buffer.from('word-bytes'), mtimeMs: Date.now() },
    { name: 'notes.txt', data: Buffer.from('hello'.repeat(100)), mtimeMs: Date.now() },
    { name: '截图.png', data: Buffer.from('png'.repeat(100)), mtimeMs: Date.now() },
  ])
  assert.equal(zip.subarray(0, 2).toString('ascii'), 'PK')
  const entries = readZip(zip)
  assert.equal(entries.length, 3)
  const doc = entries.find((entry) => entry.name === '报告/第一次.docx')
  assert.ok(doc, '中文条目名应保留')
  assert.equal(doc.data.toString(), 'word-bytes')
  const notes = entries.find((entry) => entry.name === 'notes.txt')
  assert.equal(notes.data.toString(), 'hello'.repeat(100))
  // 能压小的条目必须真的用了 deflate，否则这个写入器就只是 STORE
  assert.equal(notes.method, 8)
  assert.equal(doc.method, 0, '不可压缩的小内容应退回 STORE')
  assert.equal(entries.find((entry) => entry.name === '截图.png').method, 0, '已压缩格式直接 STORE')
})

test('第三方实现能正确读取（unzip / Python zipfile 可用时）', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'whale-zip-'))
  const file = path.join(dir, 'basket.zip')
  const payload = Buffer.from('「深海鱼篓」测试内容\n'.repeat(50))
  await fs.writeFile(file, await buildZip([
    { name: 'deep/鱼篓.txt', data: payload, mtimeMs: Date.now() },
    { name: 'raw.bin', data: Buffer.from([0, 1, 2, 3, 4]), mtimeMs: Date.now() },
  ]))

  // 1) Info-ZIP 的完整性检查：只验 CRC 与目录结构，不验中文名落盘
  const hasUnzip = await run('unzip', ['-v']).then(() => true, () => false)
  if (hasUnzip) await run('unzip', ['-t', file])

  // 2) Python 的 zipfile 尊重 UTF-8 位标记，用它交叉验证条目名与内容。
  //    （macOS 自带的老 unzip 会把 UTF-8 名按 OEM 码页落盘，不能拿来验中文名）
  const hasPython = await run('python3', ['-c', 'print(1)']).then(() => true, () => false)
  if (hasPython) {
    const script = [
      'import json, sys, zipfile',
      'z = zipfile.ZipFile(sys.argv[1])',
      'out = {"names": z.namelist(), "text": z.read("deep/鱼篓.txt").decode("utf-8")}',
      'print(json.dumps(out, ensure_ascii=False))',
    ].join('\n')
    const { stdout } = await run('python3', ['-c', script, file])
    const parsed = JSON.parse(stdout)
    assert.deepEqual(parsed.names.sort(), ['deep/鱼篓.txt', 'raw.bin'])
    assert.equal(parsed.text, payload.toString())
  }

  if (!hasUnzip && !hasPython) t.skip('本机既没有 unzip 也没有 python3')
  await fs.rm(dir, { recursive: true, force: true })
})
