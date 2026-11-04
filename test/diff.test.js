import { test } from 'node:test'
import assert from 'node:assert/strict'
import { diffText, splitLines } from '../lib/diff.js'

/**
 * 把 hunk 还原成「旧侧 / 新侧」文本，方便断言算法没丢行。
 * @param {{hunks: any[]}} result
 * @returns {{before: string[], after: string[]}}
 */
function rebuild(result) {
  const before = []
  const after = []
  for (const hunk of result.hunks) {
    for (const line of hunk.lines) {
      const head = line.charAt(0)
      const body = line.slice(1)
      if (head !== '+') before.push(body)
      if (head !== '-') after.push(body)
    }
  }
  return { before, after }
}

test('splitLines 统一 CRLF / CR，并丢掉末尾换行', () => {
  assert.deepEqual(splitLines('a\r\nb\rc\n'), ['a', 'b', 'c'])
  assert.deepEqual(splitLines(''), [])
  assert.deepEqual(splitLines('a'), ['a'])
  assert.deepEqual(splitLines('a\n\n'), ['a', ''])
})

test('相同文本没有 hunk', () => {
  const result = diffText('a\nb\nc\n', 'a\nb\nc\n')
  assert.equal(result.kind, 'text')
  assert.deepEqual(result.hunks, [])
  assert.equal(result.trimmed, false)
})

test('新增一行：行号与内容都对得上', () => {
  const result = diffText('a\nb\nc\n', 'a\nX\nb\nc\n')
  assert.equal(result.hunks.length, 1)
  const [hunk] = result.hunks
  assert.equal(hunk.oldStart, 1)
  assert.equal(hunk.oldLines, 3)
  assert.equal(hunk.newStart, 1)
  assert.equal(hunk.newLines, 4)
  assert.deepEqual(hunk.lines, [' a', '+X', ' b', ' c'])
  assert.deepEqual(rebuild(result).after, ['a', 'X', 'b', 'c'])
})

test('删除一行', () => {
  const result = diffText('a\nb\nc\n', 'a\nc\n')
  const [hunk] = result.hunks
  assert.deepEqual(hunk.lines, [' a', '-b', ' c'])
  assert.equal(hunk.oldLines, 3)
  assert.equal(hunk.newLines, 2)
})

test('替换一行', () => {
  const result = diffText('a\nb\nc\n', 'a\nB\nc\n')
  const [hunk] = result.hunks
  assert.deepEqual(hunk.lines, [' a', '-b', '+B', ' c'])
})

test('文件开头插入：上下文带上原文件前几行', () => {
  const result = diffText('x\ny\n', 'n\nx\ny\n')
  const [hunk] = result.hunks
  assert.equal(hunk.oldStart, 1)
  assert.equal(hunk.oldLines, 2)
  assert.equal(hunk.newStart, 1)
  assert.equal(hunk.newLines, 3)
  assert.deepEqual(hunk.lines, ['+n', ' x', ' y'])
})

test('空文件到有内容、有内容到空文件', () => {
  const added = diffText('', 'x\ny\n')
  assert.deepEqual(added.hunks[0].lines, ['+x', '+y'])
  const removed = diffText('x\ny\n', '')
  assert.deepEqual(removed.hunks[0].lines, ['-x', '-y'])
})

test('中文按行比较，不按字节', () => {
  const result = diffText('标题\n第二行\n', '标题\n改过的第二行\n第三行\n')
  const lines = result.hunks[0].lines
  assert.ok(lines.includes('-第二行'))
  assert.ok(lines.includes('+改过的第二行'))
  assert.ok(lines.includes('+第三行'))
})

test('CRLF 与 LF 视为同一内容', () => {
  const result = diffText('a\r\nb\r\n', 'a\nb\n')
  assert.deepEqual(result.hunks, [])
})

test('二进制返回 binary', () => {
  assert.deepEqual(diffText(Buffer.from([0, 1, 2]), 'x'), { kind: 'binary' })
  assert.deepEqual(diffText('x', Buffer.from([0xff, 0xfe])), { kind: 'binary' })
})

test('超长文本返回 oversized', () => {
  const huge = `${'x'.repeat(1024 * 1024 + 10)}`
  const result = diffText(huge, 'short')
  assert.equal(result.kind, 'oversized')
})

test('改动太大时退化成整文件替换，但仍返回 hunk', () => {
  const a = Array.from({ length: 900 }, (_, i) => `a${i}`)
  const b = Array.from({ length: 900 }, (_, i) => `b${i}`)
  const result = diffText(a.join('\n'), b.join('\n'))
  assert.equal(result.kind, 'text')
  assert.ok(result.hunks.length >= 1)
  assert.equal(result.coarse, true)
})

test('稀疏改动会按 3 行上下文合并/切开 hunk', () => {
  const before = Array.from({ length: 40 }, (_, i) => `line ${i}`)
  const after = before.slice()
  after[2] = 'changed 2'
  after[30] = 'changed 30'
  const result = diffText(before.join('\n'), after.join('\n'))
  assert.equal(result.hunks.length, 2)
  for (const hunk of result.hunks) {
    assert.ok(hunk.lines.length <= 1 + 3 + 3 + 3)
  }
})
