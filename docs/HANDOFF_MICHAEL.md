# Handoff for Michael (CLI instances + usage-check + auto-resume monitor)

The CLI-instances / usage-check / auto-resume-monitor feature set is built, unit-tested, and wired
end to end (see `CHANGELOG.md` "Unreleased"). This file lists ONLY the parts that need a human,
because they require either real time across a real rate-limit window (which cannot be triggered on
demand safely) or an OAuth login (which an AI must never perform). Nothing here blocks using the
feature today.

**Item 1 is now closed** — by real captured events (2026-07-16), and it turned up a live bug rather
than the missing phrase it was expecting. What is left is one observation that needs a real 5-hour
window, and one login only you can perform.

## 1. ~~Confirm the exact rate-limit signature against a REAL event~~ — CLOSED 2026-07-16

**Status: closed by real events. No longer needs a human.**

Two real notices were captured off this machine and are now the fixtures the detector is tested
against (`tests/rate-limit-signal.test.ts`):

- a real 5-hour wall, seen in 7 transcripts:
  `You've hit your session limit · resets 9:10am (America/Chicago)`
- a real 529, from a dispatched run's own `run_events`:
  `API Error: 529 Overloaded. This is a server-side issue, usually temporary — try again in a
  moment. If it persists, check https://status.claude.com.`

The confirmation did NOT find a missing phrase, which is what this item expected. It found the
opposite problem: the one pattern list matched **both** of those, so a 529 — Anthropic's servers
being saturated for a few seconds — was finalized `rate_limited` and parked against a 5-hour reset
that was never coming. Detection now lives in `server/src/rate-limit-signal.ts` (`classifyLimit`),
which sorts a QUOTA wall from a TRANSIENT overload; `dispatch.ts` retries the latter and only parks
the former. A weekly vs 5-hour limit still reads as one `quota` kind, which is correct — the monitor
schedules against a live usage read, never against the notice's wording.

The old names this file used to point at (`RATE_LIMIT_PATTERNS`, `looksRateLimited`) no longer
exist.

## 2. Full end-to-end auto-resume test against a real 5-hour limit (plan item 19)

**Status: logic unit-tested; live end-to-end needs a real limit + real time.**

The state machine is covered by `tests/monitor.test.ts` (enabled gate, ambient usage gate,
weekly-maxed → blocked, idempotency, per-account override, settings, and transcript-discovered
stops). A TRUE end-to-end — "session dies on a 5-hour limit while I sleep, wakes and finishes after
the reset, and is correctly BLOCKED when the weekly cap is maxed" — can still only be observed
across a real limit window.

**To close it:** turn the monitor on (Settings → Auto-resume monitor, or `set_monitor {enabled:true}`),
let a real run hit a 5-hour limit with weekly under 100%, and confirm a resume is scheduled for just
after the reset and fires. Then repeat with weekly at/over 100% and confirm it is held with
"blocked: weekly maxed" instead of resuming.

Two things narrowed since this was written:

- The monitor no longer only sees runs it dispatched. It also FINDS sessions stopped at a limit by
  reading recent transcripts (`server/src/rate-limit-discovery.ts`), so a session started in a
  terminal is resumable too — those rows carry a "Found" badge. Measured on this machine
  2026-07-16: 7 transcripts carried a real limit notice in 12h, 2 were still stopped at one.
- A 529 no longer reaches this path at all (see item 1), so an overload can't be mistaken for the
  5-hour event you are trying to observe.

## 3. Sign the CLI instances in (`/login`): user-only by design

Creating a CLI instance makes its `CLAUDE_CONFIG_DIR`; signing it in is an OAuth/password flow the app
deliberately never performs. Use the row's **Log in** action (opens a terminal with the env set) and
run `/login` there once per instance. After that the instance shows as logged in and is pollable.

---

Everything else in the plan is done: `checkUsage` + parser + `check_usage`/`check_my_usage` MCP tools,
CLI-instance model + routes + UI, the usage cell + hover popover, the monitor + its config/UI, and the
docs (`docs/AI_USAGE_SELFCHECK.md` + README). See `CHANGELOG.md` for the full list.
