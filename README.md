# CC Manager UI

One daemon, two jobs: it's a **multi-instance Claude Desktop manager** (see every isolated Desktop
instance on the machine, which Anthropic account each is logged into, open/quit/create/delete them)
**and** a **Claude Code session scheduler + dispatch queue** (browse local Claude Code sessions,
tail their transcripts, and queue/dispatch `claude` CLI runs — each with its own prompt, model,
effort, permission mode, and account).

It brings a multi-instance management backend together with a mature scheduler / queue /
dispatch / sessions app on the shared house stack: same `lunarwerx-ui` kit, same Bun + Hono
daemon shape, same browser + system-tray launcher.

## Stack

| Layer | Choice |
|---|---|
| Frontend | Vue 3 + Vite, **shared `lunarwerx-ui` kit** (shadcn-vue `reka-mira` on Reka UI), Tailwind v4, `@lucide/vue`, TypeScript |
| Backend | **Bun + Hono**, `bun:sqlite` (queue/dispatch/scheduler/accounts) + JSON under `CONFIG_DIR` (instance identity cache, settings), SSE (`hono/streaming`) for live run output |
| Dispatch | `Bun.spawn` of the real `claude` CLI (no Agent SDK) |
| Multi-instance | per-OS instance discovery/launch/quit/create (`server/src/core/*`) — Windows DPAPI / macOS Keychain / Linux libsecret for reading each isolated instance's stored credentials |
| Theme | kit `useTheme()` — dark-default, `localStorage['lunarwerx-theme']`, no-flash boot |
| Launcher | Windows browser + system-tray (`misc/`) — Open / Rebuild & Restart / Restart / Quit |
| Tooling | Biome (vendored kit files excluded from lint) |

## Features

- **Instances** — list every isolated Claude Desktop instance on the machine (running state, PID,
  size, uptime), resolve which Anthropic account each is signed into (email + plan/tier), and
  open / quit / create / delete instances from one sortable table.
- **Sessions** — browse local Claude Code sessions (`~/.claude/projects/**/*.jsonl`), tail
  transcripts live, with "thinking" hidden by default.
- **Queue + Scheduler** — build a queue of `claude` CLI runs (prompt, model, effort, permission
  mode, account, new-chat/fork), dispatch on demand or let the scheduler run them with
  concurrency + spacing controls. Scheduler is **off by default**.

## Requirements

- **[Bun](https://bun.sh)** on PATH (the daemon, build, and test runner all use it).
- Windows for the browser + tray launcher and the multi-instance Windows-credential path (DPAPI via
  `bun:ffi`); macOS (Keychain) and Linux (libsecret) instance-account resolution are source-accurate
  but not yet verified on those platforms.
- The `claude` CLI installed (for real dispatch) and/or Claude Desktop installed (for instance
  management).
- **Windows Claude Desktop build matters:** instance management needs the **classic (Squirrel
  `.exe`) installer** (~217 MB, installs to `%LOCALAPPDATA%\AnthropicClaude`). The newer
  **MSIX** build (what the claude.ai download page's ~7 MB `ClaudeSetup.exe` bootstrapper
  installs, under `C:\Program Files\WindowsApps`) can't be launched with an isolated profile.
  The Instances tab detects an MSIX-only machine and links the classic installer
  ([latest x64 exe](https://claude.ai/api/desktop/win32/x64/exe/latest/redirect)).

## Run it

```
bun install
```

**Desktop (the normal way):** double-click `CCManagerUI.lnk` in the repo root → a **system-tray
icon** appears (right-click: Open / Rebuild & Restart / Restart / Quit) and the browser opens the
UI. The daemon serves the built SPA + API on one port (preferred **7787**, hops if busy and records
the real URL in `~/.ccmanagerui/runtime.json`). First run installs deps / builds the SPA
automatically if needed.

**Dev (two processes, hot reload):**

```
bun run dev          # Hono API on :7787 + Vite web on :5173  → http://localhost:5173
```

**Single process (prod):** `bun run build && bun run start` → the Hono daemon serves `web/dist` + API.

### Safety / fake mode

Dispatch spawns the **real** `claude` CLI (spends quota, acts on real repos). Set
`CCMANAGERUI_FAKE=1` to exercise the whole dispatch→parse→stream→status pipeline with a harmless
stand-in (`server/src/fake-claude.ts`). The scheduler is **off by default**; queued items only run
on the **Run** button or when you enable the scheduler in Settings.

Multi-instance actions (open/quit/create/delete) act on **real** Claude Desktop instances and
their local data directories — delete is a guarded, confirm-by-name operation.

## Config (env)

| Var | Default | Meaning |
|---|---|---|
| `PORT` | `7787` | preferred API/UI port (hops if busy) |
| `CCMANAGERUI_PORT_FIXED` | unset | `1` = bind PORT exactly, skip the single-instance/port-hop |
| `CCMANAGERUI_HOME` | `~/.ccmanagerui` | config dir (`runtime.json`, instance-identity cache live here) |
| `CCMANAGERUI_SHUTDOWN_TOKEN` | unset | if set, `/api/shutdown` requires the matching `x-ccmanagerui-shutdown-token` header (the tray sets it) |
| `CCMANAGERUI_FAKE` | unset | dispatch uses the harmless fake CLI |
| `CCMANAGERUI_DB` | `server/data/ccmanagerui.db` | sqlite path |

`/api/health` returns `service: "ccmanagerui"` — load-bearing for the single-instance pointer.

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

17 tools: sessions (list/get/tail), queue (list/add/update/run/cancel/events), accounts (secrets always masked), scheduler (get/set), instances (list/launch/quit), update check. Mutating tools say "MUTATES:" in their description; there is deliberately no shutdown tool.

## Auto-update

Opt-in background self-update (off by default; it restarts the daemon):

```
POST /api/update/settings   { "enabled": true, "intervalSecs": 21600 }
```

`intervalSecs` clamps to [900, 604800]; default 21600 (6h). Each tick checks the remote and, only if the working tree is clean, applies (`git pull --ff-only` + reinstall + rebuild) and relaunches itself on the same port (`CCMANAGERUI_RELAUNCH=1` makes the successor wait for the predecessor to free it). A dirty tree is never touched. `GET /api/update` includes the current state under `autoUpdate`.

## Layout

```
server/    Bun + Hono daemon: sqlite, session reader, transcript tail, dispatch, scheduler,
           instance pointer, core/ (multi-instance crypto/paths/process/instances/lifecycle/accounts)
web/       Vue 3 SPA on the shared kit (Sessions / Queue / Instances views)
tests/     launcher.test.ts (the tray guard, Windows-gated) + server/instance unit tests
misc/      the Windows launcher toolkit (tray .ps1 / .vbs / .ico / Create-Shortcut / Make-Icon / Rebuild.bat)
```

## Shared kit

The UI primitives, tokens, shell (`AppContainer`, `SettingsPanel`/`usePushPanel`), theme, and the
server libs (`instance-pointer`, `find-free-port`) are **synced** from an internal shared
LunarWerx UI kit, not hand-written. CC Manager UI is registered there under the `ccmanagerui` sync
target (build-time only, invisible to users); kit updates are pulled in by the kit's own owner-run
sync tooling.

Do **not** hand-edit the synced files (`web/src/components/ui/**`, `web/src/shell/**`, the synced
`web/src/lib/*`, `web/src/styles/kit-*.css`, and `server/src/{instance-pointer,find-free-port}.*`).

> `bun run check` (below) runs `check:kit` against this kit, which needs an internal LunarWerx kit
> checkout — it's owner-only and is skipped in CI. External contributors should run the individual
> checks (`lint`, `check:i18n`, `build`, `test`, `typecheck`) instead of the aggregate `check`.

## Checks

`bun run check` runs Biome + the i18n gate + the kit drift-check:
- `bun run --cwd web check:i18n` — no hardcoded UI strings; every `t()` key resolves (also gates `build`).
- `bun run check:kit` — `sync.mjs --check` against the kit; fails if a synced file drifted.
- `bun test` — includes the Windows-gated tray launcher guard and instance/crypto tests.

## Deviations from the sibling apps (deliberate)

- **Full-width dashboard.** Sessions is a two-pane master/detail monitor, so the main area is
  full-width rather than wrapped in `AppContainer` (the siblings are single-column list apps). The
  kit tokens/components/theme/shell-panel are all used; only the width cap is skipped for the grid.
- **Browser + tray, not a native webview.** Unlike the multi-instance backend's origin app,
  CC Manager UI keeps its original desktop shell: no frameless window, no embedded webview — just
  the daemon + your regular browser + a system-tray icon for lifecycle control.
