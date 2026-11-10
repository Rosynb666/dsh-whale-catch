/**
 * dsh-whale-catch · Host half
 *
 * 深海鱼篓：把「本次会话产出的文件」零登记地收进一个篮子里。
 *
 * 采集不是靠 agent 调工具登记（那种设计注定吃灰），而是三条来源合并：
 *   · `deliverables/presented` 会话事件 —— 模型显式 `present` 的交付物，带描述；
 *   · `workspace/changes` 会话事件 —— 内核识别到的本轮改动（git / 文件工具）；
 *   · 目录扫描 —— 按会话诞生时间过滤 mtime，兜住 bash / python 之类外部进程的产出。
 *
 * 对宿主的要求刻意压到最低：只 inject `webServer`；`agents` 与 `workspaceChanges`
 * 走 `ctx.get()` 可选获取，缺了也能工作（只是拿不到会话 cwd / 改动摘要）。
 * 这样即使 DSH 小版本动了服务名，最坏情况是功能降级，而不是整棵插件树炸掉。
 */
import os from 'node:os'
import path from 'node:path'
import { createReadStream, readFileSync } from 'node:fs'
import fsp from 'node:fs/promises'
import { createHash } from 'node:crypto'
import Schema from '@deepseek-ai/schemastery'
import { Basket } from './basket.js'
import { scanWorkspace } from './scan.js'
import { API_MOUNT, createApi, trimDiff } from './routes.js'
import { appendEvent, listManifests, readEvents, readManifest, rebuild as rebuildLedger, stats as ledgerStats } from './ledger.js'
import { isSafeId, RUN_NAME } from './ids.js'
import { buildBrief } from './brief.js'
import { aggregateLedger } from './aggregate.js'
import { toPosix } from './kinds.js'
import { searchFiles } from './search.js'
import { checkFiles, scanSensitive } from './preflight.js'
import { applyRestore, safeRelative } from './restore.js'
import { diffText } from './diff.js'

/** 包信息只读一次：版本号写进 /ping，契约自检会核对它与 package.json 一致。 */
const PKG = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

/** Cordis 插件名；同时是 cordis.patch.yml 里那一行的 `name`。 */
export const name = 'dsh-whale-catch'

/** 版本号（/ping 用）。 */
export const version = PKG.version

/** 只强制依赖 webServer：没有它这个插件没有意义。其余服务全部可选。 */
export const inject = ['webServer']

/** DSH 用户数据根目录。 */
function dshHome() {
  const fromEnv = process.env.DSH_HOME
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return path.resolve(fromEnv)
  return path.join(os.homedir(), '.dsh')
}

/** 只展开开头一个 `~` / `~/`：`path.resolve` 不会替你做这件事，而配置里这么写又很常见。 */
function expandHome(value) {
  if (value === '~') return os.homedir()
  if (value.startsWith('~/')) return path.join(os.homedir(), value.slice(2))
  return value
}

/**
 * 插件配置。字段都带默认值且整体再 .default({})——profile 补丁行没写 config:
 * 时 cordis 会传 undefined，裸 object schema 会判 invalid 并让整棵树装载失败。
 */
export const Config = Schema.object({
  archiveDir: Schema.string().description('归档目录；缺省 $DSH_HOME/whale-catch/archive'),
  ignore: Schema.array(Schema.string()).default([]).description('额外忽略的目录名'),
  maxFileBytes: Schema.number().default(64 * 1024 * 1024).description('单文件上限（字节）'),
  maxFiles: Schema.number().default(800).description('最多收录多少个文件'),
  maxDepth: Schema.number().default(6).description('目录遍历深度'),
  lookbackMinutes: Schema.number().default(720).description('拿不到会话创建时间时，往回看多少分钟'),
  maxZipBytes: Schema.number().default(512 * 1024 * 1024).description('打包总量上限（字节）'),
  maxBodyBytes: Schema.number().default(1024 * 1024).description('请求体上限（字节）'),
  archiveKeep: Schema.number().default(0).description('归档保留批次数；> 0 时每次归档写入独立批次目录，只保留最近 N 批'),
  allowHosts: Schema.array(Schema.string()).default([]).description('额外允许的 Host 名；默认只放行 localhost 与 IP 字面量'),
  ledger: Schema.boolean().default(true).description('是否写交付台账索引（清单始终写，索引可重建）'),
  ledgerDir: Schema.string().description('台账索引目录；缺省 $DSH_HOME/whale-catch/ledger'),
  searchMaxBytes: Schema.number().default(64 * 1024).description('内容搜索每个文件最多读多少字节'),
  searchTimeoutMs: Schema.number().default(3000).description('内容搜索总预算（毫秒）'),
  restoreBackup: Schema.boolean().default(true).description('还原覆盖前是否备份原文件'),
  sensitivePatterns: Schema.array(Schema.string()).default([]).description('额外的敏感文件名通配符'),
}).default({})

/**
 * 归一化配置：非法值夹回合法区间，绝不因为用户写了个 0 就整个插件不工作。
 * @param {Record<string, unknown>} [raw]
 */
export function normalizeConfig(raw) {
  const input = raw !== null && typeof raw === 'object' ? raw : {}
  const positive = (value, fallback, min, max) => {
    const n = Number(value)
    if (!Number.isFinite(n) || n < min) return fallback
    return Math.min(Math.floor(n), max)
  }
  const archiveDir =
    typeof input.archiveDir === 'string' && input.archiveDir.trim() !== ''
      ? path.resolve(expandHome(input.archiveDir.trim()))
      : path.join(dshHome(), 'whale-catch', 'archive')
  return {
    archiveDir,
    ignore: Array.isArray(input.ignore) ? input.ignore.filter((s) => typeof s === 'string' && s.trim() !== '') : [],
    maxFileBytes: positive(input.maxFileBytes, 64 * 1024 * 1024, 1024, 2 * 1024 * 1024 * 1024),
    maxFiles: positive(input.maxFiles, 800, 1, 5000),
    maxDepth: positive(input.maxDepth, 6, 0, 24),
    lookbackMinutes: positive(input.lookbackMinutes, 720, 1, 60 * 24 * 30),
    // 2 GB 是 ZIP32 的安全上限（单条目与总量都用 32 位字段）。
    maxZipBytes: positive(input.maxZipBytes, 512 * 1024 * 1024, 1024 * 1024, 2 * 1024 * 1024 * 1024),
    maxBodyBytes: positive(input.maxBodyBytes, 1024 * 1024, 1024, 16 * 1024 * 1024),
    // 0 = 保持旧的扁平布局（同名加序号）；> 0 = 批次目录 + 只留最近 N 批。
    archiveKeep: positive(input.archiveKeep, 0, 0, 1000),
    allowHosts: Array.isArray(input.allowHosts)
      ? input.allowHosts
        .filter((s) => typeof s === 'string' && s.trim() !== '')
        .map((s) => s.trim().toLowerCase())
      : [],
    ledger: input.ledger !== false,
    ledgerDir:
      typeof input.ledgerDir === 'string' && input.ledgerDir.trim() !== ''
        ? path.resolve(expandHome(input.ledgerDir.trim()))
        : path.join(dshHome(), 'whale-catch', 'ledger'),
    searchMaxBytes: positive(input.searchMaxBytes, 64 * 1024, 1024, 1024 * 1024),
    searchTimeoutMs: positive(input.searchTimeoutMs, 3000, 200, 30000),
    restoreBackup: input.restoreBackup !== false,
    sensitivePatterns: Array.isArray(input.sensitivePatterns)
      ? input.sensitivePatterns.filter((value) => typeof value === 'string' && value.trim() !== '').map((value) => value.trim())
      : [],
  }
}

/**
 * 造一个带业务码的错误：路由层靠 `code` / `status` 决定响应，不靠猜 message。
 * @param {string} code
 * @param {number} status
 * @param {string} message
 * @returns {Error & {code: string, status: number}}
 */
function fail(code, status, message) {
  const error = /** @type {Error & {code: string, status: number}} */ (new Error(message))
  error.code = code
  error.status = status
  return error
}

/**
 * 会话 → 鱼篓的登记表，外加按需扫描。
 * @param {any} ctx
 * @param {ReturnType<typeof normalizeConfig>} config
 */
export function createStore(ctx, config) {
  /** @type {Map<string, {basket: Basket, lastScanAt: number, scanning: Promise<void>|null, hydrated: boolean, hydrating: Promise<void>|null}>} */
  const baskets = new Map()
  const ledgerDir = config.ledgerDir
  /** @type {string[]} 访问顺序（LRU）：命中时移到队尾，超出上限从队首淘汰 */
  const order = []
  /** @type {Map<string, NodeJS.Timeout>} */
  const timers = new Map()
  const MAX_SESSIONS = 40

  /**
   * 把刚访问过的会话移到队尾。会话数最多 40，线性扫描足够。
   * @param {string} sessionId
   */
  function touchOrder(sessionId) {
    const at = order.indexOf(sessionId)
    if (at === -1 || at === order.length - 1) return
    order.splice(at, 1)
    order.push(sessionId)
  }

  const agentsOf = () => {
    try {
      return typeof ctx.get === 'function' ? ctx.get('agents') : undefined
    } catch {
      return undefined
    }
  }
  const changesOf = () => {
    try {
      return typeof ctx.get === 'function' ? ctx.get('workspaceChanges') : undefined
    } catch {
      return undefined
    }
  }

  /**
   * 从活跃 agent 的会话头里读 cwd / 创建时间。
   * @param {string} sessionId
   */
  function headerOf(sessionId) {
    try {
      const agent = agentsOf()?.get?.(sessionId)
      const header = agent?.session?.header
      return header !== null && typeof header === 'object' ? header : undefined
    } catch {
      return undefined
    }
  }

  /**
   * @param {unknown} value
   * @returns {number|undefined}
   */
  function timeOf(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string') {
      const parsed = Date.parse(value)
      if (Number.isFinite(parsed)) return parsed
    }
    return undefined
  }

  /**
   * @param {string} sessionId
   * @param {string} [cwdHint]
   */
  function ensure(sessionId, cwdHint) {
    const existing = baskets.get(sessionId)
    if (existing !== undefined) {
      // 会话目录可能在运行中变了（working_directory 工具），以 agent 的当前值为准。
      // 目录变了就作废旧扫描时间，让下一次 GET 在新目录里重扫一次。
      const liveCwd = headerOf(sessionId)?.cwd
      if (typeof liveCwd === 'string' && liveCwd !== '' && path.resolve(liveCwd) !== existing.basket.cwd) {
        existing.basket.cwd = path.resolve(liveCwd)
        existing.lastScanAt = 0
      }
      touchOrder(sessionId)
      return existing
    }

    const header = headerOf(sessionId)
    const agentCwd = typeof header?.cwd === 'string' && header.cwd !== '' ? header.cwd : undefined
    const hintCwd = typeof cwdHint === 'string' && path.isAbsolute(cwdHint) ? cwdHint : undefined
    const cwd = agentCwd ?? hintCwd
    if (cwd === undefined) {
      const error = new Error('无法确定这个会话的工作目录；请把会话切到前台后重试，或在请求里带上 cwd')
      // @ts-expect-error 自定义错误码
      error.code = 'no-cwd'
      throw error
    }

    const created = timeOf(header?.createdAt)
    const sinceMs = created ?? Date.now() - config.lookbackMinutes * 60 * 1000
    const record = {
      basket: new Basket({ sessionId, cwd, sinceMs }),
      lastScanAt: 0,
      scanning: null,
      hydrated: false,
      hydrating: null,
    }
    baskets.set(sessionId, record)
    order.push(sessionId)
    while (order.length > MAX_SESSIONS) {
      const stale = order.shift()
      if (stale !== undefined && stale !== sessionId) {
        baskets.delete(stale)
        const timer = timers.get(stale)
        if (timer !== undefined) clearTimeout(timer)
        timers.delete(stale)
      }
    }
    return record
  }

  /**
   * 把台账里的描述 / 轮次 / 交付状态回填进 Basket。每个会话只做一次。
   * @param {any} record
   * @returns {Promise<void>}
   */
  async function hydrate(record) {
    if (!config.ledger || record.hydrated) return
    if (record.hydrating !== null) return record.hydrating
    record.hydrating = (async () => {
      const events = await readEvents(ledgerDir, record.basket.sessionId)
      record.basket.hydrate(events)
      record.hydrated = true
    })().finally(() => {
      record.hydrating = null
    })
    return record.hydrating
  }

  /**
   * 扫描一次并合入鱼篓。并发调用共用同一个 Promise，避免连点刷新把磁盘打满。
   * @param {string} sessionId
   * @param {boolean} [force]
   */
  async function scan(sessionId, force = false) {
    const record = ensure(sessionId)
    if (!force && Date.now() - record.lastScanAt < 1500) return
    if (record.scanning !== null) return record.scanning
    record.scanning = (async () => {
      const result = await scanWorkspace({
        cwd: record.basket.cwd,
        sinceMs: record.basket.sinceMs,
        ignore: config.ignore,
        ignorePaths: [config.archiveDir],
        maxDepth: config.maxDepth,
        maxFiles: config.maxFiles,
        maxFileBytes: config.maxFileBytes,
      })
      record.basket.addScan(result)
      record.lastScanAt = Date.now()
    })().finally(() => {
      record.scanning = null
    })
    return record.scanning
  }

  /**
   * @param {string} sessionId
   * @param {string} [cwdHint]
   */
  async function snapshot(sessionId, cwdHint) {
    const record = ensure(sessionId, cwdHint)
    await hydrate(record)
    // 只在首次打开（或 cwd 刚变）时扫一次；5 秒轮询的 GET 直接读缓存。
    // 新产出由 turn/end 的延迟扫描和手动「刷新」补上，避免面板开着就持续扫盘。
    if (record.lastScanAt === 0) await scan(sessionId)
    const data = await record.basket.snapshot()
    return {
      session: sessionId,
      cwd: record.basket.cwd,
      since: record.basket.sinceMs,
      archiveDir: config.archiveDir,
      ...data,
    }
  }

  /**
   * @param {string} sessionId
   * @param {string} cwdHint
   */
  async function refresh(sessionId, cwdHint) {
    const record = ensure(sessionId, cwdHint)
    await hydrate(record)
    // 万一后台扫描还在跑，先等它结束再强制扫一次；否则「刷新」会拿到
    // 扫描开始前的旧快照。
    if (record.scanning !== null) await record.scanning
    await scan(sessionId, true)
    const data = await record.basket.snapshot()
    return {
      session: sessionId,
      cwd: record.basket.cwd,
      since: record.basket.sinceMs,
      archiveDir: config.archiveDir,
      ...data,
    }
  }

  /**
   * @param {string} sessionId
   * @param {string} requested
   */
  function resolve(sessionId, requested) {
    const record = baskets.get(sessionId)
    return record === undefined ? undefined : record.basket.resolve(requested)
  }

  /**
   * 向内核要一条改动的文本对比。
   *
   * 鱼篓自己不留 before/after 快照——那是 `workspace-changes` 的职责，它按
   * `seq + index` 把对比保留到会话释放。这里只做两件事：准入（路径必须已进筐）
   * 与降级（Host 没有 diff 能力时给可读的错误码，而不是 500）。
   *
   * @param {string} sessionId
   * @param {string} requested
   * @param {AbortSignal} [signal]
   * @param {number} [turn] 指定轮次；不传就是最近一轮
   */
  async function diff(sessionId, requested, signal, turn) {
    const record = baskets.get(sessionId)
    if (record === undefined) throw fail('no-session', 404, '这个会话还没打开鱼篓')
    if (record.basket.resolve(requested) === undefined) throw fail('not-in-basket', 404, '这个文件不在鱼篓里')
    const hit = Number.isFinite(turn)
      ? record.basket.changeForTurn(requested, turn)
      : record.basket.resolveChange(requested)
    if (hit === undefined) {
      throw fail('no-change', 404, Number.isFinite(turn) ? '这一轮没有可读的改动记录' : '这条没有改动记录，没有差异可看')
    }
    const service = changesOf()
    if (service === undefined || typeof service.diff !== 'function') {
      throw fail('no-diff', 404, '当前 Host 没有提供改动对比能力')
    }
    const value = await service.diff(sessionId, hit.seq, hit.index, signal)
    if (value === undefined) throw fail('no-diff', 404, '内核没有保留这轮改动的对比')
    return value
  }

  /**
   * 一轮结束后延迟扫描：给磁盘一点时间把文件写完。
   * @param {string} sessionId
   */
  function scheduleScan(sessionId) {
    if (timers.has(sessionId)) return
    const timer = setTimeout(() => {
      timers.delete(sessionId)
      scan(sessionId, true).catch(() => {
        // 扫描失败不该影响会话本身
      })
    }, 1200)
    if (typeof timer.unref === 'function') timer.unref()
    timers.set(sessionId, timer)
  }

  /**
   * 接收会话事件。事件都来自内核已持久化的类型，不新增任何事件类型。
   * @param {any} session
   * @param {any} event
   */
  function observe(session, event) {
    const sessionId = session?.id
    if (typeof sessionId !== 'string' || event === null || typeof event !== 'object') return
    let record
    try {
      record = ensure(sessionId, session?.header?.cwd)
    } catch {
      return
    }

    if (event.type === 'deliverables/presented') {
      const files = event.data?.files
      const turn = event.data?.turn
      record.basket.addPresented(files, turn)
      // 描述与轮次只活在内存里，重启就没了；这里顺手写进台账，下次打开再回填。
      if (config.ledger) {
        const payload = []
        for (const file of Array.isArray(files) ? files : []) {
          if (file === null || typeof file !== 'object' || typeof file.path !== 'string') continue
          const abs = path.resolve(record.basket.cwd, file.path)
          const rel = path.isAbsolute(file.path)
            ? toPosix(path.normalize(file.path))
            : toPosix(path.relative(record.basket.cwd, abs))
          if (rel === '' || rel.startsWith('../')) continue
          payload.push({ rel, desc: typeof file.description === 'string' ? file.description : '' })
        }
        if (payload.length > 0) {
          appendEvent(ledgerDir, sessionId, {
            v: 1,
            t: 'present',
            at: Date.now(),
            turn: Number.isFinite(turn) ? turn : null,
            files: payload,
          }).catch(() => {})
        }
      }
      return
    }
    if (event.type === 'workspace/changes') {
      const seq = typeof event.seq === 'number' ? event.seq : undefined
      if (seq === undefined) return
      let summary
      try {
        summary = changesOf()?.summary?.(sessionId, seq)
      } catch {
        summary = undefined
      }
      if (summary !== undefined && Array.isArray(summary?.files)) {
        record.basket.addChanged(summary.files, event.data?.turn, seq)
      }
      return
    }
    if (event.type === 'turn/end') {
      scheduleScan(sessionId)
    }
  }

  /**
   * 记一条交付状态，并把事件写进台账。
   * @param {string} sessionId
   * @param {string} requested
   * @param {'done'|'undone'} state
   * @param {string} [note]
   */
  function mark(sessionId, requested, state, note) {
    const record = baskets.get(sessionId)
    if (record === undefined) throw fail('no-session', 404, '这个会话还没打开鱼篓')
    const value = record.basket.mark(requested, state, note)
    if (value === undefined) throw fail('not-in-basket', 404, '这个文件不在鱼篓里')
    if (config.ledger) {
      const abs = record.basket.resolve(requested)
      appendEvent(ledgerDir, sessionId, {
        v: 1,
        t: 'mark',
        at: value.at,
        path: abs,
        state: value.state,
        note: value.note,
      }).catch(() => {})
    }
    return value
  }

  /**
   * 列出一个会话的归档批次：优先读清单，没有再退回索引。
   * @param {string} sessionId
   */
  async function listRuns(sessionId) {
    if (!isSafeId(sessionId)) throw fail('bad-session', 400, '缺少或非法的 session 参数')
    const rows = await listManifests(config.archiveDir, sessionId)
    if (rows.length > 0) return rows
    const events = await readEvents(ledgerDir, sessionId)
    return events
      .filter((event) => event.t === 'archive' && typeof event.run === 'string')
      .map((event) => ({
        run: event.run,
        layout: event.layout === 'flat' ? 'flat' : 'runs',
        at: Number(event.at) || 0,
        archivedAt: null,
        count: Number(event.count) || 0,
        bytes: Number(event.bytes) || 0,
        failed: Number(event.failed) || 0,
        session: sessionId,
        cwd: null,
        file: null,
        fromLedger: true,
      }))
      .sort((a, b) => b.at - a.at)
  }

  /**
   * 单批详情。
   * @param {string} sessionId
   * @param {string} run
   */
  async function getRun(sessionId, run) {
    if (!isSafeId(sessionId)) throw fail('bad-session', 400, '缺少或非法的 session 参数')
    const hit = await readManifest(config.archiveDir, sessionId, run)
    if (hit === undefined) throw fail('no-run', 404, '这个批次不在归档里')
    return {
      session: sessionId,
      run: hit.manifest.run ?? run,
      layout: hit.layout,
      archivedAt: hit.manifest.archivedAt ?? null,
      manifest: hit.manifest,
    }
  }

  /**
   * 重算一个批次的 sha256，确认归档文件没被改动。
   * @param {string} sessionId
   * @param {string} run
   * @param {string[]} [paths]
   */
  async function verifyRun(sessionId, run, paths) {
    const hit = await readManifest(config.archiveDir, sessionId, run)
    if (hit === undefined) throw fail('no-run', 404, '这个批次不在归档里')
    const wanted = Array.isArray(paths) && paths.length > 0 ? new Set(paths) : null
    const files = (Array.isArray(hit.manifest.files) ? hit.manifest.files : []).filter(
      (file) => file && typeof file.rel === 'string' && (wanted === null || wanted.has(file.rel)),
    )
    const rows = []
    let cursor = 0
    const worker = async () => {
      while (cursor < files.length) {
        const index = cursor
        cursor += 1
        const file = files[index]
        const stored = safeRelative(file.stored ?? file.rel)
        if (stored === undefined) {
          rows.push({ rel: file.rel, ok: false, reason: 'unsafe-source' })
          continue
        }
        const source = path.resolve(hit.baseDir, ...stored.split('/'))
        try {
          const hash = await new Promise((resolve, reject) => {
            const digest = createHash('sha256')
            const stream = createReadStream(source)
            stream.on('data', (chunk) => digest.update(chunk))
            stream.on('error', reject)
            stream.on('end', () => resolve(digest.digest('hex')))
          })
          const expected = typeof file.sha256 === 'string' && file.sha256 !== '' ? file.sha256 : null
          rows.push({
            rel: file.rel,
            ok: expected === null ? null : hash === expected,
            reason: expected === null ? 'no-hash' : hash === expected ? 'ok' : 'mismatch',
            sha256: hash,
          })
        } catch {
          rows.push({ rel: file.rel, ok: false, reason: 'missing' })
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(4, files.length) }, worker))
    rows.sort((a, b) => a.rel.localeCompare(b.rel))
    return {
      run,
      verified: rows,
      ok: rows.every((row) => row.ok !== false),
      checkedAt: new Date().toISOString(),
    }
  }

  /**
   * 把批次里的文件还原到会话工作目录。
   * @param {string} sessionId
   * @param {{run: string, paths?: string[], mode?: string, dryRun?: boolean}} input
   */
  async function restoreRun(sessionId, input) {
    if (!isSafeId(sessionId)) throw fail('bad-session', 400, '缺少或非法的 session 参数')
    const hit = await readManifest(config.archiveDir, sessionId, input.run)
    if (hit === undefined) throw fail('no-run', 404, '这个批次不在归档里')
    const record = ensure(sessionId)
    await hydrate(record)
    const mode = input.mode === 'overwrite' || input.mode === 'rename' ? input.mode : 'skip'
    const dryRun = input.dryRun === true
    let backupRoot
    if (!dryRun && mode === 'overwrite' && config.restoreBackup) {
      const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-')
      backupRoot = path.join(config.archiveDir, sessionId, '_whale-catch', 'backups', stamp)
    }
    const result = await applyRestore({
      manifest: hit.manifest,
      baseDir: hit.baseDir,
      cwd: record.basket.cwd,
      mode,
      dryRun,
      backupRoot,
      paths: Array.isArray(input.paths) ? input.paths : undefined,
    })
    if (!dryRun && config.ledger) {
      appendEvent(ledgerDir, sessionId, {
        v: 1,
        t: 'restore',
        at: Date.now(),
        run: hit.manifest.run ?? input.run,
        mode,
        restored: result.restored.length,
        failed: result.failed.length,
      }).catch(() => {})
    }
    return result
  }

  /**
   * 交付体检：结构问题 + 敏感内容。
   * @param {string} sessionId
   * @param {string[]} [paths]
   */
  async function preflight(sessionId, paths) {
    const data = await snapshot(sessionId)
    const wanted = Array.isArray(paths) && paths.length > 0 ? new Set(paths) : null
    const files = wanted === null ? data.files : data.files.filter((file) => wanted.has(file.path) || wanted.has(file.rel))
    const manifests = await listManifests(config.archiveDir, sessionId)
    const latest = manifests.length > 0 ? await readManifest(config.archiveDir, sessionId, manifests[0].run) : undefined
    const issues = checkFiles(files, {
      maxFileBytes: config.maxFileBytes,
      maxZipBytes: config.maxZipBytes,
      latestManifest: latest,
      sensitivePatterns: config.sensitivePatterns,
    })
    const sensitive = await scanSensitive(files, { maxFileBytes: config.maxFileBytes })
    const all = [...issues, ...sensitive]
    const rank = { block: 0, warn: 1, info: 2 }
    all.sort((a, b) => (rank[a.level] ?? 9) - (rank[b.level] ?? 9))
    return {
      session: sessionId,
      files: files.length,
      issues: all,
      summary: {
        total: all.length,
        block: all.filter((issue) => issue.level === 'block').length,
        warn: all.filter((issue) => issue.level === 'warn').length,
        info: all.filter((issue) => issue.level === 'info').length,
      },
    }
  }

  /**
   * 内容搜索（只读文件头，不建索引）。
   * @param {string} sessionId
   * @param {string} query
   * @param {number} [limit]
   * @param {AbortSignal} [signal]
   */
  async function searchContent(sessionId, query, limit, signal) {
    if (typeof query !== 'string' || query.trim() === '') throw fail('empty-query', 400, '搜索词不能为空')
    const data = await snapshot(sessionId)
    const value = await searchFiles({
      files: data.files,
      query,
      maxBytes: config.searchMaxBytes,
      timeoutMs: config.searchTimeoutMs,
      limit: Number.isFinite(limit) ? Math.max(1, Math.min(50, Math.trunc(limit))) : 20,
      signal,
    })
    return { session: sessionId, ...value }
  }

  /**
   * 当前文件 vs 归档里的那一版。
   * @param {string} sessionId
   * @param {string} requested
   * @param {string} [run]
   * @param {AbortSignal} [signal]
   */
  async function archiveDiff(sessionId, requested, run, signal) {
    const record = ensure(sessionId)
    await hydrate(record)
    const abs = record.basket.resolve(requested)
    if (abs === undefined) throw fail('not-in-basket', 404, '这个文件不在鱼篓里')
    const data = await record.basket.snapshot()
    const file = data.files.find((item) => item.path === abs)
    if (file === undefined) throw fail('not-in-basket', 404, '这个文件不在鱼篓里')

    let hit
    if (typeof run === 'string' && run !== '') {
      hit = await readManifest(config.archiveDir, sessionId, run)
    } else {
      const rows = await listManifests(config.archiveDir, sessionId)
      for (const row of rows) {
        const candidate = await readManifest(config.archiveDir, sessionId, row.run)
        if (candidate !== undefined && candidate.manifest.files.some((item) => item?.rel === file.rel)) {
          hit = candidate
          break
        }
      }
    }
    if (hit === undefined) throw fail('no-archive-copy', 404, '这个文件还没有归档版本')

    const archived = hit.manifest.files.find((item) => item?.rel === file.rel)
    const stored = safeRelative(archived?.stored ?? archived?.rel)
    if (stored === undefined) throw fail('no-archive-copy', 404, '归档清单里的路径不安全')
    const source = path.resolve(hit.baseDir, ...stored.split('/'))
    if (signal?.aborted) throw fail('diff-timeout', 504, '读取对比超时')

    let before
    try {
      before = await fsp.readFile(source)
    } catch {
      throw fail('no-archive-copy', 404, '归档里的这个文件已经不在了')
    }
    const after = await fsp.readFile(abs)
    const diff = diffText(before, after)
    return {
      ...trimDiff(diff),
      run: hit.manifest.run ?? run,
      archivedAt: hit.manifest.archivedAt ?? null,
    }
  }

  /**
   * @param {string} sessionId
   * @param {number} [limit]
   */
  async function ledgerEvents(sessionId, limit) {
    if (!isSafeId(sessionId)) throw fail('bad-session', 400, '缺少或非法的 session 参数')
    return readEvents(ledgerDir, sessionId, { maxLines: limit })
  }

  /**
   * 归档完成后把批次写进索引。清单写失败时调用方可以不调这个。
   * @param {string} sessionId
   * @param {any} manifest
   * @param {string} [manifestPath]
   */
  function recordArchive(sessionId, manifest, manifestPath) {
    if (!config.ledger) return
    const files = Array.isArray(manifest?.files) ? manifest.files : []
    const bytes = files.reduce((sum, file) => sum + (Number(file?.size) || 0), 0)
    const manifestRef =
      typeof manifestPath === 'string'
        ? toPosix(path.relative(path.join(config.archiveDir, sessionId), manifestPath))
        : null
    appendEvent(ledgerDir, sessionId, {
      v: 1,
      t: 'archive',
      at: Date.parse(manifest?.archivedAt) || Date.now(),
      run: manifest?.run,
      layout: manifest?.layout === 'flat' ? 'flat' : 'runs',
      manifest: manifestRef,
      count: files.length,
      bytes,
      failed: Array.isArray(manifest?.failed) ? manifest.failed.length : 0,
    }).catch(() => {})
  }

  /**
   * 从归档清单重建索引。
   */
  async function rebuildIndex() {
    return rebuildLedger(ledgerDir, config.archiveDir)
  }

  /**
   * 归档空间统计。
   */
  async function archiveStats() {
    return ledgerStats(ledgerDir, config.archiveDir)
  }

  /**
   * 交付门户：读批次清单，返回渲染门户所需的数据。
   * @param {string} sessionId
   * @param {{run?: string, includeFiles?: boolean}} [input]
   */
  async function buildPortal(sessionId, input = {}) {
    if (!isSafeId(sessionId)) throw fail('bad-session', 400, '缺少或非法的 session 参数')
    const run = typeof input.run === 'string' ? input.run : ''
    if (!RUN_NAME.test(run)) throw fail('bad-run', 400, '批次名不合法')
    const hit = await readManifest(config.archiveDir, sessionId, run)
    if (hit === undefined) throw fail('no-run', 404, '这个批次不在归档里')
    return {
      session: sessionId,
      run: hit.manifest.run ?? run,
      baseDir: hit.baseDir,
      manifest: hit.manifest,
      brief: buildBrief(hit.manifest),
      includeFiles: input.includeFiles === true,
    }
  }

  /**
   * 单个批次的交付摘要。
   * @param {string} sessionId
   * @param {string} run
   */
  async function briefOf(sessionId, run) {
    if (!isSafeId(sessionId)) throw fail('bad-session', 400, '缺少或非法的 session 参数')
    if (!RUN_NAME.test(run)) throw fail('bad-run', 400, '批次名不合法')
    const hit = await readManifest(config.archiveDir, sessionId, run)
    if (hit === undefined) throw fail('no-run', 404, '这个批次不在归档里')
    return { session: sessionId, run: hit.manifest.run ?? run, brief: buildBrief(hit.manifest) }
  }

  /**
   * 跨会话交付汇总（只读台账索引）。
   * @param {number} [limit]
   */
  async function aggregate(limit) {
    return aggregateLedger({ ledgerDir, limit })
  }

  function dispose() {
    for (const timer of timers.values()) clearTimeout(timer)
    timers.clear()
    baskets.clear()
    order.length = 0
  }

  return {
    snapshot,
    refresh,
    resolve,
    diff,
    archiveDiff,
    observe,
    mark,
    listRuns,
    getRun,
    verifyRun,
    restoreRun,
    preflight,
    searchContent,
    ledgerEvents,
    recordArchive,
    rebuildIndex,
    archiveStats,
    buildPortal,
    briefOf,
    aggregate,
    dispose,
    version,
  }
}

/**
 * 插件入口。
 * @param {any} ctx
 * @param {Record<string, unknown>} [rawConfig]
 */
export function apply(ctx, rawConfig) {
  const config = normalizeConfig(rawConfig)
  const store = createStore(ctx, config)

  ctx.effect(() => {
    const disposeRoutes = ctx.webServer.register({
      kind: 'prefix',
      path: API_MOUNT,
      handler: createApi({
        store,
        config: {
          maxFileBytes: config.maxFileBytes,
          maxZipBytes: config.maxZipBytes,
          maxBodyBytes: config.maxBodyBytes,
          archiveKeep: config.archiveKeep,
          allowHosts: config.allowHosts,
          diffTimeoutMs: 8000,
          archiveDir: config.archiveDir,
          ledger: config.ledger,
          restoreBackup: config.restoreBackup,
          sensitivePatterns: config.sensitivePatterns,
        },
      }),
    })
    return () => {
      disposeRoutes()
      store.dispose()
    }
  }, 'dsh-whale-catch: /whale-catch/api routes')

  ctx.on('session/event', (session, event) => {
    store.observe(session, event)
  })
}
