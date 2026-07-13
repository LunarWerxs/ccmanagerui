// Per-instance icon + color: the visual layer for the glyph that replaced the plain green
// status dot in the Instances table. The KEY SETS (which icons, which colors) are the single
// source of truth from the server package (server/src/core/shared.ts), which also validates
// them; this module owns only the presentation — key -> Lucide component, key -> oklch value —
// plus a deterministic default so an un-customized instance still gets a stable, distinct look.
import {
  Bot,
  Box,
  Boxes,
  Cat,
  Cpu,
  Flame,
  FlaskConical,
  Folder,
  Ghost,
  Globe,
  Heart,
  type LucideIcon,
  Rocket,
  Sparkles,
  Star,
  Terminal,
  Zap,
} from '@lucide/vue'
import {
  type CMInstance,
  INSTANCE_COLOR_KEYS,
  INSTANCE_ICON_KEYS,
  type InstanceColorKey,
  type InstanceIconKey,
} from '@/lib/api'

/** key -> Lucide component. Keys match INSTANCE_ICON_KEYS exactly (kept in lockstep). */
const ICON_COMPONENTS: Record<InstanceIconKey, LucideIcon> = {
  box: Box,
  boxes: Boxes,
  terminal: Terminal,
  rocket: Rocket,
  star: Star,
  heart: Heart,
  flame: Flame,
  zap: Zap,
  ghost: Ghost,
  cat: Cat,
  bot: Bot,
  cpu: Cpu,
  folder: Folder,
  globe: Globe,
  flask: FlaskConical,
  sparkles: Sparkles,
}

/** key -> fixed oklch color. Lightness/chroma picked to stay legible on both the light and the
 *  dark table/popover backgrounds (mid-L, saturated). Fixed values, NOT theme vars — an
 *  instance's chosen hue should look the same in either theme. */
const COLOR_VALUES: Record<InstanceColorKey, string> = {
  slate: 'oklch(0.60 0.03 255)',
  red: 'oklch(0.62 0.21 25)',
  orange: 'oklch(0.67 0.17 50)',
  amber: 'oklch(0.72 0.15 80)',
  green: 'oklch(0.62 0.16 150)',
  teal: 'oklch(0.66 0.11 195)',
  blue: 'oklch(0.60 0.17 250)',
  indigo: 'oklch(0.55 0.19 280)',
  violet: 'oklch(0.60 0.20 310)',
  pink: 'oklch(0.65 0.21 350)',
}

/** Stable non-negative hash of a string (FNV-1a-ish). Same dir -> same default forever. */
function hash(input: string): number {
  let h = 2166136261
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** Deterministic default icon/color for an instance that hasn't been customized, derived from
 *  its dir so it's stable across reloads and gives instant visual variety across instances. */
function defaultIconKey(dir: string): InstanceIconKey {
  return INSTANCE_ICON_KEYS[hash(dir) % INSTANCE_ICON_KEYS.length] as InstanceIconKey
}
function defaultColorKey(dir: string): InstanceColorKey {
  // A second, differently-seeded index so icon and color don't move in lockstep.
  return INSTANCE_COLOR_KEYS[hash(`${dir}#color`) % INSTANCE_COLOR_KEYS.length] as InstanceColorKey
}

/** The effective icon key: the user's choice, else the deterministic default. */
export function resolveIconKey(inst: Pick<CMInstance, 'dir' | 'icon'>): InstanceIconKey {
  return inst.icon ?? defaultIconKey(inst.dir)
}

/** The effective color key: the user's choice, else the deterministic default. */
export function resolveColorKey(inst: Pick<CMInstance, 'dir' | 'color'>): InstanceColorKey {
  return inst.color ?? defaultColorKey(inst.dir)
}

export function iconComponent(key: InstanceIconKey): LucideIcon {
  return ICON_COMPONENTS[key]
}

export function colorValue(key: InstanceColorKey): string {
  return COLOR_VALUES[key]
}

/** The name to show for an instance: the user's display label, else the folder name. */
export function displayName(inst: Pick<CMInstance, 'name' | 'label'>): string {
  return inst.label?.trim() || inst.name
}

export type { InstanceColorKey, InstanceIconKey }
export { INSTANCE_COLOR_KEYS, INSTANCE_ICON_KEYS }
