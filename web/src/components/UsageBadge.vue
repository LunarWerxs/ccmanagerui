<script setup lang="ts">
// Color-coded usage Badge + hover/click Popover breakdown, shared by the desktop Instances
// table and the CLI Instances table (both key into useUsage by a different string, so this
// component just takes the already-resolved snapshot rather than a key).
import { Loader2, RefreshCw } from '@lucide/vue'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useUsage } from '@/composables/useUsage'
import type { UsageSnapshot } from '@/lib/api'
import {
  isNoDataSnap,
  isStaleSnap,
  usageBadgeVariant,
  usageCellLabel,
  usageCheckedAgo,
  usageReasonMessageKey,
} from '@/lib/usage'

const props = defineProps<{
  snapshot: UsageSnapshot | null | undefined
  checking?: boolean
  /** This row's cache key (`desktop:<dir>` / `cli:<id>` / `acct:<id>`) — used to look up WHY
   *  a no-data snapshot is empty via useUsage's reason map. Optional so a caller that never
   *  passes it just falls back to the generic "not checked yet" message. */
  usageKey?: string
}>()

defineEmits<{ check: [] }>()

const { t } = useI18n()
const { reasonFor } = useUsage()

const noData = computed(() => !props.snapshot || isNoDataSnap(props.snapshot))
const label = computed(() => usageCellLabel(props.snapshot))
const variant = computed(() => {
  const snap = props.snapshot
  const pct = snap ? (snap.weekAll?.pct ?? null) : null
  return pct == null ? 'outline' : usageBadgeVariant(pct)
})
const stale = computed(() => isStaleSnap(props.snapshot))
const checkedAgo = computed(() =>
  props.snapshot ? usageCheckedAgo(props.snapshot.capturedAt) : '',
)
// Explains a "—" cell instead of showing it silently (see the usage-check `reason` DTO field).
const reasonMessage = computed(() => {
  const key = usageReasonMessageKey(props.usageKey ? reasonFor(props.usageKey) : undefined)
  return t(key ?? 'instances.usageNotChecked')
})
</script>

<template>
  <Popover>
    <PopoverTrigger as-child>
      <Badge
        :variant="variant"
        class="cursor-pointer"
        :class="stale ? 'opacity-60' : ''"
        :title="noData ? reasonMessage : undefined"
      >
        <Loader2 v-if="checking" class="animate-spin" />
        <span>{{ label }}</span>
      </Badge>
    </PopoverTrigger>
    <PopoverContent align="start" class="w-64 text-xs">
      <div v-if="noData" class="text-muted-foreground">
        {{ reasonMessage }}
      </div>
      <div v-else class="space-y-1.5">
        <div v-if="snapshot?.session" class="flex items-center justify-between gap-2">
          <span class="text-muted-foreground">{{ $t('instances.usageSession') }}</span>
          <span class="font-medium">{{ snapshot.session.pct }}% · {{ snapshot.session.resets }}</span>
        </div>
        <div v-if="snapshot?.weekAll" class="flex items-center justify-between gap-2">
          <span class="text-muted-foreground">{{ $t('instances.usageWeekAll') }}</span>
          <span class="font-medium">{{ snapshot.weekAll.pct }}% · {{ snapshot.weekAll.resets }}</span>
        </div>
        <div v-if="snapshot?.weekModel" class="flex items-center justify-between gap-2">
          <span class="text-muted-foreground">
            {{ $t('instances.usageWeekModel', { model: snapshot.weekModel.label }) }}
          </span>
          <span class="font-medium">{{ snapshot.weekModel.pct }}% · {{ snapshot.weekModel.resets }}</span>
        </div>
        <p class="text-muted-foreground">
          {{ $t('instances.usageCheckedAgo', { when: checkedAgo }) }}
        </p>
      </div>
      <Button
        size="xs"
        variant="ghost"
        class="mt-2 w-full"
        :disabled="checking"
        @click="$emit('check')"
      >
        <RefreshCw :class="checking ? 'animate-spin' : ''" />
        {{ checking ? $t('instances.usageChecking') : $t('instances.usageCheckNow') }}
      </Button>
    </PopoverContent>
  </Popover>
</template>
