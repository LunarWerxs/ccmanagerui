# CC Manager UI — CLI Instances + AI Usage-Check subsystem (plan + live work-log)

> **What:** extend CC Manager UI beyond DESKTOP-only instance management so each account can also
> have a first-class **CLI instance** (add / launch / associate / manage), AND add a **usage-check
> subsystem** so any AI (or the UI) can read an account's remaining quota — surfaced as an MCP tool,
> a UI column, and a self-check the AI can call about its own account.
>
> **Author:** Claude (Fable 5) for Michael / LunarWerx — 2026-07-14.
> **Repo:** `D:\PublicProjects\ccmanagerui` (Bun + Hono daemon + Vue 3 + shadcn-vue + `lunarwerx-ui` kit).
> **Relationship to `PLAN.md`:** that plan grafted DESKTOP multi-instance management (done). THIS is the
> next feature layer (CLI instances + usage). Independent doc so the two don't tangle.

---

## ⛑️ RESUME PROTOCOL — read this first if you are a fresh session picking up

This work is being done on an account near its **weekly quota cap** (~97.5% used, resets ~2:59am
2026-07-14 America/Chicago). It may die mid-task. To continue:

1. Read this whole file. The **Progress log** at the bottom has the "YOU ARE HERE" pointer + the last
   commit hash. Everything above it is settled design; you do not need to re-explore the repo.
2. `git -C D:\PublicProjects\ccmanagerui log --oneline -5` to see where the last session stopped.
3. Pick up at the first unchecked `[ ]` in the **Implementation checklist**. Work top-down.
4. After each meaningful increment: update the Progress log, commit by explicit path, and (if you can)
   check your own remaining quota first via the mechanism in §5 so you pace correctly.
5. Verify on Windows with runtime evidence (`bun run check`, `bun run typecheck`, `bun test`, and run
   the daemon) before marking a step done — this repo's bar is runtime-proven, same as its PLAN.md.

---

## 1. The core architectural insight (do not lose this)

An account has **TWO independent auth stores**, and CC Manager UI currently only models the first:

| | Desktop instance | **CLI instance (new)** |
|---|---|---|
| Isolation lever | Electron `--user-data-dir=<dir>` | **`CLAUDE_CONFIG_DIR=<dir>`** |
| Credential file | Electron safeStorage (`oauth:tokenCacheV2`, DPAPI-sealed) | `<dir>\.credentials.json` |
| Login | Desktop app sign-in | one-time `claude` → `/login` (or `claude setup-token`) per dir |
| What manages it today | `core/instances.ts`, `core/accounts.ts` (decrypts token → email/plan/tier) | **nothing yet** |

**They are different logins even for the same account.** A desktop instance being signed in as
`x@y.com` does NOT log the CLI in as `x@y.com`. So a "CLI instance" = a `CLAUDE_CONFIG_DIR` directory
associated with an account, logged in once. (Verified first-hand 2026-07-14: pointing
`CLAUDE_CONFIG_DIR` at an empty dir makes `claude` look there, find no creds, and return blank usage.)

**Open design question / first spike (§7-Q1):** `dispatch.ts` already spawns `claude` for queue runs
with per-account auth ("dual-auth env injection", `accounts` sqlite table). Determine whether that
injection authenticates a `claude -p "/usage"` call directly (→ usage-check can reuse dispatch auth and
NO separate CLI login is needed — best case), or whether it relies on a config dir (→ CLI instances get
their own `CLAUDE_CONFIG_DIR`). This single answer decides how §3 and §4 are wired. Resolve it before
building the usage tool.

---

## 2. Current repo state (so you don't re-explore)

- **Daemon:** Hono on `127.0.0.1` (port from `config.ts`, default 7787). `server/src/index.ts` mounts routes.
- **MCP server:** `server/src/mcp.ts` — `bun run mcp`. 16 tools today: list/get/tail_session, list/add/
  update/run/cancel_queue_item, get_run_events, list_accounts, get/set_scheduler, **list_instances,
  launch_instance, quit_instance**, check_update. **No usage tool exists** — this is where `check_usage` lands.
- **Instance model:** `core/instances.ts` (discover/launch/quit desktop instances), `core/lifecycle.ts`
  (create/guarded-delete), `core/accounts.ts` (decrypt desktop OAuth token → `CMAccount` {email, plan,
  tier, rateLimitTier}; identity-only cache in `instances-cache.json`, never persists tokens),
  `core/instance-meta.ts`, `core/paths.ts`, `core/process.ts`.
- **CLI dispatch:** `dispatch.ts` + `dispatch-runner.ts` + `detached-spawn.mjs` — spawns `claude` DETACHED
  (daemon never spawns claude directly — deliberate safety design), `--print --output-format stream-json
  --verbose`. This is the pattern the usage probe should imitate.
- **Auth store:** sqlite `accounts` table = Anthropic auth secrets for queue dispatch (separate from the
  instance-identity JSON cache). `core/crypto/*` = per-OS safeStorage (win DPAPI via bun:ffi).
- **Web:** Vue 3 SPA, shadcn-vue `ui/*` components, `lunarwerx-ui` kit shell. Views nav in `App.vue`
  (Sessions / Queue / Instances). i18n-structured (`en/*` namespaces).

---

## 3. Feature A — CLI instances as first-class managed objects

Model a CLI instance and give it the same lifecycle verbs the desktop instances have.

- **Data model** (`server/src/types.ts` or `types-instances.ts`): `CliInstance { id, name, configDir,
  associatedAccountEmail?, associatedDesktopDir?, loggedIn: bool, lastUsageCheck?: UsageSnapshot }`.
  Persist in the JSON config store under `CONFIG_DIR` (`~/.ccmanagerui/cli-instances.json`) — NOT sqlite
  (mirror the instance-identity cache split; no schema migration).
- **Core** (`server/src/core/cli-instances.ts`): `listCliInstances()`, `createCliInstance(name)` (mkdir the
  `CLAUDE_CONFIG_DIR`, mark loggedIn=false), `isLoggedIn(dir)` (Test-Path `.credentials.json`),
  `launchCliInstance(dir, {prompt?, model?, effort?})` (spawn `claude` with `CLAUDE_CONFIG_DIR=dir` via the
  existing detached-spawn path — reuse dispatch's spawner), `associate(dir, account)`, `deleteCliInstance(dir)`
  (guarded, confirmName like desktop).
- **Login is the user's step** (a password/OAuth login — an AI must never perform it). The app can only
  (a) create the dir, (b) detect logged-in state, (c) surface a one-click "Open a terminal to log in"
  helper that runs `CLAUDE_CONFIG_DIR=<dir> claude` for the user to `/login`.
- **Routes** (`index.ts`): `GET /api/cli-instances`, `POST /api/cli-instances` (create),
  `POST /api/cli-instances/:id/launch`, `POST /api/cli-instances/:id/associate`,
  `DELETE /api/cli-instances/:id`, `GET /api/cli-instances/:id/usage` (see §4).
- **UI** (`web/src/views/InstancesView.vue` or a sibling `CliInstancesView.vue` + nav tab): show CLI
  instances in a sortable kit `Table` — ● loggedIn · Name · Account · configDir · Last usage (session% /
  week%) · Actions (Launch / Log-in helper / Associate / Delete). Consider a UNIFIED Instances view that
  groups Desktop + CLI per account (the mental model the owner wants: "per account, its desktop + CLI").
  i18n namespace `en/cli-instances.ts`.

---

## 4. Feature B — the Usage-Check subsystem (the marquee piece)

**Foundation module** `server/src/usage.ts` (pure + testable):
- `type UsageSnapshot = { account?: string; session: {pct:number, resets:string}; weekAll:
  {pct:number, resets:string}; weekModel?: {label:string, pct:number}; capturedAt:string; source:'cli' }`.
- `parseUsageOutput(raw: string): UsageSnapshot` — regex the `/usage` text block (see §5 for the exact
  shape). **Ship a unit test with a captured fixture** (paste a real `/usage` block into
  `server/tests/usage.fixture.txt`) — this is the safe, self-contained FIRST brick; it needs no auth.
- `checkUsage({configDir?} | {accountAuth?}): Promise<UsageSnapshot>` — spawn `claude -p "/usage"` with the
  right auth (per Q1: `CLAUDE_CONFIG_DIR=configDir`, OR reuse dispatch's account auth injection), capture,
  parse. Windows: NEVER go through Git Bash (MSYS mangles `/usage`→`C:/Program Files/Git/usage`); spawn
  the binary directly with an args array, or use PowerShell. Value-blind: only the usage numbers surface,
  never a token.
- Optional: cache the latest snapshot per account (TTL ~a few min) so a UI poll doesn't spam `/usage`.

**MCP tool** (`server/src/mcp.ts`) — the owner's explicit ask:
- `check_usage { account?: string, configDir?: string }` → returns the `UsageSnapshot` JSON. If neither arg
  given, resolve "the caller's own" account if determinable (see self-ID below), else error asking which.
- Add its schema next to `list_instances`; wire the handler to `usage.ts`.

**AI self-check + desktop self-identification** (the owner's stretch idea):
- Any AI can already call `check_usage` with its own account/email. The refinement: let a running context
  self-identify. For a CLI session, `process.env.CLAUDE_CONFIG_DIR` IS its identity → a `check_my_usage`
  tool (or `check_usage` with no args) reads that env and reports its own quota. For a desktop-hosted
  session, map the running app's `--user-data-dir` back to the instance (the manager already knows
  instance→account). Note as a stretch: a desktop Claude app determining "which instance am I" so it checks
  the right quota — feasible because CC Manager already holds the instance→account map; expose a resolver.
- **Binding-cap rule to encode everywhere:** the WEEKLY (all-models) % is the real ceiling; the fresh
  5-hour session % is a red herring when weekly is near 100. Route heavy work to the account with the
  lowest weekly %. Switching flagship model (Fable↔Opus) does NOT dodge the all-models weekly bucket.

---

## 5. The proven self-usage mechanism (reference — from the 2026-07-14 session)

Any AI on this machine can read its OWN account's quota **without asking the human** (there is no `claude
usage` subcommand and `/usage` is REPL-only — `-p "/usage"` in print mode is the only non-interactive route):

```powershell
# PowerShell (NOT Git Bash — MSYS mangles the /usage arg). Value-blind: only usage numbers surface.
& claude -p "/usage" *> "$env:TEMP\usage.txt"; Get-Content "$env:TEMP\usage.txt"
# multi-account: prefix with  $env:CLAUDE_CONFIG_DIR = "<per-account dir>"  (dir must be /login'd once)
```

Output shape to parse (`parseUsageOutput` targets these lines):
```
Current session: 0% used · resets Jul 13, 11:49pm (America/Chicago)
Current week (all models): 97% used · resets Jul 14, 2:59am (America/Chicago)
Current week (Fable): 89% used · resets Jul 14, 3am (America/Chicago)
```

A working cross-account dashboard already exists at `%USERPROFILE%\.claude-cli\usage-all.ps1` (polls
`~/.claude` + every `~/.claude-cli/<name>` subdir; prints Account / Session% / Week(all)% / Week(model)% /
resets). CC Manager UI should absorb this capability natively (the `check_usage` MCP tool + a UI column
supersede the standalone script).

---

## 6. Feature C — teach the AI it CAN self-check (instruction surface)

- Add a short section to `README.md` (near the MCP section) documenting the `check_usage` tool and that an
  agent should check its own quota before heavy multi-agent work.
- Ship a repo instruction snippet (e.g. `docs/AI_USAGE_SELFCHECK.md` or a CLAUDE.md note) that any agent
  operating THIS repo reads: "you can call `check_usage` / run the mechanism in §5 to see remaining quota;
  the weekly all-models % is the binding cap; pace accordingly." The owner wants this baked in so agents
  self-pace instead of blindly fanning out.

---

## 6A. Feature D — Usage in the Instances table (owner ask 2026-07-14)

Surface each account's live quota in the Instances table, reusing `checkUsage` (§4). Owner UI
**preference** (implement as stated, don't "improve"): a CONDENSED cell — full detail won't fit — with a
HOVER overlay for the breakdown.

- **Cell (condensed):** the BINDING number = weekly all-models % (`bindingWeeklyPct`), color-coded
  (green <70 · amber 70–90 · red >90), e.g. `97% wk`, with a small staleness dot when the snapshot is old.
- **Hover popover (kit `Popover`/`Tooltip` — reuse, never hand-roll):** the full breakdown — Session (5h)
  % + reset · Week (all models) % + reset · Week (Fable/model) % + reset · "checked <relative time>".
- **Refresh model:** on-demand, NOT auto-poll (each check spawns a real `claude -p "/usage"` per account).
  Mirror the existing "Resolve accounts" pattern — a per-row "Check usage" action + a toolbar "Refresh all
  usage" (SPACED, sequential; don't stampede). Cache the last `UsageSnapshot` per account (persist alongside
  the account/cli-instance JSON with `lastUsageCheck`); show its age; manual refresh re-checks.
- **No-data honesty:** `isNoData` snapshots render "—"/"unknown", never "0%".
- Routes already planned: `GET /api/instances/:id/usage` (desktop) + `GET /api/cli-instances/:id/usage` (§3/§4).

## 6B. Feature E — Auto-resume monitor (rate-limit watchdog) (owner ask 2026-07-14)

A toggle so a mid-work session killed by a **5-HOUR** rate limit auto-resumes once the window clears — sleep
through a limit, wake to finished work. **GATED on the weekly cap not being maxed.**

**Resume = a dispatched `claude --resume <session-id>` run carrying a LOCKED prompt** (default
`DEFAULT_RESUME_PROMPT = "resume"`, a code constant users don't casually edit), scheduled for just after the
5-hour reset via the existing queue + `scheduler.ts` (concurrency/spacing already solved). Reuse dispatch;
build no new spawner.

**Detection — two surfaces, primary is the reliable one (owner said transcript-tail; UPGRADE to structured):**
- **Primary — dispatched runs (structured, reliable):** when the app's OWN dispatch exits on a rate limit,
  record it in `run_events` as `rate-limited` + `resumable`. Structured signal, not log-scraping.
- **Secondary — interactive/desktop sessions (best-effort):** scan a transcript's TAIL for the rate-limit
  signature (the last message is the limit notice). Fuzzier; gate behind the same Q4 signature.

**The 5-hour-vs-weekly guardrail (the crux):** on a detected rate-limited stop, `checkUsage` the account —
- Resume ONLY if `weekAll.pct < 100` (else resuming just slams the weekly wall; skip, optionally re-arm for
  the weekly reset).
- Schedule the resume for `session.resets` (the 5-hour reset from `/usage`) + a small buffer.
- Weekly IS maxed → do not resume; surface "blocked: weekly maxed, resets <time>".

**Safety rails (auto-prompting while the user sleeps — must be tight):**
- Resume a session AT MOST N times (default ~3) via a `resume_attempts` counter; past N → stop + mark
  "needs human" (no infinite resume loop on a genuinely stuck task).
- Idempotent — never double-queue a resume for a session that already has one pending.
- Only sessions MID-WORK at the limit (not user-ended/completed) — part of Q4 detection.
- Respect scheduler spacing so monitored sessions don't stampede at the reset instant.
- Toggle scope: GLOBAL switch + optional PER-ACCOUNT override. **Off by default.**

**Where it lives:** `server/src/monitor.ts` (or extend `scheduler.ts`): a poll loop — find resumable stops →
usage gate → schedule resume → track attempts. Config + state in the existing sqlite (a `monitor` settings
row + `resume_attempts`); reuse, no new store.

**UI:** an "Auto-resume monitor" switch in Settings (global) + a per-account switch in the Instances table;
a status chip on affected rows ("waiting → resumes ~HH:MM" / "blocked: weekly maxed" / "needs human"). i18n.

## 7. Open questions / spikes (resolve as you reach them)

- **Q1 (blocking §4):** does `dispatch.ts` account auth injection authenticate a bare `claude -p "/usage"`
  (reuse it → no separate CLI login), or is a `CLAUDE_CONFIG_DIR` login required? Read `dispatch.ts` +
  `dispatch-runner.ts` + how the `accounts` sqlite auth is injected into the spawn env. **✅ ANSWERED
  2026-07-14:** `dispatch-runner.ts` → `buildChildEnv()` reads `select auth_type, secret from accounts
  where id=?`, clears inherited `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN`/`CLAUDE_CODE_OAUTH_TOKEN`, then
  sets `ANTHROPIC_API_KEY` (api_key) or `CLAUDE_CODE_OAUTH_TOKEN` (oauth) from the secret. So auth is
  **ENV-VAR injected, not `CLAUDE_CONFIG_DIR`** → `checkUsage` reuses this exact pattern: spawn
  `claude -p "/usage"` with `CLAUDE_CODE_OAUTH_TOKEN=<secret>`, and ANY account in the `accounts` table is
  pollable with NO separate CLI login. `CLAUDE_CONFIG_DIR` stays the fallback for unregistered accounts.
- **Q2:** unified Instances view (desktop+CLI grouped per account) vs a separate CLI tab? Owner leans
  unified ("per account, its associated CLI/desktop"). Confirm with a quick mock before building the view.
- **Q3:** usage snapshot caching TTL + whether to auto-poll in the UI (cost: one `/usage` call per account
  per poll). Suggest on-demand + manual refresh first; no background poll.
- **Q4 (blocking §6B detection):** the EXACT rate-limit signature. Capture a REAL rate-limited dispatch
  (the stream-json error type/message) AND a real interactive rate-limit transcript tail; record both here.
  Never hardcode the wording from memory — it drifts. Must also distinguish a 5-hour-window limit from a
  weekly limit if the message differs. **Answer:** _TBD_
- **Q5 (§6B resume):** confirm the resume invocation — `claude --resume <session-id> -p "<prompt>"` (vs
  `--continue`) — works for BOTH dispatched and interactive/desktop sessions, and authenticates via the same
  env-token path as dispatch (§7-Q1). **Answer:** _TBD_
- **Q6 (§6A):** usage-refresh cadence in the table — confirm on-demand + manual refresh + cached snapshot
  (with age) is acceptable; no background poll (each check spawns a `claude` process). **Leaning:** yes.

---

## 8. Implementation checklist (work top-down; 🔵 = main-loop integration · 🟢 = delegable)

1. [x] 🔵 **Spike Q1** — traced; answer in §7-Q1 (auth = env-var token injection, reusable). ✅ 2026-07-14.
2. [x] 🟢 **`server/src/usage.ts` + `parseUsageOutput` + unit test** — pure parser + `bindingWeeklyPct`/`isNoData`, 4/4 tests green (`server/tests/usage.test.ts`). ✅ 2026-07-14.
3. [ ] 🔵 **`checkUsage()`** spawn+capture, per Q1's answer (reuse dispatch auth OR `CLAUDE_CONFIG_DIR`). Windows-safe spawn (no Git Bash).
4. [ ] 🔵 **MCP `check_usage` tool** in `mcp.ts` → `usage.ts`. Verify via `bun run mcp` + a manual tool call.
5. [ ] 🟢 **`core/cli-instances.ts`** model + list/create/isLoggedIn/launch/associate/delete + JSON persistence.
6. [ ] 🔵 **Routes** for cli-instances + `GET /api/cli-instances/:id/usage` on the Hono app.
7. [ ] 🟢 **`lib/api.ts` + `useCliInstances` composable** + `en/cli-instances.ts` i18n.
8. [ ] 🟢 **UI:** CLI instances in a (ideally unified) sortable Instances table + "Last usage" column + Launch/Login-helper/Associate/Delete.
9. [ ] 🔵 **Self-ID / `check_my_usage`** (env-based for CLI; instance-map resolver for desktop). Stretch.
10. [ ] 🔵 **Feature C docs** — README MCP section + `AI_USAGE_SELFCHECK.md`.
11. [ ] 🔵 **Verify** — `bun run check`, typecheck, `bun test`, run daemon, click-through; regression-check Queue/Sessions/Desktop instances. Commit.

### Feature D — usage in the Instances table (§6A)

12. [ ] 🟢 **Usage cell + hover popover** — condensed `bindingWeeklyPct` cell (color-coded) + kit `Popover` breakdown; per-row "Check usage" + toolbar "Refresh all" (spaced); cache `lastUsageCheck` + show age; `isNoData`→"—". Depends on brick 3/4 (`checkUsage`).

### Feature E — auto-resume monitor (§6B)

13. [ ] 🔵 **Q4 spike** — capture a real rate-limited dispatch + interactive transcript; record the exact signature in §7-Q4 (5h vs weekly if distinguishable).
14. [ ] 🔵 **Q5 spike** — confirm the `claude --resume` invocation + its auth for dispatched AND desktop sessions.
15. [ ] 🟢 **Rate-limit detection** — mark dispatched runs `rate-limited`/`resumable` in `run_events` (primary); transcript-tail scan (secondary), both keyed on Q4's signature; flag only MID-WORK stops.
16. [ ] 🔵 **`server/src/monitor.ts`** — poll loop: find resumable stops → `checkUsage` gate (`weekAll<100`) → schedule `claude --resume` at the 5h reset via the scheduler; `resume_attempts` cap; idempotent (no double-queue).
17. [ ] 🟢 **Monitor config + state** — sqlite `monitor` settings (global + per-account), `DEFAULT_RESUME_PROMPT` code constant (optional advanced override), `resume_attempts` counter.
18. [ ] 🟢 **Monitor UI** — Settings global switch + per-account switch in Instances + status chip ("resumes ~HH:MM" / "blocked: weekly maxed" / "needs human"). i18n.
19. [ ] 🔵 **Verify D+E** — runtime evidence: force a rate-limited run (or fixture) → detection → gated schedule → resume fires after the 5h reset AND is blocked when weekly maxed; usage cell + hover render. Commit.

---

## 9. Progress log — ⬇️ YOU ARE HERE ⬇️ (update every increment)

- **2026-07-14 (Fable, account @ ~97.5% weekly):** Plan authored. Repo explored (state captured in §2).
  No implementation code written yet. **Next:** checklist item 1 (Q1 spike), then item 2 (usage.ts + parser
  + fixture test) as the first committable brick.
- **2026-07-14 (Fable) — brick 1 landed:** Q1 spiked (§7-Q1: dispatch auth is env-var token injection,
  reusable — no CLI login needed for registered accounts). `server/src/usage.ts` written (pure
  `parseUsageOutput` + `bindingWeeklyPct` + `isNoData`) with `server/tests/usage.test.ts` (4/4 green).
  Committed. **YOU ARE HERE → next: checklist item 3** — `checkUsage()` spawn+capture: spawn the
  `claude` binary directly (args array, NOT via Git Bash — MSYS mangles `/usage`), inject
  `CLAUDE_CODE_OAUTH_TOKEN` per §7-Q1, reuse the repo's existing claude-binary resolution
  (see `dispatch.ts`/`detached-spawn.mjs` for how it finds + spawns `claude`). Then item 4 (MCP `check_usage`).
- **2026-07-14 (Fable) — Features D + E designed & added (owner ask).** Feature D (usage in Instances
  table: condensed cell + hover popover) = §6A + checklist item 12. Feature E (auto-resume monitor:
  5h-limit-killed sessions auto-resume via a locked `claude --resume` prompt, gated on `weekAll<100`) = §6B +
  items 13–19 + spikes Q4–Q6. Design upgrade noted: detect rate-limits from STRUCTURED `run_events`
  (dispatched runs) first, transcript-tail scan only as best-effort secondary. No code beyond brick 1 yet.
  **YOU ARE HERE unchanged → next code = checklist item 3 (`checkUsage()`);** Features D/E build on it.
- _next session: append your progress here, then commit._
