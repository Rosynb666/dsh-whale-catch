/**
 * Host 侧 HTTP 接口。全部挂在 `/whale-catch/api/` 前缀下。
 *
 *   GET  /whale-catch/api/ping
 *   GET  /whale-catch/api/basket?session=<id>[&cwd=<path>]
 *   POST /whale-catch/api/refresh   { session, cwd? }
 *   GET  /whale-catch/api/file?session=<id>&path=<abs>
 *   POST /whale-catch/api/zip       { session, paths? }
 *   POST /whale-catch/api/archive   { session, paths? }
 *
 * 所有 path 参数都必须是鱼篓里已登记的路径（store.resolve 唯一准入），
 * 因此这里不存在任意文件读取面。
 */
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import {
  contentDisposition,
  contentTypeFor,
  hasJsonContentType,
  isInlineType,
  isSameOrigin,
  needsSandbox,
  readJsonBody,
  sendError,
  sendJson,
} from './http.js'
import { buildZip } from './zip.js'
import { toPosix } from './kinds.js'

/**
 * 路由挂载点（交给 webServer.register 的 kind:'prefix'）。
 * 注意不能带尾斜杠：prefix 匹配的是 `p` 与 `p/<anything>`，
 * 写成 `/whale-catch/api/` 会变成匹配 `...//`，请求永远落不进来。
 */
export const API_MOUNT = '/whale-catch/api'

/** 请求路径前缀（客户端写死同一个常量），带尾斜杠便于剥路径。 */
export const API_PREFIX = `${API_MOUNT}/`

/** 会话 id 会被拿去拼归档子目录，先限死字符集。 */
const SAFE_ID = /^[A-Za-z0-9._-]{1,128}$/

/**
 * 已知业务错误 → HTTP 状态码。`no-cwd` 是"会话没在前台 / 拿不到工作目录"，
 * 属于客户端可以重试的状态，不该报 500（0.1.2 就是这么干的，界面还会冒出
 * 一段中文，破坏了 en 语言包）。用 Map 而不是对象字面量，免得 `__proto__`
 * 这类错误码从原型链上取到不该取的值。
 * @type {Map<string, number>}
 */
const STATUS_BY_CODE = new Map([['no-cwd', 409]])

/**
 * @param {string} name
 * @returns {string}
 */
function stampName(name) {
  const now = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`
  const base = name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 80) || 'whale-catch'
  return `${base}-${stamp}.zip`
}

/**
 * 同名文件不覆盖：`报告.docx` → `报告 (2).docx`。
 * @param {string} file
 * @returns {Promise<string>} 一个当前不存在的路径
 */
async function uniquePath(file) {
  const dir = path.dirname(file)
  const ext = path.extname(file)
  const stem = path.basename(file, ext)
  let candidate = file
  for (let i = 2; i < 1000; i += 1) {
    try {
      await fsp.access(candidate)
      candidate = path.join(dir, `${stem} (${i})${ext}`)
    } catch {
      return candidate
    }
  }
  return path.join(dir, `${stem}-${Date.now()}${ext}`)
}

/**
 * 建一个请求处理器。
 * @param {object} deps
 * @param {{snapshot: Function, refresh: Function, resolve: Function, version: string}} deps.store
 * @param {{maxFileBytes: number, maxZipBytes: number}} deps.config
 */
export function createApi({ store, config }) {
  /**
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   */
  return async function handle(req, res) {
    const method = req.method ?? 'GET'
    let url
    try {
      url = new URL(req.url ?? '/', 'http://127.0.0.1')
    } catch {
      sendError(res, 400, 'bad-url', '请求地址无法解析')
      return
    }

    if (!url.pathname.startsWith(API_PREFIX)) {
      sendError(res, 404, 'not-found', '没有这条路由')
      return
    }
    const route = url.pathname.slice(API_PREFIX.length).replace(/\/+$/, '')

    if (!isSameOrigin(req)) {
      sendError(res, 403, 'cross-origin', '只接受同源请求')
      return
    }
    if (method !== 'GET' && method !== 'HEAD' && !hasJsonContentType(req)) {
      sendError(res, 415, 'unsupported-media-type', '写操作需要用 application/json')
      return
    }

    try {
      if (route === 'ping' && method === 'GET') {
        sendJson(res, 200, { ok: true, value: { name: 'dsh-whale-catch', version: store.version } })
        return
      }

      if (route === 'basket' && method === 'GET') {
        const session = url.searchParams.get('session') ?? ''
        if (!SAFE_ID.test(session)) {
          sendError(res, 400, 'bad-session', '缺少或非法的 session 参数')
          return
        }
        const cwd = url.searchParams.get('cwd') ?? undefined
        const value = await store.snapshot(session, cwd)
        sendJson(res, 200, { ok: true, value })
        return
      }

      if (route === 'refresh' && method === 'POST') {
        const body = await readJsonBody(req)
        const session = typeof body.session === 'string' ? body.session : ''
        if (!SAFE_ID.test(session)) {
          sendError(res, 400, 'bad-session', '缺少或非法的 session 参数')
          return
        }
        const value = await store.refresh(session, typeof body.cwd === 'string' ? body.cwd : undefined)
        sendJson(res, 200, { ok: true, value })
        return
      }

      if (route === 'file' && (method === 'GET' || method === 'HEAD')) {
        const session = url.searchParams.get('session') ?? ''
        const requested = url.searchParams.get('path') ?? ''
        const abs = SAFE_ID.test(session) ? store.resolve(session, requested) : undefined
        if (abs === undefined) {
          sendError(res, 404, 'not-in-basket', '这个文件不在鱼篓里')
          return
        }
        let stat
        try {
          stat = await fsp.stat(abs)
        } catch {
          sendError(res, 404, 'missing', '文件已被删除或移动')
          return
        }
        if (!stat.isFile()) {
          sendError(res, 400, 'not-a-file', '不是一个普通文件')
          return
        }
        if (stat.size > config.maxFileBytes) {
          sendError(res, 413, 'too-large', '文件超过单文件上限')
          return
        }
        const type = contentTypeFor(abs)
        /** @type {Record<string, string|number>} */
        const headers = {
          'Content-Type': type,
          'Content-Length': stat.size,
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
          'Content-Disposition': contentDisposition(path.basename(abs), isInlineType(type)),
        }
        // HTML / SVG 内联出去会继承 Host 源：沙箱掉脚本，别让它反手调本机 API。
        if (needsSandbox(type)) headers['Content-Security-Policy'] = 'sandbox'
        res.writeHead(200, headers)
        if (method === 'HEAD') {
          res.end()
          return
        }
        const stream = fs.createReadStream(abs)
        stream.on('error', () => {
          res.destroy()
        })
        stream.pipe(res)
        return
      }

      if (route === 'zip' && method === 'POST') {
        const body = await readJsonBody(req)
        const session = typeof body.session === 'string' ? body.session : ''
        if (!SAFE_ID.test(session)) {
          sendError(res, 400, 'bad-session', '缺少或非法的 session 参数')
          return
        }
        const requested = Array.isArray(body.paths) ? body.paths : []
        const snapshot = await store.snapshot(session, typeof body.cwd === 'string' ? body.cwd : undefined)
        const wanted = new Set(requested.filter((p) => typeof p === 'string'))
        const selected = snapshot.files.filter((file) => {
          if (file.missing) return false
          return wanted.size === 0 ? true : wanted.has(file.path) || wanted.has(file.rel)
        })
        if (selected.length === 0) {
          sendError(res, 400, 'empty', '没有可打包的文件')
          return
        }

        /** @type {{name: string, data: Buffer, mtimeMs: number}[]} */
        const entries = []
        /** @type {string[]} 超过单文件上限、被跳过的文件（0.1.3 起不再静默吞掉） */
        const skipped = []
        let total = 0
        for (const file of selected) {
          if (file.size > config.maxFileBytes) {
            skipped.push(file.name)
            continue
          }
          total += file.size
          if (total > config.maxZipBytes) {
            sendError(res, 413, 'zip-too-large', '选中的文件总量超过打包上限')
            return
          }
          try {
            entries.push({ name: toPosix(file.rel), data: await fsp.readFile(file.path), mtimeMs: file.mtimeMs })
          } catch {
            // 打包途中被删：跳过，不让整包失败
          }
        }
        if (entries.length === 0) {
          if (skipped.length > 0) {
            sendError(res, 413, 'all-too-large', `选中的 ${skipped.length} 个文件都超过单文件上限`)
            return
          }
          sendError(res, 400, 'empty', '没有可打包的文件')
          return
        }

        const archive = buildZip(entries)
        const name = stampName(path.basename(snapshot.cwd) || 'whale-catch')
        res.writeHead(200, {
          'Content-Type': 'application/zip',
          'Content-Length': archive.length,
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
          'Content-Disposition': contentDisposition(name),
          // 自定义头给客户端提示用；同源 fetch 能直接读，跨源时浏览器本来也拿不到响应体。
          'X-Whale-Catch-Skipped': String(skipped.length),
        })
        res.end(archive)
        return
      }

      if (route === 'archive' && method === 'POST') {
        const body = await readJsonBody(req)
        const session = typeof body.session === 'string' ? body.session : ''
        if (!SAFE_ID.test(session)) {
          sendError(res, 400, 'bad-session', '缺少或非法的 session 参数')
          return
        }
        const snapshot = await store.snapshot(session, typeof body.cwd === 'string' ? body.cwd : undefined)
        const requested = Array.isArray(body.paths) ? body.paths : []
        const wanted = new Set(requested.filter((p) => typeof p === 'string'))
        const selected = snapshot.files.filter((file) => {
          if (file.missing) return false
          return wanted.size === 0 ? true : wanted.has(file.path) || wanted.has(file.rel)
        })
        if (selected.length === 0) {
          sendError(res, 400, 'empty', '没有可归档的文件')
          return
        }

        const root = path.join(snapshot.archiveDir, session)
        await fsp.mkdir(root, { recursive: true })
        const copied = []
        const failed = []
        for (const file of selected) {
          // cwd 之外的文件（`present` 声明的绝对路径）没有相对位置可言：
          // 统一收进 `_external/<文件名>`。0.1.2 会把它按绝对路径镜像成
          // `Users/…`（Windows 上还有盘符目录），既丑又可能撞名。
          const dest = path.isAbsolute(file.rel)
            ? path.join(root, '_external', path.basename(file.rel))
            : path.join(root, ...toPosix(file.rel).split('/'))
          if (!dest.startsWith(root + path.sep)) {
            failed.push({ path: file.rel, reason: 'unsafe-path' })
            continue
          }
          try {
            await fsp.mkdir(path.dirname(dest), { recursive: true })
            const target = (await fsp.access(dest).then(() => true, () => false)) ? await uniquePath(dest) : dest
            await fsp.copyFile(file.path, target)
            copied.push(toPosix(path.relative(snapshot.archiveDir, target)))
          } catch (error) {
            failed.push({ path: file.rel, reason: String(error?.message ?? error) })
          }
        }
        sendJson(res, 200, { ok: true, value: { dir: root, copied, failed } })
        return
      }

      sendError(res, 404, 'not-found', '没有这条路由')
    } catch (error) {
      // 业务错误码（no-cwd）走状态码映射；其余维持 500，避免把内部信息当 4xx 漏出去。
      const code = typeof error?.code === 'string' ? error.code : ''
      const mapped = STATUS_BY_CODE.get(code)
      const status = Number(error?.status) || mapped || 500
      sendError(res, status, mapped === undefined ? (status === 500 ? 'internal' : 'bad-request') : code, String(error?.message ?? error))
    }
  }
}
