// server/tests/monitor.test.ts — the auto-resume monitor state machine (server/src/monitor.ts).
//
// Covers the enabled gate, candidate selection, every outcome of the usage gate (unreadable →
// needs_human, weekly maxed → blocked_weekly, weekly has room → scheduled), idempotency, the
// per-account override, and the settings round-trip. Uses the isolated test DB (tests/setup.ts).
//
// The usage reading is injected via MonitorDeps, which is what lets the gate be tested at all. It
// used to be unreachable here: a run with no dispatch account short-circuited to needs_human before
// the gate, and every test ran with no account, so the whole scheduling path was left to manual
// verification. Now that ambient runs go through the gate like any other, a real read would hit the
// network with the developer's own login (or spawn `claude -p "/usage"`, ~9s) — so the snapshot is
// handed in instead. Deliberately NOT mock.module: in Bun that is global for the whole run and leaks
// into every other test file (it broke desktop-install.test.ts when tried).

import { afterEach, describe, expect, test } from 'bun:test'
import { db, getSetting, setSetting } from '../server/src/db'
import {
  getMonitorSettings,
  listMonitorAccounts,
  type MonitorDeps,
  monitorEnabledForAccount,
  monitorStatus,
  runMonitorOnce,
  setMonitorForAccount,
  setMonitorSettings,
} from '../server/src/monitor'
import type { UsageSnapshot } from '../server/src/types'

const snapshot = (weekAllPct: number | null): UsageSnapshot => ({
  account: 'test',
  session: {
    pct: 50,
    resets: 'Jul 15, 6:00pm',
    resetsAt: new Date(Date.now() + 3_600_000).toISOString(),
  },
  weekAll: weekAllPct === null ? null : { pct: weekAllPct, resets: 'Jul 19, 3:59am' },
  weekModel: null,
  capturedAt: new Date().toISOString(),
})

/** A usage reader that always answers with `snap`, and counts the accountIds it was asked about. */
function reader(snap: UsageSnapshot): MonitorDeps & { asked: (string | null)[] } {
  const asked: (string | null)[] = []
  return {
    asked,
    readUsage: async (accountId) => {
      asked.push(accountId)
      return snap
    },
  }
}

const PREFIX = 'MONTEST_'

function insertRateLimited(id: string, sessionId: string, accountId: string | null = null): void {
  db.query(
    `insert into queue_items (id, session_id, title, cwd, prompt, account_id, status, position, created_at)
     values (?, ?, ?, ?, ?, ?, 'rate_limited', 0, ?)`,
  ).run(id, sessionId, 'test run', 'D:/x', 'do work', accountId, Date.now())
}

function stateFor(itemId: string) {
  return monitorStatus().find((r) => r.itemId === itemId) ?? null
}

afterEach(() => {
  db.query(`delete from monitor_state where item_id like '${PREFIX}%'`).run()
  db.query(`delete from queue_items where id like '${PREFIX}%'`).run()
  db.query(`delete from queue_items where title like 'Auto-resume: test run%'`).run()
  db.query(`delete from monitor_accounts where account_id like '${PREFIX}%'`).run()
  setSetting('monitor_enabled', '0')
})

describe('monitor gate', () => {
  test('does nothing when disabled', async () => {
    setSetting('monitor_enabled', '0')
    insertRateLimited(`${PREFIX}a`, `${PREFIX}sess-a`)
    await runMonitorOnce(reader(snapshot(10)))
    expect(stateFor(`${PREFIX}a`)).toBeNull()
  })

  // The regression this guards: a run with no dispatch account is the DEFAULT (the accounts table is
  // empty until someone pastes a token in), and it used to be parked at needs_human on sight — so the
  // monitor resumed nothing at all for the common case. Ambient is a readable login, not a dead end.
  test('a run with no account is gated on the AMBIENT login, not refused for lacking an account', async () => {
    setSetting('monitor_enabled', '1')
    const deps = reader(snapshot(10)) // weekly has room
    insertRateLimited(`${PREFIX}b`, `${PREFIX}sess-b`)
    await runMonitorOnce(deps)
    const s = stateFor(`${PREFIX}b`)
    // asked about the AMBIENT login (null account) instead of refusing on sight
    expect(deps.asked).toEqual([null])
    expect(s?.state).toBe('scheduled')
    expect(s?.resumeItemId).not.toBeNull()
    // the scheduled resume is a real queued item carrying the locked prompt
    const resume = db
      .query<{ prompt: string; status: string; not_before: string | null }, [string]>(
        'select prompt, status, not_before from queue_items where id = ?',
      )
      .get(s?.resumeItemId as string)
    expect(resume?.status).toBe('queued')
    expect(resume?.prompt).toBe('resume')
    expect(resume?.not_before).not.toBeNull()
  })

  test('an unreadable usage reading is never treated as "plenty left"', async () => {
    setSetting('monitor_enabled', '1')
    insertRateLimited(`${PREFIX}d`, `${PREFIX}sess-d`)
    await runMonitorOnce(reader(snapshot(null))) // no weekAll = no reading
    const s = stateFor(`${PREFIX}d`)
    expect(s?.state).toBe('needs_human')
    expect(s?.resumeItemId).toBeNull()
  })

  test('a maxed weekly cap blocks the resume rather than slamming the wall', async () => {
    setSetting('monitor_enabled', '1')
    insertRateLimited(`${PREFIX}e`, `${PREFIX}sess-e`)
    await runMonitorOnce(reader(snapshot(100)))
    const s = stateFor(`${PREFIX}e`)
    expect(s?.state).toBe('blocked_weekly')
    expect(s?.resumeItemId).toBeNull()
  })

  test('is idempotent — a second pass does not add a duplicate state row or a second resume', async () => {
    setSetting('monitor_enabled', '1')
    insertRateLimited(`${PREFIX}c`, `${PREFIX}sess-c`)
    await runMonitorOnce(reader(snapshot(10)))
    await runMonitorOnce(reader(snapshot(10)))
    const mine = monitorStatus().filter((r) => r.itemId === `${PREFIX}c`)
    expect(mine.length).toBe(1)
    const resumes = db
      .query<{ n: number }, [string]>(
        "select count(*) as n from queue_items where session_id = ? and title like 'Auto-resume:%'",
      )
      .get(`${PREFIX}sess-c`)
    expect(resumes?.n).toBe(1)
  })
})

describe('per-account override', () => {
  test('an explicit disabled row opts an account out; others default on', () => {
    setMonitorForAccount(`${PREFIX}acc1`, false)
    expect(monitorEnabledForAccount(`${PREFIX}acc1`)).toBe(false)
    expect(monitorEnabledForAccount(`${PREFIX}acc2`)).toBe(true) // absent row = follow global
    expect(listMonitorAccounts()[`${PREFIX}acc1`]).toBe(false)
  })
})

describe('settings', () => {
  test('round-trips maxAttempts + resumeBufferMin and keeps a sane resumePrompt', () => {
    setMonitorSettings({ maxAttempts: 5, resumeBufferMin: 10 })
    const s = getMonitorSettings()
    expect(s.maxAttempts).toBe(5)
    expect(s.resumeBufferMin).toBe(10)
    expect(s.resumePrompt.length).toBeGreaterThan(0)
    // restore defaults for the shared test DB
    setSetting('monitor_max_attempts', '3')
    setSetting('monitor_resume_buffer_min', '3')
    expect(getSetting('monitor_max_attempts')).toBe('3')
  })
})
