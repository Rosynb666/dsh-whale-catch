import { test } from 'node:test'
import assert from 'node:assert/strict'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { buildBrief, renderBriefMarkdown } from '../lib/brief.js'
import { renderPortalHtml, buildPortalEntries } from '../lib/portal.js'
import { aggregateLedger } from '../lib/aggregate.js'

const MANIFEST = {
  generatedBy: 'dsh-whale-catch',
  session: 'session-hub',
  cwd: '~/proj',
  run: '20261108-120000-000',
  archivedAt: '2026-11-08T04:00:00.000Z',
  files: [
    { rel: '报告.docx', stored: '报告.docx', size: 2048, turn: 2, sha256: 'a'.repeat(64), desc: '最终稿' },
    { rel: 'images/<script>alert(1)</script>.png', stored: 'images/evil.png', size: 1024, turn: 3, sha256: 'b'.repeat(64) },
    { rel: 'data.csv', stored: 'data.csv', size: 512, turn: 2, sha256: 'c'.repeat(64) },
  ],
  failed: [],
}

test('buildBrief 汇总文件数、体积、类型与轮次', () => {
  const brief = buildBrief(MANIFEST)
  assert.equal(brief.stats.files, 3)
  assert.equal(brief.stats.bytes, 3584)
  assert.deepEqual(brief.stats.turns, [2, 3])
  assert.equal(brief.bullets[0], '共 3 个文件，合计 3.50 KB。')
  assert.ok(brief.summary.includes('文档'))
  assert.ok(brief.summary.includes('图片'))
  assert.ok(brief.summary.includes('表格'))
  assert.ok(brief.bullets.some((line) => line.includes('轮次')))
})

test('buildBrief 把未归档文件写进摘要', () => {
  const brief = buildBrief({ ...MANIFEST, failed: [{ rel: 'raw.bin', reason: 'too-large' }] })
  assert.equal(brief.stats.failed, 1)
  assert.ok(brief.bullets.some((line) => line.includes('1 个文件未归档')))
})

test('renderBriefMarkdown 生成可读清单', () => {
  const markdown = renderBriefMarkdown(buildBrief(MANIFEST), MANIFEST)
  assert.ok(markdown.includes('# 交付摘要'))
  assert.ok(markdown.includes('报告.docx'))
  assert.ok(markdown.includes('| 文件 | 体积 | 轮次 | sha256 |'))
})

test('renderPortalHtml 转义文件名，模板不带脚本', () => {
  const html = renderPortalHtml(MANIFEST, { version: '0.5.0-test' })
  assert.ok(html.includes('交付门户'))
  assert.ok(html.includes('本批摘要'))
  assert.ok(html.includes('0.5.0-test'))
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'))
  assert.equal(html.includes('<script>'), false)
  assert.ok(html.includes("default-src 'none'"))
  assert.ok(html.includes('清单版'))
})

test('完整版门户给文件链接和缩略图，清单版不给', () => {
  const compact = renderPortalHtml(MANIFEST, { includeFiles: false })
  assert.equal(compact.includes('href="files/'), false)
  const full = renderPortalHtml(MANIFEST, { includeFiles: true })
  assert.ok(full.includes('href="files/'))
  assert.ok(full.includes('<img loading="lazy"'))
  assert.ok(full.includes('完整版'))
})

test('buildPortalEntries 生成门户、摘要、回执与可选文件', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'whale-portal-'))
  try {
    await fsp.mkdir(path.join(dir, 'images'), { recursive: true })
    await fsp.writeFile(path.join(dir, '报告.docx'), Buffer.from('docx'))
    await fsp.writeFile(path.join(dir, 'images', 'evil.png'), Buffer.from('png'))
    await fsp.writeFile(path.join(dir, 'data.csv'), Buffer.from('a,b\n1,2\n'))

    const compact = []
    for await (const entry of buildPortalEntries({ manifest: MANIFEST, baseDir: dir, includeFiles: false })) {
      compact.push(entry.name)
    }
    assert.deepEqual(compact, ['portal.html', '交付说明.md', '_whale-catch/manifest.json', '_whale-catch/receipt.html', '_whale-catch/receipt.md'])

    const full = []
    for await (const entry of buildPortalEntries({ manifest: MANIFEST, baseDir: dir, includeFiles: true })) {
      full.push(entry.name)
    }
    assert.ok(full.includes('files/报告.docx'))
    assert.ok(full.includes('files/data.csv'))
    assert.ok(full.includes('files/images/evil.png'))
    assert.equal(full.includes('portal.html'), true)
  } finally {
    await fsp.rm(dir, { recursive: true, force: true })
  }
})

test('aggregateLedger 汇总多个会话并排序', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'whale-aggregate-'))
  try {
    await fsp.writeFile(
      path.join(dir, 'session-a.jsonl'),
      [
        JSON.stringify({ v: 1, t: 'archive', at: 1000, run: '20261108-100000-000', count: 2, bytes: 100, failed: 0 }),
        JSON.stringify({ v: 1, t: 'archive', at: 3000, run: '20261108-120000-000', count: 3, bytes: 200, failed: 1 }),
      ].join('\n') + '\n',
    )
    await fsp.writeFile(
      path.join(dir, 'session-b.jsonl'),
      JSON.stringify({ v: 1, t: 'archive', at: 2000, run: '20261108-110000-000', count: 1, bytes: 50, failed: 0 }) + '\n',
    )
    await fsp.writeFile(path.join(dir, 'not-a-session.txt'), 'ignored')

    const value = await aggregateLedger({ ledgerDir: dir, limit: 10 })
    assert.deepEqual(value.totals, { sessions: 2, runs: 3, files: 6, bytes: 350 })
    assert.equal(value.sessions[0].session, 'session-a')
    assert.equal(value.sessions[0].lastAt, 3000)
    assert.equal(value.sessions[1].session, 'session-b')
  } finally {
    await fsp.rm(dir, { recursive: true, force: true })
  }
})
