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

const open = defineModel<boolean>('open', { default: false })

const props = defineProps<{
  /** Current instance name — prefills the field so it's a small edit, not a retype. */
  currentName?: string | null
  submitting?: boolean
  errorMessage?: string | null
}>()

const emit = defineEmits<{
  /** Emitted on submit; the parent performs the API call and closes the dialog itself
   *  once it knows the outcome (so the field only resets on success). */
  submit: [name: string]
}>()

const name = ref('')

// Prefill with the current name whenever the dialog is (re)opened.
watch(open, (isOpen) => {
  if (isOpen) name.value = props.currentName ?? ''
})

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
          <DialogTitle>{{ $t('instances.renameDialogTitle') }}</DialogTitle>
          <DialogDescription>{{ $t('instances.renameDialogDescription') }}</DialogDescription>
        </DialogHeader>

        <div class="mt-3 flex flex-col gap-1.5">
          <label for="instance-rename-name" class="text-xs font-medium text-muted-foreground">
            {{ $t('instances.renameDialogLabel') }}
          </label>
          <Input
            id="instance-rename-name"
            v-model="name"
            :placeholder="$t('instances.createDialogPlaceholder')"
            :disabled="submitting"
            autofocus
          />
          <p v-if="errorMessage" class="text-xs text-destructive">{{ errorMessage }}</p>
        </div>

        <DialogFooter class="mt-4">
          <Button type="submit" :disabled="submitting || !name.trim() || name.trim() === (currentName ?? '')">
            {{ submitting ? $t('instances.renameDialogRenaming') : $t('instances.renameDialogSubmit') }}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
