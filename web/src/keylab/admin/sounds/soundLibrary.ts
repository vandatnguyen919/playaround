import type { AdminSound } from '../../api/adminSounds.ts'

// The pure parts of the sound library and the drop zones (US-38): which take
// of each slot counts, a switch's badge, and the numbers as the design
// writes them. Tested on their own (soundLibrary.test.ts).

export type Variant = 'stock' | 'lubed' | 'foam'
export type Stroke = 'press' | 'release'
export type Badge = 'recorded' | 'missing' | 'processing'

export const VARIANTS: { value: Variant; label: string }[] = [
  { value: 'stock', label: 'Stock' },
  { value: 'lubed', label: 'Lubed' },
  { value: 'foam', label: 'Foam mod' },
]

export const STROKES: { value: Stroke; label: string }[] = [
  { value: 'press', label: 'Press' },
  { value: 'release', label: 'Release' },
]

export const MAX_BYTES = 10 * 1024 * 1024

export const CHECKLIST = [
  'Quiet room, under 30 dB background',
  'Mic 10 cm from the switch, same rig every time',
  '48 kHz, 24-bit WAV, mono',
  'One clean stroke per file, 100 ms of silence before',
  'Peak below −3 dB, no clipping',
  'Same keycap (PBT, row 3) for every switch',
]

/** The newest take of a slot: the one that is processing, plays, or failed last. */
export function latest(sounds: AdminSound[], variant: Variant, stroke: Stroke): AdminSound | undefined {
  return sounds
    .filter((s) => s.variant === variant && s.stroke === stroke)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))[0]
}

/** The take that plays for a slot: the newest ready one. */
export function playing(sounds: AdminSound[], variant: Variant, stroke: Stroke): AdminSound | undefined {
  return latest(
    sounds.filter((s) => s.status === 'ready'),
    variant,
    stroke,
  )
}

/** Slots with a ready take: the "N FILES" under a switch. */
export function readyFiles(sounds: AdminSound[]): number {
  let count = 0
  for (const v of VARIANTS) {
    for (const s of STROKES) {
      if (playing(sounds, v.value, s.value)) {
        count++
      }
    }
  }
  return count
}

/** Processing while any slot's newest take is; else recorded once stock press and release play. */
export function badgeFor(sounds: AdminSound[]): Badge {
  for (const v of VARIANTS) {
    for (const s of STROKES) {
      if (latest(sounds, v.value, s.value)?.status === 'processing') {
        return 'processing'
      }
    }
  }
  return playing(sounds, 'stock', 'press') && playing(sounds, 'stock', 'release') ? 'recorded' : 'missing'
}

/** Whether the variant tab has anything to show; else the no-sound state. */
export function hasVariant(sounds: AdminSound[], variant: Variant): boolean {
  return sounds.some((s) => s.variant === variant)
}

/** Recordings grouped by switch id. */
export function bySwitch(sounds: AdminSound[]): Map<string, AdminSound[]> {
  const groups = new Map<string, AdminSound[]>()
  for (const sound of sounds) {
    const list = groups.get(sound.switchId) ?? []
    list.push(sound)
    groups.set(sound.switchId, list)
  }
  return groups
}

/** "0.20 s" */
export function formatLength(ms: number | undefined): string {
  return ms === undefined ? '—' : `${(ms / 1000).toFixed(2)} s`
}

/** "−17 LUFS", with a real minus sign. */
export function formatLufs(lufs: number | undefined): string {
  if (lufs === undefined) {
    return '—'
  }
  const rounded = Math.round(lufs)
  return `${rounded < 0 ? '−' : ''}${Math.abs(rounded)} LUFS`
}

/** "coral-pop_stock_press.wav · coral-pop_stock_release.wav · 48 kHz · 24-bit" */
export function fileNote(press: AdminSound | undefined, release: AdminSound | undefined): string {
  const names = [press, release].filter((s): s is AdminSound => s !== undefined).map((s) => s.fileName ?? 'recording.wav')
  return [...names, '48 kHz', '24-bit'].join(' · ')
}

/** A file the browser can refuse before uploading, with the reason; null when it may go. */
export function refuseFile(file: { name: string; size: number }, kind: 'sound' | 'photo'): string | null {
  const name = file.name.toLowerCase()
  if (kind === 'sound' && !name.endsWith('.wav')) {
    return 'Only WAV files work here. Export the take as a 48 kHz, 24-bit mono WAV.'
  }
  if (kind === 'photo' && !/\.(png|jpe?g)$/.test(name)) {
    return 'Use a PNG or JPG photo.'
  }
  if (file.size > MAX_BYTES) {
    return 'It is over 10 MB. Upload a file under 10 MB.'
  }
  if (file.size === 0) {
    return 'The file is empty.'
  }
  return null
}
