import { db } from './db'
import { instanceSessionMap } from './instance-sessions'
import {
  decodeProjectKey,
  eventToTailEvents,
  listTranscriptFiles,
  type TranscriptFile,
} from './transcript'
import type { QueueStatus, SessionSummary } from './types'

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
        if (typeof ev.lastPrompt === 'string') lastPrompt = ev.lastPrompt
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
      if (!firstUser && role === 'user' && typeof ev.message?.content === 'string') {
        firstUser = ev.message.content
      }
      const tes = eventToTailEvents(ev)
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

  const title = oneLine(customTitle || aiTitle || lastPrompt || firstUser || tf.session_id, 120)
  const meta: ScannedMeta = {
    title,
    cwd: cwd || decodeProjectKey(tf.project),
    git_branch: gitBranch,
    message_count: messageCount,
    created_at: firstTs,
    last_activity_at: lastTs ?? tf.mtime_ms,
    last_role: lastRole,
    last_text_preview: lastPreview,
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
    running: 6,
    queued: 5,
    rate_limited: 4,
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

/**
 * List the newest transcripts, optionally scoped to one instance BEFORE the cap:
 * `instance` = an instance dir name, "default" (non-isolated install), or "other"
 * (unmapped, i.e. plain CLI). Filtering first matters — with thousands of transcripts
 * in the shared store, a quiet instance's sessions would never crack the newest-200.
 */
export async function listSessions(limit = 200, instance?: string): Promise<SessionSummary[]> {
  const imap = instanceSessionMap()
  let files = listTranscriptFiles()
  if (instance) {
    files = files.filter((f) =>
      instance === 'other' ? !imap.has(f.session_id) : imap.get(f.session_id) === instance,
    )
  }
  files = files.sort((a, b) => b.mtime_ms - a.mtime_ms).slice(0, limit)
  const qmap = queueStatusMap()

  const out = await Promise.all(
    files.map(async (tf): Promise<SessionSummary> => {
      const m = await scanMeta(tf)
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
        instance: imap.get(tf.session_id) ?? null,
      }
    }),
  )
  out.sort((a, b) => b.last_activity_at - a.last_activity_at)
  return out
}

export async function getSession(sessionId: string): Promise<SessionSummary | null> {
  const tf = listTranscriptFiles().find((f) => f.session_id === sessionId)
  if (!tf) return null
  const m = await scanMeta(tf)
  const qmap = queueStatusMap()
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
    instance: instanceSessionMap().get(tf.session_id) ?? null,
  }
}
