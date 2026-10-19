/**
 * 文件类型归类：只做后缀 → 分类 id 的纯映射。
 *
 * 分类 id 是前后端共用的稳定词汇（客户端用它取本地化标签），
 * 不要在 UI 里另建一套分类，否则中英文标签迟早对不上。
 */

/** @typedef {'doc'|'sheet'|'slide'|'image'|'code'|'archive'|'media'|'other'} Kind */

/** @type {Record<string, Kind>} */
const EXT_KIND = {
  // 文档
  doc: 'doc', docx: 'doc', pdf: 'doc', txt: 'doc', md: 'doc', markdown: 'doc',
  rtf: 'doc', odt: 'doc', pages: 'doc', tex: 'doc', epub: 'doc', log: 'doc',
  // 表格
  xls: 'sheet', xlsx: 'sheet', csv: 'sheet', tsv: 'sheet', ods: 'sheet', numbers: 'sheet',
  // 演示
  ppt: 'slide', pptx: 'slide', odp: 'slide', key: 'slide',
  // 图片
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', svg: 'image',
  bmp: 'image', ico: 'image', tif: 'image', tiff: 'image', heic: 'image', avif: 'image',
  // 代码 / 结构化文本
  js: 'code', mjs: 'code', cjs: 'code', ts: 'code', tsx: 'code', jsx: 'code',
  py: 'code', java: 'code', c: 'code', h: 'code', cpp: 'code', hpp: 'code', cc: 'code',
  cs: 'code', go: 'code', rs: 'code', rb: 'code', php: 'code', kt: 'code', swift: 'code',
  sh: 'code', bash: 'code', zsh: 'code', ps1: 'code', sql: 'code',
  html: 'code', htm: 'code', css: 'code', scss: 'code', less: 'code',
  json: 'code', jsonl: 'code', yaml: 'code', yml: 'code', toml: 'code', xml: 'code',
  ini: 'code', env: 'code', ipynb: 'code', vue: 'code', svelte: 'code',
  // 压缩包
  zip: 'archive', tar: 'archive', gz: 'archive', tgz: 'archive', bz2: 'archive',
  xz: 'archive', '7z': 'archive', rar: 'archive', dmg: 'archive',
  // 音视频
  mp3: 'media', wav: 'media', m4a: 'media', flac: 'media', aac: 'media', ogg: 'media',
  mp4: 'media', mov: 'media', webm: 'media', mkv: 'media', avi: 'media', m4v: 'media',
}

/** 分类的稳定顺序：界面上的筛选 chip 按这个顺序排。 */
export const KIND_ORDER = ['doc', 'sheet', 'slide', 'image', 'code', 'archive', 'media', 'other']

/**
 * 取小写后缀（不含点）。没有后缀返回空串。
 * @param {string} name 文件名或路径
 * @returns {string}
 */
export function extensionOf(name) {
  const base = String(name).split(/[\\/]/).pop() ?? ''
  const dot = base.lastIndexOf('.')
  // 以点开头且没有第二个点的文件名（.env）后缀算作空，交给 other
  if (dot <= 0) {
    // .env 这类「点文件」当成有后缀，归类更有用
    return dot === 0 && base.length > 1 ? base.slice(1).toLowerCase() : ''
  }
  return base.slice(dot + 1).toLowerCase()
}

/**
 * 后缀 → 分类 id。未知后缀归到 other。
 * @param {string} name
 * @returns {Kind}
 */
export function kindOf(name) {
  const ext = extensionOf(name)
  return EXT_KIND[ext] ?? 'other'
}

/**
 * 相对路径统一成 POSIX 分隔符：zip 条目和界面展示都按 `/` 走。
 * @param {string} p
 * @returns {string}
 */
export function toPosix(p) {
  return String(p).replace(/\\/g, '/')
}
