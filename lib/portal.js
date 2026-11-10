/**
 * 交付门户：把一个归档批次渲染成一份自包含、可离线打开、可打印的 HTML，
 * 并给出可选的「带文件」zip 条目。
 *
 * 安全边界与 receipt.js 一致：所有用户字段一律转义，模板零脚本、无外链，
 * 响应端仍强制 attachment。门户里的链接只指向包里自己的 `files/`。
 */
import fsp from 'node:fs/promises'
import path from 'node:path'
import { escapeHtml, formatBytes, renderReceiptHtml, renderReceiptMarkdown } from './receipt.js'
import { buildBrief, renderBriefMarkdown } from './brief.js'
import { kindOf } from './kinds.js'
import { safeRelative } from './restore.js'
import { safeEntryName } from './zip.js'

/** 缩略图最多放几张：门户是给人看的，不是图库。 */
const MAX_THUMBS = 12

/** 带文件模式下的单文件上限，与归档保持一致。 */
const DEFAULT_MAX_FILE_BYTES = 64 * 1024 * 1024

/** 门户里给类型一个中文名，别把内部 kind id 直接摊给用户。 */
const KIND_TEXT = {
  doc: '文档',
  sheet: '表格',
  slide: '演示',
  image: '图片',
  code: '代码',
  archive: '压缩包',
  media: '音视频',
  other: '其他',
}

/**
 * @param {any} manifest
 * @returns {any[]}
 */
function filesOf(manifest) {
  return Array.isArray(manifest?.files)
    ? manifest.files.filter((file) => file !== null && typeof file === 'object')
    : []
}

/**
 * 把包内相对路径变成 href：逐段编码，保留 `/`。
 * @param {string} stored
 * @returns {string}
 */
function hrefOf(stored) {
  return `files/${String(stored)
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')}`
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function timeText(value) {
  if (typeof value !== 'string' || value === '') return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/**
 * 渲染门户 HTML。
 *
 * @param {any} manifest
 * @param {{brief?: any, version?: string, includeFiles?: boolean}} [options]
 * @returns {string}
 */
export function renderPortalHtml(manifest, options = {}) {
  const files = filesOf(manifest)
  const total = files.reduce((sum, file) => sum + (Number(file.size) || 0), 0)
  const brief = options.brief ?? buildBrief(manifest)
  const includeFiles = options.includeFiles === true
  const version = typeof options.version === 'string' ? options.version : ''

  const bullets = (Array.isArray(brief?.bullets) ? brief.bullets : [])
    .map((line) => `<li>${escapeHtml(line)}</li>`)
    .join('\n')

  const rows = files
    .map((file, index) => {
      const stored = safeRelative(file.stored ?? file.rel)
      const rel = escapeHtml(file.rel ?? stored ?? '—')
      const name = includeFiles && stored !== undefined ? `<a href="${escapeHtml(hrefOf(stored))}">${rel}</a>` : rel
      return `<tr>
  <td class="num">${index + 1}</td>
  <td class="file">${name}</td>
  <td>${escapeHtml(KIND_TEXT[kindOf(file.rel ?? '')] ?? KIND_TEXT.other)}</td>
  <td class="num">${escapeHtml(formatBytes(file.size))}</td>
  <td class="num">${Number.isFinite(file.turn) ? escapeHtml(file.turn) : '—'}</td>
  <td class="hash"><code title="${escapeHtml(file.sha256 ?? '')}">${escapeHtml(String(file.sha256 ?? '').slice(0, 16))}</code></td>
  <td class="desc">${escapeHtml(file.desc ?? '')}</td>
</tr>`
    })
    .join('\n')

  const thumbs =
    includeFiles
      ? files
        .filter((file) => kindOf(file.rel ?? '') === 'image')
        .slice(0, MAX_THUMBS)
        .map((file) => {
          const stored = safeRelative(file.stored ?? file.rel)
          if (stored === undefined) return ''
          return `<figure><img loading="lazy" src="${escapeHtml(hrefOf(stored))}" alt="${escapeHtml(file.rel ?? '')}"><figcaption>${escapeHtml(file.rel ?? '')}</figcaption></figure>`
        })
        .filter(Boolean)
        .join('\n')
      : ''

  const failed =
    Array.isArray(manifest?.failed) && manifest.failed.length > 0
      ? `<h2>未归档</h2><ul>${manifest.failed
        .map((item) => `<li>${escapeHtml(item?.rel ?? '—')}：${escapeHtml(item?.reason ?? 'unknown')}</li>`)
        .join('')}</ul>`
      : ''

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>交付门户 · ${escapeHtml(manifest?.run ?? '')}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 32px; font: 14px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; color: #1f2328; background: #fff; }
  main { max-width: 960px; margin: 0 auto; }
  .eyebrow { font-size: 11px; letter-spacing: 0.16em; text-transform: uppercase; color: #6b7280; }
  h1 { margin: 4px 0 2px; font-size: 26px; letter-spacing: 0.01em; }
  .sub { color: #6b7280; font-size: 12px; margin-bottom: 22px; }
  .brief { background: #f6f8fa; border: 1px solid #e5e7eb; border-radius: 10px; padding: 14px 18px; margin: 18px 0; }
  .brief h2 { margin: 0 0 8px; font-size: 14px; }
  .brief ul { margin: 0; padding-left: 18px; }
  .brief li { margin: 3px 0; color: #374151; }
  .meta { display: grid; grid-template-columns: 110px 1fr; gap: 4px 14px; margin: 16px 0; font-size: 12.5px; }
  .meta dt { color: #6b7280; }
  .meta dd { margin: 0; word-break: break-all; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 12.5px; }
  th, td { border-bottom: 1px solid #e5e7eb; padding: 7px 8px; text-align: left; vertical-align: top; }
  th { background: #f9fafb; font-weight: 600; color: #374151; }
  td.num, th.num { text-align: right; white-space: nowrap; }
  td.file { word-break: break-all; }
  td.file a { color: #0969da; text-decoration: none; }
  td.file a:hover { text-decoration: underline; }
  td.hash code { font: 11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; color: #374151; }
  td.desc { color: #4b5563; }
  .total { margin-top: 10px; font-size: 12.5px; color: #374151; }
  .thumbs { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; margin-top: 18px; }
  .thumbs figure { margin: 0; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden; background: #fafafa; }
  .thumbs img { display: block; width: 100%; height: 110px; object-fit: cover; }
  .thumbs figcaption { padding: 4px 6px; font-size: 10px; color: #6b7280; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .note { margin-top: 16px; font-size: 12px; color: #6b7280; }
  footer { margin-top: 30px; padding-top: 10px; border-top: 1px solid #e5e7eb; font-size: 11px; color: #9ca3af; }
  @media print { body { padding: 0; } main { max-width: none; } .thumbs { display: none; } }
</style>
</head>
<body>
<main>
  <div class="eyebrow">Delivery portal</div>
  <h1>交付门户</h1>
  <div class="sub">由深海鱼篓生成 · ${escapeHtml(version || 'dsh-whale-catch')} · ${escapeHtml(timeText(new Date().toISOString()))}</div>
  <div class="brief">
    <h2>本批摘要</h2>
    <ul>${bullets}</ul>
  </div>
  <dl class="meta">
    <dt>会话</dt><dd>${escapeHtml(manifest?.session ?? '—')}</dd>
    <dt>目录</dt><dd>${escapeHtml(manifest?.cwd ?? '—')}</dd>
    <dt>批次</dt><dd>${escapeHtml(manifest?.run ?? '—')}</dd>
    <dt>归档时间</dt><dd>${escapeHtml(timeText(manifest?.archivedAt))}</dd>
    <dt>文件</dt><dd>${files.length} 个 · ${escapeHtml(formatBytes(total))}</dd>
    <dt>模式</dt><dd>${includeFiles ? '完整版（含文件）' : '清单版（不含文件正文）'}</dd>
  </dl>
  <table>
    <thead><tr><th class="num">#</th><th>文件</th><th>类型</th><th class="num">体积</th><th class="num">轮次</th><th>sha256</th><th>说明</th></tr></thead>
    <tbody>
${rows}
    </tbody>
  </table>
  <div class="total">合计：${files.length} 个文件 · ${escapeHtml(formatBytes(total))}</div>
  ${thumbs === '' ? '' : `<div class="thumbs">${thumbs}</div>`}
  ${failed}
  <p class="note">校验方法：把文件放在同一目录，执行 <code>shasum -a 256 &lt;文件&gt;</code>，与上表前 16 位对照。Windows 可用 <code>certutil -hashfile &lt;文件&gt; SHA256</code>。</p>
  <footer>本门户只记录归档那一刻的清单与摘要${includeFiles ? '，文件正文在 zip 的 files/ 目录' : '，不包含文件正文'}。</footer>
</main>
</body>
</html>
`
}

/**
 * 生成门户 zip 的条目。调用方用 writeZip() 流式写出去。
 *
 * @param {{manifest: any, baseDir: string, brief?: any, version?: string, includeFiles?: boolean, maxFileBytes?: number}} input
 * @returns {AsyncGenerator<{name: string, data?: Buffer, path?: string, mtimeMs?: number}>}
 */
export async function* buildPortalEntries(input) {
  const manifest = input.manifest
  const brief = input.brief ?? buildBrief(manifest)
  const version = typeof input.version === 'string' ? input.version : ''
  const includeFiles = input.includeFiles === true
  const maxFileBytes = Number.isFinite(input.maxFileBytes) ? input.maxFileBytes : DEFAULT_MAX_FILE_BYTES

  yield {
    name: 'portal.html',
    data: Buffer.from(renderPortalHtml(manifest, { brief, version, includeFiles }), 'utf8'),
    mtimeMs: Date.now(),
  }
  yield {
    name: '交付说明.md',
    data: Buffer.from(renderBriefMarkdown(brief, manifest), 'utf8'),
    mtimeMs: Date.now(),
  }
  yield {
    name: '_whale-catch/manifest.json',
    data: Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'),
    mtimeMs: Date.now(),
  }
  yield {
    name: '_whale-catch/receipt.html',
    data: Buffer.from(renderReceiptHtml(manifest, { version }), 'utf8'),
    mtimeMs: Date.now(),
  }
  yield {
    name: '_whale-catch/receipt.md',
    data: Buffer.from(renderReceiptMarkdown(manifest), 'utf8'),
    mtimeMs: Date.now(),
  }
  if (!includeFiles) return

  const base = path.resolve(input.baseDir)
  for (const file of filesOf(manifest)) {
    const stored = safeRelative(file.stored ?? file.rel)
    if (stored === undefined) continue
    const source = path.resolve(base, ...stored.split('/'))
    if (source !== base && !source.startsWith(base + path.sep)) continue
    try {
      const stat = await fsp.stat(source)
      if (!stat.isFile() || stat.size > maxFileBytes) continue
      const data = await fsp.readFile(source)
      yield {
        name: `files/${safeEntryName(stored)}`,
        data,
        mtimeMs: stat.mtimeMs,
      }
    } catch {
      // 归档里的文件被手工删了：跳过，不让整个门户失败。
    }
  }
}
