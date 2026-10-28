/**
 * 一个会话的鱼篓：把三个来源合并成同一份清单。
 *
 *   1. presented —— 模型调用 `present` 声明交付的文件（内核 deliverables/presented 事件）
 *   2. changed   —— 内核识别到这轮改动过的文件（workspace/changes 事件 + workspaceChanges.summary）
 *   3. scanned   —— 目录扫描兜底，捞 bash / python 之类外部进程写出来的文件
 *
 * 合并键是绝对路径；来源取并集，描述与轮次优先保留 presented 的，
 * 体积与时间用最新一次观测到的值。
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { extensionOf, kindOf, toPosix } from './kinds.js'

/** @typedef {'presented'|'changed'|'scanned'} Source */

/**
 * 一条来自 `workspace/changes` 的改动记录。
 *
 * `seq` + `index` 是向内核要 diff 的唯一凭据：seq 是事件序号，index 是文件在
 * `summary.files` 里的下标。行数与 binary / oversized 标记直接来自内核，
 * 自己不去猜——重新算一遍就得留 before/after 快照，那是另一个插件了。
 *
 * @typedef {object} ChangeInfo
 * @property {number} [seq]
 * @property {number} index
 * @property {number} [turn]
 * @property {number} added
 * @property {number} deleted
 * @property {boolean} binary
 * @property {boolean} oversized
 */

/**
 * 计算相对展示路径：在 cwd 内用相对路径，在 cwd 外用绝对路径。
 * @param {string} cwd
 * @param {string} abs
 * @returns {string}
 */
export function displayPath(cwd, abs) {
  const rel = path.relative(path.resolve(cwd), path.resolve(abs))
  if (rel === '') return toPosix(path.basename(abs))
  if (rel.startsWith('..') || path.isAbsolute(rel)) return toPosix(abs)
  return toPosix(rel)
}

export class Basket {
  /**
   * @param {object} init
   * @param {string} init.sessionId
   * @param {string} init.cwd
   * @param {number} init.sinceMs
   */
  constructor({ sessionId, cwd, sinceMs }) {
    /** @type {string} */
    this.sessionId = sessionId
    /** @type {string} */
    this.cwd = path.resolve(cwd)
    /** @type {number} */
    this.sinceMs = sinceMs
    /** @type {Map<string, {path: string, sources: Set<Source>, description?: string, turn?: number, size?: number, mtimeMs?: number, change?: ChangeInfo}>} */
    this.entries = new Map()
    /** 上一次扫描的结果摘要，用于界面回答"什么时候扫的" */
    this.lastScan = { at: 0, truncated: false, visited: 0, count: 0 }
  }

  get size() {
    return this.entries.size
  }

  /**
   * 登记 present 声明的文件。
   * @param {{path: string, description?: string}[]} files
   * @param {number} [turn]
   */
  addPresented(files, turn) {
    for (const file of files ?? []) {
      if (!file || typeof file.path !== 'string' || file.path.trim() === '') continue
      const abs = path.resolve(this.cwd, file.path)
      const entry = this.#touch(abs)
      entry.sources.add('presented')
      if (typeof file.description === 'string' && file.description.trim() !== '') {
        entry.description = file.description.trim()
      }
      if (Number.isFinite(turn)) entry.turn = turn
    }
  }

  /**
   * 登记内核识别到的改动文件。`file.path` 相对 cwd，也可能是 cwd 外的绝对路径。
   *
   * `files` 就是内核给的 `WorkspaceChangedFile[]`：行数、display、binary / oversized
   * 标记都在里面。0.1.x 只取了 `path`，于是面板知道"改过"却说不出"改了多少"。
   * `seq` 是 workspace/changes 事件的序号，和数组下标一起才够向内核要 diff。
   *
   * @param {{path: string, display?: string, added?: number, deleted?: number, binary?: boolean, oversized?: boolean}[]} files
   * @param {number} [turn]
   * @param {number} [seq]
   */
  addChanged(files, turn, seq) {
    const list = Array.isArray(files) ? files : []
    list.forEach((file, index) => {
      if (!file || typeof file.path !== 'string' || file.path.trim() === '') return
      const abs = path.isAbsolute(file.path)
        ? path.normalize(file.path)
        : path.resolve(this.cwd, file.path)
      const entry = this.#touch(abs)
      entry.sources.add('changed')
      if (Number.isFinite(turn)) entry.turn = turn
      entry.change = {
        seq: Number.isFinite(seq) ? seq : undefined,
        index,
        turn: Number.isFinite(turn) ? turn : undefined,
        added: Number.isFinite(file.added) ? Math.max(0, Math.trunc(file.added)) : 0,
        deleted: Number.isFinite(file.deleted) ? Math.max(0, Math.trunc(file.deleted)) : 0,
        binary: file.binary === true,
        oversized: file.oversized === true,
      }
    })
  }

  /**
   * 合入一次目录扫描的结果。
   * @param {{files: {path: string, rel: string, name: string, size: number, mtimeMs: number}[], truncated: boolean, visited: number, scannedAt: number}} scan
   */
  addScan(scan) {
    for (const file of scan.files ?? []) {
      const abs = path.resolve(file.path)
      const entry = this.#touch(abs)
      entry.sources.add('scanned')
      entry.size = file.size
      entry.mtimeMs = file.mtimeMs
    }
    this.lastScan = {
      at: scan.scannedAt,
      truncated: Boolean(scan.truncated),
      visited: scan.visited ?? 0,
      count: scan.files?.length ?? 0,
    }
  }

  /**
   * 取一个已登记的路径；没登记过的一律返回 undefined。
   *
   * 这是所有读文件接口唯一的准入判据：客户端只能对鱼篓里已有的文件做
   * 预览 / 打包 / 归档，传别的路径（包括 ../ 穿越）在这里就被挡掉。
   * @param {string} absOrRel
   * @returns {string|undefined} 规范化后的绝对路径
   */
  resolve(absOrRel) {
    if (typeof absOrRel !== 'string' || absOrRel.trim() === '') return undefined
    const abs = path.isAbsolute(absOrRel)
      ? path.normalize(absOrRel)
      : path.resolve(this.cwd, absOrRel)
    return this.entries.has(abs) ? abs : undefined
  }

  /**
   * 取一条可以要 diff 的改动登记：路径必须已进筐，且带 seq + index。
   *
   * 只有 `workspace/changes` 那条来源才有这两个值（present 与扫描都没有
   * before/after 快照），所以这里天然把"没有差异可看"的文件挡在外面。
   *
   * @param {string} absOrRel
   * @returns {{path: string, seq: number, index: number}|undefined}
   */
  resolveChange(absOrRel) {
    const abs = this.resolve(absOrRel)
    if (abs === undefined) return undefined
    const change = this.entries.get(abs)?.change
    if (change === undefined) return undefined
    if (!Number.isFinite(change.seq) || !Number.isFinite(change.index)) return undefined
    return { path: abs, seq: change.seq, index: change.index }
  }

  /**
   * 取或建一条登记项；键是规范化绝对路径。
   * @param {string} abs
   * @returns {{path: string, sources: Set<Source>, description?: string, turn?: number, size?: number, mtimeMs?: number}}
   */
  #touch(abs) {
    let entry = this.entries.get(abs)
    if (entry === undefined) {
      entry = { path: abs, sources: new Set() }
      this.entries.set(abs, entry)
    }
    return entry
  }

  /**
   * 生成给前端与路由使用的快照（会 stat 一遍，标记已删除的文件）。
   * @returns {Promise<{files: object[], totals: {count: number, bytes: number, missing: number, changed: number, added: number, deleted: number}, scannedAt: number, truncated: boolean}>}
   */
  async snapshot() {
    const files = []
    let bytes = 0
    let missing = 0
    let changed = 0
    let added = 0
    let deleted = 0

    // 先并发（限流）stat 一遍：轮询面板时 800 个文件串行 stat 会让一次快照
    // 拖到几十毫秒；16 路上限既快又不会把磁盘打满。
    const entries = [...this.entries]
    const stats = new Array(entries.length).fill(null)
    let cursor = 0
    const worker = async () => {
      while (cursor < entries.length) {
        const index = cursor
        cursor += 1
        try {
          const stat = await fs.stat(entries[index][0])
          stats[index] = stat.isFile() ? stat : null
        } catch {
          stats[index] = null
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(16, entries.length) }, worker))

    for (let index = 0; index < entries.length; index += 1) {
      const [abs, entry] = entries[index]
      const stat = stats[index]
      const size = stat === null ? (entry.size ?? 0) : stat.size
      const mtimeMs = stat === null ? (entry.mtimeMs ?? 0) : stat.mtimeMs
      const exists = stat !== null

      const name = path.basename(abs)
      const rel = displayPath(this.cwd, abs)
      if (exists) {
        bytes += size ?? 0
      } else {
        missing += 1
      }

      const change = entry.change
      if (change !== undefined) {
        changed += 1
        added += change.added
        deleted += change.deleted
      }

      files.push({
        path: abs,
        rel,
        name,
        ext: extensionOf(name),
        kind: kindOf(name),
        size: size ?? 0,
        mtimeMs: mtimeMs ?? 0,
        sources: [...entry.sources],
        description: entry.description ?? null,
        turn: entry.turn ?? null,
        missing: !exists,
        // null 表示"没有改动数据"，与"改了 0 行"是两件事：界面靠它决定徽章显不显示
        added: change === undefined ? null : change.added,
        deleted: change === undefined ? null : change.deleted,
        binary: change !== undefined && change.binary,
        oversized: change !== undefined && change.oversized,
        diffable: change !== undefined && Number.isFinite(change.seq) && Number.isFinite(change.index),
      })
    }

    files.sort((a, b) => {
      if (a.missing !== b.missing) return a.missing ? 1 : -1
      return b.mtimeMs - a.mtimeMs
    })

    return {
      files,
      totals: { count: files.length, bytes, missing, changed, added, deleted },
      scannedAt: this.lastScan.at,
      truncated: this.lastScan.truncated,
    }
  }
}
