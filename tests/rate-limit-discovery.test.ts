// tests/rate-limit-discovery.test.ts — the transcript-tail classifier (rate-limit-discovery.ts).
//
// This is the judgment that decides whether the monitor goes and re-prompts a session the user
// started themselves, so both directions are load-bearing:
//   · a MISS is the bug this feature exists to kill (real stops sat waiting while the resume list
//     said "nothing to resume" — measured 2026-07-16: 2 pending stops, 0 shown);
//   · a FALSE POSITIVE is the 2026-07-15 fiasco at machine scale (the old detector matched its
//     patterns against every event, so a run that merely READ the word "quota" was marked stopped).
// The fixtures below are shaped like the CLI's real output — see dispatch.ts's isApiErrorEvent and
// transcript.ts's isCliBookkeeping for why each field matters.

import { expect, test } from 'bun:test'
import { classifyRateLimitTail } from '../server/src/rate-limit-discovery'

const jsonl = (...events: unknown[]) => events.map((e) => JSON.stringify(e)).join('\n')

/** The genuine article: the CLI's own synthetic notice. Copied from a real transcript. */
const notice = {
  type: 'assistant',
  isApiErrorMessage: true,
  message: {
    role: 'assistant',
    model: '<synthetic>',
    content: [
      { type: 'text', text: "You've hit your session limit · resets 9:10am (America/Chicago)" },
    ],
  },
}
const userTurn = (text: string) => ({
  type: 'user',
  message: { role: 'user', content: text },
})
const assistantTurn = (text: string) => ({
  type: 'assistant',
  message: { role: 'assistant', model: 'claude-opus-4-8', content: [{ type: 'text', text }] },
})

test('a session stopped at the limit is found, and reads as pending', () => {
  const v = classifyRateLimitTail(jsonl(userTurn('do the thing'), assistantTurn('working'), notice))
  expect(v).not.toBeNull()
  expect(v?.pending).toBe(true)
  expect(v?.notice).toContain('session limit')
})

test('a session that carried on after the limit is NOT pending', () => {
  // The user resumed it themselves in a terminal — nothing for the monitor to do.
  const v = classifyRateLimitTail(
    jsonl(notice, userTurn('resume'), assistantTurn('picking back up')),
  )
  expect(v?.pending).toBe(false)
})

test("the CLI's own resume bookkeeping counts as resumed — it only exists because someone resumed", () => {
  // Resuming a session whose last turn died on an API error makes the CLI repair the dangling tail
  // with this canned pair (transcript.ts isCliBookkeeping). Its presence IS the evidence.
  const v = classifyRateLimitTail(
    jsonl(
      notice,
      {
        type: 'user',
        isMeta: true,
        message: { role: 'user', content: 'Continue from where you left off.' },
      },
      {
        type: 'assistant',
        isApiErrorMessage: false,
        message: {
          role: 'assistant',
          model: '<synthetic>',
          content: [{ type: 'text', text: 'No response requested.' }],
        },
      },
    ),
  )
  expect(v?.pending).toBe(false)
})

test('a session that never hit a limit is not a stop at all', () => {
  expect(classifyRateLimitTail(jsonl(userTurn('hi'), assistantTurn('hello')))).toBeNull()
})

// --- the false-positive class the 2026-07-15 repair migration had to clean up ---------------

test('a run that TALKS about rate limits is not rate-limited', () => {
  // Model prose is never evidence. This exact transcript — an agent discussing 429s and quota — is
  // this repo's own bread and butter, and the old detector marked every one of them as stopped.
  const v = classifyRateLimitTail(
    jsonl(
      userTurn('why did we get a 429?'),
      assistantTurn(
        "You've hit your session limit is what a real notice looks like; 429 means quota.",
      ),
    ),
  )
  expect(v).toBeNull()
})

test('a tool result mentioning a limit is not evidence', () => {
  const v = classifyRateLimitTail(
    jsonl(
      {
        type: 'user',
        message: {
          role: 'user',
          content: [{ type: 'tool_result', content: 'line 529: usage limit exceeded' }],
        },
      },
      assistantTurn('noted'),
    ),
  )
  expect(v).toBeNull()
})

test('a <synthetic> no-op is not a limit even though it is synthetic', () => {
  // `<synthetic>` alone is not enough — isApiErrorMessage:false is the CLI talking to itself. This
  // one also has no limit text, so both halves of the gate reject it.
  const v = classifyRateLimitTail(
    jsonl({
      type: 'assistant',
      isApiErrorMessage: false,
      message: {
        role: 'assistant',
        model: '<synthetic>',
        content: [{ type: 'text', text: 'No response requested.' }],
      },
    }),
  )
  expect(v).toBeNull()
})

test('a successful result is not a stop even if its text mentions a limit', () => {
  // Only an ERRORED terminal result is trusted (dispatch.ts applies the same rule live).
  const v = classifyRateLimitTail(
    jsonl({
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: 'explained the usage limit to the user',
    }),
  )
  expect(v).toBeNull()
})

test('an errored result IS trusted', () => {
  const v = classifyRateLimitTail(
    jsonl({
      type: 'result',
      subtype: 'error',
      is_error: true,
      result: 'rate limited — try again later',
    }),
  )
  expect(v?.pending).toBe(true)
})

// --- quota only: a 529 is not a discovery subject ---------------------------------------------

test('a session stopped by a transient 529 is NOT discovered', () => {
  // Discovery exists to resume sessions waiting on a 5-hour reset. A 529's wall cleared seconds
  // later, so parking it against the next reset would be exactly the quota/transient conflation
  // this split exists to kill. Our own runs retry a 529 in-process (dispatch.ts); a terminal
  // session left sitting on one is abandoned, not queued.
  const overload = {
    type: 'assistant',
    isApiErrorMessage: true,
    message: {
      role: 'assistant',
      model: '<synthetic>',
      content: [{ type: 'text', text: 'API Error: 529 Overloaded. This is a server-side issue.' }],
    },
  }
  expect(classifyRateLimitTail(jsonl(userTurn('go'), overload))).toBeNull()
})

// --- tail-reading mechanics -----------------------------------------------------------------

test('a truncated first line (the tail always starts mid-line) is ignored, not fatal', () => {
  const v = classifyRateLimitTail(`{"type":"assis\n${jsonl(notice)}`)
  expect(v?.pending).toBe(true)
})

test('blank lines and trailing newlines do not count as activity after the notice', () => {
  expect(classifyRateLimitTail(`${jsonl(notice)}\n\n`)?.pending).toBe(true)
})

test('a later limit re-opens a session that had resumed and hit the wall again', () => {
  const v = classifyRateLimitTail(jsonl(notice, userTurn('resume'), assistantTurn('back'), notice))
  expect(v?.pending).toBe(true)
})
