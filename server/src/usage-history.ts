// server/src/usage-history.ts — turn a percentage into a RATE, and a rate into a deadline.
//
// THE PROBLEM THIS SOLVES. "You are at 98%" is almost useless to an agent deciding whether to start
// a piece of work. 98% with a reset in 20 minutes is fine. 98% with a reset in four days, while
// burning 1%/hour, means you die mid-task in about two hours. Same number, opposite decision. The
// percentage alone cannot tell them apart; only its DERIVATIVE can.
//
// The endpoint gives us no rate (and no token or dollar counts — limit_dollars/used_dollars are null
// on a subscription), so we derive one: the background sweep already re-reads usage every 15 minutes,
// so we keep those readings and differentiate them.
//
// WHAT COMES OUT: burn rate in %/hour, hours of headroom left at that rate, the projected instant of
// exhaustion, and the single question that actually decides things:
//   "will I run out BEFORE the window resets?"
// If no, the cap is irrelevant and you can work freely. If yes, you know exactly how long you have.
//
// The pure math is separated from the storage so it is unit-testable without touching the disk.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DATA_DIR } from './config'
import type { UsageForecast, UsageSample, UsageSnapshot } from './types'

const HISTORY_PATH = join(DATA_DIR, 'usage-history.json')

/** Keep ~5 days of 15-minute samples per key. Enough for a weekly trend, small enough to stay a
 *  few hundred KB of JSON. */
const MAX_SAMPLES_PER_KEY = 500

/** Ignore a burn rate measured over less than this: two samples minutes apart produce wild slopes. */
const MIN_SPAN_MIN = 20

/** How far back to look when measuring the current burn. Long enough to smooth out a single heavy
 *  agent, short enough to still reflect what you are doing NOW rather than yesterday. */
const DEFAULT_LOOKBACK_HOURS = 6

type History = Record<string, UsageSample[]>

function readHistory(): History {
  try {
    const parsed = JSON.parse(readFileSync(HISTORY_PATH, 'utf8'))
    return parsed && typeof parsed === 'object' ? (parsed as History) : {}
  } catch {
    return {}
  }
}

function writeHistory(h: History): void {
  try {
    mkdirSync(DATA_DIR, { recursive: true })
    writeFileSync(HISTORY_PATH, JSON.stringify(h))
  } catch {
    // best-effort: losing history costs us a forecast, never a usage reading
  }
}

/** Record one reading. Called on every successful check (manual or from the background sweep). */
export function recordUsageSample(key: string, snap: UsageSnapshot): void {
  if (!snap.weekAll) return // nothing to trend
  const h = readHistory()
  const list = h[key] ?? []
  const sample: UsageSample = {
    at: snap.capturedAt,
    sessionPct: snap.session?.pct ?? null,
    weekAllPct: snap.weekAll.pct,
    weekResetsAt: snap.weekAll.resetsAt ?? null,
  }
  // Don't store a duplicate reading (the cache can replay the same snapshot).
  const last = list[list.length - 1]
  if (last && last.at === sample.at) return
  list.push(sample)
  h[key] = list.slice(-MAX_SAMPLES_PER_KEY)
  writeHistory(h)
}

/** Every stored sample for a key, oldest first. */
export function usageSamples(key: string): UsageSample[] {
  return readHistory()[key] ?? []
}

// --- the math (pure, tested) --------------------------------------------------

/**
 * Burn rate in percent-per-hour over the lookback window, or null when it can't be measured.
 *
 * Two things make this trickier than (last - first) / hours:
 *
 *  1. **A reset inside the window.** When the weekly window rolls over, the % drops to ~0. Naively
 *     differencing across that gives a large NEGATIVE rate, which would then be read as "you are
 *     gaining quota" and produce an infinite headroom. So we only measure from the LAST reset
 *     onward: walk back and cut the moment we see the percentage fall.
 *  2. **A flat window.** If you haven't worked, the rate is a legitimate 0, which must be reported as
 *     zero (meaning "no exhaustion in sight"), not as unknown.
 *
 * Returns null only when there genuinely isn't enough signal: fewer than 2 samples, or a span shorter
 * than MIN_SPAN_MIN.
 */
export function burnRatePctPerHour(
  samples: UsageSample[],
  now = new Date(),
  lookbackHours = DEFAULT_LOOKBACK_HOURS,
): number | null {
  if (samples.length < 2) return null
  const cutoff = now.getTime() - lookbackHours * 3600_000

  // Newest-first walk, stopping at the last reset (a drop in %) or the lookback edge.
  const window: UsageSample[] = []
  for (let i = samples.length - 1; i >= 0; i--) {
    const s = samples[i]!
    const t = Date.parse(s.at)
    if (!Number.isFinite(t)) continue
    const prev = window[0]
    // Walking backwards, so `prev` is the sample AFTER this one in time. If this older sample has a
    // HIGHER pct than the newer one, the counter reset between them: stop, don't cross the boundary.
    if (prev && s.weekAllPct > prev.weekAllPct) break
    window.unshift(s)
    if (t < cutoff) break // include the first sample past the edge, then stop
  }
  if (window.length < 2) return null

  const first = window[0]!
  const last = window[window.length - 1]!
  const hours = (Date.parse(last.at) - Date.parse(first.at)) / 3600_000
  if (!Number.isFinite(hours) || hours * 60 < MIN_SPAN_MIN) return null

  const rate = (last.weekAllPct - first.weekAllPct) / hours
  // Belt-and-braces. This clamp is currently UNREACHABLE and that is deliberate: the walk above
  // breaks on ANY decrease, so `window` is monotonically non-decreasing and `rate` cannot be
  // negative. It stays as a guard on the invariant, not as live logic — if someone later loosens the
  // reset detection (e.g. to tolerate a 1-point rounding wobble instead of treating it as a reset),
  // a negative rate becomes reachable, and a negative burn would read as "gaining quota" and hand out
  // infinite headroom. Cheaper to keep the floor than to re-derive why it mattered.
  return rate < 0 ? 0 : rate
}

/**
 * Turn the current reading + its history into a decision.
 *
 * The field that matters is `exhaustsBeforeReset`. Everything else is supporting detail:
 *   false -> the cap will not bite; work normally regardless of how scary the % looks.
 *   true  -> you have `headroomHours` before you are cut off. Plan around it.
 */
export function forecastUsage(
  snap: UsageSnapshot,
  samples: UsageSample[],
  now = new Date(),
): UsageForecast {
  const pct = snap.weekAll?.pct ?? null
  const resetsAt = snap.weekAll?.resetsAt ?? null
  const burn = burnRatePctPerHour(samples, now)
  const hoursToReset = resetsAt
    ? Math.max(0, (Date.parse(resetsAt) - now.getTime()) / 3600_000)
    : null

  const base: UsageForecast = {
    burnPctPerHour: burn,
    remainingPct: pct === null ? null : Math.max(0, 100 - pct),
    headroomHours: null,
    exhaustsAt: null,
    hoursToReset,
    exhaustsBeforeReset: null,
    samples: samples.length,
  }
  if (pct === null || burn === null) return base

  const remaining = Math.max(0, 100 - pct)
  if (burn <= 0) {
    // Not burning: you will never hit the cap at this rate. Infinite headroom is honestly reported
    // as "no exhaustion" rather than a made-up number.
    return { ...base, headroomHours: null, exhaustsAt: null, exhaustsBeforeReset: false }
  }

  const headroomHours = remaining / burn
  const exhaustsAt = new Date(now.getTime() + headroomHours * 3600_000).toISOString()
  return {
    ...base,
    headroomHours,
    exhaustsAt,
    exhaustsBeforeReset: hoursToReset === null ? null : headroomHours < hoursToReset,
  }
}
