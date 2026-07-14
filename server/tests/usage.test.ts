// server/tests/usage.test.ts — the /usage text parser (server/src/usage.ts).
//
// Fixture is a real `claude -p "/usage"` block captured 2026-07-14 (numbers only, no secrets).

import { describe, expect, test } from 'bun:test'
import { bindingWeeklyPct, isNoData, parseUsageOutput } from '../src/usage'

const FIXTURE = [
  'Warning: no stdin data received in 3s, proceeding without it.',
  'You are currently using your subscription to power your Claude Code usage',
  '',
  'Current session: 0% used · resets Jul 13, 11:49pm (America/Chicago)',
  'Current week (all models): 97% used · resets Jul 14, 2:59am (America/Chicago)',
  'Current week (Fable): 89% used · resets Jul 14, 3am (America/Chicago)',
  '',
  'Last 24h · 13748 requests · 51 sessions',
].join('\n')

describe('parseUsageOutput', () => {
  test('extracts session, weekAll, and per-model weekly from a real block', () => {
    const snap = parseUsageOutput(
      FIXTURE,
      'lunarwerx@example.com',
      new Date('2026-07-14T02:00:00Z'),
    )
    expect(snap.account).toBe('lunarwerx@example.com')
    expect(snap.session).toEqual({ pct: 0, resets: 'Jul 13, 11:49pm' })
    expect(snap.weekAll).toEqual({ pct: 97, resets: 'Jul 14, 2:59am' })
    expect(snap.weekModel).toEqual({ label: 'Fable', pct: 89, resets: 'Jul 14, 3am' })
    expect(snap.capturedAt).toBe('2026-07-14T02:00:00.000Z')
  })

  test('the all-models weekly is the binding cap', () => {
    const snap = parseUsageOutput(FIXTURE)
    expect(bindingWeeklyPct(snap)).toBe(97)
    expect(isNoData(snap)).toBe(false)
  })

  test('empty / unauthenticated output yields all-null and reports no-data (never 0%)', () => {
    const snap = parseUsageOutput('Total cost: $0.00\nUsage: 0 input, 0 output')
    expect(snap.session).toBeNull()
    expect(snap.weekAll).toBeNull()
    expect(snap.weekModel).toBeNull()
    expect(bindingWeeklyPct(snap)).toBeNull()
    expect(isNoData(snap)).toBe(true)
  })

  test('tolerates a hyphen separator and missing per-model line', () => {
    const raw =
      'Current session: 12% used - resets Tomorrow 9am\nCurrent week (all models): 40% used - resets Mon 3am'
    const snap = parseUsageOutput(raw)
    expect(snap.session?.pct).toBe(12)
    expect(snap.weekAll).toEqual({ pct: 40, resets: 'Mon 3am' })
    expect(snap.weekModel).toBeNull()
  })
})
