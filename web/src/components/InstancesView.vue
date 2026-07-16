<script setup lang="ts">
import {
  AppWindow,
  ArrowDown,
  ArrowUp,
  Boxes,
  EllipsisVertical,
  FolderOpen,
  Gauge,
  LogIn,
  MonitorDown,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Square,
  Terminal,
  Trash2,
  TriangleAlert,
  Unlink,
} from '@lucide/vue'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import CliInstancesSection from '@/components/CliInstancesSection.vue'
import CreateInstanceDialog from '@/components/CreateInstanceDialog.vue'
import DeleteInstanceDialog from '@/components/DeleteInstanceDialog.vue'
import EditInstanceDialog from '@/components/EditInstanceDialog.vue'
import QuitExternalInstanceDialog from '@/components/QuitExternalInstanceDialog.vue'
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
import { useAppSettings } from '@/composables/useAppSettings'
import { useCliInstances } from '@/composables/useCliInstances'
import { useInstances } from '@/composables/useInstances'
import { useSortable } from '@/composables/useSortable'
import { useUsage } from '@/composables/useUsage'
import type { CliInstance, CMDesktopInstall, CMInstance } from '@/lib/api'
import {
  CLASSIC_DESKTOP_INSTALLER_URL,
  DESKTOP_DOWNLOAD_PAGE_URL,
  getDesktopInstall,
} from '@/lib/api'
import { formatBytes, formatUptime } from '@/lib/format'
import {
  colorValue,
  displayName,
  iconComponent,
  resolveColorKey,
  resolveIconKey,
} from '@/lib/instance-appearance'
import { useTooltipConfig } from '@/lib/tooltip-config'
import { bindingWeeklyPct, usageReasonMessageKey } from '@/lib/usage'
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
  setAppearance,
} = useInstances()

const { t } = useI18n()
const { enabled: tooltipsEnabled } = useTooltipConfig()
const {
  snapshotFor,
  isChecking,
  checkDesktop,
  reasonFor,
  startPolling: startUsagePolling,
  stopPolling: stopUsagePolling,
} = useUsage()

const usageKeyFor = (inst: CMInstance) => `desktop:${inst.dir}`
const usageFor = (inst: CMInstance) => snapshotFor(usageKeyFor(inst))

const { sortedRows, toggleSort, indicatorFor } = useSortable(
  () => instances.value,
  [
    { key: 'running', accessor: (i: CMInstance) => i.isRunning },
    // sort by what the cell actually shows (the display label, falling back to folder name)
    { key: 'name', accessor: (i: CMInstance) => displayName(i) },
    { key: 'account', accessor: (i: CMInstance) => i.account?.email ?? i.account?.label ?? null },
    { key: 'pid', accessor: (i: CMInstance) => i.pid ?? undefined },
    { key: 'uptime', accessor: (i: CMInstance) => (i.isRunning ? i.startTime : null) },
    { key: 'memory', accessor: (i: CMInstance) => i.memoryBytes ?? undefined },
    {
      key: 'usage',
      accessor: (i: CMInstance) => {
        const snap = usageFor(i)
        return snap ? (bindingWeeklyPct(snap) ?? undefined) : undefined
      },
    },
  ],
)

const createOpen = ref(false)
const creating = ref(false)
const createError = ref<string | null>(null)

const deleteOpen = ref(false)
const deleteTarget = ref<CMInstance | null>(null)
const deleting = ref(false)
const deleteError = ref<string | null>(null)

const editOpen = ref(false)
const editTarget = ref<CMInstance | null>(null)
const editing = ref(false)
const editError = ref<string | null>(null)

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
  // force: re-resolve every account live. Accounts resolve themselves now, so this button is the
  // one way left to say "that identity is stale, go ask again" (e.g. after a plan upgrade).
  await Promise.all([refreshInstances({ force: true }), refreshDesktopInstall(true)])
}

async function onCheckUsage(inst: CMInstance) {
  const ok = await checkDesktop(inst.dir)
  if (!ok) {
    toast.error(t('instances.toastUsageCheckFailed'))
    return
  }
  // The API call itself can succeed while still coming back with no usable numbers (not
  // signed in, no usage-capable token, or the probe returned nothing). A manual click should
  // never go silent, so surface the reason; a real result just updates the cell.
  const reasonKey = usageReasonMessageKey(reasonFor(usageKeyFor(inst)))
  if (reasonKey) toast.error(t(reasonKey))
}

// Which tables to show, and the CLI instances (so "refresh all" covers them too, not just desktop).
const { showDesktopInstances, showCliInstances, load: loadAppSettings } = useAppSettings()
const {
  cliInstances,
  checkUsage: checkCliUsage,
  create: createCli,
  launch: launchCli,
  login: loginCli,
  linkDesktop: linkCliDesktop,
} = useCliInstances()
onMounted(loadAppSettings)

// --- unified per-account view -------------------------------------------------------------------
// A desktop instance and the CLI instance linked to it are the SAME Anthropic account, signed in
// twice (Electron safeStorage vs a CLAUDE_CONFIG_DIR). So the desktop row IS the account row: it
// shows its CLI login inline and can act on it, instead of making you cross-reference two tables to
// see that "4claude the app" and "4claude the CLI" are one quota.
//
// Returns an ARRAY (0 or 1) rather than an object, purely so the template can `v-for` over it and
// get a properly-typed local binding — Vue has no `v-let`, and this avoids `!` assertions.
function linkedClis(dir: string): CliInstance[] {
  return cliInstances.value.filter((c) => c.associatedDesktopDir === dir)
}
/** The 0-or-1 linked CLI login as a nullable, for `v-if` branching in the actions menu. */
function linkedCliFor(dir: string): CliInstance | null {
  return linkedClis(dir)[0] ?? null
}

async function onLaunchCli(cli: CliInstance) {
  const result = await launchCli(cli.id)
  if (result?.ok) toast.success(t('instances.toastCliLaunched'))
  else toast.error(result?.message ?? t('instances.toastCliLaunchFailed'))
}
async function onLoginCli(cli: CliInstance) {
  const result = await loginCli(cli.id)
  if (result?.ok) toast.success(t('instances.toastCliLoginOpened'))
  else toast.error(result?.message ?? t('instances.toastCliLoginFailed'))
}
/** Send a linked CLI instance back down to the CLI table (where rename/delete/associate live). */
async function onUnlinkCli(cli: CliInstance) {
  const result = await linkCliDesktop(cli.id, null)
  if (result?.ok) toast.success(t('instances.toastCliUnlinked'))
  else toast.error(result?.message ?? t('instances.toastCliUnlinkFailed'))
}

// "Sign in CLI" on a row with NO linked CLI login yet: create one on demand, link it to this
// desktop instance, then open the /login terminal — the same three building blocks the CLI table
// uses, chained. The busy-set guards a double-click: two concurrent create+link chains for one row
// would orphan a CLI instance (the second link silently steals the association from the first).
const cliSignInBusy = ref(new Set<string>())
async function onSignInCli(inst: CMInstance) {
  if (cliSignInBusy.value.has(inst.dir)) return
  cliSignInBusy.value = new Set(cliSignInBusy.value).add(inst.dir)
  try {
    const created = await createCli(`${displayName(inst)} (CLI)`)
    const id = created?.ok ? (created.data?.id as string | undefined) : undefined
    if (!id) {
      toast.error(created?.message ?? t('instances.toastCliCreateFailed'))
      return
    }
    const linked = await linkCliDesktop(id, inst.dir)
    if (!linked?.ok) {
      toast.error(linked?.message ?? t('instances.toastCliCreateFailed'))
      return
    }
    const result = await loginCli(id)
    if (result?.ok) toast.success(t('instances.toastCliLoginOpened'))
    else toast.error(result?.message ?? t('instances.toastCliLoginFailed'))
  } finally {
    const next = new Set(cliSignInBusy.value)
    next.delete(inst.dir)
    cliSignInBusy.value = next
  }
}

// Check every instance's usage concurrently — desktop AND CLI. Each check is a single ~300ms read of
// the quota endpoint (not a `claude` spawn), and the endpoint is neither rate-limited nor
// quota-consuming, so there is no reason to serialize. The user is waiting on this click, so it fans
// out rather than staggering the way the background sweep does.
const refreshingAllUsage = ref(false)
async function onRefreshAllUsage() {
  if (refreshingAllUsage.value) return
  refreshingAllUsage.value = true
  try {
    await Promise.all([
      ...(showDesktopInstances.value ? instances.value.map((i) => checkDesktop(i.dir)) : []),
      ...(showCliInstances.value ? cliInstances.value.map((i) => checkCliUsage(i.id)) : []),
    ])
  } finally {
    refreshingAllUsage.value = false
  }
}

async function onOpen(inst: CMInstance) {
  const result = await open(inst.dir)
  if (result?.ok) {
    toast.success(t('instances.toastOpened'))
    // A successful isolated launch is live proof the install is manageable — re-check so a stale
    // "MSIX-only / not installed" banner clears itself instead of waiting on a manual Refresh.
    if (desktopWarning.value) void refreshDesktopInstall(true)
  }
  // Prefer the server's failure message — it explains the MSIX-only case (same convention
  // as the create dialog surfacing result.message).
  else toast.error(result?.message ?? t('instances.toastOpenFailed'))
}

// Quit: the External row is the user's REAL Claude Desktop (maybe mid-conversation) — route it
// through an explicit confirmation dialog; the server independently refuses it without the flag.
const quitExternalOpen = ref(false)
const quitExternalTarget = ref<CMInstance | null>(null)
const quittingExternal = ref(false)
async function onQuit(inst: CMInstance) {
  if (inst.isExternal) {
    quitExternalTarget.value = inst
    quitExternalOpen.value = true
    return
  }
  const ok = await quit(inst.dir)
  if (ok) toast.success(t('instances.toastQuit'))
  else toast.error(t('instances.toastQuitFailed'))
}
async function onQuitExternalConfirm() {
  const inst = quitExternalTarget.value
  if (!inst) return
  quittingExternal.value = true
  try {
    const ok = await quit(inst.dir, { confirmExternal: true })
    if (ok) toast.success(t('instances.toastQuit'))
    else toast.error(t('instances.toastQuitFailed'))
  } finally {
    quittingExternal.value = false
    quitExternalOpen.value = false
    quitExternalTarget.value = null
  }
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
      // Same self-heal as onOpen: a successful create disproves a stale "not manageable" verdict.
      if (desktopWarning.value) void refreshDesktopInstall(true)
    } else {
      createError.value = result?.message ?? t('instances.toastCreateFailed')
    }
  } finally {
    creating.value = false
  }
}

function openEditDialog(inst: CMInstance) {
  editTarget.value = inst
  editError.value = null
  editOpen.value = true
}
async function onEditSubmit(payload: {
  label: string | null
  icon: CMInstance['icon']
  color: CMInstance['color']
}) {
  const inst = editTarget.value
  if (!inst) return
  editing.value = true
  editError.value = null
  try {
    const result = await setAppearance(inst.dir, payload)
    if (result?.ok) {
      toast.success(t('instances.toastSaved'))
      editOpen.value = false
      editTarget.value = null
    } else {
      editError.value = result?.message ?? t('instances.toastSaveFailed')
    }
  } finally {
    editing.value = false
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

// While the warning banner is up, re-verify the verdict every 60s (fresh, bypassing the server's
// 5-minute cache): the banner's own instruction is "install the classic build", and following it
// used to leave the stale banner pinned until a manual Refresh. No banner → no polling cost.
let desktopInstallTimer: number | null = null

onMounted(() => {
  startPolling()
  startUsagePolling()
  refreshDesktopInstall()
  desktopInstallTimer = window.setInterval(() => {
    if (desktopWarning.value) void refreshDesktopInstall(true)
  }, 60_000)
})
onUnmounted(() => {
  stopPolling()
  stopUsagePolling()
  if (desktopInstallTimer !== null) window.clearInterval(desktopInstallTimer)
})
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- Borderless toolbar, matching Sessions/Queue and the app header (App.vue): the sticky table
         header right below already draws a line there, and two rules a row apart was one of them
         doing nothing but adding weight. -->
    <div class="flex flex-wrap items-center justify-between gap-2 p-3">
      <div class="flex items-center gap-2 text-sm font-semibold">
        <Boxes class="size-4" />
        {{ $t('instances.title') }}
        <span v-if="showDesktopInstances" class="text-muted-foreground">({{ instances.length }})</span>
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
        <IconTooltip
          :label="$t('instances.refreshAllUsage')"
          :description="$t('instances.refreshAllUsageHint')"
        >
          <Button
            variant="outline"
            size="icon"
            :disabled="refreshingAllUsage || (instances.length === 0 && cliInstances.length === 0)"
            :aria-label="$t('instances.refreshAllUsage')"
            @click="onRefreshAllUsage"
          >
            <Gauge :class="refreshingAllUsage ? 'animate-pulse' : ''" />
          </Button>
        </IconTooltip>
        <Button v-if="showDesktopInstances" size="sm" @click="openCreateDialog">
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

    <!-- gap-10, not a divider: the two tables used to abut with a hairline between them, which read
         as one continuous table whose last rows happened to have different columns. A flex gap only
         applies BETWEEN children, so hiding either table leaves no orphan space behind it. -->
    <div class="flex min-h-0 flex-1 flex-col gap-10 overflow-y-auto scroll-slim">
      <!-- Both tables are hideable (Settings → General): plenty of people use only the desktop app,
           or only the CLI, and shouldn't have to look at an empty table for the other. -->
      <Table v-if="showDesktopInstances">
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
            <TableHead class="cursor-pointer select-none" @click="toggleSort('usage')">
              <span class="inline-flex items-center gap-0.5">
                {{ $t('instances.colUsage') }}
                <ArrowUp v-if="indicatorFor('usage') === 'asc'" class="size-3" />
                <ArrowDown v-else-if="indicatorFor('usage') === 'desc'" class="size-3" />
              </span>
            </TableHead>
            <TableHead class="text-right">{{ $t('instances.colActions') }}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody v-if="instances.length === 0" class="[&>tr]:transition-colors [&>tr]:duration-200">
          <TableEmpty v-if="!loading" :colspan="8">
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
            <TableCell><Skeleton class="h-5 w-14" /></TableCell>
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
              <!-- per-instance icon (replaces the old status dot); the chosen glyph + color are
                   its identity, and a small pulsing badge on the top-right marks the active state -->
              <span
                class="relative inline-flex size-5 items-center justify-center"
                :title="inst.isRunning ? $t('instances.running') : $t('instances.stopped')"
              >
                <component
                  :is="iconComponent(resolveIconKey(inst))"
                  class="size-[18px]"
                  :style="{ color: colorValue(resolveColorKey(inst)) }"
                  :class="inst.isRunning ? '' : 'opacity-40'"
                />
                <span
                  v-if="inst.isRunning"
                  class="absolute -right-1 -top-1 size-2 rounded-full bg-success ring-2 ring-background animate-pulse"
                />
              </span>
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
                    {{ displayName(inst) }}
                  </button>
                </IconTooltip>
                <span v-else class="cursor-default">{{ displayName(inst) }}</span>
                <Badge v-if="inst.isExternal" variant="outline">{{ $t('instances.external') }}</Badge>
              </div>
              <div class="mono max-w-[22rem] truncate text-[0.625rem] text-muted-foreground">
                {{ inst.dir }}
              </div>
              <!-- No inline CLI sub-line here anymore: it made one row taller than the rest and
                   only ever showed for whichever account happened to be linked. The linked CLI
                   login (and CLI sign-in for rows without one) lives in the actions menu, where
                   EVERY row gets it without cluttering the table. -->
            </TableCell>
            <TableCell>
              <!-- No "Resolve" button: every instance resolves itself (see
                   useInstances.autoResolveAccounts), so a missing account is a moment, not a
                   state you act on. A logged-out instance still lands here as a badge — its
                   account.label reads "(not logged in)". -->
              <Badge v-if="accountLabel(inst)" :variant="accountBadgeVariant(inst)">
                {{ accountLabel(inst) }}
              </Badge>
              <span v-else class="text-xs text-muted-foreground">
                {{ $t('instances.resolving') }}
              </span>
            </TableCell>
            <TableCell class="mono text-xs text-muted-foreground">{{ inst.pid ?? '—' }}</TableCell>
            <TableCell class="text-xs text-muted-foreground">
              {{ inst.isRunning ? formatUptime(inst.startTime) : '—' }}
            </TableCell>
            <TableCell class="text-xs text-muted-foreground">{{ formatBytes(inst.memoryBytes) }}</TableCell>
            <TableCell>
              <UsageBadge
                :snapshot="usageFor(inst)"
                :checking="isChecking(usageKeyFor(inst))"
                :usage-key="usageKeyFor(inst)"
                @check="onCheckUsage(inst)"
              />
            </TableCell>
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
                <!-- running: the primary action is Focus (bring the window forward); Quit moves
                     under the kebab so the common action is one click and the destructive one is deliberate -->
                <Button v-else variant="outline" size="sm" :disabled="isBusy(inst)" @click="onFocus(inst)">
                  <AppWindow /> {{ $t('instances.focusShort') }}
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
                  <!-- w-56: without it the menu inherits the tiny kebab trigger's width and
                       "Create desktop shortcut" wraps/clips; a fixed width fits it on one line -->
                  <DropdownMenuContent align="end" class="w-56">
                    <!-- Quit lives here now (the row's primary button is Focus when running);
                         disabled unless running, mirroring the old Focus item's guard -->
                    <DropdownMenuItem
                      :disabled="!inst.isRunning || isBusy(inst)"
                      @click="onQuit(inst)"
                    >
                      <Square /> {{ $t('instances.quit') }}
                    </DropdownMenuItem>
                    <DropdownMenuItem :disabled="isBusy(inst)" @click="onRevealFolder(inst)">
                      <FolderOpen /> {{ $t('instances.openFolder') }}
                    </DropdownMenuItem>
                    <DropdownMenuItem :disabled="isBusy(inst)" @click="onCreateShortcut(inst)">
                      <MonitorDown /> {{ $t('instances.createShortcut') }}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      :disabled="isChecking(usageKeyFor(inst))"
                      @click="onCheckUsage(inst)"
                    >
                      <Gauge /> {{ $t('instances.checkUsage') }}
                    </DropdownMenuItem>
                    <!-- CLI section, on EVERY row: a desktop instance and its CLI login are the
                         same Anthropic account signed in twice. With a linked CLI instance the
                         items act on it (Launch / Sign in + Unlink); without one, "Sign in CLI"
                         creates + links one on demand and opens the /login terminal. -->
                    <DropdownMenuSeparator />
                    <template v-if="linkedCliFor(inst.dir)">
                      <template v-for="cli in linkedClis(inst.dir)" :key="`cli-${cli.id}`">
                        <DropdownMenuItem v-if="cli.loggedIn" @click="onLaunchCli(cli)">
                          <Terminal /> {{ $t('instances.launchCli') }}
                        </DropdownMenuItem>
                        <DropdownMenuItem v-else @click="onLoginCli(cli)">
                          <LogIn /> {{ $t('instances.loginCli') }}
                        </DropdownMenuItem>
                        <DropdownMenuItem @click="onUnlinkCli(cli)">
                          <Unlink /> {{ $t('instances.unlinkCli') }}
                        </DropdownMenuItem>
                      </template>
                    </template>
                    <DropdownMenuItem
                      v-else
                      :disabled="cliSignInBusy.has(inst.dir)"
                      @click="onSignInCli(inst)"
                    >
                      <LogIn /> {{ $t('instances.loginCli') }}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <!-- Edit (name + icon + color) is pure UI metadata, so it stays enabled even
                         while the instance runs (unlike Delete, which touches the folder) -->
                    <DropdownMenuItem
                      :disabled="isBusy(inst)"
                      @click="openEditDialog(inst)"
                    >
                      <Pencil /> {{ $t('instances.edit') }}
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

      <CliInstancesSection v-if="showCliInstances" />
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
    <QuitExternalInstanceDialog
      v-model:open="quitExternalOpen"
      :instance-name="quitExternalTarget ? displayName(quitExternalTarget) : null"
      :submitting="quittingExternal"
      @confirm="onQuitExternalConfirm"
    />
    <EditInstanceDialog
      v-model:open="editOpen"
      :instance-name="editTarget?.name ?? null"
      :dir="editTarget?.dir ?? null"
      :current-label="editTarget?.label ?? null"
      :current-icon="editTarget?.icon ?? null"
      :current-color="editTarget?.color ?? null"
      :running="editTarget?.isRunning ?? false"
      :submitting="editing"
      :error-message="editError"
      @submit="onEditSubmit"
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
