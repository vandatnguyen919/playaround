import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AxiosError, AxiosHeaders } from 'axios'
import { outageMessage, UNAVAILABLE } from './outage.ts'

function failed(status: number, data?: unknown): AxiosError {
  const config = { headers: new AxiosHeaders() }
  return new AxiosError('failed', 'ERR_BAD_RESPONSE', config, null, {
    status,
    statusText: '',
    headers: {},
    config,
    data,
  })
}

test('shows the gateway message on 503 and 504', () => {
  assert.equal(outageMessage(failed(503, { message: 'Redis is down' })), 'Redis is down')
  assert.equal(outageMessage(failed(504, { message: 'The API is slow' })), 'The API is slow')
})

test('falls back to the generic text when the body has no message', () => {
  assert.equal(outageMessage(failed(502)), UNAVAILABLE)
  assert.equal(outageMessage(failed(503, { message: 42 })), UNAVAILABLE)
})

test('is not an outage for other statuses or non-axios errors', () => {
  assert.equal(outageMessage(failed(500, { message: 'boom' })), null)
  assert.equal(outageMessage(failed(401)), null)
  assert.equal(outageMessage(new Error('network')), null)
})
