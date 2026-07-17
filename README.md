<div align="center">

<img alt="CC Manager UI — run, queue and orchestrate Claude: many instances, one dashboard" src=".github/og-image.png" width="820" />

### Run, queue and orchestrate Claude — from one dashboard

One daemon on your machine turns every isolated Claude Desktop instance, every Claude Code
session, and a whole queue of `claude` runs into a single dashboard in your browser.<br/>
No more hunting across windows, terminals and accounts to remember what each Claude is doing.

[**Website**](https://ccmanagerui.github.io) &nbsp;·&nbsp; [Features](#what-you-get) &nbsp;·&nbsp; [Quick start](#quick-start) &nbsp;·&nbsp; [MCP](#mcp-server) &nbsp;·&nbsp; [Releases](https://github.com/LunarWerxs/ccmanagerui/releases) &nbsp;·&nbsp; [Changelog](CHANGELOG.md)

[![Website](https://img.shields.io/badge/website-ccmanagerui.github.io-c15f3c?style=flat-square)](https://ccmanagerui.github.io)
[![CI](https://img.shields.io/github/actions/workflow/status/LunarWerxs/ccmanagerui/ci.yml?branch=main&style=flat-square&label=CI)](https://github.com/LunarWerxs/ccmanagerui/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/LunarWerxs/ccmanagerui?style=flat-square&color=c15f3c)](https://github.com/LunarWerxs/ccmanagerui/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-c15f3c?style=flat-square)](LICENSE)

</div>

---

**CC Manager UI** is a local dashboard for running Claude. See every isolated Claude Desktop instance and which account it's on, browse and live-tail your Claude Code sessions, and build a queue of `claude` runs — each with its own prompt, model, effort, permissions and account — dispatched on demand or on a schedule. One daemon, your browser, a tray icon. Nothing leaves your machine.

## Why it exists

If you run Claude in more than one place — a couple of isolated Desktop instances on different
accounts, a pile of Claude Code sessions across repos, a terminal or three — there's no single
place that shows you all of it. You end up alt-tabbing to remember which account is which, whether
a session is still going, and what you asked it to do. CC Manager UI is that missing place: **one
daemon that reads what's already on your machine and gives you (and your agents, over MCP) one pane
to see it, message it, queue it and schedule it** — without sending anything to a cloud.

## What you get

- 🎛️ &nbsp;**Multi-instance manager** — every isolated Claude Desktop instance on the machine, its account (email + plan), live memory and uptime, in one sortable table. Open / quit / create / delete / rename, and drop a per-instance desktop shortcut.
- 🧵 &nbsp;**Sessions across every instance** — browse and live-tail your Claude Code transcripts (`~/.claude/projects`), filtered by instance, with "thinking" hidden by default. Open the raw `.jsonl`, download it, or copy the file itself to the clipboard — both named after the session, not its uuid.
- 💬 &nbsp;**Chat composer** — type at the bottom of a transcript and dispatch straight to that session; queue it, or schedule for later (an exact hours + 10-minute delay, 5 h, or tomorrow). Multi-select to message many sessions at once.
- ⏱️ &nbsp;**Queue + scheduler** — build a queue of `claude` runs (prompt, model, effort, permission mode, account) and dispatch on demand, or let the scheduler run them with concurrency + spacing controls. Off by default.
- ♻️ &nbsp;**Runs that survive a restart** — dispatched runs run under a detached supervisor and reattach after a quit or an auto-update, instead of dying mid-flight.
- 🌙 &nbsp;**Auto-resume past a rate limit** — sessions stopped by a 5-hour limit are picked back up once the window resets, including ones you started yourself in a terminal (found by checking recent transcripts, not just runs the app launched). Gated on your weekly usage, capped per session. Off by default — it prompts sessions while you sleep. A 529 overload is a different animal and is handled separately: those retry in seconds, automatically, with no opt-in.
- 🏠 &nbsp;**Local & private** — one daemon on your machine + your regular browser + a tray icon. No cloud, no account needed to run it.

## Quick start

**Download a release (no Bun needed):** grab the bundle for your OS from
[Releases](https://github.com/LunarWerxs/ccmanagerui/releases) — a self-contained executable
(Windows x64, Linux x64/arm64, macOS x64/arm64) with the web UI beside it. Unzip and run
`CCManagerUI.exe` (or `./ccmanagerui`); on Windows, `misc\Tray-Launch.vbs` gives you the
system-tray icon instead of a console window.

**Or run from source:**

```sh
git clone https://github.com/LunarWerxs/ccmanagerui.git
cd ccmanagerui && bun install
bun run build && bun run start      # daemon serves the UI + API on http://localhost:7787
```

Or **desktop**: double-click `CCManagerUI.lnk` in the repo root for a **system-tray icon** (Open / Restart / Quit) that boots the daemon and opens the UI in your browser. The daemon prefers port **7787**, hops if it's busy, and records the real URL in `~/.ccmanagerui/runtime.json`.

**Dev (hot reload):** `bun run dev` — Hono API on `:7787` + Vite web on `:5173` → http://localhost:5173

> **Trying it out?** Set `CCMANAGERUI_FAKE=1` so dispatch uses a harmless stand-in for the `claude` CLI (no quota, no real repos). The scheduler is off by default; queued items only run on the **Run** button or when you enable the scheduler in Settings. Multi-instance actions (open / quit / create / delete) act on **real** Claude Desktop instances — delete is a guarded, confirm-by-name operation.

## Requirements

- **[Bun](https://bun.sh)** on PATH (the daemon, build, and test runner all use it).
- **Windows** for the browser + tray launcher and the Windows-credential path (DPAPI via `bun:ffi`); macOS (Keychain) and Linux (libsecret) instance-account resolution are source-accurate but not yet verified there.
- The `claude` CLI (for real dispatch) and/or Claude Desktop (for instance management).
- **Windows Claude Desktop build matters:** instance management needs the **classic (Squirrel `.exe`) installer** (~217 MB, into `%LOCALAPPDATA%\AnthropicClaude`). The newer **MSIX** build (the claude.ai `ClaudeSetup.exe` bootstrapper, under `C:\Program Files\WindowsApps`) can't be launched with an isolated profile. The Instances tab detects an MSIX-only machine and links the classic installer ([latest x64 exe](https://claude.ai/api/desktop/win32/x64/exe/latest/redirect)).

## MCP server

The daemon's REST API is also exposed over MCP stdio (`server/src/mcp.ts`, or `bun run mcp`), so agents (Claude Code, Claude Desktop, Cursor) can drive sessions, the run queue, accounts, the scheduler, and instances the same way the web UI does. Start the daemon first; the MCP server follows its actual bound port via the runtime pointer, overridable with `CCMANAGERUI_URL` (full base URL) or `CCMANAGERUI_PORT`.

```json
{
  "mcpServers": {
    "ccmanagerui": {
      "command": "bun",
      "args": ["run", "--cwd", "<path-to-ccmanagerui>", "mcp"]
    }
  }
}
```

Tools cover sessions (list / get / tail), the queue (list / add / update / run / cancel / events), accounts (secrets always masked), the scheduler (get / set), instances (list / launch / quit), CLI instances (list / create / launch / login helper), usage-check (`check_usage`, `check_my_usage`), and the auto-resume monitor (get / set), plus an update check. Mutating tools say `MUTATES:` in their description; there is deliberately no shutdown tool.

### Usage-check

`check_usage { account?, configDir? }` and `check_my_usage {}` let any MCP-speaking agent read an account's remaining Claude subscription quota without asking a human. Pass `account` (a saved dispatch account id or label) or `configDir` (a `CLAUDE_CONFIG_DIR` that's been `/login`'d once); `check_my_usage` is a shorthand self-check of the calling process's own `CLAUDE_CONFIG_DIR`. Both report the session (5h) %, the weekly (all-models) %, and any per-model weekly %.

**The weekly (all-models) % is the binding cap.** A fresh session % is a red herring when weekly is near 100, and switching the flagship model doesn't dodge the shared weekly bucket. An agent should check its own quota before a heavy multi-agent fan-out and pace accordingly, routing heavy work to whichever account has the lowest weekly %.

## Config (env)

| Var | Default | Meaning |
|---|---|---|
| `PORT` | `7787` | preferred API/UI port (hops if busy) |
| `CCMANAGERUI_PORT_FIXED` | unset | `1` = bind `PORT` exactly, skip the single-instance/port-hop |
| `CCMANAGERUI_HOME` | `~/.ccmanagerui` | config dir (`runtime.json`, instance-identity cache) |
| `CCMANAGERUI_SHUTDOWN_TOKEN` | unset | if set, `/api/shutdown` requires a matching `x-ccmanagerui-shutdown-token` header (the tray sets it) |
| `CCMANAGERUI_FAKE` | unset | dispatch uses the harmless fake CLI |
| `CCMANAGERUI_DB` | `server/data/ccmanagerui.db` | sqlite path |

`/api/health` returns `service: "ccmanagerui"` — load-bearing for the single-instance pointer.

## Auto-update

Opt-in background self-update (off by default; it restarts the daemon):

```
POST /api/update/settings   { "enabled": true, "intervalSecs": 21600 }
```

`intervalSecs` clamps to [900, 604800]; default 21600 (6h). Each tick checks the remote and, only if the working tree is clean, applies (`git pull --ff-only` + reinstall + rebuild) and relaunches itself on the same port (`CCMANAGERUI_RELAUNCH=1` makes the successor wait for the predecessor to free it). A dirty tree is never touched.

## Stack

| Layer | Choice |
|---|---|
| Frontend | Vue 3 + Vite, a shared LunarWerx UI kit (shadcn-vue `reka-mira` on Reka UI), Tailwind v4, `@lucide/vue`, TypeScript |
| Backend | **Bun + Hono**, `bun:sqlite` (queue / dispatch / scheduler / accounts) + JSON under `CONFIG_DIR`, SSE (`hono/streaming`) for live run output |
| Dispatch | `Bun.spawn` of the real `claude` CLI (no Agent SDK) |
| Multi-instance | per-OS instance discovery / launch / quit / create (`server/src/core/*`) — Windows DPAPI / macOS Keychain / Linux libsecret for reading each isolated instance's stored credentials |
| Launcher | Windows browser + system-tray (`misc/`) |

## Layout

```
server/    Bun + Hono daemon: sqlite, session reader, transcript tail, dispatch, scheduler,
           instance pointer, core/ (multi-instance crypto/paths/process/instances/lifecycle/accounts)
web/       Vue 3 SPA (Sessions / Queue / Instances views)
tests/     launcher.test.ts (the tray guard, Windows-gated) + server/instance unit tests
misc/      the Windows launcher toolkit (tray .ps1 / .vbs / .ico / Create-Shortcut / Make-Icon / Rebuild.bat)
```

## Checks

`bun run check` runs Biome + the i18n gate + a kit drift-check. The kit check needs an internal LunarWerx kit checkout, so it's **owner-only and skipped in CI** — external contributors should run the individual checks instead:

- `bun run lint` — Biome.
- `bun run --cwd web check:i18n` — no hardcoded UI strings; every `t()` key resolves (also gates `build`).
- `bun test` — includes the Windows-gated tray launcher guard and instance/crypto tests.
- `bun run typecheck` — web (`vue-tsc`) + server (`tsc`).

## License

[MIT](LICENSE).
