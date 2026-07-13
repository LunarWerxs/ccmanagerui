// Tests for the shared detached-spawn primitive (SHARED LunarWerx server-lib — source of truth:
// lunarwerx-ui/src/server-lib/detached-spawn.test.ts, synced by sync.mjs into each app's
// `serverTests` dir under a `server-lib/` subdir next to the app's server tree). The
// `../../src/detached-spawn.mjs` import resolves only from that synced location — sync.mjs
// validates the placement — so this file is NOT runnable inside the kit repo itself.
//
// This is the ONE regression guard for the kit-wide Windows-detach contract: every kit app whose
// daemon spawns a child meant to survive a tray Quit (taskkill /T on the daemon) routes that launch
// through buildDetachedSpawn. On win32 that MUST be a `cmd /c start ""` hand-off — a direct spawn,
// even with detached:true, stays in the daemon's process tree and gets reaped (verified 2026-07-12).
// These pin the per-OS spawn shape so a future refactor back to a direct spawn fails here instead of
// silently reintroducing the regression.
import { expect, test } from "bun:test";
import { buildDetachedSpawn } from "../../src/detached-spawn.mjs";

const EXE = "C:\\Program Files\\App\\app.exe";
const ARGS = ["--user-data-dir", "C:\\path with space\\profile"];

test('win32: hands off via `cmd /c start ""` so the child escapes the daemon process tree', () => {
  const s = buildDetachedSpawn("win32", [EXE, ...ARGS]);
  expect(s.argv).toEqual(["cmd", "/c", "start", "", EXE, ...ARGS]);
  // The empty "" title placeholder is mandatory — without it `start` treats the quoted, spaced
  // command path as a window title and launches nothing.
  expect(s.argv[3]).toBe("");
  // The command must NOT be argv[0] on win32: a direct spawn is exactly the tree-kill regression.
  expect(s.argv[0]).toBe("cmd");
  expect(s.argv[0]).not.toBe(EXE);
  // Windows detach comes from the `start` hand-off, NOT the (ineffective) detached spawn flag.
  expect(s.detached).toBe(false);
  // A spaced arg survives as a single argv element (cmd re-parse preserves quoted values).
  expect(s.argv).toContain("C:\\path with space\\profile");
});

test("posix: spawns the command directly with detached:true (setsid), argv unchanged", () => {
  const mac = buildDetachedSpawn("darwin", ["open", "-a", "App", "/x"]);
  expect(mac).toEqual({ argv: ["open", "-a", "App", "/x"], detached: true });
  const linux = buildDetachedSpawn("linux", ["/usr/bin/app", "--flag"]);
  expect(linux).toEqual({ argv: ["/usr/bin/app", "--flag"], detached: true });
});

test("returns a fresh argv array on every platform (never aliases the caller's input)", () => {
  const input = ["/usr/bin/app", "--flag"];
  expect(buildDetachedSpawn("linux", input).argv).not.toBe(input);
  expect(buildDetachedSpawn("win32", input).argv).not.toBe(input);
});
