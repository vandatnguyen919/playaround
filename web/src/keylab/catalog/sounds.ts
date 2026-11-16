import type { Recording } from '../api/switches.ts'

// Picking and playing a switch's recordings (CAT-03). The pure parts are
// tested on their own; playback is one HTMLAudioElement per stroke, and a new
// play stops whatever is still sounding.

export type Variant = 'stock' | 'lubed' | 'foam'
export type StrokeChoice = 'press' | 'release' | 'both'

export const VARIANTS: { value: Variant; label: string }[] = [
  { value: 'stock', label: 'Stock' },
  { value: 'lubed', label: 'Lubed' },
  { value: 'foam', label: 'Foam' },
]

export const STROKES: { value: StrokeChoice; label: string }[] = [
  { value: 'press', label: 'Press' },
  { value: 'release', label: 'Release' },
  { value: 'both', label: 'Both' },
]

export function recordingFor(recordings: Recording[], variant: Variant, stroke: 'press' | 'release'): Recording | undefined {
  return recordings.find((r) => r.variant === variant && r.stroke === stroke)
}

/** Variants with anything to play, in the order the pickers show them. */
export function variantsWithSound(recordings: Recording[]): Variant[] {
  return VARIANTS.map((v) => v.value).filter((v) => recordings.some((r) => r.variant === v))
}

/** The "Recordings" spec row: "Stock · lubed · foam". */
export function recordingsLabel(recordings: Recording[]): string {
  const names = variantsWithSound(recordings).map((v, i) => (i === 0 ? v[0].toUpperCase() + v.slice(1) : v))
  return names.length === 0 ? 'None yet' : names.join(' · ')
}

/** "Play press + release", "Play press", "Play release". */
export function playLabel(stroke: StrokeChoice): string {
  return `Play ${stroke === 'both' ? 'press + release' : stroke}`
}

/** The recordings to play for a stroke choice, press first. */
export function playlist(recordings: Recording[], variant: Variant, stroke: StrokeChoice): Recording[] {
  const strokes: ('press' | 'release')[] = stroke === 'both' ? ['press', 'release'] : [stroke]
  return strokes.map((s) => recordingFor(recordings, variant, s)).filter((r): r is Recording => r !== undefined)
}

/** Peaks resampled to {@code bars} values, each the loudest peak of its slice. */
export function bars(peaks: number[] | undefined, count: number): number[] {
  if (!peaks || peaks.length === 0 || count < 1) {
    return []
  }
  return Array.from({ length: count }, (_, i) => {
    const from = Math.floor((i * peaks.length) / count)
    const to = Math.max(from + 1, Math.floor(((i + 1) * peaks.length) / count))
    return Math.min(1, Math.max(0, ...peaks.slice(from, to)))
  })
}

let sounding: HTMLAudioElement[] = []
// Bumped by every new play: a "play in turn" that sees another number stops.
let turn = 0

function halt(): void {
  sounding.forEach((audio) => audio.pause())
  sounding = []
}

export function stopSounds(): void {
  turn += 1
  halt()
}

/**
 * Plays the recordings one after another. Resolves when the last one ends;
 * rejects when the browser cannot play one (blocked, missing, unsupported).
 */
export function play(recordings: Recording[]): Promise<void> {
  turn += 1
  return playQueue(recordings)
}

async function playQueue(recordings: Recording[]): Promise<void> {
  halt()
  const queue = recordings.map((r) => new Audio(r.url))
  sounding = queue
  for (const audio of queue) {
    if (!sounding.includes(audio)) {
      return
    }
    await new Promise<void>((resolve, reject) => {
      audio.addEventListener('ended', () => resolve(), { once: true })
      audio.addEventListener('pause', () => resolve(), { once: true })
      audio.addEventListener('error', () => reject(new Error('This sound could not be played.')), { once: true })
      audio.play().catch(reject)
    })
  }
}

/** The pause between two switches in "Play in turn". */
const TURN_GAP_MS = 350

/**
 * Compare mode's "Play in turn": each list (a switch's press then release)
 * after the other, telling {@code onTurn} whose turn it is and null at the
 * end. Any other play or stop ends it.
 */
export async function playInTurn(lists: Recording[][], onTurn: (index: number | null) => void): Promise<void> {
  turn += 1
  const mine = turn
  try {
    for (let i = 0; i < lists.length; i++) {
      if (turn !== mine) {
        return
      }
      onTurn(i)
      await playQueue(lists[i])
      if (i < lists.length - 1) {
        await new Promise((resolve) => window.setTimeout(resolve, TURN_GAP_MS))
      }
    }
  } finally {
    if (turn === mine) {
      onTurn(null)
    }
  }
}
