# CCManagerUI, Codex / ChatGPT support scoping

**Purpose.** Can CCManagerUI grow beyond Claude to also handle OpenAI **Codex** (CLI chats +
instances) and the **ChatGPT desktop app**? Living research doc, kept current as we dig, so it can
be handed to another agent to continue or implement from.

**How to use.** "Verdict" = bottom line. "Per-capability" = the three asks with effort + exact hook
points. "Architecture" = coupling. "Next steps" = what to do. Every claim cites a `file:line` or an
on-disk path. Update the Changelog on every edit.

Legend: OK confirmed · PARTIAL likely/partial · BLOCKED not feasible · TBD unknown (needs work)

---

## Verdict (current)

| Ask | Feasibility | Effort | One-line |
|---|---|---|---|
| **Codex chats** (view Codex CLI sessions) | OK feasible | Moderate | Codex writes clean per-session JSONL transcripts; add a "source" + parser to the sessions view. |
| **Codex instances** (manage Codex CLI runs) | PARTIAL likely | Moderate-high | Codex is a CLI, but CCManagerUI's `cli-instances.ts` is deeply Claude-specific (`CLAUDE_CONFIG_DIR`, `claude /login`, Anthropic account-linking), so this needs a PARALLEL Codex module, not an extension. |
| ~~ChatGPT desktop~~ | RESOLVED = Codex | n/a | Per owner (2026-07-23): "ChatGPT is Codex" (the ChatGPT/Codex desktop is a Microsoft Store / MSIX app, hence not in the usual folders). No separate work; folded into the Codex rows above. |
| **OpenCode chats** (view OpenCode sessions, CLI + desktop) | BLOCKED-ish / hard | High | Owner wants BOTH. But there is NO clean transcript to read: the CLI session store is empty here (dirs don't even exist), and the Electron desktop app keeps chat state in Chromium **LevelDB** (binary). Needs a populated CLI store to inspect, OR cracking LevelDB, OR an app export. |

**Recommended order:** Codex chats first (self-contained, no auth, clear data), then Codex
instances, then reconsider ChatGPT once we know what/where it is.

**Key architecture fact:** CCManagerUI's session reader is **Claude-format-hardcoded with no
provider abstraction** (`server/src/sessions.ts`, 286 lines; grep for provider/source/codex = none).
The session *model* (title, timestamps, messages, model) is generic; only the *parser* and the
*root path* are Claude-specific. So this is "add a provider," not "re-architect."

---

## What CCManagerUI does today (baseline)

Repo `D:\PublicProjects\ccmanagerui` (`LunarWerxs/ccmanagerui`, site `ccmanagerui.github.io`).
Manages **Claude** three ways:

1. **Sessions viewer** - reads Claude Code CLI transcripts `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl` (root: `server/src/config.ts` `CLAUDE_PROJECTS_ROOT`; parser: `server/src/sessions.ts`).
2. **Desktop instances** - isolated Claude Desktop profiles via `--user-data-dir=<dir>` (`server/src/core/instances.ts`, `paths.ts`); resolves each profile's account/plan by decrypting its local token cache.
3. **CLI instances** - tracked Claude Code CLI instances (`server/src/core/cli-instances.ts`).

Plus Anthropic usage/quota, scheduler, auto-resume monitor, cloud sync.

---

## On-disk findings (this machine, 2026-07-23)

### Codex - CONFIRMED installed, with parseable transcripts
- Home: `C:\Users\blogi\.codex`.
- **Session transcripts:** `C:\Users\blogi\.codex\sessions\YYYY\MM\DD\rollout-<ISO-timestamp>-<uuid>.jsonl` (active) and `C:\Users\blogi\.codex\archived_sessions\rollout-*.jsonl` (archived). Date-partitioned, one JSONL per session, newest seen 2026-07-22.
- **Format** (line-delimited JSON, each `{ timestamp, type, payload }`):
  - `session_meta` (first line: session metadata - cwd/model/instructions live here),
  - `event_msg`,
  - `response_item` with `payload.role` in {`user`, `assistant`, `developer`} = the actual turns.
  This maps cleanly onto CCManagerUI's SessionSummary (id from filename uuid, start time from the timestamp, title from the first user message, messages from `response_item`s). No network/auth needed - pure file reads, same as Claude.
- **Binary:** `C:\Users\blogi\AppData\Local\OpenAI\Codex\bin\` (has `bin`, `runtimes`, `chrome-native-hosts-v2.json`). `codex` is NOT on PATH, so launching needs the full path. Also a Codex IDE `extension` at `AppData\Local\OpenAI\extension`.

### OpenCode - CONFIRMED installed (CLI + Electron desktop); chat store location TBD
- **CLI:** config `C:\Users\blogi\.config\opencode`, data `C:\Users\blogi\.local\share\opencode` (`auth.json`, `mcp-auth.json`). Its `storage/` has only `migration/` and `session_diff/` here, and the `session_diff/ses_<id>.json` files are 2 bytes (empty `[]`). So the CLI's main session/message store is NOT populated on this machine (CLI barely used, or the store moved).
- **Desktop app (Electron/Chromium):** `AppData\Local\Programs\@opencode-aidesktop` (app), `AppData\Roaming\ai.opencode.desktop` (profile) with `Local Storage`, `Local State`, `Network`, `GPUCache`, `Crashpad`, `DawnWebGPUCache`, plus `opencode.draft.<id>.dat` files and `window-state*.json`. Chromium markers = **Electron**, so (a) chats probably live in Chromium **IndexedDB / Local Storage (LevelDB)**, a hard binary format, not JSONL; and (b) IF "OpenCode instances" is ever wanted, an Electron app *might* accept `--user-data-dir` like Claude Desktop (unverified).
- `opencode` not on PATH. Also `AppData\Local\opencode-context-menu` (shell integration) and `@opencode-aidesktop-updater`.
- **Blocker for "OpenCode chats":** the readable-JSONL assumption that makes Codex easy does NOT clearly hold here. Where the desktop app keeps a chat (IndexedDB? a server/cloud? the `.dat` drafts?) is unconfirmed. USER OFFERED to point at a real chat, take them up on it.

### ChatGPT desktop - NOT found where expected
- `C:\Users\blogi\AppData\Local\OpenAI` contains **`Codex`** and **`extension`**, i.e. it's the Codex install, not a ChatGPT desktop app.
- No `Local\Programs\ChatGPT*`, no `WindowsApps\OpenAI*`, no ChatGPT/OpenAI Appx package surfaced.
- So "ChatGPT desktop instances" has no target on this machine yet. Either the user means Codex/ChatGPT-web, or the desktop app is installed elsewhere. NEEDS clarification.

---

## Per-capability assessment

### 1. Codex chats (session viewing) - OK feasible, moderate
- **Data:** ready and parseable (above). `session_meta.payload` CONFIRMED fields: `session_id`/`id` (= filename uuid), `timestamp` (ISO start), `cwd` (e.g. `D:\...\stuff for stuff`), `originator` ("Codex Desktop"), `source` ("vscode"), `cli_version`, `model_provider` ("openai"), `base_instructions`, `dynamic_tools`, `context_window`. (No explicit per-session model name in meta; may be per-turn or absent, minor.)
- **Title caveat:** the first `response_item` user turn is `content: []` (structured blocks) and the first block is often an INJECTED system block (saw `<recommended_plugins>`), same as Claude, so the parser must skip injected/system blocks to find the real first human message.
- **Hook points:**
  - `server/src/config.ts` - add a `CODEX_SESSIONS_ROOT = ~/.codex/sessions` (+ `archived_sessions`).
  - `server/src/sessions.ts` - it currently assumes Claude's one-file-per-session `.jsonl` under a projects root and parses Claude event shapes. Add a Codex rollout parser that emits the same internal `SessionSummary`/`ScannedMeta`, and tag each session with a `source: 'claude' | 'codex'`.
  - Web: a source badge + a filter (mirror the existing instance filter in `web/src/components/SessionsView.vue`).
- **Effort:** moderate. Main work = the rollout parser + threading `source` through `listSessions`/`getSession` and the UI. Cwd-grouping differs (Codex stores cwd in `session_meta`, Claude encodes it in the dir name) but both yield a cwd.

### 2. Codex instances (CLI management) - PARTIAL likely, moderate-high
- Codex is a CLI (binary above), same SHAPE as the Claude Code CLI instances CCManagerUI tracks.
- **Coupling (READ):** `server/src/core/cli-instances.ts` (396 lines) is NOT a generic abstraction. It models "isolated Claude Code CLI logins": mints a `CLAUDE_CONFIG_DIR`, uses `resolveClaudeExe` (config.ts), opens a console running `claude` / bare `claude` for `/login`, and links each to an Anthropic account + a Claude Desktop instance (`associatedAccountLabel`/`associatedDesktopLabel`). So Codex needs a **parallel module** (`CODEX_HOME` isolation, the codex binary at `AppData\Local\OpenAI\Codex\bin`, `codex` login flow), reusing only the generic record/registry/launch-console plumbing.
- Identity/usage: Codex has its own auth + quota (not Anthropic's), so the plan/quota UI does NOT carry over; treat Codex instances as "launch + track", not "show plan/quota".

### 3. OpenCode chats (session viewing) - TBD, probably harder than Codex
- **Data:** unresolved. CLI JSON store empty here; desktop app is Electron and its chats are likely in Chromium IndexedDB/Local Storage (LevelDB) or a backend, none of which is a drop-in JSONL read.
- **Two paths to confirm (need one real chat from the user):**
  - If the user uses the **CLI** and its `storage/session/` + `storage/message/` fill up with JSON, this becomes as easy as Codex (add a source + parser).
  - If chats live only in the **desktop app**, reading them means cracking Chromium storage (LevelDB via a lib, or an export/API the app offers) - materially more work, and possibly not worth it vs. asking OpenCode for an export path.
- **Next:** user points at a known recent OpenCode chat (and says CLI vs desktop); then locate the exact file/store and decide feasibility.

### 4. ChatGPT desktop instances - BLOCKED / TBD, high
- No desktop app located (above). The Claude-Desktop trick relies on the app being Chromium/Electron and honoring `--user-data-dir`; unknown for ChatGPT, and moot until we find the app.
- Even if found: ChatGPT desktop is a chat client, not a CLI/agent, so "instances" would mean isolated logged-in profiles, a different value prop than Codex. Recommend deferring pending user clarification on what "ChatGPT" should do here.

---

## Architecture - how Claude-coupled

- **Sessions:** `server/src/sessions.ts` (286 lines) parses Claude transcript events inline; `server/src/config.ts` hardcodes `CLAUDE_PROJECTS_ROOT`. **No** provider/source abstraction exists yet (verified by grep). Adding Codex = introduce a lightweight `source` dimension + a second parser feeding the same session model. Low risk, self-contained.
- **Instances (desktop):** `core/instances.ts` + `core/accounts.ts` are deeply Anthropic-specific (decrypt Claude token cache, Anthropic profile API, plan labels). Not reusable for OpenAI without a parallel implementation.
- **CLI instances:** `core/cli-instances.ts` (396 lines) is Claude-specific (`CLAUDE_CONFIG_DIR`, `resolveClaudeExe`, `claude`/`/login`, Anthropic account+desktop linking). Reusable pieces = the record model, the JSON registry, and the "open a console with an env var set" launcher; Codex needs its own config-dir + binary + login variant.

---

## Open questions / next steps
1. DONE - `cli-instances.ts` read (Claude-hardcoded; Codex needs a parallel module).
2. DONE - `session_meta` fields confirmed (see Codex chats section).
3. **Read `server/src/sessions.ts` in full + the `SessionSummary`/`ScannedMeta` types** to design the exact `source`-tagging change and where the Codex rollout parser slots in (this is the concrete implementation-design step for the MVP).
4. **Clarify "ChatGPT" with the user:** desktop app (and where installed?), ChatGPT-web, or did they mean Codex? No desktop app found on this machine.
5. **Decide MVP:** proposal = ship "Codex chats" in the sessions view first (a `source` tag + a `~/.codex/sessions` rollout parser + a UI badge/filter), demo it, then scope Codex instances as a parallel `core/codex-instances.ts`.

---

## Changelog
- 2026-07-23 (4) - Added OpenCode (user request). Found CLI (`~/.local/share/opencode`, JSON store EMPTY here) + Electron desktop app (`ai.opencode.desktop`, Chromium storage). Chats likely in the desktop's IndexedDB/LevelDB, not clean JSONL, so probably harder than Codex. Flagged to ask the user to point at a real chat + say CLI vs desktop.
- 2026-07-23 (3) - Confirmed `session_meta` fields (session_id/timestamp/cwd/model_provider) + title caveat (skip injected blocks). Read `cli-instances.ts`: Claude-hardcoded, so Codex instances need a parallel module (effort raised to moderate-high). Reusable plumbing identified (record model, registry, console launcher).
- 2026-07-23 (2) - Codex sessions CONFIRMED at `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`, format decoded (session_meta / event_msg / response_item, roles user/assistant/developer). Codex binary at `AppData\Local\OpenAI\Codex\bin`. ChatGPT desktop NOT found (OpenAI dir is Codex). Architecture: `sessions.ts` has no provider abstraction, Claude-hardcoded but model is generic. Verdict set: Codex chats feasible-moderate, Codex instances likely, ChatGPT blocked/unclear.
- 2026-07-23 (1) - Doc created. On-disk recon: `~/.codex` present, `AppData\Local\OpenAI` present; `codex` not on PATH.
