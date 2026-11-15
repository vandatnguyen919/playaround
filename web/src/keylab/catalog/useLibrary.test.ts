import { test } from 'node:test'
import assert from 'node:assert/strict'
import { countLabel, isFiltered, queryFrom, type ForceBucket } from './useLibrary.ts'

const FORCES: ForceBucket[] = [
  { value: 'light', label: '≤50g', max: 50 },
  { value: 'medium', label: '51–62g', min: 50.1, max: 62 },
]

test('URL filters become a CAT-01 query of 24', () => {
  const q = queryFrom(new URLSearchParams('type=tactile&profile=poppy&force=medium&sound=recorded&q=%20coral%20'), FORCES)
  assert.deepEqual(q, {
    type: 'tactile',
    profile: 'poppy',
    sound: 'recorded',
    q: 'coral',
    force_min: 50.1,
    force_max: 62,
    page_size: 24,
  })
})

test('unknown or empty filters are left out', () => {
  const q = queryFrom(new URLSearchParams('type=&force=huge&sound=maybe&q=%20'), FORCES)
  assert.deepEqual(q, {
    type: undefined,
    profile: undefined,
    sound: undefined,
    q: undefined,
    force_min: undefined,
    force_max: undefined,
    page_size: 24,
  })
})

test('a page counts as filtered only when a filter has a value', () => {
  assert.equal(isFiltered(new URLSearchParams('')), false)
  assert.equal(isFiltered(new URLSearchParams('q=%20')), false)
  assert.equal(isFiltered(new URLSearchParams('profile=deep')), true)
})

test('the count says when more pages exist', () => {
  const sw = { id: '1', slug: 's', name: 'S', type: 'linear', soundStatus: 'recorded' } as const
  assert.equal(countLabel({ state: 'ready', items: [sw], next: null, more: false }), '1 switch')
  assert.equal(countLabel({ state: 'ready', items: [], next: null, more: false }), '0 switches')
  assert.equal(countLabel({ state: 'ready', items: [sw, sw], next: 'token', more: false }), '2+ switches')
  assert.equal(countLabel({ state: 'loading' }), 'Loading switches…')
})
