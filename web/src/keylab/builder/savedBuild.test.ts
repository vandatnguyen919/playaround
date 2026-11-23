import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Build } from '../api/builds.ts'
import type { Mod } from '../api/parts.ts'
import {
  buildInput,
  buildSpec,
  caseLine,
  defaultName,
  keycapsLine,
  layoutLabel,
  modNames,
  nameError,
  partsPatch,
  shortSpec,
  switchType,
  whenLabel,
  type PartNames,
} from './savedBuild.ts'

// CAT-07 as the V5 seed answers it, the parts that matter here.
const MODS = [
  { slug: 'lube', name: 'Lube', levels: ['none', 'light', 'heavy'] },
  { slug: 'case-foam', name: 'Case foam' },
  { slug: 'stabs', name: 'Stabilizer tuning' },
] as Mod[]

const NAMES: PartNames = {
  switches: { 'milk-yellow': { name: 'Milk Yellow', type: 'linear', forceG: 50, stemColor: '#E9C46A' } },
  mods: MODS,
  keycapSets: [{ slug: 'navy-sun', name: 'Navy Sun', material: 'pbt', profile: 'cherry' }] as PartNames['keycapSets'],
  caseOptions: {
    materials: [{ slug: 'alu', name: 'Aluminum', colors: [], soundEffect: '' }],
    plates: [{ slug: 'brass', name: 'Brass', soundEffect: '' }],
    mounts: [{ slug: 'gasket', name: 'Gasket', soundEffect: '' }],
  },
}

const NIGHT_THOCK = {
  id: 'b1',
  name: 'Night Thock 65',
  visibility: 'private',
  owner: { username: 'me' },
  createdAt: '2026-11-20T10:00:00Z',
  layout: '65',
  switch: { slug: 'milk-yellow', variant: 'stock' },
  mods: [{ slug: 'lube', level: 'light' }, { slug: 'case-foam' }, { slug: 'stabs' }],
  keycaps: { set: 'navy-sun', profile: 'cherry', material: 'pbt' },
  case: { material: 'alu', color: '#2B4677', plate: 'brass', mount: 'gasket' },
} as Build

test('the build on hand becomes BuildInput: level names, toggle mods, keycaps and case', () => {
  const input = buildInput(
    { switch: 'milk-yellow', mods: { lube: 1, 'case-foam': 1, stabs: 0 }, keycapSet: 'navy-sun', case: { material: 'alu', color: '#2B4677', plate: 'brass', mount: 'gasket' } },
    MODS,
    'Night Thock 65',
  )
  assert.deepEqual(input, {
    name: 'Night Thock 65',
    layout: '65',
    switch: { slug: 'milk-yellow', variant: 'stock' },
    mods: [{ slug: 'lube', level: 'light' }, { slug: 'case-foam' }],
    keycaps: { set: 'navy-sun' },
    case: { material: 'alu', color: '#2B4677', plate: 'brass', mount: 'gasket' },
  })
})

test('no switch yet means nothing to save; a mod the builder no longer offers is left out', () => {
  assert.equal(buildInput({ mods: { lube: 1 } }, MODS, 'x'), null)
  const input = buildInput({ switch: 'milk-yellow', mods: { 'holee-mod': 1 } }, MODS, 'x')
  assert.deepEqual(input?.mods, [])
  assert.equal(input?.keycaps, undefined)
  assert.equal(input?.case, undefined)
})

test('saving new parts clears the parts the build no longer has and keeps the name', () => {
  const patch = partsPatch({ name: 'ignored', layout: '65', switch: { slug: 'milk-yellow' } })
  assert.deepEqual(patch, { layout: '65', switch: { slug: 'milk-yellow' }, mods: [], keycaps: null, case: null })
  assert.equal('name' in patch, false)
})

test('a new build is named after its switch and layout', () => {
  assert.equal(defaultName('Milk Yellow'), 'Milk Yellow 65')
  assert.equal(defaultName(undefined), 'My build 65')
  assert.equal(defaultName('x'.repeat(70)).length, 60)
})

test('the card lines read like the design', () => {
  assert.equal(layoutLabel('65'), '65%')
  assert.equal(layoutLabel('tkl'), 'TKL')
  assert.equal(layoutLabel('full'), '100%')
  assert.equal(buildSpec(NIGHT_THOCK, NAMES), '65% · MILK YELLOW · 3 MODS')
  assert.equal(shortSpec(NIGHT_THOCK, NAMES), '65% · MILK YELLOW')
  assert.equal(switchType(NIGHT_THOCK, NAMES), 'Linear · 50g')
  assert.deepEqual(modNames(NIGHT_THOCK, NAMES), ['Light lube', 'Case foam', 'Stabilizer tuning'])
  assert.equal(keycapsLine(NIGHT_THOCK, NAMES), 'PBT · Cherry · Navy Sun')
  assert.equal(caseLine(NIGHT_THOCK, NAMES), 'Aluminum · gasket · brass')
})

test('a part the catalog no longer lists still gets a readable name', () => {
  const old = { ...NIGHT_THOCK, switch: { slug: 'bump-brown' }, mods: [{ slug: 'holee-mod' }], case: { mount: 'top-mount' } } as Build
  const none: PartNames = { switches: {}, mods: [], keycapSets: [], caseOptions: null }
  assert.equal(buildSpec(old, none), '65% · BUMP BROWN · 1 MOD')
  assert.deepEqual(modNames(old, none), ['Holee Mod'])
  assert.equal(caseLine(old, none), 'top mount')
  assert.equal(switchType(old, none), '')
})

test('when a build changed, in words', () => {
  const now = new Date(2026, 10, 23, 12, 0)
  assert.equal(whenLabel(new Date(2026, 10, 23, 8, 0).toISOString(), now), 'Today')
  assert.equal(whenLabel(new Date(2026, 10, 22, 23, 0).toISOString(), now), 'Yesterday')
  assert.equal(whenLabel(new Date(2026, 10, 19).toISOString(), now), '4 days ago')
  assert.equal(whenLabel(new Date(2026, 10, 13).toISOString(), now), 'Last week')
  assert.equal(whenLabel(new Date(2026, 10, 1).toISOString(), now), '3 weeks ago')
  assert.equal(whenLabel(new Date(2026, 8, 2).toISOString(), now), '2 Sept 2026')
})

test('a name is checked with the API rules before it is sent', () => {
  assert.equal(nameError('  '), 'Give the build a name.')
  assert.equal(nameError('x'.repeat(61)), 'Keep the name to 60 characters.')
  assert.equal(nameError(' Night Thock '), null)
})
