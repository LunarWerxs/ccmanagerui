<script setup lang="ts">
import {
  CalendarClock,
  Cpu,
  FolderGit2,
  Gauge,
  ListPlus,
  Minus,
  Plus,
  SendHorizonal,
  Settings2,
  ShieldCheck,
  UserCircle2,
  UsersRound,
} from '@lucide/vue'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Textarea } from '@/components/ui/textarea'
import { useData } from '@/composables/useData'
import { usePanels } from '@/composables/usePanels'
import * as api from '@/lib/api'
import { baseName, EFFORTS, MODELS, PERMISSION_MODES } from '@/lib/format'

export interface ComposerTarget {
  session_id: string
  title: string
  cwd: string
}

const props = defineProps<{ targets: ComposerTarget[] }>()
const emit = defineEmits<{ sent: [mode: 'now' | 'queued'] }>()

const { t } = useI18n()
const { queue, accounts, scheduler, refreshQueue } = useData()
const { queueOpen, openSettingsTab } = usePanels()

const text = ref('')
const model = ref('')
const effort = ref('')
const permission = ref('')
const accountId = ref('')
const cwdOverride = ref('')
const sending = ref(false)

const single = computed(() => (props.targets.length === 1 ? props.targets[0] : null))

// the cwd override is a per-session choice — never let it silently follow a selection change
watch(
  () => single.value?.session_id,
  () => {
    cwdOverride.value = ''
  },
)

// A session with a RUNNING queue run can't take a second concurrent `claude --resume`
// against the same transcript — "send now" to it degrades to a plain queue add.
const runningIds = computed(
  () => new Set(queue.value.filter((q) => q.status === 'running').map((q) => q.session_id)),
)
const anyBusy = computed(() => props.targets.some((tg) => runningIds.value.has(tg.session_id)))

const accountOptions = computed(() => [
  { value: '', label: t('builder.accountAmbient') },
  ...accounts.value.map((a) => ({ value: a.id, label: a.label })),
])

const canSend = computed(() => !!text.value.trim() && props.targets.length > 0 && !sending.value)

// chips: label falls back to the dimension name while the value is "default"
const chipLabel = (value: string, options: { value: string; label: string }[], fallback: string) =>
  value ? (options.find((o) => o.value === value)?.label ?? value) : fallback

function titleFor(target: ComposerTarget): string {
  return target.title || text.value.trim().slice(0, 60)
}

function createFor(target: ComposerTarget, notBefore: string | null) {
  return api.createQueueItem({
    session_id: target.session_id,
    title: titleFor(target),
    cwd: (single.value ? cwdOverride.value.trim() : '') || target.cwd,
    prompt: text.value,
    model: model.value || null,
    effort: (effort.value || null) as api.EffortLevel | null,
    permission_mode: (permission.value || null) as api.PermissionMode | null,
    account_id: accountId.value || null,
    new_chat: false,
    fork: false,
    not_before: notBefore,
  })
}

async function submit(mode: 'now' | 'queue', notBefore: string | null = null) {
  if (!canSend.value) return
  sending.value = true
  let started = 0
  let queued = 0
  let failed = 0
  try {
    for (const target of props.targets) {
      let item: api.QueueItem
      try {
        item = await createFor(target, notBefore)
      } catch {
        failed++
        continue
      }
      if (mode === 'now' && !runningIds.value.has(target.session_id)) {
        try {
          await api.runQueueItem(item.id)
          started++
        } catch {
          // the server holds a per-session run lock (409 when a run raced us in) —
          // the item was still created, so it's queued, not failed
          queued++
        }
      } else {
        queued++
      }
    }
  } finally {
    sending.value = false
  }
  await refreshQueue()
  if (failed) toast.error(t('composer.toastFailed', { n: failed }))
  if (!started && !queued) return

  text.value = ''
  scheduleOpen.value = false
  const message =
    started && queued
      ? t('composer.toastMixed', { ran: started, queued })
      : started
        ? t('composer.toastStarted', { n: started })
        : t('composer.toastQueued', { n: queued })
  const idleQueued = queued > 0 && !scheduler.value?.enabled
  toast.success(message, {
    description: idleQueued ? t('composer.schedulerOffHint') : undefined,
    action: { label: t('composer.viewQueue'), onClick: () => (queueOpen.value = true) },
  })
  emit('sent', started ? 'now' : 'queued')
}

// --- queue-for-later popover --------------------------------------------------
const scheduleOpen = ref(false)
const scheduleLocal = ref('')
// The two "+ / −" steppers: an exact delay in hours and 10-minute increments. Together they cover
// every short delay a fixed preset used to (1h = the default; 15-ish min = 0h + 20m), which is why
// the old "In 15 min" / "In 1 hour" preset buttons are gone.
const scheduleHours = ref(1)
const scheduleMinutes = ref(0)

/** Minutes step in 10s and stay inside the hour (0…50) — a 6th step is one hour, so use the hours
 *  stepper for that rather than silently carrying. Hours have no ceiling (the old stepper had none). */
function stepHours(delta: number) {
  scheduleHours.value = Math.max(0, scheduleHours.value + delta)
}
function stepMinutes(delta: number) {
  scheduleMinutes.value = Math.min(50, Math.max(0, scheduleMinutes.value + delta))
}

const scheduleDelayMin = computed(() => scheduleHours.value * 60 + scheduleMinutes.value)
// 0h 0m is "now", not a delay — the button is disabled there, so the label never has to say it.
const scheduleDelayLabel = computed(() => {
  const h = scheduleHours.value
  const m = scheduleMinutes.value
  if (h > 0 && m > 0) return t('composer.presetInHM', { h, m })
  if (h > 0) return t('composer.presetInHours', { h })
  return t('composer.presetInMinutes', { m })
})

// "Tomorrow HH:MM" is a server-side scheduler setting (Settings → Scheduler), not a constant
const tomorrowTime = computed(() => scheduler.value?.tomorrow_time ?? '09:00')

function queueInMinutes(minutes: number) {
  submit('queue', new Date(Date.now() + minutes * 60_000).toISOString())
}
function queueTomorrowMorning() {
  const [h = 9, m = 0] = tomorrowTime.value.split(':').map(Number)
  const d = new Date()
  d.setDate(d.getDate() + 1)
  d.setHours(h, m, 0, 0)
  submit('queue', d.toISOString())
}
function queueAtPicked() {
  if (!scheduleLocal.value) return
  const ms = Date.parse(scheduleLocal.value)
  if (!Number.isFinite(ms)) return
  submit('queue', new Date(ms).toISOString())
}
function openSchedulerSettings() {
  scheduleOpen.value = false
  openSettingsTab('scheduler')
}

function onKeydown(e: KeyboardEvent) {
  if (e.key !== 'Enter' || e.shiftKey) return
  e.preventDefault()
  // Ctrl/Cmd+Enter always queues; plain Enter sends (busy targets self-queue in submit)
  submit(e.ctrlKey || e.metaKey ? 'queue' : 'now')
}
</script>

<template>
  <div class="bg-background">
    <div class="mx-auto w-full max-w-3xl px-4 py-3">
      <!-- multi-target banner -->
      <!-- count only: the joined titles always overflowed and truncated into noise -->
      <div
        v-if="targets.length > 1"
        class="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground"
      >
        <UsersRound class="size-3.5 text-primary" />
        <span class="font-medium text-foreground">{{ $t('composer.sendingToN', { n: targets.length }) }}</span>
      </div>
      <p v-if="anyBusy" class="mb-2 text-xs text-warning">
        {{ scheduler?.enabled ? $t('composer.busyHintAuto') : $t('composer.busyHintManual') }}
      </p>

      <div class="rounded-xl border border-border bg-input/10 focus-within:border-ring">
        <Textarea
          v-model="text"
          class="max-h-48 min-h-12 border-0 bg-transparent px-3 pt-2.5 focus-visible:ring-0 dark:bg-transparent"
          :placeholder="
            targets.length > 1
              ? $t('composer.placeholderMulti', { n: targets.length })
              : $t('composer.placeholder')
          "
          @keydown="onKeydown"
        />

        <!-- option chips (left) + actions (right), Claude-composer style -->
        <div class="flex flex-wrap items-center gap-1 px-2 pb-2">
          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <Button variant="ghost" size="xs" :class="model ? 'text-foreground' : 'text-muted-foreground'">
                <Cpu /> {{ chipLabel(model, MODELS, $t('composer.chipModel')) }}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuRadioGroup v-model="model">
                <DropdownMenuRadioItem value="">{{ $t('composer.clearOption') }}</DropdownMenuRadioItem>
                <DropdownMenuRadioItem v-for="o in MODELS" :key="o.value" :value="o.value">
                  {{ o.label }}
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <Button variant="ghost" size="xs" :class="effort ? 'text-foreground' : 'text-muted-foreground'">
                <Gauge /> {{ chipLabel(effort, EFFORTS, $t('composer.chipEffort')) }}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuRadioGroup v-model="effort">
                <DropdownMenuRadioItem value="">{{ $t('composer.clearOption') }}</DropdownMenuRadioItem>
                <DropdownMenuRadioItem v-for="o in EFFORTS" :key="o.value" :value="o.value">
                  {{ o.label }}
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <Button variant="ghost" size="xs" :class="permission ? 'text-foreground' : 'text-muted-foreground'">
                <ShieldCheck /> {{ chipLabel(permission, PERMISSION_MODES, $t('composer.chipPermission')) }}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuRadioGroup v-model="permission">
                <DropdownMenuRadioItem value="">{{ $t('composer.clearOption') }}</DropdownMenuRadioItem>
                <DropdownMenuRadioItem v-for="o in PERMISSION_MODES" :key="o.value" :value="o.value">
                  {{ o.label }}
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu v-if="accounts.length">
            <DropdownMenuTrigger as-child>
              <Button variant="ghost" size="xs" :class="accountId ? 'text-foreground' : 'text-muted-foreground'">
                <UserCircle2 /> {{ chipLabel(accountId, accountOptions, $t('composer.chipAccount')) }}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuRadioGroup v-model="accountId">
                <DropdownMenuRadioItem v-for="o in accountOptions" :key="o.value" :value="o.value">
                  {{ o.label }}
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          <!-- cwd override: single target only (multi always uses each session's own dir) -->
          <Popover v-if="single">
            <PopoverTrigger as-child>
              <Button variant="ghost" size="xs" :class="cwdOverride.trim() ? 'text-foreground' : 'text-muted-foreground'">
                <FolderGit2 /> {{ baseName(cwdOverride.trim() || single.cwd) }}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" class="w-96 space-y-1.5 p-3">
              <label class="text-xs font-medium text-muted-foreground">{{ $t('composer.cwdPopoverLabel') }}</label>
              <Input v-model="cwdOverride" :placeholder="single.cwd" class="font-mono text-xs" />
              <p class="text-[11px] text-muted-foreground">{{ $t('composer.cwdPopoverHint') }}</p>
            </PopoverContent>
          </Popover>

          <div class="ml-auto flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              :disabled="!canSend"
              :title="$t('composer.queue')"
              @click="submit('queue')"
            >
              <ListPlus /> {{ $t('composer.queue') }}
            </Button>

            <Popover v-model:open="scheduleOpen">
              <PopoverTrigger as-child>
                <Button variant="outline" size="icon-sm" :disabled="!canSend" :title="$t('composer.queueForLater')">
                  <CalendarClock />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" class="w-64 space-y-2 p-3">
                <p class="text-xs font-semibold">{{ $t('composer.scheduleTitle') }}</p>
                <div class="grid grid-cols-2 gap-1.5">
                  <Button variant="outline" size="xs" @click="queueInMinutes(300)">{{ $t('composer.presetIn5h') }}</Button>
                  <!-- the tomorrow time is user-configurable; the tiny gear jumps to where -->
                  <div class="relative">
                    <Button variant="outline" size="xs" class="w-full pr-5" @click="queueTomorrowMorning()">
                      {{ $t('composer.presetTomorrow', { time: tomorrowTime }) }}
                    </Button>
                    <button
                      type="button"
                      class="absolute right-0.5 top-1/2 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground transition-colors hover:text-foreground"
                      :title="$t('composer.editTomorrowTime')"
                      :aria-label="$t('composer.editTomorrowTime')"
                      @click.stop="openSchedulerSettings()"
                    >
                      <Settings2 class="size-2.5" />
                    </button>
                  </div>
                </div>
                <!-- exact delay: an hours stepper and a 10-minute stepper side by side, then one
                     button that queues the combined hours+minutes (replaces the old 15m/1h presets) -->
                <div class="flex items-center justify-center gap-3">
                  <div class="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="icon-xs"
                      :disabled="scheduleHours <= 0"
                      :aria-label="$t('composer.hoursDecrease')"
                      @click="stepHours(-1)"
                    >
                      <Minus />
                    </Button>
                    <span class="w-8 text-center text-xs tabular-nums">{{ $t('composer.hoursValue', { n: scheduleHours }) }}</span>
                    <Button
                      variant="outline"
                      size="icon-xs"
                      :aria-label="$t('composer.hoursIncrease')"
                      @click="stepHours(1)"
                    >
                      <Plus />
                    </Button>
                  </div>
                  <div class="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="icon-xs"
                      :disabled="scheduleMinutes <= 0"
                      :aria-label="$t('composer.minutesDecrease')"
                      @click="stepMinutes(-10)"
                    >
                      <Minus />
                    </Button>
                    <span class="w-9 text-center text-xs tabular-nums">{{ $t('composer.minutesValue', { n: scheduleMinutes }) }}</span>
                    <Button
                      variant="outline"
                      size="icon-xs"
                      :disabled="scheduleMinutes >= 50"
                      :aria-label="$t('composer.minutesIncrease')"
                      @click="stepMinutes(10)"
                    >
                      <Plus />
                    </Button>
                  </div>
                </div>
                <Button
                  variant="default"
                  size="xs"
                  class="w-full"
                  :disabled="scheduleDelayMin <= 0"
                  @click="queueInMinutes(scheduleDelayMin)"
                >
                  {{ scheduleDelayLabel }}
                </Button>
                <label class="block text-[11px] text-muted-foreground">{{ $t('composer.schedulePickLabel') }}</label>
                <Input v-model="scheduleLocal" type="datetime-local" class="text-xs" />
                <Button size="sm" class="w-full" :disabled="!scheduleLocal" @click="queueAtPicked()">
                  {{ $t('composer.scheduleConfirm') }}
                </Button>
              </PopoverContent>
            </Popover>

            <Button size="sm" :disabled="!canSend" :title="$t('composer.send')" @click="submit('now')">
              <SendHorizonal /> {{ $t('composer.send') }}
            </Button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
