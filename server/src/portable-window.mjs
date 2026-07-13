/**
 * Shared "portable window" opener for the LunarWerx daemons. Opens the app's UI in a
 * chromeless Chromium app window (`msedge --app=URL`, falling back to Chrome) so the
 * app presents as its own desktop window instead of a browser tab. Each app exposes
 * this through a POST /api/portable-window route; the tray launchers implement the
 * same resolve-and-fallback chain in PowerShell for cold starts (before the daemon,
 * and therefore this lib, is running).
 *
 * The window is a real, separate OS browser process that must OUTLIVE this daemon: an
 * auto-update relaunch of the daemon (or a tray Quit) must leave the window up, and its
 * SSE reconnects once the successor rebinds the port. The daemon's tray Quits by force
 * tree-killing the daemon (`taskkill /PID <daemon> /T /F`), and an auto-update relaunch
 * kills+respawns it the same way, so the window must NOT be a descendant of the daemon.
 * On Windows neither `.unref()` nor `detached:true` removes a child from the parent's
 * process tree (verified 2026-07-12), so the launch goes through a `cmd /c start ""`
 * hand-off (buildPortableSpawn) that re-parents the browser out of the tree; POSIX uses
 * `detached:true` (a real setsid detach).
 *
 * Runtime-agnostic (Bun + Node). Synced from the shared kit, do not edit in an
 * app; the `.d.mts` sibling types the import for the TypeScript apps.
 */
import { existsSync, mkdirSync } from "node:fs";
import { join, delimiter } from "node:path";
import { spawn } from "node:child_process";
import { buildDetachedSpawn } from "./detached-spawn.mjs";

/**
 * Candidate Chromium executables, most-preferred first. Edge leads on Windows
 * (preinstalled on every supported Windows; Chrome may be absent), Chrome elsewhere
 * by ubiquity. Only Chromium browsers understand `--app=`; Firefox has no equivalent.
 */
function candidates() {
  if (process.platform === "win32") {
    const pf = process.env.ProgramFiles || "C:\\Program Files";
    const pf86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
    const local = process.env.LOCALAPPDATA || "";
    const list = [
      { name: "msedge", path: join(pf86, "Microsoft", "Edge", "Application", "msedge.exe") },
      { name: "msedge", path: join(pf, "Microsoft", "Edge", "Application", "msedge.exe") },
      { name: "chrome", path: join(pf, "Google", "Chrome", "Application", "chrome.exe") },
      { name: "chrome", path: join(pf86, "Google", "Chrome", "Application", "chrome.exe") },
    ];
    if (local) list.push({ name: "chrome", path: join(local, "Google", "Chrome", "Application", "chrome.exe") });
    return list;
  }
  if (process.platform === "darwin") {
    return [
      { name: "chrome", path: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" },
      { name: "msedge", path: "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" },
    ];
  }
  // Linux: resolve the usual binary names against PATH ourselves, so the caller
  // still gets a definite "found it" / "no browser" answer instead of an async
  // ENOENT out of spawn().
  const dirs = (process.env.PATH || "").split(delimiter).filter(Boolean);
  const names = ["google-chrome", "google-chrome-stable", "microsoft-edge", "chromium", "chromium-browser"];
  const list = [];
  for (const name of names) {
    for (const dir of dirs) list.push({ name, path: join(dir, name) });
  }
  return list;
}

/**
 * Locate a Chromium-family browser that can host an `--app=` window.
 * Returns `{ name, path }` or null when none is installed.
 */
export function resolveChromiumBrowser() {
  for (const c of candidates()) {
    try {
      if (existsSync(c.path)) return c;
    } catch {
      /* unreadable candidate path; keep scanning */
    }
  }
  return null;
}

/**
 * Build the `(command, args, detached)` to spawn `browserPath` with `browserArgs` so the window
 * process ESCAPES the daemon's process tree (see the file header: it must survive an auto-update
 * relaunch or tray Quit, both of which tree-kill the daemon). The per-OS detach is the shared
 * kit primitive (buildDetachedSpawn: win32 → a `cmd /c start ""` hand-off, POSIX → `detached:true`
 * setsid); this only adapts its flat `argv` into the `{ command, args }` split that node's
 * `spawn(command, args)` takes below. Pure + exported so the split adapter is unit-tested.
 */
export function buildPortableSpawn(platform, browserPath, browserArgs) {
  const { argv, detached } = buildDetachedSpawn(platform, [browserPath, ...browserArgs]);
  return { command: argv[0], args: argv.slice(1), detached };
}

/**
 * Open `url` in a chromeless app window. Resolves to `{ ok: true, browser }` once the
 * window process has spawned, or `{ ok: false, reason: "no-browser" | "spawn-failed" }`.
 * Best-effort by design: callers surface the failure to the user (toast / fallback to
 * a normal tab) rather than treating it as fatal.
 *
 * `opts.profileDir` gives the window a dedicated Chromium profile (`--user-data-dir`).
 * Chromium remembers app-window size/position PER PROFILE, so a dedicated profile means
 * the portable window keeps its own geometry across launches instead of inheriting (and
 * fighting over) the user's main browser profile; it also runs as its own browser
 * process rather than handing off to an already-running instance. The family convention
 * is `<configDir>/portable-profile` (a sibling of runtime.json), and the PS tray
 * launchers derive the exact same path so both open paths share one profile. A dir that
 * cannot be created falls back to the default profile rather than failing the open.
 */
export function openPortableWindow(url, opts = {}) {
  const browser = resolveChromiumBrowser();
  if (!browser) return Promise.resolve({ ok: false, reason: "no-browser" });
  const args = [];
  if (opts.profileDir) {
    try {
      mkdirSync(opts.profileDir, { recursive: true });
      // no-first-run / no-default-browser-check: a fresh dedicated profile must open
      // straight into the app window, not Edge/Chrome onboarding.
      args.push(`--user-data-dir=${opts.profileDir}`, "--no-first-run", "--no-default-browser-check");
    } catch {
      /* unusable profile dir; open with the default profile instead */
    }
  }
  args.push(`--app=${url}`);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (!settled) {
        settled = true;
        resolve(result);
      }
    };
    try {
      const { command, args: spawnArgs, detached } = buildPortableSpawn(process.platform, browser.path, args);
      const child = spawn(command, spawnArgs, {
        detached,
        stdio: "ignore",
        windowsHide: true,
      });
      child.once("error", () => finish({ ok: false, reason: "spawn-failed" }));
      child.once("spawn", () => {
        child.unref();
        finish({ ok: true, browser: browser.name });
      });
      // Belt-and-suspenders for runtimes that never emit "spawn": if no error arrived
      // shortly after launch, the process started.
      setTimeout(() => {
        try {
          child.unref();
        } catch {
          /* already gone */
        }
        finish({ ok: true, browser: browser.name });
      }, 750);
    } catch {
      finish({ ok: false, reason: "spawn-failed" });
    }
  });
}
