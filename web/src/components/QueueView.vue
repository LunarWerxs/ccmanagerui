<script setup lang="ts">
import { ChevronDown, FastForward, ListPlus, Plus, Power, PowerOff } from '@lucide/vue'
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import QueueItemCard from '@/components/QueueItemCard.vue'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useBuilder } from '@/composables/useBuilder'
import { useCliInstances } from '@/composables/useCliInstances'
import { useData } from '@/composables/useData'
import { useInstances } from '@/composables/useInstances'
import type { QueueItem } from '@/lib/api'
import * as api from '@/lib/api'
import { displayName } from '@/lib/instance-appearance'
import IconTooltip from '@/shell/IconTooltip.vue'
import InfoHint from '@/shell/InfoHint.vue'

const { t } = useI18n()
const { queue, queueLoaded, accounts, scheduler, refreshQueue } = useData()
const { openBuilder, openEditor } = useBuilder()
// Run-as resolution mirrors QueueBuilder's accountOptions: an item pinned to a signed-in
// instance ('desktop:<dir>' / 'cli:<id>') resolves through these live lists; a bare uuid is the
// legacy sqlite accounts fallback. Refresh here too (silent) — these singletons only
// self-populate once the Instances tab has been opened, and the queue drawer can be the very
// first thing a user sees.
const { instances, refreshInstances } = useInstances()
const { cliInstances, refreshCliInstances } = useCliInstances()
onMounted(() => {
  void refreshInstances({ silent: true })
  void refreshCliInstances({ silent: true })
})
const expanded = ref<string | null>(null)

// A finished run is history, not a to-do. Left in the one flat list they crowd out the handful of
// items that still need something to happen, and the panel reads as a pile of work rather than a
// queue. Split by "is this still going to do something?" — everything else folds away behind a count.
// 'overloaded' belongs here: by the time a run reads it, the automatic retries are already spent
// (dispatch.ts), so nothing further will happen to it on its own.
const TERMINAL: QueueItem['status'][] = [
  'completed',
  'failed',
  'canceled',
  'rate_limited',
  'overloaded',
]
const isFinished = (q: QueueItem) => TERMINAL.includes(q.status)

const active = computed(() => queue.value.filter((q) => !isFinished(q)))
const finished = computed(() => queue.value.filter(isFinished))
const showFinished = ref(false)

// re-evaluated on every 2s queue poll, so a schedule crossing "now" surfaces the button
const dueCount = computed(
  () =>
    queue.value.filter(
      (q) => q.status === 'queued' && (!q.not_before || Date.parse(q.not_before) <= Date.now()),
    ).length,
)

/** The login badge for a queue item: an instance-pinned item resolves through the live
 *  instance lists FIRST (desktop dir -> its displayName, cli id -> its name) — otherwise it
 *  would render with no account badge at all, since account_id is null on those items. Falls
 *  back to the legacy sqlite accounts lookup only when no instance_ref is set. A ref that no
 *  longer resolves (the instance/account was deleted) still gets a clearly-labeled badge rather
 *  than silently rendering blank. */
function accountLabel(item: QueueItem): string | null {
  const ref = item.instance_ref
  if (ref) {
    if (ref.startsWith('desktop:')) {
      const dir = ref.slice('desktop:'.length)
      const inst = instances.value.find((i) => i.dir === dir)
      return inst ? displayName(inst) : t('queue.deletedInstance')
    }
    if (ref.startsWith('cli:')) {
      const id = ref.slice('cli:'.length)
      const inst = cliInstances.value.find((c) => c.id === id)
      return inst ? inst.name : t('queue.deletedInstance')
    }
    return t('queue.deletedInstance')
  }
  if (!item.account_id) return null
  return accounts.value.find((a) => a.id === item.account_id)?.label ?? 'account'
}

function toggle(id: string) {
  expanded.value = expanded.value === id ? null : id
}

async function runDue() {
  try {
    const r = await api.runDueQueueItems()
    toast.success(t('queue.toastRanDue', { n: r.started }), {
      description: r.skipped ? t('queue.toastRanDueSkipped', { n: r.skipped }) : undefined,
    })
  } catch {
    toast.error(t('queue.toastRunDueFailed'))
  }
  await refreshQueue()
}

async function run(item: QueueItem) {
  try {
    await api.runQueueItem(item.id)
  } catch {
    /* surfaced via polling */
  }
  expanded.value = item.id
  await refreshQueue()
}
async function cancel(item: QueueItem) {
  try {
    await api.cancelQueueItem(item.id)
  } catch {
    toast.error(t('queue.toastCancelFailed'))
  }
  await refreshQueue()
}
async function remove(item: QueueItem) {
  try {
    await api.deleteQueueItem(item.id)
  } catch {
    toast.error(t('queue.toastDeleteFailed'))
  }
  await refreshQueue()
}
</script>

<template>
  <!-- rendered inside the queue drawer: the Sidebar header carries the title, this
       toolbar carries the count, scheduler state, and the new-run shortcut -->
  <div class="flex h-full min-h-0 flex-col">
    <div class="flex shrink-0 items-center justify-between gap-2 p-3">
      <!-- count what's still pending, not the all-time total: "7 items" over a queue of 6 finished
           runs and 1 live one described the history, not the work -->
      <div class="flex items-center gap-1.5 text-sm text-muted-foreground">
        {{ $t('queue.itemsCount', { n: active.length }) }}
        <InfoHint :text="$t('queue.whatIsQueue')" />
      </div>
      <div class="flex items-center gap-2">
        <!-- scheduler state at a glance: an icon (not a text pill), state + meaning on hover.
             The actual toggle lives in Settings → Scheduler. -->
        <IconTooltip
          :label="scheduler?.enabled ? $t('queue.schedulerOnLabel') : $t('queue.schedulerOffLabel')"
          :description="scheduler?.enabled ? $t('queue.schedulerOnHint') : $t('queue.schedulerOffHint')"
        >
          <span
            class="inline-flex size-6 items-center justify-center rounded-md"
            :class="scheduler?.enabled ? 'text-success' : 'text-muted-foreground'"
          >
            <Power v-if="scheduler?.enabled" class="size-3.5" />
            <PowerOff v-else class="size-3.5" />
          </span>
        </IconTooltip>
        <!-- manual drain: run everything already due, skipping busy sessions -->
        <Button
          v-if="dueCount > 0"
          size="sm"
          variant="outline"
          :title="$t('queue.runDueTitle')"
          @click="runDue"
        >
          <FastForward /> {{ $t('queue.runDue', { n: dueCount }) }}
        </Button>
        <!-- expanding icon button; opens the builder (defaults to resume mode). A separate
             "Queue resume" button used to sit here but opened this same dialog identically. -->
        <Button
          size="sm"
          class="group/newrun gap-0 overflow-hidden transition-all"
          :aria-label="$t('queue.newRun')"
          @click="openBuilder()"
        >
          <Plus class="shrink-0" />
          <span
            class="max-w-0 overflow-hidden whitespace-nowrap opacity-0 transition-all duration-200 ease-out group-hover/newrun:ml-1.5 group-hover/newrun:max-w-[7rem] group-hover/newrun:opacity-100 group-focus-visible/newrun:ml-1.5 group-focus-visible/newrun:max-w-[7rem] group-focus-visible/newrun:opacity-100"
          >{{ $t('queue.newRun') }}</span>
        </Button>
      </div>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto p-3">
      <!-- first-load skeletons so the queue never looks blank -->
      <template v-if="!queueLoaded && queue.length === 0">
        <div v-for="i in 3" :key="i" class="mb-2.5 rounded-xl border border-border bg-card p-3">
          <div class="flex items-start gap-3">
            <Skeleton class="mt-0.5 size-4" />
            <div class="min-w-0 flex-1">
              <Skeleton class="h-4" :style="{ width: `${70 - (i % 3) * 15}%` }" />
              <Skeleton class="mt-2 h-3 w-11/12" />
              <div class="mt-2.5 flex items-center gap-1.5">
                <Skeleton class="h-5 w-20" />
                <Skeleton class="h-5 w-14" />
                <Skeleton class="h-5 w-16" />
              </div>
            </div>
            <Skeleton class="h-6 w-16" />
          </div>
        </div>
      </template>

      <div
        v-else-if="queue.length === 0"
        class="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground"
      >
        <ListPlus class="size-8 opacity-40" />
        <p>{{ $t('queue.empty') }}</p>
        <Button size="sm" variant="outline" @click="openBuilder()"
          ><ListPlus /> {{ $t('queue.queueARun') }}</Button
        >
      </div>

      <QueueItemCard
        v-for="item in active"
        :key="item.id"
        :item="item"
        :expanded="expanded === item.id"
        :account-label="accountLabel(item)"
        @toggle="toggle(item.id)"
        @run="run(item)"
        @cancel="cancel(item)"
        @edit="openEditor(item)"
        @remove="remove(item)"
      />

      <!-- nothing left to run, but the history is still there: say so rather than show the empty-queue
           call to action, which would read as "you have no runs at all" -->
      <p
        v-if="active.length === 0 && finished.length > 0"
        class="py-6 text-center text-sm text-muted-foreground"
      >
        {{ $t('queue.allDone') }}
      </p>

      <template v-if="finished.length > 0">
        <button
          type="button"
          class="mt-1 flex w-full items-center gap-1.5 rounded-md px-1 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
          :aria-expanded="showFinished"
          @click="showFinished = !showFinished"
        >
          <ChevronDown class="size-3.5 transition-transform" :class="showFinished ? 'rotate-0' : '-rotate-90'" />
          {{ showFinished ? $t('queue.hideFinished') : $t('queue.showFinished', { n: finished.length }) }}
        </button>

        <div v-if="showFinished" class="mt-2">
          <QueueItemCard
            v-for="item in finished"
            :key="item.id"
            :item="item"
            :expanded="expanded === item.id"
            :account-label="accountLabel(item)"
            @toggle="toggle(item.id)"
            @run="run(item)"
            @cancel="cancel(item)"
            @edit="openEditor(item)"
            @remove="remove(item)"
          />
        </div>
      </template>
    </div>
  </div>
</template>
