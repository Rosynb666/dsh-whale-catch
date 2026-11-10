/**
 * 交付摘要：把一批清单压成几句人能直接复制的话。
 *
 * 只做规则统计，不调模型、不读文件正文。输出同时给回执、门户和面板用，
 * 所以这里不拼 HTML，只产出结构化文案，渲染交给调用方。
 */
import { formatBytes } from './receipt.js'
import { kindOf, KIND_ORDER } from './kinds.js'

/** 分类 id → 中文名；与客户端字典保持同一套词汇。 */
const KIND_LABELS = {
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
 * 生成交付摘要。
 *
 * @param {any} manifest 批次清单（archive 写出的 manifest.json 形状）
 * @returns {{title: string, summary: string, bullets: string[], stats: any}}
 */
export function buildBrief(manifest) {
  const files = filesOf(manifest)
  const total = files.reduce((sum, file) => sum + (Number(file.size) || 0), 0)
  const failed = Array.isArray(manifest?.failed) ? manifest.failed.filter(Boolean) : []
  const turns = [
    ...new Set(
      files
        .map((file) => Number(file.turn))
        .filter((turn) => Number.isFinite(turn)),
    ),
  ].sort((a, b) => a - b)

  /** @type {Map<string, {kind: string, label: string, count: number, bytes: number}>} */
  const byKind = new Map()
  for (const file of files) {
    const kind = kindOf(file.rel ?? file.name ?? '')
    const row = byKind.get(kind) ?? { kind, label: KIND_LABELS[kind] ?? KIND_LABELS.other, count: 0, bytes: 0 }
    row.count += 1
    row.bytes += Number(file.size) || 0
    byKind.set(kind, row)
  }
  const kinds = KIND_ORDER.filter((kind) => byKind.has(kind)).map((kind) => byKind.get(kind))

  const bullets = []
  bullets.push(`共 ${files.length} 个文件，合计 ${formatBytes(total)}。`)
  if (kinds.length > 0) {
    bullets.push(
      `类型分布：${kinds.map((row) => `${row.label} ${row.count} 个（${formatBytes(row.bytes)}）`).join('、')}。`,
    )
  }
  if (turns.length > 0) {
    const shown = turns.slice(0, 6).join('、')
    bullets.push(`涉及 ${turns.length} 个轮次：${shown}${turns.length > 6 ? ' 等' : ''}。`)
  }
  if (failed.length > 0) {
    bullets.push(`有 ${failed.length} 个文件未归档，交付前建议单独检查。`)
  }
  if (typeof manifest?.cwd === 'string' && manifest.cwd !== '') {
    bullets.push(`工作目录：${manifest.cwd}。`)
  }

  const summary = bullets.slice(0, 3).join('')
  return {
    title: `交付摘要 · ${manifest?.run ?? '未命名批次'}`,
    summary,
    bullets,
    stats: {
      files: files.length,
      bytes: total,
      failed: failed.length,
      turns,
      kinds,
    },
  }
}

/**
 * 摘要的 Markdown 版：写进门户 zip 的「交付说明.md」。
 *
 * @param {any} brief buildBrief() 的结果
 * @param {any} [manifest]
 * @returns {string}
 */
export function renderBriefMarkdown(brief, manifest) {
  const lines = [`# ${brief?.title ?? '交付摘要'}`, '']
  if (typeof manifest?.run === 'string') lines.push(`- 批次：\`${manifest.run}\``)
  if (typeof manifest?.archivedAt === 'string') lines.push(`- 归档时间：${manifest.archivedAt}`)
  if (typeof manifest?.cwd === 'string') lines.push(`- 工作目录：\`${manifest.cwd}\``)
  lines.push('', '## 摘要', '')
  for (const bullet of Array.isArray(brief?.bullets) ? brief.bullets : []) {
    lines.push(`- ${bullet}`)
  }
  const files = filesOf(manifest)
  if (files.length > 0) {
    lines.push('', '## 文件', '', '| 文件 | 体积 | 轮次 | sha256 |', '| --- | --- | --- | --- |')
    for (const file of files) {
      lines.push(
        `| ${String(file.rel ?? '—').replace(/\|/g, '\\|')} | ${formatBytes(file.size)} | ${
          Number.isFinite(file.turn) ? file.turn : '—'
        } | \`${String(file.sha256 ?? '').slice(0, 16)}\` |`,
      )
    }
  }
  lines.push('', '> 由深海鱼篓生成；只含清单与摘要，不含文件正文。', '')
  return `${lines.join('\n')}\n`
}
