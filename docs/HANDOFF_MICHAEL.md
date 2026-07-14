# Handoff for Michael (CLI instances + usage-check + auto-resume monitor)

The CLI-instances / usage-check / auto-resume-monitor feature set is built, unit-tested, and wired
end to end (see `CHANGELOG.md` "Unreleased"). This file lists ONLY the parts that need a human,
because they require either a real rate-limit event (which cannot be triggered on demand safely) or
an OAuth login (which an AI must never perform). Nothing here blocks using the feature today.

## 1. Confirm the exact rate-limit signature against a REAL event (plan Q4)

**Status: heuristic in place; one live confirmation outstanding.**

Detection does NOT depend on new guesswork. It reuses the signature list already shipping in
`server/src/dispatch.ts` (`RATE_LIMIT_PATTERNS` + `looksRateLimited`), which finalizes a rate-limited
dispatch with the structured `rate_limited` queue status. The monitor keys off that status. So the
"detection" brick is done and self-consistent.

What an AI cannot do is force a REAL rate limit to capture the exact `stream-json` error type/message
(and a real interactive transcript tail) to confirm the patterns match current wording and to tell a
5-hour-window limit apart from a weekly limit if the text differs.

**To close it:** next time a dispatched run (or an interactive session) actually hits a limit, grab
the tail of its run log (`~/.ccmanagerui`-side `run-logs/<id>.stream.jsonl`, the `{"__dispatch":"stderr",…}`
marker) and the transcript tail, paste the real wording, and if it is not already matched by
`RATE_LIMIT_PATTERNS`, add the missing phrase there. That is a one-line change if needed.

## 2. Full end-to-end auto-resume test against a real 5-hour limit (plan item 19)

**Status: logic unit-tested; live end-to-end needs a real limit + real time.**

The state machine is covered by `tests/monitor.test.ts` (enabled gate, no-account → needs_human,
idempotency, per-account override, settings). The usage gate and the scheduled `--resume` dispatch
were exercised against the running daemon, but a TRUE end-to-end ("session dies on a 5-hour limit
while I sleep, wakes and finishes after the reset, and is correctly BLOCKED when the weekly cap is
maxed") can only be observed across a real limit window.

**To close it:** turn the monitor on (Settings → Auto-resume monitor, or `set_monitor {enabled:true}`),
let a real dispatched run hit a 5-hour limit with weekly under 100%, and confirm a resume is scheduled
for just after the reset and fires. Then repeat with weekly at/over 100% and confirm it is held with
"blocked: weekly maxed" instead of resuming.

## 3. Sign the CLI instances in (`/login`): user-only by design

Creating a CLI instance makes its `CLAUDE_CONFIG_DIR`; signing it in is an OAuth/password flow the app
deliberately never performs. Use the row's **Log in** action (opens a terminal with the env set) and
run `/login` there once per instance. After that the instance shows as logged in and is pollable.

---

Everything else in the plan is done: `checkUsage` + parser + `check_usage`/`check_my_usage` MCP tools,
CLI-instance model + routes + UI, the usage cell + hover popover, the monitor + its config/UI, and the
docs (`docs/AI_USAGE_SELFCHECK.md` + README). See `CHANGELOG.md` for the full list.
