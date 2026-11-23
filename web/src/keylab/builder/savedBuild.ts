import type { Build, BuildInput, Layout } from '../api/builds.ts'
import type { KeycapSet, Mod } from '../api/parts.ts'
import type { CaseOptions } from './caseParts.ts'
import type { BuildState } from './buildState.ts'
import { levelLabel } from './mods.ts'
import { profileName } from './keycaps.ts'

// Saved builds (US-08): what Save build sends (BLD-02, BLD-04) and the lines
// My builds, Recent builds and the sidebar's current build show
// (BuildsDesktop, BuildsMobile, HomeDesktop, Main). Pure, so it is tested on
// its own (savedBuild.test.ts).

/** The builder draws a 65% board; the layout picker comes with its own story. */
export const DEFAULT_LAYOUT: Layout = '65'

export const NAME_MAX = 60

/** BuildCard's layout sticker: "65%", "TKL", "100%". */
export function layoutLabel(layout: string | undefined): string {
  switch (layout) {
    case 'tkl':
      return 'TKL'
    case 'full':
      return '100%'
    case undefined:
      return ''
    default:
      return `${layout}%`
  }
}

/** A first name for a new build: the switch and the layout, "Milk Yellow 65". */
export function defaultName(switchName: string | undefined, layout: string = DEFAULT_LAYOUT): string {
  const base = (switchName ?? '').trim() || 'My build'
  const label = layout === 'full' ? '100' : layout === 'tkl' ? 'TKL' : layout
  return `${base} ${label}`.slice(0, NAME_MAX).trim()
}

/** The parts of the build on hand as BuildInput, or null when no switch is picked yet. */
export function buildInput(state: BuildState, mods: Mod[], name: string): BuildInput | null {
  if (!state.switch) {
    return null
  }
  const levels = state.mods ?? {}
  const picked: NonNullable<BuildInput['mods']> = []
  for (const mod of mods) {
    const level = levels[mod.slug] ?? 0
    if (level <= 0) {
      continue
    }
    if (mod.levels && mod.levels.length > 0) {
      picked.push({ slug: mod.slug, level: mod.levels[Math.min(level, mod.levels.length - 1)] })
    } else {
      picked.push({ slug: mod.slug })
    }
  }
  const input: BuildInput = { name, layout: DEFAULT_LAYOUT, switch: { slug: state.switch, variant: 'stock' }, mods: picked }
  if (state.keycapSet) {
    input.keycaps = { set: state.keycapSet }
  }
  const c = state.case
  if (c && (c.material || c.color || c.plate || c.mount)) {
    input.case = { material: c.material, color: c.color, plate: c.plate, mount: c.mount }
  }
  return input
}

/**
 * The parts a save would change, as a JSON Merge Patch: name and visibility
 * stay as the member set them, and null clears a part the build no longer has.
 */
export function partsPatch(input: BuildInput): Record<string, unknown> {
  return {
    layout: input.layout,
    switch: input.switch,
    mods: input.mods ?? [],
    keycaps: input.keycaps ?? null,
    case: input.case ?? null,
  }
}

/** What the cards need from the catalog to name a build's parts. Anything missing falls back to the slug. */
export type PartNames = {
  switches: Record<string, { name: string; type?: string; forceG?: number; stemColor?: string }>
  mods: Mod[]
  keycapSets: KeycapSet[]
  caseOptions: CaseOptions | null
}

export const NO_NAMES: PartNames = { switches: {}, mods: [], keycapSets: [], caseOptions: null }

function titleCase(slug: string): string {
  return slug
    .split('-')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

export function switchName(build: Build, names: PartNames): string {
  const slug = build.switch?.slug ?? ''
  return names.switches[slug]?.name ?? titleCase(slug)
}

/** "Linear · 50g" beside the switch in BuildCard. */
export function switchType(build: Build, names: PartNames): string {
  const sw = names.switches[build.switch?.slug ?? '']
  if (!sw?.type) {
    return ''
  }
  const type = sw.type.charAt(0).toUpperCase() + sw.type.slice(1)
  return sw.forceG ? `${type} · ${Math.round(sw.forceG)}g` : type
}

/** "Light lube" for a level mod, the mod's name for a toggle mod, in the build's order. */
export function modNames(build: Build, names: PartNames): string[] {
  return (build.mods ?? []).map((m) => {
    const mod = names.mods.find((x) => x.slug === m.slug)
    const name = mod?.name ?? titleCase(m.slug)
    return m.level ? `${levelLabel(m.level)} ${name.toLowerCase()}` : name
  })
}

/** "65% · MILK YELLOW · 3 MODS" under a saved build's name. */
export function buildSpec(build: Build, names: PartNames): string {
  const count = build.mods?.length ?? 0
  return [layoutLabel(build.layout), switchName(build, names), `${count} ${count === 1 ? 'mod' : 'mods'}`]
    .filter(Boolean)
    .join(' · ')
    .toUpperCase()
}

/** "65% · MILK YELLOW" in the sidebar's current build. */
export function shortSpec(build: Build, names: PartNames): string {
  return [layoutLabel(build.layout), switchName(build, names)].filter(Boolean).join(' · ').toUpperCase()
}

/** "PBT · Cherry · Navy Sun". */
export function keycapsLine(build: Build, names: PartNames): string {
  const k = build.keycaps
  if (!k?.set) {
    return 'Stock'
  }
  const set = names.keycapSets.find((s) => s.slug === k.set)
  const material = (k.material ?? set?.material ?? '').toUpperCase()
  const profile = k.profile ?? set?.profile
  return [material, profile ? profileName(profile as KeycapSet['profile']) : '', set?.name ?? titleCase(k.set)]
    .filter(Boolean)
    .join(' · ')
}

/** "Aluminum · gasket · brass": material, mount, plate (BuildsDesktop). */
export function caseLine(build: Build, names: PartNames): string {
  const c = build.case
  if (!c) {
    return 'Stock'
  }
  const o = names.caseOptions
  const material = c.material ? (o?.materials.find((m) => m.slug === c.material)?.name ?? titleCase(c.material)) : ''
  const mount = c.mount ? (o?.mounts.find((m) => m.slug === c.mount)?.name ?? titleCase(c.mount)) : ''
  const plate = c.plate ? (o?.plates.find((p) => p.slug === c.plate)?.name ?? titleCase(c.plate)) : ''
  return [material, mount.toLowerCase(), plate.toLowerCase()].filter(Boolean).join(' · ') || 'Stock'
}

/** The tile's square: the keycap set's alpha colour, the design's blue when there is none. */
export function tileColor(build: Build, names: PartNames): string {
  const set = names.keycapSets.find((s) => s.slug === build.keycaps?.set)
  return set?.colors?.alpha ?? '#3D6A8C'
}

/** The small square on the tile: the switch's stem colour, the design's yellow when unknown. */
export function stemColor(build: Build, names: PartNames): string {
  return names.switches[build.switch?.slug ?? '']?.stemColor ?? '#E9C46A'
}

const DAY = 24 * 60 * 60 * 1000

/** "Today", "Yesterday", "3 days ago", "Last week", "3 weeks ago", else the date (HomeDesktop's `when`). */
export function whenLabel(iso: string | undefined, now: Date = new Date()): string {
  if (!iso) {
    return ''
  }
  const then = new Date(iso)
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((startOf(now) - startOf(then)) / DAY)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days} days ago`
  if (days < 14) return 'Last week'
  if (days < 31) return `${Math.floor(days / 7)} weeks ago`
  return then.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

/** Checks a name before it is sent, with the API's words. */
export function nameError(name: string): string | null {
  const trimmed = name.trim()
  if (!trimmed) return 'Give the build a name.'
  if ([...trimmed].length > NAME_MAX) return `Keep the name to ${NAME_MAX} characters.`
  return null
}
