// Shared types, imported by the Vue app via Eden for end-to-end typing.

/** "Sync my settings with Connections" DTO, defined HERE (not re-exported from
 * ./connections.ts) because that module imports Bun-only runtime files (db.ts), which
 * must never be pulled into the web app's vue-tsc pass; ./connections.ts imports it back.
 * Status shape returned by every settings-sync endpoint (matches DevWebUI's SyncStatus). */
export interface SyncStatus {
  ok: true
  /** Sync is turned on (independent of whether a Connections credential exists). */
  enabled: boolean
  /** The daemon holds a Connections credential (owner is signed in). */
  connected: boolean
  /** Signed-in display name, or null when not connected (or a pre-name connection pending refresh). */
  name: string | null
  /** Privacy-relay email; third-party apps never receive the real inbox, shown only as a fallback. */
  email: string | null
  /** Avatar image URL from the IdP, or null when not granted/available. */
  picture: string | null
  /** ISO timestamp of the last successful sync, or null. */
  lastSyncedAt: string | null
  version: number
  /** Last-synced appearance blob (e.g. `{ theme }`) to apply locally, or null. */
  appearance: Record<string, unknown> | null
}
// Instance DTOs ("instance account" = which Anthropic account a Claude Desktop *instance*
// is logged into) are defined in ./core/shared.ts, re-exported here so the web app only
// ever imports types from this one module, same as every other DTO below.
export type {
  CMAccount,
  CMAccountStatus,
  CMActionResult,
  CMDesktopInstall,
  CMInstance,
} from './core/shared'
/** Portable-window opener result (see ./portable-window.mjs), re-exported here so the web
 * app only ever imports types from this one module, same as every other DTO in this file. */
export type { PortableWindowResult } from './portable-window.mjs'
/** Self-updater DTOs (see ./updater-engine.mjs), re-exported here so the web app only
 * ever imports types from this one module, same as every other DTO in this file. */
export type { UpdateApplyResult, UpdateStatus } from './updater-engine.mjs'

export type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max'
export type AuthType = 'oauth_token' | 'api_key'
export type QueueStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'rate_limited'
  | 'canceled'
export type PermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan'

/** A Claude Code session discovered on disk (read-only view of the CLI transcript store). */
export interface SessionSummary {
  session_id: string
  title: string
  cwd: string
  project: string
  git_branch: string | null
  message_count: number
  created_at: number | null
  last_activity_at: number
  last_role: 'user' | 'assistant' | null
  last_text_preview: string | null
  size_bytes: number
  transcript_path: string
  /** Live status pulled from our own queue, if this session is scheduled/running under us. */
  queue_status: QueueStatus | null
  /** Claude Desktop instance the session ran in: an `~/.claude-instances` dir name,
   *  "default" for the non-isolated install, or null for plain CLI / unknown. */
  instance: string | null
}

/** One displayable turn from a transcript tail, after the hide-"thinking" filter. */
export interface TailEvent {
  role: 'user' | 'assistant'
  kind: 'text' | 'tool_use' | 'tool_result'
  text: string
  tool_name: string | null
  timestamp: string | null
}

export interface TailResult {
  session_id: string
  title: string
  cwd: string
  events: TailEvent[]
  error?: string
}

/** One session's hits from an advanced BODY search (server/src/session-search.ts). */
export interface SessionSearchResult {
  session_id: string
  cwd: string
  project: string
  match_count: number
  /** True when match_count hit the per-file cap; there may be more matches not shown. */
  truncated: boolean
  snippets: string[]
}

export interface Account {
  id: string
  label: string
  auth_type: AuthType
  /** Never returned in full; masked for display. */
  secret_masked: string
  created_at: number
}

export interface QueueItem {
  id: string
  session_id: string
  title: string
  cwd: string
  prompt: string
  model: string | null
  effort: EffortLevel | null
  permission_mode: PermissionMode | null
  account_id: string | null
  new_chat: boolean
  fork: boolean
  status: QueueStatus
  pid: number | null
  position: number
  /** ISO timestamp; the scheduler won't auto-dispatch before this (manual Run ignores it). */
  not_before: string | null
  started_at: string | null
  finished_at: string | null
  exit_code: number | null
  created_at: number
}

export interface RunEvent {
  id: number
  queue_item_id: string
  seq: number
  ts: string
  role: 'user' | 'assistant' | 'system'
  kind: 'text' | 'tool_use' | 'tool_result' | 'meta'
  text: string
  tool_name: string | null
}

export interface SchedulerState {
  enabled: boolean
  running_count: number
  queued_count: number
  spacing_seconds: number
  poll_seconds: number
  max_concurrent: number
  /** "HH:MM" local time used by the composer's "Tomorrow …" quick option. */
  tomorrow_time: string
}

/** Portable-window setting: open the UI in a chromeless Chromium app window instead of a
 * browser tab (both the in-app toggle and the desktop tray launcher honor it). */
export interface PortableModeSettings {
  portableMode: boolean
  /** Hide the tray's NotifyIcon (the daemon keeps running; the tray keeps re-reading this
   *  live so re-enabling it here restores the icon without a restart). */
  hideTrayIcon: boolean
}
