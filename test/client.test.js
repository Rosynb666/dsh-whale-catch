import { test } from 'node:test'
import assert from 'node:assert/strict'

/**
 * 让 client bundle 以为自己在浏览器里跑：
 * 它一被 import 就会调 window.__ModuleLoader__.load()。
 * @type {any}
 */
let registered = null
globalThis.window = {
  __ModuleLoader__: {
    load(definition) {
      registered = definition
    },
  },
}

await import('../lib/client.js')

test('bundle 用包 id 注册，并能被 loader 取到 factory', () => {
  assert.ok(registered, '没有调用 __ModuleLoader__.load')
  assert.equal(registered.id, 'dsh-whale-catch')
  assert.equal(typeof registered.factory, 'function')
})

/**
 * 极简 React 替身：本测试只验证注册逻辑，不渲染组件树。
 */
const FakeReact = {
  createElement() {
    return {}
  },
  useState() {
    return [undefined, () => {}]
  },
  useEffect() {},
  useRef() {
    return { current: true }
  },
  useCallback(fn) {
    return fn
  },
}

test('导出 inject / apply，并正确注册 tab 类型与 pane 主体', () => {
  const module = registered.factory((specifier) => {
    assert.equal(specifier, 'react')
    return FakeReact
  })

  assert.deepEqual(module.inject, ['slots', 'locale', 'sidebarRightTabs'])
  assert.equal(typeof module.apply, 'function')

  /** @type {any[]} */
  const events = []
  const ctx = {
    effect(factory) {
      const disposer = factory()
      return typeof disposer === 'function' ? disposer : () => {}
    },
    locale: {
      register(namespace, dictionaries) {
        events.push({ kind: 'locale', namespace, dictionaries })
        return () => {}
      },
      bind() {
        return (key) => key
      },
    },
    sidebarRightTabs: {
      register(definition) {
        events.push({ kind: 'tab', definition })
        return () => {}
      },
    },
    slots: {
      inject(name, factory) {
        events.push({ kind: 'inject', name })
        return factory()
      },
      register(definition, component) {
        events.push({ kind: 'slot', definition, component })
        return () => {}
      },
    },
  }

  module.apply(ctx)

  const locale = events.find((event) => event.kind === 'locale')
  assert.equal(locale.namespace, 'whale-catch')
  assert.deepEqual(
    Object.keys(locale.dictionaries.zh).sort(),
    Object.keys(locale.dictionaries.en).sort(),
    '中英文字典的键集必须完全一致',
  )
  assert.ok(Object.keys(locale.dictionaries.zh).length > 20)

  const tab = events.find((event) => event.kind === 'tab')
  assert.equal(tab.definition.id, 'whale-catch')
  assert.equal(tab.definition.kind, 'whale-catch')
  assert.equal(typeof tab.definition.title, 'function')
  assert.equal(typeof tab.definition.title(), 'string')
  assert.equal(tab.definition.guide.length, 1)
  assert.equal(typeof tab.definition.guide[0].description(), 'string')

  const inject = events.find((event) => event.kind === 'inject')
  assert.equal(inject.name, 'sidebar.right.pane.tab')

  const slot = events.find((event) => event.kind === 'slot')
  assert.equal(slot.definition.key, 'whale-catch')
  assert.equal(slot.definition.locale, 'whale-catch')
  assert.equal(typeof slot.component, 'function')
})

test('预览不再用 window.open（Desktop 会 deny 所有新窗口）', async () => {
  const { readFileSync } = await import('node:fs')
  const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  assert.equal(source.includes('window.open('), false, 'window.open 在 Desktop 会被静默拒绝，预览必须走 Document Preview')
  assert.ok(source.includes('openResource('), '预览应调用 sidebarRight.openResource')
})
