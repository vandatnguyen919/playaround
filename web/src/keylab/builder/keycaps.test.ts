import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { KeycapSet } from '../api/parts.ts'
import { recipeSearch } from '../api/parts.ts'
import { capInsets, keyColors, legendOn, materialsShown, pickBy, shade, shiftOf, shiftWord, shiftX, summary } from './keycaps.ts'

const set = (slug: string, material: KeycapSet['material'], profile: KeycapSet['profile'], soundShift = 0): KeycapSet => ({
  id: slug,
  slug,
  name: slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
  material,
  profile,
  soundShift,
  colors: { base: '#2C2A5A', alpha: '#FFFDF5', mod: '#2C2A5A', accent: '#FFD24D' },
})

// The published seed (V5): two PBT Cherry, one ABS OEM, one PBT XDA.
const CREAM = set('cream-paper', 'pbt', 'cherry', -0.25)
const NAVY = set('navy-sun', 'pbt', 'cherry', -0.25)
const SKY = set('sky-lab', 'abs', 'oem', 0.5)
const CORAL = set('coral-reef', 'pbt', 'xda', 0)
const SETS = [CREAM, NAVY, SKY, CORAL]

test('the summary under the title reads profile, material and set', () => {
  assert.equal(summary(NAVY), 'CHERRY · PBT · NAVY SUN')
  assert.equal(summary(SKY), 'OEM · ABS · SKY LAB')
})

test('a profile or material pick leads to a set that has it', () => {
  // Already there: stays.
  assert.equal(pickBy(SETS, NAVY, { profile: 'cherry' }), NAVY)
  assert.equal(pickBy(SETS, NAVY, { material: 'pbt' }), NAVY)
  // Keeps the material when it can.
  assert.equal(pickBy(SETS, NAVY, { profile: 'xda' }), CORAL)
  assert.equal(pickBy(SETS, SKY, { profile: 'cherry' }), CREAM)
  assert.equal(pickBy(SETS, CORAL, { material: 'abs' }), SKY)
  // Else the first with it; none when no set has it.
  assert.equal(pickBy(SETS, SKY, { profile: 'xda' }), CORAL)
  assert.equal(pickBy(SETS, NAVY, { profile: 'sa' }), undefined)
  assert.equal(pickBy(SETS, null, { material: 'pbt' }), CREAM)
})

test('POM shows only when a set is made of it', () => {
  assert.deepEqual(materialsShown(SETS).map((m) => m.id), ['pbt', 'abs'])
  assert.deepEqual(materialsShown([...SETS, set('ink', 'pom', 'cherry')]).map((m) => m.id), ['pbt', 'abs', 'pom'])
})

test('each set shows its deep-to-bright shift in words and on a scale', () => {
  assert.equal(shiftWord(-0.75), 'Deeper')
  assert.equal(shiftWord(-0.25), 'A touch deeper')
  assert.equal(shiftWord(0), 'Like stock')
  assert.equal(shiftWord(0.25), 'A touch brighter')
  assert.equal(shiftWord(0.5), 'Brighter')
  // Bright on the left, as the Mods workshop's meter; stock in the middle.
  assert.equal(shiftX(1), 0)
  assert.equal(shiftX(0), 0.5)
  assert.equal(shiftX(-1), 1)
  assert.equal(shiftX(-0.25), 0.625)
  assert.equal(shiftOf({ ...CORAL, soundShift: undefined }), 0)
  assert.equal(shiftOf({ ...CORAL, soundShift: 3 }), 1)
})

test('a colourway becomes key colours: top, a darker side, and a legend that reads', () => {
  assert.equal(shade('#3D6A8C', -0.18), '#325773')
  assert.equal(shade('#000000', 0.5), '#808080')
  assert.equal(legendOn('#FFFDF5'), '#1f2b45')
  assert.equal(legendOn('#2C2A5A'), '#fffdf5')
  const c = keyColors(NAVY.colors)
  assert.deepEqual(c?.alpha, { top: '#fffdf5', side: shade('#FFFDF5', -0.18), legend: '#1f2b45' })
  assert.equal(c?.mod.top, '#2c2a5a')
  assert.equal(c?.accent.top, '#ffd24d')
  assert.equal(keyColors(undefined), undefined)
})

test('profiles change how much of a key the cap top covers', () => {
  assert.deepEqual(capInsets(undefined), capInsets('cherry'))
  assert.ok(capInsets('sa').bottom > capInsets('cherry').bottom)
  assert.ok(capInsets('xda').bottom < capInsets('cherry').bottom)
})

test('the keycap set is part of the recipe URL, after the mods', () => {
  assert.equal(
    recipeSearch({ keycap_set: 'navy-sun', mod: ['stabs', 'lube:light'], switch: 'milk' }),
    'switch=milk&mod=lube%3Alight&mod=stabs&keycap_set=navy-sun',
  )
})
