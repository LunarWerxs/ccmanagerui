export interface ChromiumBrowser {
  /** Short identifier: "msedge", "chrome", "chromium", ... */
  name: string;
  /** Absolute path of the executable. */
  path: string;
}

export type PortableWindowResult =
  | { ok: true; browser: string }
  | { ok: false; reason: "no-browser" | "spawn-failed" };

/**
 * Locate a Chromium-family browser that can host an `--app=` window.
 * Returns null when none is installed.
 */
export function resolveChromiumBrowser(): ChromiumBrowser | null;

/** The `(command, args, detached)` used to spawn the window so it escapes the daemon's tree. */
export interface PortableSpawn {
  command: string;
  args: string[];
  detached: boolean;
}

/**
 * Build the spawn command for the window so it OUTLIVES the daemon (a tray Quit / auto-update
 * relaunch tree-kills the daemon). On win32 it goes through a `cmd /c start ""` hand-off (the only
 * reliable Windows detach; `.unref()`/`detached:true` do not break the process tree); POSIX spawns
 * the browser directly with `detached:true`. Pure + exported for unit tests.
 */
export function buildPortableSpawn(
  platform: NodeJS.Platform,
  browserPath: string,
  browserArgs: string[],
): PortableSpawn;

export interface PortableWindowOptions {
  /**
   * Dedicated Chromium profile dir for the window (`--user-data-dir`), so the
   * app window remembers its own size/position across launches. Family
   * convention: `<configDir>/portable-profile`, a sibling of runtime.json.
   */
  profileDir?: string;
}

/**
 * Open `url` in a detached chromeless app window (`--app=url`). Best-effort:
 * resolves with `{ ok: false }` instead of throwing when no browser is found
 * or the spawn fails.
 */
export function openPortableWindow(url: string, opts?: PortableWindowOptions): Promise<PortableWindowResult>;
