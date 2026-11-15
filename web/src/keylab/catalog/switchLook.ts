// How a switch is drawn (SwitchCard.dc.html): housing colours, the stem
// cross, the type tag and the spec line. Shared by the public library, the
// switch page and the admin preview.

export type SwitchType = 'linear' | 'tactile' | 'clicky' | 'silent'

export type Housing = { top: string; bot: string; stroke: string; edge: string; dark: boolean }

const HOUSINGS: Record<string, Housing> = {
  clear: { top: 'rgba(236,241,247,.78)', bot: 'rgba(205,214,226,.95)', stroke: '#7E8A9B', edge: '#8E9AAB', dark: false },
  milky: { top: '#F3F0EA', bot: '#E4DED2', stroke: '#9E9583', edge: '#B8AF9E', dark: false },
  smoke: { top: 'rgba(74,80,92,.85)', bot: '#3B404B', stroke: '#1A1C21', edge: '#23262D', dark: true },
  amber: { top: 'rgba(150,104,60,.82)', bot: '#6E4D30', stroke: '#3A2716', edge: '#4A3220', dark: true },
  ice: { top: 'rgba(196,214,244,.85)', bot: '#AFC3E6', stroke: '#5F79A6', edge: '#7F95BD', dark: false },
  teal: { top: 'rgba(86,196,204,.85)', bot: '#3FA5B1', stroke: '#1E6A73', edge: '#2A7781', dark: false },
}

/** The housing is free text ("Milky PC top"); a known colour word picks the drawing, else milky. */
export function housingOf(text: string | undefined): Housing {
  const lower = (text ?? '').toLowerCase()
  for (const [word, housing] of Object.entries(HOUSINGS)) {
    if (lower.includes(word)) {
      return housing
    }
  }
  return HOUSINGS.milky
}

export const TYPE_LABELS: Record<string, string> = {
  linear: 'Linear',
  tactile: 'Tactile',
  clicky: 'Clicky',
  silent: 'Silent',
}

/** A type the API added after this client was built shows as "Other" (api-design-v1.md, Versioning). */
export function typeLabel(type: string): string {
  return TYPE_LABELS[type] ?? 'Other'
}

export function profileLabel(profile: string | undefined): string | null {
  if (!profile) {
    return null
  }
  return profile[0].toUpperCase() + profile.slice(1)
}

export function validStem(hex: string | undefined): string {
  return hex && /^#[0-9a-f]{6}$/i.test(hex.trim()) ? hex.trim() : '#888888'
}

export function shade(hex: string, amount: number): string {
  const h = validStem(hex).slice(1)
  return (
    '#' +
    [0, 2, 4]
      .map((i) => {
        const c = parseInt(h.slice(i, i + 2), 16)
        const v = Math.round(amount < 0 ? c * (1 + amount) : c + (255 - c) * amount)
        return Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')
      })
      .join('')
  )
}

/** The stem's cross: darker on a light stem, lighter on a dark one. */
export function crossOf(stem: string): string {
  const h = validStem(stem).slice(1)
  const light = (parseInt(h.slice(0, 2), 16) + parseInt(h.slice(2, 4), 16) + parseInt(h.slice(4, 6), 16)) / 3 > 170
  return light ? shade(stem, -0.25) : shade(stem, 0.32)
}

function grams(value: number | undefined): string | null {
  return value === undefined || value === null ? null : `${value}g`
}

function mm(value: number | undefined): string | null {
  return value === undefined || value === null ? null : `${Number(value).toFixed(1)}mm`
}

/** "62g · 2.0mm · Poppy" */
export function specLine(sw: { forceG?: number; actuationMm?: number; profile?: string }): string {
  return [grams(sw.forceG), mm(sw.actuationMm), profileLabel(sw.profile)].filter(Boolean).join(' · ')
}
