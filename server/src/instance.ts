// Running-instance pointer — thin per-app adapter over the shared kit factory
// (`createInstancePointer`, synced in as `./instance-pointer.mjs`). The daemon records the
// port it ACTUALLY bound in <CONFIG_DIR>/runtime.json so the tray launcher and the
// /api/health probe can find it and enforce single-instance. Best-effort throughout.
import { CONFIG_DIR, HOST, SERVICE_NAME } from './config'
import { createInstancePointer, type InstanceInfo } from './instance-pointer.mjs'

export type { InstanceInfo }

const pointer = createInstancePointer({
  configDir: CONFIG_DIR,
  serviceName: SERVICE_NAME,
  host: HOST,
})

export const instanceFilePath = pointer.instanceFilePath
export const writeInstanceInfo = pointer.writeInstanceInfo
export const updateInstanceInfo = pointer.updateInstanceInfo
export const readInstanceInfo = pointer.readInstanceInfo
export const clearInstanceInfo = pointer.clearInstanceInfo
export const findLiveInstance = pointer.findLiveInstance
