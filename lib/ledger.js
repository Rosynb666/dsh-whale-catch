/**
 * 交付台账：归档清单的索引层。
 *
 * 设计上的两个决定：
 *   1. **清单是真相，索引是缓存。** 每个归档批次都会在批次目录里写
 *      `_whale-catch/manifest.json`；`<ledger>/<session>.jsonl` 只是它的目录。
 *      索引丢了可以 `rebuild()` 从清单重建，反过来不行。
 *   2. **追加写，不修改历史。** 勾选、归档、还原都是追加一条事件；读取时
 *      按时间重放。这样崩溃最多丢最后一行，不会把已有记录写坏。
 *
 * 读取一律从文件尾部取（1 MiB / 200 行封顶），台账再长也不会把一次面板
 * 轮询拖成整文件扫描。
 */
import fsp from 'node:fs/promises'
import path from 'node:path'
import { isRunName, isSafeId } from './ids.js'

/** 单次读取的字节上限。 */
export const LEDGER_READ_BYTES = 1024 * 1024

/** 单次读取的事件条数上限。 */
export const LEDGER_READ_LINES = 200

/** @type {Map<string, Promise<unknown>>} 每个台账文件一条串行队列 */
const queues = new Map()

/**
 * @param {string} dir
 * @param {string} sessionId
 * @returns {string}
 */
export function ledgerFile(dir, sessionId) {
  return path.join(dir, `${sessionId}.jsonl`)
}

/**
 * 清单在归档根里的两个可能位置（runs 布局 / flat 布局）。
 * @param {string} archiveRoot
 * @param {string} sessionId
 * @param {string} run
 * @returns {{layout: 'runs'|'flat', file: string, baseDir: string}[]}
 */
export function manifestCandidates(archiveRoot, sessionId, run) {
  const sessionRoot = path.join(archiveRoot, sessionId)
  return [
    {
      layout: 'runs',
      file: path.join(sessionRoot, 'runs', run, '_whale-catch', 'manifest.json'),
      baseDir: path.join(sessionRoot, 'runs', run),
    },
    {
      layout: 'flat',
      file: path.join(sessionRoot, '_whale-catch', 'manifests', `${run}.json`),
      baseDir: sessionRoot,
    },
  ]
}

/**
 * 追加一条事件。同一个台账文件的写入串行化，避免并发归档把两行 JSON 搅在一起。
 *
 * @param {string} dir
 * @param {string} sessionId
 * @param {Record<string, unknown>} event
 * @returns {Promise<void>}
 */
export function appendEvent(dir, sessionId, event) {
  const file = ledgerFile(dir, sessionId)
  const previous = queues.get(file) ?? Promise.resolve()
  const job = previous
    .catch(() => {})
    .then(async () => {
      await fsp.mkdir(dir, { recursive: true })
      await fsp.appendFile(file, `${JSON.stringify(event)}\n`, 'utf8')
    })
  queues.set(file, job)
  job
    .catch(() => {})
    .finally(() => {
      if (queues.get(file) === job) queues.delete(file)
    })
  return job
}

/**
 * 从文件尾部读事件。坏行跳过，不因为一行损坏让整个台账打不开。
 *
 * @param {string} dir
 * @param {string} sessionId
 * @param {{maxBytes?: number, maxLines?: number}} [options]
 * @returns {Promise<any[]>} 从旧到新
 */
export async function readEvents(dir, sessionId, options = {}) {
  if (!isSafeId(sessionId)) return []
  const file = ledgerFile(dir, sessionId)
  const maxBytes = Math.max(1024, options.maxBytes ?? LEDGER_READ_BYTES)
  const maxLines = Math.max(1, options.maxLines ?? LEDGER_READ_LINES)

  let handle
  try {
    const stat = await fsp.stat(file)
    if (!stat.isFile() || stat.size === 0) return []
    const start = Math.max(0, stat.size - maxBytes)
    const length = stat.size - start
    const buffer = Buffer.alloc(Number(length))
    handle = await fsp.open(file, 'r')
    await handle.read(buffer, 0, buffer.length, start)
    let text = buffer.toString('utf8')
    if (start > 0) {
      // 第一行多半被切断了，丢掉
      const cut = text.indexOf('\n')
      text = cut === -1 ? '' : text.slice(cut + 1)
    }
    const lines = text.split('\n').filter((line) => line.trim() !== '')
    const events = []
    for (const line of lines.slice(-maxLines)) {
      try {
        const value = JSON.parse(line)
        if (value !== null && typeof value === 'object' && typeof value.t === 'string') events.push(value)
      } catch {
        // 半行写入 / 手工编辑：跳过这一条，后面的照常读
      }
    }
    return events
  } catch {
    return []
  } finally {
    if (handle !== undefined) await handle.close().catch(() => {})
  }
}

/**
 * 列出台账里出现过的会话 id，最近有事件的排在前面。
 * @param {string} dir
 * @returns {Promise<string[]>}
 */
export async function listLedgerSessions(dir) {
  let entries
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const rows = []
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue
    const sessionId = entry.name.slice(0, -'.jsonl'.length)
    if (!isSafeId(sessionId)) continue
    const stat = await fsp.stat(path.join(dir, entry.name)).catch(() => null)
    rows.push({ sessionId, mtimeMs: stat?.mtimeMs ?? 0 })
  }
  rows.sort((a, b) => b.mtimeMs - a.mtimeMs)
  return rows.map((row) => row.sessionId)
}

/**
 * 在一个归档根内确认路径没有跑到外面。
 * @param {string} root
 * @param {string} candidate
 * @returns {Promise<string|undefined>} realpath
 */
async function withinRoot(root, candidate) {
  let realRoot
  let realFile
  try {
    realRoot = await fsp.realpath(root)
    realFile = await fsp.realpath(candidate)
  } catch {
    return undefined
  }
  const normalizedRoot = process.platform === 'win32' ? realRoot.toLowerCase() : realRoot
  const normalizedFile = process.platform === 'win32' ? realFile.toLowerCase() : realFile
  if (normalizedFile === normalizedRoot) return realFile
  return normalizedFile.startsWith(normalizedRoot + path.sep) ? realFile : undefined
}

/**
 * 读一个批次的清单。
 *
 * @param {string} archiveRoot
 * @param {string} sessionId
 * @param {string} run
 * @returns {Promise<{manifest: any, baseDir: string, layout: 'runs'|'flat', file: string}|undefined>}
 */
export async function readManifest(archiveRoot, sessionId, run) {
  if (!isSafeId(sessionId) || !isRunName(run)) return undefined
  for (const candidate of manifestCandidates(archiveRoot, sessionId, run)) {
    const real = await withinRoot(archiveRoot, candidate.file)
    if (real === undefined) continue
    try {
      const raw = await fsp.readFile(real, 'utf8')
      const manifest = JSON.parse(raw)
      if (manifest === null || typeof manifest !== 'object' || !Array.isArray(manifest.files)) continue
      return { manifest, baseDir: candidate.baseDir, layout: candidate.layout, file: real }
    } catch {
      // 清单坏了就试下一个布局
    }
  }
  return undefined
}

/**
 * 列出某会话的所有批次摘要（不读文件内容，只读清单）。
 *
 * @param {string} archiveRoot
 * @param {string} sessionId
 * @returns {Promise<any[]>}
 */
export async function listManifests(archiveRoot, sessionId) {
  if (!isSafeId(sessionId)) return []
  const sessionRoot = path.join(archiveRoot, sessionId)
  /** @type {{run: string, layout: 'runs'|'flat'}[]} */
  const found = []

  const runsDir = path.join(sessionRoot, 'runs')
  const runs = await fsp.readdir(runsDir, { withFileTypes: true }).catch(() => [])
  for (const entry of runs) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || !isRunName(entry.name)) continue
    found.push({ run: entry.name, layout: 'runs' })
  }

  const flatDir = path.join(sessionRoot, '_whale-catch', 'manifests')
  const flats = await fsp.readdir(flatDir, { withFileTypes: true }).catch(() => [])
  for (const entry of flats) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue
    const run = entry.name.slice(0, -'.json'.length)
    if (!isRunName(run)) continue
    found.push({ run, layout: 'flat' })
  }

  const rows = []
  for (const item of found.slice(0, 200)) {
    const hit = await readManifest(archiveRoot, sessionId, item.run)
    if (hit === undefined) continue
    const manifest = hit.manifest
    const files = Array.isArray(manifest.files) ? manifest.files : []
    const bytes = files.reduce((sum, file) => sum + (Number(file?.size) || 0), 0)
    rows.push({
      run: item.run,
      layout: hit.layout,
      archivedAt: typeof manifest.archivedAt === 'string' ? manifest.archivedAt : null,
      at: Date.parse(manifest.archivedAt) || 0,
      count: files.length,
      bytes,
      failed: Array.isArray(manifest.failed) ? manifest.failed.length : 0,
      session: sessionId,
      cwd: typeof manifest.cwd === 'string' ? manifest.cwd : null,
      file: hit.file,
    })
  }
  rows.sort((a, b) => b.at - a.at || b.run.localeCompare(a.run))
  return rows
}

/**
 * 把批次摘要写成一条台账事件（rebuild 与归档共用同一种形状）。
 * @param {any} row
 * @returns {Record<string, unknown>}
 */
export function archiveEvent(row) {
  return {
    v: 1,
    t: 'archive',
    at: row.at || Date.parse(row.archivedAt) || Date.now(),
    run: row.run,
    layout: row.layout,
    manifest: path.basename(row.file ?? ''),
    count: row.count ?? 0,
    bytes: row.bytes ?? 0,
    failed: row.failed ?? 0,
  }
}

/**
 * 从归档清单重建索引：保留非归档事件（present / mark / restore），
 * 归档事件按清单重写。
 *
 * @param {string} dir
 * @param {string} archiveRoot
 * @returns {Promise<{sessions: number, runs: number}>}
 */
export async function rebuild(dir, archiveRoot) {
  let entries
  try {
    entries = await fsp.readdir(archiveRoot, { withFileTypes: true })
  } catch {
    return { sessions: 0, runs: 0 }
  }
  await fsp.mkdir(dir, { recursive: true })
  let sessions = 0
  let runs = 0
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || !isSafeId(entry.name)) continue
    const rows = await listManifests(archiveRoot, entry.name)
    if (rows.length === 0) continue
    sessions += 1
    runs += rows.length
    const existing = await readEvents(dir, entry.name, { maxLines: LEDGER_READ_LINES })
    const kept = existing.filter((event) => event.t !== 'archive')
    const merged = [...kept, ...rows.map(archiveEvent)]
    merged.sort((a, b) => (Number(a.at) || 0) - (Number(b.at) || 0))
    const body = merged.map((event) => JSON.stringify(event)).join('\n')
    const file = ledgerFile(dir, entry.name)
    const temp = `${file}.${process.pid}.tmp`
    await fsp.writeFile(temp, body === '' ? '' : `${body}\n`, 'utf8')
    await fsp.rename(temp, file)
  }
  return { sessions, runs }
}

/**
 * 台账空间统计：优先读索引；索引为空时退回扫描清单。
 * @param {string} dir
 * @param {string} archiveRoot
 * @returns {Promise<{sessions: number, runs: number, bytes: number, bySession: any[]}>}
 */
export async function stats(dir, archiveRoot) {
  const sessions = await listLedgerSessions(dir)
  const bySession = []
  let runs = 0
  let bytes = 0
  for (const sessionId of sessions) {
    const events = await readEvents(dir, sessionId, { maxLines: LEDGER_READ_LINES })
    const archives = events.filter((event) => event.t === 'archive')
    const sessionBytes = archives.reduce((sum, event) => sum + (Number(event.bytes) || 0), 0)
    if (archives.length === 0 && sessionBytes === 0) continue
    runs += archives.length
    bytes += sessionBytes
    bySession.push({ session: sessionId, runs: archives.length, bytes: sessionBytes })
  }
  bySession.sort((a, b) => b.bytes - a.bytes)
  return { sessions: bySession.length, runs, bytes, bySession: bySession.slice(0, 20) }
}
