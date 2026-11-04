/**
 * 行级文本 diff（Myers O(ND)），零依赖。
 *
 * 为什么自己写：`workspace-changes` 只保留「本轮」的对比，而「当前文件 vs 上次
 * 归档的那一版」是另一条时间线，内核没有现成能力。这里只做最小闭环：把两段
 * 文本变成 unified diff 的 hunk，形状与内核 `workspaceChanges.diff()` 对齐，
 * 客户端那套 hunk 渲染器可以直接复用。
 *
 * 边界（宁可说"看不了"，也不把面板撑爆）：
 *   · 单侧超过 1 MiB 或 2000 行 → `oversized`，交给界面说明；
 *   · 二进制（NUL 或非法 UTF-8）→ `binary`；
 *   · 编辑距离超过 1000 → 退化成整文件替换（`coarse`），但仍返回可读内容。
 */

/** 单侧最多比较多少行。 */
export const DIFF_MAX_LINES = 2000

/** 单侧最多比较多少字节。 */
export const DIFF_MAX_BYTES = 1024 * 1024

/** Myers 的 D 上限：再大就退化成整文件替换。 */
export const DIFF_MAX_D = 1000

/** hunk 上下文的行数，与 git 默认一致。 */
const CONTEXT = 3

/**
 * 把文本切成行；统一 CRLF / CR，丢掉末尾换行产生的空行。
 * @param {string} text
 * @returns {string[]}
 */
export function splitLines(text) {
  const normalized = String(text).replace(/\r\n?/g, '\n')
  if (normalized === '') return []
  const lines = normalized.split('\n')
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  return lines
}

/**
 * 把输入归一成文本；二进制返回 null。
 * @param {Buffer|string|Uint8Array} value
 * @returns {string|null}
 */
function asText(value) {
  if (typeof value === 'string') return value
  if (value === null || value === undefined) return ''
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value)
  if (buffer.length === 0) return ''
  if (buffer.includes(0)) return null
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer)
  } catch {
    return null
  }
}

/**
 * 用 Myers 算法求编辑脚本。返回 null 表示超过 D 上限。
 *
 * @param {string[]} a
 * @param {string[]} b
 * @param {number} maxD
 * @returns {{t: '='|'-'|'+', a?: number, b?: number}[]|null}
 */
function myers(a, b, maxD) {
  const n = a.length
  const m = b.length
  const max = n + m
  const offset = max
  const v = new Int32Array(2 * max + 1)
  v.fill(-1)
  v[offset + 1] = 0
  /** @type {Int32Array[]} */
  const trace = []
  const limit = Math.min(max, maxD)
  let found = -1

  for (let d = 0; d <= limit; d += 1) {
    trace.push(v.slice())
    for (let k = -d; k <= d; k += 2) {
      let x
      if (k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])) {
        x = v[offset + k + 1]
      } else {
        x = v[offset + k - 1] + 1
      }
      let y = x - k
      while (x < n && y < m && a[x] === b[y]) {
        x += 1
        y += 1
      }
      v[offset + k] = x
      if (x >= n && y >= m) {
        found = d
        break
      }
    }
    if (found !== -1) break
  }
  if (found === -1) return null

  /** @type {{t: '='|'-'|'+', a?: number, b?: number}[]} */
  const ops = []
  let x = n
  let y = m
  for (let d = found; d > 0; d -= 1) {
    const previous = trace[d]
    const k = x - y
    const prevK =
      k === -d || (k !== d && previous[offset + k - 1] < previous[offset + k + 1]) ? k + 1 : k - 1
    const prevX = previous[offset + prevK]
    const prevY = prevX - prevK
    while (x > prevX && y > prevY) {
      ops.push({ t: '=', a: x - 1, b: y - 1 })
      x -= 1
      y -= 1
    }
    if (x === prevX) {
      ops.push({ t: '+', b: y - 1 })
      y -= 1
    } else {
      ops.push({ t: '-', a: x - 1 })
      x -= 1
    }
  }
  while (x > 0 && y > 0) {
    ops.push({ t: '=', a: x - 1, b: y - 1 })
    x -= 1
    y -= 1
  }
  while (x > 0) {
    ops.push({ t: '-', a: x - 1 })
    x -= 1
  }
  while (y > 0) {
    ops.push({ t: '+', b: y - 1 })
    y -= 1
  }
  return ops.reverse()
}

/**
 * 把编辑脚本切成 hunk；没有变化返回空数组。
 * @param {{t: '='|'-'|'+', a?: number, b?: number}[]} ops
 * @param {string[]} a
 * @param {string[]} b
 * @returns {any[]}
 */
function buildHunks(ops, a, b) {
  /** @type {number[]} */
  const changes = []
  for (let i = 0; i < ops.length; i += 1) {
    if (ops[i].t !== '=') changes.push(i)
  }
  if (changes.length === 0) return []

  /** @type {[number, number][]} */
  const groups = []
  let start = changes[0]
  let end = changes[0] + 1
  for (let i = 1; i < changes.length; i += 1) {
    const at = changes[i]
    // 两处改动之间只隔 2 * CONTEXT 行时合成一个 hunk，免得上下文互相重叠
    if (at <= end + CONTEXT * 2) {
      end = at + 1
    } else {
      groups.push([start, end])
      start = at
      end = at + 1
    }
  }
  groups.push([start, end])

  let oldLine = 1
  let newLine = 1
  let cursor = 0
  const hunks = []
  for (const [first, last] of groups) {
    const from = Math.max(0, first - CONTEXT)
    const to = Math.min(ops.length, last + CONTEXT)
    while (cursor < from) {
      const op = ops[cursor]
      if (op.t !== '+') oldLine += 1
      if (op.t !== '-') newLine += 1
      cursor += 1
    }
    const oldStart = oldLine
    const newStart = newLine
    const lines = []
    let oldCount = 0
    let newCount = 0
    for (let i = from; i < to; i += 1) {
      const op = ops[i]
      if (op.t === '=') {
        lines.push(' ' + a[op.a])
        oldCount += 1
        newCount += 1
        oldLine += 1
        newLine += 1
      } else if (op.t === '-') {
        lines.push('-' + a[op.a])
        oldCount += 1
        oldLine += 1
      } else {
        lines.push('+' + b[op.b])
        newCount += 1
        newLine += 1
      }
    }
    cursor = to
    hunks.push({
      // 纯插入在文件开头时，git 写成 -0,0；这里保持一致
      oldStart: oldCount === 0 && oldStart === 1 ? 0 : oldStart,
      oldLines: oldCount,
      newStart: newCount === 0 && newStart === 1 ? 0 : newStart,
      newLines: newCount,
      lines,
    })
  }
  return hunks
}

/**
 * 两段文本的 unified diff。
 *
 * 返回形状：
 *   · `{ kind: 'text', hunks, trimmed?, coarse? }` —— 可直接交给现有渲染器；
 *   · `{ kind: 'binary' }`；
 *   · `{ kind: 'oversized', bytes, lines }`。
 *
 * @param {Buffer|string|Uint8Array} before
 * @param {Buffer|string|Uint8Array} after
 * @returns {any}
 */
export function diffText(before, after) {
  const left = asText(before)
  const right = asText(after)
  if (left === null || right === null) return { kind: 'binary' }

  const leftBytes = Buffer.byteLength(left, 'utf8')
  const rightBytes = Buffer.byteLength(right, 'utf8')
  const a = splitLines(left)
  const b = splitLines(right)
  if (leftBytes > DIFF_MAX_BYTES || rightBytes > DIFF_MAX_BYTES || a.length > DIFF_MAX_LINES || b.length > DIFF_MAX_LINES) {
    return { kind: 'oversized', bytes: Math.max(leftBytes, rightBytes), lines: Math.max(a.length, b.length) }
  }
  if (a.length === 0 && b.length === 0) return { kind: 'text', hunks: [], trimmed: false }

  const ops = myers(a, b, DIFF_MAX_D)
  if (ops === null) {
    // 差异太大：按整文件替换给一组 hunk，至少还能读
    const lines = []
    for (const line of a) lines.push('-' + line)
    for (const line of b) lines.push('+' + line)
    return {
      kind: 'text',
      hunks: [{ oldStart: 1, oldLines: a.length, newStart: 1, newLines: b.length, lines }],
      trimmed: false,
      coarse: true,
    }
  }

  return { kind: 'text', hunks: buildHunks(ops, a, b), trimmed: false }
}
