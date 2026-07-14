<script setup lang="ts">
// A single small text-input dialog reused for both "New CLI instance" (create) and "Rename",
// the same shape as CreateInstanceDialog.vue, just parameterized on `mode` so both actions
// don't need near-duplicate components.
import { computed, ref, watch } from 'vue'
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

const open = defineModel<boolean>('open', { default: false })

const props = defineProps<{
  mode: 'create' | 'rename'
  currentName?: string | null
  submitting?: boolean
  errorMessage?: string | null
}>()

const emit = defineEmits<{
  submit: [name: string]
}>()

const name = ref('')

watch(open, (isOpen) => {
  if (isOpen) name.value = props.mode === 'rename' ? (props.currentName ?? '') : ''
})

const titleKey = computed(() =>
  props.mode === 'rename' ? 'cliInstances.renameDialogTitle' : 'cliInstances.createDialogTitle',
)
const descriptionKey = computed(() =>
  props.mode === 'rename'
    ? 'cliInstances.renameDialogDescription'
    : 'cliInstances.createDialogDescription',
)
const submitKey = computed(() =>
  props.mode === 'rename' ? 'cliInstances.renameDialogSubmit' : 'cliInstances.createDialogSubmit',
)
const submittingKey = computed(() =>
  props.mode === 'rename'
    ? 'cliInstances.renameDialogRenaming'
    : 'cliInstances.createDialogCreating',
)

function handleSubmit() {
  const trimmed = name.value.trim()
  if (!trimmed) return
  emit('submit', trimmed)
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent>
      <form @submit.prevent="handleSubmit">
        <DialogHeader>
          <DialogTitle>{{ $t(titleKey) }}</DialogTitle>
          <DialogDescription>{{ $t(descriptionKey) }}</DialogDescription>
        </DialogHeader>

        <div class="mt-3 flex flex-col gap-1.5">
          <label for="cli-instance-name" class="text-xs font-medium text-muted-foreground">
            {{ $t('cliInstances.nameLabel') }}
          </label>
          <Input
            id="cli-instance-name"
            v-model="name"
            :placeholder="$t('cliInstances.namePlaceholder')"
            :disabled="submitting"
            autofocus
          />
          <p v-if="errorMessage" class="text-xs text-destructive">{{ errorMessage }}</p>
        </div>

        <DialogFooter class="mt-4">
          <Button type="submit" :disabled="submitting || !name.trim()">
            {{ submitting ? $t(submittingKey) : $t(submitKey) }}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
