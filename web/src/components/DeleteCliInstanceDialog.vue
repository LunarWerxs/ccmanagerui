<script setup lang="ts">
// Mirrors DeleteInstanceDialog.vue exactly (type-the-exact-name confirmation), scoped to
// CLI instances so its copy can talk about a "CLAUDE_CONFIG_DIR" rather than a desktop profile.
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
  instanceName: string | null
  submitting?: boolean
  errorMessage?: string | null
}>()

const emit = defineEmits<{
  confirm: [name: string]
}>()

const typed = ref('')

watch(open, (isOpen) => {
  if (isOpen) typed.value = ''
})

const matches = computed(
  () => typed.value.trim() === (props.instanceName ?? '').trim() && !!props.instanceName,
)

function handleSubmit() {
  if (!matches.value || !props.instanceName) return
  emit('confirm', props.instanceName)
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent>
      <form @submit.prevent="handleSubmit">
        <DialogHeader>
          <DialogTitle>{{ $t('cliInstances.deleteDialogTitle') }}</DialogTitle>
          <DialogDescription>{{ $t('cliInstances.deleteDialogDescription') }}</DialogDescription>
        </DialogHeader>

        <div class="mt-3 flex flex-col gap-1.5">
          <label for="cli-instance-delete-confirm" class="text-xs font-medium text-muted-foreground">
            {{ $t('cliInstances.deleteDialogLabel', { name: instanceName ?? '' }) }}
          </label>
          <Input
            id="cli-instance-delete-confirm"
            v-model="typed"
            :placeholder="instanceName ?? $t('cliInstances.deleteDialogPlaceholder')"
            :disabled="submitting"
            autofocus
          />
          <p v-if="errorMessage" class="text-xs text-destructive">{{ errorMessage }}</p>
          <p v-else-if="typed && !matches" class="text-xs text-destructive">
            {{ $t('cliInstances.deleteDialogMismatch') }}
          </p>
        </div>

        <DialogFooter class="mt-4">
          <Button type="submit" variant="destructive" :disabled="submitting || !matches">
            {{ submitting ? $t('cliInstances.deleteDialogDeleting') : $t('cliInstances.deleteDialogSubmit') }}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
