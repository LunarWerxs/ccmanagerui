// server/tests/usage-budget.test.ts — the agent-readable summary line (server/src/usage-budget.ts).
//
// buildUsageBudget() reads history off disk, so only the pure budgetSummary() is exercised here;
// UsageBudget objects are constructed by hand instead of going through the disk-backed builder.

import { describe, expect, test } from 'bun:test'
import type { TokenSpend, UsageBudget, UsageForecast } from '../src/types'
import { budgetSummary } from '../src/usage-budget'

const EMPTY_SPEND: TokenSpend = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheCreation: 0,
  raw: 0,
  weighted: 0,
  turns: 0,
  byModel: {},
}

const NULL_FORECAST: UsageForecast = {
  burnPctPerHour: null,
  remainingPct: null,
  headroomHours: null,
  exhaustsAt: null,
  hoursToReset: null,
  exhaustsBeforeReset: null,
  samples: 0,
}

const mkBudget = (overrides: Partial<UsageBudget> = {}): UsageBudget => ({
  forecast: NULL_FORECAST,
  spend: EMPTY_SPEND,
  lookbackHours: 6,
  weightedPerHour: null,
  weightedPerPercent: null,
  remainingWeighted: null,
  remainingTurns: null,
  weightedPerTurn: null,
  confidence: 'none',
  caveat: 'test caveat',
  ...overrides,
})

describe('budgetSummary', () => {
  test('says "work freely" when exhaustsBeforeReset is false (burning, but reset wins)', () => {
    const budget = mkBudget({
      forecast: {
        ...NULL_FORECAST,
        burnPctPerHour: 2,
        remainingPct: 50,
        headroomHours: 25,
        exhaustsAt: '2026-07-15T03:00:00.000Z',
        hoursToReset: 5,
        exhaustsBeforeReset: false,
        samples: 10,
      },
    })
    const summary = budgetSummary(budget, 50)
    expect(summary).toContain('Weekly (all models): 50% used.')
    expect(summary).toContain('Burning 2.00%/hour.')
    expect(summary).toContain('will NOT hit the cap')
    expect(summary).toContain('Work freely')
    expect(summary).toContain('in 5.0h')
  })

  test('says it WILL hit the cap and gives the headroom hours when exhaustsBeforeReset is true', () => {
    const budget = mkBudget({
      forecast: {
        ...NULL_FORECAST,
        burnPctPerHour: 5,
        remainingPct: 15,
        headroomHours: 3,
        exhaustsAt: '2026-07-14T05:00:00.000Z',
        hoursToReset: 10,
        exhaustsBeforeReset: true,
        samples: 10,
      },
    })
    const summary = budgetSummary(budget, 85)
    expect(summary).toContain('Weekly (all models): 85% used.')
    expect(summary).toContain('Burning 5.00%/hour.')
    expect(summary).toContain('You WILL hit the cap in ~3.0h')
    expect(summary).toContain('before it resets in 10.0h')
    expect(summary).toContain('Plan around it.')
    expect(summary).not.toContain('Work freely')
  })

  test('includes the "~N more assistant turns" phrase when remainingTurns is non-null', () => {
    const budget = mkBudget({
      remainingTurns: 42,
      spend: { ...EMPTY_SPEND, turns: 7 },
      lookbackHours: 6,
      confidence: 'rough',
    })
    const summary = budgetSummary(budget, null)
    expect(summary).toContain('~42 more assistant turns')
    expect(summary).toContain('measured over 7 turns in the last 6h')
    expect(summary).toContain('Confidence: rough')
  })

  test('omits the turns phrase entirely when remainingTurns is null', () => {
    const budget = mkBudget({ remainingTurns: null })
    const summary = budgetSummary(budget, 10)
    expect(summary).not.toContain('more assistant turns')
  })

  test('the idle (burn === 0) case reads "not burning", not "work freely"', () => {
    const budget = mkBudget({
      forecast: {
        ...NULL_FORECAST,
        burnPctPerHour: 0,
        remainingPct: 70,
        exhaustsBeforeReset: false,
        samples: 3,
      },
    })
    const summary = budgetSummary(budget, 30)
    expect(summary).toContain('Not burning quota right now; the cap is not approaching.')
    expect(summary).not.toContain('Work freely')
  })

  test('handles the all-null / no-data budget without crashing', () => {
    const budget = mkBudget() // every default field null/none
    expect(() => budgetSummary(budget, null)).not.toThrow()
    const summary = budgetSummary(budget, null)
    expect(summary).toBe('') // nothing to say: no pct, no burn signal, no turn estimate
  })

  test('pct is rendered even with an otherwise all-null forecast', () => {
    const budget = mkBudget()
    const summary = budgetSummary(budget, 12)
    expect(summary).toBe('Weekly (all models): 12% used.')
  })
})
