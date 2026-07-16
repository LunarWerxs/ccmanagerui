// Cross-site request guard for the loopback API.
//
// THE THREAT (classic local-daemon CSRF, e.g. the Jupyter/Selenium/dev-server CVE class): this
// daemon binds 127.0.0.1 and its REST API has no auth — by design, it's a single-user local tool.
// But "loopback + no auth" is NOT private: a browser will happily let ANY web page the user visits
// send requests to http://127.0.0.1:<port>. Without a guard, a malicious page could POST /api/queue
// with `permission_mode: bypassPermissions` and an attacker-controlled prompt+cwd, then
// /api/queue/run-due, and the daemon would run the real `claude` CLI with the user's own
// credentials and no approval prompt — drive-by remote code execution. It could also GET
// /api/sessions to exfiltrate transcripts.
//
// THE DEFENSE (no tokens, no client changes, robust to the "simple request" bypass): the browser
// itself tells us the request's provenance in headers JS CANNOT forge:
//   · `Sec-Fetch-Site` — the browser sets this on every fetch/navigation. A page on another site
//     gets `cross-site`; our own SPA gets `same-origin`; the dev SPA (:5173 → :7787) gets
//     `same-site`. It is a Forbidden header — page script cannot override it. Reject `cross-site`.
//   · `Origin` — present on all cross-origin requests (including a "simple" text/plain POST that
//     skips CORS preflight, which is exactly how the naive CORS-only fix gets bypassed). If it's
//     present and its host isn't loopback, reject. This ALSO stops DNS-rebinding (evil.com → A
//     record 127.0.0.1: the page's Origin is still evil.com).
//   · `Host` — reject a Host header that isn't loopback (a second DNS-rebinding backstop).
// A request with NONE of these browser markers (curl, the tray's health probe, an MCP client, the
// single-instance probe) is NOT a browser-CSRF vector and is allowed — those are same-machine tools
// the user ran deliberately, and a local attacker who can run curl already owns the session.
//
// This is deliberately a header-provenance check, NOT a CORS allowlist: CORS governs whether a
// cross-origin response is READABLE, but the write-side CSRF damage is done the moment the request
// is PROCESSED, regardless of whether the attacker can read the reply. Sec-Fetch-Site/Origin gate
// the request itself. cors() is still narrowed (index.ts) as defense-in-depth for reads.

import type { MiddlewareHandler } from 'hono'

/** Hostname is loopback (the only interface this daemon binds). Accepts IPv4/IPv6 loopback + the
 *  `localhost` name; strips a `:port` and IPv6 brackets first. */
function isLoopbackHost(hostHeader: string | undefined): boolean {
  if (!hostHeader) return false
  // host may be "127.0.0.1:7787", "localhost:7787", "[::1]:7787"
  let host = hostHeader.trim().toLowerCase()
  // strip IPv6 brackets + port
  if (host.startsWith('[')) {
    const close = host.indexOf(']')
    host = close >= 0 ? host.slice(1, close) : host.slice(1)
  } else {
    const colon = host.lastIndexOf(':')
    if (colon >= 0) host = host.slice(0, colon)
  }
  return host === '127.0.0.1' || host === 'localhost' || host === '::1'
}

/** The origin string (scheme://host[:port]) has a loopback host. For the CORS origin allowlist. */
export function isLoopbackOrigin(origin: string): boolean {
  try {
    return isLoopbackHost(new URL(origin).host)
  } catch {
    return false
  }
}

/** The Origin header's host is loopback (or the header is absent — many legitimate same-origin
 *  requests omit it). A present, non-loopback Origin is a cross-site/rebinding request → block. */
function originIsLoopbackOrAbsent(originHeader: string | undefined): boolean {
  if (!originHeader || originHeader === 'null') return originHeader !== 'null' // 'null' origin (sandboxed/file) is NOT trusted
  try {
    return isLoopbackHost(new URL(originHeader).host)
  } catch {
    return false // unparseable Origin → treat as untrusted
  }
}

export interface LoopbackGuardResult {
  ok: boolean
  reason?: string
}

/** Pure decision function (exported for tests): should this request's headers be allowed? */
export function evaluateRequest(headers: {
  secFetchSite?: string
  origin?: string
  host?: string
}): LoopbackGuardResult {
  // 1. Sec-Fetch-Site: a modern browser's unforgeable provenance signal. Only `cross-site` is a
  //    drive-by from another origin; `same-origin`/`same-site`/`none` are our SPA (or the dev SPA,
  //    or a top-level navigation the user typed). Absent → non-browser client, allowed.
  if (headers.secFetchSite && headers.secFetchSite.toLowerCase() === 'cross-site') {
    return { ok: false, reason: 'cross-site request rejected' }
  }
  // 2. Origin present but non-loopback → cross-origin write / DNS-rebinding, even without a
  //    Sec-Fetch-Site header (older browsers) or on a "simple" no-preflight POST.
  if (!originIsLoopbackOrAbsent(headers.origin)) {
    return { ok: false, reason: 'non-loopback Origin rejected' }
  }
  // 3. Host must be loopback (a browser rebinding evil.com → 127.0.0.1 sends Host: evil.com).
  if (!isLoopbackHost(headers.host)) {
    return { ok: false, reason: 'non-loopback Host rejected' }
  }
  return { ok: true }
}

/** Hono middleware: apply to the API surface. Blocks browser cross-site requests with 403; lets
 *  same-origin (SPA), same-site (dev), and non-browser (curl/tray/MCP) requests through. */
export const loopbackGuard: MiddlewareHandler = async (c, next) => {
  const verdict = evaluateRequest({
    secFetchSite: c.req.header('sec-fetch-site'),
    origin: c.req.header('origin'),
    host: c.req.header('host'),
  })
  if (!verdict.ok) {
    return c.json({ error: `forbidden: ${verdict.reason}` }, 403)
  }
  await next()
}
