import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AdminSound } from '../../api/adminSounds.ts'
import { badgeFor, bySwitch, fileNote, formatLength, formatLufs, latest, playing, readyFiles, refuseFile } from './soundLibrary.ts'

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
