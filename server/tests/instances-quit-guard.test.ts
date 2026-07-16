// server/tests/instances-quit-guard.test.ts — regression guard for quitInstance()'s missing
// default-profile protection.
//
// The bug: quitInstance() (core/instances.ts) kills whatever Claude Desktop process's
// `--user-data-dir` matches the requested dir (correctly PID-scoped), but had NO guard against
// that dir being the DEFAULT (non-isolated) Claude profile — the user's REAL Claude Desktop, the
// "External" instance row (core/paths.ts claudeUserDataDir()/defaultClaudeDir()). By contrast
// removeInstance() (core/lifecycle.ts) explicitly refuses to ever touch that dir (its Guard 1).
// This let a one-click "quit" on the External row kill a real, in-progress conversation.
//
// These tests never enumerate or kill a REAL process: `listProcesses` is always injected with a
// synthetic stub, and every "isolated instance" case uses a throwaway temp dir.
import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { quitInstance } from '../src/core/instances'
import { defaultClaudeDir } from '../src/core/paths'

function neverCalled(): never {
  throw new Error('listProcesses must not be called when the external guard refuses the quit')
}

test('refuses to quit the default (non-isolated) Claude Desktop profile without confirmExternal', async () => {
  const result = await quitInstance(defaultClaudeDir(), { listProcesses: neverCalled })

  expect(result.ok).toBe(false)
  expect(result.data?.killedCount).toBe(0)
  expect(result.message).toMatch(/regular|external/i)
  expect(result.message).toMatch(/conversation/i)
})

test('confirmExternal:true proceeds past the guard for the default profile', async () => {
  // Proceeding past the guard means listProcesses gets called (proving the refusal above was
  // skipped); it legitimately reports "not running" here since the stub returns no processes.
  let called = false
  const result = await quitInstance(defaultClaudeDir(), {
    confirmExternal: true,
    listProcesses: async () => {
      called = true
      return []
    },
  })

  expect(called).toBe(true)
  expect(result.ok).toBe(true)
  expect(result.message).toBe('not running')
})

test('normalization bypass attempt: different casing is still refused', async () => {
  const upper = defaultClaudeDir().toUpperCase()
  const result = await quitInstance(upper, { listProcesses: neverCalled })

  expect(result.ok).toBe(false)
  expect(result.message).toMatch(/regular|external/i)
})

test('normalization bypass attempt: trailing backslash/slash is still refused', async () => {
  const withSlash = `${defaultClaudeDir()}${path.sep}`
  const result = await quitInstance(withSlash, { listProcesses: neverCalled })

  expect(result.ok).toBe(false)
  expect(result.message).toMatch(/regular|external/i)
})

test('an isolated instance dir is NOT refused by the external guard', async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'ccmui-quit-guard-test-'))
  try {
    const result = await quitInstance(tempDir, {
      listProcesses: async () => [],
    })

    // Not the external-guard refusal — falls through to the ordinary "not running" path.
    expect(result.message).not.toMatch(/regular|external/i)
    expect(result.ok).toBe(true)
    expect(result.message).toBe('not running')
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
})
