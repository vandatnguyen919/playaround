import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  bodyFromForm,
  chartGeometry,
  emptyForm,
  fieldErrorsFrom,
  formFromSwitch,
  formatMm,
  newRow,
  parseNumber,
  readiness,
  type FormState,
} from './switchForm.ts'

function coralPop(): FormState {
  return formFromSwitch({
    id: '0193f2c4-7a1e-7c5b-9d2e-4f8a1b3c5d6e',
    slug: 'coral-pop',
    name: 'Coral Pop',
    brand: 'Clack Works',
    type: 'tactile',
    stemColor: '#F16B53',
    forceG: 62,
    actuationMm: 2,
    travelMm: 3.8,
    spring: '18',
    status: 'draft',
    forceCurve: [
      { travelMm: 0, forceG: 0, stroke: 'press' },
      { travelMm: 0.4, forceG: 38, stroke: 'press' },
      { travelMm: 2, forceG: 62, stroke: 'press' },
      { travelMm: 3.8, forceG: 92, stroke: 'press' },
      { travelMm: 2, forceG: 55, stroke: 'release' },
    ],
  })
}

test('loads a switch into the form, millimetres with one decimal', () => {
  const form = coralPop()
  assert.equal(form.act, '2.0')
  assert.equal(form.total, '3.8')
  assert.equal(form.force, '62')
  assert.deepEqual(
    form.points.map((row) => [row.t, row.f]),
    [
      ['0.0', '0'],
      ['0.4', '38'],
      ['2.0', '62'],
      ['3.8', '92'],
    ],
  )
  assert.equal(form.release.length, 1)
  assert.equal(formatMm(0.45), '0.45')
})

test('sends every field it owns, null when empty, press points first and release kept', () => {
  const form = { ...coralPop(), brand: '  ', spring: '' }
  const body = bodyFromForm(form)
  assert.equal(body.brand, null)
  assert.equal(body.spring, null)
  assert.equal(body.forceG, 62)
  assert.equal(body.actuationMm, 2)
  assert.deepEqual(body.forceCurve.at(-1), { travelMm: 2, forceG: 55, stroke: 'release' })
  assert.deepEqual(body.forceCurve[1], { travelMm: 0.4, forceG: 38, stroke: 'press' })
})

test('a number that is not one goes as typed, so the API names the field', () => {
  assert.equal(parseNumber(' 62 '), 62)
  assert.equal(parseNumber('2,5'), 2.5)
  assert.equal(parseNumber(''), null)
  assert.equal(parseNumber('62g'), '62g')
})

test('422 pointers land on the field or the table row they name', () => {
  const form = coralPop()
  const { fields, other } = fieldErrorsFrom(
    [
      { pointer: '/name', message: 'Give the switch a name.' },
      { pointer: '/actuationMm', message: 'Must be less than the total travel.' },
      { pointer: '/forceCurve/1/travelMm', message: 'Another point already sits at 0.4 mm.' },
      { pointer: '/forceCurve/3/forceG', message: 'Between 0 and 250 g.' },
      { pointer: '/forceCurve/4/travelMm', message: 'Release point.' },
      { pointer: '/bottomOutG', message: 'Between 10 and 250 g.' },
    ],
    form,
  )
  assert.equal(fields.name, 'Give the switch a name.')
  assert.equal(fields.act, 'Must be less than the total travel.')
  assert.equal(fields[`point.${form.points[1].key}.t`], 'Another point already sits at 0.4 mm.')
  assert.equal(fields[`point.${form.points[3].key}.f`], 'Between 0 and 250 g.')
  assert.equal(fields.curve, 'Release point.')
  assert.deepEqual(other, ['Between 10 and 250 g.'])
})

test('ready checks: name and type, then specs with at least two complete points', () => {
  assert.deepEqual(readiness(emptyForm()), { nameOk: false, specsOk: false })
  assert.deepEqual(readiness(coralPop()), { nameOk: true, specsOk: true })
  assert.equal(readiness({ ...coralPop(), act: '4.0' }).specsOk, false)
  assert.equal(readiness({ ...coralPop(), points: [...coralPop().points, newRow('', '')] }).specsOk, false)
})

test('the chart follows the points as typed', () => {
  assert.equal(chartGeometry(emptyForm()), null)
  const form = coralPop()
  const before = chartGeometry(form)
  assert.ok(before)
  assert.match(before.press, /^M34\.0 158\.0 L/)
  assert.equal(before.actuation?.label, 'Actuation 62g')
  assert.equal(before.release, '')
  assert.equal(before.grid.at(-1)?.label, 100)

  // A point above 100 g raises the scale; editing a point moves the line.
  const edited = { ...form, points: form.points.map((row, i) => (i === 3 ? { ...row, f: '130' } : row)) }
  const after = chartGeometry(edited)
  assert.ok(after)
  assert.equal(after.grid.at(-1)?.label, 150)
  assert.notEqual(after.press, before.press)

  // Points typed out of order are drawn by travel.
  const shuffled = { ...form, points: [...form.points].reverse() }
  assert.equal(chartGeometry(shuffled)?.press, before.press)
})
