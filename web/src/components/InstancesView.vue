<script setup lang="ts">
import {
  AppWindow,
  ArrowDown,
  ArrowUp,
  Boxes,
  EllipsisVertical,
  FolderOpen,
  MonitorDown,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Square,
  Trash2,
  TriangleAlert,
} from '@lucide/vue'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import CreateInstanceDialog from '@/components/CreateInstanceDialog.vue'
import DeleteInstanceDialog from '@/components/DeleteInstanceDialog.vue'
import RenameInstanceDialog from '@/components/RenameInstanceDialog.vue'
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
import { useInstances } from '@/composables/useInstances'
import { useSortable } from '@/composables/useSortable'
import type { CMDesktopInstall, CMInstance } from '@/lib/api'
import {
  CLASSIC_DESKTOP_INSTALLER_URL,
  DESKTOP_DOWNLOAD_PAGE_URL,
  getDesktopInstall,
} from '@/lib/api'
import { formatBytes, formatUptime } from '@/lib/format'
import { useTooltipConfig } from '@/lib/tooltip-config'
import IconTooltip from '@/shell/IconTooltip.vue'

const {
  instances,
  loading,
  busyDirs,
  startPolling,
  stopPolling,
  refreshInstances,
  open,
  quit,
  focus,
  revealFolder,
  createShortcut,
  create,
  remove,
  rename,
  resolveAccount,
} = useInstances()

const { t } = useI18n()
const { enabled: tooltipsEnabled } = useTooltipConfig()

const { sortedRows, toggleSort, indicatorFor } = useSortable(
  () => instances.value,
  [
    { key: 'running', accessor: (i: CMInstance) => i.isRunning },
    { key: 'name', accessor: (i: CMInstance) => i.name },
    { key: 'account', accessor: (i: CMInstance) => i.account?.email ?? i.account?.label ?? null },
    { key: 'pid', accessor: (i: CMInstance) => i.pid ?? undefined },
    { key: 'uptime', accessor: (i: CMInstance) => (i.isRunning ? i.startTime : null) },
    { key: 'memory', accessor: (i: CMInstance) => i.memoryBytes ?? undefined },
  ],
)

const createOpen = ref(false)
const creating = ref(false)
const createError = ref<string | null>(null)

const deleteOpen = ref(false)
const deleteTarget = ref<CMInstance | null>(null)
const deleting = ref(false)
const deleteError = ref<string | null>(null)

const renameOpen = ref(false)
const renameTarget = ref<CMInstance | null>(null)
const renaming = ref(false)
const renameError = ref<string | null>(null)

function accountLabel(inst: CMInstance): string | null {
  const acc = inst.account
  if (!acc) return null
  if (acc.label) return acc.label
  if (acc.email) return acc.rateLimitTier ? `${acc.email} · ${acc.rateLimitTier}` : acc.email
  return null
}

function accountBadgeVariant(inst: CMInstance) {
  switch (inst.account?.status) {
    case 'live':
      return 'success' as const
    case 'cache':
    case 'offline':
      return 'warning' as const
    case 'loggedout':
      return 'outline' as const
    default:
      return 'ghost' as const
  }
}

async function handleRefresh() {
  // fresh: bypass the server's 5-minute detection cache so installing the classic build and
  // hitting Refresh actually clears the warning banner below.
  await Promise.all([refreshInstances(), refreshDesktopInstall(true)])
}

async function onOpen(inst: CMInstance) {
  const result = await open(inst.dir)
  if (result?.ok) toast.success(t('instances.toastOpened'))
  // Prefer the server's failure message — it explains the MSIX-only case (same convention
  // as the create dialog surfacing result.message).
  else toast.error(result?.message ?? t('instances.toastOpenFailed'))
}
async function onQuit(inst: CMInstance) {
  const ok = await quit(inst.dir)
  if (ok) toast.success(t('instances.toastQuit'))
  else toast.error(t('instances.toastQuitFailed'))
}
async function onResolve(inst: CMInstance) {
  const ok = await resolveAccount(inst.dir)
  if (ok) toast.success(t('instances.toastResolved'))
  else toast.error(t('instances.toastResolveFailed'))
}
async function onFocus(inst: CMInstance) {
  if (!inst.isRunning || isBusy(inst)) return
  const result = await focus(inst.dir)
  if (result?.ok) toast.success(t('instances.toastFocused'))
  else toast.error(result?.message ?? t('instances.toastFocusFailed'))
}
async function onRevealFolder(inst: CMInstance) {
  const result = await revealFolder(inst.dir)
  if (!result?.ok) toast.error(result?.message ?? t('instances.toastRevealFailed'))
}
async function onCreateShortcut(inst: CMInstance) {
  if (isBusy(inst)) return
  const result = await createShortcut(inst.dir)
  if (result?.ok) toast.success(t('instances.toastShortcutCreated'))
  // Prefer the server's message — it explains the MSIX-only case, same as onOpen.
  else toast.error(result?.message ?? t('instances.toastShortcutFailed'))
}

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
      toast.success(t('instances.toastCreated'))
      createOpen.value = false
      if (result.needsBrowserDance) toast.info(t('instances.browserDanceBody'))
    } else {
      createError.value = result?.message ?? t('instances.toastCreateFailed')
    }
  } finally {
    creating.value = false
  }
}

function openRenameDialog(inst: CMInstance) {
  renameTarget.value = inst
  renameError.value = null
  renameOpen.value = true
}
async function onRenameSubmit(newName: string) {
  const inst = renameTarget.value
  if (!inst) return
  renaming.value = true
  renameError.value = null
  try {
    const result = await rename(inst.dir, newName)
    if (result?.ok) {
      toast.success(t('instances.toastRenamed'))
      renameOpen.value = false
      renameTarget.value = null
    } else {
      renameError.value = result?.message ?? t('instances.toastRenameFailed')
    }
  } finally {
    renaming.value = false
  }
}

function openDeleteDialog(inst: CMInstance) {
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
    const result = await remove(inst.dir, confirmName)
    if (result?.ok) {
      toast.success(t('instances.toastDeleted'))
      deleteOpen.value = false
      deleteTarget.value = null
    } else {
      deleteError.value = result?.message ?? t('instances.toastDeleteFailed')
    }
  } finally {
    deleting.value = false
  }
}

function isBusy(inst: CMInstance): boolean {
  return busyDirs.value.has(inst.dir)
}

// Windows ships two Claude Desktop builds; only the classic (Squirrel .exe) one can be
// launched with an isolated profile. Warn when this machine has only the MSIX package
// (or nothing at all) — see server/src/core/desktop-install.ts.
const desktopInstall = ref<CMDesktopInstall | null>(null)
const desktopWarning = computed<{ titleKey: string; bodyKey: string } | null>(() => {
  const d = desktopInstall.value
  if (d?.platform !== 'win32' || d.manageable) return null
  return d.msixDetected
    ? { titleKey: 'instances.desktopMsixTitle', bodyKey: 'instances.desktopMsixBody' }
    : { titleKey: 'instances.desktopNoneTitle', bodyKey: 'instances.desktopNoneBody' }
})

async function refreshDesktopInstall(fresh = false) {
  try {
    desktopInstall.value = await getDesktopInstall({ fresh })
  } catch {
    // Best-effort — keep the last known state (no banner when it never resolved).
  }
}

onMounted(() => {
  startPolling()
  refreshDesktopInstall()
})
onUnmounted(stopPolling)
</script>

<template>
  <div class="flex h-full flex-col">
    <div class="flex flex-wrap items-center justify-between gap-2 border-b border-border p-3">
      <div class="flex items-center gap-2 text-sm font-semibold">
        <Boxes class="size-4" />
        {{ $t('instances.title') }}
        <span class="text-muted-foreground">({{ instances.length }})</span>
      </div>
      <div class="flex flex-wrap items-center gap-1.5">
        <IconTooltip :label="$t('instances.refresh')" :description="$t('instances.refreshHint')">
          <Button
            variant="outline"
            size="icon"
            :disabled="loading"
            :aria-label="$t('instances.refresh')"
            @click="handleRefresh"
          >
            <RefreshCw :class="loading ? 'animate-spin' : ''" />
          </Button>
        </IconTooltip>
        <Button size="sm" @click="openCreateDialog">
          <Plus /> {{ $t('instances.createInstance') }}
        </Button>
      </div>
    </div>

    <div
      v-if="desktopWarning"
      class="flex items-start gap-2 border-b border-border bg-warning/10 px-3 py-2"
    >
      <TriangleAlert class="mt-0.5 size-4 shrink-0 text-warning" />
      <div class="min-w-0 text-sm">
        <p class="font-medium text-warning">{{ $t(desktopWarning.titleKey) }}</p>
        <p class="mt-0.5 text-xs text-muted-foreground">{{ $t(desktopWarning.bodyKey) }}</p>
        <p class="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs">
          <a
            :href="CLASSIC_DESKTOP_INSTALLER_URL"
            target="_blank"
            rel="noreferrer"
            class="font-medium text-warning underline underline-offset-2"
          >
            {{ $t('instances.desktopWarnDownload') }}
          </a>
          <a
            :href="DESKTOP_DOWNLOAD_PAGE_URL"
            target="_blank"
            rel="noreferrer"
            class="text-muted-foreground underline underline-offset-2"
          >
            {{ $t('instances.desktopWarnAllDownloads') }}
          </a>
        </p>
      </div>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto scroll-slim">
      <Table>
        <TableHeader class="sticky top-0 z-10 bg-background">
          <TableRow>
            <TableHead
              class="w-10 cursor-pointer select-none"
              :title="tooltipsEnabled ? $t('instances.sortByStatus') : undefined"
              @click="toggleSort('running')"
            >
              <span class="inline-flex items-center gap-0.5">
                ● <ArrowUp v-if="indicatorFor('running') === 'asc'" class="size-3" />
                <ArrowDown v-else-if="indicatorFor('running') === 'desc'" class="size-3" />
              </span>
            </TableHead>
            <TableHead class="cursor-pointer select-none" @click="toggleSort('name')">
              <span class="inline-flex items-center gap-0.5">
                {{ $t('instances.colName') }}
                <ArrowUp v-if="indicatorFor('name') === 'asc'" class="size-3" />
                <ArrowDown v-else-if="indicatorFor('name') === 'desc'" class="size-3" />
              </span>
            </TableHead>
            <TableHead class="cursor-pointer select-none" @click="toggleSort('account')">
              <span class="inline-flex items-center gap-0.5">
                {{ $t('instances.colAccount') }}
                <ArrowUp v-if="indicatorFor('account') === 'asc'" class="size-3" />
                <ArrowDown v-else-if="indicatorFor('account') === 'desc'" class="size-3" />
              </span>
            </TableHead>
            <TableHead class="cursor-pointer select-none" @click="toggleSort('pid')">
              <span class="inline-flex items-center gap-0.5">
                {{ $t('instances.colPid') }}
                <ArrowUp v-if="indicatorFor('pid') === 'asc'" class="size-3" />
                <ArrowDown v-else-if="indicatorFor('pid') === 'desc'" class="size-3" />
              </span>
            </TableHead>
            <TableHead class="cursor-pointer select-none" @click="toggleSort('uptime')">
              <span class="inline-flex items-center gap-0.5">
                {{ $t('instances.colUptime') }}
                <ArrowUp v-if="indicatorFor('uptime') === 'asc'" class="size-3" />
                <ArrowDown v-else-if="indicatorFor('uptime') === 'desc'" class="size-3" />
              </span>
            </TableHead>
            <TableHead class="cursor-pointer select-none" @click="toggleSort('memory')">
              <span class="inline-flex items-center gap-0.5">
                {{ $t('instances.colMemory') }}
                <ArrowUp v-if="indicatorFor('memory') === 'asc'" class="size-3" />
                <ArrowDown v-else-if="indicatorFor('memory') === 'desc'" class="size-3" />
              </span>
            </TableHead>
            <TableHead class="text-right">{{ $t('instances.colActions') }}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody v-if="instances.length === 0" class="[&>tr]:transition-colors [&>tr]:duration-200">
          <TableEmpty v-if="!loading" :colspan="7">
            <div class="flex flex-col items-center gap-1 text-center">
              <Boxes class="mb-1 size-6 opacity-40" />
              <p class="font-medium text-foreground">{{ $t('instances.empty') }}</p>
              <p class="text-xs text-muted-foreground">{{ $t('instances.emptyHint') }}</p>
            </div>
          </TableEmpty>
          <!-- first-load skeleton rows so the table never looks blank -->
          <TableRow v-for="i in 4" v-else :key="i">
            <TableCell><Skeleton class="size-2 rounded-full" /></TableCell>
            <TableCell>
              <Skeleton class="h-4" :style="{ width: `${9 - (i % 3) * 2}rem` }" />
              <Skeleton class="mt-1.5 h-3 w-44" />
            </TableCell>
            <TableCell><Skeleton class="h-5 w-24" /></TableCell>
            <TableCell><Skeleton class="h-3 w-10" /></TableCell>
            <TableCell><Skeleton class="h-3 w-12" /></TableCell>
            <TableCell><Skeleton class="h-3 w-14" /></TableCell>
            <TableCell>
              <div class="flex justify-end"><Skeleton class="h-6 w-20" /></div>
            </TableCell>
          </TableRow>
        </TableBody>
        <TransitionGroup
          v-else
          tag="tbody"
          name="row-fade"
          data-slot="table-body"
          class="[&_tr:last-child]:border-0 [&>tr]:transition-colors [&>tr]:duration-200"
        >
          <TableRow v-for="inst in sortedRows" :key="inst.dir">
            <TableCell>
              <span
                class="inline-block size-2 rounded-full"
                :class="inst.isRunning ? 'bg-success animate-pulse' : 'bg-muted-foreground/40'"
                :title="inst.isRunning ? $t('instances.running') : $t('instances.stopped')"
              />
            </TableCell>
            <TableCell class="font-medium">
              <div class="flex items-center gap-1.5">
                <IconTooltip v-if="inst.isRunning" :label="$t('instances.focus')" :description="$t('instances.focusHint')">
                  <button
                    type="button"
                    class="cursor-pointer text-left hover:underline"
                    :disabled="isBusy(inst)"
                    @click="onFocus(inst)"
                  >
                    {{ inst.name }}
                  </button>
                </IconTooltip>
                <span v-else class="cursor-default">{{ inst.name }}</span>
                <Badge v-if="inst.isExternal" variant="outline">{{ $t('instances.external') }}</Badge>
              </div>
              <div class="mono max-w-[22rem] truncate text-[0.625rem] text-muted-foreground">
                {{ inst.dir }}
              </div>
            </TableCell>
            <TableCell>
              <Badge v-if="accountLabel(inst)" :variant="accountBadgeVariant(inst)">
                {{ accountLabel(inst) }}
              </Badge>
              <Badge v-else-if="inst.account?.status === 'loggedout'" variant="outline">
                {{ $t('instances.loggedOut') }}
              </Badge>
              <Button
                v-else
                variant="ghost"
                size="xs"
                :disabled="isBusy(inst)"
                @click="onResolve(inst)"
              >
                {{ $t('instances.resolve') }}
              </Button>
            </TableCell>
            <TableCell class="mono text-xs text-muted-foreground">{{ inst.pid ?? '—' }}</TableCell>
            <TableCell class="text-xs text-muted-foreground">
              {{ inst.isRunning ? formatUptime(inst.startTime) : '—' }}
            </TableCell>
            <TableCell class="text-xs text-muted-foreground">{{ formatBytes(inst.memoryBytes) }}</TableCell>
            <TableCell>
              <div class="flex items-center justify-end gap-1">
                <Button
                  v-if="!inst.isRunning"
                  variant="outline"
                  size="sm"
                  :disabled="isBusy(inst)"
                  @click="onOpen(inst)"
                >
                  <Play /> {{ $t('instances.open') }}
                </Button>
                <Button v-else variant="outline" size="sm" :disabled="isBusy(inst)" @click="onQuit(inst)">
                  <Square /> {{ $t('instances.quit') }}
                </Button>

                <DropdownMenu>
                  <!-- No tooltip wrapper here: the kebab is self-explanatory, and nesting a
                       TooltipTrigger around the DropdownMenuTrigger swallowed the click so the
                       menu never opened (and the zero-delay tooltip was intrusive). aria-label
                       keeps it accessible. -->
                  <DropdownMenuTrigger as-child>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      :aria-label="$t('instances.moreActions')"
                    >
                      <EllipsisVertical />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      :disabled="!inst.isRunning || isBusy(inst)"
                      @click="onFocus(inst)"
                    >
                      <AppWindow /> {{ $t('instances.focus') }}
                    </DropdownMenuItem>
                    <DropdownMenuItem :disabled="isBusy(inst)" @click="onResolve(inst)">
                      <RefreshCw /> {{ $t('instances.resolve') }}
                    </DropdownMenuItem>
                    <DropdownMenuItem :disabled="isBusy(inst)" @click="onRevealFolder(inst)">
                      <FolderOpen /> {{ $t('instances.openFolder') }}
                    </DropdownMenuItem>
                    <DropdownMenuItem :disabled="isBusy(inst)" @click="onCreateShortcut(inst)">
                      <MonitorDown /> {{ $t('instances.createShortcut') }}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      :disabled="inst.isRunning || isBusy(inst) || inst.isExternal"
                      @click="openRenameDialog(inst)"
                    >
                      <Pencil /> {{ $t('instances.rename') }}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      variant="destructive"
                      :disabled="inst.isRunning || isBusy(inst)"
                      @click="openDeleteDialog(inst)"
                    >
                      <Trash2 /> {{ $t('instances.delete') }}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </TableCell>
          </TableRow>
        </TransitionGroup>
      </Table>
    </div>

    <CreateInstanceDialog
      v-model:open="createOpen"
      :submitting="creating"
      :error-message="createError"
      @submit="onCreateSubmit"
    />
    <DeleteInstanceDialog
      v-model:open="deleteOpen"
      :instance-name="deleteTarget?.name ?? null"
      :submitting="deleting"
      :error-message="deleteError"
      @confirm="onDeleteConfirm"
    />
    <RenameInstanceDialog
      v-model:open="renameOpen"
      :current-name="renameTarget?.name ?? null"
      :submitting="renaming"
      :error-message="renameError"
      @submit="onRenameSubmit"
    />
  </div>
</template>

<style scoped>
.row-fade-enter-active,
.row-fade-leave-active {
  transition:
    opacity 200ms ease,
    transform 200ms ease;
}
.row-fade-enter-from {
  opacity: 0;
  transform: translateY(-4px);
}
.row-fade-leave-to {
  opacity: 0;
}
.row-fade-leave-active {
  position: relative;
}
.row-fade-move {
  transition: transform 200ms ease;
}
</style>
