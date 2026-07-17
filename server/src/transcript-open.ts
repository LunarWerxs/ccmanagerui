/**
 * Pure argv builder for "open this transcript with an editor" (server/src/index.ts's
 * POST /api/sessions/:id/open-file route).
 *
 * WHY this exists: `.jsonl` has no file association on a stock Windows machine, so handing the
 * path to the OS default handler (`cmd /c start "" <path>`) makes Windows pop its "How do you want
 * to open this file?" picker instead of just opening it. The fix is to name an editor explicitly
 * rather than ask the OS to guess.
 *
 * WHY notepad is the floor: it ships with every Windows install, so `detectWindowsEditor` can
 * always return SOMETHING that exists, so the picker dialog this module exists to avoid can then
 * never appear, even on a machine with no code editor installed at all.
 *
 * WHY we still go through `cmd /c start ""` rather than spawning the editor directly: `start` hands
 * the launch off to a fresh ShellExecute'd process, so the editor is NOT a child of the daemon and
 * survives the tray's `taskkill /T` on Quit (see server/src/detached-spawn.mjs's header for the same
 * tree-kill constraint on a different launch path). It also means `windowsHide: true` on the spawn
 * only hides the transient `cmd.exe`, which is a console app and so obeys SW_HIDE; the editor it
 * hands off to inherits none of that STARTUPINFO and opens its own window normally. Spawning a GUI
 * program directly under `windowsHide` would hide it outright, which is a real bug this repo already
 * shipped once against `explorer` (see server/src/core/instances.ts's revealInstanceFolder).
 */
import { homedir } from 'node:os'
import { win32 } from 'node:path'

/** Candidate editors, in preference order, as absolute-path templates.
 *
 *  `win32.join`, not the ambient `join`: these are Windows paths whatever host is running the
 *  function, and the ambient one follows the HOST. On a POSIX box (CI's ubuntu leg) it would splice
 *  `C:\Users\me\AppData\Local` and `Programs` with a forward slash and hand back a path that is
 *  neither valid Windows nor matched by anything. Pinning the separator keeps this deterministic and
 *  keeps the unit tests meaningful off-Windows. */
export function windowsEditorCandidates(env: Record<string, string | undefined>): string[] {
  const programFiles = env.ProgramFiles || 'C:\\Program Files'
  const localAppData = env.LOCALAPPDATA ?? win32.join(homedir(), 'AppData', 'Local')
  return [
    win32.join(localAppData, 'Programs', 'Microsoft VS Code', 'Code.exe'),
    win32.join(programFiles, 'Microsoft VS Code', 'Code.exe'),
    win32.join(localAppData, 'Programs', 'cursor', 'Cursor.exe'),
    win32.join(programFiles, 'Notepad++', 'notepad++.exe'),
    win32.join(programFiles, 'Sublime Text', 'subl.exe'),
  ]
}

/** First candidate that exists, else 'notepad' (always present on Windows, so we never ask). */
export function detectWindowsEditor(
  env: Record<string, string | undefined>,
  exists: (p: string) => boolean,
): string {
  for (const candidate of windowsEditorCandidates(env)) {
    if (exists(candidate)) return candidate
  }
  return 'notepad'
}

/** A bare command name (`notepad`, `code`) is resolved by `start`/PATH at launch time and cannot be
 *  existence-checked from here; only something with a separator is a path we can verify. */
const looksLikePath = (s: string) => s.includes('\\') || s.includes('/')

/**
 * The editor that will ACTUALLY be used, given the user's override. Exported so the settings API can
 * show it: this is the only honest way to tell someone their override is being ignored.
 *
 * A win32 override that looks like a path but does not exist falls back to auto-detect rather than
 * being passed through. That is not defensive padding, it is the difference between working and a
 * silent no-op: `cmd /c start "" "C:\typo.exe" <file>` reports "cannot find the file" on the console
 * we are deliberately hiding, so `start` exits fine, the spawn succeeds, the route still answers ok,
 * and the button just does nothing forever with no visible reason (measured 2026-07-16: zero windows,
 * zero dialogs, zero feedback). Falling back keeps the button working; surfacing the resolved value
 * in Settings is what keeps the fallback from being a lie.
 */
export function resolveEditor(
  platform: NodeJS.Platform,
  editor: string,
  env: Record<string, string | undefined>,
  exists: (p: string) => boolean,
): string {
  const pick = editor.trim()
  if (platform !== 'win32') return pick
  if (pick && looksLikePath(pick) && !exists(pick)) return detectWindowsEditor(env, exists)
  return pick || detectWindowsEditor(env, exists)
}

/** The argv to spawn to open `filePath`. `editor` is the user's override ('' = auto-detect). */
export function buildTranscriptOpenArgv(
  platform: NodeJS.Platform,
  filePath: string,
  editor: string,
  env: Record<string, string | undefined>,
  exists: (p: string) => boolean,
): string[] {
  const pick = resolveEditor(platform, editor, env, exists)
  if (platform === 'win32') {
    // The empty '' argument is `start`'s TITLE parameter. Omitting it makes `start` treat a
    // quoted program path AS the title and silently open a blank console instead. Keep it.
    return ['cmd', '/c', 'start', '', pick, filePath]
  }
  if (platform === 'darwin') {
    // '-t' opens the default TEXT editor, which never shows a picker (unlike a bare `open`,
    // which would ask the same as Windows' unassociated-extension dialog for a .jsonl).
    // `open -a` takes an app NAME as happily as a path, so an override is never path-checked here.
    return pick ? ['open', '-a', pick, filePath] : ['open', '-t', filePath]
  }
  return pick ? [pick, filePath] : ['xdg-open', filePath]
}
