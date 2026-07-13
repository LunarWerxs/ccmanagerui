# Changelog

All notable changes to CC Manager UI are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - 2026-07-13

### Added

- **Per-instance icon and color.** Every row in the Instances table now shows a customizable glyph
  in place of the old green status dot. An "Edit" action (in the row's ⋮ menu) lets you pick an icon
  from a curated set and a color from a fixed palette, with a live preview; a running instance keeps
  a small pulsing badge on the icon's top-right corner, and a stopped one dims. Instances you have
  not customized get a stable, distinct default derived from their folder, so the table reads at a
  glance.

### Changed

- **Renaming an instance is now instant and works while it is running.** A rename used to move the
  instance's on-disk profile folder, which Windows will not allow while Claude Desktop holds it open.
  The name is now a display label kept as UI metadata (`~/.ccmanagerui/instance-meta.json`, never a
  secret) that overlays the folder name wherever it is shown; the folder keeps its original name as
  the stable id that sessions are tagged by. The old `POST /api/instances/:dir/rename` folder-rename
  route was replaced by `POST /api/instances/:dir/meta` (display label, icon, and color in one call).
- **A running instance's row leads with Focus.** For a running instance the primary button is now
  "Focus" (bring its window to the front); "Quit" moved into the ⋮ menu, so the common action is one
  click and the destructive one is deliberate. The ⋮ menu was widened so "Create desktop shortcut"
  no longer wraps.
- **Header and panel cleanup.** Removed the redundant "New run" button from the app header (it
  already lives in the queue drawer), and dropped two divider lines (below the queue drawer's toolbar
  and below the sessions search box). The sessions list and its instance filter now show each
  instance's display label.

### Fixed

- **Mutating API routes no longer 500 on an odd request body.** A body that is valid JSON but not an
  object (a bare `null`, a number, or a string) used to crash the handler with a 500; every mutating
  route now runs the body through a shared object guard and degrades gracefully. Creating a new
  instance also starts it with a clean appearance, so reusing a name never resurrects a deleted
  instance's old label, icon, or color.

## [0.1.0] - 2026-07-13

### Added

- **Queued `claude` runs now survive quitting (or auto-updating) CC Manager UI.** A dispatched run
  used to be a direct child of the daemon, so a tray Quit (which force tree-kills the daemon) or an
  auto-update relaunch killed the run mid-flight and left it stuck marked "running". Now the daemon
  launches each run through a detached supervisor (`server/src/dispatch-runner.ts`) that owns the
  `claude` process and streams its output to a per-run log file the daemon tails; the run keeps
  executing to completion even with the daemon gone. On the next launch the daemon **reattaches** —
  rebuilds the run's events from its log and resumes the live view, or records the final status if it
  finished while the daemon was down (`reattachRuns`, `server/src/dispatch.ts`). On Windows the
  supervisor is created via WMI (`Win32_Process.Create`) so it escapes the daemon's job object;
  verified end-to-end that a run survives a `taskkill /T /F` of the daemon and a graceful shutdown,
  then reattaches and completes. The run's account secret is read from the DB by the supervisor (never
  written to disk), and cancel still works (it kills `claude`; the run finalizes as "canceled").
- **Auto-update waits for the queue to go idle.** Auto-update relaunches the daemon; even though runs
  now survive that, it now defers applying an update while any dispatch run is in flight (rechecked
  the next interval), so a relaunch never churns a live run's stream (`server/src/auto-update.ts`).
- **Per-instance desktop shortcuts.** Each row's ⋮ menu on the Instances tab gained
  **Create desktop shortcut**, which drops a launcher on the desktop that opens that one
  instance directly (`Claude --user-data-dir=<dir>`) without going through the manager. On
  Windows it writes a `.lnk` (via `WScript.Shell`) whose target is the STABLE root
  `claude.exe` Squirrel stub, so the shortcut keeps working after Claude Desktop updates to a
  new versioned build, and it takes its icon from the stable `app.ico`; macOS gets a
  `.command` script and Linux a `.desktop` entry. Values are passed to PowerShell through the
  environment (never string-interpolated), and the failure path reuses the same MSIX-aware
  message as Open (`POST /api/instances/:dir/shortcut`, `server/src/core/shortcut.ts`).
- **Rename an instance.** Each row's ⋮ menu on the Instances tab gained **Rename**, which opens a
  dialog (prefilled with the current name) to give a stopped instance a new name, renaming its
  profile folder in place. It runs through the same guards as delete: refused while the instance
  is running, for the protected default profile, for external instances, and on an invalid or
  colliding name (`POST /api/instances/:dir/rename`, `server/src/core/lifecycle.ts`).
- **Live per-instance memory and uptime.** The Instances table's Uptime column now fills in from
  each running instance's process start time, and the former (always-empty) Size column is
  replaced by **Memory**, the summed working set across the instance's whole Electron process
  tree (main plus renderer/gpu/utility children). Both are read from the same `Win32_Process`
  snapshot the table already takes each poll (`WorkingSetSize` plus `CreationDate`), so there is
  no extra process scan.
- **Brand icon everywhere.** The orange CC Manager UI mark is now the browser favicon
  (`web/public/favicon.svg` + a `favicon.ico` fallback) and the tray/taskbar icon. The old
  `misc/Make-Icon.ps1` drew a placeholder violet ">_" tile programmatically; it now rebuilds
  `misc/CCManagerUI.ico` from the committed `misc/CCManagerUI-icon.png` master (re-rendered from
  the favicon), matching the sibling apps' icon-generator convention.
- **Sessions across every Claude Desktop instance, with an instance filter.** Each desktop
  instance keeps per-session metadata whose `cliSessionId` names the CLI transcript in the
  shared `~/.claude/projects` store; the daemon now scans those to label every session with
  its instance (`instance`: an `~/.claude-instances` dir name, "default" for the main
  install, or null for plain CLI). The sidebar shows the instance on each row and gained a
  filter dropdown (All / Default / each instance / CLI-other) that scopes the list
  SERVER-side, before the newest-200 cap, so a quiet instance's older sessions finally
  surface (`GET /api/sessions?instance=`).
- **Open / save the raw session file.** Two transcript-header buttons: one opens the
  session's `.jsonl` with the OS default handler on the daemon's machine
  (`POST /api/sessions/:id/open-file`), the other downloads a copy through the browser
  (`GET /api/sessions/:id/file`, works over remote access too).
- **Favicon.** The app finally has one (`web/public/favicon.svg`).
- **Update remote wired up.** Repository published at `LunarWerxs/ccmanagerui`, so the
  Settings Updates panel checks against something real instead of reporting that updates
  can't be checked.
- **Chat composer on the Sessions tab.** An open transcript now has a message box at the
  bottom, like a chat: type, press Enter, and the message is dispatched to that session
  immediately (a queue item is created and run in one step). Option chips under the input
  (model, effort, permissions, account, working directory) all default to "inherit" and only
  need touching for an override; the working directory defaults to the session's own. A
  Queue button adds the message to the queue instead, and a clock button offers "queue for
  later" presets (15 min / 1 h / 4 h / tomorrow 9:00) plus a date-time picker. Sessions with
  a run already in progress queue new messages instead of double-resuming.
- **Multi-select messaging.** A select toggle above the session list turns rows into
  checkboxes (with select-all over the current filter); the composer then targets every
  checked session, so "send `resume` to five chats" is one message and one click, creating
  one queue item per session, each in its own working directory.
- **Scheduled queue items.** Queue items gained an optional "Run at" time (`not_before`
  column): the scheduler skips them until the time passes, without blocking later items.
  Scheduled cards show a "runs HH:MM" badge; manual Run still fires immediately.
- **Edit queued items.** Non-running queue cards now have an edit button that opens the
  builder dialog prefilled (including the new Run-at field) and saves via PATCH.
- **Live transcript follow.** While the selected session has an active queue run, the
  transcript refreshes on its own (and once more when the run starts or finishes), so
  replies stream into the open chat without pressing Refresh.
- **Per-session run lock.** The daemon now refuses to start a second run against a session
  that already has one active (manual Run returns 409, the scheduler skips to the next
  eligible item), so two `claude --resume` children can never interleave writes to the
  same transcript. The composer treats that 409 as "queued" rather than "failed".
- **Run due (n) button in the queue drawer.** One click dispatches every currently-due
  queued item at once (`POST /api/queue/run-due`). Like the per-card Run button it ignores
  the scheduler's enabled/spacing/concurrency limits, but it honors the per-session lock:
  items whose session is (or just became) busy stay queued and are reported as skipped.

### Fixed

- **Quitting CC Manager UI no longer closes the Claude Desktop instances it launched.** The
  Windows tray host quits by tree-killing the daemon's whole process tree
  (`taskkill /PID <daemon> /T /F`), and instances were spawned as direct children of the daemon,
  so Quit dragged every open Claude instance down with it. Neither `.unref()` nor Bun's
  `detached: true` breaks the Windows process tree; the launch now goes through a `cmd /c start ""`
  hand-off that re-parents the instance out of the daemon's tree, so it survives Quit
  (`server/src/core/instances.ts` `buildInstanceLaunch`, `server/tests/instances-launch.test.ts`).
  macOS already detached via `open`; Linux now spawns with `detached: true` (setsid).
- **The Instances ⋮ "More actions" menu opens again.** Its trigger had been wrapped in a
  tooltip, and the nested `TooltipTrigger`/`DropdownMenuTrigger` (both `as-child`) swallowed the
  click so the menu never opened, while the zero-delay tooltip itself was intrusive. The kebab
  is now a bare dropdown trigger with an `aria-label`: it opens on click, with no tooltip.
- **The Instances refresh icon no longer spins on every poll.** The list silently re-polls every
  4 s and the spinner was tied to that `loading` flag, so it flickered constantly and read as a
  constant spin. Background poll ticks are now silent; the icon spins only on a first load or a
  user-initiated refresh.
- **Instance discovery no longer breaks on profile paths that contain a space.** When an
  instance's `--user-data-dir` has a space (a space in the Windows user name, or a space in the
  instance name itself), `Bun.spawn`/libuv wraps the whole `"--user-data-dir=C:\a b\c"` token in
  quotes, and the previous command-line parser truncated the path at the first space, so the
  running instance was mis-matched (it showed as "stopped" or as a stray external row). The
  `core/process.ts` parser now handles all three quotings (unquoted, value-quoted, and
  whole-token-quoted) — see `tests/process-parse.test.ts`.
- **Composer toasts render as real toasts.** The "Queued N message(s)" confirmation showed as
  bare unstyled text lines: vue-sonner v2 ships its styling as a separate stylesheet that was
  never imported. `main.ts` now imports `vue-sonner/style.css`, so every toast gets its card,
  border, and shadow back.
- **Open drawers no longer cover the header buttons.** The top bar now shares the push-panel
  padding shift with the main content (plus its own 16px), so New run / Queue / theme /
  Settings slide left to stay clickable instead of disappearing under the settings or queue
  drawer.
- **Push panels no longer crush the centered shell (kit-wide).** The settings/queue drawers
  dock to the viewport's right edge, but the content shift now equals only the panel's
  actual overlap with the centered app shell (zero on a wide monitor) instead of the full
  panel width. This removes the dead band that squeezed the Instances table to half size
  and nudged the Sessions placeholder left whenever Settings was opened.
- Built SPA now talks to the daemon over same-origin relative URLs instead of a hardcoded
  `http://localhost:7787`, so the UI keeps working when the daemon port-hops off its preferred
  port. Dev (Vite) behavior is unchanged; `VITE_API_BASE` still overrides both.
- Free-port probe (`find-free-port`) is now loopback-aware: it no longer picks a port that's
  only bound on another interface, closing a race where the daemon could report itself bound to
  a port a different loopback-only process (e.g. `wrangler dev`) was already holding.

### Changed

- **The composer lost its top divider line** (the transcript column stays borderless).
- **Queue moved from a tab to a slide-in drawer.** The queue now opens as a right-side push
  drawer from a header button (with the running-count badge), so the list rides alongside
  the Sessions or Instances view instead of replacing it. Only one drawer (queue or
  settings) is open at a time.
- **Settings split into tabs.** The Settings panel now groups its sections under three tabs
  (General / Scheduler / Accounts) using the shared kit's segmented tab bar, instead of one
  long scroll. General holds appearance, updates, and auto-update; the "Save settings" footer
  stays visible on every tab and still flushes the scheduler form.
- **One Updates group, and it explains itself.** The separate Auto-update section merged into
  the Updates group (the auto-check toggle and interval sit right under the manual check).
  The cryptic "No update source" row now reads "Updates can't be checked" with a visible
  explanation (no Git remote linked; add one or set `CCMANAGERUI_UPDATE_REPO`), and the
  auto-update rows gray out while there is no source to check.
- **Queue resume lives in the queue drawer.** The transcript header's primary button now
  opens/closes the queue drawer; the "Queue resume" action (builder in resume mode) moved
  into the drawer's toolbar next to New run. "Show tool activity" shrank from a labeled
  switch to an icon toggle (pressed = tool events shown), matching the ID button beside it.
- **Multi-select banner is count-only.** "Sending to N sessions" no longer tries to list every
  target's title (they always truncated into noise).
- **Drawer headers/footers lost their divider lines (kit-wide).** The shared panel shell no
  longer draws a border under its title bar or above its footer.
- **Header cleanup**: the scheduler pill left the top bar (its toggle plus counts and interval
  controls already live in Settings → Scheduler); the Queue page now shows a small "Scheduler
  on" chip whenever it's enabled, so auto-dispatch is still visible where it matters. The
  "New run" header button is now a compact plus icon that expands on hover/keyboard focus to
  reveal its label (same pattern as DevWebUI's top bar), and the Queue page title gained an
  info hint explaining what the queue is and that nothing runs by itself while the scheduler
  is off.
- **Default port moved 8787 → 7787.** 8787 collided with both another local dev server and
  `wrangler dev`'s default. Set `PORT` to override; the daemon still hops to the next free port
  if its preferred one is busy and records where it landed in `~/.ccmanagerui/runtime.json`.

### Added

- **MSIX install warning (Instances tab)**: the daemon now detects which Claude Desktop build
  is installed on Windows (`GET /api/desktop-install`, `server/src/core/desktop-install.ts`).
  Anthropic's current download page ships a ~7 MB `ClaudeSetup.exe` bootstrapper that installs
  the MSIX package under the ACL-locked `C:\Program Files\WindowsApps`; that build can't be
  launched with `--user-data-dir`, so instance create/open can't work with it. When only the
  MSIX build (or no Claude Desktop at all) is present, the Instances tab shows a warning
  banner linking the classic ~217 MB Squirrel installer
  (`https://claude.ai/api/desktop/win32/x64/exe/latest/redirect`).
  `CCMANAGERUI_FAKE_DESKTOP_INSTALL` (msix-only | none | ok) forces the detection result for
  dev/testing.
- **Portable mode** — a server-persisted setting (Settings → Appearance → Portable window) that
  opens CC Manager UI in its own chromeless Chromium app window (`msedge`/`chrome --app=`, no
  tabs or address bar) instead of a browser tab. Applies both to the in-app toggle (`POST
  /api/portable-window`) and the desktop tray launcher, which now opens the UI through the
  portable-mode-aware `Open-AppUi` helper. The window gets its own dedicated Chromium profile
  (`~/.ccmanagerui/portable-profile`, `--user-data-dir`) so it remembers its size/position
  across launches instead of sharing the main browser profile; both open paths derive the same
  profile dir from `runtime.json`'s location.
- **MCP stdio server** (`server/src/mcp.ts`, `bun run mcp`) — exposes CC Manager UI's
  sessions/queue/instances API over MCP stdio for use from Claude Code / Claude Desktop.
- **Background auto-update loop** — an opt-in daemon-wide timer that checks the update remote on
  a schedule and, when a newer commit is available and the working tree is clean, pulls +
  reinstalls + rebuilds + self-relaunches so the running daemon stays current unattended. Off by
  default; never touches a dirty working tree.
- Repo hygiene pass to bring the tree up to the standard of its LunarWerx siblings: CI
  (`.github/workflows/ci.yml`, lint + typecheck + build + test on ubuntu/windows), an Architect
  config (`.arkitect/`) with a gating bundle-weight-budget check, an MIT `LICENSE`,
  `.editorconfig`, `bunfig.toml`, and a documented `.env.example`.
