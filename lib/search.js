/**
 * 鱼篓内容搜索：只在「已进筐」的文件里做字面匹配。
 *
 * 设计约束：
 *   · 不建索引、不落盘——搜完就忘，隐私面最小；
 *   · 每文件只读头部 `maxBytes`，4 路并发，总预算 `timeoutMs`；
 *   · 不支持正则（用户输入不编译成正则，避免 ReDoS）；
 *   · 只回传命中的行号与上下文，不回传整份文件。
 */
import fsp from 'node:fs/promises'
import { looksLikeText } from './http.js'

/** 二进制/图片/音视频类别不做内容搜索。 */
const SKIP_KINDS = new Set(['image', 'archive', 'media', 'slide'])

/** 单文件最多返回几个命中行。 */
const HITS_PER_FILE = 5

/** 上下文最多多少字符。 */
const SNIPPET_MAX = 120

/**
 * @param {string} text
 * @param {number} at
 * @param {number} length
 * @returns {string}
 */
function snippetAt(text, at, length) {
  const start = Math.max(0, at - 40)
  const end = Math.min(text.length, at + length + 40)
  const raw = text.slice(start, end).replace(/[\r\n\t]+/g, ' ').trim()
  return raw.length > SNIPPET_MAX ? `${raw.slice(0, SNIPPET_MAX)}…` : raw
}

/**
 * @param {string} file
 * @param {number} maxBytes
 * @returns {Promise<string|null>} 文本返回内容；二进制/读失败返回 null
 */
async function readHead(file, maxBytes) {
  let handle
  try {
    handle = await fsp.open(file, 'r')
    const buffer = Buffer.alloc(maxBytes)
    const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0)
    const head = buffer.subarray(0, bytesRead)
    if (!looksLikeText(head)) return null
    return head.toString('utf8')
  } catch {
    return null
  } finally {
    if (handle !== undefined) await handle.close().catch(() => {})
  }
}

/**
 * 在快照文件列表里搜内容。
 *
 * @param {object} input
 * @param {any[]} input.files 快照里的 files
 * @param {string} input.query
 * @param {number} [input.maxBytes]
 * @param {number} [input.timeoutMs]
 * @param {number} [input.concurrency]
 * @param {number} [input.limit]
 * @param {AbortSignal} [input.signal]
 * @returns {Promise<{files: any[], scanned: number, truncated: boolean, elapsedMs: number}>}
 */
export async function searchFiles({
  files,
  query,
  maxBytes = 64 * 1024,
  timeoutMs = 3000,
  concurrency = 4,
  limit = 20,
  signal,
}) {
  const started = Date.now()
  const needle = String(query ?? '').toLowerCase()
  if (needle === '') return { files: [], scanned: 0, truncated: false, elapsedMs: 0 }

  const candidates = (files ?? []).filter(
    (file) => file && !file.missing && !SKIP_KINDS.has(file.kind) && Number(file.size) > 0,
  )
  const deadline = started + Math.max(100, Number(timeoutMs) || 3000)
  const results = []
  let scanned = 0
  let truncated = false
  let cursor = 0

  const worker = async () => {
    while (cursor < candidates.length) {
      if (signal?.aborted) return
      if (Date.now() > deadline) {
        truncated = true
        return
      }
      if (results.length >= limit) {
        truncated = true
        return
      }
      const index = cursor
      cursor += 1
      const file = candidates[index]
      scanned += 1
      const text = await readHead(file.path, maxBytes)
      if (text === null) continue
      const haystack = text.toLowerCase()
      /** @type {{line: number, text: string}[]} */
      const hits = []
      let from = 0
      while (hits.length < HITS_PER_FILE) {
        const at = haystack.indexOf(needle, from)
        if (at === -1) break
        const line = text.slice(0, at).split('\n').length
        hits.push({ line, text: snippetAt(text, at, needle.length) })
        from = at + Math.max(1, needle.length)
      }
      if (hits.length > 0) {
        results.push({ path: file.path, rel: file.rel, name: file.name, kind: file.kind, hits })
        if (results.length >= limit) {
          truncated = true
          return
        }
      }
    }
  }

  const workers = Math.max(1, Math.min(8, Number(concurrency) || 4))
  await Promise.all(Array.from({ length: Math.min(workers, candidates.length) }, worker))
  return { files: results, scanned, truncated, elapsedMs: Date.now() - started }
}
