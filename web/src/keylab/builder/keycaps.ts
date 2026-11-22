import type { KeycapSet } from '../api/parts.ts'

// The Keycaps studio's choices and how a set looks (US-06, KeycapsDesktop,
// KeycapsMobile). Pure, so it is tested on its own (keycaps.test.ts).
//
// A keycap set is one material, one profile and one colourway (CAT-05). The
// studio's Profile and Material pickers therefore pick a set: the first one
// with that profile (or material), keeping the other choice when a set has it.

export type Profile = KeycapSet['profile']
export type Material = KeycapSet['material']

/** The profiles CAT-05 can return, with KeycapsDesktop's spec line and the cap drawing's sizes. */
export const PROFILES: { id: Profile; name: string; spec: string; H: number; dd: number; tilt: number; sculpted: boolean }[] = [
  { id: 'cherry', name: 'Cherry', spec: 'CHERRY · SCULPTED, LOW', H: 15, dd: 2, tilt: 2, sculpted: true },
  { id: 'oem', name: 'OEM', spec: 'OEM · SCULPTED, MEDIUM HEIGHT', H: 19, dd: 1.6, tilt: 2.2, sculpted: true },
  { id: 'sa', name: 'SA', spec: 'SA · SCULPTED, TALL AND SPHERICAL', H: 27, dd: 3.4, tilt: 2.6, sculpted: true },
  { id: 'xda', name: 'XDA', spec: 'XDA · UNIFORM, LOW WITH A FLAT TOP', H: 15, dd: 1.2, tilt: 0, sculpted: false },
]

/** KeycapsDesktop's material cards (desk) and KeycapsMobile's (phone). POM is not drawn; its copy is ours. */
export const MATERIALS: { id: Material; name: string; sound: string; desk: string; phone: string; swatch: string }[] = [
  {
    id: 'pbt',
    name: 'PBT',
    sound: 'DEEPER',
    desk: 'Textured, matte, resists shine. A drier, deeper sound.',
    phone: 'Textured and matte. Resists shine and gives a slightly deeper, drier sound.',
    swatch: 'pbt',
  },
  {
    id: 'abs',
    name: 'ABS',
    sound: 'HIGHER',
    desk: 'Smooth with rich color. A touch higher; can shine.',
    phone: 'Smooth, rich colors and crisp legends. A touch higher-pitched; can shine with use.',
    swatch: 'abs',
  },
  {
    id: 'pom',
    name: 'POM',
    sound: 'MUTED',
    desk: 'Dense and slick. A soft, muted sound.',
    phone: 'Dense and slick to the touch. A soft, muted sound.',
    swatch: 'pom',
  },
]

export function profileName(profile: Profile): string {
  return PROFILES.find((p) => p.id === profile)?.name ?? profile.toUpperCase()
}

/** "CHERRY · PBT · NAVY SUN", the line under the page title. */
export function summary(set: KeycapSet): string {
  return `${profileName(set.profile)} · ${set.material} · ${set.name}`.toUpperCase()
}

/** Materials shown: PBT and ABS always (the design), POM only when a set is made of it. */
export function materialsShown(sets: KeycapSet[]): typeof MATERIALS {
  return MATERIALS.filter((m) => m.id !== 'pom' || sets.some((s) => s.material === 'pom'))
}

/**
 * The set a Profile or Material pick leads to: the current set when it
 * already has it, else the first set with it that keeps the other choice,
 * else the first set with it. Undefined when no set has it.
 */
export function pickBy(sets: KeycapSet[], current: KeycapSet | null, change: { profile: Profile } | { material: Material }): KeycapSet | undefined {
  const axis = 'profile' in change ? 'profile' : 'material'
  const other = axis === 'profile' ? 'material' : 'profile'
  const wanted = 'profile' in change ? change.profile : change.material
  if (current && current[axis] === wanted) {
    return current
  }
  const matching = sets.filter((s) => s[axis] === wanted)
  return matching.find((s) => current && s[other] === current[other]) ?? matching[0]
}

/** The set's shift, -1 deeper … +1 brighter (0 when the API leaves it out). */
export function shiftOf(set: KeycapSet): number {
  return Math.max(-1, Math.min(1, set.soundShift ?? 0))
}

/** The shift in words, for each set's tile. */
export function shiftWord(shift: number): string {
  if (shift <= -0.5) return 'Deeper'
  if (shift < 0) return 'A touch deeper'
  if (shift === 0) return 'Like stock'
  if (shift < 0.5) return 'A touch brighter'
  return 'Brighter'
}

/**
 * Where the shift sits on a tile's scale, drawn like the Mods workshop's
 * meter: bright on the left (0), deep on the right (1), stock in the middle.
 */
export function shiftX(shift: number): number {
  return (1 - Math.max(-1, Math.min(1, shift))) / 2
}

/** One cap of the profile drawing (KeycapsDesktop's capPath): a 32-wide cap standing on y = 45. */
export function capPath(x0: number, H: number, dd: number, tilt: number): string {
  const b = 45
  const tl = b - H - tilt
  const tr = b - H + tilt
  const r = (v: number) => Math.round(v * 100) / 100
  return `M${x0} ${b} L${x0 + 4} ${r(tl)} Q${x0 + 15} ${r((tl + tr) / 2 + dd)} ${x0 + 28} ${r(tr)} L${x0 + 32} ${b} Z`
}

/** The three caps a profile tile draws, as the design sculpts them by row. */
export function profileCaps(profile: Profile): string[] {
  const p = PROFILES.find((x) => x.id === profile) ?? PROFILES[0]
  return [0, 1, 2].map((i) =>
    capPath(4 + i * 38, p.sculpted ? p.H * [1.12, 1, 0.92][i] : p.H, p.dd, p.sculpted ? p.tilt * [1.4, 0.4, -0.8][i] : 0),
  )
}

/** Darkens (f < 0) or lightens (f > 0) a #RRGGBB colour by a fraction. */
export function shade(hex: string, f: number): string {
  const n = Number.parseInt(hex.slice(1), 16)
  const parts = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const v = f < 0 ? c * (1 + f) : c + (255 - c) * f
    return Math.round(Math.max(0, Math.min(255, v)))
  })
  return `#${parts.map((c) => c.toString(16).padStart(2, '0')).join('')}`
}

/** Relative luminance (WCAG) of a #RRGGBB colour. */
function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16)
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** A legend colour that reads on the cap: ink on light caps, cream on dark ones. */
export function legendOn(hex: string): string {
  return luminance(hex) > 0.4 ? '#1f2b45' : '#fffdf5'
}

export type KeyColors = Record<'alpha' | 'mod' | 'accent', { top: string; side: string; legend: string }>

/** A set's colourway as the preview's key colours: the top is the colour, the side a shade darker. */
export function keyColors(colors: KeycapSet['colors']): KeyColors | undefined {
  if (!colors?.alpha || !colors.mod || !colors.accent) {
    return undefined
  }
  const one = (hex: string) => ({ top: hex.toLowerCase(), side: shade(hex, -0.18), legend: legendOn(hex) })
  return { alpha: one(colors.alpha), mod: one(colors.mod), accent: one(colors.accent) }
}

/** How much of a key the cap top covers per profile, in key units: SA tall and domed, XDA flat. */
export function capInsets(profile: Profile | undefined): { top: number; side: number; bottom: number } {
  switch (profile) {
    case 'oem':
      return { top: 0.08, side: 0.12, bottom: 0.23 }
    case 'sa':
      return { top: 0.06, side: 0.14, bottom: 0.27 }
    case 'xda':
      return { top: 0.1, side: 0.1, bottom: 0.14 }
    default:
      return { top: 0.09, side: 0.12, bottom: 0.21 }
  }
}
