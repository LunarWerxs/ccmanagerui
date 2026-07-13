import { ref } from 'vue'
import type { Account, QueueItem, SchedulerState, SessionSummary } from '@/lib/api'
import * as api from '@/lib/api'

const sessions = ref<SessionSummary[]>([])
const queue = ref<QueueItem[]>([])
const accounts = ref<Account[]>([])
const scheduler = ref<SchedulerState | null>(null)
const sessionsLoading = ref(false)
// Server-side instance scope for the sessions list ('' = all). Lives here so the
// polling refresh keeps honoring whatever the sidebar filter picked.
const sessionInstanceFilter = ref('')
// true once the first queue fetch has settled — gates the queue's first-load skeletons
const queueLoaded = ref(false)
const lastError = ref<string | null>(null)

function guard<T>(p: Promise<T>): Promise<T | undefined> {
  return p.catch((e) => {
    lastError.value = e instanceof Error ? e.message : String(e)
    return undefined
  })
}

async function refreshSessions() {
  sessionsLoading.value = true
  const r = await guard(api.getSessions(200, sessionInstanceFilter.value))
  if (r) sessions.value = r
  sessionsLoading.value = false
}
async function refreshQueue() {
  const r = await guard(api.getQueue())
  if (r) queue.value = r
  queueLoaded.value = true
}
async function refreshAccounts() {
  const r = await guard(api.getAccounts())
  if (r) accounts.value = r
}
async function refreshScheduler() {
  const r = await guard(api.getScheduler())
  if (r) scheduler.value = r
}

let fastTimer: number | null = null
let slowTimer: number | null = null

function startPolling() {
  if (fastTimer !== null) return
  refreshSessions()
  refreshQueue()
  refreshAccounts()
  refreshScheduler()
  // queue + scheduler are cheap and change often while runs are active
  fastTimer = window.setInterval(() => {
    refreshQueue()
    refreshScheduler()
  }, 2000)
  // sessions require disk scans — refresh more lazily
  slowTimer = window.setInterval(refreshSessions, 12000)
}

function stopPolling() {
  if (fastTimer !== null) window.clearInterval(fastTimer)
  if (slowTimer !== null) window.clearInterval(slowTimer)
  fastTimer = null
  slowTimer = null
}

export function useData() {
  return {
    sessions,
    queue,
    accounts,
    scheduler,
    sessionsLoading,
    sessionInstanceFilter,
    queueLoaded,
    lastError,
    refreshSessions,
    refreshQueue,
    refreshAccounts,
    refreshScheduler,
    startPolling,
    stopPolling,
  }
}
