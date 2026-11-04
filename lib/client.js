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
      /** 列表一次最多铺多少行；更大的鱼篓用「显示更多」分批渲染。 */
      var PAGE = 200
      /** 浏览器侧 ctx，apply 时赋好；预览按钮靠它取 sidebarRight 打开 Document Preview。 */
      var clientCtx = null

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
        'empty.search': '没有匹配的文件',
        'search': '搜索文件名、路径或描述',
        'presented': '交付',
        'missing': '已删除',
        'open': '预览',
        'previewUnavailable': '这个文件不在会话工作目录里，暂时不能预览；可以复制路径或归档',
        'previewFailed': '预览打不开；可以复制路径或归档',
        'copy': '复制路径',
        'copied': '路径已复制',
        'select': '选择',
        'selected': '已选 {count} 项',
        'zip': '打包 zip',
        'zipAll': '全部打包',
        'zipEmpty': '先勾选几个文件',
        'zipSkipped': '已跳过 {count} 个超过单文件上限的文件',
        'zipTooLarge': '选中的文件总量超过打包上限',
        'allTooLarge': '选中的文件都超过单文件上限',
        'fileGone': '文件已被删除或移动',
        'tooLargeFile': '文件超过单文件上限',
        'archive': '归档',
        'archived': '已归档 {count} 个文件到 {dir}',
        'archivePartial': '已归档 {count} 个，{failed} 个失败',
        'archiveFailed': '归档失败：{failed} 个文件没有复制成功',
        'archiveDirCwd': '归档目录不能与会话工作目录相同',
        'archivePruned': '清理了 {count} 个旧批次',
        'failed': '操作失败：{message}',
        'loadFailed': '读取鱼篓失败：{message}',
        'needSession': '会话还没就绪，稍等片刻',
        'noCwd': '无法确定会话工作目录：请把会话切到前台再试',
        'truncated': '目录太大，只收了前 {count} 个文件',
        'selectAll': '全选',
        'clear': '清空',
        'sort.aria': '排序',
        'sort.mtime': '最近修改',
        'sort.name': '名称',
        'sort.size': '体积',
        'sort.kind': '类型',
        'showMore': '显示更多（还有 {count} 条）',
        'scanAt': '扫描于 {time}',
        'time.justNow': '刚刚',
        'time.minutesAgo': '{n} 分钟前',
        'changed': '改动',
        'diff': '差异',
        'diff.loading': '读取差异…',
        'diff.binary': '二进制文件，没有可显示的行级差异',
        'diff.oversized': '文件超过内核的对比上限，没有可显示的内容',
        'diff.unavailable': '这条没有可读的差异（扫描或交付声明的文件没有前后快照）',
        'diff.timeout': '读取差异超时了，稍后重试',
        'diff.failed': '读差异失败：{message}',
        'diff.newFile': '新增文件',
        'diff.deletedFile': '已删除',
        'diff.coarse': '差异过大，按整文件替换显示',
        'diff.empty': '内容没有变化',
        'diff.trimmed': '差异太长，只显示前 {count} 行',
        'binary': '二进制',
        'oversizedFile': '过大',
        'group': '按轮分组',
        'group.turn': '第 {n} 轮',
        'group.unmarked': '没有轮次',
        'copyList': '复制清单',
        'copiedList': '清单已复制',
        'mode.current': '本次',
        'mode.history': '历史',
        'history.loading': '读取台账…',
        'receipt.generating': '正在生成回执…',
        'history.failed': '读取台账失败：{message}',
        'history.empty': '还没有归档记录',
        'history.emptyHint': '点「归档」之后，这里会留下可回看的批次',
        'history.files': '{count} 个文件',
        'history.receipt': '回执',
        'history.restore': '还原',
        'history.detail': '详情',
        'history.back': '返回列表',
        'history.compare': '对比当前',
        'history.legacy': '旧归档（无清单）',
        'preflight.title': '交付体检',
        'preflight.checking': '正在体检…',
        'preflight.clean': '没有发现问题，可以交付',
        'preflight.block': '必须处理',
        'preflight.warn': '建议确认',
        'preflight.info': '提示',
        'preflight.continue': '仍然继续',
        'preflight.cancel': '返回修改',
        'preflight.failed': '体检失败：{message}',
        'restore.title': '还原批次',
        'restore.mode.skip': '跳过已存在',
        'restore.mode.rename': '重命名新文件',
        'restore.mode.overwrite': '覆盖（先备份）',
        'restore.plan': '计划',
        'restore.confirm': '开始还原',
        'restore.cancel': '取消',
        'restore.done': '还原完成：{count} 个文件',
        'restore.failed': '还原失败：{message}',
        'restore.empty': '这个批次没有可还原的文件',
        'delivered': '已交付',
        'delivery.mark': '标记已交付',
        'delivery.unmark': '取消已交付',
        'delivery.progress': '已交付 {done} / {total}',
        'delivery.note': '备注',
        'version.label': '查看轮次',
        'search.content': '内容',
        'search.contentPlaceholder': '搜索正文，回车开始',
        'search.none': '没有命中',
        'search.scanned': '已搜 {count} 个文件',
        'search.truncated': '达到预算上限，结果可能不全',
        'diff.archiveLoading': '正在读取归档版本…',
        'diff.archiveLabel': '与 {run} 的归档版对比',
        'error.noRun': '这个批次不在归档里',
        'error.noArchiveCopy': '这个文件还没有归档版本',
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
        'empty.search': 'No matching files',
        'search': 'Search name, path or description',
        'presented': 'Delivered',
        'missing': 'Missing',
        'open': 'Open',
        'previewUnavailable': 'This file is outside the session working directory, so it cannot be previewed; copy its path or archive it instead',
        'previewFailed': 'Preview could not open; copy the path or archive the file instead',
        'copy': 'Copy path',
        'copied': 'Path copied',
        'select': 'Select',
        'selected': '{count} selected',
        'zip': 'Zip selected',
        'zipAll': 'Zip all',
        'zipEmpty': 'Select some files first',
        'zipSkipped': 'Skipped {count} file(s) over the per-file size limit',
        'zipTooLarge': 'The selected files exceed the total zip size limit',
        'allTooLarge': 'Every selected file exceeds the per-file size limit',
        'fileGone': 'The file was deleted or moved',
        'tooLargeFile': 'The file exceeds the per-file size limit',
        'archive': 'Archive',
        'archived': 'Archived {count} files to {dir}',
        'archivePartial': 'Archived {count} file(s), {failed} failed',
        'archiveFailed': 'Archive failed for {failed} file(s)',
        'archiveDirCwd': 'The archive directory cannot be the session working directory',
        'archivePruned': 'pruned {count} old batch(es)',
        'failed': 'Failed: {message}',
        'loadFailed': 'Could not load the basket: {message}',
        'needSession': 'The session is not ready yet',
        'noCwd': 'Cannot resolve the session working directory. Bring the session to the front and retry.',
        'truncated': 'Large directory — only the first {count} files were collected',
        'selectAll': 'Select all',
        'clear': 'Clear',
        'sort.aria': 'Sort by',
        'sort.mtime': 'Modified',
        'sort.name': 'Name',
        'sort.size': 'Size',
        'sort.kind': 'Kind',
        'showMore': 'Show more ({count} left)',
        'scanAt': 'scanned {time}',
        'time.justNow': 'just now',
        'time.minutesAgo': '{n} min ago',
        'changed': 'Changed',
        'diff': 'Diff',
        'diff.loading': 'Loading diff…',
        'diff.binary': 'Binary file — no line diff to show',
        'diff.oversized': 'File exceeds the kernel diff limit',
        'diff.unavailable': 'No readable diff for this entry (scans and present declarations have no before/after snapshot)',
        'diff.timeout': 'Timed out while reading the diff — try again',
        'diff.failed': 'Could not load the diff: {message}',
        'diff.newFile': 'New file',
        'diff.deletedFile': 'Deleted',
        'diff.coarse': 'Diff too large — shown as a whole-file replacement',
        'diff.empty': 'No content change',
        'diff.trimmed': 'Diff truncated to the first {count} lines',
        'binary': 'Binary',
        'oversizedFile': 'Too large',
        'group': 'Group by turn',
        'group.turn': 'Turn {n}',
        'group.unmarked': 'No turn',
        'copyList': 'Copy list',
        'copiedList': 'List copied',
        'mode.current': 'This session',
        'mode.history': 'History',
        'history.loading': 'Reading ledger…',
        'receipt.generating': 'Generating receipt…',
        'history.failed': 'Could not read the ledger: {message}',
        'history.empty': 'No archived batches yet',
        'history.emptyHint': 'Archive once and the batch will stay here',
        'history.files': '{count} files',
        'history.receipt': 'Receipt',
        'history.restore': 'Restore',
        'history.detail': 'Details',
        'history.back': 'Back to list',
        'history.compare': 'Compare current',
        'history.legacy': 'Legacy batch (no manifest)',
        'preflight.title': 'Delivery check',
        'preflight.checking': 'Checking…',
        'preflight.clean': 'No issues — ready to deliver',
        'preflight.block': 'Must fix',
        'preflight.warn': 'Review',
        'preflight.info': 'Info',
        'preflight.continue': 'Continue anyway',
        'preflight.cancel': 'Go back',
        'preflight.failed': 'Check failed: {message}',
        'restore.title': 'Restore batch',
        'restore.mode.skip': 'Skip existing',
        'restore.mode.rename': 'Rename new files',
        'restore.mode.overwrite': 'Overwrite (backup first)',
        'restore.plan': 'Plan',
        'restore.confirm': 'Restore',
        'restore.cancel': 'Cancel',
        'restore.done': 'Restored {count} files',
        'restore.failed': 'Restore failed: {message}',
        'restore.empty': 'Nothing to restore in this batch',
        'delivered': 'Delivered',
        'delivery.mark': 'Mark delivered',
        'delivery.unmark': 'Unmark delivered',
        'delivery.progress': '{done} / {total} delivered',
        'delivery.note': 'Note',
        'version.label': 'Pick turn',
        'search.content': 'Content',
        'search.contentPlaceholder': 'Search file contents, press Enter',
        'search.none': 'No matches',
        'search.scanned': 'Searched {count} files',
        'search.truncated': 'Budget reached — results may be incomplete',
        'diff.archiveLoading': 'Reading archived version…',
        'diff.archiveLabel': 'Against the {run} archive',
        'error.noRun': 'That batch is not in the archive',
        'error.noArchiveCopy': 'No archived version for this file',
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

      /** 绝对时间：台账 / 批次列表用，别把上周的批次说成"3 分钟前"。 */
      function formatDate(ms) {
        var n = Number(ms) || 0
        if (n <= 0) return '—'
        var date = new Date(n)
        var pad = function (v) { return String(v).padStart(2, '0') }
        return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) +
          ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes())
      }

      /** 同源 POST JSON；业务错误直接抛出可读 message。 */
      function postJson(path, body) {
        return fetch(API + path, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body || {}),
        }).then(function (response) {
          return response.json().then(function (payload) {
            if (!payload || payload.ok !== true) {
              var message = payload && payload.error && payload.error.message
                ? payload.error.message
                : 'HTTP ' + response.status
              throw new Error(message)
            }
            return payload.value
          })
        })
      }

      /** 把 Blob 存成文件；不新开窗口，Desktop 的 window.open deny 管不到这里。 */
      function saveBlob(blob, name) {
        var url = URL.createObjectURL(blob)
        var anchor = document.createElement('a')
        anchor.href = url
        anchor.download = name
        document.body.appendChild(anchor)
        anchor.click()
        document.body.removeChild(anchor)
        setTimeout(function () { URL.revokeObjectURL(url) }, 1000)
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

        var queryState = React.useState('')
        var query = queryState[0]
        var setQuery = queryState[1]

        var selectedState = React.useState(function () { return {} })
        var selected = selectedState[0]
        var setSelected = selectedState[1]

        var noticeState = React.useState('')
        var notice = noticeState[0]
        var setNotice = noticeState[1]

        // 行内 diff：同一时刻只展开一条，重复点同一条即收起。
        var diffState = React.useState(null)
        var diff = diffState[0]
        var setDiff = diffState[1]

        var groupedState = React.useState(false)
        var grouped = groupedState[0]
        var setGrouped = groupedState[1]

        // 排序只影响展示顺序；勾选与差异状态都按路径存，切换排序不会丢。
        var sortState = React.useState('mtime')
        var sortBy = sortState[0]
        var setSortBy = sortState[1]

        // 大列表分批渲染：先铺 PAGE 行，点「显示更多」再追加。
        var limitState = React.useState(PAGE)
        var limit = limitState[0]
        var setLimit = limitState[1]

        // 交付工作台：本次 / 历史两个视图
        var modeState = React.useState('current')
        var mode = modeState[0]
        var setMode = modeState[1]

        // 内容搜索开关与结果
        var contentSearchState = React.useState(false)
        var contentSearch = contentSearchState[0]
        var setContentSearch = contentSearchState[1]
        var searchState = React.useState(null)
        var search = searchState[0]
        var setSearch = searchState[1]

        // 交付体检结果（打包/归档前弹出）
        var preflightState = React.useState(null)
        var preflight = preflightState[0]
        var setPreflight = preflightState[1]

        var mounted = React.useRef(true)
        var loadSeq = React.useRef(0)
        var loadAbort = React.useRef(null)
        var inflight = React.useRef(false)
        var diffSeq = React.useRef(0)
        var diffAbort = React.useRef(null)

        React.useEffect(function () {
          mounted.current = true
          return function () {
            mounted.current = false
            if (loadAbort.current) loadAbort.current.abort()
            if (diffAbort.current) diffAbort.current.abort()
          }
        }, [])

        /** Host 业务码 → 本地化文案；未知 code 才退回服务端 message。 */
        var ERROR_KEYS = {
          'no-cwd': 'noCwd',
          'empty': 'zipEmpty',
          'zip-too-large': 'zipTooLarge',
          'all-too-large': 'allTooLarge',
          'missing': 'fileGone',
          'not-in-basket': 'fileGone',
          'too-large': 'tooLargeFile',
          'bad-session': 'needSession',
          'archive-dir-cwd': 'archiveDirCwd',
        }

        function describeError(payload, status) {
          var error = payload && payload.error
          if (error && Object.prototype.hasOwnProperty.call(ERROR_KEYS, error.code)) return t(ERROR_KEYS[error.code])
          if (error && typeof error.message === 'string' && error.message !== '') return error.message
          return 'HTTP ' + status
        }

        var load = React.useCallback(function (force) {
          // 先让所有在途请求失效：sessionId 变空或页面卸载时，旧响应不能再写回。
          var seq = ++loadSeq.current
          if (loadAbort.current) {
            loadAbort.current.abort()
            loadAbort.current = null
          }
          if (typeof sessionId !== 'string' || sessionId === '') {
            setError(t('needSession'))
            setLoading(false)
            setBusy('')
            inflight.current = false
            return
          }

          // 后发先至的旧响应会把新数据覆盖掉：给每次请求编号，并取消上一笔。
          var controller = typeof AbortController === 'function' ? new AbortController() : null
          loadAbort.current = controller
          inflight.current = true

          var query = '?session=' + encodeURIComponent(sessionId) + (cwd ? '&cwd=' + encodeURIComponent(cwd) : '')
          var options = controller ? { signal: controller.signal } : undefined
          var request
          if (force) {
            setBusy('refresh')
            request = fetch(API + 'refresh', Object.assign({
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ session: sessionId, cwd: cwd || undefined }),
            }, options))
          } else {
            request = fetch(API + 'basket' + query, options)
          }

          request
            .then(function (response) {
              return response.json().then(function (body) { return { response: response, body: body } })
            })
            .then(function (result) {
              if (!mounted.current || seq !== loadSeq.current) return
              if (!result.body || result.body.ok !== true) {
                // no-cwd 这类业务错误直接给本地化文案，不再套一层「读取鱼篓失败」
                setError(describeError(result.body, result.response.status))
                return
              }
              setData(result.body.value)
              setError('')
            })
            .catch(function (cause) {
              if (!mounted.current || seq !== loadSeq.current) return
              if (cause && cause.name === 'AbortError') return
              setError(t('loadFailed', { message: String((cause && cause.message) || cause) }))
            })
            .finally(function () {
              if (!mounted.current || seq !== loadSeq.current) return
              setLoading(false)
              setBusy('')
              inflight.current = false
            })
        }, [sessionId, cwd, t])

        React.useEffect(function () {
          load(false)
        }, [load])

        // 每 5 秒静默刷新一次；页面不可见时跳过，别让后台标签页空转。
        React.useEffect(function () {
          var timer = setInterval(function () {
            if (typeof document !== 'undefined' && document.hidden) return
            // 上一笔还没回来就跳过这一轮，避免慢请求越堆越多。
            if (inflight.current) return
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
        var needle = query.trim().toLowerCase()
        var visible = files.filter(function (file) {
          if (filter !== 'all' && file.kind !== filter) return false
          if (needle === '') return true
          return (
            String(file.name).toLowerCase().indexOf(needle) >= 0 ||
            String(file.rel).toLowerCase().indexOf(needle) >= 0 ||
            (typeof file.description === 'string' && file.description.toLowerCase().indexOf(needle) >= 0)
          )
        })
        var chosen = visible.filter(function (file) { return selected[file.path] === true && !file.missing })
        var chosenAll = files.filter(function (file) { return selected[file.path] === true && !file.missing })
        var totals = data && data.totals ? data.totals : { count: 0, bytes: 0 }
        var deliveredCount = files.filter(function (file) { return file.delivery && file.delivery.state === 'done' }).length

        /** 排序：已删除的永远沉底，其余按所选维度。 */
        var sorted = visible.slice().sort(function (a, b) {
          if (a.missing !== b.missing) return a.missing ? 1 : -1
          if (sortBy === 'name') {
            return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }) || a.path.localeCompare(b.path)
          }
          if (sortBy === 'size') return (b.size || 0) - (a.size || 0) || a.name.localeCompare(b.name)
          if (sortBy === 'kind') return String(a.kind).localeCompare(String(b.kind)) || (b.mtimeMs || 0) - (a.mtimeMs || 0)
          return (b.mtimeMs || 0) - (a.mtimeMs || 0) || a.name.localeCompare(b.name)
        })
        var shown = sorted.slice(0, limit)

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
              if (!payload.ok) throw new Error(describeError(payload, response.status))
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
                  throw new Error(describeError(payload, response.status))
                })
              }
              var disposition = response.headers.get('content-disposition') || ''
              var match = /filename\*=UTF-8''([^;]+)/i.exec(disposition)
              var name = match ? decodeURIComponent(match[1]) : 'whale-catch.zip'
              // Host 在打包时会把超过单文件上限的文件剔除，并通过响应头告诉这里有几条
              var skipped = Number(response.headers.get('x-whale-catch-skipped') || 0) || 0
              return response.blob().then(function (blob) { return { blob: blob, name: name, skipped: skipped } })
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
              if (file.skipped > 0) setNotice(t('zipSkipped', { count: file.skipped }))
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
              var copied = Array.isArray(result.copied) ? result.copied.length : 0
              var failed = Array.isArray(result.failed) ? result.failed.length : 0
              var pruned = Array.isArray(result.pruned) ? result.pruned.length : 0
              if (failed > 0 && copied === 0) {
                setNotice(t('archiveFailed', { failed: failed }))
              } else if (failed > 0) {
                setNotice(t('archivePartial', { count: copied, failed: failed }))
              } else {
                var message = t('archived', { count: copied, dir: result.dir })
                if (pruned > 0) message += ' · ' + format(t('archivePruned'), { count: pruned })
                setNotice(message)
              }
            })
            .catch(function (cause) {
              setNotice(t('failed', { message: String((cause && cause.message) || cause) }))
            })
            .finally(function () { setBusy('') })
        }

        /** 打包 / 归档前先体检：block 项直接拦住，其余给一次确认。 */
        function guard(kind, paths) {
          var list = Array.isArray(paths) ? paths : []
          if (list.length === 0) {
            setNotice(t('zipEmpty'))
            return
          }
          setBusy('preflight')
          post('preflight', { session: sessionId, paths: list, cwd: cwd || undefined })
            .then(function (value) {
              setBusy('')
              if (!value || !Array.isArray(value.issues) || value.issues.length === 0) {
                if (kind === 'zip') downloadZip(list)
                else archive(list)
                return
              }
              setPreflight({ kind: kind, paths: list, value: value })
            })
            .catch(function (cause) {
              setBusy('')
              setNotice(t('preflight.failed', { message: String((cause && cause.message) || cause) }))
            })
        }

        /** 内容搜索：只读文件头，命中行带行号，点一下直接跳预览。 */
        function runContentSearch() {
          var q = query.trim()
          if (q === '') {
            setSearch(null)
            return
          }
          setSearch({ loading: true, query: q })
          fetch(API + 'search?session=' + encodeURIComponent(sessionId) + '&q=' + encodeURIComponent(q) + '&limit=20')
            .then(function (response) {
              return response.json().then(function (body) { return { status: response.status, body: body } })
            })
            .then(function (result) {
              if (!mounted.current) return
              if (!result.body || result.body.ok !== true) {
                setSearch({ error: describeError(result.body, result.status), query: q })
                return
              }
              setSearch({ data: result.body.value, query: q })
            })
            .catch(function (cause) {
              if (!mounted.current) return
              setSearch({ error: String((cause && cause.message) || cause), query: q })
            })
        }

        /** 交付状态；备注暂时沿用已有值，避免误清空。 */
        function toggleDelivery(file) {
          var done = file.delivery && file.delivery.state === 'done'
          post('delivery', {
            session: sessionId,
            path: file.path,
            state: done ? 'undone' : 'done',
            note: (file.delivery && file.delivery.note) || '',
          })
            .then(function (value) {
              if (!mounted.current) return
              setData(function (previous) {
                if (previous === null) return previous
                var next = Object.assign({}, previous)
                next.files = (previous.files || []).map(function (item) {
                  return item.path === file.path ? Object.assign({}, item, { delivery: value }) : item
                })
                return next
              })
              setNotice(done ? t('delivery.unmark') : t('delivery.mark'))
            })
            .catch(function (cause) {
              setNotice(t('failed', { message: String((cause && cause.message) || cause) }))
            })
        }

        /** 跳到 Document Preview 的某一行；没有原生地址就退回复制「路径:行号」。 */
        function openAtLine(file, line) {
          var right = null
          try {
            right = clientCtx && typeof clientCtx.get === 'function' ? clientCtx.get('sidebarRight') : null
          } catch (e) {
            right = null
          }
          if (right !== null && right !== undefined && typeof right.openResource === 'function' && typeof file.native === 'string') {
            try {
              right.openResource(file.native, { kind: 'text', params: { line: line } })
              return
            } catch (e) {
              // 落到复制路径
            }
          }
          copyText(file.path + ':' + line, t('copied'))
        }

        /**
         * 预览统一走 DSH 的 Document Preview。
         *
         * 不能用 window.open：Desktop 的 Electron 主进程把所有新窗口都 deny
         * （只把 https 外链交给系统浏览器），http 的本机 /file 地址会被静默拦掉，
         * 表现就是「点预览没反应」。Host 已经为 cwd 内文件生成好
         * `dsh-resource://file/session/…` 地址，这里直接让右侧栏认领；
         * cwd 外文件没有地址，明确给一句提示，不再假装能打开。
         */
        function openPreview(file) {
          if (file.missing) return
          var right = null
          try {
            right = clientCtx && typeof clientCtx.get === 'function' ? clientCtx.get('sidebarRight') : null
          } catch (e) {
            right = null
          }
          if (right === null || right === undefined || typeof right.openResource !== 'function' ||
              typeof file.native !== 'string' || file.native === '') {
            setNotice(t('previewUnavailable'))
            return
          }
          try {
            right.openResource(file.native, { kind: 'text' })
          } catch (e) {
            setNotice(t('previewFailed'))
          }
        }

        function copyText(text, done) {
          if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(function () { setNotice(done) }, function () { setNotice(text) })
            return
          }
          // 没有 clipboard API（非安全上下文）时至少把内容摊在界面上，别假装复制成功
          setNotice(text)
        }

        function copyPath(file) {
          copyText(file.path, t('copied'))
        }

        /** 当前列表 → Markdown 清单：贴进周报、Issue、群聊都能直接读。 */
        function copyList(list) {
          if (list.length === 0) {
            setNotice(t('zipEmpty'))
            return
          }
          var lines = ['# ' + t('tab.title'), '']
          if (data && typeof data.cwd === 'string' && data.cwd !== '') lines.push('`' + data.cwd + '`', '')
          list.forEach(function (file) {
            var bits = ['- **' + file.name + '**', '`' + file.rel + '`', formatBytes(file.size)]
            if (typeof file.added === 'number') bits.push('+' + file.added + ' −' + file.deleted)
            if (typeof file.turn === 'number') bits.push(format(t('group.turn'), { n: file.turn }))
            if (file.description) bits.push(file.description)
            lines.push(bits.join(' · '))
          })
          copyText(lines.join('\n'), t('copiedList'))
        }

        /**
         * 差异接口的业务码 → 本地化文案。服务端 message 是中文的，
         * 英文界面下只在未知错误里兜底一次，别整句漏出去。
         */
        function describeDiffError(payload, status) {
          var error = payload && payload.error
          var code = error && error.code
          if (code === 'diff-timeout') return t('diff.timeout')
          if (code === 'no-diff' || code === 'no-change' || code === 'not-in-basket' || code === 'no-session') {
            return t('diff.unavailable')
          }
          if (error && typeof error.message === 'string' && error.message !== '') {
            return t('diff.failed', { message: error.message })
          }
          return t('diff.failed', { message: 'HTTP ' + status })
        }

        function toggleDiff(file, turn) {
          var wantedTurn = Number.isFinite(turn) ? Math.trunc(turn) : null
          var seq = ++diffSeq.current
          if (diffAbort.current) {
            diffAbort.current.abort()
            diffAbort.current = null
          }
          // 点「差异」按钮时再点一次是同一条 → 收起；从轮次下拉进来则总是切换
          if (wantedTurn === null && diff !== null && diff.path === file.path) {
            setDiff(null)
            return
          }
          if (typeof sessionId !== 'string' || sessionId === '') return

          setDiff({ path: file.path, loading: true, turn: wantedTurn })
          var controller = typeof AbortController === 'function' ? new AbortController() : null
          diffAbort.current = controller
          fetch(
            API + 'diff?session=' + encodeURIComponent(sessionId) + '&path=' + encodeURIComponent(file.path) +
              (wantedTurn === null ? '' : '&turn=' + wantedTurn),
            controller ? { signal: controller.signal } : undefined,
          )
            .then(function (response) {
              return response.json().then(function (body) { return { status: response.status, body: body } })
            })
            .then(function (result) {
              // 双击收起、或切到另一条之后，旧响应不能再把 diff 设回来。
              if (!mounted.current || seq !== diffSeq.current) return
              if (!result.body || result.body.ok !== true) {
                setDiff({ path: file.path, error: describeDiffError(result.body, result.status), turn: wantedTurn })
                return
              }
              setDiff({ path: file.path, data: result.body.value, turn: wantedTurn })
            })
            .catch(function (cause) {
              if (!mounted.current || seq !== diffSeq.current) return
              if (cause && cause.name === 'AbortError') return
              setDiff({ path: file.path, error: t('diff.failed', { message: String((cause && cause.message) || cause) }) })
            })
        }

        var MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'

        /**
         * 展开在某一行下面的差异块。数据来自 `/diff`，只读内核留好的对比，
         * 这里不重算任何内容；binary / oversized 直接给一句人话。
         */
        function diffBlock(file) {
          if (diff === null || diff.path !== file.path) return null

          var parts = []
          if (diff.loading) {
            parts.push(h('div', { key: 'loading', style: { color: C.sub } }, t('diff.loading')))
          } else if (diff.error) {
            parts.push(h('div', { key: 'error', style: { color: 'var(--dsw-alias-label-danger, #d9534f)' } }, diff.error))
          } else {
            var body = diff.data || {}
            var notes = []
            if (body.before === false) notes.push(h('span', { key: 'new', style: { color: '#2f9e44' } }, t('diff.newFile')))
            if (body.after === false) notes.push(h('span', { key: 'del', style: { color: '#c92a2a' } }, t('diff.deletedFile')))
            if (body.coarse) notes.push(h('span', { key: 'coarse' }, t('diff.coarse')))

            if (body.kind === 'binary') {
              notes.push(h('span', { key: 'binary' }, t('diff.binary')))
            } else if (body.kind === 'oversized') {
              notes.push(h('span', { key: 'oversized' }, t('diff.oversized')))
            } else {
              var hunks = Array.isArray(body.hunks) ? body.hunks : []
              var shown = 0
              hunks.forEach(function (hunk) { shown += Array.isArray(hunk.lines) ? hunk.lines.length : 0 })
              if (body.trimmed) notes.push(h('span', { key: 'trimmed' }, format(t('diff.trimmed'), { count: shown })))
              if (hunks.length === 0) notes.push(h('span', { key: 'empty' }, t('diff.empty')))

              if (hunks.length > 0) {
                var lines = []
                hunks.forEach(function (hunk, hunkIndex) {
                  lines.push(h('div', {
                    key: 'h' + hunkIndex,
                    style: { padding: '1px 6px', color: C.faint, background: 'var(--dsw-alias-bg-layer-2, rgba(127,127,127,0.10))' },
                  }, '@@ -' + hunk.oldStart + ',' + hunk.oldLines + ' +' + hunk.newStart + ',' + hunk.newLines + ' @@'))
                  var bodyLines = Array.isArray(hunk.lines) ? hunk.lines : []
                  bodyLines.forEach(function (line, lineIndex) {
                    // 一条 hunk 最多铺 300 行：再长说明 Host 的裁剪没生效，别把面板撑爆
                    if (lineIndex >= 300) return
                    var text = String(line)
                    var head = text.charAt(0)
                    var tone = head === '+' ? '#2f9e44' : head === '-' ? '#c92a2a' : C.sub
                    var tint = head === '+' ? 'rgba(47,158,68,0.10)' : head === '-' ? 'rgba(201,42,42,0.10)' : 'transparent'
                    lines.push(h('div', {
                      key: 'l' + hunkIndex + '-' + lineIndex,
                      style: { padding: '0 6px', whiteSpace: 'pre', color: tone, background: tint },
                    }, text))
                  })
                })
                parts.push(h('div', {
                  key: 'lines',
                  style: {
                    marginTop: '4px',
                    maxHeight: '260px',
                    overflow: 'auto',
                    border: '1px solid ' + C.border,
                    borderRadius: '6px',
                    fontFamily: MONO,
                    fontSize: '10.5px',
                    lineHeight: '15px',
                  },
                }, lines))
              }
            }

            if (notes.length > 0) {
              parts.unshift(h('div', {
                key: 'notes',
                style: {
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '6px',
                  color: C.sub,
                  marginBottom: parts.length > 0 ? '2px' : '0',
                },
              }, notes))
            }
          }

          return h('div', {
            key: file.path + ':diff',
            style: {
              padding: '5px 12px 8px 34px',
              background: 'var(--dsw-alias-bg-layer-2, rgba(127,127,127,0.045))',
              borderBottom: '1px solid var(--dsw-alias-border-l5, rgba(128,128,128,0.12))',
            },
          }, parts)
        }

        /** 内容搜索结果：按文件分组，命中行可点。 */
        function renderSearchResults() {
          if (search === null) return null
          var wrap = function (node) {
            return h('div', { style: { flex: 1, minHeight: 0, overflowY: 'auto', padding: '10px 12px' } }, node)
          }
          if (search.loading) return wrap(h('div', { style: { color: C.sub } }, t('history.loading')))
          if (search.error) return wrap(h('div', { style: { color: 'var(--dsw-alias-label-danger, #d9534f)' } }, search.error))
          var data = search.data || {}
          var found = Array.isArray(data.files) ? data.files : []
          if (found.length === 0) return wrap(h('div', { style: { color: C.sub } }, t('search.none')))

          var nodes = []
          found.forEach(function (item) {
            var current = null
            for (var index = 0; index < files.length; index += 1) {
              if (files[index].path === item.path) {
                current = files[index]
                break
              }
            }
            var hitNodes = (Array.isArray(item.hits) ? item.hits : []).map(function (hit, hitIndex) {
              return h('div', {
                key: 'hit' + hitIndex,
                onClick: function () {
                  if (current !== null) openAtLine(current, hit.line)
                  else copyText(item.path + ':' + hit.line, t('copied'))
                },
                style: {
                  fontSize: '10.5px',
                  color: C.sub,
                  lineHeight: '16px',
                  padding: '1px 0',
                  cursor: 'pointer',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                },
              },
              h('span', { style: { color: C.faint, marginRight: '5px', fontFamily: 'ui-monospace, Menlo, monospace' } }, String(hit.line)),
              hit.text)
            })
            nodes.push(h('div', {
              key: item.path,
              style: { padding: '6px 0', borderBottom: '1px solid var(--dsw-alias-border-l5, rgba(128,128,128,0.12))' },
            },
            h('div', { style: { fontSize: '11.5px', color: C.text, marginBottom: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: item.path }, item.rel || item.name),
            hitNodes))
          })
          nodes.push(h('div', { style: { fontSize: '10px', color: C.faint, paddingTop: '6px' } },
            format(t('search.scanned'), { count: Number(data.scanned) || 0 }) +
              (data.truncated ? ' · ' + t('search.truncated') : '')))
          return wrap(nodes)
        }

        /** 体检结果弹层：block 项没有「继续」，warn 项允许确认后放行。 */
        function preflightOverlay() {
          if (preflight === null) return null
          var value = preflight.value || {}
          var issues = Array.isArray(value.issues) ? value.issues : []
          var summary = value.summary || {}
          var blockCount = Number(summary.block) || 0
          var levelText = { block: t('preflight.block'), warn: t('preflight.warn'), info: t('preflight.info') }
          var levelColor = { block: '#c92a2a', warn: '#b7791f', info: C.sub }
          var current = preflight
          return h('div', {
            style: {
              position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex',
              alignItems: 'center', justifyContent: 'center', padding: '10px', zIndex: 30,
            },
          },
          h('div', {
            style: {
              width: '100%', maxHeight: '85%', display: 'flex', flexDirection: 'column',
              background: 'var(--dsw-alias-bg-layer-1, #202124)', border: '1px solid ' + C.border,
              borderRadius: '10px', padding: '12px', boxSizing: 'border-box',
            },
          },
          h('div', { style: { fontSize: '13px', fontWeight: 600 } }, t('preflight.title')),
          h('div', { style: { fontSize: '10.5px', color: C.sub, margin: '4px 0 8px' } },
            issues.length === 0
              ? t('preflight.clean')
              : (blockCount > 0 ? t('preflight.block') : t('preflight.warn')) + ' · ' + String(issues.length)),
          h('div', {
            style: {
              flex: 1, minHeight: '80px', maxHeight: '240px', overflowY: 'auto',
              border: '1px solid ' + C.border, borderRadius: '6px', padding: '4px 6px',
            },
          },
          issues.map(function (issue, index) {
            return h('div', { key: 'issue' + index, style: { fontSize: '10.5px', padding: '2px 0', lineHeight: '15px' } },
              h('span', { style: { color: levelColor[issue.level] || C.sub, marginRight: '5px' } }, levelText[issue.level] || issue.level),
              h('span', { style: { color: C.text } }, issue.rel || issue.code || ''),
              issue.detail ? h('span', { style: { color: C.sub } }, ' · ' + issue.detail) : null)
          })),
          h('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '10px' } },
            h('button', {
              type: 'button',
              onClick: function () { setPreflight(null) },
              style: buttonStyle(false, false),
            }, t('preflight.cancel')),
            h('button', {
              type: 'button',
              disabled: blockCount > 0 || busy !== '',
              onClick: function () {
                setPreflight(null)
                if (current.kind === 'zip') downloadZip(current.paths)
                else archive(current.paths)
              },
              style: buttonStyle(true, blockCount > 0 || busy !== ''),
            }, t('preflight.continue')))))
        }

        /* ── 渲染 ── */

        var subtitle = format(t('header.count'), { count: totals.count }) + ' · ' + formatBytes(totals.bytes)
        if (Number(totals.changed) > 0 && (Number(totals.added) > 0 || Number(totals.deleted) > 0)) {
          subtitle += ' · +' + (Number(totals.added) || 0) + ' −' + (Number(totals.deleted) || 0)
        }

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
          }, subtitle),
        ),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '4px', flex: 'none' } },
          h('button', {
            type: 'button',
            onClick: function () { setMode('current') },
            style: chipStyle(mode === 'current'),
          }, t('mode.current')),
          h('button', {
            type: 'button',
            onClick: function () { setMode('history') },
            style: chipStyle(mode === 'history'),
          }, t('mode.history')),
          h('button', {
            type: 'button',
            onClick: function () { load(true) },
            disabled: busy !== '',
            title: t('refresh'),
            style: buttonStyle(false, busy !== ''),
          }, busy === 'refresh' ? t('refreshing') : t('refresh'))))

        if (mode === 'history') {
          return h('div', {
            style: {
              display: 'flex',
              flexDirection: 'column',
              height: '100%',
              width: '100%',
              minWidth: 0,
              minHeight: 0,
              overflow: 'hidden',
              fontSize: '12px',
              color: C.text,
            },
          },
          header,
          h(HistoryPanel, {
            sessionId: sessionId,
            t: t,
            currentFiles: files,
            onBack: function () { setMode('current') },
          }))
        }

        var chips = []
        if (files.length > 0) {
          var totalVisible = files.filter(function (file) { return !file.missing }).length
          chips.push(h('button', {
            key: 'all',
            type: 'button',
            onClick: function () { setFilter('all'); setLimit(PAGE) },
            style: chipStyle(filter === 'all'),
          }, t('all') + ' ' + totalVisible))
          KINDS.forEach(function (kind) {
            var count = counts[kind] || 0
            if (count === 0) return
            chips.push(h('button', {
              key: kind,
              type: 'button',
              onClick: function () { setFilter(kind); setLimit(PAGE) },
              style: chipStyle(filter === kind),
            }, KIND_EMOJI[kind] + ' ' + t('kind.' + kind) + ' ' + count))
          })
        }

        var rowByPath = {}
        shown.forEach(function (file) {
          var isSelected = selected[file.path] === true
          var meta = []
          meta.push(formatBytes(file.size))
          if (file.mtimeMs > 0) meta.push(formatTime(file.mtimeMs, t))
          if (Array.isArray(file.sources) && file.sources.indexOf('presented') >= 0) meta.push(t('presented'))
          if (Array.isArray(file.sources) && file.sources.indexOf('changed') >= 0) meta.push(t('changed'))
          if (file.binary) meta.push(t('binary'))
          if (file.oversized) meta.push(t('oversizedFile'))
          if (file.missing) meta.push(t('missing'))
          if (file.delivery && file.delivery.state === 'done') meta.push(t('delivered'))

          rowByPath[file.path] = h('div', {
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
            'aria-label': t('select') + ' ' + file.name,
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
              typeof file.added === 'number'
                ? h('span', {
                  title: '+' + file.added + ' / −' + file.deleted,
                  style: { display: 'inline-flex', gap: '4px', flex: 'none', fontFamily: MONO, fontSize: '10.5px' },
                },
                h('span', { style: { color: '#2f9e44' } }, '+' + file.added),
                h('span', { style: { color: '#c92a2a' } }, '−' + file.deleted))
                : null,
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
              onClick: function (event) { event.stopPropagation(); openPreview(file) },
              disabled: file.missing,
              style: Object.assign(buttonStyle(false, file.missing), { fontSize: '11px', padding: '2px 8px' }),
            }, t('open')),
            file.diffable
              ? h('button', {
                type: 'button',
                title: t('diff'),
                onClick: function (event) { event.stopPropagation(); toggleDiff(file) },
                style: Object.assign(buttonStyle(false, false), {
                  fontSize: '11px',
                  padding: '2px 8px',
                  background: diff !== null && diff.path === file.path
                    ? 'var(--dsw-alias-bg-layer-2, rgba(127,127,127,0.10))'
                    : 'transparent',
                }),
              }, t('diff'))
              : null,
            file.changeCount > 1
              ? h('select', {
                title: t('version.label'),
                'aria-label': t('version.label'),
                value: diff !== null && diff.path === file.path && diff.turn !== null ? String(diff.turn) : '',
                onClick: function (event) { event.stopPropagation() },
                onChange: function (event) {
                  if (event.target.value === '') return
                  toggleDiff(file, Number(event.target.value))
                },
                style: {
                  font: 'inherit',
                  fontSize: '10px',
                  lineHeight: '16px',
                  maxWidth: '86px',
                  padding: '0 2px',
                  borderRadius: 'var(--dsw-radius-sm, 8px)',
                  border: '1px solid ' + C.border,
                  background: 'transparent',
                  color: 'inherit',
                  cursor: 'pointer',
                },
              },
              h('option', { value: '' }, t('version.label')),
              (file.changeTurns || []).map(function (turn) {
                return h('option', { key: 'v' + turn, value: String(turn) }, format(t('group.turn'), { n: turn }))
              }))
              : null,
            file.missing
              ? null
              : h('button', {
                type: 'button',
                title: file.delivery && file.delivery.state === 'done' ? t('delivery.unmark') : t('delivery.mark'),
                'aria-label': file.delivery && file.delivery.state === 'done' ? t('delivery.unmark') : t('delivery.mark'),
                onClick: function (event) { event.stopPropagation(); toggleDelivery(file) },
                style: Object.assign(buttonStyle(false, false), {
                  fontSize: '11px',
                  padding: '2px 8px',
                  color: file.delivery && file.delivery.state === 'done' ? '#2f9e44' : 'inherit',
                }),
              }, file.delivery && file.delivery.state === 'done' ? '✓' : '○'),
            h('button', {
              type: 'button',
              title: t('copy'),
              'aria-label': t('copy') + ' ' + file.name,
              onClick: function (event) { event.stopPropagation(); copyPath(file) },
              style: Object.assign(buttonStyle(false, false), { fontSize: '11px', padding: '2px 8px' }),
            }, '⧉'),
          ))
        })

        /** 差异块紧跟在所属行后面：分组与非分组共用同一份行元素。 */
        function pushRow(target, file) {
          var row = rowByPath[file.path]
          if (row === undefined) return
          target.push(row)
          // 只给"当前仍可看差异"的行挂展开块：Host 重启或条目被替换后，
          // 残留的 diff 状态不该在没有「差异」按钮的行下面冒出来
          if (!file.diffable) return
          var block = diffBlock(file)
          if (block !== null) target.push(block)
        }

        var rowNodes = []
        if (grouped) {
          var buckets = []
          var bucketByTurn = {}
          shown.forEach(function (file) {
            var key = typeof file.turn === 'number' ? 't' + file.turn : 'none'
            if (bucketByTurn[key] === undefined) {
              bucketByTurn[key] = { turn: typeof file.turn === 'number' ? file.turn : null, files: [] }
              buckets.push(bucketByTurn[key])
            }
            bucketByTurn[key].files.push(file)
          })
          // 轮次倒序，没标轮次的沉底：越新的东西越靠近视线
          buckets.sort(function (a, b) {
            if (a.turn === null) return 1
            if (b.turn === null) return -1
            return b.turn - a.turn
          })
          buckets.forEach(function (bucket) {
            rowNodes.push(h('div', {
              key: 'bucket-' + (bucket.turn === null ? 'none' : bucket.turn),
              style: { padding: '8px 12px 3px', fontSize: '10.5px', color: C.faint, letterSpacing: '0.02em' },
            }, bucket.turn === null ? t('group.unmarked') : format(t('group.turn'), { n: bucket.turn })))
            bucket.files.forEach(function (file) { pushRow(rowNodes, file) })
          })
        } else {
          shown.forEach(function (file) { pushRow(rowNodes, file) })
        }

        var searchResults = contentSearch ? renderSearchResults() : null
        var body
        if (loading && data === null) {
          body = h('div', { style: { padding: '24px 12px', color: C.sub, fontSize: '12px', textAlign: 'center' } }, t('refreshing'))
        } else if (error !== '') {
          body = h('div', { style: { padding: '16px 12px' } },
            h('div', { style: { color: 'var(--dsw-alias-label-danger, #d9534f)', fontSize: '12px', lineHeight: '18px' } }, error),
            h('div', { style: { height: '8px' } }),
            h('button', { type: 'button', onClick: function () { load(true) }, style: buttonStyle(false, false) }, t('refresh')))
        } else if (searchResults !== null) {
          body = searchResults
        } else if (files.length === 0) {
          body = h('div', { style: { padding: '28px 16px', textAlign: 'center' } },
            h('div', { style: { fontSize: '28px', lineHeight: '36px' } }, '🧺'),
            h('div', { style: { fontSize: '13px', color: C.text, marginTop: '6px' } }, t('empty.title')),
            h('div', { style: { fontSize: '11.5px', color: C.sub, marginTop: '4px', lineHeight: '17px' } }, t('empty.hint')))
        } else if (visible.length === 0) {
          body = h('div', {
            style: { padding: '24px 12px', textAlign: 'center', color: C.sub, fontSize: '12px' },
          }, needle === '' ? t('empty.filter') : t('empty.search'))
        } else {
          body = h('div', { style: { padding: '2px 12px 8px', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '6px' } },
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
            h('button', {
              type: 'button',
              title: t('copyList'),
              onClick: function () { copyList(chosenAll.length ? chosenAll : visible.filter(function (f) { return !f.missing })) },
              style: buttonStyle(false, false),
            }, t('copyList')),
            h('button', {
              type: 'button',
              title: t('group'),
              onClick: function () { setGrouped(!grouped); setLimit(PAGE) },
              style: chipStyle(grouped),
            }, t('group')),
            h('select', {
              value: sortBy,
              title: t('sort.aria'),
              'aria-label': t('sort.aria'),
              onChange: function (event) { setSortBy(event.target.value); setLimit(PAGE) },
              style: {
                font: 'inherit',
                fontSize: '11px',
                lineHeight: '18px',
                padding: '2px 4px',
                borderRadius: 'var(--dsw-radius-sm, 8px)',
                border: '1px solid ' + C.border,
                background: 'transparent',
                color: 'inherit',
                cursor: 'pointer',
              },
            }, ['mtime', 'name', 'size', 'kind'].map(function (key) {
              return h('option', { key: key, value: key }, t('sort.' + key))
            })),
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
              format(t('selected'), { count: chosenAll.length }) +
                (deliveredCount > 0 ? ' · ' + format(t('delivery.progress'), { done: deliveredCount, total: files.filter(function (f) { return !f.missing }).length }) : '')),
            h('button', {
              type: 'button',
              onClick: function () { guard('archive', chosenAll.length ? chosenAll.map(function (f) { return f.path }) : files.filter(function (f) { return !f.missing }).map(function (f) { return f.path })) },
              disabled: busy !== '' || files.length === 0,
              style: buttonStyle(false, busy !== '' || files.length === 0),
            }, busy === 'archive' || busy === 'preflight' ? '…' : t('archive')),
            h('button', {
              type: 'button',
              onClick: function () { guard('zip', chosenAll.length ? chosenAll.map(function (f) { return f.path }) : files.filter(function (f) { return !f.missing }).map(function (f) { return f.path })) },
              disabled: busy !== '',
              style: buttonStyle(true, busy !== ''),
            }, busy === 'zip' || busy === 'preflight' ? '…' : (chosenAll.length ? t('zip') : t('zipAll')))),
          notice !== ''
            ? h('div', {
              role: 'status',
              'aria-live': 'polite',
              style: { fontSize: '10.5px', color: C.sub, lineHeight: '15px', wordBreak: 'break-all' },
            }, notice)
            : null,
          data && data.scannedAt
            ? h('div', { style: { fontSize: '10px', color: C.faint } }, format(t('scanAt'), { time: formatTime(data.scannedAt, t) }))
            : null)
        }

        /** 还有没铺出来的行时给一个「显示更多」，800 条也不会一次全渲染。 */
        var remaining = sorted.length - shown.length
        var moreNode = remaining > 0
          ? h('div', { key: 'load-more', style: { padding: '10px 12px 14px', textAlign: 'center' } },
            h('button', {
              type: 'button',
              onClick: function () { setLimit(limit + PAGE) },
              style: buttonStyle(false, false),
            }, format(t('showMore'), { count: remaining })))
          : null

        return h('div', {
          style: {
            position: 'relative',
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
        files.length > 0
          ? h('div', { style: { padding: '4px 12px 6px', display: 'flex', alignItems: 'center', gap: '6px' } },
            h('input', {
              type: 'search',
              value: query,
              placeholder: contentSearch ? t('search.contentPlaceholder') : t('search'),
              'aria-label': contentSearch ? t('search.contentPlaceholder') : t('search'),
              onChange: function (event) { setQuery(event.target.value); setSearch(null); setLimit(PAGE) },
              onKeyDown: function (event) {
                if (event.key === 'Enter' && contentSearch) runContentSearch()
              },
              style: {
                flex: 1,
                minWidth: 0,
                boxSizing: 'border-box',
                font: 'inherit',
                fontSize: '11.5px',
                lineHeight: '18px',
                padding: '4px 8px',
                borderRadius: 'var(--dsw-radius-sm, 8px)',
                border: '1px solid ' + C.border,
                background: 'transparent',
                color: 'inherit',
              },
            }),
            h('label', {
              title: t('search.content'),
              style: { display: 'inline-flex', alignItems: 'center', gap: '3px', fontSize: '10.5px', color: C.sub, flex: 'none', cursor: 'pointer' },
            },
            h('input', {
              type: 'checkbox',
              checked: contentSearch,
              onChange: function (event) {
                setContentSearch(event.target.checked)
                setSearch(null)
                setLimit(PAGE)
              },
              style: { margin: 0, accentColor: C.accent },
            }),
            t('search.content')))
          : null,
        body,
        rowNodes.length
          ? h('div', { style: { flex: 1, minHeight: 0, overflowY: 'auto' } }, rowNodes, moreNode)
          : null,
        footer,
        preflightOverlay())
      }

      /* ───────────────────────────── 交付台账 ───────────────────────────── */

      /**
       * 「历史」视图：列台账里的归档批次，能看详情、下载回执、还原、
       * 以及把某个文件与当前工作区里的同名文件对比。
       */
      function HistoryPanel(props) {
        var t = props.t
        var sessionId = props.sessionId
        var onBack = props.onBack
        var currentFiles = Array.isArray(props.currentFiles) ? props.currentFiles : []
        var HIST_MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'

        var listState = React.useState(null)
        var list = listState[0]
        var setList = listState[1]

        var loadingState = React.useState(true)
        var loading = loadingState[0]
        var setLoading = loadingState[1]

        var errorState = React.useState('')
        var error = errorState[0]
        var setError = errorState[1]

        var runState = React.useState(null)
        var run = runState[0]
        var setRun = runState[1]

        var diffState = React.useState(null)
        var diff = diffState[0]
        var setDiff = diffState[1]

        var restoreState = React.useState(null)
        var restore = restoreState[0]
        var setRestore = restoreState[1]

        var noticeState = React.useState('')
        var notice = noticeState[0]
        var setNotice = noticeState[1]

        var mounted = React.useRef(true)
        React.useEffect(function () {
          mounted.current = true
          return function () { mounted.current = false }
        }, [])

        function errorText(body, status) {
          if (body && body.error && typeof body.error.message === 'string' && body.error.message !== '') {
            return body.error.message
          }
          return 'HTTP ' + status
        }

        function load() {
          setLoading(true)
          setError('')
          fetch(API + 'ledger?session=' + encodeURIComponent(sessionId) + '&limit=50')
            .then(function (response) {
              return response.json().then(function (body) { return { status: response.status, body: body } })
            })
            .then(function (result) {
              if (!mounted.current) return
              if (!result.body || result.body.ok !== true) {
                setError(errorText(result.body, result.status))
                return
              }
              var events = Array.isArray(result.body.value.events) ? result.body.value.events : []
              setList(events.filter(function (event) { return event.t === 'archive' }).reverse())
            })
            .catch(function (cause) {
              if (!mounted.current) return
              setError(String((cause && cause.message) || cause))
            })
            .finally(function () {
              if (mounted.current) setLoading(false)
            })
        }

        React.useEffect(function () {
          load()
          // eslint-disable-next-line react-hooks/exhaustive-deps
        }, [sessionId])

        React.useEffect(function () {
          if (notice === '') return undefined
          var timer = setTimeout(function () { setNotice('') }, 4000)
          return function () { clearTimeout(timer) }
        }, [notice])

        function openRun(event) {
          setRun({ run: event.run, loading: true })
          fetch(API + 'ledger/run?session=' + encodeURIComponent(sessionId) + '&run=' + encodeURIComponent(event.run))
            .then(function (response) {
              return response.json().then(function (body) { return { status: response.status, body: body } })
            })
            .then(function (result) {
              if (!mounted.current) return
              if (!result.body || result.body.ok !== true) {
                setRun({ run: event.run, error: errorText(result.body, result.status) })
                return
              }
              setRun({
                run: result.body.value.run,
                manifest: result.body.value.manifest,
                archivedAt: result.body.value.archivedAt,
                loading: false,
              })
            })
            .catch(function (cause) {
              if (mounted.current) setRun({ run: event.run, error: String((cause && cause.message) || cause) })
            })
        }

        function downloadReceipt(event) {
          setNotice(t('receipt.generating'))
          fetch(API + 'receipt?session=' + encodeURIComponent(sessionId) + '&run=' + encodeURIComponent(event.run))
            .then(function (response) {
              if (!response.ok) {
                return response.json().then(function (body) { throw new Error(errorText(body, response.status)) })
              }
              var disposition = response.headers.get('content-disposition') || ''
              var match = /filename\*=UTF-8''([^;]+)/i.exec(disposition)
              var name = match ? decodeURIComponent(match[1]) : 'receipt-' + event.run + '.html'
              return response.blob().then(function (blob) {
                saveBlob(blob, name)
                setNotice(t('history.receipt'))
              })
            })
            .catch(function (cause) {
              setNotice(String((cause && cause.message) || cause))
            })
        }

        function openRestore(event) {
          setRestore({ run: event.run, mode: 'skip', loading: true, plan: [] })
          postJson('archive/restore', { session: sessionId, run: event.run, mode: 'skip', dryRun: true })
            .then(function (value) {
              if (!mounted.current) return
              setRestore({ run: event.run, mode: 'skip', loading: false, plan: value.plan || [], blocked: value.blocked || [] })
            })
            .catch(function (cause) {
              if (!mounted.current) return
              setRestore({ run: event.run, loading: false, error: String((cause && cause.message) || cause), plan: [] })
            })
        }

        function changeRestoreMode(mode) {
          if (restore === null) return
          setRestore(Object.assign({}, restore, { mode: mode, loading: true }))
          postJson('archive/restore', { session: sessionId, run: restore.run, mode: mode, dryRun: true })
            .then(function (value) {
              if (!mounted.current) return
              setRestore({ run: restore.run, mode: mode, loading: false, plan: value.plan || [], blocked: value.blocked || [] })
            })
            .catch(function (cause) {
              if (!mounted.current) return
              setRestore(Object.assign({}, restore, { mode: mode, loading: false, error: String((cause && cause.message) || cause) }))
            })
        }

        function applyRestore() {
          if (restore === null) return
          var mode = restore.mode
          setRestore(Object.assign({}, restore, { loading: true }))
          postJson('archive/restore', { session: sessionId, run: restore.run, mode: mode, dryRun: false })
            .then(function (value) {
              if (!mounted.current) return
              setRestore({ run: restore.run, done: true, result: value, plan: restore.plan || [] })
              setNotice(format(t('restore.done'), { count: (value.restored || []).length }))
              load()
            })
            .catch(function (cause) {
              if (!mounted.current) return
              setRestore(Object.assign({}, restore, { loading: false, error: String((cause && cause.message) || cause) }))
            })
        }

        function compare(file, event) {
          var current = null
          for (var index = 0; index < currentFiles.length; index += 1) {
            if (currentFiles[index].rel === file.rel) {
              current = currentFiles[index]
              break
            }
          }
          if (current === null || typeof current.native !== 'string') {
            setNotice(t('error.noArchiveCopy'))
            return
          }
          setDiff({ rel: file.rel, loading: true })
          fetch(
            API + 'diff/archive?session=' + encodeURIComponent(sessionId) +
            '&path=' + encodeURIComponent(current.path) +
            '&run=' + encodeURIComponent(event.run),
          )
            .then(function (response) {
              return response.json().then(function (body) { return { status: response.status, body: body } })
            })
            .then(function (result) {
              if (!mounted.current) return
              if (!result.body || result.body.ok !== true) {
                setDiff({ rel: file.rel, error: errorText(result.body, result.status) })
                return
              }
              setDiff({ rel: file.rel, data: result.body.value })
            })
            .catch(function (cause) {
              if (mounted.current) setDiff({ rel: file.rel, error: String((cause && cause.message) || cause) })
            })
        }

        function diffBlock(file) {
          if (diff === null || diff.rel !== file.rel) return null
          if (diff.loading) {
            return h('div', { style: { padding: '4px 8px 8px', color: C.sub } }, t('diff.archiveLoading'))
          }
          if (diff.error) {
            return h('div', { style: { padding: '4px 8px 8px', color: 'var(--dsw-alias-label-danger, #d9534f)' } }, diff.error)
          }
          var body = diff.data || {}
          if (body.kind === 'binary') return h('div', { style: { padding: '4px 8px 8px', color: C.sub } }, t('diff.binary'))
          if (body.kind === 'oversized') return h('div', { style: { padding: '4px 8px 8px', color: C.sub } }, t('diff.oversized'))
          var hunks = Array.isArray(body.hunks) ? body.hunks : []
          if (hunks.length === 0) return h('div', { style: { padding: '4px 8px 8px', color: C.sub } }, t('diff.empty'))
          var lines = []
          hunks.forEach(function (hunk, hunkIndex) {
            lines.push(h('div', {
              key: 'hh' + hunkIndex,
              style: { padding: '1px 6px', color: C.faint, background: 'var(--dsw-alias-bg-layer-2, rgba(127,127,127,0.10))' },
            }, '@@ -' + hunk.oldStart + ',' + hunk.oldLines + ' +' + hunk.newStart + ',' + hunk.newLines + ' @@'))
            ;(hunk.lines || []).forEach(function (line, lineIndex) {
              if (lineIndex >= 200) return
              var text = String(line)
              var head = text.charAt(0)
              var tone = head === '+' ? '#2f9e44' : head === '-' ? '#c92a2a' : C.sub
              var tint = head === '+' ? 'rgba(47,158,68,0.10)' : head === '-' ? 'rgba(201,42,42,0.10)' : 'transparent'
              lines.push(h('div', { key: 'hl' + hunkIndex + '-' + lineIndex, style: { padding: '0 6px', whiteSpace: 'pre', color: tone, background: tint } }, text))
            })
          })
          return h('div', {
            style: {
              margin: '2px 8px 8px',
              maxHeight: '220px',
              overflow: 'auto',
              border: '1px solid ' + C.border,
              borderRadius: '6px',
              fontFamily: HIST_MONO,
              fontSize: '10.5px',
              lineHeight: '15px',
            },
          }, lines)
        }

        var header = h('div', {
          style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 12px 8px', borderBottom: '1px solid ' + C.border },
        },
        h('button', { type: 'button', onClick: onBack, style: buttonStyle(false, false) }, '←'),
        h('div', { style: { display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 } },
          h('span', { style: { fontSize: '13px', fontWeight: 600, lineHeight: '18px' } }, t('mode.history')),
          h('span', { style: { fontSize: '10.5px', color: C.sub, lineHeight: '15px' } }, t('history.files').replace('{count}', String(list === null ? 0 : list.length)))),
        h('button', { type: 'button', onClick: load, disabled: loading, style: buttonStyle(false, loading) }, loading ? t('refreshing') : t('refresh')))

        var body
        if (run !== null) {
          var manifest = run.manifest || {}
          var runFiles = Array.isArray(manifest.files) ? manifest.files : []
          body = h('div', { style: { flex: 1, minHeight: 0, overflowY: 'auto' } },
            h('div', { style: { padding: '8px 12px', display: 'flex', alignItems: 'center', gap: '8px' } },
              h('button', { type: 'button', onClick: function () { setRun(null); setDiff(null) }, style: buttonStyle(false, false) }, t('history.back')),
              h('span', { style: { fontSize: '10.5px', color: C.faint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, run.run)),
            run.loading
              ? h('div', { style: { padding: '12px', color: C.sub } }, t('history.loading'))
              : run.error
                ? h('div', { style: { padding: '12px', color: 'var(--dsw-alias-label-danger, #d9534f)' } }, run.error)
                : h('div', null, runFiles.map(function (file, index) {
                  return h('div', {
                    key: (file.rel || 'file') + index,
                    style: { padding: '6px 12px', borderBottom: '1px solid var(--dsw-alias-border-l5, rgba(128,128,128,0.12))' },
                  },
                  h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
                    h('span', { style: { fontSize: '12px', color: C.text, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: file.rel }, file.rel),
                    h('span', { style: { fontSize: '10px', color: C.faint, flex: 'none' } }, formatBytes(file.size))),
                  h('div', { style: { display: 'flex', gap: '6px', marginTop: '3px' } },
                    h('button', {
                      type: 'button',
                      onClick: function () { copyText(file.rel, t('copied')) },
                      style: Object.assign(buttonStyle(false, false), { fontSize: '10.5px', padding: '1px 7px' }),
                    }, t('copy')),
                    h('button', {
                      type: 'button',
                      onClick: function () { compare(file, run) },
                      style: Object.assign(buttonStyle(false, false), { fontSize: '10.5px', padding: '1px 7px' }),
                    }, t('history.compare'))),
                  diffBlock(file))
                })))
        } else if (loading && list === null) {
          body = h('div', { style: { flex: 1, padding: '24px 12px', textAlign: 'center', color: C.sub } }, t('history.loading'))
        } else if (error !== '') {
          body = h('div', { style: { flex: 1, padding: '16px 12px', color: 'var(--dsw-alias-label-danger, #d9534f)' } }, error)
        } else if (list === null || list.length === 0) {
          body = h('div', { style: { flex: 1, padding: '32px 16px', textAlign: 'center' } },
            h('div', { style: { fontSize: '26px' } }, '🧾'),
            h('div', { style: { fontSize: '13px', marginTop: '6px' } }, t('history.empty')),
            h('div', { style: { fontSize: '11px', color: C.sub, marginTop: '4px' } }, t('history.emptyHint')))
        } else {
          body = h('div', { style: { flex: 1, minHeight: 0, overflowY: 'auto' } },
            list.map(function (event) {
              return h('div', {
                key: event.run,
                style: { padding: '8px 12px', borderBottom: '1px solid var(--dsw-alias-border-l5, rgba(128,128,128,0.12))' },
              },
              h('div', { style: { display: 'flex', alignItems: 'baseline', gap: '8px' } },
                h('span', { style: { fontSize: '12px', fontWeight: 600 } }, formatDate(event.at)),
                h('span', { style: { fontSize: '10px', color: C.faint, flex: 1, textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, event.run)),
              h('div', { style: { fontSize: '10.5px', color: C.sub, marginTop: '2px' } },
                format(t('history.files'), { count: Number(event.count) || 0 }) + ' · ' + formatBytes(event.bytes)),
              h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '5px' } },
                h('button', { type: 'button', onClick: function () { openRun(event) }, style: Object.assign(buttonStyle(false, false), { fontSize: '10.5px', padding: '1px 7px' }) }, t('history.detail')),
                h('button', { type: 'button', onClick: function () { downloadReceipt(event) }, style: Object.assign(buttonStyle(false, false), { fontSize: '10.5px', padding: '1px 7px' }) }, t('history.receipt')),
                h('button', { type: 'button', onClick: function () { openRestore(event) }, style: Object.assign(buttonStyle(false, false), { fontSize: '10.5px', padding: '1px 7px' }) }, t('history.restore'))))
            }))
        }

        var restoreOverlay = null
        if (restore !== null) {
          var plan = Array.isArray(restore.plan) ? restore.plan : []
          restoreOverlay = h('div', {
            style: {
              position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex',
              alignItems: 'center', justifyContent: 'center', padding: '10px', zIndex: 30,
            },
          },
          h('div', {
            style: {
              width: '100%', maxHeight: '85%', display: 'flex', flexDirection: 'column',
              background: 'var(--dsw-alias-bg-layer-1, #202124)', border: '1px solid ' + C.border,
              borderRadius: '10px', padding: '12px', boxSizing: 'border-box',
            },
          },
          h('div', { style: { fontSize: '13px', fontWeight: 600, marginBottom: '6px' } }, t('restore.title') + ' · ' + restore.run),
          h('select', {
            value: restore.mode || 'skip',
            onChange: function (event) { changeRestoreMode(event.target.value) },
            style: { font: 'inherit', fontSize: '11.5px', padding: '3px', marginBottom: '8px' },
          },
          h('option', { value: 'skip' }, t('restore.mode.skip')),
          h('option', { value: 'rename' }, t('restore.mode.rename')),
          h('option', { value: 'overwrite' }, t('restore.mode.overwrite'))),
          h('div', { style: { flex: 1, minHeight: '80px', maxHeight: '220px', overflowY: 'auto', border: '1px solid ' + C.border, borderRadius: '6px', padding: '4px 6px' } },
            restore.done
              ? h('div', { style: { fontSize: '11.5px' } },
                t('restore.done').replace('{count}', String(((restore.result || {}).restored || []).length)))
              : restore.error
                ? h('div', { style: { fontSize: '11.5px', color: 'var(--dsw-alias-label-danger, #d9534f)' } }, restore.error)
                : restore.loading
                  ? h('div', { style: { fontSize: '11.5px', color: C.sub } }, t('history.loading'))
                  : plan.length === 0
                    ? h('div', { style: { fontSize: '11.5px', color: C.sub } }, t('restore.empty'))
                    : plan.map(function (entry, index) {
                      return h('div', { key: index, style: { fontSize: '10.5px', padding: '2px 0' } },
                        (entry.action === 'create' ? '＋ ' : entry.action === 'overwrite' ? '↻ ' : '· ') + entry.rel)
                    })),
          h('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '10px' } },
            h('button', { type: 'button', onClick: function () { setRestore(null) }, style: buttonStyle(false, false) }, t('restore.cancel')),
            restore.done
              ? null
              : h('button', {
                type: 'button',
                onClick: applyRestore,
                disabled: restore.loading === true || (plan.length === 0 && !restore.error),
                style: buttonStyle(true, restore.loading === true || (plan.length === 0 && !restore.error)),
              }, t('restore.confirm')))))
        }

        return h('div', {
          style: {
            position: 'relative', display: 'flex', flexDirection: 'column', height: '100%',
            width: '100%', minWidth: 0, minHeight: 0, overflow: 'hidden',
            fontSize: '12px', color: C.text,
          },
        },
        header,
        body,
        notice === ''
          ? null
          : h('div', { role: 'status', 'aria-live': 'polite', style: { padding: '4px 12px', fontSize: '10.5px', color: C.sub, borderTop: '1px solid ' + C.border } }, notice),
        restoreOverlay)
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
        // 面板里的原生预览按钮要用 sidebarRight；它由同一个右侧栏插件提供，
        // 这里不做硬性 inject，取不到时回退普通预览。
        clientCtx = ctx
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
