// server/tests/plan-label.test.ts — resolvePlanLabel: how CMAccount.planLabel (the "Plan" column)
// is derived. The rate-limit TIER is authoritative for the current plan; the has_claude_max/pro
// flags are stale entitlement history (owner-confirmed 2026-07-22: accounts that expired from a
// paid plan back to free still report the flag). A generic `default_claude_ai` tier ⇒ Free.

import { describe, expect, test } from 'bun:test'
import { prettyTier, resolvePlanLabel } from '../src/core/shared'

describe('resolvePlanLabel', () => {
  test('trusts a specific, recognized tier and keeps its 5×/20× granularity', () => {
    expect(resolvePlanLabel('max', prettyTier('default_claude_max_20x'))).toBe('Max 20×')
    expect(resolvePlanLabel('max', prettyTier('default_claude_max_5x'))).toBe('Max 5×')
    expect(resolvePlanLabel('pro', prettyTier('default_claude_pro'))).toBe('Pro')
    expect(resolvePlanLabel('free', prettyTier('default_claude_free'))).toBe('Free')
    expect(resolvePlanLabel(null, prettyTier('default_claude_team_x'))).toBe('Team')
    expect(resolvePlanLabel(null, prettyTier('default_claude_enterprise_x'))).toBe('Enterprise')
  })

  test('a generic default_* tier ⇒ Free, ignoring the stale has_claude_max/pro plan flags', () => {
    // The real-world case (owner-confirmed): an account that was Max/Pro and lapsed to free still
    // reports has_claude_max/pro=true, but Anthropic drops its rate-limit tier to the generic
    // "default_claude_ai". The tier is the current-plan truth, so all of these are Free.
    expect(resolvePlanLabel('max', 'default_claude_ai')).toBe('Free')
    expect(resolvePlanLabel('pro', 'default_claude_ai')).toBe('Free')
    expect(resolvePlanLabel('free', 'default_claude_ai')).toBe('Free')
    expect(resolvePlanLabel('claude_max', 'default_claude_ai')).toBe('Free')
    expect(resolvePlanLabel(null, 'default_claude_ai')).toBe('Free')
  })

  test('with no tier at all, falls back to the plan flags (best-effort)', () => {
    expect(resolvePlanLabel('max', null)).toBe('Max')
    expect(resolvePlanLabel('claude_pro', null)).toBe('Pro')
    // An unrecognized non-default plan passes through as-is rather than being dropped.
    expect(resolvePlanLabel('startup', null)).toBe('startup')
    expect(resolvePlanLabel(null, null)).toBeNull()
    expect(resolvePlanLabel(null, '')).toBeNull()
  })

  test('never leaks a raw default_* string', () => {
    for (const tier of ['default_claude_ai', 'default_claude_unknown_future']) {
      for (const plan of [null, 'max', 'pro', 'free']) {
        const out = resolvePlanLabel(plan, tier)
        expect(out === null || !out.startsWith('default_')).toBe(true)
      }
    }
  })
})
