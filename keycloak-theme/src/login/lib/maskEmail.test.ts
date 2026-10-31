import { test } from 'node:test'
import assert from 'node:assert/strict'
import { maskEmail, maskEmails } from './maskEmail.ts'

test('keeps the first 3 characters and the domain', () => {
  assert.equal(maskEmail('vandat@gmail.com'), 'van•••••@gmail.com')
})

test('uses a fixed-width mask whatever the local part length', () => {
  assert.equal(maskEmail('averyveryverylongname@example.com'), 'ave•••••@example.com')
})

test('short local parts keep at least one character hidden', () => {
  assert.equal(maskEmail('ab@x.io'), 'a•••••@x.io')
  assert.equal(maskEmail('a@x.io'), '•••••@x.io')
})

test('leaves text without a local part alone', () => {
  assert.equal(maskEmail('@x.io'), '@x.io')
  assert.equal(maskEmail('not an email'), 'not an email')
})

test('masks every address inside a message', () => {
  assert.equal(
    maskEmails('Sent to alice@example.com and bob.smith@test.org.'),
    'Sent to ali•••••@example.com and bob•••••@test.org.',
  )
})
