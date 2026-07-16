// Integration tests for the detached-dispatch pipeline (server/src/dispatch.ts + dispatch-runner.ts).
// These drive the REAL flow with the fake `claude` stand-in (CCMANAGERUI_FAKE): dispatchItem writes
// a spec, launches the detached runner (WMI on win32 / setsid on POSIX), which runs the fake CLI and
// appends its stream-json to a per-run log; the daemon tails that log, records run_events, and
// finalizes the DB row. Locks in complete / cancel / reattach, plus the property the whole detached
// design exists for: the runner does NOT hang off the daemon, so quitting the app cannot take a run
// with it (see 'the runner escapes...' below).
import { expect, test } from 'bun:test'
import { existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { db } from '../src/db'
import * as dispatch from '../src/dispatch'

// CCMANAGERUI_DB / CCMANAGERUI_HOME / CCMANAGERUI_RUN_LOG_DIR are isolated by the preload
// (tests/setup.ts); CCMANAGERUI_FAKE is read at dispatch-CALL time, so setting it here (before any
// dispatchItem call) makes buildArgv use the harmless fake `claude` stand-in.
process.env.CCMANAGERUI_FAKE = '1'
const RUN_LOG_DIR = process.env.CCMANAGERUI_RUN_LOG_DIR as string
const dir = tmpdir() // a real cwd for the fake run; nothing is written to it

let counter = 0
function makeItem(overrides: Record<string, unknown> = {}) {
  const id = `it-${++counter}`
  const sessionId = `sess-${counter}`
  db.query(
    `insert into queue_items (id, session_id, title, cwd, prompt, new_chat, fork, status, position, created_at)
     values (?, ?, 'test', ?, 'hello', 1, 0, 'queued', 0, ?)`,
  ).run(id, sessionId, dir, Date.now())
  return {
    id,
    session_id: sessionId,
    title: 'test',
    cwd: dir,
    prompt: 'hello',
    model: null,
    effort: null,
    permission_mode: null,
    account_id: null,
    new_chat: true,
    fork: false,
    status: 'queued',
    pid: null,
    position: 0,
    not_before: null,
    started_at: null,
    finished_at: null,
    exit_code: null,
    created_at: Date.now(),
    ...overrides,
  } as any
}

const statusOf = (id: string) =>
  db
    .query<{ status: string; exit_code: number | null }, [string]>(
      'select status, exit_code from queue_items where id = ?',
    )
    .get(id)

async function waitForStatus(id: string, want: string, timeoutMs = 15000): Promise<string> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const s = statusOf(id)?.status ?? 'missing'
    if (s === want || Date.now() > deadline) return s
    await Bun.sleep(150)
  }
}

test('dispatchItem: a fake run completes, records events, and cleans up its spec/status files', async () => {
  delete process.env.FAKE_SLEEP_MS
  const item = makeItem()
  await dispatch.dispatchItem(item) // resolves when the run finalizes

  const row = statusOf(item.id)
  expect(row?.status).toBe('completed')
  expect(row?.exit_code).toBe(0)

  const events = dispatch.getRunEvents(item.id)
  expect(events.length).toBeGreaterThan(0)
  expect(events.some((e) => e.kind === 'text')).toBe(true) // the fake's assistant text line

  // the runner's spec + status sidecars are removed on finalize; the raw log is kept
  expect(existsSync(join(RUN_LOG_DIR, `${item.id}.spec.json`))).toBe(false)
  expect(existsSync(join(RUN_LOG_DIR, `${item.id}.status.json`))).toBe(false)
  expect(existsSync(join(RUN_LOG_DIR, `${item.id}.stream.jsonl`))).toBe(true)
  expect(dispatch.isActive(item.id)).toBe(false)
})

// Instance-pinning must never silently degrade to Ambient credentials: a queue item's instance_ref
// that doesn't resolve to a real, live instance has to fail loudly BEFORE the runner ever launches
// (dispatch.ts never registers the item in `active`, so isActive must read false throughout).
test('dispatchItem: an unrecognized instance_ref prefix fails loudly instead of falling back to Ambient', async () => {
  const item = makeItem({ instance_ref: 'garbage:foo' })
  await dispatch.dispatchItem(item)

  const row = statusOf(item.id)
  expect(row?.status).toBe('failed')
  expect(row?.exit_code).toBe(-1)
  expect(dispatch.isActive(item.id)).toBe(false)

  const events = dispatch.getRunEvents(item.id)
  expect(events.some((e) => e.text.includes('malformed'))).toBe(true)
})

test('dispatchItem: "desktop:" with an empty suffix fails loudly instead of falling back to Ambient', async () => {
  const item = makeItem({ instance_ref: 'desktop:' })
  await dispatch.dispatchItem(item)

  const row = statusOf(item.id)
  expect(row?.status).toBe('failed')
  expect(row?.exit_code).toBe(-1)

  const events = dispatch.getRunEvents(item.id)
  expect(events.some((e) => e.text.includes('malformed'))).toBe(true)
})

test('dispatchItem: "cli:" with an empty suffix fails loudly instead of falling back to Ambient', async () => {
  const item = makeItem({ instance_ref: 'cli:' })
  await dispatch.dispatchItem(item)

  const row = statusOf(item.id)
  expect(row?.status).toBe('failed')
  expect(row?.exit_code).toBe(-1)

  const events = dispatch.getRunEvents(item.id)
  expect(events.some((e) => e.text.includes('CLI instance not found'))).toBe(true)
})

test('dispatchItem: a "desktop:" ref pointing at a deleted/nonexistent dir fails loudly', async () => {
  const missingDir = join(tmpdir(), `ccmanagerui-missing-desktop-${counter}-${Date.now()}`)
  const item = makeItem({ instance_ref: `desktop:${missingDir}` })
  await dispatch.dispatchItem(item)

  const row = statusOf(item.id)
  expect(row?.status).toBe('failed')
  expect(row?.exit_code).toBe(-1)

  const events = dispatch.getRunEvents(item.id)
  expect(events.some((e) => e.text.includes('desktop instance not found'))).toBe(true)
})

// THE guard for the promise the whole detached design exists to keep: "close CC Manager UI and your
// runs carry on". It exists because that promise was previously only "verified manually", and
// nothing stopped it regressing.
//
// What must hold is JOB-OBJECT escape, not merely tree escape. Bun puts everything it spawns into a
// job object that kills its members when the daemon dies, and the `cmd /c start` hand-off's
// grandchild STAYS in that job (verified 2026-07-12). Only Win32_Process.Create (WMI) truly escapes:
// the OS builds the process for us, outside our job, parented to the WMI provider host.
//
// So this asserts the parent is WmiPrvSE *specifically*. "Parent isn't the daemon" would be too weak
// to be worth writing: under CCMANAGERUI_RUNNER_LAUNCH='start' the runner's parent is a cmd.exe that
// has already exited, which also isn't the daemon — that check passes for the very method documented
// NOT to survive. Naming the expected parent is what gives this teeth (confirmed: it goes red under
// 'startb', where the parent is cmd.exe).
test.if(process.platform === 'win32')(
  'the runner is created by WMI, outside the daemon job — so quitting the app cannot kill a run',
  async () => {
    process.env.FAKE_SLEEP_MS = '1200' // keep the runner alive long enough to inspect it
    const item = makeItem()
    const p = dispatch.dispatchItem(item)
    for (let i = 0; i < 60 && !dispatch.isActive(item.id); i++) await Bun.sleep(50)

    // Find OUR runner by its unique spec-file argument (the same identity trick isRunnerAlive uses).
    // `AND Name <> 'powershell.exe'` matters: the launcher's OWN command line embeds the spec path
    // (it is the argument to Win32_Process.Create), so an unqualified match also returns the
    // transient PowerShell — which IS a child of the daemon and would make this assert the opposite
    // of what it means to.
    let parent = ''
    for (let i = 0; i < 40 && !parent; i++) {
      const proc = Bun.spawn(
        [
          'powershell',
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `$r = Get-CimInstance Win32_Process -Filter "CommandLine LIKE '%${item.id}.spec.json%' AND Name <> 'powershell.exe'" | Select-Object -First 1;` +
            ` if ($r) { (Get-CimInstance Win32_Process -Filter "ProcessId=$($r.ParentProcessId)").Name }`,
        ],
        { stdout: 'pipe', stderr: 'ignore' },
      )
      const [out] = await Promise.all([new Response(proc.stdout).text(), proc.exited])
      const name = out.trim()
      if (name) parent = name
      else await Bun.sleep(100)
    }

    // WmiPrvSE.exe as the parent IS the escape: it means the OS created the runner on our behalf,
    // so it is in neither this process's tree nor its job object.
    expect(parent.toLowerCase()).toBe('wmiprvse.exe')

    await p
    delete process.env.FAKE_SLEEP_MS
  },
  30000,
)

test('cancelItem: a running fake dispatch is killed and finalized as canceled', async () => {
  process.env.FAKE_SLEEP_MS = '1500' // slow enough to cancel mid-run
  const item = makeItem()
  const p = dispatch.dispatchItem(item)
  // wait until it's actually running (runner launched, registered active)
  for (let i = 0; i < 40 && !dispatch.isActive(item.id); i++) await Bun.sleep(50)
  await Bun.sleep(600)
  expect(dispatch.cancelItem(item.id)).toBe(true)
  await p
  expect(statusOf(item.id)?.status).toBe('canceled')
  delete process.env.FAKE_SLEEP_MS
})

test('reattachRuns: a run that finished while the daemon was down is recovered from its log', async () => {
  // Simulate the "daemon died mid-run, run finished on its own" state: a queue_items row still
  // marked 'running', an on-disk log ending in the runner's terminal marker, and a status sidecar.
  const item = makeItem({ status: 'running' })
  db.query('update queue_items set status = ? where id = ?').run('running', item.id)
  const log = join(RUN_LOG_DIR, `${item.id}.stream.jsonl`)
  writeFileSync(
    log,
    `${[
      JSON.stringify({ type: 'system', subtype: 'init', model: 'claude-fake' }),
      JSON.stringify({
        type: 'assistant',
        message: { role: 'assistant', content: [{ type: 'text', text: 'recovered work' }] },
      }),
      JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'done' }),
      JSON.stringify({ __dispatch: 'exit', code: 0, at: new Date().toISOString() }),
    ].join('\n')}\n`,
  )
  writeFileSync(
    join(RUN_LOG_DIR, `${item.id}.status.json`),
    JSON.stringify({ runnerPid: 1, childPid: null, state: 'exited', code: 0 }),
  )

  dispatch.reattachRuns() // rebuilds events from the log, then finalizes from the terminal marker
  const final = await waitForStatus(item.id, 'completed')
  expect(final).toBe('completed')

  const events = dispatch.getRunEvents(item.id)
  expect(events.some((e) => e.text.includes('recovered work'))).toBe(true) // events rebuilt from the log
})
