<script setup lang="ts">
// CLI Instances: a second, clearly-separate table below the desktop Instances table.
// A "CLI instance" is an isolated CLAUDE_CONFIG_DIR the daemon can spawn a real `claude`
// process against (as opposed to a Claude Desktop profile). Deliberately not merged into a
// unified per-account view: desktop and CLI instances have different lifecycles/actions.
import {
  ArrowDown,
  ArrowUp,
  EllipsisVertical,
  Link2,
  LogIn,
  Monitor,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Terminal,
  Trash2,
} from '@lucide/vue'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import AssociateCliInstanceDialog from '@/components/AssociateCliInstanceDialog.vue'
import CliInstanceNameDialog from '@/components/CliInstanceNameDialog.vue'
import DeleteCliInstanceDialog from '@/components/DeleteCliInstanceDialog.vue'
import LinkCliInstanceDialog from '@/components/LinkCliInstanceDialog.vue'
import UsageBadge from '@/components/UsageBadge.vue'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useCliInstances } from '@/composables/useCliInstances'
import { useData } from '@/composables/useData'
import { useInstances } from '@/composables/useInstances'
import { useSortable } from '@/composables/useSortable'
import { useUsage } from '@/composables/useUsage'
import type { CliInstance } from '@/lib/api'
import { bindingWeeklyPct, usageReasonMessageKey } from '@/lib/usage'

const {
  cliInstances,
  loading,
  busyIds,
  startPolling,
  stopPolling,
  refreshCliInstances,
  create,
  launch,
  login,
  rename,
  associate,
  linkDesktop,
  remove,
  checkUsage,
} = useCliInstances()
const { snapshotFor, isChecking, checkCli, reasonFor } = useUsage()
const { accounts, refreshAccounts } = useData()
// The desktop instances are the link targets. useInstances is a module singleton already loaded by
// InstancesView above us, so this is a read of the same list, not a second fetch.
const { instances: desktopInstances } = useInstances()

const { t } = useI18n()

const usageKey = (inst: CliInstance) => `cli:${inst.id}`
const usageFor = (inst: CliInstance) => snapshotFor(usageKey(inst))

const { sortedRows, toggleSort, indicatorFor } = useSortable(
  () => cliInstances.value,
  [
    { key: 'loggedIn', accessor: (i: CliInstance) => i.loggedIn },
    { key: 'name', accessor: (i: CliInstance) => i.name },
    { key: 'account', accessor: (i: CliInstance) => i.associatedAccountLabel ?? null },
    { key: 'desktop', accessor: (i: CliInstance) => i.associatedDesktopLabel ?? null },
    { key: 'configDir', accessor: (i: CliInstance) => i.configDir },
    {
      key: 'usage',
      accessor: (i: CliInstance) => {
        const snap = usageFor(i)
        return snap ? (bindingWeeklyPct(snap) ?? undefined) : undefined
      },
    },
  ],
)

function isBusy(inst: CliInstance): boolean {
  return busyIds.value.has(inst.id)
}

// --- create ---
const createOpen = ref(false)
const creating = ref(false)
const createError = ref<string | null>(null)
function openCreateDialog() {
  createError.value = null
  createOpen.value = true
}
async function onCreateSubmit(name: string) {
  creating.value = true
  createError.value = null
  try {
    const result = await create(name)
    if (result?.ok) {
      toast.success(t('cliInstances.toastCreated'))
      createOpen.value = false
    } else {
      createError.value = result?.message ?? t('cliInstances.toastCreateFailed')
    }
  } finally {
    creating.value = false
  }
}

// --- rename ---
const renameOpen = ref(false)
const renameTarget = ref<CliInstance | null>(null)
const renaming = ref(false)
const renameError = ref<string | null>(null)
function openRenameDialog(inst: CliInstance) {
  renameTarget.value = inst
  renameError.value = null
  renameOpen.value = true
}
async function onRenameSubmit(name: string) {
  const inst = renameTarget.value
  if (!inst) return
  renaming.value = true
  renameError.value = null
  try {
    const result = await rename(inst.id, name)
    if (result?.ok) {
      toast.success(t('cliInstances.toastRenamed'))
      renameOpen.value = false
      renameTarget.value = null
    } else {
      renameError.value = result?.message ?? t('cliInstances.toastRenameFailed')
    }
  } finally {
    renaming.value = false
  }
}

// --- associate ---
const associateOpen = ref(false)
const associateTarget = ref<CliInstance | null>(null)
const associating = ref(false)
const associateError = ref<string | null>(null)
function openAssociateDialog(inst: CliInstance) {
  associateTarget.value = inst
  associateError.value = null
  associateOpen.value = true
  void refreshAccounts()
}
async function onAssociateSubmit(accountId: string | null) {
  const inst = associateTarget.value
  if (!inst) return
  associating.value = true
  associateError.value = null
  try {
    const result = await associate(inst.id, accountId)
    if (result?.ok) {
      toast.success(t('cliInstances.toastAssociated'))
      associateOpen.value = false
      associateTarget.value = null
    } else {
      associateError.value = result?.message ?? t('cliInstances.toastAssociateFailed')
    }
  } finally {
    associating.value = false
  }
}

// --- link to a desktop instance ---
const linkOpen = ref(false)
const linkTarget = ref<CliInstance | null>(null)
const linking = ref(false)
const linkError = ref<string | null>(null)
function openLinkDialog(inst: CliInstance) {
  linkTarget.value = inst
  linkError.value = null
  linkOpen.value = true
}
async function onLinkSubmit(desktopDir: string | null) {
  const inst = linkTarget.value
  if (!inst) return
  linking.value = true
  linkError.value = null
  try {
    const result = await linkDesktop(inst.id, desktopDir)
    if (result?.ok) {
      toast.success(desktopDir ? t('cliInstances.toastLinked') : t('cliInstances.toastUnlinked'))
      linkOpen.value = false
      linkTarget.value = null
    } else {
      linkError.value = result?.message ?? t('cliInstances.toastLinkFailed')
    }
  } finally {
    linking.value = false
  }
}

// --- delete ---
const deleteOpen = ref(false)
const deleteTarget = ref<CliInstance | null>(null)
const deleting = ref(false)
const deleteError = ref<string | null>(null)
function openDeleteDialog(inst: CliInstance) {
  deleteTarget.value = inst
  deleteError.value = null
  deleteOpen.value = true
}
async function onDeleteConfirm(confirmName: string) {
  const inst = deleteTarget.value
  if (!inst) return
  deleting.value = true
  deleteError.value = null
  try {
    const result = await remove(inst.id, confirmName)
    if (result?.ok) {
      toast.success(t('cliInstances.toastDeleted'))
      deleteOpen.value = false
      deleteTarget.value = null
    } else {
      deleteError.value = result?.message ?? t('cliInstances.toastDeleteFailed')
    }
  } finally {
    deleting.value = false
  }
}

// --- launch / login / check usage ---
async function onLaunch(inst: CliInstance) {
  const result = await launch(inst.id)
  if (result?.ok) toast.success(t('cliInstances.toastLaunched'))
  else toast.error(result?.message ?? t('cliInstances.toastLaunchFailed'))
}
async function onLogin(inst: CliInstance) {
  const result = await login(inst.id)
  if (result?.ok) toast.success(t('cliInstances.toastLoginOpened'))
  else toast.error(result?.message ?? t('cliInstances.toastLoginFailed'))
}
async function onCheckUsage(inst: CliInstance) {
  const ok = await checkUsage(inst.id)
  if (!ok) {
    toast.error(t('cliInstances.toastUsageCheckFailed'))
    return
  }
  // The API call itself can succeed while still coming back with no usable numbers (no
  // login yet, no associated account, or the probe returned nothing). A manual click should
  // never go silent; a real result just updates the cell instead.
  const reasonKey = usageReasonMessageKey(reasonFor(usageKey(inst)))
  if (reasonKey) toast.error(t(reasonKey))
}
// The popover's inline "Check now" fires the same underlying probe as the kebab action, via
// useUsage.checkCli directly. checkUsage() above additionally refreshes the list (so
// lastUsageCheck / other fields stay current), which the popover doesn't need on its own.
async function onCheckUsageFromPopover(inst: CliInstance) {
  const ok = await checkCli(inst.id)
  if (!ok) {
    toast.error(t('cliInstances.toastUsageCheckFailed'))
  } else {
    const reasonKey = usageReasonMessageKey(reasonFor(usageKey(inst)))
    if (reasonKey) toast.error(t(reasonKey))
  }
  void refreshCliInstances({ silent: true })
}

const associateAccountOptions = computed(() => accounts.value)

onMounted(startPolling)
onUnmounted(stopPolling)
</script>

<template>
  <div class="border-t border-border">
    <div class="flex flex-wrap items-center justify-between gap-2 border-b border-border p-3">
      <div class="flex items-center gap-2 text-sm font-semibold">
        <Terminal class="size-4" />
        {{ $t('cliInstances.title') }}
        <span class="text-muted-foreground">({{ cliInstances.length }})</span>
      </div>
      <div class="flex flex-wrap items-center gap-1.5">
        <Button
          variant="outline"
          size="icon"
          :disabled="loading"
          :aria-label="$t('cliInstances.refresh')"
          :title="$t('cliInstances.refresh')"
          @click="refreshCliInstances()"
        >
          <RefreshCw :class="loading ? 'animate-spin' : ''" />
        </Button>
        <Button size="sm" @click="openCreateDialog">
          <Plus /> {{ $t('cliInstances.createInstance') }}
        </Button>
      </div>
    </div>

    <Table>
        <TableHeader class="sticky top-0 z-10 bg-background">
          <TableRow>
            <TableHead class="w-10 cursor-pointer select-none" @click="toggleSort('loggedIn')">
              <span class="inline-flex items-center gap-0.5">
                ● <ArrowUp v-if="indicatorFor('loggedIn') === 'asc'" class="size-3" />
                <ArrowDown v-else-if="indicatorFor('loggedIn') === 'desc'" class="size-3" />
              </span>
            </TableHead>
            <TableHead class="cursor-pointer select-none" @click="toggleSort('name')">
              <span class="inline-flex items-center gap-0.5">
                {{ $t('cliInstances.colName') }}
                <ArrowUp v-if="indicatorFor('name') === 'asc'" class="size-3" />
                <ArrowDown v-else-if="indicatorFor('name') === 'desc'" class="size-3" />
              </span>
            </TableHead>
            <TableHead class="cursor-pointer select-none" @click="toggleSort('account')">
              <span class="inline-flex items-center gap-0.5">
                {{ $t('cliInstances.colAccount') }}
                <ArrowUp v-if="indicatorFor('account') === 'asc'" class="size-3" />
                <ArrowDown v-else-if="indicatorFor('account') === 'desc'" class="size-3" />
              </span>
            </TableHead>
            <TableHead class="cursor-pointer select-none" @click="toggleSort('desktop')">
              <span class="inline-flex items-center gap-0.5">
                {{ $t('cliInstances.colDesktop') }}
                <ArrowUp v-if="indicatorFor('desktop') === 'asc'" class="size-3" />
                <ArrowDown v-else-if="indicatorFor('desktop') === 'desc'" class="size-3" />
              </span>
            </TableHead>
            <TableHead class="cursor-pointer select-none" @click="toggleSort('configDir')">
              <span class="inline-flex items-center gap-0.5">
                {{ $t('cliInstances.colConfigDir') }}
                <ArrowUp v-if="indicatorFor('configDir') === 'asc'" class="size-3" />
                <ArrowDown v-else-if="indicatorFor('configDir') === 'desc'" class="size-3" />
              </span>
            </TableHead>
            <TableHead class="cursor-pointer select-none" @click="toggleSort('usage')">
              <span class="inline-flex items-center gap-0.5">
                {{ $t('cliInstances.colUsage') }}
                <ArrowUp v-if="indicatorFor('usage') === 'asc'" class="size-3" />
                <ArrowDown v-else-if="indicatorFor('usage') === 'desc'" class="size-3" />
              </span>
            </TableHead>
            <TableHead class="text-right">{{ $t('cliInstances.colActions') }}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody v-if="cliInstances.length === 0">
          <TableEmpty v-if="!loading" :colspan="7">
            <div class="flex flex-col items-center gap-1 text-center">
              <Terminal class="mb-1 size-6 opacity-40" />
              <p class="font-medium text-foreground">{{ $t('cliInstances.empty') }}</p>
              <p class="text-xs text-muted-foreground">{{ $t('cliInstances.emptyHint') }}</p>
            </div>
          </TableEmpty>
          <TableRow v-for="i in 2" v-else :key="i">
            <TableCell><Skeleton class="size-2 rounded-full" /></TableCell>
            <TableCell><Skeleton class="h-4 w-28" /></TableCell>
            <TableCell><Skeleton class="h-5 w-20" /></TableCell>
            <TableCell><Skeleton class="h-5 w-20" /></TableCell>
            <TableCell><Skeleton class="h-3 w-32" /></TableCell>
            <TableCell><Skeleton class="h-5 w-14" /></TableCell>
            <TableCell>
              <div class="flex justify-end"><Skeleton class="h-6 w-20" /></div>
            </TableCell>
          </TableRow>
        </TableBody>
        <TableBody v-else>
          <TableRow v-for="inst in sortedRows" :key="inst.id">
            <TableCell>
              <span
                class="inline-block size-2 rounded-full"
                :class="inst.loggedIn ? 'bg-success' : 'bg-muted-foreground/40'"
                :title="inst.loggedIn ? $t('cliInstances.loggedIn') : $t('cliInstances.loggedOut')"
              />
            </TableCell>
            <TableCell class="font-medium">{{ inst.name }}</TableCell>
            <TableCell>
              <Badge v-if="inst.associatedAccountLabel" variant="outline">
                {{ inst.associatedAccountLabel }}
              </Badge>
              <span v-else class="text-xs text-muted-foreground">{{ $t('cliInstances.noAccount') }}</span>
            </TableCell>
            <TableCell>
              <Badge v-if="inst.associatedDesktopLabel" variant="outline" class="gap-1">
                <Monitor class="size-3" />{{ inst.associatedDesktopLabel }}
              </Badge>
              <span v-else class="text-xs text-muted-foreground">{{ $t('cliInstances.noDesktop') }}</span>
            </TableCell>
            <TableCell class="mono max-w-[16rem] truncate text-[0.625rem] text-muted-foreground">
              {{ inst.configDir }}
            </TableCell>
            <TableCell>
              <UsageBadge
                :snapshot="usageFor(inst)"
                :checking="isChecking(usageKey(inst)) || isBusy(inst)"
                :usage-key="usageKey(inst)"
                @check="onCheckUsageFromPopover(inst)"
              />
            </TableCell>
            <TableCell>
              <div class="flex items-center justify-end gap-1">
                <Button variant="outline" size="sm" :disabled="isBusy(inst)" @click="onLaunch(inst)">
                  <Play /> {{ $t('cliInstances.launch') }}
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger as-child>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      :aria-label="$t('cliInstances.moreActions')"
                    >
                      <EllipsisVertical />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" class="w-56">
                    <DropdownMenuItem :disabled="isBusy(inst)" @click="onLogin(inst)">
                      <LogIn /> {{ $t('cliInstances.login') }}
                    </DropdownMenuItem>
                    <DropdownMenuItem :disabled="isBusy(inst)" @click="openLinkDialog(inst)">
                      <Monitor /> {{ $t('cliInstances.linkDesktop') }}
                    </DropdownMenuItem>
                    <DropdownMenuItem :disabled="isBusy(inst)" @click="openAssociateDialog(inst)">
                      <Link2 /> {{ $t('cliInstances.associate') }}
                    </DropdownMenuItem>
                    <DropdownMenuItem :disabled="isBusy(inst)" @click="openRenameDialog(inst)">
                      <Pencil /> {{ $t('cliInstances.rename') }}
                    </DropdownMenuItem>
                    <DropdownMenuItem :disabled="isBusy(inst)" @click="onCheckUsage(inst)">
                      <RefreshCw /> {{ $t('cliInstances.checkUsage') }}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      variant="destructive"
                      :disabled="isBusy(inst)"
                      @click="openDeleteDialog(inst)"
                    >
                      <Trash2 /> {{ $t('cliInstances.delete') }}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>

    <CliInstanceNameDialog
      v-model:open="createOpen"
      mode="create"
      :submitting="creating"
      :error-message="createError"
      @submit="onCreateSubmit"
    />
    <CliInstanceNameDialog
      v-model:open="renameOpen"
      mode="rename"
      :current-name="renameTarget?.name ?? null"
      :submitting="renaming"
      :error-message="renameError"
      @submit="onRenameSubmit"
    />
    <AssociateCliInstanceDialog
      v-model:open="associateOpen"
      :instance-name="associateTarget?.name ?? null"
      :accounts="associateAccountOptions"
      :current-account-id="associateTarget?.associatedAccountId ?? null"
      :submitting="associating"
      :error-message="associateError"
      @submit="onAssociateSubmit"
    />
    <LinkCliInstanceDialog
      v-model:open="linkOpen"
      :instance-name="linkTarget?.name ?? null"
      :desktop-instances="desktopInstances"
      :current-desktop-dir="linkTarget?.associatedDesktopDir ?? null"
      :submitting="linking"
      :error-message="linkError"
      @submit="onLinkSubmit"
    />
    <DeleteCliInstanceDialog
      v-model:open="deleteOpen"
      :instance-name="deleteTarget?.name ?? null"
      :submitting="deleting"
      :error-message="deleteError"
      @confirm="onDeleteConfirm"
    />
  </div>
</template>
