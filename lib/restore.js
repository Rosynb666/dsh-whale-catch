/**
 * 归档还原：把批次里的文件写回会话工作目录。
 *
 * 这是插件里唯一一条「往用户目录写文件」的路径，所以边界写得比别处更死：
 *   · 只写 `rel`（原始相对路径）能安全解析到 cwd 内的位置；
 *   · 源文件必须在批次目录内（`stored` 不能是 `../` 或绝对路径）；
 *   · 目标是符号链接就拒绝；
 *   · 覆盖前先备份到 `<archive>/<session>/_whale-catch/backups/<stamp>/`；
 *   · 默认 `skip`，且永远先给一份 dry-run 计划。
 */
import fsp from 'node:fs/promises'
import path from 'node:path'
import { constants as fsConstants } from 'node:fs'

/**
 * 把清单里的相对路径收紧成 POSIX 安全相对路径；不安全返回 undefined。
 * @param {unknown} value
 * @returns {string|undefined}
 */
export function safeRelative(value) {
  if (typeof value !== 'string') return undefined
  const raw = value.replace(/\\/g, '/').trim()
  if (raw === '' || raw.startsWith('/') || /^[A-Za-z]:/.test(raw) || raw.includes('\0')) return undefined
  const segments = raw.split('/').filter((segment) => segment !== '' && segment !== '.')
  if (segments.length === 0) return undefined
  for (const segment of segments) {
    if (segment === '..') return undefined
  }
  return segments.join('/')
}

/**
 * @param {string} cwd
 * @param {string} rel
 * @returns {string|undefined}
 */
function targetWithin(cwd, rel) {
  const safe = safeRelative(rel)
  if (safe === undefined) return undefined
  const target = path.resolve(cwd, ...safe.split('/'))
  const root = path.resolve(cwd)
  const normalizedRoot = process.platform === 'win32' ? root.toLowerCase() : root
  const normalizedTarget = process.platform === 'win32' ? target.toLowerCase() : target
  if (normalizedTarget !== normalizedRoot && !normalizedTarget.startsWith(normalizedRoot + path.sep)) return undefined
  return target
}

/**
 * 在目录里找一个不冲突的名字：`报告.docx` → `报告 (2).docx`。
 * @param {string} file
 * @returns {Promise<string>}
 */
async function uniqueTarget(file) {
  const dir = path.dirname(file)
  const ext = path.extname(file)
  const stem = path.basename(file, ext)
  for (let index = 2; index < 1000; index += 1) {
    const candidate = path.join(dir, `${stem} (${index})${ext}`)
    try {
      await fsp.access(candidate)
    } catch {
      return candidate
    }
  }
  return path.join(dir, `${stem}-${Date.now()}${ext}`)
}

/**
 * @param {string} file
 * @returns {Promise<import('node:fs').Stats|undefined>}
 */
async function lstatOrUndefined(file) {
  try {
    return await fsp.lstat(file)
  } catch {
    return undefined
  }
}

/**
 * 生成还原计划；不落盘。
 *
 * @param {object} input
 * @param {any} input.manifest
 * @param {string} input.baseDir
 * @param {string} input.cwd
 * @param {'skip'|'rename'|'overwrite'} [input.mode]
 * @param {string[]} [input.paths]
 * @returns {Promise<{entries: any[], blocked: any[]}>}
 */
export async function planRestore({ manifest, baseDir, cwd, mode = 'skip', paths }) {
  const wanted = Array.isArray(paths) && paths.length > 0 ? new Set(paths) : null
  const files = Array.isArray(manifest?.files) ? manifest.files : []
  const entries = []
  const blocked = []

  for (const file of files) {
    if (file === null || typeof file !== 'object') continue
    const rel = safeRelative(file.rel)
    const stored = safeRelative(file.stored ?? file.rel)
    if (rel === undefined || stored === undefined) {
      blocked.push({ rel: String(file.rel ?? '—'), reason: 'unsafe-path' })
      continue
    }
    if (wanted !== null && !wanted.has(file.rel) && !wanted.has(rel)) continue
    const source = path.resolve(baseDir, ...stored.split('/'))
    const sourceRoot = path.resolve(baseDir)
    const normalizedRoot = process.platform === 'win32' ? sourceRoot.toLowerCase() : sourceRoot
    const normalizedSource = process.platform === 'win32' ? source.toLowerCase() : source
    if (normalizedSource !== normalizedRoot && !normalizedSource.startsWith(normalizedRoot + path.sep)) {
      blocked.push({ rel, reason: 'unsafe-source' })
      continue
    }
    const target = targetWithin(cwd, rel)
    if (target === undefined) {
      blocked.push({ rel, reason: 'unsafe-target' })
      continue
    }

    const sourceStat = await lstatOrUndefined(source)
    if (sourceStat === undefined || !sourceStat.isFile()) {
      entries.push({ rel, stored, source, target, action: 'missing', reason: '归档里没有这个文件' })
      continue
    }
    const targetStat = await lstatOrUndefined(target)
    if (targetStat === undefined) {
      entries.push({ rel, stored, source, target, action: 'create' })
      continue
    }
    if (targetStat.isSymbolicLink()) {
      entries.push({ rel, stored, source, target, action: 'conflict', reason: '目标是符号链接' })
      continue
    }
    if (!targetStat.isFile()) {
      entries.push({ rel, stored, source, target, action: 'conflict', reason: '目标不是普通文件' })
      continue
    }
    if (mode === 'skip') {
      entries.push({ rel, stored, source, target, action: 'skip', reason: '目标已存在' })
    } else if (mode === 'rename') {
      entries.push({ rel, stored, source, target: await uniqueTarget(target), action: 'create', renamed: true })
    } else {
      entries.push({ rel, stored, source, target, action: 'overwrite' })
    }
  }

  return { entries, blocked }
}

/**
 * 执行还原。`dryRun` 时只返回计划。
 *
 * @param {object} input
 * @param {any} input.manifest
 * @param {string} input.baseDir
 * @param {string} input.cwd
 * @param {'skip'|'rename'|'overwrite'} [input.mode]
 * @param {boolean} [input.dryRun]
 * @param {string} [input.backupRoot]
 * @param {string[]} [input.paths]
 * @returns {Promise<{dryRun: boolean, plan: any[], restored: any[], skipped: any[], failed: any[], backups: string[]}>}
 */
export async function applyRestore({ manifest, baseDir, cwd, mode = 'skip', dryRun = false, backupRoot, paths }) {
  const { entries, blocked } = await planRestore({ manifest, baseDir, cwd, mode, paths })
  const restored = []
  const skipped = []
  const failed = []
  const backups = []

  if (dryRun) {
    return { dryRun: true, plan: entries, blocked, restored, skipped, failed, backups }
  }

  for (const entry of entries) {
    if (entry.action === 'skip' || entry.action === 'missing' || entry.action === 'conflict') {
      skipped.push(entry)
      continue
    }
    try {
      const parent = path.dirname(entry.target)
      await fsp.mkdir(parent, { recursive: true })
      const parentReal = await fsp.realpath(parent)
      const cwdReal = await fsp.realpath(cwd)
      const normalizedCwd = process.platform === 'win32' ? cwdReal.toLowerCase() : cwdReal
      const normalizedParent = process.platform === 'win32' ? parentReal.toLowerCase() : parentReal
      if (normalizedParent !== normalizedCwd && !normalizedParent.startsWith(normalizedCwd + path.sep)) {
        failed.push({ ...entry, reason: 'parent-outside-cwd' })
        continue
      }

      if (entry.action === 'overwrite' && typeof backupRoot === 'string' && backupRoot !== '') {
        const backup = path.resolve(backupRoot, ...entry.rel.split('/'))
        await fsp.mkdir(path.dirname(backup), { recursive: true })
        await fsp.copyFile(entry.target, backup)
        backups.push(entry.rel)
      }

      if (entry.action === 'overwrite') {
        await fsp.copyFile(entry.source, entry.target)
      } else {
        // 新建用 EXCL，避免检查与写入之间被别人抢了同一个名字
        try {
          await fsp.copyFile(entry.source, entry.target, fsConstants.COPYFILE_EXCL)
        } catch (error) {
          if (error?.code === 'EEXIST') {
            skipped.push({ ...entry, action: 'skip', reason: '目标已存在' })
            continue
          }
          throw error
        }
      }
      restored.push(entry)
    } catch (error) {
      failed.push({ ...entry, reason: String(error?.message ?? error) })
    }
  }

  return { dryRun: false, plan: entries, blocked, restored, skipped, failed, backups }
}
