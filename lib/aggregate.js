/**
 * 跨会话交付汇总：只读本机台账索引，不扫归档目录、不读文件正文。
 *
 * 台账是派生视图（manifest 才是真相），所以这里给出的数字也允许用
 * `POST /ledger/rebuild` 重建后再看；索引丢了不影响归档本身。
 */
import fsp from 'node:fs/promises'
import path from 'node:path'
import { readEvents } from './ledger.js'
import { isSafeId } from './ids.js'

/** 一次最多汇总多少个会话：台账再长也别把面板拖死。 */
export const MAX_SESSIONS = 200

/** 每个会话最多回看多少条事件。 */
const MAX_EVENTS = 500

/**
 * @param {{ledgerDir?: string, limit?: number}} [input]
 * @returns {Promise<{totals: {sessions: number, runs: number, files: number, bytes: number}, sessions: any[]}>}
 */
export async function aggregateLedger(input = {}) {
  const empty = { totals: { sessions: 0, runs: 0, files: 0, bytes: 0 }, sessions: [] }
  const dir = typeof input.ledgerDir === 'string' ? input.ledgerDir : ''
  if (dir === '') return empty

  let names
  try {
    names = await fsp.readdir(dir)
  } catch {
    return empty
  }

  const limit = Number.isFinite(input.limit) ? Math.max(1, Math.min(MAX_SESSIONS, Math.trunc(input.limit))) : 50
  const sessions = []

  for (const name of names) {
    if (!name.endsWith('.jsonl')) continue
    const session = name.slice(0, -'.jsonl'.length)
    if (!isSafeId(session)) continue

    let events
    try {
      events = await readEvents(dir, session, { maxLines: MAX_EVENTS })
    } catch {
      continue
    }
    const archives = events.filter((event) => event !== null && typeof event === 'object' && event.t === 'archive')
    if (archives.length === 0) continue

    let files = 0
    let bytes = 0
    let failed = 0
    let firstAt = Infinity
    let lastAt = 0
    for (const event of archives) {
      files += Number(event.count) || 0
      bytes += Number(event.bytes) || 0
      failed += Number(event.failed) || 0
      const at = Number(event.at) || 0
      if (at > 0) {
        if (at < firstAt) firstAt = at
        if (at > lastAt) lastAt = at
      }
    }

    sessions.push({
      session,
      runs: archives.length,
      files,
      bytes,
      failed,
      firstAt: firstAt === Infinity ? null : firstAt,
      lastAt: lastAt === 0 ? null : lastAt,
    })
  }

  sessions.sort((a, b) => (b.lastAt ?? 0) - (a.lastAt ?? 0))
  const totals = {
    sessions: sessions.length,
    runs: sessions.reduce((sum, row) => sum + row.runs, 0),
    files: sessions.reduce((sum, row) => sum + row.files, 0),
    bytes: sessions.reduce((sum, row) => sum + row.bytes, 0),
  }
  return { totals, sessions: sessions.slice(0, limit) }
}
