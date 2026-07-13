import { Database } from 'bun:sqlite'
import { mkdirSync } from 'node:fs'
import { DATA_DIR, DB_PATH, RUN_LOG_DIR } from './config'

mkdirSync(DATA_DIR, { recursive: true })
mkdirSync(RUN_LOG_DIR, { recursive: true })

export const db = new Database(DB_PATH, { create: true })
db.exec('pragma journal_mode = WAL')
db.exec('pragma foreign_keys = ON')

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
  status          text not null default 'queued',  -- queued | running | completed | failed | rate_limited | canceled
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
`)

// --- additive migrations ----------------------------------------------------
// `create table if not exists` never alters an existing table, so columns added
// after a release must be backfilled here for databases created before them.
{
  const cols = db
    .query<{ name: string }, []>('pragma table_info(queue_items)')
    .all()
    .map((c) => c.name)
  if (!cols.includes('not_before')) db.exec('alter table queue_items add column not_before text')
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
