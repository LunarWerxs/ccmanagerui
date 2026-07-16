// Self-update adapter — thin per-app wiring over the shared kit engine (`createUpdater`,
// synced in as `./updater-engine.mjs`). Factored out of index.ts so both the on-demand
// /api/update* endpoints and the background auto-update loop (./auto-update.ts) share one
// instance instead of constructing the updater twice.
//
// COMPILED builds (bun build --compile, the GitHub-release zips) have no .git and no server/src —
// the engine's git-pull + rebuild mechanism cannot apply there BY DESIGN, so both entry points
// answer honestly with a "download the latest release" pointer instead of limping into a
// guaranteed-to-fail git invocation. A release-asset-based self-updater is a possible follow-up;
// until then compiled builds update by downloading the next release.
import { APP_ROOT, IS_COMPILED, SERVICE_NAME, VERSION } from './config'
import { createUpdater, type UpdateApplyResult, type UpdateStatus } from './updater-engine.mjs'

export type { UpdateApplyResult, UpdateStatus }

const RELEASES_URL = 'https://github.com/LunarWerxs/ccmanagerui/releases'

const updater = createUpdater({
  appRoot: APP_ROOT,
  serviceName: SERVICE_NAME,
  appLabel: 'CC Manager UI',
  updateRepoEnvVar: 'CCMANAGERUI_UPDATE_REPO',
  installCmd: ['bun', 'install'],
  buildCmd: ['bun', 'run', '--cwd', 'web', 'build'],
})

function compiledStatus(): UpdateStatus {
  return {
    ok: false,
    service: SERVICE_NAME,
    currentVersion: VERSION,
    currentCommit: null,
    remoteCommit: null,
    branch: null,
    upstream: null,
    remote: null,
    dirty: false,
    updateAvailable: false,
    canApply: false,
    checkedAt: Date.now(),
    reason: `self-update is unavailable in this packaged build — download the latest release from ${RELEASES_URL}`,
  }
}

export function checkForUpdate(): Promise<UpdateStatus> {
  if (IS_COMPILED) return Promise.resolve(compiledStatus())
  return updater.checkForUpdate()
}

export function applyUpdate(): Promise<UpdateApplyResult> {
  if (IS_COMPILED) {
    const status = compiledStatus()
    return Promise.resolve({
      ok: false,
      message: status.reason ?? 'self-update is unavailable in this packaged build',
      restartRequired: false,
      status,
      output: [],
    })
  }
  return updater.applyUpdate()
}
