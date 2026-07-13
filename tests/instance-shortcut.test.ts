// Per-instance desktop launcher (Instances tab → ⋮ → "Create desktop shortcut").
// See server/src/core/shortcut.ts. Two layers:
//   - safeShortcutBase(): pure filename sanitizer, asserted on every OS.
//   - createInstanceShortcut(): win32-gated end-to-end — writes a real .lnk into a temp "desktop"
//     and resolves it back through WScript.Shell COM (mirrors launcher.test.ts's approach). On a
//     box without the classic Claude install the function returns a graceful, actionable failure
//     instead of a file, and the test asserts THAT branch — so it stays green in CI either way.

import { describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInstanceShortcut, safeShortcutBase } from '../server/src/core/shortcut'

const win = process.platform === 'win32'

describe('safeShortcutBase', () => {
  test('keeps letters, digits, spaces, and dashes', () => {
    expect(safeShortcutBase('Claude - work client-a')).toBe('Claude - work client-a')
  })
  test('strips the Windows-invalid filename characters', () => {
    expect(safeShortcutBase('a:b/c\\d*e?f"g<h>i|j')).toBe('abcdefghij')
  })
  test('falls back to "instance" when nothing printable survives', () => {
    expect(safeShortcutBase('***')).toBe('instance')
    expect(safeShortcutBase('   ')).toBe('instance')
  })
})

describe.skipIf(!win)('createInstanceShortcut (win32)', () => {
  test('writes a .lnk that launches the instance with an isolated --user-data-dir', async () => {
    const workDir = mkdtempSync(join(tmpdir(), 'cmui-shortcut-'))
    const instanceDir = join(workDir, 'instances', 'test-inst')
    const desktopDir = join(workDir, 'desktop')
    mkdirSync(instanceDir, { recursive: true })
    mkdirSync(desktopDir, { recursive: true })
    try {
      const result = await createInstanceShortcut(instanceDir, { desktopDir })

      if (!result.ok) {
        // No classic Claude install on this box (e.g. CI): assert the graceful failure, no file.
        expect(typeof result.message).toBe('string')
        expect((result.message ?? '').length).toBeGreaterThan(0)
        expect(readdirSync(desktopDir)).toHaveLength(0)
        return
      }

      const lnk = String((result.data as { path?: string })?.path ?? '')
      expect(lnk.endsWith('Claude - test-inst.lnk')).toBe(true)
      expect(existsSync(lnk)).toBe(true)

      // Resolve the shortcut through COM and assert the launch wiring end-to-end.
      const out = execFileSync(
        'powershell',
        [
          '-NoProfile',
          '-Command',
          `$s=(New-Object -ComObject WScript.Shell).CreateShortcut('${lnk.replace(/\\/g, '\\\\')}'); "$($s.TargetPath)|$($s.Arguments)|$($s.IconLocation)"`,
        ],
        { encoding: 'utf8' },
      ).trim()
      const [target, args, icon] = out.split('|')
      // Targets the stable root claude.exe stub (survives Claude Desktop version updates).
      expect(target.toLowerCase()).toContain('claude.exe')
      expect(args).toContain('--user-data-dir=')
      expect(args.toLowerCase()).toContain('test-inst')
      expect(icon.toLowerCase()).toMatch(/app\.ico|claude\.exe/)
    } finally {
      rmSync(workDir, { recursive: true, force: true })
    }
  })
})
