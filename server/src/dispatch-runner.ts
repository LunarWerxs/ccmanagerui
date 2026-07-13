// server/src/dispatch-runner.ts — the DETACHED per-run supervisor for a dispatched `claude` CLI run.
//
// WHY this process exists: a dispatch run must OUTLIVE the daemon (quitting CC Manager UI, or an
// auto-update relaunch, tree-kills the daemon — see server-lib/detached-spawn.mjs). If the daemon
// spawned `claude` directly it would (a) be a daemon descendant reaped by `taskkill /T`, and (b) hold
// `claude`'s stdout pipe, which breaks the instant the daemon dies. So dispatch.ts instead spawns
// THIS runner detached (`buildDetachedSpawn`), and the runner owns `claude`: it re-parents `claude`
// as ITS child (not the daemon's), captures `claude`'s stdout/stderr, and appends them to a per-run
// log file that the daemon TAILS. When the daemon dies, the runner + `claude` keep running to
// completion, still writing the log; the next daemon reattaches by re-reading the log + a terminal
// marker (see dispatch.ts reattachRuns). Verified end-to-end 2026-07-12.
//
// Run as: `bun dispatch-runner.ts <specPath>`  (spec written by dispatch.ts, JSON).
//
// The log is an append-only stream: `claude`'s raw stdout lines (stream-json) verbatim, plus two
// kinds of runner marker lines the daemon recognizes:
//   {"__dispatch":"stderr","text":"…"}   the aggregated child stderr (rate-limit sniffing + a meta event)
//   {"__dispatch":"exit","code":N}       the child has exited; the daemon finalizes status from N
// The secret for the run's account is read from the DB HERE (by account_id in the spec), so it is
// NEVER written to the spec file on disk.

import { Database } from 'bun:sqlite'
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'

// The runner is launched DETACHED via WMI (Win32_Process.Create — see dispatch.ts) so it escapes the
// Bun daemon's job object; that also means it does NOT inherit the daemon's process env. So it is
// fully self-contained: everything it needs (child argv, cwd, account, and the DB PATH to read the
// account secret from) comes from the spec file, never from env. Its own process.env is the user's
// profile env (HOME/APPDATA/PATH), which is what `claude` needs to find its config + auth.
interface RunSpec {
  itemId: string
  /** Full child command line: [claudeExe, ...flags, prompt]. Contains no secret. */
  childArgv: string[]
  cwd: string
  /** Account whose credential to inject (secret read from the DB here, not carried in the spec). */
  accountId: string | null
  /** Absolute path to the sqlite DB, so the runner can read the account secret without the daemon's env. */
  dbPath: string
  /** Non-secret env overrides (e.g. FAKE_SESSION_ID / FAKE_SLEEP_MS for the test stand-in). */
  envExtra: Record<string, string>
  logPath: string
  statusPath: string
}

/** Append one line (adds the trailing newline). Synchronous so ordering + durability hold even if
 *  the runner is killed mid-run — the daemon reads whatever reached disk. */
function logLine(logPath: string, text: string): void {
  try {
    appendFileSync(logPath, `${text}\n`)
  } catch {
    // best-effort: a transient FS error on one line must not abort the whole run
  }
}

function writeStatus(spec: RunSpec, extra: Record<string, unknown>): void {
  try {
    writeFileSync(spec.statusPath, JSON.stringify({ runnerPid: process.pid, ...extra }))
  } catch {
    // best-effort
  }
}

/** Build the child env: the runner's inherited env (the daemon's env at spawn), the non-secret
 *  overrides, then the account credential looked up from the DB. Mirrors dispatch.ts buildEnv so a
 *  run behaves identically whether launched fresh or (historically) inline. */
function buildChildEnv(spec: RunSpec): Record<string, string> {
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    ...spec.envExtra,
  }
  if (spec.accountId) {
    let acct: { auth_type: string; secret: string } | null = null
    try {
      const rdb = new Database(spec.dbPath, { readonly: true })
      acct = rdb
        .query<{ auth_type: string; secret: string }, [string]>(
          'select auth_type, secret from accounts where id = ?',
        )
        .get(spec.accountId)
      rdb.close()
    } catch {
      acct = null // DB unreadable — run without the account credential rather than abort
    }
    if (acct) {
      delete env.ANTHROPIC_API_KEY
      delete env.ANTHROPIC_AUTH_TOKEN
      delete env.CLAUDE_CODE_OAUTH_TOKEN
      if (acct.auth_type === 'api_key') env.ANTHROPIC_API_KEY = acct.secret
      else env.CLAUDE_CODE_OAUTH_TOKEN = acct.secret
    }
  }
  return env
}

async function main(): Promise<void> {
  const specPath = process.argv[2]
  if (!specPath) process.exit(2)
  const spec: RunSpec = JSON.parse(readFileSync(specPath, 'utf8'))
  const startedAt = new Date().toISOString()

  let proc: Bun.Subprocess<'ignore', 'pipe', 'pipe'>
  try {
    proc = Bun.spawn(spec.childArgv, {
      cwd: spec.cwd,
      env: buildChildEnv(spec),
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
    }) as Bun.Subprocess<'ignore', 'pipe', 'pipe'>
  } catch (err) {
    // Never even launched: leave a terminal marker so the daemon finalizes as failed.
    logLine(
      spec.logPath,
      JSON.stringify({ __dispatch: 'stderr', text: `spawn failed: ${String(err)}` }),
    )
    logLine(
      spec.logPath,
      JSON.stringify({ __dispatch: 'exit', code: -1, at: new Date().toISOString() }),
    )
    writeStatus(spec, { childPid: null, startedAt, state: 'exited', code: -1 })
    process.exit(0)
  }

  writeStatus(spec, { childPid: proc.pid ?? null, startedAt, state: 'running' })

  const pumpStdout = (async () => {
    const decoder = new TextDecoder()
    let buf = ''
    for await (const chunk of proc.stdout as ReadableStream<Uint8Array>) {
      buf += decoder.decode(chunk, { stream: true })
      let idx = buf.indexOf('\n')
      while (idx >= 0) {
        // append the child's stream-json line verbatim (the daemon parses it exactly as before)
        logLine(spec.logPath, buf.slice(0, idx))
        buf = buf.slice(idx + 1)
        idx = buf.indexOf('\n')
      }
    }
    if (buf.trim()) logLine(spec.logPath, buf.trim())
  })()

  const pumpStderr = (async () => {
    const decoder = new TextDecoder()
    let buf = ''
    for await (const chunk of proc.stderr as ReadableStream<Uint8Array>) {
      buf += decoder.decode(chunk, { stream: true })
    }
    const errText = buf.trim()
    if (errText)
      logLine(spec.logPath, JSON.stringify({ __dispatch: 'stderr', text: errText.slice(0, 4000) }))
  })()

  const exitCode = await proc.exited
  await Promise.allSettled([pumpStdout, pumpStderr])
  // terminal marker LAST, after all stdout/stderr reached the log, so a tailing daemon never
  // finalizes before it has seen the full output.
  logLine(
    spec.logPath,
    JSON.stringify({ __dispatch: 'exit', code: exitCode, at: new Date().toISOString() }),
  )
  writeStatus(spec, { childPid: proc.pid ?? null, startedAt, state: 'exited', code: exitCode })
  process.exit(0)
}

main().catch((err) => {
  try {
    const specPath = process.argv[2]
    if (specPath) {
      const spec: RunSpec = JSON.parse(readFileSync(specPath, 'utf8'))
      logLine(
        spec.logPath,
        JSON.stringify({ __dispatch: 'stderr', text: `runner error: ${String(err)}` }),
      )
      logLine(
        spec.logPath,
        JSON.stringify({ __dispatch: 'exit', code: -1, at: new Date().toISOString() }),
      )
      writeStatus(spec, {
        childPid: null,
        startedAt: new Date().toISOString(),
        state: 'exited',
        code: -1,
      })
    }
  } catch {
    // nothing more we can do
  }
  process.exit(0)
})
