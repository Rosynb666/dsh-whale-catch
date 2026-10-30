<div align="center">

# 🐋 Whale Catch

### dsh-whale-catch · every deliverable from this session swims into the basket

**Collect automatically · preview in one place · read the diff in place · zip / archive in one click**

[![CI](https://img.shields.io/github/actions/workflow/status/Rosynb666/dsh-whale-catch/ci.yml?branch=main&style=flat-square&label=CI)](https://github.com/Rosynb666/dsh-whale-catch/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/actions/workflow/status/Rosynb666/dsh-whale-catch/release.yml?style=flat-square&label=Release)](https://github.com/Rosynb666/dsh-whale-catch/actions/workflows/release.yml)
[![npm](https://img.shields.io/npm/v/dsh-whale-catch?style=flat-square&color=4c8bf5&label=npm)](https://www.npmjs.com/package/dsh-whale-catch)
[![downloads](https://img.shields.io/npm/dw/dsh-whale-catch?style=flat-square&color=3c873a&label=downloads)](https://www.npmjs.com/package/dsh-whale-catch)
[![license](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](https://github.com/Rosynb666/dsh-whale-catch/blob/main/LICENSE)
[![node](https://img.shields.io/badge/node-%5E22.19%20%7C%7C%20%3E%3D24-3c873a?style=flat-square)](#limits)
[![DSH](https://img.shields.io/badge/DSH-%E2%89%A5%200.2.0--rc.2-4c8bf5?style=flat-square)](#limits)
[![deps](https://img.shields.io/badge/runtime%20deps-1%20(schemastery)-blue?style=flat-square)](#dev)
[![build](https://img.shields.io/badge/build%20step-none-brightgreen?style=flat-square)](#dev)

[🚀 Quick start](#install) · [✨ Features](#features) · [⚙️ Configuration](#config) · [🛡️ Security](#security) · [中文](https://github.com/Rosynb666/dsh-whale-catch/blob/main/README.md)

</div>

<p align="center">
  <img src="https://raw.githubusercontent.com/Rosynb666/dsh-whale-catch/main/docs/preview.png" alt="Whale Catch panel preview" width="760">
</p>

<p align="center"><sub>🧪 Static preview rendered with the real panel component in <code>lib/client.js</code> and sample data — not a live DSH screenshot. Colours follow your theme.</sub></p>

A right-sidebar plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH): it collects the files a session **produced or changed** into one basket, with preview, inline diff, search, grouping, zip, archive and copy-as-Markdown.

## 🧭 Contents

- [🐋 Why Whale Catch](#why)
- [✨ Features](#features)
- [🚀 Quick start](#install)
- [🖥️ UI and interactions](#ui)
- [🧠 How zero-registration works](#how)
- [⚙️ Configuration](#config)
- [🛡️ Security model](#security)
- [📊 Compatibility and limitations](#limits)
- [🛠️ Development](#dev)
- [🗺️ Roadmap](#roadmap)
- [🤝 Contributing and thanks](#contributing)

---

<a id="why"></a>

## 🐋 Why Whale Catch

After a few turns in DSH, “where did that file go?” becomes routine:

- 🪟 The built-in deliverables card only covers the **current turn** — scroll a few screens and it is gone.
- 🐚 Files written by `python build_doc.py` or `npm run build` inside `bash` are neither a file-tool edit nor a `present` call, so neither mechanism sees them.
- 📦 Sending a dozen deliverables somewhere means digging through the workspace and hoping nothing was missed.
- 🔍 Checking “how much changed / what changed” means switching back to git or scrolling history.

Whale Catch does three things: **collect automatically**, **show in one place**, **zip / archive in one click**. Changed files can also expand a unified diff right there, and search / group-by-turn / copy-as-Markdown live in the same sidebar.

> 💡 **In one sentence:** it does not change your workflow; it just gives “what did this session actually produce?” a permanent answer.

## 🆚 Compared with built-in deliverables

This is not reinventing the wheel: both `deliverables/presented` and `workspace/changes` are consumed as-is. It fills the gaps they leave.

| | 🪟 Built-in deliverables card | 🧺 Whale Catch |
|---|---|---|
| **Sources** | `present` files + git / file-tool edits | the same two, **plus a directory-scan fallback** (bash, python, build scripts) |
| **Scope** | one turn, shown at turn end | **the whole session**, across turns |
| **Change detail** | shown once on the turn-end card | persistent line badges; expand a unified diff in place; group by turn |
| **Actions** | open source file | preview / diff / search / zip / archive / copy path / copy as Markdown |
| **After a Host restart** | change summaries live in memory and are lost | file list rebuilt from mtime (descriptions are lost, see [limitations](#limits)) |
| **Needs agent cooperation** | yes, the model must call `present` | **no**, zero registration |
| **Deliverable boundary** | what the kernel considers output | also catches files written into cwd by external processes |

<a id="features"></a>

## ✨ Features

| Capability | What you get |
|---|---|
| 🧺 **Automatic collection** | `present` declarations, `workspace/changes` edits, and a cwd scan merged by absolute path |
| 👀 **In-place preview** | images / PDF / text / common source files open in a new tab; HTML / SVG render in a CSP sandbox; docx / xlsx / pptx open in the native DSH preview |
| 🔍 **Inline diff** | unified diff for kernel-recorded changes: `+` / `−` colours, `@@` headers, new / deleted / binary / oversized notes |
| 🧭 **Search & grouping** | search by name / path / description; kind chips; group by “Turn N”; copy as Markdown |
| 📦 **Zip** | selected or all files; `manifest.json` + a human-readable checklist inside; cwd-outside files under `_external/` |
| 🗂️ **One-click archive** | relative paths preserved; `(2)` suffixes instead of overwrites; failures reported, never silent |
| 📊 **Line badges** | `+N −M` per file and a session-wide total |
| 🌗 **Theme-aware** | only `--dsw-alias-*` / `--dsw-static-*` tokens; dark / light follows DSH |
| 🌐 **Bilingual** | Chinese and English dictionaries; localised error codes |
| ⚡ **Zero build** | `lib/client.js` is handed to `__ModuleLoader__` as-is |

### 🎁 What's new in 0.3.0

- 📄 **Native Office preview**: click **Native** on a docx / xlsx / pptx to open it in DSH's Document Preview; the kernel's `officeToPdf` does the conversion, and the panel falls back to the normal preview when the preview plugin is disabled or the file lives outside cwd.
- ↕️ **Sorting**: modified / name / size / kind; missing files always sink to the bottom.
- 🪟 **Batched rendering**: the first 200 rows render immediately, **Show more** appends the rest — 800 entries no longer render at once.
- 🧹 **Optional archive retention**: with `archiveKeep: 2`, every archive run gets its own batch directory and only the newest two are kept; the default `0` keeps the old layout unchanged.

### 🎁 What's new in 0.2.2

- 🛑 **Polling no longer rescans the disk**: the 5-second poll reads the cache; scans happen on first open, `turn/end`, and explicit Refresh.
- 🌊 **Streaming zip**: read one file, compress asynchronously, write to the response — no whole-archive buffer.
- 🎯 **Range / ETag**: PDFs and large files can seek without re-downloading.
- 🛡️ **Host allowlist**: blocks the DNS-rebinding case where Origin and Host are both the attacker's domain.
- 🧹 **Archive safety**: `archiveDir == cwd` is rejected, `realpath` stops symlink escapes, failures land in `failed`.
- 🔎 **Panel search**: filter by name / path / description, together with the kind chips.

<a id="install"></a>

## 🚀 Quick start

> **Requirements**
> - DSH `>= 0.2.0-rc.2`
> - Node `^22.19 || >=24` (the Desktop runtime already satisfies this)
> - No build step, no extra service, no database

### 1. Install

On Desktop use the in-app **Settings → Plugins → Install** and paste one of these (the `desktop` profile is owned by the Electron app, so `dsh plugin --profile desktop add` is refused):

```text
github:Rosynb666/dsh-whale-catch     # latest main from GitHub
dsh-whale-catch@0.3.0                # a pinned npm version
```

Only self-managed profiles use the CLI:

```sh
dsh plugin --profile <profile> add github:Rosynb666/dsh-whale-catch
dsh plugin --profile <profile> add dsh-whale-catch@0.3.0
```

### 2. Open the panel

Reload the page (⌘R / Ctrl+R), click `+` in the right sidebar, and pick **“Open Whale Catch”**. You can also click the 🐋 icon in the sidebar.

### 3. Get to work

Let the agent produce something, or click **Refresh** once. Select files → **Zip** or **Archive**.

### Uninstall

Desktop: **Settings → Plugins → Uninstall**. For self-managed profiles:

```sh
dsh plugin --profile <profile> remove dsh-whale-catch
```

---

<a id="ui"></a>

## 🖥️ UI and interactions

A narrow sidebar layout (illustrative; actual width follows the sidebar):

```text
┌──────────────────────────────────────────────┐
│ 🐋 Catch           12 files · 3.4 MB [Refresh]│
│ [All 12] [📄 Docs 7] [📊 Sheets 3] [🖼 2]     │
│ [🔎 Search name, path or description…        ]│
├──────────────────────────────────────────────┤
│ ☑ 📄 report.docx                     +12 −3  │
│    Q3 report · report.docx      [Open] [Diff] ⧉│
│    1.2 MB · 3 min ago · Delivered · Changed   │
│ ☐ 📊 budget-2026.xlsx                         │
│    plan.xlsx · 88 KB · 12 min ago             │
│ ☐ 🖼 product-guide.pdf                        │
│    ...                                        │
├──────────────────────────────────────────────┤
│ 2 selected                    [Archive] [Zip] │
│ scanned just now                              │
└──────────────────────────────────────────────┘
```

### 🎛️ Controls

| Control | What it does |
|---|---|
| ☑️ **Checkbox / row click** | select files; only selected files are zipped / archived; none selected means all |
| 🔄 **Refresh** | force a rescan of the session cwd and fetch a fresh snapshot |
| 🏷️ **Kind chips** | all / docs / sheets / slides / images / code / archives / media / other |
| 🔎 **Search** | case-insensitive substring over name, relative path and description |
| 🔀 **Group by turn** | sections per “Turn N”, newest first, unmarked files last |
| ↕️ **Sort** | modified / name / size / kind; re-renders immediately |
| 📋 **Copy list** | export the selection (or current filter) as Markdown for a report or issue |
| ⧉ **Copy path** | copy the absolute path |
| 👁️ **Open** | open the original file in a new tab; images / PDF / text / source inline |
| 📄 **Native** | hand docx / xlsx / pptx to DSH's Document Preview in the right sidebar |
| 🧾 **Diff** | expand the kernel's unified diff; only entries with a `workspace/changes` record have one |
| 📦 **Zip** | download a zip with the delivery manifest |
| 🗂️ **Archive** | copy into the configured archive directory; shows “N archived / M failed” |
| 🔎 **Show more** | with more than 200 rows, starts with 200 and appends on demand |

### 📦 What the zip looks like

```text
quarterly-delivery.zip
├── report.docx
├── assets/
│   └── chart.png
├── _external/
│   └── external-delivery.pdf
└── _whale-catch/
    ├── manifest.json       # machine-readable: session, entry path, size, turn, sha256…
    └── 交付清单.md          # human-readable Markdown table
```

### 🗂️ What the archive looks like

```text
$DSH_HOME/whale-catch/archive/
└── <session-id>/
    ├── report.docx
    ├── assets/chart.png
    └── _external/external-delivery.pdf
```

With `archiveKeep` enabled, each run gets its own batch directory and old batches are pruned:

```text
$DSH_HOME/whale-catch/archive/
└── <session-id>/
    └── runs/
        ├── 20261030-153012-120/
        │   └── report.docx
        └── 20261030-160145-004/   # keep newest N batches
            └── report.docx
```

<a id="how"></a>

## 🧠 How zero-registration works

Whale Catch does not ask the agent to register files. It merges three sources by **absolute path**:

| Source | From | Covers |
|---|---|---|
| `presented` | `deliverables/presented` session event | files the model explicitly delivered, with description and turn |
| `changed` | `workspace/changes` + `ctx.workspaceChanges.summary()` / `.diff()` | git snapshots and file-tool edits, with line counts and a unified diff |
| `scanned` | a cwd scan (`mtime >= session creation`) | anything written by bash / python / build scripts |

```text
session/event
 ├─ deliverables/presented ──────────────┐
 ├─ workspace/changes ───────────────────┤
 └─ turn/end ──► scan cwd ───────────────┤
                                        ▼
                             Basket（merged by absolute path）
                                        │
                         GET /basket ───┴──► sidebar panel
```

### 🧭 Scan boundaries

- current session **cwd** only; no symlink following;
- `node_modules` / `.git` and other default directories skipped;
- **dot-files and dot-directories skipped** (`.env`, `.gitignore` are not collected automatically; use `present` if they really are deliverables);
- `maxDepth` (6), `maxFiles` (800), `maxFileBytes` (64 MB), and a 20,000-entry visit cap;
- when truncated, the panel shows a “large directory” note.

### ⏱️ When scans happen

| Trigger | Behaviour |
|---|---|
| First panel open | one scan |
| Every `turn/end` | one debounced scan (1.2 s, gives writes time to land) |
| Explicit Refresh | forced rescan; waits for an in-flight scan first |
| 5-second poll | **cache only**, no disk scan |

The session table is **LRU** with 40 entries; snapshot stats use 16-way concurrency.

<a id="config"></a>

## ⚙️ Configuration

Override in your own profile patch layer — do **not** edit the bundled `cordis.patch.yml`:

```yaml
# ~/.dsh/profiles/desktop/cordis.patch.yml
- id: dsh-whale-catch
  config:
    archiveDir: ~/Documents/whale-catch   # default: $DSH_HOME/whale-catch/archive
    ignore: [dist, build, .venv]
    maxFiles: 800
    maxDepth: 6
    maxFileBytes: 67108864
    maxZipBytes: 536870912
    maxBodyBytes: 1048576
    archiveKeep: 0                        # batch retention; 0 disables batch dirs and pruning
    lookbackMinutes: 720
    allowHosts: []                        # extra allowed Host names; localhost / IP literals always pass
```

| Field | Default | Meaning |
|---|---|---|
| `archiveDir` | `$DSH_HOME/whale-catch/archive` | archive root; a leading `~` / `~/` expands |
| `ignore` | `[]` | extra directory names to skip, on top of the built-in list |
| `maxFiles` | `800` | max files collected per scan |
| `maxDepth` | `6` | directory traversal depth |
| `maxFileBytes` | `67108864` | per-file limit; shared by zip and archive |
| `maxZipBytes` | `536870912` | total zip limit; also used for zip preflight |
| `maxBodyBytes` | `1048576` | JSON request-body limit |
| `archiveKeep` | `0` | archive batch retention; `0` keeps the old layout, `> 0` writes `runs/<timestamp>/` and prunes old batches |
| `lookbackMinutes` | `720` | fallback window when session creation time is unavailable |
| `allowHosts` | `[]` | extra allowed Host names (reverse proxies); IP literals and `localhost` always pass |

Hot reload picks it up; no restart needed.

<a id="security"></a>

## 🛡️ Security model

The routes live on the loopback Host. The threat model is **a third-party page in your browser hitting the local API**, not other local processes (they can already read your files).

| Defence | What it does |
|---|---|
| 🚧 **Path allowlist** | `/file`, `/diff`, `/zip`, `/archive` only accept paths already in the basket; `../` is rejected at the allowlist. `/diff` is narrower: only entries with a `workspace/changes` record |
| 🌐 **Origin + Host** | `Origin` must match `Host`; `Sec-Fetch-Site: cross-site` is rejected; Host must be `localhost`, an IP literal, or an `allowHosts` entry |
| 🧾 **JSON writes** | cross-site forms cannot send `application/json`; declaring it triggers a preflight that this route rejects with 415 |
| 🧪 **Inline sandbox** | HTML / SVG responses carry `Content-Security-Policy: sandbox`: styles still render, scripts do not run, origin becomes opaque |
| 📦 **Zip checks** | entry names drop `..` and leading slashes; manifest names are reserved; cwd-outside files go to `_external/` |
| 🗂️ **Archive checks** | `realpath` keeps the parent under the archive root; symlink escapes become `unsafe-path`; `archiveDir == cwd` is rejected; pruning only removes time-named directories under `runs/` |
| 📏 **Hard caps** | 64 MB per file, 512 MB per zip, 800 files, 1 MB request body — all configurable |
| 🚫 **Visible failures** | oversized / unsafe / copy failures land in `failed`; the panel reports both counts |

> **Privacy notes**
> - The zip's `_whale-catch/manifest.json` and checklist record the cwd (home prefix redacted to `~`), session id and sha256. Review before sharing.
> - The scan deliberately skips dot-files so `.env` / `.gitignore` are not collected automatically.
> - For security reports use the private channel in [SECURITY.md](https://github.com/Rosynb666/dsh-whale-catch/blob/main/SECURITY.md).

<a id="limits"></a>

## 📊 Compatibility and limitations

### ✅ Compatibility

| Item | Range |
|---|---|
| DSH | `>= 0.2.0-rc.2` |
| Native preview | needs DSH `>= 0.2.1` (Document Preview + `sidebarRight.openResource()`); older versions fall back to the normal preview |
| Node | `^22.19 || >=24` |
| Platforms | macOS / Windows / Linux (CI: three platforms × Node 22/24) |
| Build | none; `lib/client.js` loads as-is |
| Runtime dependency | `@deepseek-ai/schemastery` (validation only) |

### ⚠️ Known limitations

| Limitation | Impact / note |
|---|---|
| Current session cwd only | files outside cwd are not collected, except absolute paths declared via `present` |
| Host restart | `present` descriptions and turn numbers are lost; files reappear via mtime |
| Old mtime | files whose mtime predates the session are skipped |
| Diffs depend on Host lifetime | `workspace-changes` keeps comparisons in memory; after a restart old turns have no diff |
| Diffs depend on kernel capability | a Host without `workspaceChanges.diff()` shows the “no readable diff” note |
| Long diffs truncated | `/diff` returns at most 1200 lines; the panel renders at most 300 lines per hunk |
| No archive cleanup by default | the archive lives under `$DSH_HOME` and is not pruned; set `archiveKeep` to retain batches |
| Browser-bound preview | PDF / images / text / common source inline; HTML/SVG sandboxed; Office opens in the native DSH preview, files outside cwd still download |
| Large lists | the first 200 rows render, the rest via **Show more**; no true virtualization yet; search is substring only |
| Dot-files not auto-collected | `.env` and friends need an explicit `present` |

### ❓ FAQ

<details>
<summary><b>The panel is empty — what now?</b></summary>

Check that the session has a cwd, let the turn finish, then click **Refresh**. A file's mtime must not predate the session; dot-files are skipped. If it still fails, look for `no-cwd` / `scan` errors in the Host log.
</details>

<details>
<summary><b>Why is there no Diff button?</b></summary>

Only files with a `workspace/changes` record have before/after snapshots. Scanned files and plain `present` files do not; comparisons also disappear after a Host restart.
</details>

<details>
<summary><b>Why does docx / xlsx download instead of preview?</b></summary>

Browsers do not render Office natively. Click **Native** on the row and Whale Catch hands the file to DSH's Document Preview, which renders it as a PDF in the right sidebar; only files outside cwd, or a disabled preview plugin, fall back to a download.
</details>

<details>
<summary><b>npm pack fails with EPERM / cache permissions?</b></summary>

A restricted environment may block writes to `~/.npm`. Use a writable cache instead of sudo:

```sh
npm pack --dry-run --cache="$(mktemp -d)"
```
</details>

<a id="dev"></a>

## 🛠️ Development

```sh
npm install
npm test        # 65 tests: scan / merge / change metadata / streaming zip / Range / HTTP fence / diff trim / native addresses / archive retention / plugin load
npm run check   # contract self-check: package shape, patch, client.inject, locale meta, icon, deps
npm run verify  # check + test
```

**No build step:** `lib/index.js` is the Host half; `lib/client.js` is the browser half handed verbatim to `__ModuleLoader__`.

**Dependency discipline:** the only runtime dependency is `@deepseek-ai/schemastery` (a pure validation library). It must be a real dependency, not a peer: profiles pin `autoInstallPeers: false`, so a peer would never be installed in a clean profile and the Host half would fail to load.

```text
dsh-whale-catch/
├── lib/
│   ├── index.js      # plugin entry: session events → basket registry, HTTP routes
│   ├── basket.js     # three-source merge, change metadata, snapshot, path allowlist
│   ├── scan.js       # bounded workspace scan
│   ├── zip.js        # zero-dependency streaming ZIP writer (STORE + DEFLATE)
│   ├── routes.js     # HTTP routes: preview / diff / zip / archive
│   ├── http.js       # Origin + Host fence, JSON, MIME, Range
│   └── client.js     # right-sidebar tab + panel (plain JS, zero build)
├── locale/           # metadata for marketplace/settings
├── test/             # node:test, no framework dependency
├── scripts/          # contract self-check
└── docs/             # architecture, release checklist, dev playbook
```

- 🏗️ Architecture: [docs/architecture.md](https://github.com/Rosynb666/dsh-whale-catch/blob/main/docs/architecture.md)
- 🚢 Release checklist: [docs/publish.md](https://github.com/Rosynb666/dsh-whale-catch/blob/main/docs/publish.md)
- 🤝 Contributing: [CONTRIBUTING.md](https://github.com/Rosynb666/dsh-whale-catch/blob/main/CONTRIBUTING.md)
- 🛡️ Security: [SECURITY.md](https://github.com/Rosynb666/dsh-whale-catch/blob/main/SECURITY.md)

<a id="roadmap"></a>

## 🗺️ Roadmap

- 🌉 Cross-session view: one ledger for every session's deliverables.
- 💾 Persist `present` descriptions and turns across Host restarts.
- 🧹 Archive cleanup dry-runs, plus date / project views (`archiveKeep` already retains batches).
- ⚡ True virtualization for large lists (currently 200-row batches with **Show more**).
- 🧪 Real client-render tests, `tsc --checkJs` and lint.

<a id="contributing"></a>

## 🤝 Contributing and thanks

- Bugs / ideas: use the [issue templates](https://github.com/Rosynb666/dsh-whale-catch/issues/new/choose).
- Code: read [CONTRIBUTING.md](https://github.com/Rosynb666/dsh-whale-catch/blob/main/CONTRIBUTING.md) first.
- Security: do not open a public issue; follow [SECURITY.md](https://github.com/Rosynb666/dsh-whale-catch/blob/main/SECURITY.md).

Thanks to everyone who described the “file generated, then lost” pain, and to the DSH community members who mapped the plugin boundaries before us.

> 🐋 **Whale Catch** is maintained with love, rice and a mild case of OCD.
> If it saves you one trip through a folder tree, a ⭐ is the best tip.

## 📄 License

[MIT](https://github.com/Rosynb666/dsh-whale-catch/blob/main/LICENSE) © Rosynb666
