# 🐋 Whale Catch · dsh-whale-catch

> **Zero registration.** Every file this session produced swims into the basket on its own.

English | [中文](README.md)

A right-sidebar plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH): it collects the files a session produced or changed into one basket, so you can preview them, read the diff, bundle them into a zip, or archive them in one click.

[![CI](https://github.com/Rosynb666/dsh-whale-catch/actions/workflows/ci.yml/badge.svg)](https://github.com/Rosynb666/dsh-whale-catch/actions/workflows/ci.yml)
[![Release](https://github.com/Rosynb666/dsh-whale-catch/actions/workflows/release.yml/badge.svg)](https://github.com/Rosynb666/dsh-whale-catch/actions/workflows/release.yml)
![license](https://img.shields.io/badge/license-MIT-blue)
![DSH](https://img.shields.io/badge/DSH-%E2%89%A5%200.2.0--rc.2-4c8bf5)
![node](https://img.shields.io/badge/node-%E2%89%A5%2022.19-3c873a)
![deps](https://img.shields.io/badge/runtime%20deps-1%20(schemastery)-blue)
![build](https://img.shields.io/badge/build%20step-none-brightgreen)

---

## Why

Working with DSH, "where did that file go?" is routine:

- The built-in deliverables card only covers the **current turn** — scroll a few screens and it is gone.
- Files written by `python build_doc.py` inside `bash` are neither a file-tool edit nor a `present` call, so neither mechanism sees them.
- Sending a dozen deliverables somewhere means digging through the workspace and hoping nothing was missed.

Whale Catch does exactly three things: **collect automatically**, **show in one place**, **zip / archive in one click** — and for changed files, open the diff right there instead of digging through git.

## How it differs from the built-in deliverables

It does not reinvent the wheel: both `deliverables/presented` and `workspace/changes` are consumed as-is. It fills the gaps they leave.

| | Built-in deliverables card | Whale Catch |
|---|---|---|
| Sources | `present` files + git / file-tool edits | the same two, **plus a directory-scan fallback** (bash, python, build scripts) |
| Scope | one turn, shown at turn end | the whole session, across turns |
| Change detail | shown once on the turn-end card | line badges persist; expand a unified diff in place; group by turn |
| Actions | open source file | preview / diff / zip / archive / copy path / copy as Markdown |
| After a Host restart | change summaries live in memory and are lost | rebuilt from mtime (descriptions are lost, see limitations) |
| Needs the agent to cooperate | yes, the model must call `present` | **no** |

## Install

Requires DSH `>= 0.2.0-rc.2` and Node `^22.19 || >=24` (the Desktop runtime already satisfies both).

```sh
# from GitHub
dsh plugin --profile desktop add github:Rosynb666/dsh-whale-catch

# from npm
dsh plugin --profile desktop add dsh-whale-catch

# local development
dsh plugin --profile desktop add /absolute/path/to/dsh-whale-catch
```

Reload the page (⌘R), click `+` in the right sidebar and pick **“Open Whale Catch”**.

```sh
dsh plugin --profile desktop remove dsh-whale-catch
```

## UI

```text
┌──────────────────────────────────────┐
│ 🐋 Catch           12 files · 3.4 MB [Refresh] │
│ [All 12] [📄 Docs 7] [📊 Sheets 3] [🖼 2]       │
├──────────────────────────────────────┤
│ ☑ 📄 lab-report.docx            +12 −3 │
│    First lab · report.docx [Open] [Diff] ⧉ │
│    1.2 MB · 3 min ago · Delivered       │
│ ☐ 📊 training-plan.xlsx                │
│ ☐ 🖼 render-evidence.pdf               │
├──────────────────────────────────────┤
│ 2 selected              [Archive] [Zip] │
└──────────────────────────────────────┘
```

- **Diff** → expands the unified diff the kernel recorded for that change (`+` / `−` colouring, `@@` headers); binary and oversized files get a clear note instead.
- **Group by turn** → sections per "Turn N", so you can see what each turn produced.
- **Copy list** → copies the current list as Markdown (name, path, size, turn, line counts, description), ready for a report or an issue.
- **Zip** → bundles `_whale-catch/manifest.json` plus a human-readable `交付清单.md` checklist (path, size, turn, line counts, sources, sha256), so the archive explains itself without the plugin.
- **Select** → zip only the selected files; nothing selected means “zip everything”.
- **Archive** → copies into the archive directory, preserving relative paths, never overwriting (adds ` (2)`); files outside the cwd go to `_external/`.
- **Open** → opens the original file in a new tab (images / PDF / text inline, Office downloads).
- **⧉** → copy the absolute path.

## How zero-registration works

Three sources merged by absolute path:

| Source | From | Covers |
|---|---|---|
| `presented` | `deliverables/presented` session event | files the model explicitly delivered, with description and turn |
| `changed` | `workspace/changes` + `ctx.workspaceChanges.summary()` / `.diff()` | git snapshots and file-tool edits, with line counts and a unified diff |
| `scanned` | a workspace scan (`mtime >= session creation`) | anything written by bash / python / build scripts |

The scan is bounded: current cwd only, no symlinks, `node_modules` / `.git` / dot-directories skipped, with depth / count / size caps. See [docs/architecture.md](docs/architecture.md).

## Configuration

Override in your own profile patch layer — do **not** edit the bundled `cordis.patch.yml`:

```yaml
- id: dsh-whale-catch
  config:
    archiveDir: ~/Documents/whale-catch   # ~ expands; default: $DSH_HOME/whale-catch/archive
    ignore: [dist, build, .venv]
    maxFiles: 800
    maxDepth: 6
    maxFileBytes: 67108864
    lookbackMinutes: 720
```

Hot reload picks it up; no restart needed.

## Security model

These routes live on the loopback Host, so the threat model is *a third-party page in your browser*, not other local processes:

- **Path allowlist** — `/file`, `/diff`, `/zip`, `/archive` only accept paths already in the basket; there is no arbitrary file read, and `../` is rejected at the allowlist. `/diff` is narrower still: only entries with a `workspace/changes` record are diffable.
- **Same-origin fence** — a mismatched `Origin` or `Sec-Fetch-Site: cross-site` gets 403.
- **Writes must be `application/json`** — cross-site forms cannot send it, and declaring it triggers a preflight that this route rejects with 415.
- **Sandboxed inline preview** — HTML / SVG would inherit the Host origin, so those responses carry `Content-Security-Policy: sandbox`: they still render, but scripts do not run and the origin is opaque, so a previewed file cannot call the local API.
- **Zip / archive hardening** — entry names drop `..` and leading slashes; archive writes verify the target stays under the archive root; files outside the cwd go to `_external/` instead of mirroring absolute paths.
- **Hard caps** — 64 MB per file, 512 MB per zip, 800 files, 1 MB request body. Oversized files are skipped and reported to the panel via `X-Whale-Catch-Skipped`.

## Known limitations

- Current session **working directory** only (except absolute paths declared via `present`).
- After a Host restart, `present` descriptions and turn numbers are gone; files reappear via mtime.
- Files whose mtime predates the session are skipped.
- **Diffs live only as long as the Host does**: `workspace-changes` keeps the comparison in memory, so after a restart old turns show a "no readable diff" note.
- Diffs come from the kernel's `workspaceChanges.diff()`. On a Host without that capability the panel degrades to the same note; everything else keeps working.
- `/diff` returns at most 1200 lines and the panel renders at most 300 lines per hunk; long diffs are truncated and marked.
- The archive directory lives under `$DSH_HOME`; it does not sync to a cloud drive.
- Preview relies on the browser: PDF / images / text inline, HTML / SVG render in a sandbox (styles kept, scripts blocked), docx / xlsx download.

## Development

```sh
npm install
npm test        # 50 tests: scan / merge / change metadata / zip format / HTTP fence / diff trim & timeout / client registration / plugin load
npm run check   # contract self-check (package shape, patch, client.inject, meta, icon, deps)
npm run verify  # both
```

No build step: `lib/index.js` is the Host half, `lib/client.js` is the browser half handed verbatim to `__ModuleLoader__`. The only runtime dependency is `@deepseek-ai/schemastery` (a pure validation library), declared as a real dependency on purpose: profiles pin `autoInstallPeers: false`, so a peer would never be installed in a clean profile and the Host half would fail to load.

Architecture: [docs/architecture.md](docs/architecture.md) ·
Release checklist: [docs/publish.md](docs/publish.md)

## License

[MIT](LICENSE)
