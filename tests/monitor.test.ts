// server/tests/monitor.test.ts — the auto-resume monitor state machine (server/src/monitor.ts).
//
// Covers the branches that DON'T spawn `claude`: the enabled gate, candidate selection, the
// no-account → needs_human path, idempotency (no duplicate state rows), per-account override, and
// the settings round-trip. The usage-gated scheduling path (which spawns `claude -p "/usage"`) is
// covered by runtime verification, not here. Uses the isolated test DB (tests/setup.ts).

import { afterEach, describe, expect, test } from 'bun:test'
import { db, getSetting, setSetting } from '../server/src/db'
import {
  getMonitorSettings,
  listMonitorAccounts,
  monitorEnabledForAccount,
  monitorStatus,
  runMonitorOnce,
  setMonitorForAccount,
  setMonitorSettings,
} from '../server/src/monitor'

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
  db.query(`delete from monitor_accounts where account_id like '${PREFIX}%'`).run()
  setSetting('monitor_enabled', '0')
})

describe('monitor gate', () => {
  test('does nothing when disabled', async () => {
    setSetting('monitor_enabled', '0')
    insertRateLimited(`${PREFIX}a`, `${PREFIX}sess-a`)
    await runMonitorOnce()
    expect(stateFor(`${PREFIX}a`)).toBeNull()
  })

  test('a rate-limited run with no account is flagged needs_human (never resumed blindly)', async () => {
    setSetting('monitor_enabled', '1')
    insertRateLimited(`${PREFIX}b`, `${PREFIX}sess-b`)
    await runMonitorOnce()
    const s = stateFor(`${PREFIX}b`)
    expect(s?.state).toBe('needs_human')
    expect(s?.resumeItemId).toBeNull()
  })

  test('is idempotent — a second pass does not add a duplicate state row', async () => {
    setSetting('monitor_enabled', '1')
    insertRateLimited(`${PREFIX}c`, `${PREFIX}sess-c`)
    await runMonitorOnce()
    await runMonitorOnce()
    const mine = monitorStatus().filter((r) => r.itemId === `${PREFIX}c`)
    expect(mine.length).toBe(1)
    expect(mine[0]?.state).toBe('needs_human')
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
