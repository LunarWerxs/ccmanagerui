// Self-update adapter — thin per-app wiring over the shared kit engine (`createUpdater`,
// synced in as `./updater-engine.mjs`). Factored out of index.ts so both the on-demand
// /api/update* endpoints and the background auto-update loop (./auto-update.ts) share one
// instance instead of constructing the updater twice.
import { APP_ROOT, SERVICE_NAME } from './config'
import { createUpdater, type UpdateApplyResult, type UpdateStatus } from './updater-engine.mjs'

export type { UpdateApplyResult, UpdateStatus }

const updater = createUpdater({
  appRoot: APP_ROOT,
  serviceName: SERVICE_NAME,
  appLabel: 'CC Manager UI',
  updateRepoEnvVar: 'CCMANAGERUI_UPDATE_REPO',
  installCmd: ['bun', 'install'],
  buildCmd: ['bun', 'run', '--cwd', 'web', 'build'],
})

export function checkForUpdate(): Promise<UpdateStatus> {
  return updater.checkForUpdate()
}

export function applyUpdate(): Promise<UpdateApplyResult> {
  return updater.applyUpdate()
}
