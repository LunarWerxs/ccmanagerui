// CC Manager UI MCP server (stdio) — a thin client over the running daemon's REST API, so an
// MCP-speaking agent (Claude Desktop/Code, Cursor) shares one source of truth with the web UI.
// Start the daemon first (`bun run start` from repo root); point elsewhere with
// CCMANAGERUI_URL / CCMANAGERUI_PORT.
//
// The JSON-RPC 2.0 / MCP protocol + the stdio loop live in the SHARED, zero-dependency engine
// `./mcp-stdio.mjs` (part of the shared kit — edit it there, never here). This file is only the
// app-specific part: an HTTP client + a tool table, each tool a thin proxy over an existing
// /api/* route from index.ts.
import { PORT } from './config'
import { readInstanceInfo } from './instance'
import type { McpEngineTool } from './mcp-stdio.mjs'
import { runMcpStdio } from './mcp-stdio.mjs'

// Resolve the base URL per call: an explicit CCMANAGERUI_URL/CCMANAGERUI_PORT always wins, else
// follow the port the daemon ACTUALLY bound (~/.ccmanagerui/runtime.json), so an auto-hopped port
// still works, else fall back to the static configured default.
export function daemonBase(): string {
  if (process.env.CCMANAGERUI_URL) return process.env.CCMANAGERUI_URL
  if (process.env.CCMANAGERUI_PORT) return `http://127.0.0.1:${process.env.CCMANAGERUI_PORT}`
  return readInstanceInfo()?.url ?? `http://127.0.0.1:${PORT}`
}

async function api(pathname: string, init?: RequestInit): Promise<unknown> {
  let res: Response
  try {
    res = await fetch(`${daemonBase()}${pathname}`, init)
  } catch (e) {
    throw new Error(
      `couldn't reach the CC Manager UI daemon at ${daemonBase()} — start it with \`bun run start\`. (${e instanceof Error ? e.message : String(e)})`,
    )
  }
  if (!res.ok) throw new Error(`CC Manager UI ${res.status}: ${await res.text()}`)
  return res.json()
}

// JSON Schema helper (the engine advertises each tool's `inputSchema` verbatim in tools/list).
const S = (properties: Record<string, unknown> = {}, required: string[] = []) => ({
  type: 'object' as const,
  properties,
  required,
  additionalProperties: false,
})
const JSON_HEADERS = { 'content-type': 'application/json' }
const str = (v: unknown): string => String(v ?? '')
const qs = (params: Record<string, unknown>): string => {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v != null) p.set(k, String(v))
  const s = p.toString()
  return s ? `?${s}` : ''
}

export const TOOLS: McpEngineTool[] = [
  // --- sessions (read-only) ---------------------------------------------------
  {
    name: 'list_sessions',
    description: 'List Claude Code sessions discovered on disk, most recently active first.',
    inputSchema: S({
      limit: { type: 'number', description: 'Max sessions to return (default 200).' },
    }),
    run: (a) => api(`/api/sessions${qs({ limit: a.limit })}`),
  },
  {
    name: 'get_session',
    description: 'Get one session by id (full summary).',
    inputSchema: S({ id: { type: 'string' } }, ['id']),
    run: (a) => api(`/api/sessions/${encodeURIComponent(str(a.id))}`),
  },
  {
    name: 'tail_session',
    description:
      'Tail a session transcript: the most recent turns, optionally text-only (no tool_use/tool_result noise).',
    inputSchema: S(
      {
        id: { type: 'string' },
        limit: { type: 'number', description: 'Max turns to return (default 40).' },
        textOnly: { type: 'boolean', description: 'Drop tool_use/tool_result turns, text only.' },
      },
      ['id'],
    ),
    run: (a) =>
      api(
        `/api/sessions/${encodeURIComponent(str(a.id))}/tail${qs({ limit: a.limit, textOnly: a.textOnly ? '1' : undefined })}`,
      ),
  },

  // --- queue --------------------------------------------------------------------
  {
    name: 'list_queue',
    description:
      'List every queue item (queued/running/completed/failed/rate_limited/canceled), in run order.',
    inputSchema: S(),
    run: () => api('/api/queue'),
  },
  {
    name: 'add_queue_item',
    description:
      'MUTATES: add a new item to the run queue. title, cwd, and prompt are required; session_id is required when resuming an existing session (new_chat=false).',
    inputSchema: S(
      {
        title: { type: 'string' },
        cwd: { type: 'string', description: 'Absolute working directory for the run.' },
        prompt: { type: 'string' },
        session_id: {
          type: 'string',
          description: 'Required unless new_chat is true (a fresh id is generated then).',
        },
        model: { type: 'string' },
        effort: { type: 'string', enum: ['low', 'medium', 'high', 'xhigh', 'max'] },
        permission_mode: {
          type: 'string',
          enum: ['default', 'acceptEdits', 'bypassPermissions', 'plan'],
        },
        account_id: { type: 'string' },
        new_chat: {
          type: 'boolean',
          description: 'Start a brand-new session instead of resuming.',
        },
        fork: { type: 'boolean' },
      },
      ['title', 'cwd', 'prompt'],
    ),
    run: (a) =>
      api('/api/queue', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify(a),
      }),
  },
  {
    name: 'update_queue_item',
    description:
      'MUTATES: patch a queue item (title, cwd, prompt, model, effort, permission_mode, account_id, status, position, new_chat, fork).',
    inputSchema: S(
      {
        id: { type: 'string' },
        patch: {
          type: 'object',
          description: 'Fields to update; any subset of the queue item columns.',
        },
      },
      ['id', 'patch'],
    ),
    run: (a) =>
      api(`/api/queue/${encodeURIComponent(str(a.id))}`, {
        method: 'PATCH',
        headers: JSON_HEADERS,
        body: JSON.stringify(a.patch ?? {}),
      }),
  },
  {
    name: 'run_queue_item',
    description: 'MUTATES: start running a queued item now (fails if already running).',
    inputSchema: S({ id: { type: 'string' } }, ['id']),
    run: (a) => api(`/api/queue/${encodeURIComponent(str(a.id))}/run`, { method: 'POST' }),
  },
  {
    name: 'cancel_queue_item',
    description: 'MUTATES: cancel a running (or queued) item.',
    inputSchema: S({ id: { type: 'string' } }, ['id']),
    run: (a) => api(`/api/queue/${encodeURIComponent(str(a.id))}/cancel`, { method: 'POST' }),
  },
  {
    name: 'get_run_events',
    description:
      "Get a queue item's recorded run events (assistant/user/system turns for that run).",
    inputSchema: S({ id: { type: 'string' } }, ['id']),
    run: (a) => api(`/api/queue/${encodeURIComponent(str(a.id))}/events`),
  },

  // --- accounts -----------------------------------------------------------------
  {
    name: 'list_accounts',
    description:
      'List saved dispatch accounts (label, auth_type, created_at). Secrets are always masked, never returned in full.',
    inputSchema: S(),
    run: () => api('/api/accounts'),
  },

  // --- scheduler ------------------------------------------------------------------
  {
    name: 'get_scheduler',
    description:
      'Get the scheduler state: enabled, running/queued counts, spacing/poll seconds, max_concurrent.',
    inputSchema: S(),
    run: () => api('/api/scheduler'),
  },
  {
    name: 'set_scheduler',
    description:
      'MUTATES: update scheduler settings (any subset of enabled, spacing_seconds, poll_seconds, max_concurrent).',
    inputSchema: S({
      enabled: { type: 'boolean' },
      spacing_seconds: { type: 'number' },
      poll_seconds: { type: 'number' },
      max_concurrent: { type: 'number' },
    }),
    run: (a) =>
      api('/api/scheduler', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify(a),
      }),
  },

  // --- multi-instance (isolated Claude Desktop instances) ------------------------
  {
    name: 'list_instances',
    description:
      'List isolated Claude Desktop instances with their live status and resolved account.',
    inputSchema: S(),
    run: () => api('/api/instances'),
  },
  {
    name: 'launch_instance',
    description: 'MUTATES: open (launch) a Claude Desktop instance by its directory.',
    inputSchema: S({ dir: { type: 'string' } }, ['dir']),
    run: (a) => api(`/api/instances/${encodeURIComponent(str(a.dir))}/open`, { method: 'POST' }),
  },
  {
    name: 'quit_instance',
    description: 'MUTATES: quit a running Claude Desktop instance by its directory.',
    inputSchema: S({ dir: { type: 'string' } }, ['dir']),
    run: (a) => api(`/api/instances/${encodeURIComponent(str(a.dir))}/quit`, { method: 'POST' }),
  },

  // --- self-update ------------------------------------------------------------------
  {
    name: 'check_update',
    description: 'Check whether a CC Manager UI update is available (git-based).',
    inputSchema: S(),
    run: () => api('/api/update'),
  },
]

export const SERVER_INFO = { name: 'ccmanagerui', version: '0.1.0' }

// Only run the stdio loop when this file is the entry point (`bun run mcp`), not when a test
// imports TOOLS/daemonBase — Bun sets import.meta.main false for module imports.
if (import.meta.main) {
  await runMcpStdio({ serverInfo: SERVER_INFO, tools: TOOLS })
}
