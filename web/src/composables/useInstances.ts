// Instance data + actions, mirroring useData.ts's shape (module-scope singleton refs +
// a `guard` helper that swallows failures into `lastError` instead of throwing across a
// component boundary). "Instance account" = which Anthropic account a Claude Desktop
// *instance* is logged into — resolved lazily, never the sqlite `accounts` table.
import { ref } from 'vue'
import type { CMInstance } from '@/lib/api'
import * as api from '@/lib/api'

const instances = ref<CMInstance[]>([])
const loading = ref(false)
const resolvingAccounts = ref(false)
const busyDirs = ref<Set<string>>(new Set())
const lastError = ref<string | null>(null)
// Dirs whose account resolution has already been auto-triggered this session, so a
// persistently-unresolvable instance (e.g. logged out) isn't re-hit on every 4s poll tick.
const autoResolveAttempted = new Set<string>()

function guard<T>(p: Promise<T>): Promise<T | undefined> {
  return p.catch((e) => {
    lastError.value = e instanceof Error ? e.message : String(e)
    return undefined
  })
}

function setBusy(dir: string, busy: boolean) {
  const next = new Set(busyDirs.value)
  if (busy) next.add(dir)
  else next.delete(dir)
  busyDirs.value = next
}

function upsert(next: CMInstance) {
  const idx = instances.value.findIndex((i) => i.dir === next.dir)
  if (idx === -1) {
    instances.value = [...instances.value, next]
  } else {
    const copy = instances.value.slice()
    copy[idx] = { ...copy[idx], ...next }
    instances.value = copy
  }
}

/** Reload the instance list. `silent` (used by the 4s background poll) skips the `loading`
 *  toggle so the toolbar Refresh icon only spins on a first load or a user-initiated refresh —
 *  not every poll tick, which reads as a distracting constant spinner. */
async function refreshInstances(opts: { silent?: boolean } = {}) {
  if (!opts.silent) loading.value = true
  const r = await guard(api.listInstances())
  if (r) {
    // Preserve any account identity we've already resolved: the /api/instances list omits it
    // (account is null there), so a naive replace would wipe resolved emails on every poll.
    const prev = new Map(instances.value.map((i) => [i.dir, i.account]))
    instances.value = r.map((i) =>
      i.account == null && prev.get(i.dir) ? { ...i, account: prev.get(i.dir) ?? null } : i,
    )
  }
  if (!opts.silent) loading.value = false
  void autoResolveUnresolvedAccounts()
}

/** Auto-triggers account resolution for running instances that don't have one yet. Runs
 *  silently (no toasts) on every load/poll tick, but only ever attempts a given dir once per
 *  app session so a persistently-unresolvable instance (logged out, offline) isn't retried
 *  every 4s forever. The manual per-row "Resolve" action bypasses this guard entirely. */
async function autoResolveUnresolvedAccounts(): Promise<void> {
  if (resolvingAccounts.value) return
  const unresolved = instances.value.filter(
    (i) => i.isRunning && i.account == null && !autoResolveAttempted.has(i.dir),
  )
  if (unresolved.length === 0) return

  resolvingAccounts.value = true
  try {
    for (const inst of unresolved) {
      autoResolveAttempted.add(inst.dir)
      await resolveAccount(inst.dir)
    }
  } finally {
    resolvingAccounts.value = false
  }
}

let pollTimer: number | null = null

function startPolling() {
  if (pollTimer !== null) return
  refreshInstances()
  // Background ticks are silent (no `loading` toggle) — see refreshInstances().
  pollTimer = window.setInterval(() => refreshInstances({ silent: true }), 4000)
}

function stopPolling() {
  if (pollTimer !== null) window.clearInterval(pollTimer)
  pollTimer = null
}

/** Launch (open) an instance. Returns the action result (or undefined on hard failure) so
 *  the caller can surface the server's failure message (e.g. the MSIX-only explanation). */
async function open(dir: string): Promise<api.CMActionResult | undefined> {
  setBusy(dir, true)
  try {
    const result = await guard(api.openInstance(dir))
    if (result?.ok) await refreshInstances()
    return result
  } finally {
    setBusy(dir, false)
  }
}

/** Quit a running instance. Returns true on success. */
async function quit(dir: string): Promise<boolean> {
  setBusy(dir, true)
  try {
    const result = await guard(api.quitInstance(dir))
    if (result?.ok) await refreshInstances()
    return result?.ok ?? false
  } finally {
    setBusy(dir, false)
  }
}

/** Bring a running instance's window to the foreground (Windows only). Returns the action
 *  result (or undefined on hard failure) so the caller can surface the server's failure
 *  message (e.g. "not running", "no window found"). No instance state changes, so this
 *  doesn't trigger a refresh. */
async function focus(dir: string): Promise<api.CMActionResult | undefined> {
  setBusy(dir, true)
  try {
    return await guard(api.focusInstance(dir))
  } finally {
    setBusy(dir, false)
  }
}

/** Reveal an instance's profile folder in the OS file browser. */
async function revealFolder(dir: string): Promise<api.CMActionResult | undefined> {
  return await guard(api.revealInstanceFolder(dir))
}

/** Create a desktop launcher that opens this instance directly. Returns the action result (or
 *  undefined on hard failure) so the caller can surface the server's message (e.g. the MSIX-only
 *  explanation, or the path it landed at). No instance state changes, so no refresh. */
async function createShortcut(dir: string): Promise<api.CMActionResult | undefined> {
  setBusy(dir, true)
  try {
    return await guard(api.createInstanceShortcut(dir))
  } finally {
    setBusy(dir, false)
  }
}

/** Create a new isolated instance. Returns the action result (or null on hard failure)
 *  so the caller can surface `needsBrowserDance`. */
async function create(name: string): Promise<api.CMActionResult | undefined> {
  const result = await guard(api.createInstance(name))
  if (result?.ok) await refreshInstances()
  return result
}

/** Delete an instance (guarded server-side; confirmName must match exactly). */
async function remove(dir: string, confirmName: string): Promise<api.CMActionResult | undefined> {
  setBusy(dir, true)
  try {
    const result = await guard(api.deleteInstance(dir, confirmName))
    if (result?.ok) await refreshInstances()
    return result
  } finally {
    setBusy(dir, false)
  }
}

/** Rename an instance (folder leaf = name). On success the dir changes, so a refresh re-keys
 *  the row; returns the action result so the caller can surface the server's failure message. */
async function rename(dir: string, newName: string): Promise<api.CMActionResult | undefined> {
  setBusy(dir, true)
  try {
    const result = await guard(api.renameInstance(dir, newName))
    if (result?.ok) await refreshInstances()
    return result
  } finally {
    setBusy(dir, false)
  }
}

/** Resolve (or re-resolve) the account identity for one instance and merge it in. */
async function resolveAccount(dir: string, noNetwork = false): Promise<boolean> {
  setBusy(dir, true)
  try {
    const account = await guard(api.getInstanceAccount(dir, { noNetwork }))
    if (account === undefined) return false
    const existing = instances.value.find((i) => i.dir === dir)
    if (existing) upsert({ ...existing, account })
    return true
  } finally {
    setBusy(dir, false)
  }
}

export function useInstances() {
  return {
    instances,
    loading,
    resolvingAccounts,
    busyDirs,
    lastError,
    refreshInstances,
    startPolling,
    stopPolling,
    open,
    quit,
    focus,
    revealFolder,
    createShortcut,
    create,
    remove,
    rename,
    resolveAccount,
  }
}
