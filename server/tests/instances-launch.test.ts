// Regression guard for the instance-launch DETACH contract (see buildInstanceLaunch).
//
// The bug this locks out: quitting CC Manager UI took the launched Claude Desktop instance down
// with it. The Windows tray host quits by tree-killing the daemon's whole process tree
// (`taskkill /PID <daemon> /T /F`), so an instance launched as a DIRECT child of the daemon is in
// that tree and dies on Quit. Empirically (2026-07-12) neither `.unref()` nor Bun's
// `detached: true` breaks the Windows process tree; only a hand-off launcher (`cmd /c start`)
// re-parents the instance out of the tree. These tests pin that argv shape per-OS so a future
// "simplification" back to a plain `Bun.spawn([binary, ...args])` fails CI instead of silently
// reintroducing the regression.
import { expect, test } from 'bun:test'
import { buildInstanceLaunch } from '../src/core/instances'

const WIN_BIN = 'C:\\Users\\me\\AppData\\Local\\AnthropicClaude\\app-1.0.0\\Claude.exe'
const WIN_ARGS = ['--user-data-dir', 'C:\\path with space\\profile']

test('win32: launches via `cmd /c start ""` so the instance escapes the daemon process tree', () => {
  const { argv, detached } = buildInstanceLaunch('win32', WIN_BIN, WIN_ARGS)
  expect(argv).toEqual([
    'cmd',
    '/c',
    'start',
    '',
    WIN_BIN,
    '--user-data-dir',
    'C:\\path with space\\profile',
  ])
  // The empty '' title placeholder is mandatory; without it `start` treats the quoted binary
  // path as a window title and launches nothing.
  expect(argv[3]).toBe('')
  // The binary must NOT be argv[0]: a direct spawn is exactly the tree-kill regression.
  expect(argv[0]).toBe('cmd')
  // Windows detach comes from the `start` hand-off, NOT Bun's (ineffective) detached flag.
  expect(detached).toBe(false)
})

test('win32: spaced --user-data-dir value survives as a single argv element', () => {
  const { argv } = buildInstanceLaunch('win32', WIN_BIN, WIN_ARGS)
  expect(argv).toContain('C:\\path with space\\profile')
})

test('darwin: launches via `open`, which hands off to LaunchServices (never our child)', () => {
  const args = ['-na', 'Claude', '--args', '--user-data-dir', '/Users/me/profile']
  const { argv, detached } = buildInstanceLaunch('darwin', 'Claude', args)
  expect(argv).toEqual(['open', ...args])
  expect(detached).toBe(false)
})

test('linux: direct spawn but detached:true (setsid), a genuine POSIX detach', () => {
  const { argv, detached } = buildInstanceLaunch('linux', '/usr/bin/claude', [
    '--user-data-dir',
    '/home/me/p',
  ])
  expect(argv).toEqual(['/usr/bin/claude', '--user-data-dir', '/home/me/p'])
  expect(detached).toBe(true)
})
