// tests/session-period.test.ts — how far back the session list reaches.
//
// The window defaults to 24h because the list answers "what am I working on", and a store that has
// been accumulating transcripts for months answers that question worse the further back it goes.
// The parsing is defensive for the same reason the archived scope is: an unrecognized value must
// fall back to the default window, never silently widen the list to everything on disk.

import { expect, test } from 'bun:test'
import { isSessionPeriod, periodCutoffMs } from '../server/src/types'

const NOW = Date.UTC(2026, 6, 18, 12, 0, 0)
const HOUR = 3_600_000

test('every offered period is accepted', () => {
  for (const p of ['24h', '7d', '30d', 'all']) expect(isSessionPeriod(p)).toBe(true)
})

test('anything else is rejected so the caller can fall back to the default', () => {
  for (const p of ['', '1h', '24H', 'forever', null, undefined, 7, {}])
    expect(isSessionPeriod(p)).toBe(false)
})

test('cutoffs are measured back from now', () => {
  expect(periodCutoffMs('24h', NOW)).toBe(NOW - 24 * HOUR)
  expect(periodCutoffMs('7d', NOW)).toBe(NOW - 7 * 24 * HOUR)
  expect(periodCutoffMs('30d', NOW)).toBe(NOW - 30 * 24 * HOUR)
})

test('"all" means no cutoff at all, not a very old one', () => {
  // null is what listSessions checks for to skip the filter entirely; a sentinel date would
  // quietly exclude anything older than it.
  expect(periodCutoffMs('all', NOW)).toBeNull()
})

test('a wider window always reaches strictly further back', () => {
  const day = periodCutoffMs('24h', NOW) as number
  const week = periodCutoffMs('7d', NOW) as number
  const month = periodCutoffMs('30d', NOW) as number
  expect(week).toBeLessThan(day)
  expect(month).toBeLessThan(week)
})
