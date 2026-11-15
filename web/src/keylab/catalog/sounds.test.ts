import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Recording } from '../api/switches.ts'
import { bars, playLabel, playlist, recordingsLabel, variantsWithSound } from './sounds.ts'

const rec = (variant: Recording['variant'], stroke: Recording['stroke']): Recording => ({
  variant,
  stroke,
  url: `https://cdn.keylab.test/${variant}-${stroke}.opus`,
})

const ALL = [rec('stock', 'press'), rec('stock', 'release'), rec('foam', 'press'), rec('foam', 'release')]

test('a stroke choice plays press before release, from the chosen variant', () => {
  assert.deepEqual(
    playlist(ALL, 'stock', 'both').map((r) => r.url),
    ['https://cdn.keylab.test/stock-press.opus', 'https://cdn.keylab.test/stock-release.opus'],
  )
  assert.deepEqual(playlist(ALL, 'foam', 'release').map((r) => r.url), ['https://cdn.keylab.test/foam-release.opus'])
  assert.deepEqual(playlist(ALL, 'lubed', 'both'), [])
})

test('only variants with a recording can be picked, and the spec row names them', () => {
  assert.deepEqual(variantsWithSound(ALL), ['stock', 'foam'])
  assert.equal(recordingsLabel(ALL), 'Stock · foam')
  assert.equal(recordingsLabel([...ALL, rec('lubed', 'press')]), 'Stock · lubed · foam')
  assert.equal(recordingsLabel([]), 'None yet')
})

test('the play button says what it plays', () => {
  assert.equal(playLabel('both'), 'Play press + release')
  assert.equal(playLabel('press'), 'Play press')
})

test('peaks are resampled to the loudest of each slice', () => {
  assert.deepEqual(bars([0.1, 0.9, 0.2, 0.4], 2), [0.9, 0.4])
  assert.deepEqual(bars([0.5], 3), [0.5, 0.5, 0.5])
  assert.deepEqual(bars([2, -1], 2), [1, 0])
  assert.deepEqual(bars(undefined, 4), [])
})
