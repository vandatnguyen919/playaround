import type { Schemas } from '../api/client.ts'
import type { RecipeQuery } from '../api/parts.ts'
import type { BuildCase, BuildState } from './buildState.ts'
import { shade } from './keycaps.ts'

// The Case & plate page's choices and how they look (US-07, CaseDesktop,
// CaseMobile). The parts, their notes and the case colours come from CAT-08;
// what the API does not carry (a colour's name, a material's sample, a plate's
// colour, a mount's drawing) comes from the design by slug, with a plain
// fallback for a part editors add later. Pure, so it is tested on its own
// (caseParts.test.ts).

export type CaseOptions = Schemas['CaseOptions']
export type CaseChoice = { material: string; color: string; plate: string; mount: string }

/** CaseDesktop's state before anything is picked: aluminum, navy blue, brass, gasket. */
const DEFAULTS: CaseChoice = { material: 'alu', color: '#2B4677', plate: 'brass', mount: 'gasket' }

/** CaseDesktop's COLORS, by hex. */
const COLOR_NAMES: Record<string, string> = {
  '#C3C9D4': 'Silver',
  '#2B4677': 'Navy blue',
  '#2C2A5A': 'Indigo',
  '#FFD24D': 'Yellow',
  '#1C1F26': 'Black',
  '#E6DFCC': 'Cream',
  '#F16B53': 'Coral',
  '#6B4A33': 'Walnut',
}

/** The strip on each material tile (CaseDesktop's MATS sample). */
const MATERIAL_SAMPLES: Record<string, string> = {
  alu: '#C9CFD9',
  pc: '#DCE3EC',
  plastic: '#4A5160',
  wood: 'repeating-linear-gradient(91deg, #7A5638 0 5px, #6B4A33 5px 10px)',
}

/** Each plate's colour (CaseDesktop's PLATES hex; Keyboard.dc.html's KL_PLATE draws FR4 a touch darker). */
const PLATE_HEX: Record<string, string> = {
  alu: '#8D96A6',
  brass: '#A9873A',
  fr4: '#2E2C2A',
  pc: '#C9D2DE',
  pom: '#E8E6E1',
}

/** The plate's full name in the note under the plates ("Brass." in CaseDesktop's PLATES full). */
const PLATE_FULL: Record<string, string> = { alu: 'Aluminum', pc: 'Polycarbonate' }

export type MountDrawing = { caseD: string; dots: { x: number; y: number; w: number; h: number }[] }

/** CaseDesktop's MOUNTS drawings; CAT-08's slug for a top mount is `top-mount`. */
const MOUNT_DRAWINGS: Record<string, MountDrawing> = {
  tray: { caseD: 'M4 9 V31 H56 V9', dots: [{ x: 15, y: 23, w: 4, h: 8 }, { x: 41, y: 23, w: 4, h: 8 }] },
  gasket: {
    caseD: 'M4 12 V5 H56 V12 M4 20 V31 H56 V20',
    dots: [{ x: 5, y: 12.5, w: 6, h: 3 }, { x: 49, y: 12.5, w: 6, h: 3 }, { x: 5, y: 18.5, w: 6, h: 3 }, { x: 49, y: 18.5, w: 6, h: 3 }],
  },
  'top-mount': { caseD: 'M4 31 V5 H56 V31 H4 M9 5 V15 M51 5 V15', dots: [{ x: 7, y: 13, w: 4, h: 4 }, { x: 49, y: 13, w: 4, h: 4 }] },
}

export function colorName(hex: string): string {
  return COLOR_NAMES[hex.toUpperCase()] ?? hex.toUpperCase()
}

export function materialSample(slug: string): string {
  return MATERIAL_SAMPLES[slug] ?? '#C9CFD9'
}

export function plateHex(slug: string): string {
  return PLATE_HEX[slug] ?? '#8D96A6'
}

export function plateFull(slug: string, name: string): string {
  return PLATE_FULL[slug] ?? name
}

export function mountDrawing(slug: string): MountDrawing {
  return MOUNT_DRAWINGS[slug] ?? MOUNT_DRAWINGS['top-mount']
}

/** The case's face in the preview, as Keyboard.dc.html draws it: wood grain, frosted polycarbonate, or flat. */
export function caseBackground(hex: string, material: string): string {
  if (material === 'wood') {
    return `repeating-linear-gradient(91deg, ${shade(hex, 0.1)} 0 6px, ${hex} 6px 14px)`
  }
  return material === 'pc' ? `${hex}D9` : hex
}

/** The plate under the keys, shaded as Keyboard.dc.html does (klShade(plate, -.55)). */
export function plateBackground(slug: string): string {
  return shade(plateHex(slug), -0.55)
}

type Saved = Partial<CaseChoice> | undefined

/**
 * What the page starts on: each saved part while CAT-08 still offers it,
 * else the design's default, else the first one offered. The colour must be
 * one the material offers.
 */
export function startChoice(options: CaseOptions, saved: Saved): CaseChoice | null {
  const { materials, plates, mounts } = options
  if (materials.length === 0 || plates.length === 0 || mounts.length === 0) {
    return null
  }
  const pick = <T extends { slug?: string }>(list: T[], want: string | undefined, fallback: string) =>
    list.find((p) => p.slug === want)?.slug ?? list.find((p) => p.slug === fallback)?.slug ?? list[0].slug ?? ''
  const material = pick(materials, saved?.material, DEFAULTS.material)
  return {
    material,
    color: colorFor(options, material, saved?.color),
    plate: pick(plates, saved?.plate, DEFAULTS.plate),
    mount: pick(mounts, saved?.mount, DEFAULTS.mount),
  }
}

/** The colour kept when the material changes: the current one when the material offers it, else navy, else its first. */
export function colorFor(options: CaseOptions, material: string, current: string | undefined): string {
  const colors = (options.materials.find((m) => m.slug === material)?.colors ?? []).map((c) => c.toUpperCase())
  const want = current?.toUpperCase()
  if (want && colors.includes(want)) return want
  if (colors.includes(DEFAULTS.color)) return DEFAULTS.color
  return colors[0] ?? DEFAULTS.color
}

/**
 * The parts of the saved build besides the switch and mods, as BLD-10
 * parameters, so every builder page hears the same build.
 */
export type SavedParts = Pick<RecipeQuery, 'keycap_set' | 'case_material' | 'plate' | 'mount'>

export function buildParts(build: BuildState): SavedParts {
  return {
    keycap_set: build.keycapSet,
    case_material: build.case?.material,
    plate: build.case?.plate,
    mount: build.case?.mount,
  }
}

/** The saved case as the preview draws it, so every builder page shows the same case. */
export function caseLook(saved: BuildCase | undefined): { caseBg?: string; plateBg?: string } {
  return {
    caseBg: saved?.color && saved.material ? caseBackground(saved.color, saved.material) : undefined,
    plateBg: saved?.plate ? plateBackground(saved.plate) : undefined,
  }
}
