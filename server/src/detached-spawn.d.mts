/** The argv to actually spawn plus whether to pass `detached:true` to the spawn call. */
export interface DetachedSpawn {
  /**
   * The full argv to spawn: on win32 the `cmd /c start ""` hand-off wrapping the input command
   * line, on POSIX the input unchanged. Always a fresh array (never aliases the caller's input).
   */
  argv: string[];
  /**
   * Pass `detached:true` to the spawn call (a POSIX setsid session detach). Always false on win32 —
   * there the `cmd /c start` hand-off does the detaching, not the spawn flag.
   */
  detached: boolean;
}

/**
 * Build the launch for `argv` (`[command, ...args]`) so the spawned child OUTLIVES the daemon (a
 * tray Quit / auto-update relaunch tree-kills the daemon). On win32 it goes through a `cmd /c start
 * ""` hand-off — the only reliable Windows detach; `.unref()`/`detached:true` do not break the
 * process tree — and returns `detached:false`. POSIX spawns the command directly with
 * `detached:true` (setsid). Pure + exported for unit tests. See the `.mjs` for the caller
 * responsibilities around `%`/`^` in paths and `.cmd`/`.bat` shims.
 */
export function buildDetachedSpawn(platform: NodeJS.Platform, argv: string[]): DetachedSpawn;
