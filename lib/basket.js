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
    /** @type {Map<string, {path: string, sources: Set<Source>, description?: string, turn?: number, size?: number, mtimeMs?: number, seenInScan?: boolean}>} */
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
   * @param {{path: string}[]} files
   * @param {number} [turn]
   */
  addChanged(files, turn) {
    for (const file of files ?? []) {
      if (!file || typeof file.path !== 'string' || file.path.trim() === '') continue
      const abs = path.isAbsolute(file.path)
        ? path.normalize(file.path)
        : path.resolve(this.cwd, file.path)
      const entry = this.#touch(abs)
      entry.sources.add('changed')
      if (Number.isFinite(turn) && entry.turn === undefined) entry.turn = turn
    }
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
      entry.seenInScan = true
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
   * 取或建一条登记项；键是规范化绝对路径。
   * @param {string} abs
   * @returns {{path: string, sources: Set<Source>, description?: string, turn?: number, size?: number, mtimeMs?: number, seenInScan?: boolean}}
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
   * @returns {Promise<{files: object[], totals: {count: number, bytes: number, missing: number}, scannedAt: number, truncated: boolean}>}
   */
  async snapshot() {
    const files = []
    let bytes = 0
    let missing = 0

    for (const [abs, entry] of this.entries) {
      let size = entry.size
      let mtimeMs = entry.mtimeMs
      let exists = true
      try {
        const stat = await fs.stat(abs)
        if (!stat.isFile()) throw new Error('not a file')
        size = stat.size
        mtimeMs = stat.mtimeMs
      } catch {
        exists = false
      }

      const name = path.basename(abs)
      const rel = displayPath(this.cwd, abs)
      if (exists) {
        bytes += size ?? 0
      } else {
        missing += 1
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
      })
    }

    files.sort((a, b) => {
      if (a.missing !== b.missing) return a.missing ? 1 : -1
      return b.mtimeMs - a.mtimeMs
    })

    return {
      files,
      totals: { count: files.length, bytes, missing },
      scannedAt: this.lastScan.at,
      truncated: this.lastScan.truncated,
    }
  }
}
