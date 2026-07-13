/**
 * Shared "detached launch" primitive for the LunarWerx daemons — the ONE place that knows how to
 * spawn a child process so it OUTLIVES the daemon (survives a tray Quit or an auto-update relaunch).
 *
 * WHY every kit app needs this: the shared tray host (lunarwerx-ui/src/tray-host/Tray-Host.ps1)
 * Quits by force tree-killing the daemon's whole process tree (`taskkill /PID <daemon> /T /F`), and
 * an auto-update relaunch kills+respawns the daemon the same way. So ANY child the daemon spawns
 * that is meant to keep running past that (a launched app instance, an external editor, a portable
 * chromeless window) must NOT be a descendant of the daemon.
 *
 * The catch (all empirically verified 2026-07-12): on Windows neither `.unref()` nor Node/Bun
 * `detached:true` removes a child from the parent's process tree — a direct spawn is still reaped by
 * `taskkill /T`. The only reliable detach is a hand-off through a transient `cmd`:
 *   · win32:  `cmd /c start "" <command> <args>`. The transient cmd fires `start` (CreateProcess +
 *             return) then exits, re-parenting the real child to an orphan OUTSIDE the tree. The
 *             empty `""` is the MANDATORY `start` window-title placeholder — without it `start`
 *             treats the quoted, space-bearing <command> as a title and launches nothing. The detach
 *             comes from this hand-off, NOT from a spawn flag, so `detached` is false on win32.
 *   · POSIX:  spawn the command directly with `detached:true` (a genuine setsid session detach).
 *
 * CALLER RESPONSIBILITIES (this primitive is deliberately dumb about them; each caller keeps its own
 * guard where it matters):
 *   · `cmd /c start` re-parses every arg through cmd.exe: it EXPANDS `%VAR%` (even inside quotes) and
 *     STRIPS `^`. A caller routing an untrusted/confined path through the win32 hand-off must refuse
 *     `%`/`^` up front, or the child receives a different path (a confinement bypass). See RepoYeti's
 *     cmdReparseHazard.
 *   · `start` cannot reliably relaunch a spaced-path `.cmd`/`.bat` shim (its internal `cmd /c
 *     "<batch>"` hits cmd's double-quote-strip and launches nothing) — detach a real `.exe`, not a
 *     batch file. A caller holding a `.cmd` shim should launch it on its own plain `cmd /c`
 *     (undetached) rather than route it through here.
 *   · macOS callers that want LaunchServices semantics build an `open`/`open -a` argv themselves and
 *     pass it through — `open` already hands the launch off, so the POSIX `detached:true` is a
 *     harmless belt-and-suspenders.
 *
 * `argv` is the full command line to launch: `[command, ...args]`. Returns the argv to ACTUALLY
 * spawn plus whether to pass `detached:true` to the spawn call — always a fresh array, never the
 * caller's input. Pure + exported so the per-OS detach contract is locked by unit tests
 * (detached-spawn.test.ts). Runtime-agnostic (Bun + Node); the `.d.mts` sibling types the import for
 * the TypeScript apps. Synced from the shared kit — do not edit in an app.
 */
export function buildDetachedSpawn(platform, argv) {
  if (platform === "win32") {
    return { argv: ["cmd", "/c", "start", "", ...argv], detached: false };
  }
  return { argv: [...argv], detached: true };
}
