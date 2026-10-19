/**
 * dsh-whale-catch · Client half
 *
 * 浏览器侧只做两件事：
 *   1. 往右侧栏注册一个 tab 类型 `whale-catch`（带引导页入口），
 *   2. 在 `sidebar.right.pane.tab` 里渲染鱼篓面板。
 *
 * 数据全部来自 Host 的 `/whale-catch/api/`，这里不读会话日志、不猜文件路径，
 * 面板本身只负责"勾选 → 打包 / 归档 / 预览"。
 *
 * 工程约束（对齐官方 UI 插件红线）：
 *   · 纯 JS，零构建、零运行时依赖，只 `require('react')`；
 *   · 不 require 任何 Harness Client 包，样式只用 --dsw-alias-* / --dsw-static-* 主题 token；
 *   · 不碰 DOM 之外的东西，注册全部走 ctx.effect，卸载即释放。
 */
;(function () {
  'use strict'

  var loader = typeof window !== 'undefined' ? window.__ModuleLoader__ : undefined
  if (!loader || typeof loader.load !== 'function') return

  loader.load({
    id: 'dsh-whale-catch',
    factory: function (require) {
      var module = { exports: {} }
      var exports = module.exports
      Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

      var React = require('react')
      var h = React.createElement

      /** 词典命名空间与 tab kind 共用一个 id，便于对账。 */
      var NS = 'whale-catch'
      var KIND = 'whale-catch'
      var API = '/whale-catch/api/'

      /** 分类顺序与 Host 的 kinds.js 保持一致。 */
      var KINDS = ['doc', 'sheet', 'slide', 'image', 'code', 'archive', 'media', 'other']
      var KIND_EMOJI = {
        doc: '📄', sheet: '📊', slide: '📽️', image: '🖼️',
        code: '⌨️', archive: '📦', media: '🎬', other: '🐚',
      }

      var zh = {
        'tab.title': '鱼篓',
        'tab.guide': '打开深海鱼篓',
        'tab.guideDesc': '这次会话产出的文件都收在这里：预览、打包 zip、归档',
        'header.count': '{count} 条鱼',
        'header.size': '{size}',
        'refresh': '刷新',
        'refreshing': '收网中…',
        'all': '全部',
        'kind.doc': '文档',
        'kind.sheet': '表格',
        'kind.slide': '演示',
        'kind.image': '图片',
        'kind.code': '代码',
        'kind.archive': '压缩',
        'kind.media': '音视频',
        'kind.other': '其他',
        'empty.title': '鱼篓还是空的',
        'empty.hint': '这次会话还没产出文件。让我去干点活，文件会自己游进来。',
        'empty.filter': '这个类别下还没有鱼',
        'presented': '交付',
        'missing': '已删除',
        'open': '预览',
        'copy': '复制路径',
        'copied': '路径已复制',
        'select': '选择',
        'selected': '已选 {count} 项',
        'zip': '打包 zip',
        'zipAll': '全部打包',
        'zipEmpty': '先勾选几个文件',
        'archive': '归档',
        'archived': '已归档 {count} 个文件到 {dir}',
        'failed': '操作失败：{message}',
        'loadFailed': '读取鱼篓失败：{message}',
        'needSession': '会话还没就绪，稍等片刻',
        'noCwd': '无法确定会话工作目录：请把会话切到前台再试',
        'truncated': '目录太大，只收了前 {count} 个文件',
        'selectAll': '全选',
        'clear': '清空',
        'scanAt': '扫描于 {time}',
        'time.justNow': '刚刚',
        'time.minutesAgo': '{n} 分钟前',
      }

      var en = {
        'tab.title': 'Catch',
        'tab.guide': 'Open Whale Catch',
        'tab.guideDesc': 'Every file this session produced, ready to preview, zip or archive',
        'header.count': '{count} files',
        'header.size': '{size}',
        'refresh': 'Refresh',
        'refreshing': 'Hauling…',
        'all': 'All',
        'kind.doc': 'Docs',
        'kind.sheet': 'Sheets',
        'kind.slide': 'Slides',
        'kind.image': 'Images',
        'kind.code': 'Code',
        'kind.archive': 'Archives',
        'kind.media': 'Media',
        'kind.other': 'Other',
        'empty.title': 'The basket is empty',
        'empty.hint': 'Nothing produced yet. Let me get to work — files will swim in on their own.',
        'empty.filter': 'No fish in this category yet',
        'presented': 'Delivered',
        'missing': 'Missing',
        'open': 'Open',
        'copy': 'Copy path',
        'copied': 'Path copied',
        'select': 'Select',
        'selected': '{count} selected',
        'zip': 'Zip selected',
        'zipAll': 'Zip all',
        'zipEmpty': 'Select some files first',
        'archive': 'Archive',
        'archived': 'Archived {count} files to {dir}',
        'failed': 'Failed: {message}',
        'loadFailed': 'Could not load the basket: {message}',
        'needSession': 'The session is not ready yet',
        'noCwd': 'Cannot resolve the session working directory. Bring the session to the front and retry.',
        'truncated': 'Large directory — only the first {count} files were collected',
        'selectAll': 'Select all',
        'clear': 'Clear',
        'scanAt': 'scanned {time}',
        'time.justNow': 'just now',
        'time.minutesAgo': '{n} min ago',
      }

      /**
       * 极简插值：把 {name} 换成 values.name。没有翻译就原样返回 key，
       * 免得界面出现 undefined。
       */
      function format(template, values) {
        return String(template).replace(/\{(\w+)\}/g, function (match, key) {
          return values && values[key] !== undefined ? String(values[key]) : match
        })
      }

      function formatBytes(bytes) {
        var n = Number(bytes) || 0
        if (n < 1024) return n + ' B'
        var units = ['KB', 'MB', 'GB', 'TB']
        var value = n / 1024
        var index = 0
        while (value >= 1024 && index < units.length - 1) {
          value /= 1024
          index += 1
        }
        return (value >= 10 ? value.toFixed(0) : value.toFixed(1)) + ' ' + units[index]
      }

      /** 相对时间：一分钟内说"刚刚"，一小时内说"N 分钟前"，更早显示钟点。 */
      function formatTime(ms, t) {
        var n = Number(ms) || 0
        if (n <= 0) return ''
        var diff = Date.now() - n
        if (diff < 60 * 1000) return t('time.justNow')
        if (diff < 60 * 60 * 1000) return format(t('time.minutesAgo'), { n: Math.floor(diff / 60000) })
        var date = new Date(n)
        var pad = function (v) { return String(v).padStart(2, '0') }
        return pad(date.getHours()) + ':' + pad(date.getMinutes())
      }

      /* ─────────────────────────── 主题 token 速记 ─────────────────────────── */

      var C = {
        text: 'var(--dsw-alias-label-primary, inherit)',
        sub: 'var(--dsw-alias-label-secondary, #8a8f98)',
        faint: 'var(--dsw-alias-label-tertiary, #9aa0a6)',
        border: 'var(--dsw-alias-border-l4, rgba(128,128,128,0.28))',
        bg: 'var(--dsw-alias-bg-layer-2, rgba(127,127,127,0.07))',
        accent: 'var(--dsw-static-deepseek-500, #4176e6)',
      }

      function buttonStyle(primary, disabled) {
        return {
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '4px',
          padding: '4px 10px',
          borderRadius: 'var(--dsw-radius-sm, 8px)',
          border: primary ? '1px solid transparent' : '1px solid ' + C.border,
          background: primary ? C.accent : 'transparent',
          color: primary ? '#fff' : 'inherit',
          font: 'inherit',
          fontSize: '12px',
          lineHeight: '18px',
          cursor: disabled ? 'default' : 'pointer',
          opacity: disabled ? 0.45 : 1,
          whiteSpace: 'nowrap',
        }
      }

      function chipStyle(active) {
        return {
          padding: '2px 9px',
          borderRadius: '999px',
          border: '1px solid ' + (active ? 'transparent' : C.border),
          background: active ? C.accent : 'transparent',
          color: active ? '#fff' : C.sub,
          font: 'inherit',
          fontSize: '11px',
          lineHeight: '18px',
          cursor: 'pointer',
          whiteSpace: 'nowrap',
        }
      }

      /* ─────────────────────────────── 面板 ─────────────────────────────── */

      function Panel(props) {
        var t = typeof props.t === 'function' ? props.t : function (key) { return key }
        var sessionId = props.sessionId

        // useSession 是 session 作用域 slot 的标准 prop；这里只借它读 cwd，
        // 读不到就让 Host 自己去 active agent 里找（Host 那边是权威来源）。
        var useSession = typeof props.useSession === 'function' ? props.useSession : null
        var cwd = ''
        if (useSession !== null) {
          var value = useSession(function (snapshot) {
            return snapshot && typeof snapshot.cwd === 'string' ? snapshot.cwd : ''
          })
          if (typeof value === 'string') cwd = value
        }

        var dataState = React.useState(null)
        var data = dataState[0]
        var setData = dataState[1]

        var errorState = React.useState('')
        var error = errorState[0]
        var setError = errorState[1]

        var loadingState = React.useState(true)
        var loading = loadingState[0]
        var setLoading = loadingState[1]

        var busyState = React.useState('')
        var busy = busyState[0]
        var setBusy = busyState[1]

        var filterState = React.useState('all')
        var filter = filterState[0]
        var setFilter = filterState[1]

        var selectedState = React.useState(function () { return {} })
        var selected = selectedState[0]
        var setSelected = selectedState[1]

        var noticeState = React.useState('')
        var notice = noticeState[0]
        var setNotice = noticeState[1]

        var mounted = React.useRef(true)
        React.useEffect(function () {
          mounted.current = true
          return function () { mounted.current = false }
        }, [])

        var load = React.useCallback(function (force) {
          if (typeof sessionId !== 'string' || sessionId === '') {
            setError(t('needSession'))
            setLoading(false)
            return
          }
          var query = '?session=' + encodeURIComponent(sessionId) + (cwd ? '&cwd=' + encodeURIComponent(cwd) : '')
          var request = force
            ? fetch(API + 'refresh', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ session: sessionId, cwd: cwd || undefined }),
            })
            : fetch(API + 'basket' + query)
          if (force) setBusy('refresh')
          request
            .then(function (response) {
              return response.json().then(function (body) { return { response: response, body: body } })
            })
            .then(function (result) {
              if (!mounted.current) return
              if (!result.body || result.body.ok !== true) {
                var message = result.body && result.body.error ? result.body.error.message : 'HTTP ' + result.response.status
                throw new Error(message)
              }
              setData(result.body.value)
              setError('')
            })
            .catch(function (cause) {
              if (!mounted.current) return
              setError(t('loadFailed', { message: String((cause && cause.message) || cause) }))
            })
            .finally(function () {
              if (!mounted.current) return
              setLoading(false)
              setBusy('')
            })
        }, [sessionId, cwd, t])

        React.useEffect(function () {
          load(false)
        }, [load])

        // 每 5 秒静默刷新一次；页面不可见时跳过，别让后台标签页空转。
        React.useEffect(function () {
          var timer = setInterval(function () {
            if (typeof document !== 'undefined' && document.hidden) return
            load(false)
          }, 5000)
          return function () { clearInterval(timer) }
        }, [load])

        React.useEffect(function () {
          if (notice === '') return undefined
          var timer = setTimeout(function () { setNotice('') }, 4000)
          return function () { clearTimeout(timer) }
        }, [notice])

        var files = data && Array.isArray(data.files) ? data.files : []
        var counts = {}
        files.forEach(function (file) {
          if (file.missing) return
          counts[file.kind] = (counts[file.kind] || 0) + 1
        })
        var visible = files.filter(function (file) {
          return filter === 'all' || file.kind === filter
        })
        var chosen = visible.filter(function (file) { return selected[file.path] === true && !file.missing })
        var chosenAll = files.filter(function (file) { return selected[file.path] === true && !file.missing })
        var totals = data && data.totals ? data.totals : { count: 0, bytes: 0 }

        function toggle(file) {
          if (file.missing) return
          setSelected(function (previous) {
            var next = Object.assign({}, previous)
            if (next[file.path]) delete next[file.path]
            else next[file.path] = true
            return next
          })
        }

        function toggleAll() {
          if (chosen.length === visible.filter(function (f) { return !f.missing }).length && chosen.length > 0) {
            setSelected({})
            return
          }
          var next = {}
          visible.forEach(function (file) { if (!file.missing) next[file.path] = true })
          setSelected(next)
        }

        function post(path, body) {
          return fetch(API + path, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          }).then(function (response) {
            return response.json().then(function (payload) {
              if (!payload.ok) throw new Error((payload.error && payload.error.message) || 'HTTP ' + response.status)
              return payload.value
            })
          })
        }

        function downloadZip(paths) {
          if (paths.length === 0) {
            setNotice(t('zipEmpty'))
            return
          }
          setBusy('zip')
          fetch(API + 'zip', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ session: sessionId, paths: paths, cwd: cwd || undefined }),
          })
            .then(function (response) {
              if (!response.ok) {
                return response.json().then(function (payload) {
                  throw new Error((payload.error && payload.error.message) || 'HTTP ' + response.status)
                })
              }
              var disposition = response.headers.get('content-disposition') || ''
              var match = /filename\*=UTF-8''([^;]+)/i.exec(disposition)
              var name = match ? decodeURIComponent(match[1]) : 'whale-catch.zip'
              return response.blob().then(function (blob) { return { blob: blob, name: name } })
            })
            .then(function (file) {
              var url = URL.createObjectURL(file.blob)
              var anchor = document.createElement('a')
              anchor.href = url
              anchor.download = file.name
              document.body.appendChild(anchor)
              anchor.click()
              document.body.removeChild(anchor)
              setTimeout(function () { URL.revokeObjectURL(url) }, 1000)
            })
            .catch(function (cause) {
              setNotice(t('failed', { message: String((cause && cause.message) || cause) }))
            })
            .finally(function () { setBusy('') })
        }

        function archive(paths) {
          if (paths.length === 0) {
            setNotice(t('zipEmpty'))
            return
          }
          setBusy('archive')
          post('archive', { session: sessionId, paths: paths, cwd: cwd || undefined })
            .then(function (result) {
              setNotice(t('archived', { count: result.copied.length, dir: result.dir }))
            })
            .catch(function (cause) {
              setNotice(t('failed', { message: String((cause && cause.message) || cause) }))
            })
            .finally(function () { setBusy('') })
        }

        function openFile(file) {
          var url = API + 'file?session=' + encodeURIComponent(sessionId) + '&path=' + encodeURIComponent(file.path)
          if (typeof window !== 'undefined') window.open(url, '_blank', 'noopener,noreferrer')
        }

        function copyPath(file) {
          var text = file.path
          if (navigator && navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(function () { setNotice(t('copied')) }, function () { setNotice(text) })
          } else {
            setNotice(text)
          }
        }

        /* ── 渲染 ── */

        var header = h('div', {
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '10px 12px 8px',
            borderBottom: '1px solid ' + C.border,
          },
        },
        h('span', { style: { fontSize: '15px', lineHeight: '20px' } }, '🐋'),
        h('div', { style: { display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 } },
          h('span', {
            style: { fontSize: '13px', fontWeight: 600, color: C.text, lineHeight: '18px' },
          }, t('tab.title')),
          h('span', {
            style: { fontSize: '11px', color: C.sub, lineHeight: '16px' },
          }, format(t('header.count'), { count: totals.count }) + ' · ' + formatBytes(totals.bytes)),
        ),
        h('button', {
          type: 'button',
          onClick: function () { load(true) },
          disabled: busy !== '',
          title: t('refresh'),
          style: buttonStyle(false, busy !== ''),
        }, busy === 'refresh' ? t('refreshing') : t('refresh')))

        var chips = []
        if (files.length > 0) {
          var totalVisible = files.filter(function (file) { return !file.missing }).length
          chips.push(h('button', {
            key: 'all',
            type: 'button',
            onClick: function () { setFilter('all') },
            style: chipStyle(filter === 'all'),
          }, t('all') + ' ' + totalVisible))
          KINDS.forEach(function (kind) {
            var count = counts[kind] || 0
            if (count === 0) return
            chips.push(h('button', {
              key: kind,
              type: 'button',
              onClick: function () { setFilter(kind) },
              style: chipStyle(filter === kind),
            }, KIND_EMOJI[kind] + ' ' + t('kind.' + kind) + ' ' + count))
          })
        }

        var rows = visible.map(function (file) {
          var isSelected = selected[file.path] === true
          var meta = []
          meta.push(formatBytes(file.size))
          if (file.mtimeMs > 0) meta.push(formatTime(file.mtimeMs, t))
          if (Array.isArray(file.sources) && file.sources.indexOf('presented') >= 0) meta.push(t('presented'))
          if (file.missing) meta.push(t('missing'))

          return h('div', {
            key: file.path,
            onClick: function () { toggle(file) },
            style: {
              display: 'flex',
              alignItems: 'flex-start',
              gap: '8px',
              padding: '6px 12px',
              cursor: file.missing ? 'default' : 'pointer',
              background: isSelected ? 'var(--dsw-alias-bg-module-platform, rgba(65,118,230,0.10))' : 'transparent',
              borderBottom: '1px solid var(--dsw-alias-border-l5, rgba(128,128,128,0.12))',
              opacity: file.missing ? 0.5 : 1,
            },
          },
          h('input', {
            type: 'checkbox',
            checked: isSelected,
            disabled: file.missing,
            readOnly: true,
            style: { margin: '2px 0 0', width: '14px', height: '14px', accentColor: C.accent, cursor: 'pointer', flex: 'none' },
          }),
          h('div', { style: { minWidth: 0, flex: 1 } },
            h('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 } },
              h('span', { style: { fontSize: '13px', flex: 'none' } }, KIND_EMOJI[file.kind] || KIND_EMOJI.other),
              h('span', {
                title: file.name,
                style: {
                  fontSize: '12.5px',
                  color: C.text,
                  lineHeight: '18px',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  flex: 1,
                  minWidth: 0,
                  textDecoration: file.missing ? 'line-through' : 'none',
                },
              }, file.name),
            ),
            h('div', {
              title: file.rel + (file.description ? '\n' + file.description : ''),
              style: {
                fontSize: '11px',
                color: C.sub,
                lineHeight: '16px',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                marginTop: '1px',
              },
            }, (file.description ? file.description + ' · ' : '') + file.rel),
            h('div', {
              style: { fontSize: '10.5px', color: C.faint, lineHeight: '15px', marginTop: '1px' },
            }, meta.join(' · ')),
          ),
          h('div', { style: { display: 'flex', flexDirection: 'column', gap: '3px', flex: 'none' } },
            h('button', {
              type: 'button',
              title: t('open'),
              onClick: function (event) { event.stopPropagation(); openFile(file) },
              disabled: file.missing,
              style: Object.assign(buttonStyle(false, file.missing), { fontSize: '11px', padding: '2px 8px' }),
            }, t('open')),
            h('button', {
              type: 'button',
              title: t('copy'),
              onClick: function (event) { event.stopPropagation(); copyPath(file) },
              style: Object.assign(buttonStyle(false, false), { fontSize: '11px', padding: '2px 8px' }),
            }, '⧉'),
          ))
        })

        var body
        if (loading && data === null) {
          body = h('div', { style: { padding: '24px 12px', color: C.sub, fontSize: '12px', textAlign: 'center' } }, t('refreshing'))
        } else if (error !== '') {
          body = h('div', { style: { padding: '16px 12px' } },
            h('div', { style: { color: 'var(--dsw-alias-label-danger, #d9534f)', fontSize: '12px', lineHeight: '18px' } }, error),
            h('div', { style: { height: '8px' } }),
            h('button', { type: 'button', onClick: function () { load(true) }, style: buttonStyle(false, false) }, t('refresh')))
        } else if (files.length === 0) {
          body = h('div', { style: { padding: '28px 16px', textAlign: 'center' } },
            h('div', { style: { fontSize: '28px', lineHeight: '36px' } }, '🧺'),
            h('div', { style: { fontSize: '13px', color: C.text, marginTop: '6px' } }, t('empty.title')),
            h('div', { style: { fontSize: '11.5px', color: C.sub, marginTop: '4px', lineHeight: '17px' } }, t('empty.hint')))
        } else if (visible.length === 0) {
          body = h('div', { style: { padding: '24px 12px', textAlign: 'center', color: C.sub, fontSize: '12px' } }, t('empty.filter'))
        } else {
          body = h('div', { style: { padding: '2px 12px 8px', display: 'flex', alignItems: 'center', gap: '8px' } },
            h('button', {
              type: 'button',
              onClick: toggleAll,
              style: buttonStyle(false, chosen.length === 0 && visible.length === 0),
            }, t('selectAll')),
            h('button', {
              type: 'button',
              onClick: function () { setSelected({}) },
              disabled: chosen.length === 0,
              style: buttonStyle(false, chosen.length === 0),
            }, t('clear')),
            data && data.truncated
              ? h('span', { style: { fontSize: '10.5px', color: C.faint } }, format(t('truncated'), { count: files.length }))
              : null)
        }

        var footer = null
        if (files.length > 0) {
          footer = h('div', {
            style: {
              borderTop: '1px solid ' + C.border,
              padding: '8px 12px',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
              background: 'var(--dsw-alias-bg-layer-2, rgba(127,127,127,0.04))',
            },
          },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
            h('span', { style: { fontSize: '11px', color: C.sub, flex: 1 } },
              format(t('selected'), { count: chosenAll.length })),
            h('button', {
              type: 'button',
              onClick: function () { archive(chosenAll.length ? chosenAll.map(function (f) { return f.path }) : files.filter(function (f) { return !f.missing }).map(function (f) { return f.path })) },
              disabled: busy !== '' || files.length === 0,
              style: buttonStyle(false, busy !== '' || files.length === 0),
            }, busy === 'archive' ? '…' : t('archive')),
            h('button', {
              type: 'button',
              onClick: function () { downloadZip(chosenAll.length ? chosenAll.map(function (f) { return f.path }) : files.filter(function (f) { return !f.missing }).map(function (f) { return f.path })) },
              disabled: busy !== '',
              style: buttonStyle(true, busy !== ''),
            }, busy === 'zip' ? '…' : (chosenAll.length ? t('zip') : t('zipAll')))),
          notice !== ''
            ? h('div', { style: { fontSize: '10.5px', color: C.sub, lineHeight: '15px', wordBreak: 'break-all' } }, notice)
            : null,
          data && data.scannedAt
            ? h('div', { style: { fontSize: '10px', color: C.faint } }, format(t('scanAt'), { time: formatTime(data.scannedAt, t) }))
            : null)
        }

        return h('div', {
          style: {
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            // 右侧栏只有两三百像素：根节点必须自己兜住宽度，
            // 否则一条不换行的中文文件名会把整栏顶宽、操作按钮被切掉。
            width: '100%',
            minWidth: 0,
            minHeight: 0,
            overflow: 'hidden',
            boxSizing: 'border-box',
            fontSize: '12px',
            color: C.text,
          },
        },
        header,
        chips.length ? h('div', {
          style: { display: 'flex', flexWrap: 'wrap', gap: '5px', padding: '8px 12px 4px' },
        }, chips) : null,
        body,
        rows.length
          ? h('div', { style: { flex: 1, minHeight: 0, overflowY: 'auto' } }, rows)
          : null,
        footer)
      }

      /** 引导页图标：鲸尾 + 篮子。 */
      function WhaleIcon(props) {
        var size = props && props.size ? props.size : 16
        return h('svg', {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.7,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        },
        h('path', { d: 'M4 9h13l-1.4 7.6a3 3 0 0 1-3 2.4H8.4a3 3 0 0 1-3-2.4L4 9z' }),
        h('path', { d: 'M3.2 9h14.6' }),
        h('path', { d: 'M12.5 8.6c1.6-3.4 5.7-3.6 7.4-.8-2 2.9-5.8 2.6-7.4.8z' }),
        h('path', { d: 'M19.9 7.8 21.6 6.4l.4 4.1-2.4-1.1z' }))
      }

      function apply(ctx) {
        ctx.effect(function () {
          return ctx.locale.register(NS, { zh: zh, en: en })
        }, 'dsh-whale-catch: dictionaries')

        ctx.effect(function () {
          var name = function () { return ctx.locale.bind(NS)('tab.title') }
          return ctx.sidebarRightTabs.register({
            id: KIND,
            kind: KIND,
            title: name,
            guide: [{
              id: KIND,
              order: 2400,
              title: function () { return ctx.locale.bind(NS)('tab.guide') },
              description: function () { return ctx.locale.bind(NS)('tab.guideDesc') },
              icon: WhaleIcon,
            }],
          })
        }, 'dsh-whale-catch: tab type')

        ctx.effect(function () {
          return ctx.slots.inject('sidebar.right.pane.tab', function () {
            return ctx.slots.register({
              name: 'sidebar.right.pane.tab',
              key: KIND,
              locale: NS,
            }, Panel)
          })
        }, 'dsh-whale-catch: pane body')
      }

      exports.name = 'dsh-whale-catch'
      exports.inject = ['slots', 'locale', 'sidebarRightTabs']
      exports.apply = apply
      return module.exports
    },
  })
})()
