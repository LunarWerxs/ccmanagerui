// server/src/core/instance-meta.ts — per-instance UI metadata (display label + icon + color).
//
// This is PURE PRESENTATION state, distinct from both the sqlite `accounts` table and the
// instance-identity cache (instances-cache.json). It never holds a secret. Because it lives in
// its own file (instance-meta.json under appDataDir()) — NOT inside the instance's profile
// folder — it can be written while the instance is running (the folder itself is held open by
// Claude Desktop and can't be touched live; the display label sidesteps that entirely).
//
// Keyed by normalized instance dir, mirroring the account cache's shape + atomic-write pattern.
// Nothing here throws for expected failures (missing/corrupt file, unwritable dir) — reads fall
// back to empty and writes return the merged value best-effort.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { appDataDir, instanceMetaFile, normalizeInstancePath } from './paths'
import type { InstanceColorKey, InstanceIconKey } from './shared'
import { INSTANCE_COLOR_KEYS, INSTANCE_ICON_KEYS, INSTANCE_LABEL_MAX } from './shared'

/** One instance's presentation overrides. Every field null-means-"use the default" (the folder
 *  name for `label`, a deterministic glyph/color derived from the dir for `icon`/`color`). */
export interface InstanceMeta {
  label: string | null
  icon: InstanceIconKey | null
  color: InstanceColorKey | null
}

/** A patch may omit a field (leave it unchanged) OR set it to null (clear it to the default). */
export type InstanceMetaPatch = Partial<InstanceMeta>

type InstanceMetaFileShape = Record<string, InstanceMeta>

const ICON_SET = new Set<string>(INSTANCE_ICON_KEYS)
const COLOR_SET = new Set<string>(INSTANCE_COLOR_KEYS)

const EMPTY: InstanceMeta = { label: null, icon: null, color: null }

/** Coerce any stored/incoming value into a safe InstanceMeta (drops unknown icon/color keys,
 *  trims + caps the label). Unknown or malformed input degrades to the null default, never
 *  throws. */
function sanitize(raw: unknown): InstanceMeta {
  if (!raw || typeof raw !== 'object') return { ...EMPTY }
  const r = raw as Record<string, unknown>

  let label: string | null = null
  if (typeof r.label === 'string') {
    // Spread iterates by code point, so the cap never splits an astral-plane char (emoji)
    // into a lone surrogate the way a raw .slice() would.
    const trimmed = [...r.label.trim()].slice(0, INSTANCE_LABEL_MAX).join('')
    label = trimmed.length > 0 ? trimmed : null
  }

  const icon =
    typeof r.icon === 'string' && ICON_SET.has(r.icon) ? (r.icon as InstanceIconKey) : null
  const color =
    typeof r.color === 'string' && COLOR_SET.has(r.color) ? (r.color as InstanceColorKey) : null

  return { label, icon, color }
}

/** True once every field is the null default — such entries are pruned rather than persisted. */
function isEmpty(meta: InstanceMeta): boolean {
  return meta.label === null && meta.icon === null && meta.color === null
}

function readFile(): InstanceMetaFileShape {
  try {
    const file = instanceMetaFile()
    if (!existsSync(file)) return {}
    const raw = readFileSync(file, 'utf8')
    if (!raw?.trim()) return {}
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return {}
    const out: InstanceMetaFileShape = {}
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      const meta = sanitize(value)
      if (!isEmpty(meta)) out[normalizeInstancePath(key)] = meta
    }
    return out
  } catch {
    return {}
  }
}

/** The whole map, keyed by normalized dir. Used by listInstances() to attach meta in one read. */
export function readInstanceMetaMap(): InstanceMetaFileShape {
  return readFile()
}

/** One instance's meta (defaults when absent). Never throws. */
export function getInstanceMeta(dir: string): InstanceMeta {
  try {
    return readFile()[normalizeInstancePath(dir)] ?? { ...EMPTY }
  } catch {
    return { ...EMPTY }
  }
}

/**
 * Merge `patch` into an instance's meta and persist it atomically (temp file + rename, same as
 * the account cache). An omitted patch field is left unchanged; a field set to null is cleared
 * to its default. Returns the resulting (sanitized) meta. Best-effort — on a write failure the
 * in-memory merged value is still returned so the caller/UI stays consistent.
 */
export function setInstanceMeta(dir: string, patch: InstanceMetaPatch): InstanceMeta {
  const key = normalizeInstancePath(dir)
  const map = readFile()
  const current = map[key] ?? { ...EMPTY }

  const merged = sanitize({
    label: patch.label !== undefined ? patch.label : current.label,
    icon: patch.icon !== undefined ? patch.icon : current.icon,
    color: patch.color !== undefined ? patch.color : current.color,
  })

  if (isEmpty(merged)) delete map[key]
  else map[key] = merged

  try {
    const targetDir = appDataDir()
    if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true })
    const file = instanceMetaFile()
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
    writeFileSync(tmp, JSON.stringify(map, null, 2))
    renameSync(tmp, file)
  } catch {
    // Best-effort: the merged value is still returned so the response reflects the intent.
  }

  return merged
}

/** Drop an instance's meta entry (called after a guarded delete so the file doesn't accrete
 *  orphans). Best-effort, never throws. */
export function deleteInstanceMeta(dir: string): void {
  const key = normalizeInstancePath(dir)
  const map = readFile()
  if (!(key in map)) return
  delete map[key]
  try {
    const file = instanceMetaFile()
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
    writeFileSync(tmp, JSON.stringify(map, null, 2))
    renameSync(tmp, file)
  } catch {
    // Orphan entry is harmless; ignore.
  }
}
