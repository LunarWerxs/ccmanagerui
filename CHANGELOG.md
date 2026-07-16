# Changelog

All notable changes to CC Manager UI are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- **A 529 overload was treated as your rate limit, so the run died instead of retrying.** `529
  Overloaded` means Anthropic's servers are saturated and it clears in seconds; a session limit
  means your own 5-hour allowance is spent and only time fixes it. Both wear the word "limit", and
  `dispatch.ts` matched them with ONE pattern list — so a run killed by a few-second server hiccup
  was filed `rate_limited` and parked against a reset that had nothing to do with it, while the same
  message sent from the desktop app (which just retries) went straight through. They are now told
  apart (`rate-limit-signal.ts`), and a transient overload is **retried automatically** — three
  tries over ~35s, backing off — before it gives up as its own new `overloaded` status, which is
  neither `failed` (nothing is wrong with the run) nor `rate_limited` (your quota is fine). The
  retry only fires when the run produced no output first, so it can never silently re-do work you
  already paid for; it is DB-backed, so a daemon restart mid-backoff resumes rather than forgets;
  and it is deliberately not behind the scheduler or monitor switches, which are off by default and
  govern hours-scale autonomy — this just finishes the run you started ten seconds ago.
  Ambiguous text still classifies as a quota wall, the conservative default. A migration relabels
  rows already mis-filed by the old detector. The auto-resume monitor now only ever sees a genuine
  quota stop, so it can no longer park a 529 against a five-hour reset that was never coming.
- **The composer claimed "this session is busy" the moment you hit send, with nothing running.**
  `submit()` awaits a queue refresh, and the server doesn't answer until the run is already marked
  `running` — so sending a message flipped the banner on within the very same click, and it then
  announced that the message "will queue and start on its own" about one that had just started
  running immediately. The hint now only shows while there is actually a draft it could apply to,
  which is the only time it says anything useful.

- **The auto-resume monitor was blind to every session it hadn't launched itself.** It only ever
  looked at `queue_items` rows with status `rate_limited`, and the only thing that can set that
  status is a run the daemon spawned and tailed — so a session you started yourself (a bare `claude`
  in a terminal, or the desktop app) that died on a 5-hour limit had a transcript on disk, no queue
  row, and no path to the resume list at all. The list said "Nothing to resume right now" while real
  sessions sat at the wall, and hand-queueing them was the only recourse. The monitor now also
  *finds* stops on disk (`rate-limit-discovery.ts`): it checks transcripts touched in the last 12
  hours for the CLI's own limit notice sitting at the tail with nothing after it, which is exactly
  what "still stopped" looks like. Found stops go through the same rails as any other — the weekly
  usage gate, the per-session attempt cap, the resume buffer, the idempotency check — and carry a
  **Found** badge so a session the app went looking for never reads as one you queued. Detection
  reuses `dispatch.ts`'s existing `isApiErrorEvent` gate unchanged, so the 2026-07-15 false-positive
  class (a run that merely *mentions* "quota" or "529") cannot come back at machine scale. Still
  behind the monitor's off-by-default switch.
- **A downloaded transcript was named after the session's UUID, not the session.** `Save a copy` now
  writes `<session title>.jsonl` — falling back to the id only when a title has nothing
  filesystem-safe left in it. One shared `safeTranscriptFilename` (new
  `@ccmanagerui/server/filenames` export) backs both the download link and the server's
  `Content-Disposition`, because the browser honours the link's name only same-origin and the header
  only cross-origin — fixing one alone would have left the other broken. It strips the characters
  Windows rejects, refuses the reserved device names (`CON`, `COM1`…), trims the trailing dots
  Windows drops silently, and sends the header as RFC 5987 `filename*` so an emoji or non-Latin
  title names the file properly instead of throwing on an invalid header value.

### Added

- **Copy the session file to the clipboard.** A new button beside "save a copy" puts the `.jsonl`
  FILE on the clipboard — not its text — so Ctrl+V into a folder, a chat or an email pastes the
  actual file, named after the session rather than its uuid. A web page cannot do this at all (no
  clipboard type maps to a native file-drop, by design), so the daemon does it; Windows and macOS
  only, since Linux has no cross-desktop convention for it.
- **A 10-minute stepper in the composer's "queue for later".** The hours stepper now sits next to a
  minutes one that steps in 10s, and a single button queues the combined delay ("In 1h 30m"). With
  both, the fixed **In 15 min** and **In 1 hour** presets were redundant — 1h is the stepper's
  default and anything shorter is a couple of taps — so they are gone; **In 5 hours** and
  **Tomorrow** remain.

## [0.3.0] - 2026-07-16

### Security

- **Fixed a drive-by remote-code-execution hole in the local API.** The daemon binds localhost and
  its API had no cross-site protection, so any web page you visited while it was running could quietly
  POST to it — queuing a `claude` run with `--permission-mode bypassPermissions`, an attacker-chosen
  prompt and directory, using your own logged-in credentials with no approval prompt — or read your
  session transcripts. The daemon now rejects browser cross-site requests (via `Sec-Fetch-Site` /
  `Origin` / `Host`, which also defeats the "simple request" CORS bypass and DNS rebinding) while
  still allowing the app's own UI, the dev server, and non-browser tools (the tray, MCP clients).
  `permission_mode` is now validated server-side before it can ever reach the CLI.

### Added

- **Real executables on every release.** A tag push cross-compiles self-contained binaries (Bun
  embedded — no install step) for Windows x64, Linux x64/arm64, and macOS x64/arm64, smoke-tests each
  on real hardware for its OS, and attaches them to a draft GitHub release. The binary carries every
  process mode as a subcommand (`--version`, `--mcp`, the detached dispatch runner), keeps state under
  `~/.ccmanagerui/`, serves the SPA from a sidecar `web/dist/`, and the Windows zip ships the tray
  toolkit (no Bun on PATH required).
- **Packaged builds now self-update.** A compiled build checks GitHub Releases, downloads the newer
  platform bundle, verifies the new binary runs before swapping it in place, and relaunches — the
  same Settings check/apply/auto-update controls the source build has. (Source builds still self-update
  via `git`.)
- **Run queued work as any signed-in instance — no token pasting.** The queue's "Run as" picker lists
  every signed-in desktop/CLI instance; the runner extracts that instance's own OAuth token at spawn
  time and fails the run with a clear "signed out?" message rather than silently falling back to the
  ambient login. Signing in on the Instances tab is now how accounts get added — the Settings
  paste-a-token form is gone (existing credentials still work; the raw API remains for headless use).
- **CLI sign-in on every instance row**, from the row's actions menu (create-on-demand when no CLI
  login is linked yet), replacing the single inline table sub-line.

### Fixed

- **Quitting could kill your real Claude Desktop chat.** The External row (the regular,
  non-isolated Claude Desktop) can no longer be quit with one click: the server refuses the
  default profile dir without an explicit confirmation (`confirmExternal`, the quit-side analog
  of Delete's existing guard), and the UI routes it through a warning dialog. The "Browser
  Dance" copy now names ISOLATED instances and says outright that your regular Claude Desktop
  should stay open — the old "quit every other running instance" wording steered a user into
  closing a real conversation.
- **The MSIX warning banner could be flat wrong.** `manageable` now also accepts a LIVE running
  Claude process (carrying `--user-data-dir`) as proof of a working classic install, the
  authoritative `Get-AppxPackage` probe runs (and overrides) when filesystem leftovers from an
  uninstalled MSIX would otherwise pin the verdict forever, the classic binary resolves via the
  stable Squirrel stub first (versioned `app-<ver>` dirs are replaced on every update), and the
  banner re-verifies fresh after any successful open/create and every 60s while visible — so
  "install the classic build" actually clears it once you do.
- **A run pinned to a specific account could silently run as the wrong one.** A queued run pinned to
  an instance whose sign-in had expired, been deleted, or whose reference was malformed used to fall
  back to the ambient login without a word; auto-resuming such a run dropped the pin entirely. Both
  now fail loudly (or carry the pin forward) instead of quietly using different credentials.
- **A queued run's account wasn't shown on its card**, and editing a run whose pinned account had been
  deleted silently reverted it to ambient on save. The card now shows the instance it will run as (or
  "deleted instance"), and the editor shows a clear disabled "deleted instance" option instead of
  quietly changing the run.
- **Deleting a desktop instance could orphan its linked CLI login** into an invisible, unmanageable
  state; a failed "Sign in CLI" left a stray CLI instance behind. Both are cleaned up now.
- **A run recovered after a restart could briefly be double-dispatched** — the scheduler and
  auto-resume monitor could fire before the daemon finished re-adopting runs that survived the
  restart. They now wait for that to complete.

- **A run that merely TALKED about rate limits was marked rate-limited.** The detector matched its
  patterns against every event of a run — tool inputs and tool results included — so an agent that
  grepped for "session limit", or read a file whose line 529 scrolled past, finished as
  `rate_limited` despite exiting 0 with the job done. (Both such rows in the shipped database were
  this; `\b529\b` had matched a line number.) Only the CLI's own report counts now: a synthetic
  API-error message, an errored terminal `result`, or stderr — never model prose, tool inputs, or
  tool results. Runs already mislabeled this way are repaired on startup, along with the auto-resume
  bookkeeping that existed only to babysit them.
- **The auto-resume monitor did nothing at all unless you had added an account.** A run with no
  dispatch account — the default, since the accounts table is empty until you paste a token in — was
  parked at "needs you — no dispatch account on the run" on sight, on the grounds that its usage
  couldn't be gated and its auth couldn't be injected. Neither was true: an ambient run uses the
  login `claude` already has, which needs no injection to resume and whose quota reads straight from
  its config dir (the same read `check_my_usage` already did). Ambient runs now go through the usage
  gate like any other, so the monitor actually resumes them.
- **Sending a message opened a console window that stayed on screen for the whole run.** The detached
  runner is created through WMI, which applies default startup info — so `bun` (a console app) got a
  real, visible window; the daemon's own `windowsHide` only ever covered the short-lived PowerShell.
  Beyond the eyesore, closing that stray window killed the runner and `claude` mid-turn, and the run
  then finalized as a bare "failed, exit -1". It is created hidden now.
- **The session view showed conversation the CLI was having with itself.** Resuming a session whose
  last turn died on an API error makes `claude` append a canned "Continue from where you left off." /
  "No response requested." pair — same millisecond, no model call. Rendered as real turns they read
  as though a prompt had been sent and refused. They're filtered; the rate-limit notice, the one
  synthetic message that explains anything, still shows.
- **"exit -1" now says what it means.** It is our own code for "the process vanished before it
  finished" — never something `claude` reported — and the paths that produce it recorded nothing to
  say so. They now explain themselves, and the badge reads "interrupted" instead of a number nobody
  can look up. Transcribing an event can also no longer throw and take the tail loop down with it.

### Changed

- **Finished runs fold away in the queue.** Completed, failed, canceled, and rate-limited items move
  behind a "Show N finished" disclosure instead of crowding the list, and the header counts what is
  still pending rather than the all-time total. The per-item card moved to `QueueItemCard.vue`.
- **The composer's busy warning says what will happen to your message.** It stated a rule ("a session
  with a run in progress gets its message queued instead of sent") and left you to guess whether the
  message was about to run or stuck. It now says which — start on its own when the current run
  finishes, or wait for you to press Run when the scheduler is off — and why two runs can't share a
  session.
- **Queuing a run resumes a session from a searchable list instead of a pasted UUID.** The run
  builder's "session to resume" field is now a searchable picker over the same session list the
  sidebar shows (sorted most-recently-active first), each row carrying the friendly title, its
  folder/branch/last-activity, and the opaque id tucked to the side (click it to copy). It supports
  multi-select: pick several sessions and one queued run is created per session, sharing the same
  prompt and options. A new `SessionPicker.vue` backs it.
- **The run builder leads with three fields, not thirteen.** Model, effort, permission, account,
  run-at, fork, and the resume title/folder overrides now live behind an "Advanced options"
  disclosure; the common path is just the session (or new-chat title + folder) and the prompt. The
  "New chat from scratch" toggle is hidden when editing an existing item (editing never converts a
  run's kind). Long prompts no longer push the dialog off-screen — the prompt box caps its height and
  every dialog now scrolls instead of overflowing the viewport.
- **Settings is one scrolling page.** The General / Scheduler / Accounts tabs were merged: Accounts
  is now a section rather than a tab, and Scheduler folds in with everything else. "Show desktop /
  CLI instances" moved from Usage to Appearance (it's a display choice). The auto-resume monitor's
  tuning numbers (max attempts, resume buffer) moved behind an Advanced disclosure and, along with
  the monitored-runs list and per-account overrides, collapse away entirely when the monitor is off.
  The monitor's empty state now explains that a run only appears there after it stops on a rate limit
  (an empty list doesn't mean monitoring is off). A deep link (the composer's "tomorrow" gear) now
  scrolls to the Scheduler section instead of switching a tab.
- **The queue toolbar's scheduler indicator is an icon with a hover, not a text pill**, and shows
  both on and off states at a glance. The redundant "Queue resume" button was removed — "New run"
  already opens the builder in resume mode.

### Added

- **A quota percentage is now quantified into something you can plan with.** "98% used" is not a
  decision: 98% with a reset in 20 minutes is fine, while 98% with a reset in four days at 1%/hour
  means being cut off mid-task in about two hours. Same number, opposite action. Anthropic publishes
  no quota size (`limit_dollars` / `used_dollars` / `remaining_dollars` are all null on a
  subscription, and there are no token counts anywhere in the response), so the numbers are derived
  instead. `server/src/usage-history.ts` keeps the readings the background sweep already takes and
  differentiates them into a burn rate, an hours-of-headroom figure, and `exhaustsBeforeReset`, the
  one field that actually decides anything. `server/src/usage-tokens.ts` counts what was really spent
  from the Claude Code transcripts (which do carry exact per-turn token counts and the model), and
  `server/src/usage-budget.ts` divides one by the other to MEASURE the size of one percent in tokens,
  reported as "~N more assistant turns" because an agent can reason about turns but cannot predict its
  own raw token totals. New `usage_budget` MCP tool and `GET /api/usage/budget`.
- **The usage MCP tools now work with the app closed.** `check_my_usage`, `list_usage` and
  `usage_budget` need nothing the daemon uniquely owns (the OAuth tokens are files on disk, the quota
  endpoint is a plain HTTPS GET, the transcripts are local JSONL), so when the daemon is not running
  they execute in-process instead of failing. The queue and dispatch tools deliberately do not get
  this: they mutate shared sqlite state and supervise real processes, where a second uncoordinated
  executor would be a correctness bug, so they still fail loudly and say why.
- **Usage checks now hit the quota endpoint directly instead of spawning `claude`.** The CLI's own
  `/usage` screen is just a GET against `https://api.anthropic.com/api/oauth/usage`, Bearer-authenticated
  with an OAuth access token; calling it ourselves (`server/src/usage-api.ts`) skips booting the
  ~250 MB Bun-compiled `claude` binary entirely. Measured on one machine: the old spawn path took
  9,353 / 9,262 / 9,218ms per check, the direct GET took 372 / 424 / 169ms, roughly 25 to 50x faster.
  It is also richer than the text screen: `resets_at` is a real ISO-8601 timestamp (the text screen
  prints a yearless human string like "Jul 19, 3:59am"), `severity` (normal/warning/critical) is
  computed server-side instead of guessed from a threshold, and a per-model weekly sub-limit carries
  its own name via `scope.model.display_name`. Reading usage costs no quota: it is a read, not an
  inference call. The `claude -p "/usage"` spawn remains as a fallback for the cases the direct path
  can't serve: no OAuth token in hand, an account configured with an API key instead (the endpoint is
  OAuth-only), or the server rejecting the token with 401 (expired); the daemon deliberately does not
  refresh the token itself, since rotating the user's refresh token could break their real login, so an
  expired token falls back to the CLI's own refresh instead.
- **CLI instances can be linked to a desktop instance.** `CliInstance.associatedDesktopDir` records
  that a CLI instance and a desktop instance are the same Anthropic account under two independent
  logins, so each can serve as the other's usage-check fallback when one token is expired or missing:
  a desktop instance's chain is its own token, then a linked CLI instance's login, then a dispatch
  account matching the email; a CLI instance's chain is its own login, then an associated dispatch
  account, then a linked desktop instance's token. New `link_cli_instance_to_desktop` MCP tool.
- **Background auto-refresh of usage, on by default.** A staggered sweep keeps every instance's usage
  number warm without a manual refresh, skipping any instance with no usable credential up front. Each
  check costs about 300ms and no quota, so polling on a loop is no longer the liability it was when it
  meant spawning `claude`. Toggle and interval live in Settings → General, alongside separate toggles to
  show or hide the desktop and CLI instances tables.
- **Usage responses carry an `advice` verdict.** Every usage check (`check_usage`, `check_my_usage`,
  `list_usage`, the UI's usage cell) now includes `{ severity, bindingPct, shouldOffload, safeToFanOut,
  advice }` alongside the raw percentages, so a caller does not have to re-derive "is this bad" from
  thresholds itself. `shouldOffload: true` means the caller is close to being cut off mid-task.
- **`check_my_usage` now works from a normal Claude Code session, not only a CLI instance.** It falls
  back to the default `~/.claude` login when `CLAUDE_CODE_CONFIG_DIR` / `CLAUDE_CONFIG_DIR` is unset,
  which previously made the self-check error out for the everyday case of the session the user is
  actually talking to. New `list_usage` MCP tool surveys every managed instance (desktop and CLI) at
  once, each with its own `advice` verdict, for picking an account with headroom before routing heavy
  work.
- **A CLI login is now a usable usage-check source in its own right.** `<CLAUDE_CONFIG_DIR>/.credentials.json`
  is plain JSON (`claudeAiOauth.accessToken` plus `.scopes`, no DPAPI/safeStorage layer), so a CLI
  instance that has run `/login` gives a usage-capable token directly, independent of any desktop
  instance.
- **CLI instances.** A CLI instance is a `CLAUDE_CONFIG_DIR` associated with an account and logged in
  once, the command-line counterpart to a desktop instance (which isolates via `--user-data-dir`).
  The Instances view now manages them alongside desktop instances: create one (the app makes its
  config dir), open a terminal to use it, a one-click "Log in" helper that opens a terminal for you to
  run `/login` (the app never performs the login itself), associate it with a dispatch account, rename,
  and a guarded delete. Persisted as plain JSON under `~/.ccmanagerui`, never a token.
- **Usage-check subsystem.** Read an account's remaining Claude subscription quota (session 5-hour %,
  weekly all-models %, and per-model weekly %) by running `claude -p "/usage"` with the account's auth
  injected. A DESKTOP instance is polled using its OWN decrypted OAuth token (never persisted), so it
  works with no dispatch account and no CLI login; a registered dispatch account or a logged-in CLI
  instance also work. The desktop token cache holds two grants (a full CLI grant and a profile-only
  grant); the usage path deliberately selects the `user:inference`-scoped grant, since the profile
  grant runs `/usage` but returns no numbers. The probe also sets `CLAUDE_CODE_OAUTH_SCOPES` from
  that grant: without it `claude` quietly stops treating `/usage` as a command and prints a cost
  summary with no percentages, which only shows up when the daemon runs outside a Claude Code
  session (for example the tray, launched from Explorer). Surfaced three ways: a per-row usage cell in the
  Instances table (the binding weekly % color-coded, with a hover breakdown), a `check_usage` MCP
  tool, and a `check_my_usage` self-check any agent can call. Checks are on demand (each spawns a real
  `claude`) and cached with an age; a no-data result shows "—" with a reason rather than silently.
- **AI self-check guidance.** `docs/AI_USAGE_SELFCHECK.md` plus a README note teach agents that they
  can read their own quota and that the weekly all-models % is the binding cap to pace by.
- **Auto-resume monitor (opt-in, off by default).** A session killed mid-work by a 5-hour rate limit
  can auto-resume once the window clears, gated on the weekly cap not being maxed. Detection reuses the
  existing structured `rate_limited` run status; a resume is a normal queued `--resume` run scheduled
  for just after the reset. Safety rails: a per-session resume cap, idempotent scheduling, a global
  switch plus per-account overrides, and a status chip ("resumes ~HH:MM" / "blocked: weekly maxed" /
  "needs human"). Settings and `get_monitor` / `set_monitor` MCP tools expose it.

## [0.2.0] - 2026-07-13

### Added

- **Per-instance icon and color.** Every row in the Instances table now shows a customizable glyph
  in place of the old green status dot. An "Edit" action (in the row's ⋮ menu) lets you pick an icon
  from a curated set and a color from a fixed palette, with a live preview; a running instance keeps
  a small pulsing badge on the icon's top-right corner, and a stopped one dims. Instances you have
  not customized get a stable, distinct default derived from their folder, so the table reads at a
  glance.

### Changed

- **An instance is named after the account it is signed into, not the folder it lives in.** The
  folder name was only ever a guess at the identity, and it stops being true the moment a profile is
  signed into an account other than the one it was named after — nothing prevents that drift and
  nothing corrects it. On the machine this was built against, the folder called `claude` was signed
  into `6claude@lunarwerx.com` and had been reading as "claude" the whole time, while two other
  instances had been hand-relabelled to their accounts precisely to paper over the same problem. So
  the resolved account's name (its profile name, else the local part of its email) is now the
  default, ahead of the folder name; an explicit label you set still wins over both, and the folder
  name remains the last resort for an instance with no resolved identity. The dir is still shown
  under each name, so two profiles on one account stay distinguishable. `SessionsView` reads the
  same shared instance list rather than fetching its own, so a session's instance chip and the
  Instances table can no longer disagree about what the same instance is called.
- **Accounts resolve themselves; the "Resolve" button is gone.** Resolving reads `config.json` and
  the token cache off disk, so a stopped instance resolves exactly as well as a running one — but
  auto-resolution was gated on `isRunning`, which meant a stopped instance sat there offering a
  button that would have worked on the first click, every time. That is a chore, not a choice. Every
  instance now resolves on its own, running or not, and an instance with no identity yet (logged
  out, offline) is retried once a minute so signing one in surfaces without a restart. The inline
  button and its ⋮ entry are both removed; the toolbar's Refresh now force-re-resolves every account
  live, which is the only case a manual action was ever good for (a stale cached identity). Resolving
  no longer marks the row busy — it changes nothing about the instance, and flagging it made the
  row's buttons flicker un-clickable whenever a background resolve was in flight.
- **The Instances table's quota numbers stay current while you watch them.** The background sweep
  refreshes the server's usage cache every 15 minutes, but the UI only ever pulled that cache once,
  on mount — so an open Instances tab kept showing its first reading and went quietly stale for as
  long as you left it open. It now pulls on the same 4-second cycle the instance list already
  refreshes on, measured firing in lockstep with it. This is a read of the server's own cache: no
  probe, no `claude`, no request to Anthropic, and no quota spent — so there was no reason to do it
  once and hope. The "Refresh all usage" tooltip no longer claims each check "spawns a real claude
  process", which stopped being true when checks became a direct ~300ms API read.
- **Fewer rules on the Instances screen.** The two tables abutted, separated only by a hairline
  sitting flush against the desktop table's last row, which read as one continuous table whose last
  rows happened to have different columns. They are now separated by space instead, and both section
  toolbars lost their bottom border — the sticky table header immediately below each one already
  draws that line, so the second rule was weight for nothing. This matches Sessions, Queue, and the
  app header, which were borderless already. The row separators stay; they are the ones doing work.
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

- **A burn rate of "zero" no longer means "work freely".** The reported percentage is an INTEGER, so a
  burn of 0.8%/hour does not tick the number for over an hour. The first cut of the forecast measured
  that flat stretch, concluded the burn was zero, and reported "you will never hit the cap" while
  sitting at 98% used. That is a false green light, the single most expensive way the feature can be
  wrong, since an agent keeps working and is cut off mid-task holding unsaved context. The burn rate is
  now a RANGE: a measured delta of `d` could truly be as much as `d + 1` given integer rounding, so the
  upper bound is `(d + 1) / hours`, which is always above zero. Every derived figure (`headroomHours`,
  `exhaustsAt`, `exhaustsBeforeReset`, and the token budget's denominator) is computed from that upper
  bound, making the forecast deliberately pessimistic. The asymmetry is the point: a needless warning
  costs a moment of caution, a false green light costs the whole task. The measurement floor also rose
  from a 20-minute to a 45-minute span, below which an integer percentage simply cannot resolve a slow
  burn and the answer is honestly reported as unknown rather than as zero.
- **Rebuild.bat could leave a STALE daemon serving old code while reporting success.** It found the
  daemon solely by the port recorded in `~/.<app>/runtime.json`; with that pointer missing it printed
  "App does not appear to be running", killed nothing, and relaunched the shortcut, which no-ops
  against the tray's single-instance mutex. Nothing then checked the outcome, so the build was fresh on
  disk while the process serving it was hours old (found in the wild at 10h39m). The pointer is now
  only a hint: `misc/Restart-Daemon.ps1` probes every bun/node listener's `/api/health` and stops only
  processes that identify themselves as this app (`service` === package.json `name`, the same contract
  the single-instance guard uses), which both finds an orphan the pointer forgot and cannot kill a
  sibling app. `misc/Wait-Daemon.ps1` then asserts the daemon now answering actually started AFTER the
  restart, because "the daemon is up" proves nothing when the stale one was up the whole time.
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
