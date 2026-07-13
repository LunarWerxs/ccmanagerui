<script setup lang="ts">
import {
  Ban,
  ChevronDown,
  Clock,
  Cpu,
  FastForward,
  FolderGit2,
  Gauge,
  ListPlus,
  Pencil,
  Play,
  Plus,
  Power,
  Trash2,
  UserCircle2,
} from '@lucide/vue'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import RunViewer from '@/components/RunViewer.vue'
import StatusBadge from '@/components/StatusBadge.vue'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useBuilder } from '@/composables/useBuilder'
import { useData } from '@/composables/useData'
import type { QueueItem } from '@/lib/api'
import * as api from '@/lib/api'
import { baseName, formatRunAt } from '@/lib/format'
import InfoHint from '@/shell/InfoHint.vue'

const { t } = useI18n()
const { queue, queueLoaded, accounts, scheduler, refreshQueue } = useData()
const { openBuilder, openEditor } = useBuilder()
const expanded = ref<string | null>(null)

const sorted = computed(() => queue.value)

// re-evaluated on every 2s queue poll, so a schedule crossing "now" surfaces the button
const dueCount = computed(
  () =>
    queue.value.filter(
      (q) => q.status === 'queued' && (!q.not_before || Date.parse(q.not_before) <= Date.now()),
    ).length,
)

function accountLabel(id: string | null): string | null {
  if (!id) return null
  return accounts.value.find((a) => a.id === id)?.label ?? 'account'
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
      <div class="flex items-center gap-1.5 text-sm text-muted-foreground">
        {{ $t('queue.itemsCount', { n: queue.length }) }}
        <InfoHint :text="$t('queue.whatIsQueue')" />
      </div>
      <div class="flex items-center gap-2">
        <!-- ambient reminder that queued items will auto-dispatch; the toggle itself lives in
             Settings → Scheduler (the header pill it replaces was removed as redundant) -->
        <span
          v-if="scheduler?.enabled"
          class="inline-flex items-center gap-1 rounded-md border border-success/30 bg-success/10 px-2 py-0.5 text-xs text-success"
        >
          <Power class="size-3" /> {{ $t('queue.schedulerOn') }}
        </span>
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
        <!-- queue a resume of an existing session (builder opens in resume mode) -->
        <Button size="sm" variant="outline" @click="openBuilder({ new_chat: false })">
          <Play /> {{ $t('queue.queueResume') }}
        </Button>
        <!-- expanding icon button, same pattern as the header's New run (DevWebUI TopBar) -->
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

      <div
        v-for="item in sorted"
        :key="item.id"
        class="mb-2.5 overflow-hidden rounded-xl border border-border bg-card"
      >
        <div class="flex items-start gap-3 p-3">
          <button
            class="mt-0.5 text-muted-foreground transition-transform hover:text-foreground"
            :class="expanded === item.id ? 'rotate-0' : '-rotate-90'"
            :title="$t('queue.toggleLiveOutput')"
            @click="toggle(item.id)"
          >
            <ChevronDown class="size-4" />
          </button>

          <div class="min-w-0 flex-1">
            <div class="flex items-start justify-between gap-2">
              <span class="truncate text-sm font-medium">{{ item.title }}</span>
              <StatusBadge :status="item.status" />
            </div>

            <p class="mt-1 line-clamp-2 text-xs text-muted-foreground">{{ item.prompt }}</p>

            <div class="mt-2 flex flex-wrap items-center gap-1.5">
              <Badge variant="secondary">
                <FolderGit2 /> {{ baseName(item.cwd) }}
              </Badge>
              <Badge v-if="item.not_before && item.status === 'queued'" variant="warning">
                <Clock /> {{ $t('queue.scheduledFor', { time: formatRunAt(item.not_before) }) }}
              </Badge>
              <Badge v-if="item.new_chat" variant="info">{{ $t('queue.newChat') }}</Badge>
              <Badge v-if="item.fork" variant="secondary">{{ $t('queue.fork') }}</Badge>
              <Badge v-if="item.model" variant="secondary">
                <Cpu /> {{ item.model }}
              </Badge>
              <Badge v-if="item.effort" variant="secondary">
                <Gauge /> {{ item.effort }}
              </Badge>
              <Badge v-if="accountLabel(item.account_id)" variant="secondary">
                <UserCircle2 /> {{ accountLabel(item.account_id) }}
              </Badge>
              <Badge v-if="item.exit_code !== null" variant="secondary">
                {{ $t('queue.exit') }} {{ item.exit_code }}
              </Badge>
            </div>
          </div>

          <div class="flex shrink-0 flex-col gap-1.5">
            <Button
              v-if="item.status !== 'running'"
              size="sm"
              variant="outline"
              :title="$t('queue.runNow')"
              @click="run(item)"
            >
              <Play /> {{ $t('queue.run') }}
            </Button>
            <Button v-else size="sm" variant="outline" :title="$t('queue.cancel')" @click="cancel(item)">
              <Ban /> {{ $t('queue.stop') }}
            </Button>
            <div class="flex items-center justify-end gap-0.5">
              <Button
                size="icon-sm"
                variant="ghost"
                :title="$t('queue.edit')"
                :disabled="item.status === 'running'"
                @click="openEditor(item)"
              >
                <Pencil />
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                :title="$t('queue.delete')"
                :disabled="item.status === 'running'"
                @click="remove(item)"
              >
                <Trash2 />
              </Button>
            </div>
          </div>
        </div>

        <div v-if="expanded === item.id" class="h-72 border-t border-border bg-background/40">
          <RunViewer :item-id="item.id" />
        </div>
      </div>
    </div>
  </div>
</template>
