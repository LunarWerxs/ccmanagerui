// server/tests/usage-history.test.ts — the burn-rate + forecast math (server/src/usage-history.ts).
//
// Only the pure functions are exercised here (burnRatePctPerHour, forecastUsage); the disk-backed
// recordUsageSample/usageSamples are intentionally left untested per the module's own doc comment
// ("The pure math is separated from the storage so it is unit-testable without touching the disk").

import { describe, expect, test } from 'bun:test'
import type { UsageSample, UsageSnapshot } from '../src/types'
import { burnRatePctPerHour, forecastUsage } from '../src/usage-history'

const mkSample = (at: string, weekAllPct: number): UsageSample => ({
  at,
  sessionPct: null,
  weekAllPct,
  weekResetsAt: null,
})

describe('burnRatePctPerHour', () => {
  test('null with fewer than 2 samples', () => {
    expect(burnRatePctPerHour([])).toBeNull()
    expect(burnRatePctPerHour([mkSample('2026-07-14T00:00:00.000Z', 10)])).toBeNull()
  })

  test('null when the measured span is under 20 minutes', () => {
    const now = new Date('2026-07-14T02:00:00.000Z')
    const samples = [
      mkSample('2026-07-14T01:45:00.000Z', 10),
      mkSample('2026-07-14T01:55:00.000Z', 12), // 10 minutes apart
    ]
    expect(burnRatePctPerHour(samples, now)).toBeNull()
  })

  test('happy path: plain (last-first)/hours over a clean 2-sample window', () => {
    const now = new Date('2026-07-14T02:00:00.000Z')
    const samples = [
      mkSample('2026-07-14T00:00:00.000Z', 10),
      mkSample('2026-07-14T02:00:00.000Z', 14),
    ]
    expect(burnRatePctPerHour(samples, now)).toBe(2) // (14-10)/2h
  })

  test('reset-crossing guard: 90% -> 95% -> 5% -> 10% only measures the post-reset leg', () => {
    const now = new Date('2026-07-14T02:00:00.000Z')
    const samples = [
      mkSample('2026-07-14T00:00:00.000Z', 90),
      mkSample('2026-07-14T00:30:00.000Z', 95),
      mkSample('2026-07-14T01:00:00.000Z', 5), // reset happened between 00:30 and 01:00
      mkSample('2026-07-14T01:30:00.000Z', 10),
    ]
    // Must NOT be (10 - 90) / 1.5h = -53.33 (a large bogus negative). Must be (10-5)/0.5h = 10, and
    // in particular must be positive.
    const rate = burnRatePctPerHour(samples, now)
    expect(rate).toBe(10)
    expect(rate).not.toBeLessThan(0)
  })

  test('a flat (idle) window measures exactly 0, not null and not negative', () => {
    const now = new Date('2026-07-14T02:00:00.000Z')
    const samples = [
      mkSample('2026-07-14T00:00:00.000Z', 30),
      mkSample('2026-07-14T01:00:00.000Z', 30),
    ]
    expect(burnRatePctPerHour(samples, now)).toBe(0)
  })

  test('truncates to the lookback window (plus one sample past the edge)', () => {
    // One reading per hour from t-10h to t-0h (now), pct rising by 1/hour throughout. Default
    // lookback is 6h, so the measured leg should be roughly the last 6-7h, not the full 10h —
    // and since the underlying rate is a constant 1%/hour, the truncated measurement should still
    // read 1, which confirms it kept a contiguous, correctly-ordered sub-window.
    const now = new Date('2026-07-14T10:00:00.000Z')
    const samples: UsageSample[] = []
    for (let h = 0; h <= 10; h++) {
      const t = new Date(now.getTime() - (10 - h) * 3600_000).toISOString()
      samples.push(mkSample(t, h))
    }
    expect(burnRatePctPerHour(samples, now)).toBe(1)
  })

  test('respects an explicit lookbackHours override', () => {
    const now = new Date('2026-07-14T04:00:00.000Z')
    const samples = [
      mkSample('2026-07-14T00:00:00.000Z', 0),
      mkSample('2026-07-14T02:00:00.000Z', 10),
      mkSample('2026-07-14T04:00:00.000Z', 20),
    ]
    // lookback 1h: cutoff is 03:00, so only the last two samples (02:00->04:00) qualify... but the
    // walk includes "the first sample past the edge" too, which here is 02:00 itself (< cutoff),
    // so the window is [02:00 pct10, 04:00 pct20] -> rate (20-10)/2h = 5.
    expect(burnRatePctPerHour(samples, now, 1)).toBe(5)
  })
})

const baseSnap = (weekAll: UsageSnapshot['weekAll']): UsageSnapshot => ({
  account: null,
  session: null,
  weekAll,
  weekModel: null,
  capturedAt: '2026-07-14T02:00:00.000Z',
  source: 'api',
})

describe('forecastUsage', () => {
  const NOW = new Date('2026-07-14T02:00:00.000Z')

  test('pct null (no weekAll) -> everything derived stays null', () => {
    const snap = baseSnap(null)
    const forecast = forecastUsage(snap, [], NOW)
    expect(forecast).toEqual({
      burnPctPerHour: null,
      remainingPct: null,
      headroomHours: null,
      exhaustsAt: null,
      hoursToReset: null,
      exhaustsBeforeReset: null,
      samples: 0,
    })
  })

  test('burn null (insufficient samples) -> remainingPct/hoursToReset still computed, rest null', () => {
    const snap = baseSnap({ pct: 50, resets: '', resetsAt: '2026-07-19T00:00:00.000Z' })
    const forecast = forecastUsage(snap, [], NOW)
    expect(forecast.burnPctPerHour).toBeNull()
    expect(forecast.remainingPct).toBe(50)
    expect(forecast.headroomHours).toBeNull()
    expect(forecast.exhaustsAt).toBeNull()
    expect(forecast.exhaustsBeforeReset).toBeNull()
    expect(forecast.samples).toBe(0)
    const expectedHoursToReset = (Date.parse('2026-07-19T00:00:00.000Z') - NOW.getTime()) / 3600_000
    expect(forecast.hoursToReset).toBeCloseTo(expectedHoursToReset, 10)
  })

  test('burn === 0 (idle) -> exhaustsBeforeReset is FALSE (never null), no headroom/exhaustsAt', () => {
    const snap = baseSnap({ pct: 30, resets: '', resetsAt: '2026-07-19T00:00:00.000Z' })
    const samples = [
      mkSample('2026-07-14T00:00:00.000Z', 30),
      mkSample('2026-07-14T01:00:00.000Z', 30),
    ]
    const forecast = forecastUsage(snap, samples, NOW)
    expect(forecast.burnPctPerHour).toBe(0)
    expect(forecast.remainingPct).toBe(70)
    expect(forecast.headroomHours).toBeNull()
    expect(forecast.exhaustsAt).toBeNull()
    expect(forecast.exhaustsBeforeReset).toBe(false)
  })

  test('exhaustsBeforeReset === true: cap is hit before the weekly reset', () => {
    // Burn 5%/hour, remaining 10% -> headroom 2h. Reset is 5h away -> exhausts first.
    const snap = baseSnap({ pct: 90, resets: '', resetsAt: '2026-07-14T07:00:00.000Z' }) // +5h
    const samples = [
      mkSample('2026-07-14T00:00:00.000Z', 10),
      mkSample('2026-07-14T02:00:00.000Z', 20),
    ]
    const forecast = forecastUsage(snap, samples, NOW)
    expect(forecast.burnPctPerHour).toBe(5)
    expect(forecast.remainingPct).toBe(10)
    expect(forecast.headroomHours).toBe(2)
    expect(forecast.hoursToReset).toBeCloseTo(5, 10)
    expect(forecast.exhaustsBeforeReset).toBe(true)
    expect(forecast.exhaustsAt).toBe(new Date(NOW.getTime() + 2 * 3600_000).toISOString())
  })

  test('exhaustsBeforeReset === false: the weekly reset arrives before the cap would be hit', () => {
    // Same 5%/hour burn and 2h headroom, but the reset is only 1h away -> reset wins.
    const snap = baseSnap({ pct: 90, resets: '', resetsAt: '2026-07-14T03:00:00.000Z' }) // +1h
    const samples = [
      mkSample('2026-07-14T00:00:00.000Z', 10),
      mkSample('2026-07-14T02:00:00.000Z', 20),
    ]
    const forecast = forecastUsage(snap, samples, NOW)
    expect(forecast.burnPctPerHour).toBe(5)
    expect(forecast.headroomHours).toBe(2)
    expect(forecast.hoursToReset).toBeCloseTo(1, 10)
    expect(forecast.exhaustsBeforeReset).toBe(false)
  })

  test('burn > 0 but no resetsAt -> exhaustsBeforeReset is null (unknown, not false)', () => {
    const snap = baseSnap({ pct: 90, resets: '', resetsAt: null })
    const samples = [
      mkSample('2026-07-14T00:00:00.000Z', 10),
      mkSample('2026-07-14T02:00:00.000Z', 20),
    ]
    const forecast = forecastUsage(snap, samples, NOW)
    expect(forecast.burnPctPerHour).toBe(5)
    expect(forecast.hoursToReset).toBeNull()
    expect(forecast.exhaustsBeforeReset).toBeNull()
    expect(forecast.headroomHours).toBe(2) // still computed independent of hoursToReset
    expect(forecast.exhaustsAt).not.toBeNull()
  })
})
