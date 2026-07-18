// tests/usage-probe.test.ts — where the `/usage` fallback probe is allowed to leave its mess.
//
// `claude -p "/usage"` opens a real session and writes a real transcript keyed by the directory it
// ran in. Inheriting the daemon's cwd filed every quota check into whatever project folder that
// mapped to: measured 2026-07-18, 279 three-kilobyte stubs (a caveat, a `<command-name>/usage`
// line, nothing else) sitting among the user's actual sessions, 33 of them from the previous day
// alone. The probe now runs in a scratch directory of ours and sweeps up after itself.
//
// The invariant worth guarding is the SWEEP's blast radius. It deletes .jsonl files, so it must be
// impossible for it to aim at a folder holding real work.

import { expect, test } from 'bun:test'
import { join } from 'node:path'
import { CLAUDE_PROJECTS_ROOT, DATA_DIR } from '../server/src/config'
import { encodeCwdKey } from '../server/src/transcript'
import { usageProbeCwd } from '../server/src/usage'
import { desktopKey } from '../server/src/usage-service'

test('the probe runs inside our own data directory, never a project folder', () => {
  const dir = usageProbeCwd()
  expect(dir).not.toBeNull()
  expect(dir?.startsWith(DATA_DIR)).toBe(true)
  // Belt and braces: our scratch dir must not live inside the transcript store itself, or the
  // sweep's folder and a real project folder could coincide.
  expect(dir?.startsWith(CLAUDE_PROJECTS_ROOT)).toBe(false)
})

test('the swept folder is exactly the one our scratch dir encodes to', () => {
  const dir = usageProbeCwd() as string
  const swept = join(CLAUDE_PROJECTS_ROOT, encodeCwdKey(dir))
  // This is the whole safety story: the target is derived from a path we created, so it cannot
  // name a folder belonging to real sessions. A changed encoding just misses and deletes nothing.
  expect(swept.startsWith(CLAUDE_PROJECTS_ROOT)).toBe(true)
  expect(swept).not.toBe(CLAUDE_PROJECTS_ROOT)
  expect(encodeCwdKey(dir)).toContain('usage-probe')
})

test('the probe directory is stable across calls', () => {
  // Cached, because the sweep after every probe would otherwise re-stat it each time.
  expect(usageProbeCwd()).toBe(usageProbeCwd())
})

// --- one instance, one cache key ---------------------------------------------
//
// The same directory reaches desktopKey() spelled several ways depending on the call site. Keyed
// raw, each spelling opened its own cache row: the live usage-cache.json held THREE rows for
// 3claude (`C:\Users\…`, `c:\users\…`, `C:/Users/…`) and two for 5claude, so a reading taken under
// one spelling was invisible to a lookup using another and the check re-ran against a warm cache.

// Built rather than written out, so the literal backslashes never have to survive escaping.
const BACKSLASH = String.fromCharCode(92)
const winPath = (...parts: string[]) => parts.join(BACKSLASH)
const INSTANCE_3 = winPath('C:', 'Users', 'blogi', '.claude-instances', '3claude')
const INSTANCE_4 = winPath('C:', 'Users', 'blogi', '.claude-instances', '4claude')

test('every spelling of one instance directory maps to a single cache key', () => {
  const keys = [
    INSTANCE_3,
    INSTANCE_3.toLowerCase(),
    INSTANCE_3.split(BACKSLASH).join('/'),
    INSTANCE_3 + BACKSLASH, // trailing separator
  ].map(desktopKey)
  expect(new Set(keys).size).toBe(1)
})

test('different instances still get different keys', () => {
  // The normalization must not be so aggressive that it collides two real instances.
  expect(desktopKey(INSTANCE_3)).not.toBe(desktopKey(INSTANCE_4))
})

test('the key keeps its desktop: prefix so it cannot collide with cli:/acct: keys', () => {
  expect(desktopKey(INSTANCE_3).startsWith('desktop:')).toBe(true)
})
