import { statSync } from 'node:fs'
import { basename, join } from 'node:path'
import { CLAUDE_PROJECTS_ROOT } from './config'
import type { TailEvent, TailResult } from './types'

// --- cwd folder-name encoding (forward only; reverse is lossy) --------------

/** Mirror Claude Code's project-folder key: non [A-Za-z0-9_-] chars collapse to '-'. */
export function encodeCwdKey(cwd: string): string {
  return cwd.replace(/[\\/]+$/, '').replace(/[^A-Za-z0-9_-]/g, '-')
}

/** Best-effort reverse of a project folder name back to a path (only used if no cwd on events). */
export function decodeProjectKey(key: string): string {
  // e.g. "C--Projects-MyApp" -> "C:\Projects\MyApp" (heuristic)
  const m = key.match(/^([A-Za-z])--(.*)$/)
  if (m) return `${m[1]}:\\${m[2].replace(/-/g, '\\')}`
  return key.replace(/-/g, '/')
}

// --- transcript file index (TTL-cached) -------------------------------------

export interface TranscriptFile {
  session_id: string
  path: string
  project: string
  mtime_ms: number
  size_bytes: number
}

let cache: { at: number; files: TranscriptFile[] } | null = null
const TTL_MS = 2000

export function listTranscriptFiles(force = false): TranscriptFile[] {
  const now = performance.now()
  if (!force && cache && now - cache.at < TTL_MS) return cache.files

  const files: TranscriptFile[] = []
  const glob = new Bun.Glob('*/*.jsonl')
  for (const rel of glob.scanSync({ cwd: CLAUDE_PROJECTS_ROOT, onlyFiles: true })) {
    const path = join(CLAUDE_PROJECTS_ROOT, rel)
    let st: ReturnType<typeof statSync>
    try {
      st = statSync(path)
    } catch {
      continue
    }
    const project = rel.split(/[\\/]/)[0]
    files.push({
      session_id: basename(rel).replace(/\.jsonl$/, ''),
      path,
      project,
      mtime_ms: st.mtimeMs,
      size_bytes: st.size,
    })
  }
  cache = { at: now, files }
  return files
}

export function findTranscript(sessionId: string): TranscriptFile | null {
  const matches = listTranscriptFiles().filter((f) => f.session_id === sessionId)
  if (matches.length === 0) return null
  // newest wins if a session id appears under multiple project folders
  return matches.reduce((a, b) => (b.mtime_ms > a.mtime_ms ? b : a))
}

// --- byte-tail reader --------------------------------------------------------

async function readTailBytes(path: string, maxBytes: number): Promise<string> {
  const file = Bun.file(path)
  const size = file.size
  const start = Math.max(0, size - maxBytes)
  const blob = start > 0 ? file.slice(start) : file
  return await blob.text()
}

// --- text helpers ------------------------------------------------------------

function compact(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s
}

function stringifyToolResult(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((c) =>
        c && typeof c === 'object' && typeof (c as any).text === 'string' ? (c as any).text : '',
      )
      .filter(Boolean)
      .join('\n')
  }
  if (content == null) return ''
  try {
    return JSON.stringify(content)
  } catch {
    return String(content)
  }
}

/**
 * Bookkeeping the CLI writes into its own transcript that was never part of the conversation.
 *
 * Resuming a session whose last turn died on an API error makes `claude` repair the dangling tail
 * by appending a canned pair — user `isMeta: true` "Continue from where you left off." plus a
 * `<synthetic>` assistant "No response requested." — both stamped with the SAME millisecond,
 * because no model was ever called. Rendering them as real turns tells a story that never happened:
 * it reads as though we prompted the session and it refused, when the CLI was talking to itself
 * (mis-read exactly that way 2026-07-15; the run had in fact been sent nothing but "resume").
 *
 * The rate-limit notice is the ONE synthetic message worth keeping: it is also `<synthetic>` but
 * carries `isApiErrorMessage: true`, and it is the only thing on screen that explains why a session
 * stopped. Keep that; drop the self-talk.
 */
function isCliBookkeeping(ev: any): boolean {
  if (ev?.isMeta === true) return true
  return ev?.message?.model === '<synthetic>' && ev?.isApiErrorMessage !== true
}

/**
 * Plumbing the CLI wraps in pseudo-tags and stores as an ordinary user message: slash-command
 * invocations, hook output, bash echoes, the local-command caveat. It is addressed to the MODEL,
 * not written by the human, so it must never stand in for what a session is "about".
 *
 * Unlike the bookkeeping above, most of these carry no `isMeta` flag, so this tag scan is the only
 * thing that catches them. It is what keeps a `/usage` probe — a transcript holding nothing but a
 * caveat and a `<command-name>` line — from being listed as a real session (see sessions.ts).
 */
const COMMAND_WRAPPER =
  /^\s*<\/?(local-command-caveat|local-command-stdout|local-command-stderr|command-name|command-message|command-args|system-reminder|user-prompt-submit-hook|bash-input|bash-stdout|bash-stderr)\b/i

export function isCommandWrapperText(text: string): boolean {
  return COMMAND_WRAPPER.test(text)
}

/**
 * Pull a readable label out of a turn that is real work wrapped in a pseudo-tag.
 *
 * Distinct from COMMAND_WRAPPER above, and the difference is the whole point: that list is
 * plumbing to be ignored outright, whereas a `<scheduled-task name="…">` turn IS the session's
 * actual prompt — it just arrives wearing an envelope. Dropping it would leave a genuine session
 * titled with its uuid; keeping it whole titled one "<scheduled-task name="studio-executor-parity-
 * sweep" file="C:\Users\…">".
 *
 * Prefers a `name` attribute (someone chose that string as a label) and otherwise falls back to the
 * body text. Anything that isn't a wrapped turn passes through untouched.
 */
export function unwrapTaggedText(text: string): string {
  const open = text.match(/^\s*<([a-z][\w-]*)\b([^>]*)>/i)
  if (!open) return text
  const name = open[2].match(/\bname\s*=\s*"([^"]+)"/i)?.[1]
  if (name?.trim()) return name.trim()
  const body = text
    .slice(open[0].length)
    .replace(new RegExp(`</${open[1]}\\s*>\\s*$`, 'i'), '')
    .trim()
  return body || text
}

/**
 * THE hide-"thinking" filter. Turns one raw transcript JSONL event into zero or more
 * displayable TailEvents. Reused for both disk-tail reading and the live stream-json path,
 * so the rule lives in exactly one place (per the rebuild plan).
 *
 * Rules:
 *  - keep only user/assistant events
 *  - drop the CLI's own resume bookkeeping (see isCliBookkeeping)
 *  - drop `thinking` and `redacted_thinking` content blocks entirely (explicit type check)
 *  - assistant `text` -> text event
 *  - `tool_use` -> collapsed tool event (name + compact input)
 *  - user `tool_result` -> collapsed tool_result event
 *  - a plain-string user message -> text event
 */
export function eventToTailEvents(ev: any): TailEvent[] {
  const message = ev?.message
  const role: string | undefined = message?.role ?? ev?.type
  const type: string | undefined = ev?.type
  if (type !== 'user' && type !== 'assistant' && role !== 'user' && role !== 'assistant') return []
  if (isCliBookkeeping(ev)) return []
  const r: 'user' | 'assistant' =
    role === 'assistant' || type === 'assistant' ? 'assistant' : 'user'
  const ts: string | null = ev?.timestamp ?? null
  const content = message?.content
  const out: TailEvent[] = []

  if (typeof content === 'string') {
    const t = compact(content)
    if (t)
      out.push({ role: r, kind: 'text', text: truncate(t, 6000), tool_name: null, timestamp: ts })
    return out
  }

  if (Array.isArray(content)) {
    for (const block of content) {
      if (!block || typeof block !== 'object') continue
      const bt = block.type
      if (bt === 'thinking' || bt === 'redacted_thinking') continue // <- the filter
      if (bt === 'text' && typeof block.text === 'string') {
        const t = compact(block.text)
        if (t)
          out.push({
            role: r,
            kind: 'text',
            text: truncate(t, 6000),
            tool_name: null,
            timestamp: ts,
          })
      } else if (bt === 'tool_use') {
        const input = block.input ? truncate(compact(JSON.stringify(block.input)), 1200) : ''
        out.push({
          role: 'assistant',
          kind: 'tool_use',
          text: input,
          tool_name: block.name ?? 'tool',
          timestamp: ts,
        })
      } else if (bt === 'tool_result') {
        const t = compact(stringifyToolResult(block.content))
        if (t)
          out.push({
            role: 'user',
            kind: 'tool_result',
            text: truncate(t, 2000),
            tool_name: null,
            timestamp: ts,
          })
      }
    }
  }
  return out
}

export interface TailOptions {
  limit?: number
  /** When true, drop tool_use/tool_result and only count text-bearing turns toward the limit. */
  textOnly?: boolean
  title?: string
  cwd?: string
}

/** Read the last `limit` real turns of a session's transcript, thinking filtered out. */
export async function tailTranscript(
  sessionId: string,
  opts: TailOptions = {},
): Promise<TailResult> {
  const limit = opts.limit ?? 40
  const textOnly = opts.textOnly ?? false
  const tf = findTranscript(sessionId)
  if (!tf) {
    return {
      session_id: sessionId,
      title: opts.title ?? sessionId,
      cwd: opts.cwd ?? '',
      events: [],
      error: 'transcript not found',
    }
  }
  const raw = await readTailBytes(tf.path, 6 * 1024 * 1024)
  const lines = raw.split('\n')
  const collected: TailEvent[][] = []
  let title = opts.title ?? ''
  let cwd = opts.cwd ?? ''

  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim()
    if (!line) continue
    let ev: any
    try {
      ev = JSON.parse(line)
    } catch {
      continue
    }
    if (!cwd && typeof ev?.cwd === 'string') cwd = ev.cwd
    let tes = eventToTailEvents(ev)
    if (textOnly) tes = tes.filter((e) => e.kind === 'text')
    if (tes.length === 0) continue
    collected.push(tes)
    if (collected.length >= limit) break
  }

  const events = collected.reverse().flat()
  if (!title) title = sessionId
  return { session_id: sessionId, title, cwd: cwd || decodeProjectKey(tf.project), events }
}
