// A single boot-completion flag, in its own module so the auto-dispatchers (scheduler, monitor)
// can read it without importing the daemon entrypoint or the dispatch module.
//
// WHY: server/src/dispatch.ts's reattachRuns() rebuilds the `active` map for `claude` runs that
// OUTLIVED the previous daemon. But the scheduler's timer arms itself at import time (scheduler.ts),
// i.e. BEFORE reattachRuns() has finished — so for a brief window a surviving run's session is not
// yet in `active`, isSessionActive() returns false, and a scheduler/monitor tick could dispatch a
// SECOND `claude` against that same session (two --resume of one transcript interleaving writes).
// Gate the auto-dispatchers on this flag; index.ts flips it once reattachRuns() settles.

let dispatchReady = false

/** Set by index.ts after reattachRuns() settles (resolve OR reject — we tried, proceed either way).
 *  Fail-closed until then: an unattached surviving run must never be double-dispatched. */
export function markDispatchReady(): void {
  dispatchReady = true
}

/** True once reattach has settled and it's safe for the scheduler/monitor to dispatch. The manual
 *  "Run now" button is NOT gated on this (a human click in the sub-second boot window is a non-issue
 *  and dispatchItem's own isSessionActive lock still protects it). */
export function isDispatchReady(): boolean {
  return dispatchReady
}
