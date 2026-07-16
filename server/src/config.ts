import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import rootPkg from '../../package.json'

const HOME = homedir()
const APPDATA = process.env.APPDATA ?? join(HOME, 'AppData', 'Roaming')

/** App version — the root package.json's, bundled at build time (the JSON import is embedded into
 *  a compiled binary, so `--version` answers without any file on disk). */
export const VERSION: string = rootPkg.version

/**
 * True when running inside a `bun build --compile` binary. In that mode `import.meta.dir` is a
 * VIRTUAL embedded-filesystem path (`$bunfs` on POSIX, `B:\~BUN` on Windows) — not a real, writable
 * disk location — so "does my own source file exist on real disk?" is the mode probe. Deliberately
 * NOT a match on Bun's placeholder path string: the string is Bun-internal, the disk probe is not.
 */
export const IS_COMPILED = !existsSync(join(import.meta.dir, 'config.ts'))

/** Canonical Claude Code CLI transcript store: <home>/.claude/projects/<encoded-cwd>/<session-id>.jsonl */
export const CLAUDE_PROJECTS_ROOT = join(HOME, '.claude', 'projects')

/** Optional desktop-app session metadata store (nicer titles / model / effort), enriches when present. */
export const DESKTOP_SESSIONS_ROOT = join(APPDATA, 'Claude', 'claude-code-sessions')

/** Per-user config dir; the running-instance pointer (runtime.json) lives here. */
export const CONFIG_DIR = process.env.CCMANAGERUI_HOME?.trim() || join(HOME, '.ccmanagerui')

/** App root: the repo checkout (source mode — parent of server/ and web/) or the directory the
 *  compiled binary sits in (release layout: exe + web/dist side by side). The self-updater and
 *  web-dist resolution key off this. */
export const APP_ROOT = IS_COMPILED ? dirname(process.execPath) : join(import.meta.dir, '..', '..')

/** Where our own state lives (sqlite db + per-run logs). Source checkouts keep the historical
 *  server/data location (existing installs' databases live there); a compiled binary has no real
 *  server/ dir (import.meta.dir is virtual and unwritable — db.ts's eager mkdir there would crash
 *  the daemon before logging even starts), so it keeps state under the per-user CONFIG_DIR. */
export const DATA_DIR = IS_COMPILED ? join(CONFIG_DIR, 'data') : join(import.meta.dir, '..', 'data')
export const DB_PATH = process.env.CCMANAGERUI_DB ?? join(DATA_DIR, 'ccmanagerui.db')
/** Per-run logs (+ the detached runner's spec/status sidecars). Overridable so tests (and a
 *  portable install) can isolate them from the default data dir. */
export const RUN_LOG_DIR = process.env.CCMANAGERUI_RUN_LOG_DIR?.trim() || join(DATA_DIR, 'run-logs')

export const PORT = Number(process.env.PORT ?? 7787)
export const HOST = process.env.HOST ?? '127.0.0.1'

/** Service identity — used in /api/health and the runtime.json pointer (single-instance). */
export const SERVICE_NAME = 'ccmanagerui'

/** Built Vue SPA: web/dist under APP_ROOT in BOTH modes (repo checkout, or beside the binary in
 *  the release zip). Kept as a candidate list so a future layout can add entries, not re-plumb. */
export const WEB_DIST_CANDIDATES = [join(APP_ROOT, 'web', 'dist')]

/**
 * First-run outer size of the portable app window (what Chromium's `--window-size` takes).
 * Only applies to a window the dedicated profile has NEVER seen — the kit's
 * openPortableWindow probes the profile's saved placement first, so a size the user picked
 * themselves (or a maximize) wins on every later launch. Without it a never-seen window
 * opens at Chromium's default of ~the whole work area (~1905x2092 on a 4K display).
 *
 * Measured against the real UI, not guessed. Width: the fixed-viewport shell caps at
 * SHELL_BASE_MAX = 1000px (web/src/composables/useShellWidth.ts) and the page never
 * scrolls, but the binding constraint is the sessions sidebar, which rail-collapses below a
 * `(min-width: 1024px)` viewport (web/src/components/SessionsView.vue) — 1024 + ~16px frame
 * = 1040 outer is the floor below which a first-run window opens onto the collapsed rail;
 * 1060 clears it with slack for frame variance. Height is a density pick: a 758px viewport
 * fits the ~48px header, the sidebar's search toolbar and ~10 session rows, with matching
 * reading room in the transcript pane — 800 outer (outer = viewport + ~34 title + ~8 frame;
 * Chromium draws its title bar inside the client area). The tray's cold start carries the
 * same numbers (misc/CCManagerUI-Tray.ps1 PortableWindowSize) — keep them in step.
 */
export const PORTABLE_WINDOW_SIZE = { width: 1060, height: 800 }

/**
 * Resolve the `claude` executable, mirroring the Python `claude_command()`:
 * prefer the npm-global install, else fall back to PATH resolution ("claude").
 */
export function resolveClaudeExe(): string {
  const candidates = [
    join(APPDATA, 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'),
    join(APPDATA, 'npm', 'claude.cmd'),
    join(APPDATA, 'npm', 'claude'),
  ]
  for (const c of candidates) {
    if (existsSync(c)) return c
  }
  return 'claude'
}
