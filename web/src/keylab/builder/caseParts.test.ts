import { test } from 'node:test'
import assert from 'node:assert/strict'
import { recipeSearch } from '../api/parts.ts'
import {
  buildParts,
  caseBackground,
  caseLook,
  colorFor,
  colorName,
  mountDrawing,
  plateBackground,
  plateFull,
  startChoice,
  type CaseOptions,
} from './caseParts.ts'

const EIGHT = ['#C3C9D4', '#2B4677', '#2C2A5A', '#FFD24D', '#1C1F26', '#E6DFCC', '#F16B53', '#6B4A33']

// CAT-08 as the V5 seed answers it.
const SEED: CaseOptions = {
  materials: [
    { slug: 'alu', name: 'Aluminum', colors: EIGHT, soundEffect: 'Dense and solid. Clean, low resonance.' },
    { slug: 'pc', name: 'Polycarbonate', colors: EIGHT, soundEffect: 'Frosted, light-friendly. Softer, brighter.' },
    { slug: 'plastic', name: 'Plastic', colors: EIGHT, soundEffect: 'Light and cheap. Hollow without foam.' },
    { slug: 'wood', name: 'Wood', colors: EIGHT, soundEffect: 'Warm and muted. Softens the high end.' },
  ],
  plates: ['alu', 'brass', 'fr4', 'pc', 'pom'].map((slug) => ({ slug, name: slug.toUpperCase(), soundEffect: '' })),
  mounts: ['tray', 'gasket', 'top-mount'].map((slug) => ({ slug, name: slug, soundEffect: '' })),
}

test('with nothing saved the page starts on the design: aluminum, navy blue, brass, gasket', () => {
  assert.deepEqual(startChoice(SEED, undefined), { material: 'alu', color: '#2B4677', plate: 'brass', mount: 'gasket' })
})

test('a saved case is kept while CAT-08 offers it; a retired part falls back', () => {
  assert.deepEqual(startChoice(SEED, { material: 'wood', color: '#f16b53', plate: 'pom', mount: 'tray' }), {
    material: 'wood',
    color: '#F16B53',
    plate: 'pom',
    mount: 'tray',
  })
  assert.deepEqual(startChoice(SEED, { material: 'carbon', color: '#123456', plate: 'steel', mount: 'leaf' }), {
    material: 'alu',
    color: '#2B4677',
    plate: 'brass',
    mount: 'gasket',
  })
  const bare: CaseOptions = { materials: [{ slug: 'resin', colors: ['#000000'] }], plates: [{ slug: 'cf' }], mounts: [{ slug: 'leaf' }] }
  assert.deepEqual(startChoice(bare, undefined), { material: 'resin', color: '#000000', plate: 'cf', mount: 'leaf' })
  assert.equal(startChoice({ materials: [], plates: [], mounts: [] }, undefined), null)
})

test('a new material keeps the colour when it offers it, else navy, else its first', () => {
  const options: CaseOptions = { ...SEED, materials: [...SEED.materials, { slug: 'steel', colors: ['#111111', '#222222'] }] }
  assert.equal(colorFor(options, 'wood', '#FFD24D'), '#FFD24D')
  assert.equal(colorFor(options, 'steel', '#FFD24D'), '#111111')
  assert.equal(colorFor({ ...SEED, materials: [{ slug: 'x', colors: ['#000000', '#2B4677'] }] }, 'x', '#FFFFFF'), '#2B4677')
})

test('colours, plates and mounts take the design names and drawings, with fallbacks', () => {
  assert.equal(colorName('#2b4677'), 'Navy blue')
  assert.equal(colorName('#123abc'), '#123ABC')
  assert.equal(plateFull('alu', 'Alu'), 'Aluminum')
  assert.equal(plateFull('brass', 'Brass'), 'Brass')
  assert.match(mountDrawing('gasket').caseD, /^M4 12/)
  assert.equal(mountDrawing('leaf'), mountDrawing('top-mount'))
})

test('the preview draws wood grain, frosted polycarbonate and a shaded plate', () => {
  assert.equal(caseBackground('#2B4677', 'alu'), '#2B4677')
  assert.equal(caseBackground('#2B4677', 'pc'), '#2B4677D9')
  assert.match(caseBackground('#2B4677', 'wood'), /^repeating-linear-gradient\(91deg, #[0-9a-f]{6} 0 6px, #2B4677 6px 14px\)$/)
  // Brass #A9873A at -55%, as the design's keyboard shades it.
  assert.equal(plateBackground('brass'), '#4c3d1a')
  assert.deepEqual(caseLook(undefined), { caseBg: undefined, plateBg: undefined })
  assert.deepEqual(caseLook({ material: 'alu', color: '#1C1F26', plate: 'brass' }), { caseBg: '#1C1F26', plateBg: '#4c3d1a' })
})

test('every builder page sends the saved case and set to BLD-10', () => {
  const parts = buildParts({ keycapSet: 'navy-sun', case: { material: 'wood', color: '#6B4A33', plate: 'pom', mount: 'gasket' } })
  assert.deepEqual(parts, { keycap_set: 'navy-sun', case_material: 'wood', plate: 'pom', mount: 'gasket' })
  assert.equal(
    recipeSearch({ switch: 'gateron-oil-king', mod: ['lube:light'], ...parts }),
    'switch=gateron-oil-king&mod=lube%3Alight&keycap_set=navy-sun&case_material=wood&plate=pom&mount=gasket',
  )
  assert.deepEqual(buildParts({}), { keycap_set: undefined, case_material: undefined, plate: undefined, mount: undefined })
})
