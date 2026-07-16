import type { UpdateApplyResult, UpdateStatusWithDistribution } from '@/lib/api'
import * as api from '@/lib/api'
import { useSelfUpdate } from '@/lib/useSelfUpdate'

const { updateStatus, updateChecking, updateApplying, checkForUpdate, applyUpdate } = useSelfUpdate<
  UpdateStatusWithDistribution,
  UpdateApplyResult
>({
  checkUpdate: api.checkUpdate,
  applyUpdate: api.applyUpdate,
})

export function useUpdates() {
  return {
    updateStatus,
    updateChecking,
    updateApplying,
    checkForUpdate,
    applyUpdate,
  }
}
