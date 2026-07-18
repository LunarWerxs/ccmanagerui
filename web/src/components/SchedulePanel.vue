<script setup lang="ts">
/**
 * The "run at…" controls, shared by every surface that schedules something for later.
 *
 * It renders the PANEL only, not the Popover around it. That is deliberate: this codebase has been
 * bitten repeatedly by reka poppers resolving their anchor through the COMPONENT tree (see the long
 * note in SessionsView.vue), so each caller keeps ownership of its own Popover/PopoverTrigger pair
 * and simply drops this inside its PopoverContent. Nothing here can steal an anchor.
 *
 * Callers get an ISO timestamp via `pick` and decide what it means: the composer queues the message
 * it is holding, the queue builder writes it into a form field.
 */
import { Minus, Plus, Settings2 } from '@lucide/vue'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useData } from '@/composables/useData'
import { usePanels } from '@/composables/usePanels'

const props = withDefaults(
  defineProps<{
    /** Label for the pick-a-date confirm button. The presets act immediately; this one needs to say
     *  what "then" does in the caller's context ("Queue for then" vs "Use this time"). */
    confirmLabel?: string
  }>(),
  { confirmLabel: '' },
)

const emit = defineEmits<{
  /** A time was chosen, as an ISO (UTC) string. */
  pick: [iso: string]
  /** The panel wants its container closed (the gear navigates away from it). */
  close: []
}>()

const { t } = useI18n()
const { scheduler } = useData()
const { openSettingsTab } = usePanels()

const pickLabel = computed(() => props.confirmLabel || t('scheduler.scheduleConfirm'))

// The two "+ / −" steppers: an exact delay in hours and 10-minute increments. Together they cover
// every short delay a fixed preset used to (1h = the default; 15-ish min = 0h + 20m), which is why
// the old "In 15 min" / "In 1 hour" preset buttons are gone.
const hours = ref(1)
const minutes = ref(0)
const localValue = ref('')

/** Minutes step in 10s and stay inside the hour (0…50) — a 6th step is one hour, so use the hours
 *  stepper for that rather than silently carrying. Hours have no ceiling. */
function stepHours(delta: number) {
  hours.value = Math.max(0, hours.value + delta)
}
function stepMinutes(delta: number) {
  minutes.value = Math.min(50, Math.max(0, minutes.value + delta))
}

const delayMin = computed(() => hours.value * 60 + minutes.value)
// 0h 0m is "now", not a delay — the button is disabled there, so the label never has to say it.
const delayLabel = computed(() => {
  const h = hours.value
  const m = minutes.value
  if (h > 0 && m > 0) return t('scheduler.presetInHM', { h, m })
  if (h > 0) return t('scheduler.presetInHours', { h })
  return t('scheduler.presetInMinutes', { m })
})

// "Tomorrow HH:MM" is a server-side scheduler setting (Settings → Scheduler), not a constant.
const tomorrowTime = computed(() => scheduler.value?.tomorrow_time ?? '09:00')

function pickInMinutes(mins: number) {
  emit('pick', new Date(Date.now() + mins * 60_000).toISOString())
}
function pickTomorrow() {
  const [h = 9, m = 0] = tomorrowTime.value.split(':').map(Number)
  const d = new Date()
  d.setDate(d.getDate() + 1)
  d.setHours(h, m, 0, 0)
  emit('pick', d.toISOString())
}
function pickExact() {
  if (!localValue.value) return
  const ms = Date.parse(localValue.value)
  if (!Number.isFinite(ms)) return
  emit('pick', new Date(ms).toISOString())
}
function openSchedulerSettings() {
  emit('close')
  openSettingsTab('scheduler')
}
</script>

<template>
  <div class="space-y-2">
    <p class="text-xs font-semibold">{{ $t('scheduler.scheduleTitle') }}</p>
    <div class="grid grid-cols-2 gap-1.5">
      <Button variant="outline" size="xs" @click="pickInMinutes(300)">
        {{ $t('scheduler.presetIn5h') }}
      </Button>
      <!-- the tomorrow time is user-configurable; the tiny gear jumps to where -->
      <div class="relative">
        <Button variant="outline" size="xs" class="w-full pr-5" @click="pickTomorrow()">
          {{ $t('scheduler.presetTomorrow', { time: tomorrowTime }) }}
        </Button>
        <button
          type="button"
          class="absolute right-0.5 top-1/2 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground transition-colors hover:text-foreground"
          :title="$t('scheduler.editTomorrowTime')"
          :aria-label="$t('scheduler.editTomorrowTime')"
          @click.stop="openSchedulerSettings()"
        >
          <Settings2 class="size-2.5" />
        </button>
      </div>
    </div>

    <!-- exact delay: an hours stepper and a 10-minute stepper side by side, then one button that
         schedules the combined hours+minutes -->
    <div class="flex items-center justify-center gap-3">
      <div class="flex items-center gap-1">
        <Button
          variant="outline"
          size="icon-xs"
          :disabled="hours <= 0"
          :aria-label="$t('scheduler.hoursDecrease')"
          @click="stepHours(-1)"
        >
          <Minus />
        </Button>
        <span class="w-8 text-center text-xs tabular-nums">{{ $t('scheduler.hoursValue', { n: hours }) }}</span>
        <Button
          variant="outline"
          size="icon-xs"
          :aria-label="$t('scheduler.hoursIncrease')"
          @click="stepHours(1)"
        >
          <Plus />
        </Button>
      </div>
      <div class="flex items-center gap-1">
        <Button
          variant="outline"
          size="icon-xs"
          :disabled="minutes <= 0"
          :aria-label="$t('scheduler.minutesDecrease')"
          @click="stepMinutes(-10)"
        >
          <Minus />
        </Button>
        <span class="w-9 text-center text-xs tabular-nums">{{ $t('scheduler.minutesValue', { n: minutes }) }}</span>
        <Button
          variant="outline"
          size="icon-xs"
          :disabled="minutes >= 50"
          :aria-label="$t('scheduler.minutesIncrease')"
          @click="stepMinutes(10)"
        >
          <Plus />
        </Button>
      </div>
    </div>
    <!-- pink (default) means "clickable right now"; gray (secondary) means it still needs input -->
    <Button
      :variant="delayMin > 0 ? 'default' : 'secondary'"
      size="xs"
      class="w-full"
      :disabled="delayMin <= 0"
      @click="pickInMinutes(delayMin)"
    >
      {{ delayLabel }}
    </Button>

    <label class="block text-[11px] text-muted-foreground">{{ $t('scheduler.schedulePickLabel') }}</label>
    <Input v-model="localValue" type="datetime-local" class="text-xs" />
    <Button
      :variant="localValue ? 'default' : 'secondary'"
      size="sm"
      class="w-full"
      :disabled="!localValue"
      @click="pickExact()"
    >
      {{ pickLabel }}
    </Button>
  </div>
</template>
