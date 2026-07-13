// A harmless stand-in for the real `claude` CLI, used when CCMANAGERUI_FAKE=1.
// Emits a few stream-json lines shaped like Claude Code's real output, then exits 0.
// Lets us verify the entire dispatch → parse → run_events → SSE → status pipeline
// WITHOUT spending any real Claude quota or touching a real repo.

const prompt = process.argv[2] ?? '(no prompt)'
const sessionId = process.env.FAKE_SESSION_ID ?? '00000000-0000-0000-0000-000000000000'
// Inter-emit delay; a test can raise it (FAKE_SLEEP_MS) to keep a fake run in flight long enough to
// exercise the daemon dying + reattaching mid-run.
const SLEEP = Number(process.env.FAKE_SLEEP_MS ?? 120)

function emit(obj: unknown) {
  process.stdout.write(`${JSON.stringify(obj)}\n`)
}

emit({ type: 'system', subtype: 'init', session_id: sessionId, model: 'claude-fake' })
await Bun.sleep(SLEEP)
emit({
  type: 'assistant',
  message: {
    role: 'assistant',
    content: [
      { type: 'thinking', thinking: 'this should never be shown', signature: 'x' },
      { type: 'text', text: `Fake run received prompt: ${prompt}` },
    ],
  },
})
await Bun.sleep(SLEEP)
emit({
  type: 'assistant',
  message: {
    role: 'assistant',
    content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'echo hello' } }],
  },
})
await Bun.sleep(SLEEP)
emit({
  type: 'result',
  subtype: 'success',
  is_error: false,
  result: 'Fake run complete. All good.',
})
process.exit(0)
