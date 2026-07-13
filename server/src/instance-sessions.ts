// server/src/instance-sessions.ts — which Claude Desktop instance did a session run in?
//
// Every desktop install keeps per-session metadata at
// `<user-data-dir>/claude-code-sessions/<org>/<user>/local_*.json`, and its
// `cliSessionId` names the CLI transcript in the SHARED `~/.claude/projects` store
// (all instances write transcripts to the same place; only the metadata is per
// instance). Scanning those small files gives a transcript-id -> instance-label map:
// isolated instances label as their `~/.claude-instances/<name>` dir name, the
// default (non-isolated) install labels as "default", and anything unmapped is a
// plain CLI / unknown session.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { defaultClaudeUserDataDir, instancesRoot } from './core/paths'

const TTL_MS = 15_000
let cache: { at: number; map: Map<string, string> } | null = null

function scanStore(userDataDir: string, label: string, map: Map<string, string>): void {
  const dir = join(userDataDir, 'claude-code-sessions')
  if (!existsSync(dir)) return
  const glob = new Bun.Glob('*/*/local_*.json')
  for (const rel of glob.scanSync({ cwd: dir, onlyFiles: true })) {
    try {
      const meta = JSON.parse(readFileSync(join(dir, rel), 'utf8'))
      const id = meta?.cliSessionId
      if (typeof id === 'string' && id) map.set(id, label)
    } catch {
      /* unreadable metadata file: skip it */
    }
  }
}

/** Map of CLI transcript session id -> instance label ("default" | instance dir name). */
export function instanceSessionMap(): Map<string, string> {
  const now = performance.now()
  if (cache && now - cache.at < TTL_MS) return cache.map

  const map = new Map<string, string>()
  scanStore(defaultClaudeUserDataDir(), 'default', map)
  const root = instancesRoot()
  try {
    if (existsSync(root)) {
      for (const entry of readdirSync(root, { withFileTypes: true })) {
        if (entry.isDirectory()) scanStore(join(root, entry.name), entry.name, map)
      }
    }
  } catch {
    /* best-effort: an unreadable instances root just means no labels */
  }
  cache = { at: now, map }
  return map
}
