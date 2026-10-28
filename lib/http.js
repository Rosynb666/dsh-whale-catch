/**
 * HTTP 小工具：同源栅栏、JSON 收发、MIME 猜测。
 *
 * 这些路由跑在 127.0.0.1 的 Host 上，真正的威胁不是"本机其它进程"（它本来就能读
 * 你的文件），而是**浏览器里的第三方页面**借用户身份打过来（DNS rebinding / CSRF）。
 * 所以三道闸：
 *   1. 带 Origin 且 Host 对不上的请求，一律 403；
 *   2. Sec-Fetch-Site 明确是 cross-site 的，一律 403；
 *   3. 写操作必须 application/json —— 跨站表单发不出这个 content-type，
 *      而声明了它就会触发预检，预检打到本路由直接被 405 挡掉。
 */
import path from 'node:path'
import { isIP } from 'node:net'

/** 按后缀给 Content-Type；未知类型给 application/octet-stream。 */
const MIME = {
  txt: 'text/plain; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
  log: 'text/plain; charset=utf-8',
  json: 'application/json; charset=utf-8',
  jsonl: 'application/x-ndjson; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  html: 'text/html; charset=utf-8',
  htm: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  pdf: 'application/pdf',
  zip: 'application/zip',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
}

/**
 * 代码文件按纯文本内联，别再让 .py / .ts / .yml 走 octet-stream 触发下载。
 * 这里只放"在 DSH 工作区里基本一定是源码"的后缀。
 */
const TEXT_CODE_EXT = new Set([
  'py', 'pyi', 'ts', 'tsx', 'mts', 'cts', 'jsx', 'cjs', 'java', 'kt', 'kts',
  'c', 'h', 'cc', 'cpp', 'hpp', 'cs', 'go', 'rs', 'rb', 'php', 'swift',
  'sh', 'bash', 'zsh', 'fish', 'ps1', 'sql', 'yaml', 'yml', 'toml', 'xml',
  'ini', 'cfg', 'conf', 'env', 'vue', 'svelte', 'ipynb', 'tex', 'r', 'lua',
  'pl', 'ex', 'exs', 'erl', 'hs', 'clj', 'scala', 'dart', 'gradle', 'mk',
])

/**
 * @param {string} file
 * @returns {string}
 */
export function contentTypeFor(file) {
  const ext = path.extname(file).slice(1).toLowerCase()
  if (TEXT_CODE_EXT.has(ext)) return 'text/plain; charset=utf-8'
  return MIME[ext] ?? 'application/octet-stream'
}

/**
 * 哪些类型适合在浏览器里直接看，其余按附件下载。
 * @param {string} contentType
 * @returns {boolean}
 */
export function isInlineType(contentType) {
  return (
    contentType.startsWith('image/') ||
    contentType.startsWith('text/') ||
    contentType === 'application/pdf' ||
    contentType === 'application/json; charset=utf-8' ||
    contentType === 'application/x-ndjson; charset=utf-8'
  )
}

/**
 * 能执行脚本的文档类型。
 *
 * `/file` 与 DSH 的界面同源，把这个类型原样内联出去，等于给工作区里随便一个
 * HTML / SVG 开了 Host 源的脚本执行权 —— 它转手就能调 `/whale-catch/api/`
 * 把别的文件打包外带（0.1.0 ~ 0.1.2 的真实缺口）。修法是给这些响应加
 * `Content-Security-Policy: sandbox`：文档照样渲染，但脚本不执行、源被置为
 * opaque，连 same-origin fetch 也发不出去。
 *
 * @param {string} contentType
 * @returns {boolean}
 */
export function needsSandbox(contentType) {
  return (
    contentType === 'text/html; charset=utf-8' ||
    contentType === 'application/xhtml+xml' ||
    contentType === 'image/svg+xml'
  )
}

/**
 * 按 RFC 5987 编码下载文件名，中文/空格文件名不会乱码。
 * @param {string} name
 * @returns {string}
 */
export function contentDisposition(name, inline = false) {
  const ascii = String(name).replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
  const encoded = encodeURIComponent(String(name))
  return `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encoded}`
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {unknown} payload
 */
export function sendJson(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8')
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  })
  res.end(body)
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {string} code
 * @param {string} message
 */
export function sendError(res, status, code, message) {
  sendJson(res, status, { ok: false, error: { code, message } })
}

/**
 * 读 JSON 请求体，带体积上限；超限抛一个带 status 的错误。
 * @param {import('node:http').IncomingMessage} req
 * @param {number} [limit]
 * @returns {Promise<any>}
 */
export async function readJsonBody(req, limit = 1024 * 1024) {
  /** @type {Buffer[]} */
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) {
      const error = new Error('request body too large')
      // @ts-expect-error 自定义字段
      error.status = 413
      throw error
    }
    chunks.push(Buffer.from(chunk))
  }
  // 空体（含零长度分块）按 {} 处理：GET 化调用与「没带参数」都走这条
  if (size === 0) return {}
  const text = Buffer.concat(chunks).toString('utf8')
  try {
    return JSON.parse(text)
  } catch {
    const error = new Error('invalid JSON body')
    // @ts-expect-error 自定义字段
    error.status = 400
    throw error
  }
}

/**
 * 解析单段 `Range`。多段或语法错误按“忽略 Range”返回 null；越界返回
 * `{ unsatisfiable: true }`，由调用方回 416。
 * @param {string|undefined} value
 * @param {number} size
 * @returns {{start: number, end: number}|{unsatisfiable: true}|null}
 */
export function parseRange(value, size) {
  if (typeof value !== 'string') return null
  if (!Number.isSafeInteger(size) || size < 0) return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim())
  if (match === null) return null
  const [, rawStart, rawEnd] = match
  if (rawStart === '' && rawEnd === '') return null

  let start
  let end
  if (rawStart === '') {
    const suffix = Number(rawEnd)
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return null
    start = Math.max(0, size - suffix)
    end = size - 1
  } else {
    start = Number(rawStart)
    end = rawEnd === '' ? size - 1 : Number(rawEnd)
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return null
    if (start >= size) return { unsatisfiable: true }
    if (start > end) return null
    end = Math.min(end, size - 1)
  }
  if (size === 0) return { unsatisfiable: true }
  return { start, end }
}

/**
 * Host 头是不是 IP 字面量、localhost，或配置里明确放行的名字。
 *
 * DNS rebinding 的攻击者只能把页面放在域名下（Host 会一直是 evil.example），
 * 因此“只认 IP 字面量 / localhost / 配置值”就能堵住「Origin 和 Host 同时是
 * 攻击者域名」的那种绕过；局域网 IP 仍然照常可用。
 *
 * @param {string|undefined} host
 * @param {string[]} [allowedHosts]
 * @returns {boolean}
 */
export function isAllowedHost(host, allowedHosts = []) {
  if (typeof host !== 'string' || host === '') return false
  let hostname
  try {
    hostname = new URL(`http://${host}`).hostname
  } catch {
    return false
  }
  hostname = hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (hostname === 'localhost') return true
  if (isIP(hostname) !== 0) return true
  return allowedHosts.some((allowed) => String(allowed).toLowerCase() === hostname)
}

/**
 * 同源判定。没有 Origin 的同源请求（curl、服务端 fetch）放行；
 * 带了 Origin 就必须和 Host 一致，且 Host 本身要是可信的 IP / localhost。
 * @param {import('node:http').IncomingMessage} req
 * @param {string[]} [allowedHosts]
 * @returns {boolean}
 */
export function isSameOrigin(req, allowedHosts = []) {
  const site = req.headers['sec-fetch-site']
  if (typeof site === 'string' && site === 'cross-site') return false

  const host = req.headers.host
  if (!isAllowedHost(host, allowedHosts)) return false

  const origin = req.headers.origin
  if (typeof origin !== 'string' || origin === '') return true
  let originHost
  try {
    originHost = new URL(origin).host
  } catch {
    return false
  }
  return originHost.toLowerCase() === String(host).toLowerCase()
}

/**
 * 写操作要求 application/json。GET/HEAD 不检查。
 * @param {import('node:http').IncomingMessage} req
 * @returns {boolean}
 */
export function hasJsonContentType(req) {
  const raw = req.headers['content-type']
  if (typeof raw !== 'string') return false
  return raw.toLowerCase().split(';')[0].trim() === 'application/json'
}
