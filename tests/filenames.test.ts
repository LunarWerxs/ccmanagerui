// tests/filenames.test.ts — the download name for a session transcript (server/src/filenames.ts).
//
// Pure string logic, but it feeds two places that must agree (the SPA's <a download> and the /file
// Content-Disposition), and it is the only thing between an AI-written session title and the
// filesystem. The nasty cases are the point: a title is arbitrary user/model prose, so it routinely
// contains ':' and '/', sometimes emoji, and occasionally nothing usable at all.

import { expect, test } from 'bun:test'
import {
  contentDispositionAttachment,
  safeFileBase,
  safeTranscriptFilename,
} from '../server/src/filenames'

const SID = '87e6c2e7-71a4-4f0c-9c2e-000000000000'

test('names the file after the session title, not the id', () => {
  expect(safeTranscriptFilename('Fix the login redirect loop', SID)).toBe(
    'Fix the login redirect loop.jsonl',
  )
})

test('strips characters Windows refuses in a filename', () => {
  // A title like this is completely ordinary for a coding session.
  expect(safeFileBase('fix: api/v2 <auth> "token" | retry?')).toBe('fix api v2 auth token retry')
})

test('drops control characters rather than writing raw bytes into a name', () => {
  expect(safeFileBase('tab\tand\nnewline')).toBe('tab and newline')
})

test('trims the trailing dots and spaces Windows would silently drop anyway', () => {
  // Windows stores "report..." as "report" — so the name we show must already be the name on disk.
  expect(safeFileBase('report...')).toBe('report')
  expect(safeFileBase('report   ')).toBe('report')
})

test('falls back to the session id when no usable characters survive', () => {
  // An all-symbol or all-emoji title sanitizes to nothing; the id is the only name left.
  expect(safeFileBase('///')).toBe('')
  expect(safeTranscriptFilename('///', SID)).toBe(`${SID}.jsonl`)
  expect(safeTranscriptFilename('', SID)).toBe(`${SID}.jsonl`)
  expect(safeTranscriptFilename(null, SID)).toBe(`${SID}.jsonl`)
})

test('refuses the Windows reserved device names', () => {
  // 'con.jsonl' is unwritable on Windows no matter the extension.
  expect(safeFileBase('CON')).toBe('_CON')
  expect(safeFileBase('com1')).toBe('_com1')
  expect(safeFileBase('console')).toBe('console') // only the exact names are reserved
})

test('caps the leaf so the browser still has room for its own (1) suffix', () => {
  const base = safeFileBase('x'.repeat(400))
  expect(base.length).toBe(120)
})

test('keeps unicode in the name — it is legal on disk, only the header needs care', () => {
  expect(safeTranscriptFilename('café ☕ notes', SID)).toBe('café ☕ notes.jsonl')
})

test('content-disposition carries an ASCII filename AND the exact unicode one', () => {
  const v = contentDispositionAttachment('café ☕.jsonl')
  // The ASCII copy must be a legal header ByteString — interpolating the raw emoji throws in
  // Bun/undici's Headers, which would 500 the /file route instead of just naming the file oddly.
  const ascii = /filename="([^"]*)"/.exec(v)?.[1] ?? ''
  expect(/^[\x20-\x7E]*$/.test(ascii)).toBe(true)
  expect(v).toContain("filename*=UTF-8''")
  expect(v).toContain(encodeURIComponent('café ☕.jsonl'))
})

test('content-disposition escapes quotes out of the ASCII quoted-string', () => {
  const v = contentDispositionAttachment('say "hi".jsonl')
  const ascii = /filename="([^"]*)"/.exec(v)?.[1] ?? ''
  expect(ascii).not.toContain('"')
  expect(ascii).toBe('say _hi_.jsonl')
})

test('a real header accepts the value (the ByteString guard, end to end)', () => {
  // The actual failure this prevents: `new Response(..., { headers })` throwing on a unicode title.
  const filename = safeTranscriptFilename('日本語 セッション 🎌', SID)
  const res = new Response('x', {
    headers: { 'content-disposition': contentDispositionAttachment(filename) },
  })
  expect(res.headers.get('content-disposition')).toContain("filename*=UTF-8''")
})
