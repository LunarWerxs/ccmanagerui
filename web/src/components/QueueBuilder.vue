<script setup lang="ts">
import { ChevronDown, GitFork, Pencil, Plus, Sparkles } from '@lucide/vue'
import { computed, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import SessionPicker from '@/components/SessionPicker.vue'
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
import { useCliInstances } from '@/composables/useCliInstances'
import { useData } from '@/composables/useData'
import { useInstances } from '@/composables/useInstances'
import * as api from '@/lib/api'
import { EFFORTS, MODELS, PERMISSION_MODES } from '@/lib/format'
import { displayName } from '@/lib/instance-appearance'
import ExpandTransition from '@/shell/ExpandTransition.vue'
import InfoHint from '@/shell/InfoHint.vue'

// open/prefill/editItem are module-scope state in useBuilder — any view can launch
// the dialog (header "New run", session resume, queue card Edit) without prop plumbing.
const { open, prefill, editItem } = useBuilder()
const emit = defineEmits<{ created: [] }>()

const { t } = useI18n()
const { accounts, sessions, refreshQueue } = useData()
// Run-as candidates are the instances the user has ALREADY signed in (Instances tab) — that's
// where accounts get added; the sqlite `accounts` rows are a legacy/headless fallback.
const { instances, refreshInstances } = useInstances()
const { cliInstances, refreshCliInstances } = useCliInstances()

const form = reactive({
  new_chat: false,
  session_ids: [] as string[],
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
const advancedOpen = ref(false)

const editing = computed(() => !!editItem.value)
// Multi-select resume is a create-only convenience: editing acts on one existing item.
const multiSession = computed(() => !editing.value && !form.new_chat)

const byId = computed(() => new Map(sessions.value.map((s) => [s.session_id, s])))

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
  advancedOpen.value = false
  // The run-as options come from the live instance lists, which only self-populate on the
  // Instances tab — refresh here so the picker is complete even if that tab was never opened.
  void refreshInstances()
  void refreshCliInstances({ silent: true })
  const it = editItem.value
  if (it) {
    form.new_chat = it.new_chat
    form.session_ids = it.session_id ? [it.session_id] : []
    form.title = it.title
    form.cwd = it.cwd
    form.prompt = it.prompt
    form.model = it.model ?? ''
    form.effort = it.effort ?? ''
    form.permission_mode = it.permission_mode ?? ''
    // One picker field carries both shapes: a prefixed instance ref wins over a legacy account id.
    form.account_id = it.instance_ref ?? it.account_id ?? ''
    form.fork = it.fork
    form.not_before_local = toLocalInput(it.not_before)
    return
  }
  const p = prefill.value ?? {}
  form.new_chat = p.new_chat ?? false
  form.session_ids = p.session_id ? [p.session_id] : []
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

// Run-as options, in preference order: Ambient, then every signed-in instance (Desktop rows are
// the account rows; a CLI instance LINKED to one is the same account and would be a duplicate
// entry, so only unlinked CLI logins appear), then any legacy pasted credentials. Instance values
// are prefixed ('desktop:<dir>' / 'cli:<id>'); a bare uuid is a sqlite accounts row.
const accountOptions = computed(() => [
  { value: '', label: t('builder.accountAmbient') },
  ...instances.value
    .filter((i) => i.account?.email)
    .map((i) => ({
      value: `desktop:${i.dir}`,
      label: `${displayName(i)} · ${t('builder.accountDesktopInstance')}`,
    })),
  ...cliInstances.value
    .filter((c) => c.loggedIn && !c.associatedDesktopDir)
    .map((c) => ({
      value: `cli:${c.id}`,
      label: `${c.name} · ${t('builder.accountCliInstance')}`,
    })),
  ...accounts.value.map((a) => ({
    value: a.id,
    label: `${a.label} · ${a.auth_type === 'api_key' ? t('builder.accountAuthApiKey') : t('builder.accountAuthOauth')}`,
  })),
])

const canSubmit = computed(() => {
  if (!form.prompt.trim()) return false
  if (form.new_chat) return !!form.title.trim() && !!form.cwd.trim()
  return form.session_ids.length > 0
})

/** For a resume item, fall back to the picked session's own title/cwd when not overridden. */
function resolveTitleCwd(sessionId: string): { title: string; cwd: string } {
  const s = byId.value.get(sessionId)
  // In single-select the override fields apply; in multi each session keeps its own.
  const singleOverride = form.session_ids.length === 1
  return {
    title: (singleOverride && form.title.trim()) || s?.title || t('builder.untitledRun'),
    cwd: (singleOverride && form.cwd.trim()) || s?.cwd || '',
  }
}

async function submit() {
  if (!canSubmit.value || submitting.value) return
  submitting.value = true
  error.value = null
  const not_before = form.not_before_local ? new Date(form.not_before_local).toISOString() : null
  // Split the one picker value back into its two storage shapes (see accountOptions).
  const runAs = form.account_id
  const isInstanceRef = runAs.startsWith('desktop:') || runAs.startsWith('cli:')
  const shared = {
    prompt: form.prompt,
    model: form.model || null,
    effort: (form.effort || null) as api.EffortLevel | null,
    permission_mode: (form.permission_mode || null) as api.PermissionMode | null,
    account_id: !runAs || isInstanceRef ? null : runAs,
    instance_ref: isInstanceRef ? runAs : null,
    not_before,
  }
  try {
    if (editItem.value) {
      await api.updateQueueItem(editItem.value.id, {
        ...shared,
        session_id: form.session_ids[0] || undefined,
        title: form.title.trim() || t('builder.untitledRun'),
        cwd: form.cwd.trim(),
        new_chat: form.new_chat,
        fork: form.fork,
      })
    } else if (form.new_chat) {
      await api.createQueueItem({
        ...shared,
        session_id: undefined,
        title: form.title.trim(),
        cwd: form.cwd.trim(),
        new_chat: true,
        fork: false,
      })
    } else {
      // resume: one queued run per selected session, each using its own title/cwd
      for (const id of form.session_ids) {
        const { title, cwd } = resolveTitleCwd(id)
        await api.createQueueItem({
          ...shared,
          session_id: id,
          title,
          cwd,
          new_chat: false,
          fork: form.fork,
        })
      }
    }
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
        <!-- mode toggle: create-only. Editing an existing item never converts it to/from
             a from-scratch run, so the switch is hidden there (owner request). -->
        <div
          v-if="!editing"
          class="flex items-center gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2.5"
        >
          <Sparkles class="size-4 text-primary" />
          <div class="flex-1">
            <div class="text-sm font-medium">{{ $t('builder.newChatTitle') }}</div>
            <div class="text-xs text-muted-foreground">{{ $t('builder.newChatHelper') }}</div>
          </div>
          <Switch v-model="form.new_chat" />
        </div>

        <!-- resume: searchable session picker (multi in create, single in edit) -->
        <div v-if="!form.new_chat" class="space-y-1.5">
          <label class="text-xs font-medium text-muted-foreground">{{ $t('builder.sessionToResumeLabel') }}</label>
          <SessionPicker v-model="form.session_ids" :multiple="multiSession" />
        </div>

        <!-- new chat: title + cwd are the core inputs -->
        <div v-if="form.new_chat" class="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
          <Textarea v-model="form.prompt" class="max-h-56 min-h-24" :placeholder="$t('builder.promptPlaceholder')" />
        </div>

        <!-- Account stays in the core view (not Advanced): it's the "which login this run uses"
             choice and people want it up front. "Ambient" = whatever the CLI is already signed
             into; specific accounts are the instances signed in via the Instances tab. -->
        <div class="space-y-1.5">
          <label class="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            {{ $t('builder.accountLabel') }}
            <InfoHint :text="$t('builder.accountHint')" />
          </label>
          <Select v-model="form.account_id">
            <SelectTrigger class="w-full"><SelectValue :placeholder="$t('builder.accountAmbient')" /></SelectTrigger>
            <SelectContent>
              <SelectItem v-for="o in accountOptions" :key="o.value" :value="o.value">{{ o.label }}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <!-- everything else is advanced: hidden by default so the common path stays short -->
        <button
          type="button"
          class="flex w-full items-center justify-between rounded-md px-1 py-1 text-xs font-medium text-muted-foreground hover:text-foreground"
          @click="advancedOpen = !advancedOpen"
        >
          {{ $t('builder.advancedOptions') }}
          <ChevronDown class="size-4 transition-transform duration-200" :class="advancedOpen ? 'rotate-180' : ''" />
        </button>
        <ExpandTransition :open="advancedOpen">
          <div class="space-y-4 pt-1">
            <!-- resume: optional title/cwd overrides (single select only) -->
            <div v-if="!form.new_chat && form.session_ids.length === 1" class="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div class="space-y-1.5">
                <label class="text-xs font-medium text-muted-foreground">{{ $t('builder.titleOverrideLabel') }}</label>
                <Input v-model="form.title" :placeholder="$t('builder.titleOverridePlaceholder')" />
              </div>
              <div class="space-y-1.5">
                <label class="text-xs font-medium text-muted-foreground">{{ $t('builder.cwdOverrideLabel') }}</label>
                <Input v-model="form.cwd" :placeholder="$t('builder.cwdOverridePlaceholder')" class="font-mono text-xs" />
              </div>
            </div>

            <div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div class="space-y-1.5">
                <label class="text-xs font-medium text-muted-foreground">{{ $t('builder.modelLabel') }}</label>
                <Select v-model="form.model">
                  <SelectTrigger class="w-full"><SelectValue :placeholder="$t('builder.defaultPlaceholder')" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">{{ $t('builder.defaultPlaceholder') }}</SelectItem>
                    <SelectItem v-for="o in MODELS" :key="o.value" :value="o.value">{{ o.label }}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div class="space-y-1.5">
                <label class="text-xs font-medium text-muted-foreground">{{ $t('builder.effortLabel') }}</label>
                <Select v-model="form.effort">
                  <SelectTrigger class="w-full"><SelectValue :placeholder="$t('builder.defaultPlaceholder')" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">{{ $t('builder.defaultPlaceholder') }}</SelectItem>
                    <SelectItem v-for="o in EFFORTS" :key="o.value" :value="o.value">{{ o.label }}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div class="space-y-1.5">
                <label class="text-xs font-medium text-muted-foreground">{{ $t('builder.permissionLabel') }}</label>
                <Select v-model="form.permission_mode">
                  <SelectTrigger class="w-full"><SelectValue :placeholder="$t('builder.defaultPlaceholder')" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">{{ $t('builder.defaultPlaceholder') }}</SelectItem>
                    <SelectItem v-for="o in PERMISSION_MODES" :key="o.value" :value="o.value">{{ o.label }}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div class="space-y-1.5">
              <label class="text-xs font-medium text-muted-foreground">{{ $t('builder.runAtLabel') }}</label>
              <Input v-model="form.not_before_local" type="datetime-local" class="text-xs" :title="$t('builder.runAtHint')" />
            </div>

            <label v-if="!form.new_chat" class="flex cursor-pointer items-center gap-2.5 text-sm">
              <Switch v-model="form.fork" />
              <GitFork class="size-4 text-muted-foreground" />
              {{ $t('builder.forkLabel') }}
            </label>
          </div>
        </ExpandTransition>

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
