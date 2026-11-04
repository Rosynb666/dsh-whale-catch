/**
 * 交付体检：在打包 / 归档之前把「会出事的地方」先摆出来。
 *
 * 三类检查：
 *   1. 结构性（缺文件、超大、空文件、总量超限、路径过长）——能挡就挡；
 *   2. 敏感性（文件名 / 文件头命中密钥模式）——只提醒，不阻断，且**只回传
 *      模式名与行号，不回传命中的内容**；
 *   3. 状态（归档后改过、cwd 外文件）——给信息，不制造焦虑。
 */
import fsp from 'node:fs/promises'
import path from 'node:path'
import { looksLikeText } from './http.js'
import { toPosix } from './kinds.js'

/** 默认的敏感文件名规则：命中只提醒，绝不自动排除。 */
export const SENSITIVE_NAME_RULES = [
  /^\.env(?:\..*)?$/i,
  /^id_(?:rsa|dsa|ecdsa|ed25519)$/i,
  /\.(?:pem|key|p12|pfx|kdbx)$/i,
  /^credentials(?:\..*)?$/i,
  /^\.npmrc$/i,
  /^\.netrc$/i,
  /^\.pgpass$/i,
]

/** 文件头里的密钥模式；只报 id 和行号。 */
export const SENSITIVE_CONTENT_PATTERNS = [
  { id: 'private-key', re: /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/ },
  { id: 'aws-access-key', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { id: 'github-token', re: /\bgh[pousr]_[A-Za-z0-9]{36}\b/ },
  { id: 'openai-key', re: /\bsk-[A-Za-z0-9]{20,}\b/ },
  { id: 'slack-token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { id: 'google-api-key', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
]

/** 内容扫描每个文件最多读多少字节。 */
export const DEFAULT_SCAN_BYTES = 64 * 1024

/**
 * 把只含 `*` 的简单通配符转成正则；其它字符一律转义。
 * @param {string} pattern
 * @returns {RegExp}
 */
function globToRegExp(pattern) {
  const escaped = String(pattern)
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
  return new RegExp(`^${escaped}$`, 'i')
}

/**
 * zip 里的条目名，和路由里的算法保持一致（只用于长度预检）。
 * @param {{rel: string}} file
 * @returns {string}
 */
function entryNameFor(file) {
  const rel = toPosix(file.rel)
  return path.isAbsolute(rel) ? `_external/${path.basename(rel)}` : rel
}

/**
 * 不读文件内容的同步检查。
 *
 * @param {any[]} files 快照里的文件
 * @param {object} [options]
 * @param {number} [options.maxFileBytes]
 * @param {number} [options.maxZipBytes]
 * @param {any} [options.latestManifest] readManifest 的返回值
 * @param {string[]} [options.sensitivePatterns] 额外文件名通配符
 * @returns {any[]}
 */
export function checkFiles(files, options = {}) {
  const maxFileBytes = Number(options.maxFileBytes) || 64 * 1024 * 1024
  const maxZipBytes = Number(options.maxZipBytes) || 512 * 1024 * 1024
  const extra = Array.isArray(options.sensitivePatterns)
    ? options.sensitivePatterns.filter((item) => typeof item === 'string' && item.trim() !== '')
    : []
  const extraRules = extra.map(globToRegExp)
  const archived = new Map()
  const manifest = options.latestManifest?.manifest
  if (manifest && Array.isArray(manifest.files)) {
    for (const file of manifest.files) {
      if (file && typeof file.rel === 'string') archived.set(file.rel, file)
    }
  }

  /** @type {any[]} */
  const issues = []
  let total = 0
  let external = 0
  const externalNames = new Map()

  for (const file of files ?? []) {
    if (file === null || typeof file !== 'object') continue
    const rel = typeof file.rel === 'string' ? file.rel : ''
    const name = typeof file.name === 'string' ? file.name : path.basename(rel)
    if (file.missing) {
      issues.push({ code: 'missing', level: 'block', rel, path: file.path, detail: '文件已被删除或移动' })
      continue
    }
    const size = Number(file.size) || 0
    total += size
    if (size > maxFileBytes) {
      issues.push({ code: 'too-large', level: 'block', rel, path: file.path, detail: `超过单文件上限（${size} B）` })
    }
    if (size === 0) {
      issues.push({ code: 'empty', level: 'warn', rel, path: file.path, detail: '0 字节，可能是生成失败' })
    }
    if (path.isAbsolute(rel)) {
      external += 1
      const basename = path.basename(rel)
      externalNames.set(basename, (externalNames.get(basename) ?? 0) + 1)
      issues.push({ code: 'external-file', level: 'info', rel, path: file.path, detail: '工作目录外的文件，zip 里会进 _external/' })
    }
    if (SENSITIVE_NAME_RULES.some((rule) => rule.test(name)) || extraRules.some((rule) => rule.test(name))) {
      issues.push({ code: 'sensitive-name', level: 'warn', rel, path: file.path, detail: '文件名看起来像密钥或凭证' })
    }
    if (Buffer.byteLength(entryNameFor({ rel }), 'utf8') > 0xffff) {
      issues.push({ code: 'path-too-long', level: 'block', rel, path: file.path, detail: '路径太长，放不进 zip' })
    }
    const before = archived.get(rel)
    if (before !== undefined) {
      const changedSize = Number(before.size) !== size
      const changedTime =
        Number.isFinite(before.mtimeMs) && Number.isFinite(file.mtimeMs) && Math.abs(Number(before.mtimeMs) - Number(file.mtimeMs)) > 1000
      if (changedSize || changedTime) {
        issues.push({ code: 'dirty-since-archive', level: 'info', rel, path: file.path, detail: '归档之后又改过' })
      }
    }
  }

  if (total > maxZipBytes) {
    issues.push({ code: 'zip-total-too-large', level: 'block', detail: `选中的文件共 ${total} B，超过打包上限` })
  }
  for (const [basename, count] of externalNames) {
    if (count > 1) {
      issues.push({ code: 'duplicate-name', level: 'warn', rel: basename, detail: '多个工作目录外文件同名，zip 里会加 (2)' })
    }
  }
  return issues
}

/**
 * 读文件头做敏感内容扫描。只返回模式名与行号。
 *
 * @param {any[]} files
 * @param {object} [options]
 * @param {number} [options.maxFileBytes]
 * @param {number} [options.maxScanBytes]
 * @param {number} [options.concurrency]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<any[]>}
 */
export async function scanSensitive(files, options = {}) {
  const maxFileBytes = Number(options.maxFileBytes) || 64 * 1024 * 1024
  const maxScanBytes = Math.max(1024, Number(options.maxScanBytes) || DEFAULT_SCAN_BYTES)
  const concurrency = Math.max(1, Math.min(8, Number(options.concurrency) || 4))
  const signal = options.signal
  const candidates = (files ?? []).filter(
    (file) => file && !file.missing && Number(file.size) > 0 && Number(file.size) <= maxFileBytes,
  )

  /** @type {any[]} */
  const issues = []
  let cursor = 0

  const worker = async () => {
    while (cursor < candidates.length) {
      if (signal?.aborted) return
      const index = cursor
      cursor += 1
      const file = candidates[index]
      let handle
      try {
        handle = await fsp.open(file.path, 'r')
        const length = Math.min(maxScanBytes, Number(file.size) || maxScanBytes)
        const buffer = Buffer.alloc(length)
        const { bytesRead } = await handle.read(buffer, 0, length, 0)
        const head = buffer.subarray(0, bytesRead)
        if (!looksLikeText(head)) continue
        const text = head.toString('utf8')
        for (const pattern of SENSITIVE_CONTENT_PATTERNS) {
          const match = pattern.re.exec(text)
          if (match === null) continue
          const line = text.slice(0, match.index).split('\n').length
          issues.push({
            code: 'sensitive-content',
            level: 'warn',
            rel: file.rel,
            path: file.path,
            pattern: pattern.id,
            line,
            detail: '文件头命中密钥模式（内容未回传）',
          })
        }
      } catch {
        // 读失败就不体检这一条，交给 missing / 打不开的路径
      } finally {
        if (handle !== undefined) await handle.close().catch(() => {})
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, candidates.length) }, worker))
  return issues
}
