import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Mod } from '../api/parts.ts'
import { recipeSearch } from '../api/parts.ts'
import {
  beforeAfter,
  cleanLevels,
  countLabel,
  meterTicks,
  meterX,
  modParams,
  shiftName,
  statusLabel,
  withLevel,
} from './mods.ts'

const fx = { pitch: 0, thock: 0, volume: 0, rattle: 0 }
const LUBE: Mod = { id: '1', slug: 'lube', name: 'Lube', levels: ['none', 'light', 'heavy'], effects: fx }
const FOAM: Mod = { id: '2', slug: 'case-foam', name: 'Case foam', effects: fx }
const STABS: Mod = { id: '3', slug: 'stabs', name: 'Stabilizer tuning', effects: fx }
const MODS = [LUBE, FOAM, STABS]

test('a mix becomes sorted mod values, off mods left out', () => {
  assert.deepEqual(modParams(MODS, {}), [])
  assert.deepEqual(modParams(MODS, { stabs: 1, lube: 1, 'case-foam': 1 }), ['case-foam', 'lube:light', 'stabs'])
  assert.deepEqual(modParams(MODS, { lube: 2 }), ['lube:heavy'])
  assert.deepEqual(modParams(MODS, { lube: 0, 'case-foam': 0 }), [])
})

test('equal mixes make one URL whatever the toggle order', () => {
  const a = recipeSearch({ switch: 'milk', mod: ['stabs', 'lube:light'] })
  const b = recipeSearch({ mod: ['lube:light', 'stabs'], switch: 'milk' })
  assert.equal(a, b)
  assert.equal(a, 'switch=milk&mod=lube%3Alight&mod=stabs')
  assert.equal(recipeSearch({ switch: 'milk', mod: [] }), 'switch=milk')
})

test('before is the mix without the mod, after with it on', () => {
  const now = { lube: 2, stabs: 1 }
  assert.deepEqual(beforeAfter(now, LUBE), { before: { stabs: 1 }, after: { lube: 2, stabs: 1 } })
  // An off toggle mod: after turns it on.
  assert.deepEqual(beforeAfter(now, FOAM), { before: now, after: { lube: 2, stabs: 1, 'case-foam': 1 } })
  // An off level mod: after uses its first "on" level.
  assert.deepEqual(beforeAfter({}, LUBE).after, { lube: 1 })
})

test('toggling and levels', () => {
  assert.deepEqual(withLevel({ lube: 1 }, 'lube', 0), {})
  assert.deepEqual(withLevel({}, 'stabs', 1), { stabs: 1 })
})

test('labels follow ModsDesktop', () => {
  assert.equal(countLabel(MODS, { lube: 1, stabs: 1 }), '2 of 3 mods applied')
  assert.equal(shiftName(LUBE, 1), 'Light lube')
  assert.equal(shiftName(FOAM, 1), 'Case foam')
  assert.equal(statusLabel(LUBE, 2), 'Heavy')
  assert.equal(statusLabel(LUBE, 0), 'Off')
  assert.equal(statusLabel(FOAM, 1), 'On')
})

test('stored levels are cleaned against the live mods', () => {
  assert.deepEqual(cleanLevels(MODS, { lube: 5, gone: 1, 'case-foam': 2, stabs: 1 }), { stabs: 1 })
  assert.deepEqual(cleanLevels(MODS, { lube: 2 }), { lube: 2 })
})

test('the meter runs bright to deep, left to right', () => {
  assert.equal(meterX(1), 0)
  assert.equal(meterX(0), 1)
  const ticks = meterTicks(0.1, 40)
  const at = ticks.findIndex((t) => t.tone === 'on')
  assert.equal(at, 35)
  assert.equal(ticks[at].height, 32)
  assert.ok(ticks.slice(0, at).every((t) => t.tone === 'passed'))
  assert.ok(ticks.slice(at + 1).every((t) => t.tone === 'ahead'))
})
