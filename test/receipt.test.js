import { test } from 'node:test'
import assert from 'node:assert/strict'
import { escapeHtml, formatBytes, renderReceiptHtml, renderReceiptMarkdown } from '../lib/receipt.js'

const manifest = {
  session: 'ses_demo',
  cwd: '~/Desktop/鲸鱼娘的工作区',
  run: '20261104-133806-123',
  archivedAt: '2026-11-04T05:38:06.123Z',
  files: [
    {
      rel: '报告/终稿.docx',
      stored: '报告/终稿.docx',
      size: 812345,
      sha256: 'a'.repeat(64),
      turn: 7,
      desc: '最终交付',
    },
    {
      rel: '<img src=x onerror=alert(1)>.md',
      stored: 'x.md',
      size: 12,
      sha256: 'b'.repeat(64),
      turn: 2,
      desc: '<script>alert("x")</script>',
    },
  ],
  failed: [{ rel: 'big.zip', reason: 'too-large' }],
}

test('escapeHtml 转义五个危险字符', () => {
  assert.equal(escapeHtml(`<a href="x">'&'</a>`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;')
})

test('formatBytes 人类可读', () => {
  assert.equal(formatBytes(0), '0 B')
  assert.equal(formatBytes(1024), '1.00 KB')
  assert.equal(formatBytes(812345), '793 KB')
})

test('HTML 回执包含清单字段与 hash', () => {
  const html = renderReceiptHtml(manifest, { version: '0.4.0' })
  assert.ok(html.includes('交付回执'))
  assert.ok(html.includes('20261104-133806-123'))
  assert.ok(html.includes('a'.repeat(16)))
  assert.ok(html.includes('0.4.0'))
  assert.ok(html.includes('final') === false)
})

test('HTML 回执转义文件名与描述，不执行脚本', () => {
  const html = renderReceiptHtml(manifest)
  assert.equal(html.includes('<img src=x'), false)
  assert.equal(html.includes('<script>alert'), false)
  assert.ok(html.includes('&lt;img src=x'))
  assert.ok(html.includes('&lt;script&gt;'))
})

test('Markdown 回执表格转义竖线', () => {
  const md = renderReceiptMarkdown({
    ...manifest,
    files: [{ rel: 'a|b.txt', size: 1, sha256: 'c'.repeat(64), turn: 1, desc: 'x|y' }],
  })
  assert.ok(md.includes('a\\|b.txt'))
  assert.ok(md.includes('x\\|y'))
})

test('校验结果会体现在 HTML 回执里', () => {
  const html = renderReceiptHtml(manifest, {
    verified: [
      { rel: '报告/终稿.docx', ok: true },
      { rel: '<img src=x onerror=alert(1)>.md', ok: false },
    ],
  })
  assert.ok(html.includes('1 / 2'))
  assert.ok(html.includes('✗'))
})
