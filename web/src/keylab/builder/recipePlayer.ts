import type { SoundRecipe } from '../api/parts.ts'

// Plays a sound recipe (BLD-10): the recipe's press or release take through
// its four filters. Web Audio, so the same WAV sounds different per mix
// without another download: a low shelf, a high shelf, an output gain, and a
// short room reverb mixed in by `reverbMix`. Takes are decoded once and kept
// for the page's life (their URLs are content-addressed).

const LOW_SHELF_HZ = 250
const HIGH_SHELF_HZ = 4000
/** A release is played a little softer than the press, as a finger lifts. */
const RELEASE_GAIN = 0.75

let context: AudioContext | null = null
let reverbImpulse: AudioBuffer | null = null
const decoded = new Map<string, Promise<AudioBuffer>>()

function audio(): AudioContext | null {
  if (!context) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) {
      return null
    }
    context = new Ctor()
  }
  if (context.state === 'suspended') {
    void context.resume()
  }
  return context
}

/** A short, dense room: 0.6 s of noise that fades out. Made once. */
function impulse(ctx: AudioContext): AudioBuffer {
  if (!reverbImpulse) {
    const length = Math.floor(ctx.sampleRate * 0.6)
    reverbImpulse = ctx.createBuffer(2, length, ctx.sampleRate)
    for (let channel = 0; channel < 2; channel++) {
      const data = reverbImpulse.getChannelData(channel)
      for (let i = 0; i < length; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 3)
      }
    }
  }
  return reverbImpulse
}

function take(ctx: AudioContext, url: string): Promise<AudioBuffer> {
  let pending = decoded.get(url)
  if (!pending) {
    pending = fetch(url)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`)
        }
        return response.arrayBuffer()
      })
      .then((bytes) => ctx.decodeAudioData(bytes))
    pending.catch(() => decoded.delete(url))
    decoded.set(url, pending)
  }
  return pending
}

// Takes that failed to load: preload leaves them alone (a page re-renders
// often, and the gateway rate-limits), a play tries again.
const failed = new Set<string>()

/** Fetches and decodes a recipe's takes ahead of the first key press. */
export function preload(recipe: SoundRecipe): void {
  const ctx = audio()
  if (ctx) {
    recipe.samples
      .filter((s) => !failed.has(s.url))
      .forEach((s) => void take(ctx, s.url).catch(() => failed.add(s.url)))
  }
}

export type Stroke = 'press' | 'release'

/** The detail of the `keylab-sound` window event each played stroke sends. */
export type PlayedSound = {
  stroke: Stroke
  url: string
  filters: SoundRecipe['filters']
  meter: SoundRecipe['meter']
}

/**
 * Plays one stroke of a recipe. Falls back to the press take when there is
 * no release. Rejects when the browser cannot play it.
 */
export async function playStroke(recipe: SoundRecipe, stroke: Stroke): Promise<void> {
  const ctx = audio()
  if (!ctx) {
    throw new Error('This browser cannot play sounds.')
  }
  const sample = recipe.samples.find((s) => s.stroke === stroke) ?? recipe.samples[0]
  if (!sample) {
    throw new Error('This switch has no sound yet.')
  }
  failed.delete(sample.url)
  const buffer = await take(ctx, sample.url)
  const { lowShelfDb = 0, highShelfDb = 0, reverbMix = 0, gainDb = 0 } = recipe.filters

  const source = ctx.createBufferSource()
  source.buffer = buffer
  const low = ctx.createBiquadFilter()
  low.type = 'lowshelf'
  low.frequency.value = LOW_SHELF_HZ
  low.gain.value = lowShelfDb
  const high = ctx.createBiquadFilter()
  high.type = 'highshelf'
  high.frequency.value = HIGH_SHELF_HZ
  high.gain.value = highShelfDb
  const out = ctx.createGain()
  out.gain.value = Math.pow(10, gainDb / 20) * (stroke === 'release' ? RELEASE_GAIN : 1)

  const dry = ctx.createGain()
  dry.gain.value = 1 - reverbMix
  const wet = ctx.createGain()
  wet.gain.value = reverbMix
  const room = ctx.createConvolver()
  room.buffer = impulse(ctx)

  source.connect(low).connect(high).connect(out)
  out.connect(dry).connect(ctx.destination)
  out.connect(room).connect(wet).connect(ctx.destination)

  // What plays, for anyone listening (the e2e test, a debugging session).
  window.dispatchEvent(
    new CustomEvent<PlayedSound>('keylab-sound', {
      detail: { stroke, url: sample.url, filters: recipe.filters, meter: recipe.meter },
    }),
  )

  await new Promise<void>((resolve) => {
    source.addEventListener('ended', () => resolve(), { once: true })
    source.start()
  })
}

/** Before / After and the Sound shift buttons: one key, press then release. */
export async function playKey(recipe: SoundRecipe): Promise<void> {
  await playStroke(recipe, 'press')
  await playStroke(recipe, 'release')
}
