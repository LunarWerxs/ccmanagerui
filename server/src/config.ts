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
