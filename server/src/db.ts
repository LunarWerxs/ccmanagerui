import { Database } from 'bun:sqlite'
import { chmodSync, mkdirSync } from 'node:fs'
import { protectAccountSecret } from './account-secrets'
import { DATA_DIR, DB_PATH, RUN_LOG_DIR } from './config'
import { classifyLimit } from './rate-limit-signal'
import type { QueueItem } from './types'

mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 })
mkdirSync(RUN_LOG_DIR, { recursive: true, mode: 0o700 })
try {
  chmodSync(DATA_DIR, 0o700)
  chmodSync(RUN_LOG_DIR, 0o700)
} catch {
  // Windows ACLs, or a filesystem without POSIX modes; the per-user location/ACL remains in force.
}

export const db = new Database(DB_PATH, { create: true })
db.exec('pragma journal_mode = WAL')
db.exec('pragma foreign_keys = ON')
try {
  chmodSync(DB_PATH, 0o600)
  chmodSync(`${DB_PATH}-wal`, 0o600)
  chmodSync(`${DB_PATH}-shm`, 0o600)
} catch {
  // WAL/SHM may not exist yet; Windows permissions are ACL-based. Best effort is sufficient here.
}

db.exec(`
create table if not exists accounts (
  id         text primary key,
  label      text not null,
  auth_type  text not null,            -- 'oauth_token' | 'api_key'
  secret     text not null,
  created_at integer not null
);

create table if not exists queue_items (
  id              text primary key,    -- our own queue-item uuid
  session_id      text not null,       -- target session: --resume <id>, or minted --session-id for new chats
  title           text not null,
  cwd             text not null,
  prompt          text not null,
  model           text,
  effort          text,
  permission_mode text,
  account_id      text references accounts(id) on delete set null,
  new_chat        integer not null default 0,
  fork            integer not null default 0,
  status          text not null default 'queued',  -- queued | running | completed | failed | rate_limited | overloaded | canceled
  pid             integer,
  position        integer not null default 0,
  not_before      text,                 -- ISO timestamp; scheduler won't auto-dispatch before this

  started_at      text,
  finished_at     text,
  exit_code       integer,
  created_at      integer not null
);

create table if not exists run_events (
  id            integer primary key autoincrement,
  queue_item_id text not null references queue_items(id) on delete cascade,
  seq           integer not null,
  ts            text not null,
  role          text not null,          -- user | assistant | system
  kind          text not null,          -- text | tool_use | tool_result | meta
  text          text not null,
  tool_name     text
);
create index if not exists idx_run_events_item on run_events(queue_item_id, seq);

create table if not exists settings (
  key   text primary key,
  value text not null
);

-- Auto-resume monitor (Feature E): per-session tracking of a rate-limited stop and its scheduled
-- resume, so the poll loop is idempotent (never double-queues) and bounded (resume_attempts cap).
create table if not exists monitor_state (
  item_id        text primary key,        -- the rate_limited queue_item that tripped the monitor
  session_id     text not null,
  account_id     text,
  resume_attempts integer not null default 0,
  state          text not null,           -- scheduled | blocked_weekly | needs_human | done
  resume_item_id text,                    -- the queue_item we enqueued to carry the resume
  message        text,                    -- human status ("resumes ~HH:MM" / "weekly maxed" / …)
  next_check_at  text,                    -- ISO; re-arm time for a blocked_weekly re-evaluation
  updated_at     text not null
);

-- Per-account monitor override. A row with enabled=0 opts that account OUT while the global switch
-- is on (default, absent row = follow the global switch).
create table if not exists monitor_accounts (
  account_id text primary key,
  enabled    integer not null default 1
);

-- User's own "done" mark on a session (distinct from Claude Desktop's own isArchived, which is
-- read-only metadata scanned from disk). Mark only: it must never filter a session out of a list.
create table if not exists session_marks (
  session_id text primary key,
  done       integer not null default 0,
  updated_at integer not null
);
`)

// Existing manually-pasted credentials predate at-rest sealing. On Windows, migrate each legacy
// plaintext value to a CurrentUser-scoped DPAPI blob in place; on other platforms seal() is a
// documented passthrough and the owner-only DB permissions above are the protection.
{
  const rows = db.query<{ id: string; secret: string }, []>('select id, secret from accounts').all()
  const update = db.query('update accounts set secret = ? where id = ?')
  for (const row of rows) {
    const protectedSecret = protectAccountSecret(row.secret)
    if (protectedSecret !== row.secret) update.run(protectedSecret, row.id)
  }
}

// --- additive migrations ----------------------------------------------------
// `create table if not exists` never alters an existing table, so columns added
// after a release must be backfilled here for databases created before them.
{
  const cols = db
    .query<{ name: string }, []>('pragma table_info(queue_items)')
    .all()
    .map((c) => c.name)
  if (!cols.includes('not_before')) db.exec('alter table queue_items add column not_before text')
  // Run-as an already-signed-in instance ('desktop:<dir>' | 'cli:<id>') instead of a pasted
  // credential. Separate column from account_id because that one carries a REFERENCES accounts(id)
  // constraint (and foreign_keys is ON), so an encoded non-account value can't live there.
  if (!cols.includes('instance_ref'))
    db.exec('alter table queue_items add column instance_ref text')
  // How many times a transient-overload (529) retry has already re-run this item. In the DB rather
  // than in memory so a daemon that dies mid-backoff comes back to a queued row it still honours
  // (dispatch.ts dispatchDueRetries), instead of a timer that died with the process.
  if (!cols.includes('retry_attempts'))
    db.exec('alter table queue_items add column retry_attempts integer not null default 0')
}
{
  const cols = db
    .query<{ name: string }, []>('pragma table_info(monitor_state)')
    .all()
    .map((c) => c.name)
  // A stop DISCOVERED on disk (rate-limit-discovery.ts) has no queue_items row to join a title
  // out of — it was never dispatched by us — so the state row carries its own. Nullable: rows
  // written before this column keep resolving their title through the queue join, as before.
  if (!cols.includes('title')) db.exec('alter table monitor_state add column title text')
  // 1 = we found this session sitting at a limit on disk rather than watching it stop. Surfaced in
  // the UI so "the app went and found this one" never masquerades as something the user queued.
  if (!cols.includes('discovered'))
    db.exec('alter table monitor_state add column discovered integer not null default 0')
}

// --- one-time repair: rate_limited rows the old over-eager detector invented ---
// Until 2026-07-15 dispatch.ts matched its rate-limit patterns against EVERY event of a run,
// including tool results and tool inputs — so a run that merely READ the string "quota", or a file
// whose line 529 scrolled past, finished with status 'rate_limited' despite exiting 0 with the job
// done. Those phantom stops are not cosmetic: monitor.ts queues auto-resumes off exactly this
// status, so each one becomes a session the watchdog wants to re-prompt (or, before ambient usage
// reads landed, a permanent "needs you" chip). A process that exited 0 reported success and was by
// definition not cut off, so the status is simply wrong — correct it, and drop the monitor bookkeeping
// that only existed to babysit it. Idempotent: after the detector fix nothing new matches this.
{
  const bogus = db
    .query<{ id: string }, []>(
      "select id from queue_items where status = 'rate_limited' and exit_code = 0",
    )
    .all()
  if (bogus.length) {
    db.exec(
      "update queue_items set status = 'completed' where status = 'rate_limited' and exit_code = 0",
    )
    const del = db.query('delete from monitor_state where item_id = ?')
    for (const r of bogus) del.run(r.id)
    console.log(
      `[ccmanagerui] repaired ${bogus.length} run(s) mislabeled 'rate_limited' by the old detector (they exited 0)`,
    )
  }
}

// --- one-time repair: 529 overloads mislabeled as the user's rate limit -------
// Until the quota/transient split (rate-limit-signal.ts), dispatch.ts matched ONE pattern list that
// contained both "session limit" and "529"/"overloaded" — so a run killed by Anthropic's servers
// being saturated for a few seconds was filed identically to one that had spent its 5-hour window.
// Observed live: a run whose only two events were "session started" and "API Error: 529 Overloaded.
// This is a server-side issue, usually temporary" sat in the DB as 'rate_limited'. That is not
// cosmetic — monitor.ts resumes off exactly this status, so the row is a session the watchdog wants
// to re-prompt against a reset that was never coming.
//
// Reclassify ONLY rows whose recorded events show a transient overload and NO quota signal at all —
// the same conservative asymmetry classifyLimit() itself uses. A row that mentions both keeps its
// existing (quota) meaning. Idempotent: after the split nothing new lands in this state.
{
  const suspects = db
    .query<{ id: string }, []>("select id from queue_items where status = 'rate_limited'")
    .all()
  const eventsOf = db.query<{ text: string }, [string]>(
    'select text from run_events where queue_item_id = ?',
  )
  const overloads = suspects.filter(
    (r) =>
      classifyLimit(
        eventsOf
          .all(r.id)
          .map((e) => e.text)
          .join('\n'),
      ) === 'transient',
  )
  if (overloads.length) {
    const fix = db.query("update queue_items set status = 'overloaded' where id = ?")
    const del = db.query('delete from monitor_state where item_id = ?')
    for (const r of overloads) {
      fix.run(r.id)
      del.run(r.id)
    }
    console.log(
      `[ccmanagerui] repaired ${overloads.length} run(s) mislabeled 'rate_limited' that were really a transient 529 overload`,
    )
  }
}

// --- shared row coercion ------------------------------------------------------

/** sqlite has no booleans — new_chat/fork come back as 0/1. Every reader of queue_items needs this,
 *  so it lives with the table rather than as a fourth private copy (index/scheduler/monitor/dispatch
 *  each had their own). db.ts imports nothing of theirs, so this is cycle-free for all of them. */
export function coerceQueueItem(row: any): QueueItem {
  return { ...row, new_chat: !!row.new_chat, fork: !!row.fork }
}

// --- settings helpers -------------------------------------------------------

const DEFAULT_SETTINGS: Record<string, string> = {
  scheduler_enabled: '0',
  spacing_seconds: '60',
  poll_seconds: '5',
  max_concurrent: '3',
  portable_mode: '0',
  hide_tray_icon: '0',
  connections_sync: '',
  // '' = auto-detect an editor (server/src/transcript-open.ts); set to an absolute path to override.
  transcript_editor: '',
  // Auto-resume monitor (Feature E) — OFF by default (it auto-prompts sessions while you sleep).
  monitor_enabled: '0',
  monitor_max_attempts: '3',
  monitor_resume_buffer_min: '3',
}

export function getSetting(key: string): string {
  const row = db
    .query<{ value: string }, [string]>('select value from settings where key = ?')
    .get(key)
  return row?.value ?? DEFAULT_SETTINGS[key] ?? ''
}

export function setSetting(key: string, value: string): void {
  db.query(
    'insert into settings (key, value) values (?, ?) on conflict(key) do update set value = ?',
  ).run(key, value, value)
}

// Seed defaults once.
for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
  if (!db.query('select 1 from settings where key = ?').get(k)) setSetting(k, v)
}
