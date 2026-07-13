import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const HOME = homedir()
const APPDATA = process.env.APPDATA ?? join(HOME, 'AppData', 'Roaming')

/** Canonical Claude Code CLI transcript store: <home>/.claude/projects/<encoded-cwd>/<session-id>.jsonl */
export const CLAUDE_PROJECTS_ROOT = join(HOME, '.claude', 'projects')

/** Optional desktop-app session metadata store (nicer titles / model / effort), enriches when present. */
export const DESKTOP_SESSIONS_ROOT = join(APPDATA, 'Claude', 'claude-code-sessions')

/** Repo checkout root (parent of server/ and web/) — used by the self-updater. */
export const APP_ROOT = join(import.meta.dir, '..', '..')

/** Where our own state lives (sqlite db + per-run logs). */
export const DATA_DIR = join(import.meta.dir, '..', 'data')
export const DB_PATH = process.env.CCMANAGERUI_DB ?? join(DATA_DIR, 'ccmanagerui.db')
/** Per-run logs (+ the detached runner's spec/status sidecars). Overridable so tests (and a
 *  portable install) can isolate them from the default data dir. */
export const RUN_LOG_DIR = process.env.CCMANAGERUI_RUN_LOG_DIR?.trim() || join(DATA_DIR, 'run-logs')

export const PORT = Number(process.env.PORT ?? 7787)
export const HOST = process.env.HOST ?? '127.0.0.1'

/** Service identity — used in /api/health and the runtime.json pointer (single-instance). */
export const SERVICE_NAME = 'ccmanagerui'

/** Per-user config dir; the running-instance pointer (runtime.json) lives here. */
export const CONFIG_DIR = process.env.CCMANAGERUI_HOME?.trim() || join(HOME, '.ccmanagerui')

/** Built Vue SPA candidates: dev (relative to this source) and compiled (next to the binary). */
export const WEB_DIST_CANDIDATES = [
  join(import.meta.dir, '..', '..', 'web', 'dist'),
  join(HOME, 'web', 'dist'),
]

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
