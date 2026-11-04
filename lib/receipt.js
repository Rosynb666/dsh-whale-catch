/**
 * 交付回执：把批次清单渲染成一份能打印、能核对、能离线打开的文档。
 *
 * 安全边界：这是唯一一处把「用户文件名 / 描述」拼进 HTML 的地方，所以
 * 所有字段一律转义；模板不带脚本、不带外链，响应端还会强制 attachment +
 * CSP sandbox，防止文件名里的 `<script>` 在应用源上执行。
 */

/**
 * @param {unknown} value
 * @returns {string}
 */
export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * @param {number} bytes
 * @returns {string}
 */
export function formatBytes(bytes) {
  const value = Number(bytes)
  if (!Number.isFinite(value) || value <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let size = value
  let unit = 0
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024
    unit += 1
  }
  const digits = size >= 100 || unit === 0 ? 0 : size >= 10 ? 1 : 2
  return `${size.toFixed(digits)} ${units[unit]}`
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function timeText(value) {
  if (typeof value !== 'string' || value === '') return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/**
 * @param {any} manifest
 * @returns {any[]}
 */
function filesOf(manifest) {
  return Array.isArray(manifest?.files) ? manifest.files.filter((file) => file && typeof file === 'object') : []
}

/**
 * @param {any} manifest
 * @returns {string}
 */
export function renderReceiptMarkdown(manifest) {
  const files = filesOf(manifest)
  const total = files.reduce((sum, file) => sum + (Number(file.size) || 0), 0)
  const lines = [
    '# 交付回执',
    '',
    `- 会话：\`${manifest?.session ?? '—'}\``,
    `- 目录：\`${manifest?.cwd ?? '—'}\``,
    `- 批次：\`${manifest?.run ?? '—'}\``,
    `- 时间：${timeText(manifest?.archivedAt)}`,
    `- 文件：${files.length} 个，共 ${formatBytes(total)}`,
    '',
    '| # | 文件 | 体积 | 轮次 | sha256 | 说明 |',
    '| --- | --- | --- | --- | --- | --- |',
  ]
  files.forEach((file, index) => {
    lines.push(
      `| ${index + 1} | ${String(file.rel ?? '—').replace(/\|/g, '\\|')} | ${formatBytes(file.size)} | ${
        Number.isFinite(file.turn) ? file.turn : '—'
      } | \`${String(file.sha256 ?? '').slice(0, 16)}\` | ${String(file.desc ?? '').replace(/\|/g, '\\|')} |`,
    )
  })
  if (Array.isArray(manifest?.failed) && manifest.failed.length > 0) {
    lines.push('', '## 未归档', '')
    for (const item of manifest.failed) lines.push(`- ${item?.rel ?? '—'}：${item?.reason ?? 'unknown'}`)
  }
  lines.push('', '> 校验：把文件放在同一目录，执行 `shasum -a 256 <文件>`，与上表前 16 位对照。', '')
  return `${lines.join('\n')}\n`
}

/**
 * 自包含 HTML：内联 CSS、零脚本、A4 打印友好。
 *
 * @param {any} manifest
 * @param {{version?: string, verified?: any[]|null}} [options]
 * @returns {string}
 */
export function renderReceiptHtml(manifest, options = {}) {
  const files = filesOf(manifest)
  const total = files.reduce((sum, file) => sum + (Number(file.size) || 0), 0)
  const version = typeof options.version === 'string' ? options.version : ''
  const verified = Array.isArray(options.verified) ? options.verified : null
  const verifiedOf = (rel) => {
    if (verified === null) return null
    return verified.find((item) => item?.rel === rel) ?? null
  }

  const rows = files
    .map((file, index) => {
      const hit = verifiedOf(file.rel)
      const mark = hit === null ? '' : hit.ok ? ' ✓' : ' ✗'
      return `<tr>
  <td class="num">${index + 1}</td>
  <td class="path">${escapeHtml(file.rel)}${mark}</td>
  <td class="num">${escapeHtml(formatBytes(file.size))}</td>
  <td class="num">${Number.isFinite(file.turn) ? escapeHtml(file.turn) : '—'}</td>
  <td class="hash"><code title="${escapeHtml(file.sha256 ?? '')}">${escapeHtml(String(file.sha256 ?? '').slice(0, 16))}</code></td>
  <td class="desc">${escapeHtml(file.desc ?? '')}</td>
</tr>`
    })
    .join('\n')

  const failed =
    Array.isArray(manifest?.failed) && manifest.failed.length > 0
      ? `<h2>未归档</h2><ul>${manifest.failed
        .map((item) => `<li>${escapeHtml(item?.rel ?? '—')}：${escapeHtml(item?.reason ?? 'unknown')}</li>`)
        .join('')}</ul>`
      : ''

  const verifyNote =
    verified === null
      ? ''
      : `<p class="note">校验：${verified.filter((item) => item?.ok).length} / ${verified.length} 个文件与归档时一致${
        verified.some((item) => item && item.ok === false) ? '，存在不一致项（见文件后的 ✗）' : ''
      }。</p>`

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>交付回执 · ${escapeHtml(manifest?.run ?? '')}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 32px; font: 14px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; color: #1f2328; background: #fff; }
  main { max-width: 900px; margin: 0 auto; }
  h1 { margin: 0 0 4px; font-size: 22px; letter-spacing: 0.02em; }
  h2 { margin: 28px 0 8px; font-size: 15px; }
  .sub { color: #6b7280; font-size: 12px; margin-bottom: 20px; }
  .meta { display: grid; grid-template-columns: 120px 1fr; gap: 4px 12px; margin: 18px 0; font-size: 12.5px; }
  .meta dt { color: #6b7280; }
  .meta dd { margin: 0; word-break: break-all; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 12.5px; }
  th, td { border-bottom: 1px solid #e5e7eb; padding: 7px 8px; text-align: left; vertical-align: top; }
  th { background: #f9fafb; font-weight: 600; color: #374151; }
  td.num, th.num { text-align: right; white-space: nowrap; }
  td.path { word-break: break-all; }
  td.hash code { font: 11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; color: #374151; }
  td.desc { color: #4b5563; }
  .total { margin-top: 10px; font-size: 12.5px; color: #374151; }
  .note { margin-top: 16px; font-size: 12px; color: #6b7280; }
  footer { margin-top: 28px; padding-top: 10px; border-top: 1px solid #e5e7eb; font-size: 11px; color: #9ca3af; }
  @media print { body { padding: 0; } main { max-width: none; } }
</style>
</head>
<body>
<main>
  <h1>交付回执</h1>
  <div class="sub">由深海鱼篓生成 · ${escapeHtml(version || 'dsh-whale-catch')} · ${escapeHtml(timeText(new Date().toISOString()))}</div>
  <dl class="meta">
    <dt>会话</dt><dd>${escapeHtml(manifest?.session ?? '—')}</dd>
    <dt>目录</dt><dd>${escapeHtml(manifest?.cwd ?? '—')}</dd>
    <dt>批次</dt><dd>${escapeHtml(manifest?.run ?? '—')}</dd>
    <dt>归档时间</dt><dd>${escapeHtml(timeText(manifest?.archivedAt))}</dd>
    <dt>文件</dt><dd>${files.length} 个 · ${escapeHtml(formatBytes(total))}</dd>
  </dl>
  <table>
    <thead><tr><th class="num">#</th><th>文件</th><th class="num">体积</th><th class="num">轮次</th><th>sha256</th><th>说明</th></tr></thead>
    <tbody>
${rows}
    </tbody>
  </table>
  <div class="total">合计：${files.length} 个文件 · ${escapeHtml(formatBytes(total))}</div>
  ${failed}
  ${verifyNote}
  <p class="note">校验方法：在文件所在目录执行 <code>shasum -a 256 &lt;文件&gt;</code>，与上表前 16 位对照。Windows 可用 <code>certutil -hashfile &lt;文件&gt; SHA256</code>。</p>
  <footer>本回执只记录归档那一刻的清单与摘要，不包含文件内容。</footer>
</main>
</body>
</html>
`
}
