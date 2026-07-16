import { describe, expect, test } from 'bun:test'
import { evaluateRequest, isLoopbackOrigin } from '../src/loopback-guard'

const LOOPBACK_HOST = '127.0.0.1:7787'

describe('loopback-guard: cross-site CSRF defense', () => {
  test('SPA same-origin request is allowed', () => {
    expect(
      evaluateRequest({
        secFetchSite: 'same-origin',
        origin: 'http://127.0.0.1:7787',
        host: LOOPBACK_HOST,
      }).ok,
    ).toBe(true)
  })

  test('dev SPA (:5173 -> :7787, same-site) is allowed', () => {
    expect(
      evaluateRequest({
        secFetchSite: 'same-site',
        origin: 'http://127.0.0.1:5173',
        host: LOOPBACK_HOST,
      }).ok,
    ).toBe(true)
    // localhost hostname variant too
    expect(
      evaluateRequest({
        secFetchSite: 'same-site',
        origin: 'http://localhost:5173',
        host: 'localhost:7787',
      }).ok,
    ).toBe(true)
  })

  test('non-browser client (curl / tray / MCP: no browser headers) is allowed', () => {
    expect(evaluateRequest({ host: LOOPBACK_HOST }).ok).toBe(true)
  })

  test('THE ATTACK: a malicious page cross-site request is REJECTED (Sec-Fetch-Site)', () => {
    const v = evaluateRequest({
      secFetchSite: 'cross-site',
      origin: 'https://evil.example',
      host: LOOPBACK_HOST,
    })
    expect(v.ok).toBe(false)
  })

  test('simple no-preflight cross-origin POST (no Sec-Fetch-Site) still caught by Origin', () => {
    // An older browser or a "simple" request may omit Sec-Fetch-Site, but a cross-origin POST
    // still carries Origin — the CORS-bypass the naive fix misses.
    const v = evaluateRequest({ origin: 'https://evil.example', host: LOOPBACK_HOST })
    expect(v.ok).toBe(false)
  })

  test('DNS rebinding (evil.com A-record -> 127.0.0.1) caught by Host + Origin', () => {
    // The page is served from evil.com which resolves to 127.0.0.1; from the browser it looks
    // same-origin (Sec-Fetch-Site: same-origin) but Host + Origin are evil.com.
    const v = evaluateRequest({
      secFetchSite: 'same-origin',
      origin: 'http://evil.com',
      host: 'evil.com',
    })
    expect(v.ok).toBe(false)
  })

  test("a 'null' opaque origin (sandboxed iframe / file://) is rejected", () => {
    expect(evaluateRequest({ origin: 'null', host: LOOPBACK_HOST }).ok).toBe(false)
  })

  test('non-loopback Host alone (rebinding backstop) is rejected', () => {
    expect(evaluateRequest({ host: 'attacker.test' }).ok).toBe(false)
  })

  test('isLoopbackOrigin helper', () => {
    expect(isLoopbackOrigin('http://127.0.0.1:7787')).toBe(true)
    expect(isLoopbackOrigin('http://localhost:9999')).toBe(true)
    expect(isLoopbackOrigin('http://[::1]:7787')).toBe(true)
    expect(isLoopbackOrigin('https://evil.example')).toBe(false)
    expect(isLoopbackOrigin('not a url')).toBe(false)
  })
})
