// server/tests/plan-label.test.ts — resolvePlanLabel: the plan-vs-tier reconciliation that feeds
// CMAccount.planLabel (the "Plan" column). The interesting cases are the ones where the two
// signals disagree, especially a paid account whose org reports a generic `default_claude_*` tier.

import { describe, expect, test } from 'bun:test'
import { prettyTier, resolvePlanLabel } from '../src/core/shared'

describe('resolvePlanLabel', () => {
  test('trusts a friendly, mapped tier and keeps its 5×/20× granularity', () => {
    expect(resolvePlanLabel('max', prettyTier('default_claude_max_20x'))).toBe('Max 20×')
    expect(resolvePlanLabel('max', prettyTier('default_claude_max_5x'))).toBe('Max 5×')
    expect(resolvePlanLabel('pro', prettyTier('default_claude_pro'))).toBe('Pro')
    expect(resolvePlanLabel('free', prettyTier('default_claude_free'))).toBe('Free')
    expect(resolvePlanLabel(null, prettyTier('default_claude_team_x'))).toBe('Team')
    expect(resolvePlanLabel(null, prettyTier('default_claude_enterprise_x'))).toBe('Enterprise')
  })

  test('falls back to `plan` when the tier is a generic default_* passthrough', () => {
    // The real-world case: a Max account whose org reports the generic tier. The raw string must
    // never surface — plan wins.
    expect(resolvePlanLabel('max', 'default_claude_ai')).toBe('Max')
    expect(resolvePlanLabel('pro', 'default_claude_ai')).toBe('Pro')
    expect(resolvePlanLabel('free', 'default_claude_ai')).toBe('Free')
  })

  test('normalizes subscriptionType-style plan strings', () => {
    expect(resolvePlanLabel('claude_max', 'default_claude_ai')).toBe('Max')
    expect(resolvePlanLabel('claude_pro', null)).toBe('Pro')
    // An unrecognized non-default plan passes through as-is rather than being dropped.
    expect(resolvePlanLabel('startup', 'default_claude_ai')).toBe('startup')
  })

  test('returns null (→ "—") when neither signal is informative', () => {
    expect(resolvePlanLabel(null, null)).toBeNull()
    expect(resolvePlanLabel(null, 'default_claude_ai')).toBeNull()
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
