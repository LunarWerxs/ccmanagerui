<script setup lang="ts">
import { GitFork, Pencil, Plus, Sparkles } from '@lucide/vue'
import { computed, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useBuilder } from '@/composables/useBuilder'
import { useData } from '@/composables/useData'
import * as api from '@/lib/api'
import { EFFORTS, MODELS, PERMISSION_MODES } from '@/lib/format'

// open/prefill/editItem are module-scope state in useBuilder — any view can launch
// the dialog (header "New run", session resume, queue card Edit) without prop plumbing.
const { open, prefill, editItem } = useBuilder()
const emit = defineEmits<{ created: [] }>()

const { t } = useI18n()
const { accounts, refreshQueue } = useData()

const form = reactive({
  new_chat: false,
  session_id: '',
  title: '',
  cwd: '',
  prompt: '',
  model: '',
  effort: '',
  permission_mode: '',
  account_id: '',
  fork: false,
  not_before_local: '',
})
const submitting = ref(false)
const error = ref<string | null>(null)

const editing = computed(() => !!editItem.value)

/** ISO (UTC) → the local wall-clock string a datetime-local input expects. */
function toLocalInput(iso: string | null): string {
  if (!iso) return ''
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return ''
  return new Date(ms - new Date(ms).getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}

// keyed on [open, editItem] so switching straight from one card's Edit to another
// (or Edit → New run) re-prefills even while the dialog is already open
watch([open, editItem], ([isOpen]) => {
  if (!isOpen) return
  error.value = null
  const it = editItem.value
  if (it) {
    form.new_chat = it.new_chat
    form.session_id = it.session_id
    form.title = it.title
    form.cwd = it.cwd
    form.prompt = it.prompt
    form.model = it.model ?? ''
    form.effort = it.effort ?? ''
    form.permission_mode = it.permission_mode ?? ''
    form.account_id = it.account_id ?? ''
    form.fork = it.fork
    form.not_before_local = toLocalInput(it.not_before)
    return
  }
  const p = prefill.value ?? {}
  form.new_chat = p.new_chat ?? false
  form.session_id = p.session_id ?? ''
  form.title = p.title ?? ''
  form.cwd = p.cwd ?? ''
  form.prompt = form.new_chat ? '' : 'resume'
  form.model = ''
  form.effort = ''
  form.permission_mode = ''
  form.account_id = ''
  form.fork = false
  form.not_before_local = ''
})

const accountOptions = computed(() => [
  { value: '', label: t('builder.accountAmbient') },
  ...accounts.value.map((a) => ({
    value: a.id,
    label: `${a.label} · ${a.auth_type === 'api_key' ? t('builder.accountAuthApiKey') : t('builder.accountAuthOauth')}`,
  })),
])

const canSubmit = computed(
  () =>
    form.title.trim() &&
    form.cwd.trim() &&
    form.prompt.trim() &&
    (form.new_chat || form.session_id.trim()),
)

async function submit() {
  if (!canSubmit.value || submitting.value) return
  submitting.value = true
  error.value = null
  const not_before = form.not_before_local ? new Date(form.not_before_local).toISOString() : null
  try {
    const body = {
      session_id: form.session_id.trim() || undefined,
      title: form.title.trim(),
      cwd: form.cwd.trim(),
      prompt: form.prompt,
      model: form.model || null,
      effort: (form.effort || null) as api.EffortLevel | null,
      permission_mode: (form.permission_mode || null) as api.PermissionMode | null,
      account_id: form.account_id || null,
      new_chat: form.new_chat,
      fork: form.fork,
      not_before,
    }
    if (editItem.value) await api.updateQueueItem(editItem.value.id, body)
    else await api.createQueueItem(body)
    await refreshQueue()
    emit('created')
    open.value = false
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="max-w-[660px]">
      <DialogHeader>
        <DialogTitle>{{ editing ? $t('builder.editDialogTitle') : $t('builder.dialogTitle') }}</DialogTitle>
      </DialogHeader>

      <div class="space-y-4">
        <!-- mode toggle -->
        <div class="flex items-center gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2.5">
          <Sparkles class="size-4 text-primary" />
          <div class="flex-1">
            <div class="text-sm font-medium">{{ $t('builder.newChatTitle') }}</div>
            <div class="text-xs text-muted-foreground">
              {{ $t('builder.newChatHelper') }}
            </div>
          </div>
          <Switch v-model="form.new_chat" />
        </div>

        <div v-if="!form.new_chat" class="space-y-1.5">
          <label class="text-xs font-medium text-muted-foreground">{{ $t('builder.sessionToResumeLabel') }}</label>
          <Input v-model="form.session_id" :placeholder="$t('builder.sessionToResumePlaceholder')" class="font-mono text-xs" />
        </div>

        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div class="space-y-1.5">
            <label class="text-xs font-medium text-muted-foreground">{{ $t('builder.titleLabel') }}</label>
            <Input v-model="form.title" :placeholder="$t('builder.titlePlaceholder')" />
          </div>
          <div class="space-y-1.5">
            <label class="text-xs font-medium text-muted-foreground">{{ $t('builder.cwdLabel') }}</label>
            <Input v-model="form.cwd" :placeholder="$t('builder.cwdPlaceholder')" class="font-mono text-xs" />
          </div>
        </div>

        <div class="space-y-1.5">
          <label class="text-xs font-medium text-muted-foreground">{{ $t('builder.promptLabel') }}</label>
          <Textarea v-model="form.prompt" :rows="4" :placeholder="$t('builder.promptPlaceholder')" />
        </div>

        <div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div class="space-y-1.5">
            <label class="text-xs font-medium text-muted-foreground">{{ $t('builder.modelLabel') }}</label>
            <Select v-model="form.model">
              <SelectTrigger class="w-full"><SelectValue :placeholder="$t('builder.defaultPlaceholder')" /></SelectTrigger>
              <SelectContent>
                <SelectItem v-for="o in MODELS" :key="o.value" :value="o.value">{{ o.label }}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div class="space-y-1.5">
            <label class="text-xs font-medium text-muted-foreground">{{ $t('builder.effortLabel') }}</label>
            <Select v-model="form.effort">
              <SelectTrigger class="w-full"><SelectValue :placeholder="$t('builder.defaultPlaceholder')" /></SelectTrigger>
              <SelectContent>
                <SelectItem v-for="o in EFFORTS" :key="o.value" :value="o.value">{{ o.label }}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div class="space-y-1.5">
            <label class="text-xs font-medium text-muted-foreground">{{ $t('builder.permissionLabel') }}</label>
            <Select v-model="form.permission_mode">
              <SelectTrigger class="w-full"><SelectValue :placeholder="$t('builder.defaultPlaceholder')" /></SelectTrigger>
              <SelectContent>
                <SelectItem v-for="o in PERMISSION_MODES" :key="o.value" :value="o.value">{{ o.label }}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div class="space-y-1.5">
            <label class="text-xs font-medium text-muted-foreground">{{ $t('builder.accountLabel') }}</label>
            <Select v-model="form.account_id">
              <SelectTrigger class="w-full"><SelectValue :placeholder="$t('builder.defaultPlaceholder')" /></SelectTrigger>
              <SelectContent>
                <SelectItem v-for="o in accountOptions" :key="o.value" :value="o.value">{{ o.label }}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div class="space-y-1.5">
            <label class="text-xs font-medium text-muted-foreground">{{ $t('builder.runAtLabel') }}</label>
            <Input v-model="form.not_before_local" type="datetime-local" class="text-xs" :title="$t('builder.runAtHint')" />
          </div>
        </div>

        <label v-if="!form.new_chat" class="flex cursor-pointer items-center gap-2.5 text-sm">
          <Switch v-model="form.fork" />
          <GitFork class="size-4 text-muted-foreground" />
          {{ $t('builder.forkLabel') }}
        </label>

        <p v-if="error" class="text-xs text-destructive">{{ error }}</p>
      </div>

      <DialogFooter>
        <Button variant="ghost" @click="open = false">{{ $t('builder.cancel') }}</Button>
        <Button :disabled="!canSubmit || submitting" @click="submit">
          <Pencil v-if="editing" /><Plus v-else />
          {{ editing ? $t('builder.saveChanges') : $t('builder.addToQueue') }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
