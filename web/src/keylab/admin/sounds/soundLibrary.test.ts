import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AdminSound } from '../../api/adminSounds.ts'
import { badgeFor, bySwitch, checkWav, failedOver, fileNote, formatLength, formatLufs, latest, playing, readyFiles, refuseFile, refuseWavHeader, shown, WAV_HEAD_BYTES } from './soundLibrary.ts'

let n = 0
const take = (variant: AdminSound['variant'], stroke: AdminSound['stroke'], status: AdminSound['status'], extra: Partial<AdminSound> = {}): AdminSound => {
  n++
  return {
    id: `id-${n}`,
    switchId: 'sw-1',
    variant,
    stroke,
    status,
    createdAt: `2026-11-16T10:00:${String(n).padStart(2, '0')}Z`,
    url: status === 'ready' ? `/bff/keylab/v1/assets/sounds/${n}.wav` : undefined,
    ...extra,
  } as AdminSound
}

test('the newest take counts; the newest ready one plays', () => {
  const old = take('stock', 'press', 'ready')
  const failed = take('stock', 'press', 'failed')
  assert.equal(latest([old, failed], 'stock', 'press')?.id, failed.id)
  assert.equal(playing([old, failed], 'stock', 'press')?.id, old.id)
  assert.equal(playing([old, failed], 'stock', 'release'), undefined)
})

test('a switch is processing, recorded or missing', () => {
  const press = take('stock', 'press', 'ready')
  const release = take('stock', 'release', 'ready')
  assert.equal(badgeFor([]), 'missing')
  assert.equal(badgeFor([press]), 'missing')
  assert.equal(badgeFor([press, release]), 'recorded')
  assert.equal(badgeFor([press, release, take('lubed', 'press', 'processing')]), 'processing')
  // A failed newer take leaves the older ready one playing: still recorded.
  assert.equal(badgeFor([press, release, take('stock', 'release', 'failed')]), 'recorded')
  assert.equal(readyFiles([press, release, take('stock', 'release', 'ready'), take('foam', 'press', 'failed')]), 2)
})

test('recordings group by switch', () => {
  const a = take('stock', 'press', 'ready', { switchId: 'a' })
  const b = take('stock', 'press', 'ready', { switchId: 'b' })
  assert.deepEqual([...bySwitch([a, b, a]).keys()], ['a', 'b'])
  assert.equal(bySwitch([a, b, a]).get('a')?.length, 2)
})

test('numbers read as the design writes them', () => {
  assert.equal(formatLength(200), '0.20 s')
  assert.equal(formatLength(undefined), '—')
  assert.equal(formatLufs(-17.4), '−17 LUFS')
  assert.equal(formatLufs(-17.6), '−18 LUFS')
  assert.equal(
    fileNote(take('stock', 'press', 'ready', { fileName: 'coral-pop_stock_press.wav' }), take('stock', 'release', 'ready', { fileName: 'coral-pop_stock_release.wav' })),
    'coral-pop_stock_press.wav · coral-pop_stock_release.wav · 48 kHz · 24-bit',
  )
})

test('the browser refuses what the API would', () => {
  assert.equal(refuseFile({ name: 'take.WAV', size: 1000 }, 'sound'), null)
  assert.match(refuseFile({ name: 'take.flac', size: 1000 }, 'sound') ?? '', /Only WAV/)
  assert.match(refuseFile({ name: 'take.wav', size: 11 * 1024 * 1024 }, 'sound') ?? '', /10 MB/)
  assert.equal(refuseFile({ name: 'photo.jpeg', size: 1000 }, 'photo'), null)
  assert.match(refuseFile({ name: 'photo.gif', size: 1000 }, 'photo') ?? '', /PNG or JPG/)
})

test('a row shows the take that plays, and says when a newer upload failed', () => {
  const good = take('stock', 'press', 'ready')
  const bad = take('stock', 'press', 'failed', { error: 'It clips at 0 dBFS.' })
  assert.equal(shown([good, bad], 'stock', 'press')?.id, good.id)
  assert.equal(failedOver([good, bad], 'stock', 'press')?.id, bad.id)
  // With nothing that plays, the failed take is what there is.
  assert.equal(shown([bad], 'stock', 'press')?.id, bad.id)
  assert.equal(failedOver([bad], 'stock', 'press'), undefined)
  // A take still processing shows until it ends.
  const busy = take('stock', 'press', 'processing')
  assert.equal(shown([good, bad, busy], 'stock', 'press')?.id, busy.id)
  assert.equal(failedOver([good, bad, busy], 'stock', 'press'), undefined)
  // A good take after a failed one clears the note.
  const better = take('stock', 'press', 'ready')
  assert.equal(failedOver([good, bad, better], 'stock', 'press'), undefined)
})

/** A WAV header and `frames` silent frames, as the e2e and keylab-api tests build them. */
function wavBytes(rate = 48_000, bits = 24, channels = 1, frames = 100, format = 1): Uint8Array {
  const data = frames * (bits / 8) * channels
  const out = new Uint8Array(44 + data)
  const view = new DataView(out.buffer)
  out.set([...'RIFF'].map((c) => c.charCodeAt(0)), 0)
  view.setUint32(4, 36 + data, true)
  out.set([...'WAVEfmt '].map((c) => c.charCodeAt(0)), 8)
  view.setUint32(16, 16, true)
  view.setUint16(20, format, true)
  view.setUint16(22, channels, true)
  view.setUint32(24, rate, true)
  view.setUint32(28, rate * channels * (bits / 8), true)
  view.setUint16(32, channels * (bits / 8), true)
  view.setUint16(34, bits, true)
  out.set([...'data'].map((c) => c.charCodeAt(0)), 36)
  view.setUint32(40, data, true)
  return out
}

test('the browser reads the WAV header and refuses what processing would, in its words', () => {
  assert.equal(refuseWavHeader(wavBytes(), true), null)
  assert.equal(
    refuseWavHeader(wavBytes(44_100, 16, 2), true),
    'It is 44.1 kHz, 16-bit stereo. Upload a 48 kHz, 24-bit mono WAV.',
  )
  assert.equal(refuseWavHeader(wavBytes(48_000, 24, 2), true), 'It is 48 kHz, 24-bit stereo. Upload a 48 kHz, 24-bit mono WAV.')
  assert.equal(refuseWavHeader(wavBytes(48_000, 32, 1, 100, 3), true), 'It is 48 kHz, 32-bit float mono. Upload a 48 kHz, 24-bit mono WAV.')
  assert.equal(refuseWavHeader(wavBytes(48_000, 24, 1, 0), true), 'This WAV file has no sound in it.')
  assert.match(refuseWavHeader(new TextEncoder().encode('fLaC and more bytes'), true) ?? '', /not a WAV file/)
  assert.match(refuseWavHeader(wavBytes().slice(0, 20), true) ?? '', /incomplete/)
  // Only part of a big file read and no data chunk yet: processing decides.
  assert.equal(refuseWavHeader(wavBytes().slice(0, 20), false), null)
})

test('checkWav reads only the start of the file', async () => {
  assert.equal(await checkWav(new Blob([wavBytes(48_000, 24, 1, 30_000)])), null)
  assert.match((await checkWav(new Blob([wavBytes(44_100, 16, 2, 30_000)]))) ?? '', /44\.1 kHz, 16-bit stereo/)
  assert.ok(wavBytes(48_000, 24, 1, 30_000).length > WAV_HEAD_BYTES)
})
