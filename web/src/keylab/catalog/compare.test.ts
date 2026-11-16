import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compareSpec, stripSpec, togglePick } from './compare.ts'

test('picks up to three switches, in the order picked', () => {
  let picked: string[] = []
  for (const slug of ['milk', 'peak', 'click']) {
    picked = togglePick(picked, slug, true)
  }
  assert.deepEqual(picked, ['milk', 'peak', 'click'])
  assert.deepEqual(togglePick(picked, 'hush', true), ['milk', 'peak', 'click'], 'a fourth is ignored')
  assert.deepEqual(togglePick(picked, 'peak', true), ['milk', 'click'], 'picking again unpicks')
})

test('a switch without a recording cannot be picked', () => {
  assert.deepEqual(togglePick([], 'proto', false), [])
  assert.deepEqual(togglePick(['milk'], 'proto', false), ['milk'])
  // One that lost its sound after being picked can still be taken out.
  assert.deepEqual(togglePick(['milk', 'proto'], 'proto', false), ['milk'])
})

test('spec lines as the screens draw them', () => {
  assert.equal(compareSpec({ type: 'linear', forceG: 50, actuationMm: 2 }), 'LINEAR · 50G')
  assert.equal(stripSpec({ type: 'tactile', forceG: 67, actuationMm: 2 }), 'TACTILE · 67G · 2.0MM')
  assert.equal(stripSpec({ type: 'clicky' }), 'CLICKY')
})
