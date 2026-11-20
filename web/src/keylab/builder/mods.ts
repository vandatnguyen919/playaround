import type { Mod } from '../api/parts.ts'

// The Mods workshop's state and what it asks BLD-10 for (US-05). Pure, so it
// is tested on its own (mods.test.ts).
//
// A mix holds one level index per mod slug: 0 is off (a level mod's first
// level), 1 is on for a toggle mod or the first "on" level, and so on. Mods
// left out are off.

export type ModLevels = Record<string, number>

/** "none" -> "None". */
export function levelLabel(level: string): string {
  return level.charAt(0).toUpperCase() + level.slice(1)
}

export function isOn(levels: ModLevels, slug: string): boolean {
  return (levels[slug] ?? 0) > 0
}

/** The `mod` values of BLD-10 for a mix: `slug` or `slug:level`, off mods left out, sorted. */
export function modParams(mods: Mod[], levels: ModLevels): string[] {
  const values: string[] = []
  for (const mod of mods) {
    const level = levels[mod.slug] ?? 0
    if (level <= 0) {
      continue
    }
    if (mod.levels && mod.levels.length > 0) {
      const name = mod.levels[Math.min(level, mod.levels.length - 1)]
      values.push(`${mod.slug}:${name}`)
    } else {
      values.push(mod.slug)
    }
  }
  return values.sort()
}

export function withLevel(levels: ModLevels, slug: string, level: number): ModLevels {
  const next = { ...levels }
  if (level <= 0) {
    delete next[slug]
  } else {
    next[slug] = level
  }
  return next
}

/**
 * Before and After of one mod's card: the current mix with that mod off, and
 * with it on (at its current level, or the first "on" level when off).
 */
export function beforeAfter(levels: ModLevels, mod: Mod): { before: ModLevels; after: ModLevels } {
  return {
    before: withLevel(levels, mod.slug, 0),
    after: withLevel(levels, mod.slug, Math.max(1, levels[mod.slug] ?? 0)),
  }
}

/** Mods that are on, in the builder's order. */
export function applied(mods: Mod[], levels: ModLevels): Mod[] {
  return mods.filter((m) => isOn(levels, m.slug))
}

/** "3 of 6 mods applied". */
export function countLabel(mods: Mod[], levels: ModLevels): string {
  return `${applied(mods, levels).length} of ${mods.length} mods applied`
}

/** The Sound shift list: "Light lube" for a level mod, the name for a toggle mod. */
export function shiftName(mod: Mod, level: number): string {
  if (mod.levels && mod.levels.length > 0) {
    return `${levelLabel(mod.levels[Math.min(level, mod.levels.length - 1)])} ${mod.name.toLowerCase()}`
  }
  return mod.name
}

/** A card's status: the level's name for a level mod that is on, else On or Off. */
export function statusLabel(mod: Mod, level: number): string {
  if (level <= 0) {
    return 'Off'
  }
  return mod.levels && mod.levels.length > 0 ? levelLabel(mod.levels[Math.min(level, mod.levels.length - 1)]) : 'On'
}

/** Keeps only levels that name a mod the builder offers, within its levels. */
export function cleanLevels(mods: Mod[], levels: ModLevels): ModLevels {
  const clean: ModLevels = {}
  for (const mod of mods) {
    const level = levels[mod.slug]
    const max = mod.levels && mod.levels.length > 0 ? mod.levels.length - 1 : 1
    if (Number.isInteger(level) && level > 0 && level <= max) {
      clean[mod.slug] = level
    }
  }
  return clean
}

export type Tick = { height: number; tone: 'on' | 'passed' | 'ahead' }

/**
 * The sound meter's ticks, drawn bright on the left and deep on the right
 * (ModsDesktop), from the API's position (0 deep … 1 bright). The tick at
 * the position is tall and coral; those before it are filled.
 */
export function meterTicks(position: number, count: number): Tick[] {
  const at = Math.round(meterX(position) * (count - 1))
  return Array.from({ length: count }, (_, i) => ({
    height: i === at ? 32 : 10 + Math.round((i / (count - 1)) * 12),
    tone: i === at ? 'on' : i < at ? 'passed' : 'ahead',
  }))
}

/** Where a position sits on the meter, left (bright) 0 to right (deep) 1. */
export function meterX(position: number): number {
  return 1 - Math.max(0, Math.min(1, position))
}
