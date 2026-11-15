// The Add / edit switch form (US-37, AdminSwitchEdit.dc.html) without React:
// form state to and from the API, field errors from a 422, readiness checks
// and the force curve geometry. Kept pure so node --test can check it.

export type SwitchType = 'linear' | 'tactile' | 'clicky' | 'silent'
export type Stroke = 'press' | 'release'

export const TYPES: { value: SwitchType; label: string }[] = [
  { value: 'linear', label: 'Linear' },
  { value: 'tactile', label: 'Tactile' },
  { value: 'clicky', label: 'Clicky' },
  { value: 'silent', label: 'Silent' },
]

// Stem colour swatches, as drawn.
export const STEMS: { name: string; hex: string }[] = [
  { name: 'Coral', hex: '#F16B53' },
  { name: 'Milk yellow', hex: '#E9C46A' },
  { name: 'Red', hex: '#D64545' },
  { name: 'Ink', hex: '#2A2E38' },
  { name: 'Brown', hex: '#7A4E2D' },
  { name: 'Blue', hex: '#2F6FD6' },
  { name: 'Jade', hex: '#2E9E7A' },
  { name: 'Lilac', hex: '#8C6BB1' },
]

/** One row of the points table. Strings, as typed; `key` keeps React rows stable. */
export type PointRow = { key: number; t: string; f: string }

/** A curve point as the API sends it. */
export type CurvePoint = { travelMm: number; forceG: number; stroke?: Stroke }

export type FormState = {
  name: string
  brand: string
  type: SwitchType
  stem: string
  force: string
  act: string
  total: string
  spring: string
  /** Press points, edited in the table. */
  points: PointRow[]
  /** Release points: drawn, kept as they are, not edited here. */
  release: CurvePoint[]
}

/** The switch as the API returns it (AdminSwitch), the parts this form uses. */
export type SwitchData = {
  id: string
  slug: string
  name: string
  brand?: string
  type: string
  stemColor?: string
  forceG?: number
  actuationMm?: number
  travelMm?: number
  spring?: string
  forceCurve?: CurvePoint[]
  status: string
  profile?: string
}

/** What the form sends. A number field that is not a number goes as typed, so the API names it. */
export type SwitchBody = {
  name: string
  brand: string | null
  type: SwitchType
  stemColor: string | null
  forceG: number | string | null
  actuationMm: number | string | null
  travelMm: number | string | null
  spring: string | null
  forceCurve: { travelMm: number | string | null; forceG: number | string | null; stroke: Stroke }[]
}

let nextKey = 1

export function newRow(t = '', f = ''): PointRow {
  return { key: nextKey++, t, f }
}

export function emptyForm(): FormState {
  return {
    name: '',
    brand: '',
    type: 'linear',
    stem: STEMS[0].hex,
    force: '',
    act: '',
    total: '',
    spring: '',
    points: [],
    release: [],
  }
}

/** Millimetres with at least one decimal, as drawn: 2 is "2.0", 0.45 stays "0.45". */
export function formatMm(value: number | undefined): string {
  if (value === undefined || value === null) {
    return ''
  }
  return Number.isInteger(value) ? value.toFixed(1) : String(value)
}

function formatNumber(value: number | undefined): string {
  return value === undefined || value === null ? '' : String(value)
}

function isType(value: string): value is SwitchType {
  return TYPES.some((type) => type.value === value)
}

export function formFromSwitch(sw: SwitchData): FormState {
  const curve = sw.forceCurve ?? []
  return {
    name: sw.name,
    brand: sw.brand ?? '',
    type: isType(sw.type) ? sw.type : 'linear',
    stem: sw.stemColor ?? '',
    force: formatNumber(sw.forceG),
    act: formatMm(sw.actuationMm),
    total: formatMm(sw.travelMm),
    spring: sw.spring ?? '',
    points: curve
      .filter((point) => (point.stroke ?? 'press') === 'press')
      .map((point) => newRow(formatMm(point.travelMm), formatNumber(point.forceG))),
    release: curve.filter((point) => point.stroke === 'release'),
  }
}

/** A number when the text is one, null when empty, else the text itself for the API to refuse. */
export function parseNumber(text: string): number | string | null {
  const trimmed = text.trim()
  if (trimmed === '') {
    return null
  }
  const value = Number(trimmed.replace(',', '.'))
  return Number.isFinite(value) ? value : trimmed
}

function optionalText(text: string): string | null {
  const trimmed = text.trim()
  return trimmed === '' ? null : trimmed
}

/**
 * The full switch for POST, and for PATCH as a merge patch: every field the
 * form owns is sent, null where it is empty, so clearing a field clears it.
 * Press points go first, in table order, so a 422 pointer /forceCurve/i is
 * row i of the table.
 */
export function bodyFromForm(form: FormState): SwitchBody {
  return {
    name: form.name.trim(),
    brand: optionalText(form.brand),
    type: form.type,
    stemColor: optionalText(form.stem),
    forceG: parseNumber(form.force),
    actuationMm: parseNumber(form.act),
    travelMm: parseNumber(form.total),
    spring: optionalText(form.spring),
    forceCurve: [
      ...form.points.map((row) => ({ travelMm: parseNumber(row.t), forceG: parseNumber(row.f), stroke: 'press' as const })),
      ...form.release.map((point) => ({ travelMm: point.travelMm, forceG: point.forceG, stroke: 'release' as const })),
    ],
  }
}

/** Form field names that 422 pointers map to. Points are "point.<row>.t" and "point.<row>.f". */
const FIELD_OF: Record<string, string> = {
  '/name': 'name',
  '/brand': 'brand',
  '/type': 'type',
  '/stemColor': 'stem',
  '/forceG': 'force',
  '/actuationMm': 'act',
  '/travelMm': 'total',
  '/spring': 'spring',
  '/forceCurve': 'curve',
}

export type FieldErrors = Record<string, string>

/**
 * Field errors from a 422, keyed by form field. Errors the form has no field
 * for (a release point, a field set elsewhere) come back in `other`.
 */
export function fieldErrorsFrom(
  errors: { pointer: string; message: string }[],
  form: FormState,
): { fields: FieldErrors; other: string[] } {
  const fields: FieldErrors = {}
  const other: string[] = []
  for (const { pointer, message } of errors) {
    let field = FIELD_OF[pointer]
    const point = /^\/forceCurve\/(\d+)(?:\/(travelMm|forceG|stroke))?$/.exec(pointer)
    if (point) {
      const index = Number(point[1])
      if (index < form.points.length) {
        const part = point[2] === 'forceG' ? 'f' : 't'
        field = `point.${form.points[index].key}.${part}`
      } else {
        field = 'curve'
      }
    }
    if (field === undefined) {
      other.push(message)
    } else if (!(field in fields)) {
      fields[field] = message
    }
  }
  return { fields, other }
}

function positive(text: string): number | null {
  const value = parseNumber(text)
  return typeof value === 'number' && value > 0 ? value : null
}

/** Press points the chart can draw: both numbers present, sorted by travel. */
export function pressPoints(form: FormState): CurvePoint[] {
  return form.points
    .map((row) => ({ travelMm: parseNumber(row.t), forceG: parseNumber(row.f) }))
    .filter((point): point is CurvePoint => typeof point.travelMm === 'number' && typeof point.forceG === 'number')
    .sort((a, b) => a.travelMm - b.travelMm)
}

/** The "Ready to publish?" checks this story can tick. Sounds arrive with US-38. */
export function readiness(form: FormState) {
  const nameOk = form.name.trim() !== ''
  const force = positive(form.force)
  const act = positive(form.act)
  const total = positive(form.total)
  const specsOk =
    force !== null &&
    act !== null &&
    total !== null &&
    act < total &&
    form.points.length >= 2 &&
    pressPoints(form).length === form.points.length
  return { nameOk, specsOk }
}

// --- Force curve chart ------------------------------------------------------------

export type ChartGeometry = {
  height: number
  base: number
  grid: { y: number; label: number }[]
  press: string
  area: string
  release: string
  actuation: { x: number; y: number; label: string; labelX: number; labelY: number; anchor: 'start' | 'end'; mm: string } | null
  totalLabel: string
  aria: string
}

const X0 = 34
const X1 = 330
const TOP = 12

function interpolate(points: CurvePoint[], travel: number): number | null {
  if (points.length === 0) {
    return null
  }
  if (travel <= points[0].travelMm) {
    return points[0].forceG
  }
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    if (travel <= b.travelMm) {
      const span = b.travelMm - a.travelMm
      return span === 0 ? b.forceG : a.forceG + ((b.forceG - a.forceG) * (travel - a.travelMm)) / span
    }
  }
  return points[points.length - 1].forceG
}

/**
 * The chart drawn from the points as typed (ForceCurve.dc.html's frame,
 * 340 wide): press as a solid line over a filled area, release dashed, the
 * actuation point marked. Null when fewer than two press points are complete.
 */
export function chartGeometry(form: FormState, height = 180): ChartGeometry | null {
  const press = pressPoints(form)
  if (press.length < 2) {
    return null
  }
  const release = [...form.release].sort((a, b) => a.travelMm - b.travelMm)
  const all = [...press, ...release]
  const total = positive(form.total)
  const maxX = Math.max(total ?? 0, ...all.map((point) => point.travelMm)) || 1
  const maxForce = Math.max(...all.map((point) => point.forceG))
  const yMax = Math.max(100, Math.ceil(maxForce / 25) * 25)
  const base = height - 22
  const x = (travel: number) => X0 + (travel / maxX) * (X1 - X0)
  const y = (force: number) => base - (Math.max(0, force) / yMax) * (base - TOP)
  const line = (points: CurvePoint[]) =>
    points.map((point, i) => `${i === 0 ? 'M' : 'L'}${x(point.travelMm).toFixed(1)} ${y(point.forceG).toFixed(1)}`).join(' ')
  const pressPath = line(press)
  const first = press[0]
  const last = press[press.length - 1]

  const act = positive(form.act)
  const force = positive(form.force)
  let actuation: ChartGeometry['actuation'] = null
  if (act !== null && act <= maxX) {
    const ax = x(act)
    const ay = y(interpolate(press, act) ?? 0)
    const right = ax > 230
    actuation = {
      x: Number(ax.toFixed(1)),
      y: Number(ay.toFixed(1)),
      label: force !== null ? `Actuation ${force}g` : 'Actuation',
      labelX: Number((right ? ax - 8 : ax + 8).toFixed(1)),
      labelY: Number((ay - 9).toFixed(1)),
      anchor: right ? 'end' : 'start',
      mm: act.toFixed(1),
    }
  }
  const step = yMax / 4
  return {
    height,
    base,
    grid: [1, 2, 3, 4].map((n) => ({ y: Number(y(step * n).toFixed(1)), label: step * n })),
    press: pressPath,
    area: `${pressPath} L${x(last.travelMm).toFixed(1)} ${base} L${x(first.travelMm).toFixed(1)} ${base} Z`,
    release: release.length >= 2 ? line(release) : '',
    actuation,
    totalLabel: `${maxX.toFixed(1)} mm`,
    aria:
      `${form.type} force curve from ${press.length} points` +
      (actuation && force !== null ? `: actuates at ${force} grams after ${act} millimetres` : '') +
      `, ${maxX.toFixed(1)} millimetres total travel`,
  }
}
