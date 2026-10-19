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
 * - 单条目默认尝试 deflate，压不小就退回 STORE；
 * - 不做 zip64：条目数与单文件体积都受上层上限约束（默认 800 个 / 64 MB）。
 */
import { deflateRawSync } from 'node:zlib'

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
 * @typedef {object} ZipEntry
 * @property {string} name 条目名（相对路径，用 / 分隔）
 * @property {Buffer} data 内容
 * @property {number} [mtimeMs] 修改时间；缺省用当前时间
 */

/**
 * 打一个 zip。
 * @param {ZipEntry[]} entries
 * @returns {Buffer}
 */
export function buildZip(entries) {
  /** @type {Buffer[]} */
  const chunks = []
  /** @type {object[]} */
  const central = []
  let offset = 0

  for (const entry of entries) {
    const nameBuf = Buffer.from(safeEntryName(entry.name), 'utf8')
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data)
    const crc = crc32(data)
    const { dosTime, dosDate } = dosTimestamp(entry.mtimeMs)

    // 小文件压一压通常有收益；大文件也压，但压不小就退回 STORE
    let method = 0
    let body = data
    if (data.length > 0) {
      const deflated = deflateRawSync(data, { level: 6 })
      if (deflated.length < data.length) {
        method = 8
        body = deflated
      }
    }

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

    chunks.push(local, nameBuf, body)
    central.push({
      nameBuf,
      crc,
      method,
      dosTime,
      dosDate,
      compressedSize: body.length,
      size: data.length,
      offset,
    })
    offset += local.length + nameBuf.length + body.length
  }

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

    chunks.push(header, item.nameBuf)
    offset += header.length + item.nameBuf.length
  }

  const centralSize = offset - centralStart
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0) // end of central directory signature
  end.writeUInt16LE(0, 4) // this disk
  end.writeUInt16LE(0, 6) // disk with central directory
  end.writeUInt16LE(central.length, 8)
  end.writeUInt16LE(central.length, 10)
  end.writeUInt32LE(centralSize, 12)
  end.writeUInt32LE(centralStart, 16)
  end.writeUInt16LE(0, 20) // comment length

  chunks.push(end)
  return Buffer.concat(chunks)
}
