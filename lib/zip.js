/**
 * 一个够用的 ZIP 写入器（STORE + DEFLATE），零依赖。
 *
 * 为什么不引 archiver / jszip：这个插件卖的就是"装得上、跑得动"，
 * 为了打一个包引入一棵依赖树不划算；ZIP 的中央目录格式二十年没变，
 * 自己写反而更可控（也能在单测里用系统 unzip 交叉验证）。
 *
 * 格式取舍：
 * - 支持 UTF-8 文件名（通用位标记 0x0800），中文文件名在 Windows 资源管理器
 *   与 macOS 归档工具里都能正确显示；
 * - 单条目默认尝试 deflate，压不小就退回 STORE；jpg/png/mp4/zip 这类已经压过的
 *   格式直接 STORE，别浪费 CPU；
 * - 写入可以逐块交给 sink（HTTP 响应），读一个文件压一个，内存里最多只有单个
 *   文件的大小，不会把整包先攒出来；
 * - 不做 zip64：条目数与单文件体积都受上层上限约束（默认 800 个 / 64 MB）。
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { deflateRaw } from 'node:zlib'
import { promisify } from 'node:util'

const deflateRawAsync = promisify(deflateRaw)

/** 已经压缩过的格式，再 deflate 基本只浪费 CPU。 */
const STORE_EXTENSIONS = new Set([
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'heic', 'bmp', 'ico',
  'mp3', 'm4a', 'aac', 'flac', 'ogg', 'wav',
  'mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi',
  'zip', 'gz', 'tgz', 'bz2', 'xz', '7z', 'rar', 'dmg',
  'docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp', 'epub',
])

const MAX_UINT16 = 0xffff
const MAX_UINT32 = 0xffffffff

/** CRC-32 查表（IEEE 802.3 多项式，与 ZIP 规范一致）。 */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i += 1) {
    let c = i
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[i] = c >>> 0
  }
  return table
})()

/**
 * @param {Buffer} buffer
 * @returns {number} 无符号 CRC-32
 */
export function crc32(buffer) {
  let crc = 0xffffffff
  for (let i = 0; i < buffer.length; i += 1) {
    crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

/**
 * 毫秒时间戳 → DOS 日期/时间（本地时区，ZIP 的传统行为）。
 * @param {number} mtimeMs
 * @returns {{dosTime: number, dosDate: number}}
 */
export function dosTimestamp(mtimeMs) {
  const date = new Date(Number.isFinite(mtimeMs) ? mtimeMs : Date.now())
  const year = Math.max(1980, date.getFullYear())
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | (Math.floor(date.getSeconds() / 2) & 0x1f)
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  return { dosTime, dosDate }
}

/**
 * 把一个名称清洗成 zip 内条目名：去掉盘符、前导斜杠与上跳段。
 * @param {string} name
 * @returns {string}
 */
export function safeEntryName(name) {
  const posix = String(name).replace(/\\/g, '/')
  const segments = posix
    .split('/')
    .filter((segment) => segment !== '' && segment !== '.' && segment !== '..')
  const cleaned = segments.join('/')
  return cleaned === '' ? 'file' : cleaned
}

/**
 * 这个条目值不值得 deflate。
 * @param {string} name
 * @returns {boolean}
 */
export function shouldCompress(name) {
  const ext = path.extname(String(name).toLowerCase()).slice(1)
  return ext === '' || !STORE_EXTENSIONS.has(ext)
}

/**
 * @typedef {object} ZipEntry
 * @property {string} name 条目名（相对路径，用 / 分隔）
 * @property {Buffer} [data] 内容；有 path 时可以省略
 * @property {string} [path] 从磁盘按需读取的绝对路径
 * @property {number} [mtimeMs] 修改时间；缺省用当前时间
 */

/**
 * 逐块写出一个 ZIP；sink 收到的是 Buffer，调用方可以把它直接喂给 HTTP 响应。
 *
 * 每个文件只在被处理时读入内存，写完即可释放；manifest 这类小条目直接给 data。
 * 中央目录在最后统一写，sink 可以按背压等待。
 *
 * @param {Iterable<ZipEntry>|AsyncIterable<ZipEntry>} entries
 * @param {(chunk: Buffer) => void|Promise<void>} sink
 * @returns {Promise<{entries: number, bytes: number}>}
 */
export async function writeZip(entries, sink) {
  /** @type {object[]} */
  const central = []
  let offset = 0

  /** @param {Buffer} buffer */
  const emit = async (buffer) => {
    if (buffer.length === 0) return
    await sink(buffer)
    offset += buffer.length
  }

  for await (const entry of entries) {
    const data = await readEntryData(entry)
    const name = safeEntryName(entry.name)
    const nameBuf = Buffer.from(name, 'utf8')
    if (nameBuf.length > MAX_UINT16) throw new RangeError('zip entry name is too long')
    if (data.length > MAX_UINT32) throw new RangeError('zip entry is larger than 4 GiB')

    const crc = crc32(data)
    const { dosTime, dosDate } = dosTimestamp(entry.mtimeMs)

    let method = 0
    let body = data
    if (data.length > 0 && shouldCompress(name)) {
      const deflated = await deflateRawAsync(data, { level: 6 })
      if (deflated.length < data.length) {
        method = 8
        body = deflated
      }
    }
    if (body.length > MAX_UINT32) throw new RangeError('zip entry is larger than 4 GiB')

    const localOffset = offset
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0) // local file header signature
    local.writeUInt16LE(20, 4) // version needed to extract (2.0)
    local.writeUInt16LE(0x0800, 6) // general purpose flags: UTF-8 names
    local.writeUInt16LE(method, 8)
    local.writeUInt16LE(dosTime, 10)
    local.writeUInt16LE(dosDate, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(body.length, 18) // compressed size
    local.writeUInt32LE(data.length, 22) // uncompressed size
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28) // extra field length

    await emit(local)
    await emit(nameBuf)
    await emit(body)

    central.push({
      nameBuf,
      crc,
      method,
      dosTime,
      dosDate,
      compressedSize: body.length,
      size: data.length,
      offset: localOffset,
    })
  }

  if (central.length > MAX_UINT16) throw new RangeError('too many zip entries')
  const centralStart = offset
  for (const item of central) {
    const header = Buffer.alloc(46)
    header.writeUInt32LE(0x02014b50, 0) // central directory signature
    header.writeUInt16LE(20, 4) // version made by
    header.writeUInt16LE(20, 6) // version needed
    header.writeUInt16LE(0x0800, 8)
    header.writeUInt16LE(item.method, 10)
    header.writeUInt16LE(item.dosTime, 12)
    header.writeUInt16LE(item.dosDate, 14)
    header.writeUInt32LE(item.crc, 16)
    header.writeUInt32LE(item.compressedSize, 20)
    header.writeUInt32LE(item.size, 24)
    header.writeUInt16LE(item.nameBuf.length, 28)
    header.writeUInt16LE(0, 30) // extra
    header.writeUInt16LE(0, 32) // comment
    header.writeUInt16LE(0, 34) // disk number start
    header.writeUInt16LE(0, 36) // internal attributes
    header.writeUInt32LE(0, 38) // external attributes
    header.writeUInt32LE(item.offset, 42)

    await emit(header)
    await emit(item.nameBuf)
  }

  const centralSize = offset - centralStart
  if (centralStart > MAX_UINT32 || centralSize > MAX_UINT32) {
    throw new RangeError('zip is larger than 4 GiB')
  }

  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0) // end of central directory signature
  end.writeUInt16LE(0, 4) // this disk
  end.writeUInt16LE(0, 6) // disk with central directory
  end.writeUInt16LE(central.length, 8)
  end.writeUInt16LE(central.length, 10)
  end.writeUInt32LE(centralSize, 12)
  end.writeUInt32LE(centralStart, 16)
  end.writeUInt16LE(0, 20) // comment length

  await emit(end)
  return { entries: central.length, bytes: offset }
}

/**
 * 把条目读成 Buffer：内存条目直接用，磁盘条目按需读。
 * @param {ZipEntry} entry
 * @returns {Promise<Buffer>}
 */
async function readEntryData(entry) {
  if (Buffer.isBuffer(entry.data)) return entry.data
  if (entry.data !== undefined) return Buffer.from(entry.data)
  if (typeof entry.path === 'string') return fs.readFile(entry.path)
  throw new Error('zip entry needs data or path')
}

/**
 * 打一个内存里的 zip（测试与小包用；路由走 writeZip 流式输出）。
 * @param {ZipEntry[]} entries
 * @returns {Promise<Buffer>}
 */
export async function buildZip(entries) {
  /** @type {Buffer[]} */
  const chunks = []
  await writeZip(entries, (chunk) => {
    chunks.push(chunk)
  })
  return Buffer.concat(chunks)
}
