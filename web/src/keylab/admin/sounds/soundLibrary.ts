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

/** What a slot's row shows: a take still processing, else the one that plays, else the newest (failed) one. */
export function shown(sounds: AdminSound[], variant: Variant, stroke: Stroke): AdminSound | undefined {
  const newest = latest(sounds, variant, stroke)
  if (newest?.status === 'processing') {
    return newest
  }
  return playing(sounds, variant, stroke) ?? newest
}

/** The newest take failed while an older one still plays: the upload did not replace it. */
export function failedOver(sounds: AdminSound[], variant: Variant, stroke: Stroke): AdminSound | undefined {
  const newest = latest(sounds, variant, stroke)
  return newest?.status === 'failed' && playing(sounds, variant, stroke) ? newest : undefined
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

/** How much of a WAV the browser reads to find its format; the fmt chunk sits near the start. */
export const WAV_HEAD_BYTES = 64 * 1024

/**
 * Refuses a WAV whose header processing (WavAnalysis in keylab-api) would
 * refuse, with the same words, so a wrong format never uploads. Clipping
 * needs every sample, so processing still decides that.
 *
 * @param complete whether `head` is the whole file; if not, a header that
 *     runs past it is left to processing
 */
export function refuseWavHeader(head: Uint8Array, complete: boolean): string | null {
  const ascii = (at: number, text: string) => [...text].every((c, i) => head[at + i] === c.charCodeAt(0))
  const u16 = (at: number) => head[at] | (head[at + 1] << 8)
  const u32 = (at: number) => (head[at] | (head[at + 1] << 8) | (head[at + 2] << 16)) + head[at + 3] * 2 ** 24
  if (head.length < 12 || !ascii(0, 'RIFF') || !ascii(8, 'WAVE')) {
    return 'This is not a WAV file. Export the take as a 48 kHz, 24-bit mono WAV.'
  }
  let format = -1
  let channels = 0
  let rate = 0
  let bits = 0
  let at = 12
  while (at + 8 <= head.length) {
    const size = u32(at + 4)
    const body = at + 8
    if (ascii(at, 'fmt ') && size >= 16 && body + 16 <= head.length) {
      format = u16(body)
      channels = u16(body + 2)
      rate = u32(body + 4)
      bits = u16(body + 14)
      if (format === 0xfffe && size >= 40 && body + 26 <= head.length) {
        // The sub-format GUID starts with the real format code.
        format = u16(body + 24)
      }
    } else if (ascii(at, 'data')) {
      if (format === -1) {
        return 'This WAV file is incomplete. Export it again.'
      }
      if (format !== 1 || channels !== 1 || rate !== 48_000 || bits !== 24) {
        return `It is ${describeWav(format, rate, bits, channels)}. Upload a 48 kHz, 24-bit mono WAV.`
      }
      const length = complete ? Math.min(size, head.length - body) : size
      return Math.floor(length / 3) === 0 ? 'This WAV file has no sound in it.' : null
    }
    at = body + size + (size % 2)
  }
  return complete ? 'This WAV file is incomplete. Export it again.' : null
}

/** "44.1 kHz, 16-bit stereo", as WavAnalysis.describe writes it. */
function describeWav(format: number, rate: number, bits: number, channels: number): string {
  const kind = format === 1 ? '' : format === 3 ? ' float' : ' compressed'
  const layout = channels === 1 ? 'mono' : channels === 2 ? 'stereo' : `${channels}-channel`
  return `${rate / 1000} kHz, ${bits}-bit${kind} ${layout}`
}

/** Reads the start of a sound file and refuses a wrong format; null when it may upload. */
export async function checkWav(file: Blob): Promise<string | null> {
  const head = new Uint8Array(await file.slice(0, WAV_HEAD_BYTES).arrayBuffer())
  return refuseWavHeader(head, file.size <= WAV_HEAD_BYTES)
}
