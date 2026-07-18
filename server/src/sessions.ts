import { db } from './db'
import { sessionMetaMap } from './instance-sessions'
import {
  decodeProjectKey,
  eventToTailEvents,
  isCommandWrapperText,
  listTranscriptFiles,
  type TranscriptFile,
  unwrapTaggedText,
} from './transcript'
import type { ArchivedScope, QueueStatus, SessionSummary } from './types'

function toEpoch(ts: unknown): number | null {
  if (typeof ts !== 'string') return null
  const n = Date.parse(ts)
  return Number.isNaN(n) ? null : n
}

function oneLine(s: string, n = 140): string {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n)}…` : t
}

interface ScannedMeta {
  title: string
  cwd: string
  git_branch: string | null
  message_count: number
  created_at: number | null
  last_activity_at: number
  last_role: 'user' | 'assistant' | null
  last_text_preview: string | null
  /** Turns that are neither CLI bookkeeping nor command plumbing — see transcript.hasSubstance.
   *  Zero means the transcript only ever held scaffolding, so there is nothing to list. */
  substantive_turns: number
}

// Per-file cache keyed by path+mtime so unchanged transcripts parse only once.
const metaCache = new Map<string, ScannedMeta>()

async function scanMeta(tf: TranscriptFile): Promise<ScannedMeta> {
  const key = `${tf.path}:${tf.mtime_ms}`
  const cached = metaCache.get(key)
  if (cached) return cached

  // read up to the last 12 MB — covers effectively every real transcript
  const file = Bun.file(tf.path)
  const start = Math.max(0, file.size - 12 * 1024 * 1024)
  const text = start > 0 ? await file.slice(start).text() : await file.text()

  let customTitle = ''
  let aiTitle = ''
  let lastPrompt = ''
  let firstUser = ''
  let cwd = ''
  let gitBranch: string | null = null
  let messageCount = 0
  let firstTs: number | null = null
  let lastTs: number | null = null
  let lastRole: 'user' | 'assistant' | null = null
  let lastPreview: string | null = null
  let substantive = 0

  for (const line of text.split('\n')) {
    const l = line.trim()
    if (!l) continue
    let ev: any
    try {
      ev = JSON.parse(l)
    } catch {
      continue
    }
    switch (ev.type) {
      case 'custom-title':
        if (typeof ev.customTitle === 'string') customTitle = ev.customTitle
        continue
      case 'ai-title':
        if (typeof ev.aiTitle === 'string') aiTitle = ev.aiTitle
        continue
      case 'last-prompt':
        // Same rule as firstUser below: a slash command's `<command-name>` echo lands here too,
        // and it describes the plumbing rather than the work.
        if (typeof ev.lastPrompt === 'string' && !isCommandWrapperText(ev.lastPrompt))
          lastPrompt = ev.lastPrompt
        continue
    }
    if (typeof ev.cwd === 'string' && !cwd) cwd = ev.cwd
    if (typeof ev.gitBranch === 'string' && ev.gitBranch) gitBranch = ev.gitBranch

    const role = ev.message?.role ?? ev.type
    if (role === 'user' || role === 'assistant') {
      messageCount++
      const t = toEpoch(ev.timestamp)
      if (t !== null) {
        if (firstTs === null) firstTs = t
        lastTs = t
      }
      // eventToTailEvents is the ONE place that knows what is real: it drops thinking blocks and
      // the CLI's own resume bookkeeping (isMeta / <synthetic> self-talk). Reading
      // `ev.message.content` straight off the event bypassed all of that, which is exactly how the
      // `isMeta` local-command caveat became the title of 103 of the newest 200 sessions.
      const tes = eventToTailEvents(ev)
      const real = tes.filter((e) => e.text && !isCommandWrapperText(e.text))
      if (real.length > 0) substantive++
      if (!firstUser && role === 'user') {
        firstUser = real.find((e) => e.kind === 'text')?.text ?? ''
      }
      const textEv = [...tes].reverse().find((e) => e.kind === 'text')
      if (textEv) {
        lastRole = textEv.role
        lastPreview = oneLine(textEv.text)
      } else if (tes.length > 0) {
        lastRole = role
        lastPreview = lastPreview ?? oneLine(tes[tes.length - 1].text)
      }
    }
  }

  // unwrapTaggedText only touches the two derived-from-a-turn sources: an explicit custom/AI title
  // is already a label and must never be second-guessed.
  const derived = unwrapTaggedText(lastPrompt || firstUser || '')
  const title = oneLine(customTitle || aiTitle || derived || tf.session_id, 120)
  const meta: ScannedMeta = {
    title,
    cwd: cwd || decodeProjectKey(tf.project),
    git_branch: gitBranch,
    message_count: messageCount,
    created_at: firstTs,
    last_activity_at: lastTs ?? tf.mtime_ms,
    last_role: lastRole,
    last_text_preview: lastPreview,
    substantive_turns: substantive,
  }
  metaCache.set(key, meta)
  return meta
}

/** Map of session_id -> most-relevant queue status (running/queued win over terminal). */
function queueStatusMap(): Map<string, QueueStatus> {
  const rows = db
    .query<{ session_id: string; status: QueueStatus }, []>(
      'select session_id, status from queue_items order by created_at asc',
    )
    .all()
  const rank: Record<QueueStatus, number> = {
    running: 7,
    queued: 6,
    rate_limited: 5,
    // Just under rate_limited: both mean "stopped at a wall, not finished", but a spent quota is the
    // more useful thing to surface when a session carries both.
    overloaded: 4,
    failed: 3,
    completed: 2,
    canceled: 1,
  }
  const map = new Map<string, QueueStatus>()
  for (const r of rows) {
    const prev = map.get(r.session_id)
    if (!prev || rank[r.status] >= rank[prev]) map.set(r.session_id, r.status)
  }
  return map
}

/** Map of session_id -> the user's own "done" mark (session_marks table). */
function doneMarkMap(): Map<string, boolean> {
  const rows = db
    .query<{ session_id: string; done: number }, []>('select session_id, done from session_marks')
    .all()
  const map = new Map<string, boolean>()
  for (const r of rows) map.set(r.session_id, !!r.done)
  return map
}

/**
 * List the newest transcripts, optionally scoped to one instance BEFORE the cap:
 * `instance` = an instance dir name, "default" (non-isolated install), or "other"
 * (unmapped, i.e. plain CLI). Filtering first matters — with thousands of transcripts
 * in the shared store, a quiet instance's sessions would never crack the newest-200.
 *
 * `archived` gets the same before-the-cap treatment as `instance`, and for the same
 * reason: a window full of archived rows would otherwise starve the newest-N of live ones,
 * and 'only' would surface almost nothing if the cap ran first.
 * Archived is Claude Desktop's own read-only flag; it never depends on `done`, which is a
 * mark only and must never filter a session out of this list.
 *
 * `sinceMs` is the same idea one step further: an epoch cutoff on last activity, applied to the
 * cheap mtime index before anything is parsed. Null means no cutoff.
 *
 * Transcripts with no substantive turn are dropped unconditionally (no scope opts back into them).
 * They are not short sessions, they are CLI scaffolding — a `/usage` probe writes a caveat, a
 * `<command-name>` line and nothing else. On this machine that was 127 of the newest 300, all ~3 KB
 * and all titled with the same caveat banner. Since that verdict needs a parse, the scan runs in
 * batches and keeps pulling until it has `limit` real sessions, rather than capping first and
 * returning a short list full of holes.
 */
export async function listSessions(
  limit = 200,
  instance?: string,
  archived: ArchivedScope = 'hide',
  sinceMs: number | null = null,
): Promise<SessionSummary[]> {
  const mmap = sessionMetaMap()
  let files = listTranscriptFiles()
  if (instance) {
    files = files.filter((f) =>
      instance === 'other'
        ? !mmap.has(f.session_id)
        : mmap.get(f.session_id)?.instance === instance,
    )
  }
  if (archived !== 'include') {
    const want = archived === 'only'
    files = files.filter((f) => !!mmap.get(f.session_id)?.archived === want)
  }
  if (sinceMs !== null) files = files.filter((f) => f.mtime_ms >= sinceMs)
  files = files.sort((a, b) => b.mtime_ms - a.mtime_ms)
  const qmap = queueStatusMap()
  const dmap = doneMarkMap()

  const toSummary = async (tf: TranscriptFile): Promise<SessionSummary | null> => {
    const m = await scanMeta(tf)
    if (m.substantive_turns === 0) return null
    // The mtime pass above is a cheap SUPERSET (writing a turn always touches the file, so mtime is
    // never older than the last activity). It is not exact, though: a transcript can be touched
    // without gaining a timestamped turn, which put rows reading "2d ago" inside a "Last 24 hours"
    // window. Re-check against the timestamp the row actually DISPLAYS, now that it is parsed.
    if (sinceMs !== null && m.last_activity_at < sinceMs) return null
    return {
      session_id: tf.session_id,
      title: m.title,
      cwd: m.cwd,
      project: tf.project,
      git_branch: m.git_branch,
      message_count: m.message_count,
      created_at: m.created_at,
      last_activity_at: m.last_activity_at,
      last_role: m.last_role,
      last_text_preview: m.last_text_preview,
      size_bytes: tf.size_bytes,
      transcript_path: tf.path,
      queue_status: qmap.get(tf.session_id) ?? null,
      instance: mmap.get(tf.session_id)?.instance ?? null,
      archived: mmap.get(tf.session_id)?.archived ?? false,
      done: dmap.get(tf.session_id) ?? false,
    }
  }

  // Batched so a run of stubs costs extra parses only when it actually occurs: a store with no
  // scaffolding in it parses exactly `limit` files, the same as before.
  const out: SessionSummary[] = []
  for (let cursor = 0; cursor < files.length && out.length < limit; ) {
    const batch = files.slice(cursor, cursor + (limit - out.length))
    cursor += batch.length
    const scanned = await Promise.all(batch.map(toSummary))
    for (const s of scanned) if (s) out.push(s)
  }
  out.sort((a, b) => b.last_activity_at - a.last_activity_at)
  return out
}

export async function getSession(sessionId: string): Promise<SessionSummary | null> {
  const tf = listTranscriptFiles().find((f) => f.session_id === sessionId)
  if (!tf) return null
  const m = await scanMeta(tf)
  const qmap = queueStatusMap()
  const dmap = doneMarkMap()
  const meta = sessionMetaMap().get(tf.session_id)
  return {
    session_id: tf.session_id,
    title: m.title,
    cwd: m.cwd,
    project: tf.project,
    git_branch: m.git_branch,
    message_count: m.message_count,
    created_at: m.created_at,
    last_activity_at: m.last_activity_at,
    last_role: m.last_role,
    last_text_preview: m.last_text_preview,
    size_bytes: tf.size_bytes,
    transcript_path: tf.path,
    queue_status: qmap.get(tf.session_id) ?? null,
    instance: meta?.instance ?? null,
    archived: meta?.archived ?? false,
    done: dmap.get(sessionId) ?? false,
  }
}
