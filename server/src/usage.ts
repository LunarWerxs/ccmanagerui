// server/src/usage.ts — read an account's remaining Claude subscription quota.
//
// There is no `claude usage` subcommand and `/usage` is REPL-only, so the only non-interactive
// route is `claude -p "/usage"` in print mode. Auth is injected the SAME way dispatch-runner.ts
// does it (CLAUDE_CODE_OAUTH_TOKEN / ANTHROPIC_API_KEY env — the account secret from the sqlite
// `accounts` table), so any account already registered for queue dispatch can be polled with no
// extra login. Value-blind: this module surfaces only the numbers `/usage` reports, never a token.
//
// This file is the PURE, TESTED foundation: `parseUsageOutput` + the binding-cap helper. The
// spawning half (`checkUsage`) is the next brick — see CLI_INSTANCES_AND_USAGE_PLAN.md §8 item 3;
// it must reuse the repo's existing `claude` binary resolution and detached-spawn conventions.

/** One limit line from `/usage`: a percent used and a human reset string. */
export type UsageLimit = { pct: number; resets: string }

/** A parsed snapshot of one account's quota at a moment in time. */
export type UsageSnapshot = {
  /** Account label/email if the caller knew it; the `/usage` text does not name the account. */
  account: string | null
  /** The 5-hour rolling session window. */
  session: UsageLimit | null
  /** The weekly all-models limit — the BINDING cap for pacing decisions. */
  weekAll: UsageLimit | null
  /** A per-model weekly sub-limit (e.g. "Fable"), when present. */
  weekModel: (UsageLimit & { label: string }) | null
  capturedAt: string
}

// The `/usage` block looks like (note the U+00B7 middle-dot separator):
//   Current session: 0% used · resets Jul 13, 11:49pm (America/Chicago)
//   Current week (all models): 97% used · resets Jul 14, 2:59am (America/Chicago)
//   Current week (Fable): 89% used · resets Jul 14, 3am (America/Chicago)
const RE_SESSION = /Current session:\s*(\d+)%\s*used\s*[·|-]?\s*resets\s*([^\r\n(]+)/i
const RE_WEEK_ALL = /Current week \(all models\):\s*(\d+)%\s*used\s*[·|-]?\s*resets\s*([^\r\n(]+)/i
const RE_WEEK_MODEL =
  /Current week \((?!all models\))([^)]+)\):\s*(\d+)%\s*used\s*[·|-]?\s*resets\s*([^\r\n(]+)/i

/**
 * Parse the text output of `claude -p "/usage"` into a typed snapshot. Missing lines become null
 * (an unauthenticated or empty run yields all-null, which callers must treat as "no data", never
 * as "0% used"). Pure and side-effect-free so it is unit-tested against a captured fixture.
 */
export function parseUsageOutput(
  raw: string,
  account: string | null = null,
  now = new Date(),
): UsageSnapshot {
  const s = RE_SESSION.exec(raw)
  const wa = RE_WEEK_ALL.exec(raw)
  const wm = RE_WEEK_MODEL.exec(raw)
  return {
    account,
    session: s ? { pct: Number(s[1]), resets: s[2].trim() } : null,
    weekAll: wa ? { pct: Number(wa[1]), resets: wa[2].trim() } : null,
    weekModel: wm ? { label: wm[1].trim(), pct: Number(wm[2]), resets: wm[3].trim() } : null,
    capturedAt: now.toISOString(),
  }
}

/**
 * The all-models weekly % is the real ceiling; the fresh 5-hour session % is a red herring when
 * weekly is near 100. Returns null when unknown — callers must NOT treat unknown as "plenty left".
 */
export function bindingWeeklyPct(snap: UsageSnapshot): number | null {
  return snap.weekAll?.pct ?? null
}

/** True when the snapshot has no usable data (all limits null) — an unverified read, not "empty quota". */
export function isNoData(snap: UsageSnapshot): boolean {
  return !snap.session && !snap.weekAll && !snap.weekModel
}
