/**
 * Model/effort values eventually appear inside a command string used to open a visible terminal.
 * Keep that narrow shell boundary value-blind: real model ids need letters, digits, and a small
 * separator set, never shell metacharacters, quotes, whitespace, or variable expansion.
 */
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,119}$/

export const CLAUDE_LAUNCH_EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max'])
export const CODEX_LAUNCH_EFFORTS = new Set([
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'ultra',
])

export interface LaunchOptionsInput {
  model?: unknown
  effort?: unknown
}

/** Returns a caller-facing validation error, or null when both optional values are safe. */
export function launchOptionError(
  options: LaunchOptionsInput,
  validEfforts: ReadonlySet<string>,
): string | null {
  if (options.model !== undefined) {
    if (typeof options.model !== 'string' || !MODEL_ID.test(options.model)) {
      return 'model must be a 1–120 character model id using only letters, digits, ., _, :, /, @, +, or -'
    }
  }
  if (options.effort !== undefined) {
    if (typeof options.effort !== 'string' || !validEfforts.has(options.effort)) {
      return `effort must be one of: ${[...validEfforts].join(', ')}`
    }
  }
  return null
}
