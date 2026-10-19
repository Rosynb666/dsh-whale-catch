/**
 * 工作区扫描：把「本次会话期间动过的文件」捞出来。
 *
 * 这是鱼篓能"零登记"的关键：内核的 deliverables 只认 `present` 声明的文件，
 * workspace/changes 只认 git 与文件工具改过的路径——`bash` 里跑 `python build.py`
 * 生成的那些 docx/pdf 两边都不算。所以这里以 mtime 为准做一次兜底扫描。
 *
 * 取舍：宁可漏掉「被复制进来但 mtime 很旧」的文件，也不把整个磁盘历史翻出来。
 * 于是有 since 门槛、目录黑名单、深度/数量/体积上限，全部可配。
 */
import fs from 'node:fs/promises'
import path from 'node:path'

/**
 * 默认跳过的目录名。这些目录里的东西要么不是"产出"，要么数量爆炸。
 * 注意 `.git` 之类点开头目录本来也会被规则挡掉，写在这里是为了意图清晰。
 */
export const DEFAULT_SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.hg',
  '.svn',
  '.pnpm-store',
  '.yarn',
  '.next',
  '.nuxt',
  '.turbo',
  '.cache',
  '.parcel-cache',
  '__pycache__',
  '.venv',
  'venv',
  'Library',
  'System',
])

/**
 * @typedef {object} ScannedFile
 * @property {string} path 绝对路径
 * @property {string} rel 相对 cwd 的 POSIX 路径
 * @property {string} name 文件名
 * @property {number} size 字节
 * @property {number} mtimeMs 修改时间（毫秒）
 */

/**
 * 扫描 cwd 下 mtime 不早于 sinceMs 的文件。
 *
 * 语义边界（写进 README，避免用户以为是"全部文件"）：
 * - 只扫 cwd 之内，不越界、不跟符号链接（防止环）；
 * - 跳过点开头目录与 DEFAULT_SKIP_DIRS；
 * - mtime < sinceMs 的文件不收录；
 * - 深于 maxDepth 的目录不再下探；
 * - 收录到 maxFiles 个就停，返回 truncated: true。
 *
 * @param {object} options
 * @param {string} options.cwd 会话工作目录（绝对路径）
 * @param {number} options.sinceMs mtime 下限
 * @param {string[]} [options.ignore] 额外忽略的目录名
 * @param {string[]} [options.ignorePaths] 额外忽略的绝对路径（例如插件自己的归档目录）
 * @param {number} [options.maxDepth]
 * @param {number} [options.maxFiles]
 * @param {number} [options.maxFileBytes]
 * @param {number} [options.maxVisited] 最多访问多少个目录项，防病态大树
 * @returns {Promise<{files: ScannedFile[], truncated: boolean, visited: number, scannedAt: number}>}
 */
export async function scanWorkspace(options) {
  const {
    cwd,
    sinceMs,
    ignore = [],
    ignorePaths = [],
    maxDepth = 6,
    maxFiles = 800,
    maxFileBytes = 64 * 1024 * 1024,
    maxVisited = 20000,
  } = options

  /** @type {ScannedFile[]} */
  const files = []
  let visited = 0
  let truncated = false

  const ignoreDirs = new Set([...DEFAULT_SKIP_DIRS, ...ignore.filter(Boolean)])
  const ignoreAbs = new Set(ignorePaths.filter(Boolean).map((p) => path.resolve(p)))
  const since = Number.isFinite(sinceMs) ? sinceMs : 0

  /**
   * @param {string} dir
   * @param {number} depth
   * @param {string} relBase
   */
  async function walk(dir, depth, relBase) {
    if (truncated || depth > maxDepth) return
    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      // 权限不足 / 目录已被删：跳过这一支，不要让整次扫描失败
      return
    }
    // 目录项按名称排序，让结果稳定（也方便测试）
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))

    for (const entry of entries) {
      if (truncated) return
      const name = entry.name
      if (name.startsWith('.')) continue
      if (entry.isDirectory() && ignoreDirs.has(name)) continue

      const abs = path.join(dir, name)
      if (ignoreAbs.has(abs)) continue
      const rel = relBase === '' ? name : `${relBase}/${name}`

      if (++visited > maxVisited) {
        truncated = true
        return
      }

      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        await walk(abs, depth + 1, rel)
        continue
      }
      if (!entry.isFile()) continue

      let stat
      try {
        stat = await fs.stat(abs)
      } catch {
        continue
      }
      if (!stat.isFile()) continue
      if (stat.size > maxFileBytes) continue
      if (stat.mtimeMs < since) continue

      files.push({
        path: abs,
        rel,
        name,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
      })

      if (files.length >= maxFiles) {
        truncated = true
        return
      }
    }
  }

  await walk(path.resolve(cwd), 0, '')
  files.sort((a, b) => b.mtimeMs - a.mtimeMs)
  return { files, truncated, visited, scannedAt: Date.now() }
}
