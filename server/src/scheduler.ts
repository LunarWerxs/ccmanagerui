import { db, getSetting, setSetting } from './db'
import { activeCount, dispatchItem, isSessionActive } from './dispatch'
import type { QueueItem, SchedulerState } from './types'

let timer: ReturnType<typeof setInterval> | null = null
let lastDispatchAt = 0

function num(key: string, fallback: number): number {
  const n = Number(getSetting(key))
  return Number.isFinite(n) ? n : fallback
}

/** "HH:MM" (24h) or the 09:00 default; anything malformed in the kv store falls back. */
export function tomorrowTime(): string {
  const v = getSetting('tomorrow_time') ?? ''
  return /^([01]?\d|2[0-3]):[0-5]\d$/.test(v) ? v : '09:00'
}

function tick() {
  if (getSetting('scheduler_enabled') !== '1') return
  const maxConcurrent = num('max_concurrent', 3)
  const spacingSeconds = num('spacing_seconds', 60)

  if (activeCount() >= maxConcurrent) return
  if (Date.now() - lastDispatchAt < spacingSeconds * 1000) return

  // not_before gates auto-dispatch only (manual Run ignores it); ISO-8601 UTC strings
  // compare correctly as text. Neither a future-scheduled head item nor one whose
  // session is mid-run may block the rest; skip to the first dispatchable candidate.
  const candidates = db
    .query<QueueItem, [string]>(
      `select * from queue_items
       where status = 'queued' and (not_before is null or not_before <= ?)
       order by position asc, created_at asc limit 20`,
    )
    .all(new Date().toISOString())
  const next = candidates.find((item) => !isSessionActive(item.session_id))
  if (!next) return

  lastDispatchAt = Date.now()
  // fire-and-forget; dispatchItem persists status transitions itself
  void dispatchItem(coerce(next))
}

// bun:sqlite returns integers for our boolean columns; coerce to real booleans
function coerce(row: any): QueueItem {
  return { ...row, new_chat: !!row.new_chat, fork: !!row.fork }
}

export function startScheduler() {
  if (timer) return
  const pollSeconds = Math.max(1, num('poll_seconds', 5))
  timer = setInterval(tick, pollSeconds * 1000)
}

export function stopScheduler() {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

export function setSchedulerEnabled(enabled: boolean) {
  setSetting('scheduler_enabled', enabled ? '1' : '0')
  if (enabled) {
    lastDispatchAt = 0 // allow an immediate first dispatch
    startScheduler()
  }
}

export function schedulerState(): SchedulerState {
  const counts = db
    .query<{ status: string; c: number }, []>(
      'select status, count(*) as c from queue_items group by status',
    )
    .all()
  const byStatus = Object.fromEntries(counts.map((r) => [r.status, r.c]))
  return {
    enabled: getSetting('scheduler_enabled') === '1',
    running_count: activeCount(),
    queued_count: byStatus.queued ?? 0,
    spacing_seconds: num('spacing_seconds', 60),
    poll_seconds: num('poll_seconds', 5),
    max_concurrent: num('max_concurrent', 3),
    tomorrow_time: tomorrowTime(),
  }
}

// Always run the timer loop; the tick itself is a no-op unless enabled.
startScheduler()
