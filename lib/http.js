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
 * @param {string} file
 * @returns {string}
 */
export function contentTypeFor(file) {
  const ext = path.extname(file).slice(1).toLowerCase()
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
 * 同源判定。没有 Origin 的同源请求（curl、服务端 fetch）放行；
 * 带了 Origin 就必须和 Host 一致。
 * @param {import('node:http').IncomingMessage} req
 * @returns {boolean}
 */
export function isSameOrigin(req) {
  const site = req.headers['sec-fetch-site']
  if (typeof site === 'string' && site === 'cross-site') return false

  const origin = req.headers.origin
  if (typeof origin !== 'string' || origin === '') return true
  let originHost
  try {
    originHost = new URL(origin).host
  } catch {
    return false
  }
  const host = req.headers.host
  if (typeof host !== 'string' || host === '') return false
  return originHost === host
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
