#!/usr/bin/env node
/**
 * 契约自检：把 DSH 插件「装不上 / 加载即白屏」的常见原因做成静态检查。
 *
 * 这里检查的都是官方文档里写死的硬约束，而不是代码风格：
 *   1. 包结构与 files/exports 指向的文件真实存在；
 *   2. bundle patch 与 package.json 的 id/name 对得上；
 *   3. dsh.client.inject 是静态数组（动态拼会在启动期炸客户端图）；
 *   4. locale 里有 meta.title / meta.description（市场与设置页靠它展示）；
 *   5. icon 存在且 ≤ 256 KiB；
 *   6. 运行时零 dependencies（共享的 dsh 包只能放 peer）；
 *   7. 所有 JS 文件能被 node --check 解析；
 *   8. 插件导出的 name / inject 与代码里写的一致。
 *
 * 退出码：0 全过；1 有 error。warning 不影响退出码。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const failures = []
const warnings = []

/**
 * @param {boolean} condition
 * @param {string} label
 * @param {string} [detail]
 */
function expect(condition, label, detail) {
  if (condition) {
    console.log(`  \u001b[32m✓\u001b[0m ${label}`)
    return true
  }
  console.log(`  \u001b[31m✗\u001b[0m ${label}${detail ? ` — ${detail}` : ''}`)
  failures.push(detail ? `${label}: ${detail}` : label)
  return false
}

/**
 * @param {string} message
 */
function warn(message) {
  console.log(`  \u001b[33m!\u001b[0m ${message}`)
  warnings.push(message)
}

/**
 * @param {string} file
 * @returns {boolean}
 */
function exists(file) {
  return existsSync(path.join(ROOT, file))
}

/**
 * @param {string} file
 * @returns {string}
 */
function read(file) {
  return readFileSync(path.join(ROOT, file), 'utf8')
}

/**
 * 极简 YAML 读取：只找 patch 层的 insert 行，不引 YAML 依赖。
 * @param {string} text
 * @returns {{ids: string[], names: string[]}}
 */
function scanPatch(text) {
  const ids = []
  const names = []
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i += 1) {
    const id = /^\s*-\s*id:\s*(\S+)\s*$/.exec(lines[i])
    if (id) ids.push(id[1])
    const name = /^\s*name:\s*['"]?([^'"#\s]+)['"]?\s*(?:#.*)?$/.exec(lines[i])
    if (name) names.push(name[1])
  }
  return { ids, names }
}

const pkg = JSON.parse(read('package.json'))
console.log(`\n契约自检 · ${pkg.name}@${pkg.version}\n`)

console.log('包结构')
expect(typeof pkg.name === 'string' && /^[a-z0-9][a-z0-9._-]*$/.test(pkg.name), 'package.json name 合法', pkg.name)
expect(typeof pkg.description === 'string' && pkg.description.length > 10, 'description 有内容')
expect(typeof pkg.license === 'string' && pkg.license !== '', '声明了 license', pkg.license)
expect(exists(pkg.main), `main 指向的文件存在（${pkg.main}）`)
expect(exists('README.md'), 'README.md 存在')
expect(exists('LICENSE'), 'LICENSE 存在')
expect(Array.isArray(pkg.files) && pkg.files.length > 0, 'files 白名单存在（发布时不会漏文件）')

const requiredExports = ['.', './client']
if (requiredExports.every((key) => typeof pkg.exports?.[key] === 'string')) {
  for (const key of requiredExports) {
    expect(exists(pkg.exports[key]), `exports["${key}"] 指向的文件存在`)
  }
} else {
  expect(false, 'exports 同时导出 "." 与 "./client"')
}
if (typeof pkg.exports?.['./icon'] === 'string') {
  expect(exists(pkg.exports['./icon']), 'exports["./icon"] 指向的文件存在')
} else {
  warn('没有导出 ./icon：市场卡片与设置页会少一个图标')
}

console.log('\nbundle 与配置')
expect(typeof pkg.dsh?.bundle?.patch === 'string', 'dsh.bundle.patch 已声明')
if (typeof pkg.dsh?.bundle?.patch === 'string') {
  const patchFile = pkg.dsh.bundle.patch.replace(/^\.\//, '')
  expect(exists(patchFile), `patch 文件存在（${patchFile}）`)
  if (exists(patchFile)) {
    const { ids, names } = scanPatch(read(patchFile))
    expect(ids.includes(pkg.name), 'patch 里有一行的 id 等于包名', ids.join(', '))
    expect(names.includes(pkg.name), 'patch 里有一行的 name 等于包名', names.join(', '))
  }
}
expect(pkg.dsh?.manifestVersion === 1, 'dsh.manifestVersion = 1')

console.log('\n浏览器半边')
expect(pkg.dsh?.client?.platform === 'web', 'dsh.client.platform = web')
const clientInject = pkg.dsh?.client?.inject
expect(Array.isArray(clientInject), 'dsh.client.inject 是数组')
if (Array.isArray(clientInject)) {
  expect(clientInject.every((item) => typeof item === 'string'), 'dsh.client.inject 全是字符串（必须是静态数组）')
  for (const item of clientInject) {
    if (!item.startsWith('@deepseek-ai/dsh-client-')) {
      warn(`client.inject 里有一项不是 @deepseek-ai/dsh-client-*：${item}`)
    }
  }
}
if (typeof pkg.exports?.['./client'] === 'string' && exists(pkg.exports['./client'])) {
  const client = read(pkg.exports['./client'])
  expect(client.includes('__ModuleLoader__'), 'client bundle 走 window.__ModuleLoader__ 装配')
  expect(client.includes(`id: '${pkg.name}'`) || client.includes(`id: "${pkg.name}"`), 'client bundle 的 id 等于包名')
  const requireMatches = [...client.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map((match) => match[1])
  const external = requireMatches.filter((specifier) => specifier !== 'react')
  expect(external.length === 0, 'client bundle 除 react 外不 require 任何模块', external.join(', '))
}

console.log('\n交付元数据')
for (const locale of ['zh', 'en']) {
  const file = `locale/${locale}.json`
  if (!exists(file)) {
    expect(false, `${file} 存在`)
    continue
  }
  let dictionary
  try {
    dictionary = JSON.parse(read(file))
  } catch (error) {
    expect(false, `${file} 是合法 JSON`, String(error))
    continue
  }
  expect(typeof dictionary.meta?.title === 'string' && dictionary.meta.title !== '', `${file} 有 meta.title`)
  expect(
    typeof dictionary.meta?.description === 'string' && dictionary.meta.description.length > 5,
    `${file} 有 meta.description`,
  )
}
if (typeof pkg.exports?.['./icon'] === 'string') {
  const iconFile = pkg.exports['./icon'].replace(/^\.\//, '')
  if (exists(iconFile)) {
    const size = statSync(path.join(ROOT, iconFile)).size
    expect(size > 0 && size <= 256 * 1024, `icon 体积 ≤ 256 KiB（${size} B）`)
  }
}

console.log('\n依赖纪律')
// 唯一允许的运行时依赖：schemastery。它是纯校验库、不注册任何服务，
// 而 profile 的 pnpm 配置是 autoInstallPeers: false —— 放 peer 在干净 profile 里根本装不上。
// 除它以外出现任何 dependencies 都要人工复核（服务类包必须走 peer + 宿主实例）。
const ALLOWED_DEPS = new Set(['@deepseek-ai/schemastery'])
const runtimeDeps = Object.keys(pkg.dependencies ?? {})
const unexpected = runtimeDeps.filter((dep) => !ALLOWED_DEPS.has(dep))
expect(unexpected.length === 0, '运行时依赖只有 schemastery（或没有）', unexpected.join(', ') || undefined)
if (runtimeDeps.length > 0) {
  warn(`运行时依赖：${runtimeDeps.join(', ')}（纯校验库，可随包安装）`)
}
const peers = Object.keys(pkg.peerDependencies ?? {})
for (const peer of peers) {
  if (!peer.startsWith('@deepseek-ai/')) warn(`peerDependencies 里有非 @deepseek-ai 包：${peer}`)
  expect(peer.startsWith('@deepseek-ai/dsh-'), `peer 只用于宿主提供的服务包（${peer}）`)
}
if (peers.length > 0) {
  expect(peers.length <= 2, 'peer 依赖保持精简（共享包不重复安装）', peers.join(', '))
}
if (typeof pkg.engines?.node === 'string') {
  expect(/22\.19|24/.test(pkg.engines.node), 'engines.node 覆盖 DSH 支持的 Node 版本', pkg.engines.node)
} else {
  warn('没有声明 engines.node')
}

console.log('\n代码可解析')
const jsFiles = ['lib/index.js', 'lib/client.js']
for (const file of jsFiles) {
  if (!exists(file)) {
    expect(false, `${file} 存在`)
    continue
  }
  try {
    execFileSync(process.execPath, ['--check', path.join(ROOT, file)], { stdio: 'pipe' })
    expect(true, `${file} 通过 node --check`)
  } catch (error) {
    expect(false, `${file} 通过 node --check`, String(error?.stderr ?? error))
  }
}

console.log('\n导出契约')
const entry = await import(pathToFileURL(path.join(ROOT, pkg.main)).href)
expect(entry.name === pkg.name, `插件导出 name 等于包名（${entry.name}）`)
expect(typeof entry.apply === 'function', '插件导出 apply 函数')
expect(Array.isArray(entry.inject), '插件导出 inject 数组')
if (Array.isArray(entry.inject)) {
  expect(entry.inject.includes('webServer'), 'inject 里包含 webServer')
}
if (typeof entry.version === 'string') {
  expect(entry.version === pkg.version, `导出 version 与 package.json 一致（${entry.version}）`)
}

console.log('')
if (warnings.length > 0) {
  console.log(`\u001b[33m${warnings.length} 条提醒\u001b[0m`)
}
if (failures.length > 0) {
  console.error(`\u001b[31m${failures.length} 项未通过\u001b[0m\n`)
  process.exitCode = 1
} else {
  console.log('\u001b[32m全部通过\u001b[0m')
}
