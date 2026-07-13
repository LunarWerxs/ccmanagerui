// server/tests/desktop-install.test.ts — core/desktop-install.ts detection matrix.
//
// The win32 detection paths are exercised with injected fake %LOCALAPPDATA% trees (throwaway
// temp dirs), gated to Windows since non-win32 platforms take the early "always manageable"
// return. One golden test asserts this machine's real classic (Squirrel) install resolves.

import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { appxOutputHasPfn, detectDesktopInstall } from '../src/core/desktop-install'
import { openInstance } from '../src/core/instances'

const isWin = process.platform === 'win32'

/** Fake %LOCALAPPDATA% builder — returns the root; callers add Packages/WindowsApps bits. */
function fakeLocalAppData(): string {
  return mkdtempSync(join(os.tmpdir(), 'ccmui-desktop-install-'))
}

const cleanups: string[] = []
afterEach(() => {
  for (const dir of cleanups.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // Best-effort temp cleanup.
    }
  }
  delete process.env.CCMANAGERUI_FAKE_DESKTOP_INSTALL
})

describe('detectDesktopInstall — win32 detection matrix (injected dirs)', () => {
  test.if(isWin)('classic-only install: manageable, no MSIX', async () => {
    const lad = fakeLocalAppData()
    cleanups.push(lad)
    const result = await detectDesktopInstall({
      localAppData: lad,
      resolveDirect: async () => 'C:\\fake\\AnthropicClaude\\app-1.0.0\\Claude.exe',
      appxProbe: null,
    })
    expect(result.platform).toBe('win32')
    expect(result.manageable).toBe(true)
    expect(result.msixDetected).toBe(false)
    expect(result.msixSignals).toEqual([])
  })

  test.if(isWin)('MSIX-only via Packages dir: not manageable, packages-dir signal', async () => {
    const lad = fakeLocalAppData()
    cleanups.push(lad)
    mkdirSync(join(lad, 'Packages', 'Claude_pzs8sxrjxfjjc'), { recursive: true })
    const result = await detectDesktopInstall({
      localAppData: lad,
      resolveDirect: async () => null,
      appxProbe: null,
    })
    expect(result.manageable).toBe(false)
    expect(result.directPath).toBeNull()
    expect(result.msixDetected).toBe(true)
    expect(result.msixSignals).toEqual(['packages-dir'])
  })

  test.if(isWin)('MSIX via app-execution alias: exec-alias signal', async () => {
    const lad = fakeLocalAppData()
    cleanups.push(lad)
    mkdirSync(join(lad, 'Microsoft', 'WindowsApps'), { recursive: true })
    writeFileSync(join(lad, 'Microsoft', 'WindowsApps', 'claude.exe'), '')
    const result = await detectDesktopInstall({
      localAppData: lad,
      resolveDirect: async () => null,
      appxProbe: null,
    })
    expect(result.msixDetected).toBe(true)
    expect(result.msixSignals).toEqual(['exec-alias'])
    expect(result.manageable).toBe(false)
  })

  test.if(isWin)('both installed side by side: manageable AND msixDetected', async () => {
    const lad = fakeLocalAppData()
    cleanups.push(lad)
    mkdirSync(join(lad, 'Packages', 'Claude_pzs8sxrjxfjjc'), { recursive: true })
    const result = await detectDesktopInstall({
      localAppData: lad,
      resolveDirect: async () => 'C:\\fake\\AnthropicClaude\\app-1.0.0\\Claude.exe',
      appxProbe: null,
    })
    expect(result.manageable).toBe(true)
    expect(result.msixDetected).toBe(true)
  })

  test.if(isWin)('nothing installed: not manageable, no MSIX', async () => {
    const lad = fakeLocalAppData()
    cleanups.push(lad)
    const result = await detectDesktopInstall({
      localAppData: lad,
      resolveDirect: async () => null,
      appxProbe: null,
    })
    expect(result.manageable).toBe(false)
    expect(result.msixDetected).toBe(false)
    expect(result.msixSignals).toEqual([])
  })

  test.if(isWin)('Get-AppxPackage probe runs only as fallback and adds appx signal', async () => {
    const lad = fakeLocalAppData()
    cleanups.push(lad)
    const result = await detectDesktopInstall({
      localAppData: lad,
      resolveDirect: async () => null,
      appxProbe: async () => true,
    })
    expect(result.msixDetected).toBe(true)
    expect(result.msixSignals).toEqual(['appx'])
  })

  test.if(isWin)('probe is skipped when a filesystem signal already fired', async () => {
    const lad = fakeLocalAppData()
    cleanups.push(lad)
    mkdirSync(join(lad, 'Packages', 'Claude_pzs8sxrjxfjjc'), { recursive: true })
    let probeRan = false
    const result = await detectDesktopInstall({
      localAppData: lad,
      resolveDirect: async () => null,
      appxProbe: async () => {
        probeRan = true
        return true
      },
    })
    expect(probeRan).toBe(false)
    expect(result.msixSignals).toEqual(['packages-dir'])
  })

  test.if(isWin)('package-family-name shape is strict: no false positives', async () => {
    const lad = fakeLocalAppData()
    cleanups.push(lad)
    // Wrong name prefix, wrong hash length, unrelated Claude-ish third-party package.
    mkdirSync(join(lad, 'Packages', 'ClaudeFake_pzs8sxrjxfjjc'), { recursive: true })
    mkdirSync(join(lad, 'Packages', 'Claude_short'), { recursive: true })
    mkdirSync(join(lad, 'Packages', 'SomeVendor.ClaudeChat_abcdefghjkmnp'), { recursive: true })
    const result = await detectDesktopInstall({
      localAppData: lad,
      resolveDirect: async () => null,
      appxProbe: null,
    })
    expect(result.msixDetected).toBe(false)
  })
})

describe('detectDesktopInstall — cross-platform behavior', () => {
  test.if(!isWin)('non-Windows is always manageable (MSIX split does not exist)', async () => {
    const result = await detectDesktopInstall({ fresh: true, appxProbe: null })
    expect(result.platform).not.toBe('win32')
    expect(result.manageable).toBe(true)
    expect(result.msixDetected).toBe(false)
  })

  test('CCMANAGERUI_FAKE_DESKTOP_INSTALL=msix-only forces the warning shape', async () => {
    process.env.CCMANAGERUI_FAKE_DESKTOP_INSTALL = 'msix-only'
    const result = await detectDesktopInstall({ fresh: true })
    expect(result.manageable).toBe(false)
    expect(result.msixDetected).toBe(true)
    expect(result.msixSignals).toEqual(['fake'])
    // Fake modes must report win32 even on mac/linux dev machines — the Instances-tab banner
    // is gated on platform === 'win32', so a passed-through real platform would no-op there.
    expect(result.platform).toBe('win32')
  })

  test('CCMANAGERUI_FAKE_DESKTOP_INSTALL=ok forces the manageable shape', async () => {
    process.env.CCMANAGERUI_FAKE_DESKTOP_INSTALL = 'ok'
    const result = await detectDesktopInstall({ fresh: true })
    expect(result.manageable).toBe(true)
    expect(result.msixDetected).toBe(false)
    expect(result.platform).toBe('win32')
  })

  test('unknown fake mode falls through to real detection', async () => {
    process.env.CCMANAGERUI_FAKE_DESKTOP_INSTALL = 'bogus'
    const result = await detectDesktopInstall({ fresh: true, appxProbe: null })
    expect(result.msixSignals).not.toEqual(['fake'])
  })
})

describe('appxOutputHasPfn — Get-AppxPackage stdout parsing', () => {
  test('matches the bare PFN and newline-joined multi-package output', () => {
    expect(appxOutputHasPfn('Claude_pzs8sxrjxfjjc\r\n')).toBe(true)
    expect(appxOutputHasPfn('Other_abcdefghjkmnp\r\nClaude_pzs8sxrjxfjjc\r\n')).toBe(true)
  })

  test('rejects PFN-shaped substrings inside longer lines and empty output', () => {
    expect(appxOutputHasPfn('')).toBe(false)
    expect(appxOutputHasPfn('WARNING: something Claude_pzs8sxrjxfjjc mentioned')).toBe(false)
    expect(appxOutputHasPfn('SomeVendor.ClaudeChat_abcdefghjkmnp')).toBe(false)
  })
})

// openInstance's no-binary failure path: point LOCALAPPDATA at an empty temp dir so no real
// Claude binary resolves (nothing can actually launch), and force the MSIX-only fake so the
// failure message carries the actionable explanation. Skipped if a machine-wide install at
// C:\Program Files\Claude exists (paths.ts falls back to it and would resolve a real binary).
describe('openInstance — no-binary failure message', () => {
  test.if(isWin && !existsSync('C:\\Program Files\\Claude\\Claude.exe'))(
    'explains the MSIX-only case instead of the generic message',
    async () => {
      const savedLad = process.env.LOCALAPPDATA
      const lad = fakeLocalAppData()
      cleanups.push(lad)
      process.env.LOCALAPPDATA = lad
      process.env.CCMANAGERUI_FAKE_DESKTOP_INSTALL = 'msix-only'
      try {
        const result = await openInstance('C:\\nonexistent\\ccmui-msix-message-test')
        expect(result.ok).toBe(false)
        expect(result.message ?? '').toContain('MSIX')
      } finally {
        process.env.LOCALAPPDATA = savedLad
      }
    },
  )
})

// Golden (this machine): the real classic install at %LOCALAPPDATA%\AnthropicClaude resolves.
const goldenClassicDir = isWin ? join(process.env.LOCALAPPDATA ?? '', 'AnthropicClaude') : ''
describe('detectDesktopInstall — golden (real machine state)', () => {
  test.if(isWin && existsSync(goldenClassicDir))(
    'this machine reports a manageable classic install',
    async () => {
      const result = await detectDesktopInstall({ fresh: true, appxProbe: null })
      expect(result.manageable).toBe(true)
      expect(result.directPath ?? '').toContain('AnthropicClaude')
    },
  )
})
