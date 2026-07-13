// Tests for the shared portable-window opener (SHARED LunarWerx server-lib — source of truth:
// lunarwerx-ui/src/server-lib/portable-window.test.ts, synced by sync.mjs into each app's
// `serverTests` dir under a `server-lib/` subdir next to the app's server tree). The
// `../../src/portable-window.mjs` import resolves only from that synced location — sync.mjs
// validates the placement — so this file is NOT runnable inside the kit repo itself.
//
// Scope note: openPortableWindow SPAWNS a real, detached browser window — an intolerable side
// effect in an automated run — so it is deliberately NOT exercised here. Only the pure,
// read-only resolver (existsSync probing, no process spawn) is tested. Its contract holds on
// every host: it returns a real, existing Chromium-family executable, or null when none is
// installed (a valid outcome on a headless CI box).
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { buildPortableSpawn, resolveChromiumBrowser } from "../../src/portable-window.mjs";

const KNOWN_NAMES = [
  "msedge",
  "chrome",
  "chromium",
  "chromium-browser",
  "google-chrome",
  "google-chrome-stable",
  "microsoft-edge",
];

test("resolveChromiumBrowser returns null, or a real existing executable with a known name", () => {
  const found = resolveChromiumBrowser();
  if (found === null) return; // no Chromium-family browser on this host — a valid result
  expect(KNOWN_NAMES).toContain(found.name);
  expect(typeof found.path).toBe("string");
  expect(found.path.length).toBeGreaterThan(0);
  expect(existsSync(found.path)).toBe(true);
});

// Regression guard: the portable window MUST outlive the daemon (an auto-update relaunch or tray
// Quit tree-kills the daemon with `taskkill /T`). On Windows that requires a `cmd /c start ""`
// hand-off — a direct spawn, even with `detached:true`, stays inside the daemon's process tree and
// gets reaped (verified 2026-07-12). These pin the per-OS spawn shape so a future refactor back to a
// direct `spawn(browser, ...)` fails here instead of silently regressing.
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const APP_ARGS = ["--user-data-dir=C:\\config dir\\portable-profile", "--app=http://127.0.0.1:7787/"];

test("buildPortableSpawn win32: hands off via `cmd /c start \"\"` so the window escapes the daemon tree", () => {
  const s = buildPortableSpawn("win32", EDGE, APP_ARGS);
  expect(s.command).toBe("cmd");
  expect(s.args).toEqual(["/c", "start", "", EDGE, ...APP_ARGS]);
  // The empty "" title placeholder is mandatory — without it `start` treats the quoted, spaced
  // browser path as a window title and launches nothing.
  expect(s.args[2]).toBe("");
  // The browser must NOT be the spawned command on win32: a direct spawn is the tree-kill regression.
  expect(s.command).not.toBe(EDGE);
});

test("buildPortableSpawn posix: spawns the browser directly with detached:true (setsid)", () => {
  const mac = buildPortableSpawn("darwin", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", APP_ARGS);
  expect(mac).toEqual({
    command: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    args: APP_ARGS,
    detached: true,
  });
  const linux = buildPortableSpawn("linux", "/usr/bin/google-chrome", APP_ARGS);
  expect(linux).toEqual({ command: "/usr/bin/google-chrome", args: APP_ARGS, detached: true });
});
