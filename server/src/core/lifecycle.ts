// server/src/core/lifecycle.ts — instance create + guarded delete (PLAN.md §2).
// Adapted verbatim (behavior) from an internal LunarWerx tool's instance lifecycle module;
// only the import paths were adapted (./shared instead of ../../../shared/index.ts, no .ts
// extensions to match this repo's convention).
//
// Depends on:
//   core/paths.ts     — instancesRoot(), defaultClaudeDir(), normalizePath()
//   core/instances.ts — openInstance(dir)
//   core/process.ts   — listClaudeProcesses()
//   core/shared.ts     — CMActionResult DTO
//
// Never throws for expected failure conditions (invalid name, collision, guard refusal,
// locked file, permission error) — every public function returns a status-carrying
// CMActionResult instead.

import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { basename } from 'node:path'
import { openInstance } from './instances'
import { defaultClaudeDir, instancesRoot, normalizePath } from './paths'
import { listClaudeProcesses } from './process'
import type { CMActionResult } from './shared'

// ----------------------------------------------------------------------------
// Name sanitization
// ----------------------------------------------------------------------------

const RESERVED_WINDOWS_NAMES = new Set([
  'CON',
  'PRN',
  'AUX',
  'NUL',
  'COM1',
  'COM2',
  'COM3',
  'COM4',
  'COM5',
  'COM6',
  'COM7',
  'COM8',
  'COM9',
  'LPT1',
  'LPT2',
  'LPT3',
  'LPT4',
  'LPT5',
  'LPT6',
  'LPT7',
  'LPT8',
  'LPT9',
])

interface NameValidation {
  valid: boolean
  reason: string
  sanitized: string
}

/**
 * Validates a proposed instance name: not empty, no path separators, no ".."
 * traversal, no reserved Windows device name, and restricted to a safe charset
 * (letters/digits/dash/underscore/space) so it's a portable folder-leaf name on
 * every OS this app targets.
 */
function validateInstanceName(name: string): NameValidation {
  if (!name || name.trim().length === 0) {
    return { valid: false, reason: 'Name cannot be empty.', sanitized: '' }
  }

  const trimmed = name.trim()

  if (/[\\/]/.test(trimmed)) {
    return {
      valid: false,
      reason: 'Name cannot contain path separators (\\ or /).',
      sanitized: trimmed,
    }
  }

  if (trimmed === '.' || trimmed === '..' || trimmed.includes('..')) {
    return {
      valid: false,
      reason: 'Name cannot contain ".." or be "." / "..".',
      sanitized: trimmed,
    }
  }

  if (!/^[A-Za-z0-9_\- ]+$/.test(trimmed)) {
    return {
      valid: false,
      reason: 'Name may only contain letters, digits, dash, underscore, and space.',
      sanitized: trimmed,
    }
  }

  const bareUpper = (trimmed.split('.')[0] ?? trimmed).toUpperCase()
  if (RESERVED_WINDOWS_NAMES.has(bareUpper)) {
    return {
      valid: false,
      reason: `Name '${trimmed}' is a reserved Windows device name.`,
      sanitized: trimmed,
    }
  }

  return { valid: true, reason: '', sanitized: trimmed }
}

// ----------------------------------------------------------------------------
// Size helper (shared shape with instances.ts; kept local + tiny to avoid a
// cross-file private-function import)
// ----------------------------------------------------------------------------

/** Best-effort recursive byte size of a directory. Returns 0 on any failure. */
function dirSizeBytes(dir: string): number {
  let total = 0
  try {
    if (!existsSync(dir)) return 0
    const stack: string[] = [dir]
    while (stack.length) {
      const current = stack.pop()
      if (current === undefined) continue
      let entries: string[]
      try {
        entries = readdirSync(current)
      } catch {
        continue
      }
      for (const name of entries) {
        const full = `${current}/${name}`
        try {
          const st = statSync(full)
          if (st.isDirectory()) stack.push(full)
          else if (st.isFile()) total += st.size
        } catch {
          // Skip individual unreadable entries — best-effort only.
        }
      }
    }
  } catch {
    return total
  }
  return total
}

// ----------------------------------------------------------------------------
// Create
// ----------------------------------------------------------------------------

export interface CreateInstanceOptions {
  /** Launch the instance immediately after creating its directory. */
  launch?: boolean
}

/**
 * Creates a new isolated Claude instance data directory under `instancesRoot()`.
 * Sanitizes the name, refuses collisions, and optionally launches it afterward.
 * Always flags `needsBrowserDance: true` in the result data — the UI hint that
 * other instances should be quit before first login ("Browser Dance").
 */
export async function createInstance(
  name: string,
  options: CreateInstanceOptions = {},
): Promise<CMActionResult> {
  const validation = validateInstanceName(name)
  if (!validation.valid) {
    return {
      ok: false,
      action: 'create',
      dir: null,
      message: `Invalid instance name: ${validation.reason}`,
      data: { name },
    }
  }

  const sanitizedName = validation.sanitized
  const root = instancesRoot()

  try {
    if (!existsSync(root)) {
      mkdirSync(root, { recursive: true })
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      ok: false,
      action: 'create',
      dir: null,
      message: `Could not create or access instances root '${root}': ${message}`,
      data: { name: sanitizedName },
    }
  }

  const newDir = normalizePath(`${root}/${sanitizedName}`)

  if (existsSync(newDir)) {
    return {
      ok: false,
      action: 'create',
      dir: newDir,
      message: `An instance named '${sanitizedName}' already exists at '${newDir}'.`,
      data: { name: sanitizedName },
    }
  }

  try {
    mkdirSync(newDir, { recursive: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      ok: false,
      action: 'create',
      dir: newDir,
      message: `Failed to create instance directory '${newDir}': ${message}`,
      data: { name: sanitizedName },
    }
  }

  let launched = false
  if (options.launch) {
    try {
      const openResult = await openInstance(newDir)
      launched = Boolean(openResult.ok)
    } catch {
      launched = false
    }
  }

  return {
    ok: true,
    action: 'create',
    dir: newDir,
    message: `Instance '${sanitizedName}' created.`,
    data: {
      dir: newDir,
      name: sanitizedName,
      launched,
    },
    needsBrowserDance: true,
  }
}

// ----------------------------------------------------------------------------
// Remove (guarded delete)
// ----------------------------------------------------------------------------

export interface RemoveInstanceOptions {
  /** Must equal the folder leaf name of `dir`, or the call is refused. */
  confirmName?: string
}

/**
 * Guarded delete of an instance data directory. Refuses when:
 *   - `dir` is empty or does not exist
 *   - `dir` resolves to the default Claude profile dir (never deletable)
 *   - `dir` is not under `instancesRoot()`
 *   - `confirmName` does not exactly match the folder leaf name
 *   - the instance is currently running
 * On success, recursively removes the directory and returns the best-effort
 * byte count freed.
 */
export async function removeInstance(
  dir: string,
  options: RemoveInstanceOptions = {},
): Promise<CMActionResult> {
  if (!dir || dir.trim().length === 0) {
    return {
      ok: false,
      action: 'remove',
      dir: dir || null,
      message: 'Instance directory cannot be empty.',
      data: {},
    }
  }

  const normDir = normalizePath(dir)

  if (!existsSync(normDir)) {
    return {
      ok: false,
      action: 'remove',
      dir: normDir,
      message: `Instance directory does not exist: '${normDir}'.`,
      data: {},
    }
  }

  // --- Guard 1: default Claude data dir is never deletable. ---
  let defaultDir: string
  try {
    defaultDir = normalizePath(defaultClaudeDir())
  } catch {
    defaultDir = ''
  }
  if (defaultDir && normDir.toLowerCase() === defaultDir.toLowerCase()) {
    return {
      ok: false,
      action: 'remove',
      dir: normDir,
      message: `Refusing to delete the default Claude data directory '${normDir}'. This is protected.`,
      data: {},
    }
  }

  // --- Guard 2: must be under instancesRoot(). ---
  const root = normalizePath(instancesRoot())
  const normDirLower = normDir.toLowerCase()
  const rootLower = root.toLowerCase()
  const isUnderRoot =
    normDirLower.startsWith(`${rootLower}/`) || normDirLower.startsWith(`${rootLower}\\`)
  if (!isUnderRoot) {
    return {
      ok: false,
      action: 'remove',
      dir: normDir,
      message: `Refusing to delete '${normDir}': it is not under the instances root '${root}'.`,
      data: {},
    }
  }

  // --- Guard 3: must not be currently running. ---
  try {
    const procs = await listClaudeProcesses()
    const running = procs.find((p) => p.dir && normalizePath(p.dir) === normDir)
    if (running) {
      return {
        ok: false,
        action: 'remove',
        dir: normDir,
        message: `Refusing to delete '${normDir}': instance is currently running (PID ${running.pid}). Quit it first.`,
        data: {},
      }
    }
  } catch (err) {
    // If we can't verify running state, fail closed rather than risk deleting a live instance.
    const message = err instanceof Error ? err.message : String(err)
    return {
      ok: false,
      action: 'remove',
      dir: normDir,
      message: `Could not verify running state for '${normDir}' (${message}). Refusing delete to be safe.`,
      data: {},
    }
  }

  // --- Guard 4: confirmName must equal the folder leaf name. ---
  const leafName = basename(normDir)
  if (!options.confirmName || options.confirmName !== leafName) {
    return {
      ok: false,
      action: 'remove',
      dir: normDir,
      message: `Refusing to delete '${normDir}': confirmName must exactly match the folder name '${leafName}'.`,
      data: {},
    }
  }

  // --- All guards passed: compute freed bytes (best-effort), then delete. ---
  const freedBytes = dirSizeBytes(normDir)

  try {
    rmSync(normDir, { recursive: true, force: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      ok: false,
      action: 'remove',
      dir: normDir,
      message: `Failed to delete '${normDir}': ${message}`,
      data: { freedBytes: 0 },
    }
  }

  return {
    ok: true,
    action: 'remove',
    dir: normDir,
    message: `Instance '${leafName}' deleted.`,
    data: { freedBytes },
  }
}

// ----------------------------------------------------------------------------
// Rename (guarded folder rename)
// ----------------------------------------------------------------------------

/**
 * Guarded rename of an instance data directory (its folder leaf name IS the instance name).
 * Refuses, with the same posture as removeInstance, when:
 *   - `dir` is empty or does not exist
 *   - `newName` fails name validation (charset, reserved device name, traversal)
 *   - `dir` resolves to the default Claude profile dir (protected)
 *   - `dir` is not under `instancesRoot()`
 *   - the instance is currently running (its profile files are locked while Claude holds them)
 *   - the target name already belongs to a different instance
 *
 * On success, renames the directory and returns the NEW normalized dir (the caller re-keys the
 * row on it). Mirrors createInstance's on-disk convention: the new folder is created via
 * `normalizePath()`, so instance folder names are lowercased just like a freshly created one.
 */
export async function renameInstance(dir: string, newName: string): Promise<CMActionResult> {
  if (!dir || dir.trim().length === 0) {
    return {
      ok: false,
      action: 'rename',
      dir: dir || null,
      message: 'Instance directory cannot be empty.',
      data: {},
    }
  }

  const validation = validateInstanceName(newName)
  if (!validation.valid) {
    return {
      ok: false,
      action: 'rename',
      dir: normalizePath(dir),
      message: `Invalid instance name: ${validation.reason}`,
      data: {},
    }
  }
  const sanitizedName = validation.sanitized
  const normDir = normalizePath(dir)

  if (!existsSync(normDir)) {
    return {
      ok: false,
      action: 'rename',
      dir: normDir,
      message: `Instance directory does not exist: '${normDir}'.`,
      data: {},
    }
  }

  // --- Guard 1: default Claude data dir is never renamable. ---
  let defaultDir: string
  try {
    defaultDir = normalizePath(defaultClaudeDir())
  } catch {
    defaultDir = ''
  }
  if (defaultDir && normDir === defaultDir) {
    return {
      ok: false,
      action: 'rename',
      dir: normDir,
      message: `Refusing to rename the default Claude data directory '${normDir}'. This is protected.`,
      data: {},
    }
  }

  // --- Guard 2: must be under instancesRoot(). ---
  const root = normalizePath(instancesRoot())
  const isUnderRoot = normDir.startsWith(`${root}/`) || normDir.startsWith(`${root}\\`)
  if (!isUnderRoot) {
    return {
      ok: false,
      action: 'rename',
      dir: normDir,
      message: `Refusing to rename '${normDir}': it is not under the instances root '${root}'.`,
      data: {},
    }
  }

  // --- Guard 3: must not be currently running. ---
  try {
    const procs = await listClaudeProcesses()
    const running = procs.find((p) => p.dir && normalizePath(p.dir) === normDir)
    if (running) {
      return {
        ok: false,
        action: 'rename',
        dir: normDir,
        message: `Refusing to rename '${normDir}': instance is currently running (PID ${running.pid}). Quit it first.`,
        data: {},
      }
    }
  } catch (err) {
    // If we can't verify running state, fail closed rather than risk renaming a live profile.
    const message = err instanceof Error ? err.message : String(err)
    return {
      ok: false,
      action: 'rename',
      dir: normDir,
      message: `Could not verify running state for '${normDir}' (${message}). Refusing rename to be safe.`,
      data: {},
    }
  }

  const newDir = normalizePath(`${root}/${sanitizedName}`)

  // No-op: the (case-insensitively normalized) target is the same folder. Instance names are
  // stored lowercased, so a pure case-change resolves here and needs no disk operation.
  if (newDir === normDir) {
    return {
      ok: true,
      action: 'rename',
      dir: normDir,
      message: `Instance is already named '${sanitizedName}'.`,
      data: { dir: normDir, name: sanitizedName },
    }
  }

  // --- Guard 4: the target name must be free (belongs to no other instance). ---
  if (existsSync(newDir)) {
    return {
      ok: false,
      action: 'rename',
      dir: normDir,
      message: `An instance named '${sanitizedName}' already exists at '${newDir}'.`,
      data: {},
    }
  }

  try {
    renameSync(normDir, newDir)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      ok: false,
      action: 'rename',
      dir: normDir,
      message: `Failed to rename '${normDir}' to '${newDir}': ${message}`,
      data: {},
    }
  }

  return {
    ok: true,
    action: 'rename',
    dir: newDir,
    message: `Instance renamed to '${sanitizedName}'.`,
    data: { dir: newDir, previousDir: normDir, name: sanitizedName },
  }
}
