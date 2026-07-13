<script setup lang="ts">
import { ref, watch } from 'vue'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { INSTANCE_LABEL_MAX, type InstanceColorKey, type InstanceIconKey } from '@/lib/api'
import {
  colorValue,
  INSTANCE_COLOR_KEYS,
  INSTANCE_ICON_KEYS,
  iconComponent,
  resolveColorKey,
  resolveIconKey,
} from '@/lib/instance-appearance'

const open = defineModel<boolean>('open', { default: false })

const props = defineProps<{
  /** The instance's on-disk folder name — shown as the placeholder + used to resolve the
   *  deterministic default icon/color when none has been chosen. */
  instanceName?: string | null
  /** The instance's normalized dir (seeds the deterministic default icon/color). */
  dir?: string | null
  /** Current display-label override (null = no override; the field starts empty). */
  currentLabel?: string | null
  currentIcon?: InstanceIconKey | null
  currentColor?: InstanceColorKey | null
  /** Running instances show the live active-state dot in the preview. */
  running?: boolean
  submitting?: boolean
  errorMessage?: string | null
}>()

const emit = defineEmits<{
  /** The parent performs the API call and closes the dialog once it knows the outcome. `label`
   *  is null when the field is empty (falls back to the folder name). */
  submit: [payload: { label: string | null; icon: InstanceIconKey; color: InstanceColorKey }]
}>()

const name = ref('')
const icon = ref<InstanceIconKey>('box')
const color = ref<InstanceColorKey>('slate')

// (Re)seed the fields each time the dialog opens: the name from the current label (empty when
// unset, so the folder name shows as placeholder), the icon/color from the current choice or the
// deterministic default so the pickers open on the glyph/hue already visible in the table.
watch(open, (isOpen) => {
  if (!isOpen) return
  name.value = props.currentLabel ?? ''
  icon.value = resolveIconKey({ dir: props.dir ?? '', icon: props.currentIcon ?? null })
  color.value = resolveColorKey({ dir: props.dir ?? '', color: props.currentColor ?? null })
})

function handleSubmit() {
  const trimmed = name.value.trim()
  emit('submit', {
    label: trimmed.length > 0 ? trimmed : null,
    icon: icon.value,
    color: color.value,
  })
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent>
      <form @submit.prevent="handleSubmit">
        <DialogHeader>
          <DialogTitle>{{ $t('instances.editDialogTitle') }}</DialogTitle>
          <DialogDescription>{{ $t('instances.editDialogDescription') }}</DialogDescription>
        </DialogHeader>

        <!-- live preview: the row exactly as it will render in the table -->
        <div class="mt-3 flex items-center gap-2.5 rounded-lg border border-border bg-muted/30 px-3 py-2.5">
          <span class="relative inline-flex size-6 items-center justify-center">
            <component :is="iconComponent(icon)" class="size-5" :style="{ color: colorValue(color) }" />
            <span
              v-if="running"
              class="absolute -right-1 -top-1 size-2 rounded-full bg-success ring-2 ring-background"
            />
          </span>
          <span class="truncate text-sm font-medium">{{ name.trim() || instanceName }}</span>
        </div>

        <div class="mt-3 flex flex-col gap-1.5">
          <label for="instance-edit-name" class="text-xs font-medium text-muted-foreground">
            {{ $t('instances.editDialogNameLabel') }}
          </label>
          <Input
            id="instance-edit-name"
            v-model="name"
            :placeholder="instanceName ?? $t('instances.createDialogPlaceholder')"
            :maxlength="INSTANCE_LABEL_MAX"
            :disabled="submitting"
            autofocus
          />
        </div>

        <div class="mt-4 flex flex-col gap-1.5">
          <span class="text-xs font-medium text-muted-foreground">{{ $t('instances.editDialogIconLabel') }}</span>
          <div class="grid grid-cols-8 gap-1">
            <button
              v-for="k in INSTANCE_ICON_KEYS"
              :key="k"
              type="button"
              class="inline-flex size-8 items-center justify-center rounded-md border transition-colors"
              :class="k === icon ? 'border-primary bg-primary/10' : 'border-transparent hover:bg-accent'"
              :aria-label="k"
              :aria-pressed="k === icon"
              @click="icon = k"
            >
              <component :is="iconComponent(k)" class="size-4" :style="{ color: colorValue(color) }" />
            </button>
          </div>
        </div>

        <div class="mt-4 flex flex-col gap-1.5">
          <span class="text-xs font-medium text-muted-foreground">{{ $t('instances.editDialogColorLabel') }}</span>
          <div class="flex flex-wrap gap-2">
            <button
              v-for="c in INSTANCE_COLOR_KEYS"
              :key="c"
              type="button"
              class="size-6 rounded-full ring-offset-2 ring-offset-background transition-transform hover:scale-110"
              :class="c === color ? 'ring-2 ring-foreground' : ''"
              :style="{ backgroundColor: colorValue(c) }"
              :aria-label="c"
              :aria-pressed="c === color"
              @click="color = c"
            />
          </div>
        </div>

        <p v-if="errorMessage" class="mt-3 text-xs text-destructive">{{ errorMessage }}</p>

        <DialogFooter class="mt-4">
          <Button type="submit" :disabled="submitting">
            {{ submitting ? $t('instances.editDialogSaving') : $t('instances.editDialogSubmit') }}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
