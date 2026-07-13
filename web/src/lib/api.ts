import type {
  Account,
  AuthType,
  CMAccount,
  CMActionResult,
  CMDesktopInstall,
  CMInstance,
  EffortLevel,
  InstanceColorKey,
  InstanceIconKey,
  PermissionMode,
  PortableModeSettings,
  PortableWindowResult,
  QueueItem,
  RunEvent,
  SchedulerState,
  SessionSearchResult,
  SessionSummary,
  SyncStatus,
  TailResult,
  UpdateApplyResult,
  UpdateStatus,
} from '@ccmanagerui/server/types'

export type {
  Account,
  AuthType,
  CMAccount,
  CMAccountStatus,
  CMActionResult,
  CMDesktopInstall,
  CMInstance,
  EffortLevel,
  InstanceColorKey,
  InstanceIconKey,
  PermissionMode,
  PortableModeSettings,
  PortableWindowResult,
  QueueItem,
  QueueStatus,
  RunEvent,
  SchedulerState,
  SessionSearchResult,
  SessionSummary,
  SyncStatus,
  TailEvent,
  TailResult,
  UpdateApplyResult,
  UpdateStatus,
} from '@ccmanagerui/server/types'
// Value re-export: the curated icon/color key sets that drive the instance appearance pickers
// (single source of truth, also validated server-side). See lib/instance-appearance.ts.
export {
  INSTANCE_COLOR_KEYS,
  INSTANCE_ICON_KEYS,
  INSTANCE_LABEL_MAX,
} from '@ccmanagerui/server/types'

// Prod bundles are served by the daemon itself, so same-origin relative URLs follow the
// daemon to whatever port it actually bound (the port-hop). Dev (Vite on :5173) still needs
// the absolute API origin; VITE_API_BASE overrides both.
export const API_BASE =
  import.meta.env.VITE_API_BASE ?? (import.meta.env.PROD ? '' : 'http://localhost:7787')

async function j<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(API_BASE + path, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  })
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`
    try {
      const body = await res.json()
      if (body?.error) msg = body.error
    } catch {
      /* ignore */
    }
    throw new Error(msg)
  }
  return res.json() as Promise<T>
}

// --- sessions ---------------------------------------------------------------
export const getSessions = (limit = 200, instance = '') =>
  j<SessionSummary[]>(
    `/api/sessions?limit=${limit}${instance ? `&instance=${encodeURIComponent(instance)}` : ''}`,
  )
/** Browser download URL for the raw transcript (save-as copy). API_BASE prefix: this
 *  URL lands in a plain <a href>, which unlike j() would otherwise resolve against the
 *  Vite dev origin instead of the daemon. */
export const sessionFileUrl = (id: string) =>
  `${API_BASE}/api/sessions/${encodeURIComponent(id)}/file`
/** Open the transcript on the daemon's machine with the OS default handler. */
export const openSessionFile = (id: string) =>
  j<{ ok: boolean }>(`/api/sessions/${encodeURIComponent(id)}/open-file`, { method: 'POST' })
export const getTail = (id: string, opts: { limit?: number; textOnly?: boolean } = {}) =>
  j<TailResult>(
    `/api/sessions/${id}/tail?limit=${opts.limit ?? 40}&textOnly=${opts.textOnly ? '1' : '0'}`,
  )
/** Advanced BODY search: streams every transcript's raw content server-side (substring or
 *  regex, optionally case-sensitive). Deliberately separate from getSessions() above (slower,
 *  opt-in, and never used by the default fast client-side filter). */
export const searchSessionBodies = (
  query: string,
  opts: { regex?: boolean; caseSensitive?: boolean; instance?: string } = {},
) =>
  j<SessionSearchResult[]>(
    `/api/sessions/search?q=${encodeURIComponent(query)}` +
      `${opts.regex ? '&regex=1' : ''}` +
      `${opts.caseSensitive ? '&case=1' : ''}` +
      `${opts.instance ? `&instance=${encodeURIComponent(opts.instance)}` : ''}`,
  )

// --- accounts ---------------------------------------------------------------
export const getAccounts = () => j<Account[]>('/api/accounts')
export const createAccount = (b: { label: string; auth_type: AuthType; secret: string }) =>
  j<Account>('/api/accounts', { method: 'POST', body: JSON.stringify(b) })
export const deleteAccount = (id: string) =>
  j<{ ok: boolean }>(`/api/accounts/${id}`, { method: 'DELETE' })

// --- queue ------------------------------------------------------------------
export interface NewQueueItem {
  session_id?: string
  title: string
  cwd: string
  prompt: string
  model?: string | null
  effort?: EffortLevel | null
  permission_mode?: PermissionMode | null
  account_id?: string | null
  new_chat: boolean
  fork: boolean
  /** ISO timestamp; the scheduler won't auto-dispatch before this. */
  not_before?: string | null
}
export const getQueue = () => j<QueueItem[]>('/api/queue')
export const createQueueItem = (b: NewQueueItem) =>
  j<QueueItem>('/api/queue', { method: 'POST', body: JSON.stringify(b) })
export const updateQueueItem = (id: string, patch: Partial<QueueItem>) =>
  j<QueueItem>(`/api/queue/${id}`, { method: 'PATCH', body: JSON.stringify(patch) })
export const deleteQueueItem = (id: string) =>
  j<{ ok: boolean }>(`/api/queue/${id}`, { method: 'DELETE' })
export const runQueueItem = (id: string) =>
  j<{ ok: boolean }>(`/api/queue/${id}/run`, { method: 'POST' })
/** Dispatch every due queued item now (ignores scheduler limits, honors the session lock). */
export const runDueQueueItems = () =>
  j<{ ok: boolean; started: number; skipped: number }>('/api/queue/run-due', { method: 'POST' })
export const cancelQueueItem = (id: string) =>
  j<{ ok: boolean }>(`/api/queue/${id}/cancel`, { method: 'POST' })
export const getRunEvents = (id: string) => j<RunEvent[]>(`/api/queue/${id}/events`)
export const streamUrl = (id: string) => `${API_BASE}/api/queue/${id}/stream`

// --- scheduler --------------------------------------------------------------
export const getScheduler = () => j<SchedulerState>('/api/scheduler')
export const updateScheduler = (b: Partial<SchedulerState>) =>
  j<SchedulerState>('/api/scheduler', { method: 'POST', body: JSON.stringify(b) })

// --- instances ----------------------------------------------------------------
// "instance account" = which Anthropic account a Claude Desktop *instance* is logged into
// (distinct from the sqlite `accounts` table above, which holds auth secrets for queue
// dispatch). See server/src/core/shared.ts for the DTO shapes.
export const listInstances = () => j<CMInstance[]>('/api/instances')
export const getInstanceAccount = (dir: string, opts: { noNetwork?: boolean } = {}) =>
  j<CMAccount>(
    `/api/instances/${encodeURIComponent(dir)}/account${opts.noNetwork ? '?noNetwork=1' : ''}`,
  )
export const openInstance = (dir: string) =>
  j<CMActionResult>(`/api/instances/${encodeURIComponent(dir)}/open`, { method: 'POST' })
export const quitInstance = (dir: string) =>
  j<CMActionResult>(`/api/instances/${encodeURIComponent(dir)}/quit`, { method: 'POST' })
export const focusInstance = (dir: string) =>
  j<CMActionResult>(`/api/instances/${encodeURIComponent(dir)}/focus`, { method: 'POST' })
export const revealInstanceFolder = (dir: string) =>
  j<CMActionResult>(`/api/instances/${encodeURIComponent(dir)}/reveal`, { method: 'POST' })
/** Create a desktop launcher (.lnk on Windows) that opens this instance directly. The result's
 *  `data.path` holds where it landed; a failure carries the MSIX-aware message (same as open). */
export const createInstanceShortcut = (dir: string) =>
  j<CMActionResult>(`/api/instances/${encodeURIComponent(dir)}/shortcut`, { method: 'POST' })
export const deleteInstance = (dir: string, confirmName: string) =>
  j<CMActionResult>(`/api/instances/${encodeURIComponent(dir)}`, {
    method: 'DELETE',
    body: JSON.stringify({ confirmName }),
  })
/** Update an instance's UI metadata: display label (a pure relabel — never touches the folder,
 *  so it works while the instance runs), icon glyph, and icon color. A field present in the
 *  patch is applied (null clears it to the default); an omitted field is left unchanged. The
 *  result's `data` echoes the sanitized `{ label, icon, color }`. */
export const setInstanceMeta = (
  dir: string,
  patch: {
    label?: string | null
    icon?: InstanceIconKey | null
    color?: InstanceColorKey | null
  },
) =>
  j<CMActionResult>(`/api/instances/${encodeURIComponent(dir)}/meta`, {
    method: 'POST',
    body: JSON.stringify(patch),
  })
export const createInstance = (name: string) =>
  j<CMActionResult>('/api/instances', { method: 'POST', body: JSON.stringify({ name }) })
export const getDesktopInstall = (opts: { fresh?: boolean } = {}) =>
  j<CMDesktopInstall>(`/api/desktop-install${opts.fresh ? '?fresh=1' : ''}`)

/** Always-latest classic (Squirrel .exe) Claude Desktop installer — the only Windows build
 *  the Instances tab can launch. ~217 MB full installer; the claude.ai download page instead
 *  serves a ~7 MB ClaudeSetup.exe bootstrapper that installs the unmanageable MSIX build. */
export const CLASSIC_DESKTOP_INSTALLER_URL =
  'https://claude.ai/api/desktop/win32/x64/exe/latest/redirect'
/** Official download page (serves the MSIX bootstrapper for Windows — link kept for reference). */
export const DESKTOP_DOWNLOAD_PAGE_URL = 'https://claude.com/download'

// --- self-update --------------------------------------------------------------
export const checkUpdate = () => j<UpdateStatus>('/api/update')
export const applyUpdate = () => j<UpdateApplyResult>('/api/update/apply', { method: 'POST' })

export interface AutoUpdateSettings {
  enabled: boolean
  intervalSecs: number
}
export const getAutoUpdateSettings = () => j<AutoUpdateSettings>('/api/update/settings')
export const updateAutoUpdateSettings = (b: Partial<AutoUpdateSettings>) =>
  j<AutoUpdateSettings>('/api/update/settings', { method: 'POST', body: JSON.stringify(b) })

// --- app settings (portable mode, hide tray icon) ------------------------------------------------
export const getSettings = () => j<PortableModeSettings>('/api/settings')
export const updateSettings = (b: Partial<PortableModeSettings>) =>
  j<PortableModeSettings>('/api/settings', { method: 'POST', body: JSON.stringify(b) })
export const openPortableWindow = () =>
  j<PortableWindowResult>('/api/portable-window', { method: 'POST' })

// --- "Sync my settings with Connections" (see server/src/connections.ts) -----------------------
/** A handled sync failure — returned at HTTP 200 so it's non-blocking. */
export interface SyncErrorResult {
  ok: false
  error: string
}
export type SyncResult = SyncStatus | SyncErrorResult

/** Read the current sync status (enabled/connected/email/appearance/etc). */
export const getSyncStatus = () => j<SyncStatus>('/api/settings/sync')
/**
 * Turn sync on/off, disconnect, or push an updated appearance blob.
 * `{ enabled: true, appearance }` seeds/pulls; `{ enabled: false }` turns off (keeps the
 * connection); `{ enabled: false, forget: true }` disconnects fully.
 */
export const setSync = (b: {
  enabled?: boolean
  forget?: boolean
  appearance?: Record<string, unknown>
}) => j<SyncResult>('/api/settings/sync', { method: 'PUT', body: JSON.stringify(b) })
/** Force a pull of the remote synced settings now. */
export const syncPull = () => j<SyncResult>('/api/settings/sync/pull', { method: 'POST' })
/** Force a push of the current local settings now. */
export const syncPush = () => j<SyncResult>('/api/settings/sync/push', { method: 'POST' })
