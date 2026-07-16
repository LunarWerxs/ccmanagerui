// server/src/rate-limit-discovery.ts — find rate-limited sessions the daemon never dispatched.
//
// WHY THIS EXISTS. monitor.ts only ever saw `queue_items where status = 'rate_limited'`, and the
// ONLY way a row reaches that status is finalize() in dispatch.ts — i.e. a run THIS daemon spawned
// and tailed. A session you started yourself (a bare `claude` in a terminal, or the desktop app)
// that dies on a 5-hour limit has a transcript on disk and no queue row at all, so it could not
// reach the resume list by any path: the UI truthfully reported "nothing to resume" while real
// sessions sat waiting, and the only recourse was queueing them by hand. Measured on this machine
// 2026-07-16: 7 transcripts carried a genuine limit notice in the last 12h and 2 of them were still
// stopped at it — exactly the two the owner was looking at when the list said it had nothing.
//
// So: read the transcripts. The signature is the same one dispatch.ts trusts live — rate-limit-
// signal.ts's isApiErrorEvent + classifyLimit are imported here, never re-implemented or loosened,
// because that gate is what keeps the 2026-07-15 false-positive class from coming back at machine
// scale. Only a QUOTA verdict counts: a session felled by a transient 529 is not waiting on
// anything (its wall cleared in seconds), so parking it against the next reset would be the very
// conflation the split exists to kill. The stops this finds are handed to monitor.ts as ordinary
// QueueItem-shaped stops so they pass through the EXISTING rails unchanged: the weekly-usage gate,
// the per-session attempt cap, the idempotency check, the resume buffer. Nothing here schedules or
// dispatches anything itself.

import { instanceSessionMap } from './instance-sessions'
import { classifyLimit, isApiErrorEvent } from './rate-limit-signal'
import { getSession } from './sessions'
import { listTranscriptFiles } from './transcript'
import type { QueueItem } from './types'

/**
 * How far back a stop is still worth resuming. A 5-hour window's reset lands at most 5h after the
 * stop, so anything inside this bound is either about to clear or just cleared. Past it we assume
 * the human moved on: a transcript that has sat untouched for half a day is an abandoned session,
 * not a queue the app should quietly restart. A PENDING stop never gets written to again (that is
 * what makes it pending), so the file's mtime IS the moment it stopped — the filter is exact.
 */
export const DISCOVERY_WINDOW_MS = 12 * 60 * 60 * 1000

/** Bytes of tail to read per candidate. The notice is by definition at the end of a stopped
 *  transcript — nothing can follow a hard stop — so this never needs the 6–12 MB the display
 *  readers budget. Comfortably covers the last few turns even with fat tool results. */
const TAIL_BYTES = 256 * 1024

/** A rate-limited stop, shaped like the queue_items row monitor.ts already knows how to process.
 *  `discovered` marks the ones that came from disk rather than from a run we dispatched. */
export type RateLimitedStop = QueueItem & { discovered: boolean }

export interface RateLimitVerdict {
  /** The CLI's own notice, e.g. "You've hit your session limit · resets 9:10am (America/Chicago)". */
  notice: string
  /** True when nothing real followed the notice — the session is still sitting at the wall. */
  pending: boolean
}

/**
 * Classify a transcript's tail: did it stop on a rate limit, and is it still stopped?
 *
 * PENDING TEST. "The notice is the last meaningful line" is sound and self-maintaining, because the
 * CLI cannot resume a session whose last turn died on an API error without writing to the file: it
 * repairs the dangling tail with its own bookkeeping pair (an `isMeta` user line plus a
 * `<synthetic>` "No response requested." assistant line — see transcript.ts isCliBookkeeping). So
 * ANY resume, ours or a human's in a terminal, appends bytes and flips this to false on the next
 * scan. There is no cleanup to run and no state to reconcile: pending-ness is a pure function of
 * the file, recomputed every pass. A resume that wrote literally zero bytes does not occur.
 *
 * Exported for tests — the whole judgment is here, and it is pure.
 */
export function classifyRateLimitTail(jsonl: string): RateLimitVerdict | null {
  const lines = jsonl.split('\n')
  let notice: string | null = null
  let pending = true
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    let ev: any
    try {
      ev = JSON.parse(line)
    } catch {
      // A tail slice almost always begins mid-line; that fragment is not evidence of anything.
      continue
    }
    const type = ev?.type
    if (type !== 'user' && type !== 'assistant' && type !== 'result') continue

    // Only the CLI's own report counts — never model prose, tool inputs, or tool results (a run
    // that merely TALKS about rate limits is not rate-limited). Same rule dispatch.ts applies live.
    const trusted = isApiErrorEvent(ev) || (type === 'result' && ev?.is_error === true)
    const text = eventText(ev)
    // QUOTA only. A session stopped by a transient 529 is NOT a discovery subject: its wall cleared
    // seconds later, so parking it against the next 5-hour reset would be exactly the conflation
    // this whole split exists to kill. Our own runs retry a 529 in-process (dispatch.ts); a
    // terminal session that hit one and was left sitting is an abandoned session, not a queue.
    if (trusted && classifyLimit(text) === 'quota') {
      notice = compact(text)
      pending = true // a later notice supersedes an earlier one and re-opens the stop
      continue
    }
    // Anything else conversational after the notice means work resumed. The CLI's own resume
    // bookkeeping counts here on purpose: it only ever appears BECAUSE something resumed.
    if (notice) pending = false
  }
  if (!notice) return null
  return { notice, pending }
}

function eventText(ev: any): string {
  const content = ev?.message?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((b) => (b?.type === 'text' && typeof b.text === 'string' ? b.text : ''))
      .filter(Boolean)
      .join(' ')
  }
  if (typeof ev?.result === 'string') return ev.result
  return ''
}

function compact(s: string): string {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > 200 ? `${t.slice(0, 200)}…` : t
}

async function readTail(path: string, maxBytes: number): Promise<string> {
  const file = Bun.file(path)
  const start = Math.max(0, file.size - maxBytes)
  return start > 0 ? await file.slice(start).text() : await file.text()
}

/**
 * Every session that is sitting at a rate limit right now, as stops monitor.ts can process.
 *
 * `isBusy` lets the caller exclude sessions with a live run (monitor.ts passes isSessionActive):
 * a second `claude --resume` against a transcript that already has one is the exact collision the
 * dispatcher guards against everywhere else.
 */
export async function discoverPendingStops(
  opts: {
    isBusy?: (sessionId: string) => boolean
    hasQueueRow?: (sessionId: string) => boolean
    now?: number
    windowMs?: number
  } = {},
): Promise<RateLimitedStop[]> {
  const now = opts.now ?? Date.now()
  const windowMs = opts.windowMs ?? DISCOVERY_WINDOW_MS
  // The file list is already TTL-cached and swept on every /api/sessions call, and the mtime filter
  // runs before any read: on this machine that is ~30 candidates out of ~1200 transcripts.
  const recent = listTranscriptFiles().filter((f) => now - f.mtime_ms <= windowMs)
  const stops: RateLimitedStop[] = []

  for (const tf of recent) {
    if (opts.isBusy?.(tf.session_id)) continue
    // A session we already track (dispatched, or discovered on an earlier pass) is not ours to
    // rediscover — the queue row it owns is what monitor.ts processes.
    if (opts.hasQueueRow?.(tf.session_id)) continue

    let verdict: RateLimitVerdict | null
    try {
      verdict = classifyRateLimitTail(await readTail(tf.path, TAIL_BYTES))
    } catch {
      continue // an unreadable transcript is not a stop
    }
    if (!verdict?.pending) continue

    // Only the survivors pay for the full metadata scan (title/cwd via the shared, mtime-cached
    // reader) — that keeps the canonical title logic in exactly one place.
    const session = await getSession(tf.session_id)
    if (!session) continue

    stops.push({
      id: `disc:${tf.session_id}`,
      session_id: tf.session_id,
      title: session.title,
      cwd: session.cwd,
      // The resume prompt is monitor.ts's own locked constant; this field is never read for it.
      prompt: '',
      // Nothing on disk records the flags the session originally ran under, so a resume takes the
      // CLI's defaults. account_id stays null on purpose: a terminal session has no pasted
      // credential, and monitor.ts already reads the ambient login's quota for null accounts.
      model: null,
      effort: null,
      permission_mode: null,
      account_id: null,
      instance_ref: instanceSessionMap().get(tf.session_id) ?? null,
      new_chat: false,
      fork: false,
      status: 'rate_limited',
      pid: null,
      position: 0,
      not_before: null,
      retry_attempts: 0,
      started_at: null,
      finished_at: new Date(tf.mtime_ms).toISOString(),
      exit_code: null,
      created_at: tf.mtime_ms,
      discovered: true,
    })
  }
  return stops
}
