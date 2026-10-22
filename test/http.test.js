import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import {
  contentDisposition,
  contentTypeFor,
  hasJsonContentType,
  isInlineType,
  isSameOrigin,
  needsSandbox,
  readJsonBody,
} from '../lib/http.js'

/**
 * @param {object} headers
 */
function req(headers) {
  return /** @type {any} */ ({ headers })
}

test('isSameOrigin：无 Origin 放行，同源放行，跨源拒绝', () => {
  assert.equal(isSameOrigin(req({ host: '127.0.0.1:19387' })), true)
  assert.equal(isSameOrigin(req({ host: '127.0.0.1:19387', origin: 'http://127.0.0.1:19387' })), true)
  assert.equal(isSameOrigin(req({ host: '127.0.0.1:19387', origin: 'http://evil.example' })), false)
  assert.equal(isSameOrigin(req({ host: '127.0.0.1:19387', origin: 'null' })), false)
  assert.equal(isSameOrigin(req({ host: '127.0.0.1:19387', 'sec-fetch-site': 'cross-site' })), false)
})

test('contentTypeFor 与 isInlineType：pdf/图片/文本内联，docx 走附件', () => {
  assert.match(contentTypeFor('a.pdf'), /application\/pdf/)
  assert.equal(isInlineType(contentTypeFor('a.png')), true)
  assert.equal(isInlineType(contentTypeFor('a.pdf')), true)
  assert.equal(isInlineType(contentTypeFor('a.docx')), false)
  assert.equal(contentTypeFor('no-extension'), 'application/octet-stream')
})

test('needsSandbox：只有能执行脚本的文档类型才加 CSP 沙箱', () => {
  // 这三类内联出去会拿到 Host 源，必须沙箱
  assert.equal(needsSandbox(contentTypeFor('报告.html')), true)
  assert.equal(needsSandbox(contentTypeFor('示意图.svg')), true)
  assert.equal(needsSandbox('application/xhtml+xml'), true)
  // 普通文本、图片、PDF 不背这个锅
  assert.equal(needsSandbox(contentTypeFor('说明.txt')), false)
  assert.equal(needsSandbox(contentTypeFor('截图.png')), false)
  assert.equal(needsSandbox(contentTypeFor('手册.pdf')), false)
  assert.equal(needsSandbox(contentTypeFor('报告.docx')), false)
})

test('contentDisposition：ASCII 回退 + RFC 5987 编码', () => {
  const header = contentDisposition('报告 2026.docx')
  assert.match(header, /^attachment;/)
  assert.match(header, /filename="[^"]+"/)
  assert.match(header, /filename\*=UTF-8''/)
  const encoded = /filename\*=UTF-8''([^;]+)/.exec(header)
  assert.equal(decodeURIComponent(encoded[1]), '报告 2026.docx')
})

test('hasJsonContentType：区分 application/json 与表单', () => {
  assert.equal(hasJsonContentType(req({ 'content-type': 'application/json' })), true)
  assert.equal(hasJsonContentType(req({ 'content-type': 'application/json; charset=utf-8' })), true)
  assert.equal(hasJsonContentType(req({ 'content-type': 'text/plain' })), false)
  assert.equal(hasJsonContentType(req({})), false)
})

test('readJsonBody：解析、空体、超限与坏 JSON', async () => {
  const parse = async (text, limit) => readJsonBody(/** @type {any} */ (Readable.from([Buffer.from(text)])), limit)

  assert.deepEqual(await parse('{"a":1}'), { a: 1 })
  assert.deepEqual(await parse(''), {})

  await assert.rejects(() => parse('x'.repeat(2048), 1024), (error) => error.status === 413)
  await assert.rejects(() => parse('{oops'), (error) => error.status === 400)
})
