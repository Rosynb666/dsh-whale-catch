/**
 * Host 侧 HTTP 接口。全部挂在 `/whale-catch/api/` 前缀下。
 *
 *   GET  /whale-catch/api/ping
 *   GET  /whale-catch/api/basket?session=<id>[&cwd=<path>]
 *   POST /whale-catch/api/refresh   { session, cwd? }
 *   GET  /whale-catch/api/file?session=<id>&path=<abs>
 *   GET  /whale-catch/api/diff?session=<id>&path=<abs>
 *   POST /whale-catch/api/zip       { session, paths? }
 *   POST /whale-catch/api/archive   { session, paths? }
 *
 * 所有 path 参数都必须是鱼篓里已登记的路径（store.resolve 唯一准入），
 * 因此这里不存在任意文件读取面。`/diff` 更进一步：只对带 `workspace/changes`
 * 记录的条目开放，内容是内核已经为这次会话留好的对比。
 */
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  contentDisposition,
  contentTypeFor,
  hasJsonContentType,
  isInlineType,
  isSameOrigin,
  needsSandbox,
  parseRange,
  readJsonBody,
  sendError,
  sendJson,
} from './http.js'
import { writeZip } from './zip.js'
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
 *
 * 差异相关的几个码都是"这条看不了"，不是服务端挂了：404 让面板给一句
 * 可读的提示，`diff-timeout` 才是 504。
 * @type {Map<string, number>}
 */
const STATUS_BY_CODE = new Map([
  ['no-cwd', 409],
  ['no-session', 404],
  ['not-in-basket', 404],
  ['no-change', 404],
  ['no-diff', 404],
  ['diff-timeout', 504],
])

/** `/diff` 的默认等待上限：超过就回 504，不让一次对比把请求挂死。 */
const DEFAULT_DIFF_TIMEOUT_MS = 8000

/** 一次最多回传多少行 diff：侧栏面板扛得住，也挡住病态大文件把响应撑爆。 */
export const DIFF_LINE_BUDGET = 1200

/**
 * 把内核的 `WorkspaceFileDiff` 裁到面板能承受的大小。
 *
 * 只裁 `text`：binary / oversized 本来就没有行。裁剪时按行首的 `+` / `-` / 空格
 * 重算 hunk 的两个行数，免得面板上的 `@@` 头和实际行数对不上。
 *
 * @param {any} diff
 * @param {number} [budget]
 * @returns {any}
 */
export function trimDiff(diff, budget = DIFF_LINE_BUDGET) {
  if (diff === null || typeof diff !== 'object' || diff.kind !== 'text') return diff
  let left = Number.isFinite(budget) ? Math.max(0, Math.trunc(budget)) : DIFF_LINE_BUDGET
  const source = Array.isArray(diff.hunks) ? diff.hunks : []
  const hunks = []
  let trimmed = diff.trimmed === true

  for (const hunk of source) {
    if (left <= 0) {
      trimmed = true
      break
    }
    const lines = Array.isArray(hunk?.lines) ? hunk.lines : []
    if (lines.length > left) {
      const kept = lines.slice(0, left)
      let oldLines = 0
      let newLines = 0
      for (const line of kept) {
        const head = String(line).charAt(0)
        if (head !== '+') oldLines += 1
        if (head !== '-') newLines += 1
      }
      hunks.push({ ...hunk, oldLines, newLines, lines: kept })
      trimmed = true
      break
    }
    left -= lines.length
    hunks.push(hunk)
  }

  return { ...diff, hunks, trimmed }
}

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
 * zip 里的「交付清单.md」：不打开插件也能看懂这一包是什么。
 * @param {any} manifest
 * @returns {string}
 */
function buildChecklist(manifest) {
  const lines = [
    '# 交付清单',
    '',
    '- 会话：`' + manifest.session + '`',
    '- 目录：`' + manifest.cwd + '`',
    '- 生成：' + manifest.generatedAt,
    '',
    '| 文件 | 体积 | 轮次 | 行数 | 来源 |',
    '| --- | --- | --- | --- | --- |',
  ]
  for (const file of manifest.files) {
    const delta = typeof file.added === 'number' ? '+' + file.added + ' −' + file.deleted : '—'
    const name = String(file.name).replace(/\|/g, '\\|')
    lines.push('| ' + name + ' | ' + file.size + ' B | ' + (file.turn ?? '—') + ' | ' + delta + ' | ' + file.sources.join('/') + ' |')
  }
  if (manifest.skipped.length > 0) {
    lines.push('', '跳过（超过单文件上限）：' + manifest.skipped.join('、'))
  }
  return lines.join('\n')
}

/**
 * 把用户主目录前缀换成 `~`：zip 的 manifest 会被分享出去，没必要带上本机用户名。
 * @param {string} value
 * @returns {string}
 */
export function redactHome(value) {
  if (typeof value !== 'string') return value
  const home = os.homedir()
  if (value === home) return '~'
  if (value.startsWith(home + path.sep)) return `~${value.slice(home.length)}`
  return value
}

/**
 * zip 里的条目名。cwd 之外的文件没有相对位置可言，统一收进 `_external/`，
 * 与归档目录保持同一套语义（也避免把 `/Users/...` 镜像进要分享的包）。
 * 重名时按 `名字 (2).ext` 递增。
 *
 * @param {{rel: string}} file
 * @param {Set<string>} used
 * @returns {string}
 */
function zipEntryName(file, used) {
  const rel = toPosix(file.rel)
  const base = path.isAbsolute(rel) ? `_external/${path.basename(rel)}` : rel
  let candidate = base
  if (used.has(candidate)) {
    const ext = path.extname(candidate)
    const stem = ext === '' ? candidate : candidate.slice(0, -ext.length)
    let index = 2
    while (used.has(`${stem} (${index})${ext}`)) index += 1
    candidate = `${stem} (${index})${ext}`
  }
  used.add(candidate)
  return candidate
}

/**
 * 把一块 Buffer 写进响应，并尊重背压；客户端断开时让写入失败，别让打包协程
 * 在已经没人收的响应上继续读盘。
 * @param {import('node:http').ServerResponse} res
 * @param {Buffer} chunk
 * @returns {Promise<void>}
 */
function writeChunk(res, chunk) {
  return new Promise((resolve, reject) => {
    if (res.destroyed || res.writableEnded) {
      reject(new Error('client closed'))
      return
    }
    if (res.write(chunk)) {
      resolve()
      return
    }
    const onDrain = () => {
      cleanup()
      resolve()
    }
    const onClose = () => {
      cleanup()
      reject(new Error('client closed'))
    }
    const cleanup = () => {
      res.off('drain', onDrain)
      res.off('close', onClose)
    }
    res.once('drain', onDrain)
    res.once('close', onClose)
  })
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
 * 归档批次目录名：`YYYYMMDD-HHMMSS-mmm`。固定宽度保证字典序就是时间序，
 * 清理时按名字倒排即可，不用额外读 stat。
 * @param {Date} [date]
 * @returns {string}
 */
function archiveStamp(date = new Date()) {
  const pad = (value, width = 2) => String(value).padStart(width, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}-${pad(date.getMilliseconds(), 3)}`
}

/**
 * 批次目录重名时追加 `-2` / `-3`：同一毫秒连点两次归档也不会互相覆盖。
 * @param {string} dir
 * @returns {Promise<string>}
 */
async function uniqueDir(dir) {
  let candidate = dir
  for (let i = 2; i < 1000; i += 1) {
    try {
      await fsp.access(candidate)
      candidate = `${dir}-${i}`
    } catch {
      return candidate
    }
  }
  return `${dir}-${Date.now()}`
}

/** 只认本插件生成的批次目录名；手工塞进来的目录不碰。 */
const ARCHIVE_RUN_NAME = /^\d{8}-\d{6}-\d{3}(?:-\d+)?$/

/**
 * 清理 `<archiveDir>/<session>/runs` 下超过 keep 个的旧批次。
 *
 * 安全边界：只在 runs 目录内操作，只删普通目录（不跟符号链接），名字必须
 * 符合批次格式；删除失败只跳过，不让一次清理失败毁掉本次归档。
 *
 * @param {string} runsDir
 * @param {number} keep
 * @param {string} [activeName] 本次刚写入的批次，永远不删（防系统时间回拨误删）
 * @returns {Promise<string[]>} 被删掉的批次名
 */
async function pruneArchiveRuns(runsDir, keep, activeName) {
  let entries
  try {
    entries = await fsp.readdir(runsDir, { withFileTypes: true })
  } catch {
    return []
  }
  const names = []
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue
    if (!ARCHIVE_RUN_NAME.test(entry.name)) continue
    if (entry.name === activeName) continue
    names.push(entry.name)
  }
  names.sort((a, b) => b.localeCompare(a))
  // activeName 已经从列表里排除了，所以旧批次只能再留 keep - 1 个。
  const keepOld = Math.max(0, keep - 1)
  const pruned = []
  for (const name of names.slice(keepOld)) {
    try {
      await fsp.rm(path.join(runsDir, name), { recursive: true, force: true })
      pruned.push(name)
    } catch {
      // 下一轮归档还会再试，不影响本次结果
    }
  }
  return pruned
}

/**
 * 建一个请求处理器。
 * @param {object} deps
 * @param {{snapshot: Function, refresh: Function, resolve: Function, version: string}} deps.store
 * @param {{maxFileBytes: number, maxZipBytes: number, maxBodyBytes?: number, archiveKeep?: number, allowHosts?: string[]}} deps.config
 */
export function createApi({ store, config }) {
  const diffTimeoutMs =
    Number.isFinite(Number(config?.diffTimeoutMs)) && Number(config.diffTimeoutMs) > 0
      ? Number(config.diffTimeoutMs)
      : DEFAULT_DIFF_TIMEOUT_MS
  const maxBodyBytes =
    Number.isFinite(Number(config?.maxBodyBytes)) && Number(config.maxBodyBytes) > 0
      ? Number(config.maxBodyBytes)
      : 1024 * 1024
  const allowHosts = Array.isArray(config?.allowHosts) ? config.allowHosts : []
  const archiveKeep = Number.isFinite(Number(config?.archiveKeep))
    ? Math.max(0, Math.trunc(Number(config.archiveKeep)))
    : 0

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

    if (!isSameOrigin(req, allowHosts)) {
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
        const body = await readJsonBody(req, maxBodyBytes)
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
        const etag = `"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`
        const lastModified = stat.mtime.toUTCString()

        if (typeof req.headers['if-none-match'] === 'string' && req.headers['if-none-match'] === etag) {
          res.writeHead(304, { ETag: etag, 'Last-Modified': lastModified, 'Cache-Control': 'no-store' })
          res.end()
          return
        }

        const range = parseRange(req.headers.range, stat.size)
        if (range !== null && 'unsatisfiable' in range) {
          res.writeHead(416, {
            'Content-Range': `bytes */${stat.size}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': 0,
            'X-Content-Type-Options': 'nosniff',
          })
          res.end()
          return
        }

        const start = range === null ? 0 : range.start
        const end = range === null ? stat.size - 1 : range.end
        const length = stat.size === 0 ? 0 : end - start + 1
        /** @type {Record<string, string|number>} */
        const headers = {
          'Content-Type': type,
          'Content-Length': length,
          'Accept-Ranges': 'bytes',
          'ETag': etag,
          'Last-Modified': lastModified,
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
          'Content-Disposition': contentDisposition(path.basename(abs), isInlineType(type)),
        }
        if (range !== null) headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`
        // HTML / SVG 内联出去会继承 Host 源：沙箱掉脚本，别让它反手调本机 API。
        if (needsSandbox(type)) headers['Content-Security-Policy'] = 'sandbox'
        res.writeHead(range === null ? 200 : 206, headers)
        if (method === 'HEAD' || stat.size === 0) {
          res.end()
          return
        }
        const stream = fs.createReadStream(abs, range === null ? undefined : { start, end })
        stream.on('error', () => {
          res.destroy()
        })
        // 客户端提前断开（PDF 翻页、切标签页）时别把读盘流留在后台。
        res.on('close', () => stream.destroy())
        stream.pipe(res)
        return
      }

      if (route === 'diff' && method === 'GET') {
        const session = url.searchParams.get('session') ?? ''
        const requested = url.searchParams.get('path') ?? ''
        if (!SAFE_ID.test(session)) {
          sendError(res, 400, 'bad-session', '缺少或非法的 session 参数')
          return
        }
        if (typeof store.diff !== 'function') {
          sendError(res, 404, 'no-diff', '当前 Host 没有提供改动对比能力')
          return
        }

        // 客户端断开或等太久都要能停下内核的读盘：AbortSignal 一路传到
        // workspaceChanges.diff()，它自己会取消读取。
        const controller = new AbortController()
        let timedOut = false
        const timer = setTimeout(() => {
          timedOut = true
          controller.abort()
        }, diffTimeoutMs)
        if (typeof timer.unref === 'function') timer.unref()
        const cancelOnClose = () => {
          if (!res.writableEnded) controller.abort()
        }
        res.on('close', cancelOnClose)

        let value
        try {
          value = trimDiff(await store.diff(session, requested, controller.signal))
        } catch (error) {
          if (controller.signal.aborted) {
            // 客户端自己断开的：响应已经没人收，别再往上写
            if (timedOut && !res.destroyed && !res.writableEnded) {
              sendError(res, 504, 'diff-timeout', '读取改动对比超时')
            }
            return
          }
          throw error
        } finally {
          clearTimeout(timer)
          res.off('close', cancelOnClose)
        }

        // 内核读完了但客户端恰好在这时断开：写回去只会撞上已销毁的流
        if (res.destroyed || res.writableEnded) return
        if (value === undefined) {
          sendError(res, 404, 'no-diff', '没有可读的改动对比')
          return
        }
        sendJson(res, 200, { ok: true, value })
        return
      }

      if (route === 'zip' && method === 'POST') {
        const body = await readJsonBody(req, maxBodyBytes)
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

        /** @type {string[]} 超过单文件上限、被跳过的文件（0.1.3 起不再静默吞掉） */
        const skipped = []
        /** @type {any[]} 预检通过、准备流式读入的文件 */
        const packable = []
        let planned = 0
        for (const file of selected) {
          if (file.size > config.maxFileBytes) {
            skipped.push(file.name)
            continue
          }
          planned += file.size
          if (planned > config.maxZipBytes) {
            sendError(res, 413, 'zip-too-large', '选中的文件总量超过打包上限')
            return
          }
          packable.push(file)
        }
        if (packable.length === 0) {
          if (skipped.length > 0) {
            sendError(res, 413, 'all-too-large', '选中的 ' + skipped.length + ' 个文件都超过单文件上限')
            return
          }
          sendError(res, 400, 'empty', '没有可打包的文件')
          return
        }

        // 条目名先算好：外部文件统一进 _external/，重名加 (2)。这样 manifest
        // 里记的路径就是包里的真实路径，不会再出现 var/folders/… 这种镜像。
        // 预留清单名：工作区里真有同名文件时给它加 (2)，不能和元数据撞条目。
        const usedNames = new Set(['_whale-catch/manifest.json', '_whale-catch/交付清单.md'])
        /** @type {Map<string, string>} */
        const names = new Map()
        for (const file of packable) {
          const entryName = zipEntryName(file, usedNames)
          if (Buffer.byteLength(entryName, 'utf8') > 0xffff) {
            sendError(res, 400, 'name-too-long', '文件路径太长，无法放进 zip')
            return
          }
          names.set(file.path, entryName)
        }

        const manifest = {
          generatedBy: 'dsh-whale-catch',
          session: snapshot.session,
          // 分享 zip 时不要把本机用户名带出去；文件路径本身仍是相对的。
          cwd: redactHome(snapshot.cwd),
          generatedAt: new Date().toISOString(),
          files: [],
          skipped,
        }

        // 按文件逐个读、逐个压、逐个写：内存里最多只有当前这一个文件，
        // 不再先把整包攒进内存再发给客户端。
        const entries = (async function* () {
          for (const file of packable) {
            let data
            try {
              data = await fsp.readFile(file.path)
            } catch {
              // 打包途中被删：跳过，不让整包失败
              continue
            }
            if (data.length > config.maxFileBytes) continue
            manifest.files.push({
              path: names.get(file.path),
              name: file.name,
              size: data.length,
              mtime: new Date(file.mtimeMs).toISOString(),
              sources: file.sources,
              turn: file.turn,
              description: file.description,
              added: file.added,
              deleted: file.deleted,
              sha256: createHash('sha256').update(data).digest('hex'),
            })
            yield { name: names.get(file.path), data, mtimeMs: file.mtimeMs }
          }
          yield {
            name: '_whale-catch/manifest.json',
            data: Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'),
            mtimeMs: Date.now(),
          }
          yield {
            name: '_whale-catch/交付清单.md',
            data: Buffer.from(buildChecklist(manifest), 'utf8'),
            mtimeMs: Date.now(),
          }
        })()

        const name = stampName(path.basename(snapshot.cwd) || 'whale-catch')
        res.writeHead(200, {
          'Content-Type': 'application/zip',
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
          'Content-Disposition': contentDisposition(name),
          // 自定义头给客户端提示用；同源 fetch 能直接读，跨源时浏览器本来也拿不到响应体。
          'X-Whale-Catch-Skipped': String(skipped.length),
        })
        try {
          await writeZip(entries, (chunk) => writeChunk(res, chunk))
          res.end()
        } catch {
          // 响应头已经发出，没法再回 JSON；断开连接，让客户端知道包不完整。
          res.destroy()
        }
        return
      }

      if (route === 'archive' && method === 'POST') {
        const body = await readJsonBody(req, maxBodyBytes)
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

        // 归档目录 == 工作目录时，归档出来的副本下一轮会被扫描再收进筐，
        // 形成「归档自己」的递归；直接拒绝这种配置。
        if (path.resolve(snapshot.archiveDir) === path.resolve(snapshot.cwd)) {
          sendError(res, 400, 'archive-dir-cwd', '归档目录不能与会话工作目录相同')
          return
        }

        // 默认（archiveKeep = 0）保持旧布局：直接镜像到 <archiveDir>/<session>/。
        // 开启保留策略后，每次归档写进独立批次目录，并只留最近 N 批。
        const normalizeCase = (value) => (process.platform === 'win32' ? value.toLowerCase() : value)
        const sessionRoot = path.join(snapshot.archiveDir, session)
        let runsDir = null
        let root = sessionRoot
        if (archiveKeep > 0) {
          runsDir = path.join(sessionRoot, 'runs')
          await fsp.mkdir(sessionRoot, { recursive: true })
          const sessionReal = await fsp.realpath(sessionRoot)
          await fsp.mkdir(runsDir, { recursive: true })
          // 如果 runs 是别人放的符号链接，清理会跑到归档根之外去；先确认
          // 它的 realpath 确实还是 <session>/runs。
          const runsReal = await fsp.realpath(runsDir)
          if (normalizeCase(runsReal) !== normalizeCase(path.join(sessionReal, 'runs'))) {
            sendError(res, 400, 'unsafe-path', '归档批次目录指向了归档根之外')
            return
          }
          root = await uniqueDir(path.join(runsDir, archiveStamp()))
        }
        await fsp.mkdir(root, { recursive: true })
        const realRoot = await fsp.realpath(root)
        const withinRoot = (candidate) => {
          const real = normalizeCase(candidate)
          const base = normalizeCase(realRoot)
          return real === base || real.startsWith(base + path.sep)
        }
        const copied = []
        const failed = []
        for (const file of selected) {
          // 归档是拷贝，不像 zip 那样占内存，但同样不该把 2 GB 的临时文件
          // 悄悄搬进归档目录；与 zip 使用同一个单文件上限。
          if (file.size > config.maxFileBytes) {
            failed.push({ path: file.rel, reason: 'too-large' })
            continue
          }
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
            // 归档根目录下如果被人放了指向外部的符号链接，mkdir/copyFile 会跟着
            // 跑出去；用 realpath 再确认一次父目录仍在根内。
            if (!withinRoot(await fsp.realpath(path.dirname(dest)))) {
              failed.push({ path: file.rel, reason: 'unsafe-path' })
              continue
            }
            const exists = await fsp.lstat(dest).then(() => true, () => false)
            if (exists && (await fsp.lstat(dest)).isSymbolicLink()) {
              failed.push({ path: file.rel, reason: 'unsafe-path' })
              continue
            }
            const target = exists ? await uniquePath(dest) : dest
            await fsp.copyFile(file.path, target)
            copied.push(toPosix(path.relative(snapshot.archiveDir, target)))
          } catch (error) {
            failed.push({ path: file.rel, reason: String(error?.message ?? error) })
          }
        }
        const pruned = runsDir === null ? [] : await pruneArchiveRuns(runsDir, archiveKeep, path.basename(root))
        sendJson(res, 200, {
          ok: true,
          value: { dir: root, copied, failed, ...(archiveKeep > 0 ? { pruned } : {}) },
        })
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
