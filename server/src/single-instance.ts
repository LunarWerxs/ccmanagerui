/**
 * Whether this process must SKIP the single-instance "/api/health" guard in index.ts.
 *
 * Two cases skip it:
 *  - CCMANAGERUI_PORT_FIXED=1: the dev launcher pins the port and runs its own pre-flight.
 *  - CCMANAGERUI_RELAUNCH=1: the auto-update successor. Its predecessor is still alive and
 *    answering /api/health during the ~800ms handoff, so probing here would see
 *    "already running" and make the successor exit, leaving ZERO daemons. It instead
 *    takes over the port via waitForPortFree().
 *
 * Kept pure and in its own module so it can be unit-tested without importing index.ts
 * (which boots the daemon on import). This is the regression guard for the relaunch
 * zero-instances race: if the CCMANAGERUI_RELAUNCH branch is ever dropped, the test fails.
 */
export function skipSingleInstanceGuard(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.CCMANAGERUI_PORT_FIXED === '1' || env.CCMANAGERUI_RELAUNCH === '1'
}
