# Desktop and CLI sessions share one transcript store

Claude Desktop and the `claude` CLI are not separate systems from a session's point of view.
They read and write the same on-disk transcript, and that has one dangerous consequence
covered first below, plus several less dangerous ones covered after it.

## `claude://resume` is a lossy, one-way import. Do not fire it at a live session.

`claude://resume?session=<uuid>` looks like it should "focus" or "refresh" an existing desktop
chat onto the latest transcript state. **It does not.** It is an import operation, and importing
a session that already has a desktop chat open on it is destructive:

- The registry maps the `claude://` scheme to the **default** Desktop install's executable.
- The handler reads `searchParams.get("session")`, UUID-validates it, and calls
  `LocalSessions.importCliSession(cliSessionId)`.
- Firing it at a real, already-open session rewrites the shared transcript file
  (`~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`) **in place**, stripping every
  "thinking" block out of it, with no backup. One observed case dropped 167 thinking blocks and
  shrank the file from 2.96 MB to 2.35 MB.
- It also creates a **second, untitled desktop chat** for the same session, while the original
  chat is left open and frozen on its old state.
- The app's own log even warns about this path: `"Resume may fail if this exceeds the SDK
  prompt-size cap"`. This is an import meant for pulling a *finished* CLI session into the
  desktop **once**, not for syncing or refreshing a live one.

Regular conversation content survives the import; only the thinking blocks are lost (nothing in
the UI displays them anyway, so the visible impact is low). But the transcript rewrite is
one-way and the duplicate chat is permanent. **Do not build a "nudge the desktop" or "refresh"
button on `claude://resume`.** If you need to hand a session to the desktop, do it once, on a
session you are done editing from the CLI side.

## The shared store, and how the two sides are linked

- **The transcript** (written by both CLI and Desktop): `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`.
  Every instance, isolated or default, writes here. This repo reads it via `CLAUDE_PROJECTS_ROOT`.
- **Desktop's per-instance index** (Desktop only):
  `<user-data-dir>/claude-code-sessions/<org>/<user>/local_*.json`. Each file carries metadata
  (`title`, `cwd`, `model`, `lastActivityAt`, `lastFocusedAt`, `isArchived`) about one desktop
  chat. Its `cliSessionId` field names the shared transcript that chat is backed by. **This field
  is the only reliable link between a desktop chat and a CLI session.**
- Two kinds of Desktop install keep this index in different places, and both must be scanned:
  - `~/.claude-instances/<name>/` for named, isolated instances.
  - `%APPDATA%/Claude/` for the default (non-isolated) install. This repo labels sessions found
    here as **"default"**, not as a plain terminal session.

## Measurement traps

1. **Do not match by folder name.** Desktop chat folder names are desktop-internal chat ids;
   comparing them against CLI session ids gives a false "zero overlap" between the two systems.
   Match by the `cliSessionId` field inside the json, never by folder name.
2. **Scan every store, recursively, at every depth.** A shallow, one-level glob of only
   `.claude-instances` can miss the bulk of the data; in one observed case a one-depth scan of
   only `.claude-instances` found 209 records where a full recursive scan across all stores
   (including `%APPDATA%/Claude`) found 951.
3. **Do not match by `title`.** The `title` stored in a desktop's `local_*.json` is Desktop's own
   and need not match this app's own session title (which is derived from the transcript
   content). Always match by id.

## Sending a message into a desktop chat works, but the desktop never notices

Resuming and messaging an idle desktop chat from outside Desktop (for example, via this app's
dispatch) genuinely works: the run completes, and the shared transcript file gains the new turn.
But the desktop chat's own index entry does not update. Its `lastActivityAt` stays byte-identical
after such a message. Desktop only counts activity coming from its own in-app `claude` child
process, which it drives over `--input-format stream-json` on stdin. There is no external entry
point that updates Desktop's own notion of "this chat had activity."

Practical effect: a session can be actively growing on disk while every signal the desktop UI
shows about it (last-activity timestamps, unread indicators) stays frozen at whenever the desktop
window itself last touched it.

## Narrowed by source, still unproven in the live UI

Whether closing and reopening an **existing** desktop chat causes it to re-render turns that were
appended to the transcript from outside Desktop is not established either way. That the transcript
*file* contains the appended turns (visible via `mcp__ccd_session_mgmt__list_events`) only proves
the data is on disk, not that Desktop's UI re-reads the file when a chat is reopened. The fact
that `claude://resume` builds an entirely separate imported copy (see above) is itself weak
evidence that Desktop may not re-read an existing chat's backing file at all. Do not assume or
assert "reopening refreshes it" without first re-verifying this directly.

Read-only inspection of Desktop 1.24012.1 narrows the unknown: the main-process
`LocalSessionManager.getTranscriptWithoutQueryCrashes()` loads the shared transcript from disk for
a stopped mapped session, rather than relying only on its persisted `messageBuffer`. The backend
therefore has the current turns available. What remains unproven is whether the renderer requests a
fresh transcript when an existing chat is closed and reopened; that final claim still needs one
direct visual observation.

## Why there is no "this session is stale in Desktop" indicator

This was considered and deliberately not built. `lastActivityAt` lags even for genuinely live
desktop sessions (observed drift: a session's index showed one timestamp while its transcript on
disk was already several minutes further ahead), and merely *focusing* a chat in the desktop UI
only updates `lastFocusedAt`, not `lastActivityAt`. A "transcript is newer than what Desktop's
index shows" check built on those fields would fire almost constantly, and would never clear once
the user actually looked at the chat (since focusing doesn't update the field the check watches).
That shape, a warning that fires all the time and never resolves, is worse than no indicator.

## Related session interfaces

- Desktop exposes its own session layer to MCP-speaking sessions running inside it, via
  `mcp__ccd_session_mgmt__*` tools (list / get / list_events / send_message / search). This is
  scoped per-instance: a session running inside one isolated instance cannot see another
  instance's (or the default install's) chats through these tools.

## Before you touch session-linking logic

Read `server/src/instance-sessions.ts` first. Its header comment is the canonical, current
description of the scan; this document is the narrative "why" and the list of traps that led to
it, not a replacement for reading the code.
