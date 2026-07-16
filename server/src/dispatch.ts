import { spawn as nodeSpawn } from 'node:child_process'
import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  readSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { DB_PATH, IS_COMPILED, RUN_LOG_DIR, resolveClaudeExe } from './config'
import { getCliInstance } from './core/cli-instances'
import { db } from './db'
import { buildDetachedSpawn } from './detached-spawn.mjs'
import { eventToTailEvents } from './transcript'
import type { QueueItem, RunEvent } from './types'

// A dispatched `claude` run must OUTLIVE the daemon: quitting CC Manager UI (or an auto-update
// relaunch) tree-kills the daemon (`taskkill /T`), and killing in-flight work with it is exactly
// what we refuse to do. So the daemon does NOT spawn `claude` directly. It spawns a DETACHED
// supervisor (dispatch-runner.ts) that owns `claude` and appends its output to a per-run log file;
// the daemon merely TAILS that log. When the daemon dies, the runner + `claude` keep running to
// completion; the next daemon reattaches by re-reading the log (reattachRuns). Design verified
// end-to-end 2026-07-12 (see dispatch-runner.ts header + server-lib/detached-spawn.mjs).

// --- rate-limit detection (ported from the Python smart-loop pattern list) ---

const RATE_LIMIT_PATTERNS: RegExp[] = [
  /\byou['’]?ve hit your session limit\b/i,
  /\bsession limit\b/i,
  /\busage limit\b/i,
  /\brate[- ]?limit(?:ed|ing)?\b/i,
  /\btoo many requests\b/i,
  /\b429\b/,
  /\b529\b/,
  /\btemporarily unavailable\b/i,
  /\btry again later\b/i,
  /\boverloaded\b/i,
  /\bquota\b/i,
]

/** Exported: rate-limit-discovery.ts runs this SAME detector over transcripts on disk, so a stop
 *  the daemon watched live and one it finds after the fact are judged by identical rules. */
export function looksRateLimited(text: string): boolean {
  return RATE_LIMIT_PATTERNS.some((re) => re.test(text))
}

/**
 * WHERE a rate-limit pattern is allowed to match — the other half of the detector, and the more
 * important one.
 *
 * The patterns above are deliberately loose (`\b529\b`, `\bquota\b`), which is fine for text the
 * CLI itself emits about its own state and catastrophic for anything else. Matching them against
 * every event marked EVERY run that merely TALKED about rate limits as rate-limited: an agent
 * grepping for "session limit", a Read whose output happened to contain line number 529, an Edit
 * touching this very file. Both `rate_limited` rows in the shipped DB were exactly that — false
 * positives on runs that exited 0 with the job done (2026-07-15), which then fed the auto-resume
 * monitor a queue of phantom stops to babysit.
 *
 * So: model prose, tool inputs, and tool results are NEVER evidence — only the CLI's own report is.
 * A genuine limit surfaces as a SYNTHETIC assistant message (`message.model === '<synthetic>'` with
 * `isApiErrorMessage: true`, e.g. "You've hit your session limit · resets 5:40am"), as an errored
 * terminal `result`, or on stderr. Note `<synthetic>` alone is not enough: the CLI also emits
 * `<synthetic>` no-op chatter with `isApiErrorMessage: false` ("No response requested.").
 *
 * Exported for the same reason as looksRateLimited: the transcript scanner MUST carry this gate
 * forward unchanged. It is the only thing standing between "found a real stop" and re-running the
 * 2026-07-15 false-positive fiasco across every project on the machine instead of just our own runs.
 */
export function isApiErrorEvent(ev: any): boolean {
  return ev?.isApiErrorMessage === true || ev?.message?.model === '<synthetic>'
}

// --- pub/sub for live run streaming (SSE) ------------------------------------

export type RunMessage =
  | { type: 'event'; data: RunEvent }
  | {
      type: 'status'
      data: {
        id: string
        status: QueueItem['status']
        exit_code: number | null
        pid: number | null
      }
    }

type Sub = (msg: RunMessage) => void
const subs = new Map<string, Set<Sub>>()

export function subscribeRun(id: string, cb: Sub): () => void {
  let set = subs.get(id)
  if (!set) {
    set = new Set()
    subs.set(id, set)
  }
  set.add(cb)
  return () => {
    set?.delete(cb)
    if (set && set.size === 0) subs.delete(id)
  }
}

function publish(id: string, msg: RunMessage) {
  const set = subs.get(id)
  if (!set) return
  for (const cb of set) {
    try {
      cb(msg)
    } catch {
      // a dead subscriber shouldn't break dispatch
    }
  }
}

// --- run-event persistence ---------------------------------------------------

const insertEvent = db.query(
  'insert into run_events (queue_item_id, seq, ts, role, kind, text, tool_name) values (?, ?, ?, ?, ?, ?, ?)',
)

const runtime = new Map<string, { seq: number; rateLimited: boolean }>()

function recordEvent(
  id: string,
  role: RunEvent['role'],
  kind: RunEvent['kind'],
  text: string,
  toolName: string | null,
) {
  const rt = runtime.get(id) ?? { seq: 0, rateLimited: false }
  rt.seq += 1
  runtime.set(id, rt)
  const ts = new Date().toISOString()
  let info: { lastInsertRowid: number | bigint }
  try {
    info = insertEvent.run(id, rt.seq, ts, role, kind, text, toolName)
  } catch {
    // run_events is FK'd to queue_items, so recording against a row that is already gone (the item
    // was deleted mid-run) throws. Transcribing output must never be able to kill the tail loop that
    // is trying to finalize the run — same reason publish() swallows a bad subscriber.
    return
  }
  const ev: RunEvent = {
    id: Number(info.lastInsertRowid),
    queue_item_id: id,
    seq: rt.seq,
    ts,
    role,
    kind,
    text,
    tool_name: toolName,
  }
  publish(id, { type: 'event', data: ev })
}

export function getRunEvents(id: string): RunEvent[] {
  return db
    .query<RunEvent, [string]>('select * from run_events where queue_item_id = ? order by seq asc')
    .all(id)
}

// --- argv --------------------------------------------------------------------

export function buildArgv(item: QueueItem): string[] {
  const useFake = !!process.env.CCMANAGERUI_FAKE
  // Compiled binaries can't spawn sibling .ts files (import.meta.dir is virtual inside the exe);
  // the exe re-spawns itself with the __fake_claude subcommand instead (server/src/main.ts).
  const argv: string[] = useFake
    ? IS_COMPILED
      ? [process.execPath, '__fake_claude']
      : [process.execPath, join(import.meta.dir, 'fake-claude.ts')]
    : [resolveClaudeExe()]

  if (!useFake) {
    if (item.new_chat) {
      argv.push('--session-id', item.session_id)
    } else {
      argv.push('--resume', item.session_id)
      if (item.fork) argv.push('--fork-session')
    }
    if (item.model) argv.push('--model', item.model)
    if (item.effort) argv.push('--effort', item.effort)
    if (item.permission_mode) argv.push('--permission-mode', item.permission_mode)
    argv.push('--verbose', '--output-format', 'stream-json', '--print')
  }
  argv.push(item.prompt)
  return argv
}

// --- line handling -----------------------------------------------------------

// A normal `claude` stream-json line. Runner marker lines ({"__dispatch":…}) are peeled off by the
// tail loop before this runs, so this only ever sees genuine Claude output — identical parsing to
// the pre-detach inline reader.
function handleLine(id: string, line: string) {
  if (!line) return
  let ev: any
  try {
    ev = JSON.parse(line)
  } catch {
    return
  }
  const rt = runtime.get(id)
  const t = ev.type
  if (t === 'assistant' || t === 'user') {
    // Only the CLI's own synthetic error notice counts (see isApiErrorEvent) — never model prose,
    // tool inputs, or tool results, which is what a run about rate limits is full of.
    const trusted = isApiErrorEvent(ev)
    for (const te of eventToTailEvents(ev)) {
      if (rt && trusted && looksRateLimited(te.text)) rt.rateLimited = true
      recordEvent(id, te.role, te.kind, te.text, te.tool_name)
    }
  } else if (t === 'result') {
    const text = typeof ev.result === 'string' ? ev.result : JSON.stringify(ev)
    // A `result` mirrors the model's final summary, so its text is only evidence when the CLI also
    // flagged the turn as errored — otherwise a run that ANSWERS a question about rate limits
    // (this repo's own bread and butter) reports itself rate-limited.
    if (rt && ev.is_error && looksRateLimited(text)) rt.rateLimited = true
    recordEvent(id, 'system', 'meta', text, null)
  } else if (t === 'system' && ev.subtype === 'init') {
    recordEvent(id, 'system', 'meta', `session started (${ev.model ?? 'model'})`, null)
  }
}

// --- per-run files (owned by the detached runner; the daemon reads them) ------

const DISPATCH_RUNNER = join(import.meta.dir, 'dispatch-runner.ts')

/** The argv that spawns the detached runner in either mode: a source checkout spawns
 *  `bun dispatch-runner.ts <spec>`; a compiled exe re-spawns ITSELF with the __dispatch_runner
 *  subcommand (server/src/main.ts) — the sibling .ts file doesn't exist on disk there. */
const runnerArgv = (specPath: string): string[] =>
  IS_COMPILED
    ? [process.execPath, '__dispatch_runner', specPath]
    : [process.execPath, DISPATCH_RUNNER, specPath]
const logPathFor = (id: string) => join(RUN_LOG_DIR, `${id}.stream.jsonl`)
const statusPathFor = (id: string) => join(RUN_LOG_DIR, `${id}.status.json`)
const specPathFor = (id: string) => join(RUN_LOG_DIR, `${id}.spec.json`)

interface RunStatus {
  runnerPid?: number
  childPid?: number | null
  startedAt?: string
  state?: 'running' | 'exited'
  code?: number
}

function readStatus(id: string): RunStatus | null {
  try {
    return JSON.parse(readFileSync(statusPathFor(id), 'utf8')) as RunStatus
  } catch {
    return null
  }
}

/** A runner marker line, or null for an ordinary `claude` stream-json line. */
function parseMarker(
  line: string,
): { kind: 'exit'; code: number } | { kind: 'stderr'; text: string } | null {
  if (!line.includes('__dispatch')) return null
  try {
    const o = JSON.parse(line)
    if (o && o.__dispatch === 'exit')
      return { kind: 'exit', code: typeof o.code === 'number' ? o.code : -1 }
    if (o && o.__dispatch === 'stderr') return { kind: 'stderr', text: String(o.text ?? '') }
  } catch {
    // a real claude line that merely contains the substring "__dispatch" — fall through to normal handling
  }
  return null
}

/**
 * Launch the detached runner (`bun dispatch-runner.ts <spec>`) so it OUTLIVES the daemon.
 *
 * The hard part is Windows. The Bun daemon puts every process it spawns — via Bun.spawn OR
 * node:child_process (which Bun implements on the same primitive) — into a job object, and even the
 * `cmd /c start` hand-off's grandchild stays in it (verified 2026-07-12: such runners died on a
 * daemon `process.exit()`, a `taskkill /T`, AND a graceful shutdown — only a bare `taskkill /F` of
 * the daemon spared them). The ONLY reliable escape is to have the OS create the process for us,
 * OUTSIDE the daemon's job: Win32_Process.Create (WMI). The created runner is a child of WmiPrvSE,
 * jobless, and runs as the current user with the user profile env (HOME/APPDATA/PATH — what `claude`
 * needs), which is why the runner reads everything else (child argv, cwd, DB path, account) from the
 * spec rather than the daemon's env. POSIX has no such problem: a plain `detached:true` (setsid) is a
 * genuine session detach.
 *
 * `CCMANAGERUI_RUNNER_LAUNCH` (documented in .env.example) overrides the per-OS default:
 *   'wmi'   win32 default — survives Quit (needs PowerShell + WMI).
 *   'start' escape hatch for a box where WMI/PowerShell is blocked: launch via `cmd /c start`
 *           instead. Dispatch still works, but a run will NOT survive Quit (it stays in the job).
 *           'startb' is the same via `start /b`.
 *   'posix' macOS/Linux default — plain detached setsid.
 */
function launchDetachedRunner(specPath: string): void {
  const method =
    process.env.CCMANAGERUI_RUNNER_LAUNCH || (process.platform === 'win32' ? 'wmi' : 'posix')

  if (process.platform !== 'win32' || method === 'posix') {
    const { argv } = buildDetachedSpawn(process.platform, runnerArgv(specPath))
    nodeSpawn(argv[0]!, argv.slice(1), {
      stdio: 'ignore',
      detached: true,
      windowsHide: true,
    }).unref()
    return
  }

  if (method === 'wmi') {
    // Each argv element double-quoted for CreateProcess; single-quotes escaped for the PS string.
    const cmdline = runnerArgv(specPath)
      .map((s) => `"${s}"`)
      .join(' ')
    // ProcessStartupInformation is NOT optional polish: Win32_Process.Create applies DEFAULT
    // STARTUPINFO, and `bun` is a console-subsystem exe, so the runner gets a REAL, VISIBLE console
    // window on the user's desktop for the whole run — the daemon's own `windowsHide: true` (below)
    // only hides the short-lived powershell.exe, never the WMI-created grandchild. Worse than ugly:
    // closing that stray window sends CTRL_CLOSE_EVENT to everything on its console, killing the
    // runner AND `claude` mid-turn with no exit marker (the run then finalizes as a bare "failed,
    // exit -1"). SW_HIDE (0) keeps the console allocated — the runner still redirects the child's
    // stdout/stderr to the log, so nothing needs a window — but never shows it.
    // Verified 2026-07-15 by probing GetConsoleWindow/IsWindowVisible from INSIDE a WMI-created
    // process: without this, VISIBLE; with it, hidden. (CreateFlags=CREATE_NO_WINDOW is not an
    // option here — Win32_ProcessStartup rejects that flag with ReturnValue 21, "invalid parameter".)
    const ps =
      `$s = New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ ShowWindow = [uint16]0 }; ` +
      `Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = '${cmdline.replace(/'/g, "''")}'; ProcessStartupInformation = $s } | Out-Null`
    nodeSpawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], {
      stdio: 'ignore',
      windowsHide: true,
    }).unref()
    return
  }

  // `start` / `start /b` escape hatch (CCMANAGERUI_RUNNER_LAUNCH): launches without WMI for a box
  // where it's blocked. The run works but will NOT survive Quit (a console child stays in the
  // daemon's job object) — that trade-off is documented on the setting in .env.example.
  const b = method === 'startb' ? ['/b'] : []
  nodeSpawn('cmd', ['/c', 'start', '', ...b, ...runnerArgv(specPath)], {
    stdio: 'ignore',
    windowsHide: true,
    detached: true,
  }).unref()
}

// --- dispatch ----------------------------------------------------------------

interface ActiveEntry {
  sessionId: string
  canceled: boolean
  childPid: number | null
  killed: boolean
}

const active = new Map<string, ActiveEntry>()

export function activeCount(): number {
  return active.size
}

export function isActive(id: string): boolean {
  return active.has(id)
}

/** True if any running item targets this session — two concurrent `--resume <id>`
 *  children would interleave writes to the same transcript. */
export function isSessionActive(sessionId: string): boolean {
  for (const entry of active.values()) if (entry.sessionId === sessionId) return true
  return false
}

/** Liveness probe (signal 0 never actually signals — Node/Bun convention on every OS). */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** Kill `claude` (childPid) and its descendants. The runner is `claude`'s PARENT, not a descendant,
 *  so it survives this and still writes the terminal marker — which is how a cancel becomes final. */
async function killTree(pid: number): Promise<void> {
  if (process.platform === 'win32') {
    try {
      await Bun.spawn(['taskkill', '/pid', String(pid), '/t', '/f'], {
        stdout: 'ignore',
        stderr: 'ignore',
      }).exited
    } catch {
      // already gone
    }
    return
  }
  try {
    process.kill(pid, 'SIGKILL')
  } catch {
    // already gone
  }
}

/**
 * True if the detached runner for `id` is still alive — identified by its UNIQUE spec-file name in a
 * live process's command line, NOT by a stored PID. This is what makes reattach PID-reuse-safe: after
 * a long daemon downtime the stored childPid may have been recycled by an unrelated process, so
 * `isAlive(childPid)` would lie; matching the runner's own `<id>.spec.json` argument cannot. Also
 * catches a runner that was still launching when the previous daemon died (its cmdline already carries
 * the spec), so a live run is never wrongly finalized as failed. Never throws.
 */
async function isRunnerAlive(id: string): Promise<boolean> {
  // Item ids are uuids/simple slugs (no WQL/regex metacharacters), so the needle needs no escaping.
  const needle = `${id}.spec.json`
  try {
    if (process.platform === 'win32') {
      const proc = Bun.spawn(
        [
          'powershell',
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `@(Get-CimInstance Win32_Process -Filter "CommandLine LIKE '%${needle}%'").Count`,
        ],
        { stdout: 'pipe', stderr: 'ignore' },
      )
      const [out] = await Promise.all([new Response(proc.stdout).text(), proc.exited])
      return Number(out.trim()) > 0
    }
    const proc = Bun.spawn(['ps', '-eo', 'args='], { stdout: 'pipe', stderr: 'ignore' })
    const [out] = await Promise.all([new Response(proc.stdout).text(), proc.exited])
    return out.split('\n').some((line) => line.includes(needle))
  } catch {
    return false
  }
}

function cleanupRunFiles(id: string): void {
  try {
    rmSync(specPathFor(id), { force: true })
  } catch {
    /* best-effort */
  }
  try {
    rmSync(statusPathFor(id), { force: true })
  } catch {
    /* best-effort */
  }
  // The log file ({id}.stream.jsonl) is kept — it's the raw record, same as before.
}

/** Persist the terminal status + notify subscribers, exactly once per run. A cancel wins over the
 *  process's own exit code so a killed run reads as 'canceled', not 'failed'. */
function finalize(id: string, exitCode: number, opts: { canceled?: boolean } = {}): void {
  if (!active.has(id)) return // already finalized (defensive)
  const rt = runtime.get(id)
  const status: QueueItem['status'] = opts.canceled
    ? 'canceled'
    : rt?.rateLimited
      ? 'rate_limited'
      : exitCode === 0
        ? 'completed'
        : 'failed'
  db.query(
    'update queue_items set status = ?, finished_at = ?, exit_code = ?, pid = null where id = ?',
  ).run(status, new Date().toISOString(), exitCode, id)
  publish(id, { type: 'status', data: { id, status, exit_code: exitCode, pid: null } })
  runtime.delete(id)
  active.delete(id)
  cleanupRunFiles(id)
}

/**
 * Tail the run's log until the terminal marker (then finalize), the child dies without one (fail),
 * or the run is canceled. Handles BOTH a fresh run (childPid learned from the status file once the
 * runner writes it) and a reattach (childPid already known). Reading from a byte offset with a
 * persistent UTF-8 decoder means a run that produces megabytes of output isn't re-read each poll and
 * multibyte chars never split across reads.
 */
async function tailRun(id: string, entry: ActiveEntry): Promise<void> {
  const logPath = logPathFor(id)
  const decoder = new TextDecoder()
  let offset = 0
  let buf = ''
  let sawStatus = entry.childPid !== null // reattach already read the status file
  let deadFor = 0
  const POLL_MS = 250
  const START_GRACE_MS = 20_000 // status file must appear within this, else the runner never launched
  // After `claude` (childPid) goes non-alive, wait this long for the runner's trailing flush + exit
  // marker to land before giving up. Generous because the runner drains stdout/stderr AFTER the child
  // exits, then writes the marker; a large final chunk + slow disk (AV scan) can stretch that out.
  const DEAD_GRACE_MS = 4000
  const startedWaiting = Date.now()

  for (;;) {
    // 1. Learn the child pid from the runner's status file (fresh runs only, once).
    if (entry.childPid === null) {
      const st = readStatus(id)
      if (st) {
        sawStatus = true
        if (typeof st.childPid === 'number') {
          entry.childPid = st.childPid
          db.query('update queue_items set pid = ? where id = ?').run(st.childPid, id)
          publish(id, {
            type: 'status',
            data: { id, status: 'running', exit_code: null, pid: st.childPid },
          })
        }
      }
    }

    // 2. Read + process any new log bytes.
    let size = 0
    try {
      size = statSync(logPath).size
    } catch {
      size = 0 // not created yet
    }
    // Defensive: the log is append-only in this design, but if it ever shrank (truncated/replaced)
    // our byte offset would run past EOF and we'd read nothing forever — resync to the new size.
    if (size < offset) offset = size
    if (size > offset) {
      let fd: number | null = null
      try {
        fd = openSync(logPath, 'r')
        const len = size - offset
        const b = Buffer.allocUnsafe(len)
        const read = readSync(fd, b, 0, len, offset)
        offset += read
        buf += decoder.decode(b.subarray(0, read), { stream: true })
      } catch {
        // transient read error; try again next poll
      } finally {
        if (fd !== null) closeSync(fd)
      }
      let idx = buf.indexOf('\n')
      while (idx >= 0) {
        const line = buf.slice(0, idx).trim()
        buf = buf.slice(idx + 1)
        if (line) {
          const marker = parseMarker(line)
          if (marker?.kind === 'exit') {
            finalize(id, marker.code, { canceled: entry.canceled })
            return
          }
          if (marker?.kind === 'stderr') {
            const rt = runtime.get(id)
            if (rt && looksRateLimited(marker.text)) rt.rateLimited = true
            recordEvent(id, 'system', 'meta', `stderr: ${marker.text.slice(0, 2000)}`, null)
          } else {
            handleLine(id, line)
          }
        }
        idx = buf.indexOf('\n')
      }
    }

    // 3. Cancel: kill the child once we know its pid; the runner then writes the exit marker.
    if (entry.canceled && entry.childPid && !entry.killed) {
      entry.killed = true
      await killTree(entry.childPid)
    }

    // 4. Child gone without a terminal marker (runner crashed) → fail after a short grace so a
    //    marker already in flight still wins.
    if (entry.childPid !== null && !isAlive(entry.childPid)) {
      deadFor += POLL_MS
      if (deadFor > DEAD_GRACE_MS) {
        // Say WHY. exit -1 is our own synthetic code for "we lost the process", not something
        // `claude` reported, and without this line the run reads as a bare red "failed, exit -1"
        // with no hint that the work up to this point actually happened and landed on disk.
        if (!entry.canceled)
          recordEvent(
            id,
            'system',
            'meta',
            'run interrupted: the claude process exited without finishing this turn (killed, or CC Manager UI restarted under it). Work it had already completed is on disk — open the session to see how far it got.',
            null,
          )
        finalize(id, -1, { canceled: entry.canceled })
        return
      }
    } else {
      deadFor = 0
    }

    // 5. Runner never launched (no status file, no output) → fail.
    if (!sawStatus && Date.now() - startedWaiting > START_GRACE_MS) {
      recordEvent(
        id,
        'system',
        'meta',
        'run did not start (dispatch runner failed to launch)',
        null,
      )
      finalize(id, -1, { canceled: entry.canceled })
      return
    }

    await Bun.sleep(POLL_MS)
  }
}

/** Fail a queue item BEFORE it's ever registered in `active` (finalize() no-ops until active.set,
 *  so the terminal state has to be written directly here — same fields finalize() sets). Used for
 *  every pre-launch instance-pinning failure: a pinned run must NEVER silently fall back to Ambient
 *  credentials, so an instance_ref that doesn't resolve to a real, live instance fails loudly here
 *  instead of reaching the runner with desktopDir/cliConfigDir both null. */
function failPreLaunch(item: QueueItem, message: string): void {
  recordEvent(item.id, 'system', 'meta', message, null)
  db.query(
    'update queue_items set status = ?, finished_at = ?, exit_code = ?, pid = null where id = ?',
  ).run('failed', new Date().toISOString(), -1, item.id)
  publish(item.id, {
    type: 'status',
    data: { id: item.id, status: 'failed', exit_code: -1, pid: null },
  })
  runtime.delete(item.id)
}

/** Spawn one queue item. Resolves when the run finalizes (or immediately if its session is busy).
 *  Registers the run in `active` SYNCHRONOUSLY before the first await, so callers (run-due,
 *  scheduler) that check isActive/isSessionActive right after see it as running. */
export async function dispatchItem(item: QueueItem): Promise<void> {
  // authoritative session lock (callers pre-check for a friendly error; this closes the race):
  // two concurrent --resume of the same session would interleave transcript writes.
  if (isSessionActive(item.session_id)) return

  // fresh run: clear prior events + any stale files from an earlier run of this item.
  db.query('delete from run_events where queue_item_id = ?').run(item.id)
  runtime.set(item.id, { seq: 0, rateLimited: false })
  try {
    rmSync(logPathFor(item.id), { force: true })
  } catch {
    /* best-effort */
  }
  try {
    rmSync(statusPathFor(item.id), { force: true })
  } catch {
    /* best-effort */
  }

  // Instance-derived run identity (instance_ref = 'desktop:<dir>' | 'cli:<id>'): the spec carries
  // only PATHS — the runner extracts the instance's OAuth token value-blind at spawn time
  // (core/accounts.ts), so no credential ever touches the spec file, same discipline as accountId.
  // The cli id → configDir lookup happens HERE because the store read is daemon state; the dir is
  // not a secret.
  let desktopDir: string | null = null
  let cliConfigDir: string | null = null
  if (item.instance_ref?.startsWith('desktop:')) {
    desktopDir = item.instance_ref.slice('desktop:'.length) || null
    // Existence check (parallel to the 'cli:' branch's getCliInstance lookup below): a deleted
    // desktop instance's dir must fail HERE, pre-launch, not reach the runner. An isolated desktop
    // instance dir is a real folder on disk (Electron's --user-data-dir), so existsSync is sound.
    if (desktopDir && !existsSync(desktopDir)) {
      failPreLaunch(
        item,
        `run-as desktop instance not found (${desktopDir}) — it may have been deleted`,
      )
      return
    }
  } else if (item.instance_ref?.startsWith('cli:')) {
    cliConfigDir = getCliInstance(item.instance_ref.slice('cli:'.length))?.configDir ?? null
    if (!cliConfigDir) {
      failPreLaunch(
        item,
        `run-as CLI instance not found (${item.instance_ref}) — it may have been deleted`,
      )
      return
    }
  }
  // A non-null instance_ref that resolved to NEITHER a desktopDir NOR a cliConfigDir is malformed
  // (an empty suffix like 'desktop:'/'cli:', an unrecognized prefix like 'garbage:foo', or a bare
  // 'desktop' with no colon) — it must fail loudly here, not fall through and silently dispatch as
  // Ambient. This is the other half of the pinning guarantee: a pinned run never runs unpinned.
  if (item.instance_ref && !desktopDir && !cliConfigDir) {
    failPreLaunch(
      item,
      `run-as instance reference is malformed (${item.instance_ref}) — expected 'desktop:<dir>' or 'cli:<id>'`,
    )
    return
  }

  const spec = {
    itemId: item.id,
    childArgv: buildArgv(item),
    cwd: item.cwd,
    accountId: item.account_id ?? null,
    desktopDir,
    cliConfigDir,
    dbPath: DB_PATH,
    envExtra: {
      ...(process.env.CCMANAGERUI_FAKE ? { FAKE_SESSION_ID: item.session_id } : {}),
      // FAKE_SLEEP_MS is a test-only knob; forward it so a fake run launched via WMI (which does
      // NOT inherit the daemon's env) can still be slowed down for the survive/reattach tests.
      ...(process.env.FAKE_SLEEP_MS ? { FAKE_SLEEP_MS: process.env.FAKE_SLEEP_MS } : {}),
    },
    logPath: logPathFor(item.id),
    statusPath: statusPathFor(item.id),
  }
  writeFileSync(specPathFor(item.id), JSON.stringify(spec))

  const entry: ActiveEntry = {
    sessionId: item.session_id,
    canceled: false,
    childPid: null,
    killed: false,
  }
  active.set(item.id, entry) // SYNC: before the first await

  db.query(
    'update queue_items set status = ?, pid = null, started_at = ?, finished_at = null, exit_code = null where id = ?',
  ).run('running', new Date().toISOString(), item.id)
  publish(item.id, {
    type: 'status',
    data: { id: item.id, status: 'running', exit_code: null, pid: null },
  })

  // Launch the DETACHED runner so it survives the daemon exiting / being tree-killed.
  try {
    launchDetachedRunner(specPathFor(item.id))
  } catch (err) {
    recordEvent(item.id, 'system', 'meta', `failed to launch runner: ${String(err)}`, null)
    finalize(item.id, -1)
    return
  }

  await tailRun(item.id, entry)
}

/** Cancel a running item: kill `claude` (the runner then writes the terminal marker, so the tail
 *  finalizes it as 'canceled'), and reflect it immediately in the DB/UI. */
export function cancelItem(id: string): boolean {
  const entry = active.get(id)
  if (!entry) {
    // No live tail (e.g. a stale 'running' row we couldn't reattach): best-effort mark canceled.
    const row = db
      .query<{ status: string }, [string]>('select status from queue_items where id = ?')
      .get(id)
    if (row && row.status === 'running') {
      db.query('update queue_items set status = ?, finished_at = ?, pid = null where id = ?').run(
        'canceled',
        new Date().toISOString(),
        id,
      )
      publish(id, { type: 'status', data: { id, status: 'canceled', exit_code: null, pid: null } })
      return true
    }
    return false
  }
  entry.canceled = true
  if (entry.childPid && !entry.killed) {
    entry.killed = true
    void killTree(entry.childPid)
  }
  // Immediate feedback; the tail loop writes the authoritative final row when the marker lands.
  db.query('update queue_items set status = ? where id = ?').run('canceled', id)
  publish(id, {
    type: 'status',
    data: { id, status: 'canceled', exit_code: null, pid: entry.childPid },
  })
  return true
}

/**
 * Recover dispatch runs that were in flight when the previous daemon exited (Quit / auto-update /
 * crash). For each `running` queue_item: rebuild its run_events from the on-disk log (the log is the
 * source of truth), then resume tailing. tailRun then either sees the terminal marker (the run
 * finished while we were down → finalize) or keeps tailing a still-live run to completion. A run
 * whose process is gone with no marker is finalized as failed. Call once at boot, after db.ts is
 * ready. Idempotent: it only touches rows still marked 'running'.
 */
export async function reattachRuns(): Promise<void> {
  const rows = db.query<QueueItem, []>("select * from queue_items where status = 'running'").all()
  for (const row of rows) {
    const id = row.id
    // Rebuild events from whatever the runner has written so far (delete-then-replay = idempotent).
    db.query('delete from run_events where queue_item_id = ?').run(id)
    runtime.set(id, { seq: 0, rateLimited: false })

    const st = readStatus(id)
    const hasLog = existsSync(logPathFor(id))
    // Identity check (not raw PID liveness): is OUR runner still alive? This is PID-reuse-safe and
    // also true for a runner that was still launching when the previous daemon died.
    const runnerAlive = await isRunnerAlive(id)
    // Trust the stored childPid ONLY while the runner is verifiably alive — else a recycled PID could
    // be mistaken for our child (stuck run, or a cancel force-killing an innocent process).
    const childPid = runnerAlive && typeof st?.childPid === 'number' ? st.childPid : null

    const entry: ActiveEntry = {
      sessionId: row.session_id,
      canceled: false,
      childPid,
      killed: false,
    }
    active.set(id, entry)

    if (!runnerAlive && !hasLog) {
      // The runner is gone and left nothing to replay: unrecoverable, mark failed.
      recordEvent(
        id,
        'system',
        'meta',
        'run lost: CC Manager UI restarted and this run left no output to recover from.',
        null,
      )
      finalize(id, -1)
      continue
    }
    // runnerAlive → resume tailing a live run; else the log exists → tailRun replays it and either
    // finalizes from its terminal marker (finished while we were down) or, seeing the runner gone with
    // no marker, fails after its grace. childPid is null unless the runner is verified alive.
    if (childPid) db.query('update queue_items set pid = ? where id = ?').run(childPid, id)
    void tailRun(id, entry)
  }
}
