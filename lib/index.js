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
import { readFileSync } from 'node:fs'
import Schema from '@deepseek-ai/schemastery'
import { Basket } from './basket.js'
import { scanWorkspace } from './scan.js'
import { API_MOUNT, createApi } from './routes.js'

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
      ? path.resolve(input.archiveDir.trim())
      : path.join(dshHome(), 'whale-catch', 'archive')
  return {
    archiveDir,
    ignore: Array.isArray(input.ignore) ? input.ignore.filter((s) => typeof s === 'string' && s.trim() !== '') : [],
    maxFileBytes: positive(input.maxFileBytes, 64 * 1024 * 1024, 1024, 2 * 1024 * 1024 * 1024),
    maxFiles: positive(input.maxFiles, 800, 1, 5000),
    maxDepth: positive(input.maxDepth, 6, 0, 24),
    lookbackMinutes: positive(input.lookbackMinutes, 720, 1, 60 * 24 * 30),
    maxZipBytes: 512 * 1024 * 1024,
  }
}

/**
 * 会话 → 鱼篓的登记表，外加按需扫描。
 * @param {any} ctx
 * @param {ReturnType<typeof normalizeConfig>} config
 */
function createStore(ctx, config) {
  /** @type {Map<string, {basket: Basket, lastScanAt: number, scanning: Promise<void>|null}>} */
  const baskets = new Map()
  /** @type {string[]} 简单的插入序，用于把不活跃的会话挤出去 */
  const order = []
  /** @type {Map<string, NodeJS.Timeout>} */
  const timers = new Map()
  const MAX_SESSIONS = 40

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
      // 会话目录可能在运行中变了（working_directory 工具），以 agent 的当前值为准
      const liveCwd = headerOf(sessionId)?.cwd
      if (typeof liveCwd === 'string' && liveCwd !== '' && path.resolve(liveCwd) !== existing.basket.cwd) {
        existing.basket.cwd = path.resolve(liveCwd)
      }
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
    await scan(sessionId)
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
      record.basket.addPresented(event.data?.files, event.data?.turn)
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
        record.basket.addChanged(summary.files, event.data?.turn)
      }
      return
    }
    if (event.type === 'turn/end') {
      scheduleScan(sessionId)
    }
  }

  function dispose() {
    for (const timer of timers.values()) clearTimeout(timer)
    timers.clear()
    baskets.clear()
    order.length = 0
  }

  return { snapshot, refresh, resolve, observe, dispose, version }
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
        config: { maxFileBytes: config.maxFileBytes, maxZipBytes: config.maxZipBytes },
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
