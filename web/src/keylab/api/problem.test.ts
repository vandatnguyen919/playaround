import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AxiosError, AxiosHeaders } from 'axios'
import { ApiProblem, pointerToField, toApiProblem } from './problem.ts'
import { createKeylabClient, fillPath, toSearchParams } from './client.ts'

function failed(status: number, data?: unknown, headers: Record<string, string> = {}): AxiosError {
  const config = { headers: new AxiosHeaders() }
  return new AxiosError('failed', 'ERR_BAD_RESPONSE', config, null, {
    status,
    statusText: '',
    headers,
    config,
    data,
  })
}

test('reads a problem+json body with its stable code', () => {
  const problem = toApiProblem(
    failed(412, {
      type: 'https://keylab.app/problems/precondition-failed',
      title: 'Someone changed this first',
      status: 412,
      code: 'precondition_failed',
      detail: 'Reload to see the latest version.',
    }),
  )
  assert.ok(problem instanceof ApiProblem)
  assert.equal(problem.status, 412)
  assert.equal(problem.code, 'precondition_failed')
  assert.equal(problem.userMessage, 'Reload to see the latest version.')
})

test('maps 422 field errors from JSON Pointers to form fields', () => {
  const problem = toApiProblem(
    failed(422, {
      type: 'https://keylab.app/problems/validation',
      title: 'Some fields need a fix',
      status: 422,
      code: 'validation_failed',
      errors: [
        { pointer: '/username', code: 'username_taken', message: '@clackattack is taken. Try another.' },
        { pointer: '/links/website', code: 'invalid_url', message: 'Start with https:// and include a domain.' },
        { pointer: '/links/website', code: 'too_long', message: 'Second message for the same field.' },
      ],
    }),
  )
  assert.equal(problem.code, 'validation_failed')
  assert.equal(problem.errors.length, 3)
  assert.deepEqual(problem.fieldErrors, {
    username: '@clackattack is taken. Try another.',
    'links.website': 'Start with https:// and include a domain.',
  })
  assert.equal(problem.userMessage, 'Some fields need a fix')
})

test('pointers unescape ~1 and ~0', () => {
  assert.equal(pointerToField('/parts/a~1b/c~0d'), 'parts.a/b.c~d')
  assert.equal(pointerToField(''), '')
})

test('keeps Retry-After from the gateway fallback', () => {
  const problem = toApiProblem(
    failed(503, { title: 'The service is temporarily unavailable', status: 503, code: 'api_unavailable' }, {
      'retry-after': '15',
    }),
  )
  assert.equal(problem.code, 'api_unavailable')
  assert.equal(problem.retryAfterSeconds, 15)
})

test('turns the gateway outage JSON into api_unavailable with its message', () => {
  const problem = toApiProblem(failed(503, { error: 'session_store_unavailable', message: 'Redis is down' }))
  assert.equal(problem.code, 'api_unavailable')
  assert.equal(problem.userMessage, 'Redis is down')
})

test('a bare 401 from the gateway is unauthenticated', () => {
  const problem = toApiProblem(failed(401))
  assert.equal(problem.code, 'unauthenticated')
  assert.equal(problem.status, 401)
})

test('no response at all is a network error', () => {
  const config = { headers: new AxiosHeaders() }
  const problem = toApiProblem(new AxiosError('Network Error', 'ERR_NETWORK', config, null, undefined))
  assert.equal(problem.code, 'network_error')
  assert.equal(problem.status, 0)
})

test('the client sends 401 to sign in and rejects with the problem', async () => {
  let signIns = 0
  const http = createKeylabClient(() => {
    signIns += 1
  })
  http.defaults.adapter = async (config) => {
    throw new AxiosError('failed', 'ERR_BAD_REQUEST', config, null, {
      status: 401,
      statusText: '',
      headers: { 'content-type': 'application/problem+json' },
      config,
      data: { type: 'https://keylab.app/problems/unauthenticated', title: 'Sign in to continue', status: 401, code: 'unauthenticated' },
    })
  }
  await assert.rejects(http.get('/me'), (error) => error instanceof ApiProblem && error.code === 'unauthenticated')
  assert.equal(signIns, 1)
})

test('the client does not send other errors to sign in', async () => {
  let signIns = 0
  const http = createKeylabClient(() => {
    signIns += 1
  })
  http.defaults.adapter = async (config) => {
    throw new AxiosError('failed', 'ERR_BAD_REQUEST', config, null, {
      status: 404,
      statusText: '',
      headers: {},
      config,
      data: { title: 'Nothing here', status: 404, code: 'not_found' },
    })
  }
  await assert.rejects(http.get('/switches/nope'), (error) => error instanceof ApiProblem && error.code === 'not_found')
  assert.equal(signIns, 0)
})

test('the client sends requests to the BFF route with repeated parameters', async () => {
  let seen = ''
  const http = createKeylabClient(() => {})
  http.defaults.adapter = async (config) => {
    seen = http.getUri(config)
    return { status: 200, statusText: 'OK', headers: {}, config, data: {} }
  }
  await http.get('/switches', { params: { mod: ['foam', 'tape'], page_size: 24, q: undefined } })
  assert.equal(seen, '/bff/keylab/v1/switches?mod=foam&mod=tape&page_size=24')
})

test('fills path templates and encodes values', () => {
  assert.equal(fillPath('/switches/{slug}/sounds', { slug: 'milk yellow' }), '/switches/milk%20yellow/sounds')
  assert.throws(() => fillPath('/builds/{build_id}'), /build_id/)
  assert.equal(toSearchParams({ a: true, b: undefined }).toString(), 'a=true')
})
