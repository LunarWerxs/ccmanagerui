import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'
import { join } from 'node:path'
import { CONFIG_DIR } from '../src/config'
import { listOpenCodeSessions, readOpenCodeSession } from '../src/opencode-sessions'

test('OpenCode SQLite sessions are listed and rendered from message/part rows', () => {
  const path = join(CONFIG_DIR, `opencode-${crypto.randomUUID()}.db`)
  const db = new Database(path)
  db.exec(`
    create table session (
      id text primary key, project_id text, directory text, title text,
      time_created integer, time_updated integer, time_archived integer
    );
    create table message (
      id text primary key, session_id text, time_created integer, data text
    );
    create table part (
      id text primary key, message_id text, session_id text, time_created integer, data text
    );
  `)
  db.query('insert into session values (?, ?, ?, ?, ?, ?, ?)').run(
    'ses_test',
    'project-1',
    'D:\\work',
    'OpenCode test',
    1000,
    4000,
    null,
  )
  db.query('insert into message values (?, ?, ?, ?)').run(
    'msg_user',
    'ses_test',
    2000,
    JSON.stringify({ role: 'user', time: { created: 2000 } }),
  )
  db.query('insert into message values (?, ?, ?, ?)').run(
    'msg_assistant',
    'ses_test',
    3000,
    JSON.stringify({ role: 'assistant', time: { created: 3000, completed: 4000 } }),
  )
  db.query('insert into part values (?, ?, ?, ?, ?)').run(
    'part_user',
    'msg_user',
    'ses_test',
    2000,
    JSON.stringify({ type: 'text', text: 'Please fix it.' }),
  )
  db.query('insert into part values (?, ?, ?, ?, ?)').run(
    'part_assistant',
    'msg_assistant',
    'ses_test',
    3000,
    JSON.stringify({ type: 'text', text: 'Fixed.' }),
  )
  db.close()

  expect(listOpenCodeSessions(path)).toEqual([
    {
      session_id: 'ses_test',
      project: 'project-1',
      cwd: 'D:\\work',
      title: 'OpenCode test',
      created_at: 1000,
      last_activity_at: 4000,
      archived: false,
      size_bytes: expect.any(Number),
    },
  ])
  const content = readOpenCodeSession('ses_test', path)
  expect(content?.messageCount).toBe(2)
  expect(content?.events.map((event) => [event.role, event.text])).toEqual([
    ['user', 'Please fix it.'],
    ['assistant', 'Fixed.'],
  ])
})
