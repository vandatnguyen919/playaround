import axios from 'axios'
import { outageMessage, UNAVAILABLE } from '../../outage.ts'

// KeyLab errors are RFC 9457 problem+json with a stable `code`
// (docs/keylab/api-design-v1.md, Conventions). This turns any failed call into
// one ApiProblem the UI can switch on, whether keylab-api, the gateway or the
// network failed.

export const SIGN_IN_URL = '/oauth2/authorization/gateway'

export type FieldError = { pointer: string; code: string; message: string }

export class ApiProblem extends Error {
  readonly status: number
  readonly code: string
  readonly title: string
  readonly detail: string | undefined
  readonly errors: FieldError[]
  readonly retryAfterSeconds: number | undefined

  constructor(init: {
    status: number
    code: string
    title: string
    detail?: string
    errors?: FieldError[]
    retryAfterSeconds?: number
  }) {
    super(init.detail ?? init.title)
    this.name = 'ApiProblem'
    this.status = init.status
    this.code = init.code
    this.title = init.title
    this.detail = init.detail
    this.errors = init.errors ?? []
    this.retryAfterSeconds = init.retryAfterSeconds
  }

  /** The text to show the user: detail when there is one, else the title. */
  get userMessage(): string {
    return this.detail ?? this.title
  }

  /**
   * Field errors keyed for a form: "/links/website" becomes "links.website".
   * The first message per field wins.
   */
  get fieldErrors(): Record<string, string> {
    const byField: Record<string, string> = {}
    for (const error of this.errors) {
      const field = pointerToField(error.pointer)
      if (!(field in byField)) {
        byField[field] = error.message
      }
    }
    return byField
  }
}

/** JSON Pointer (RFC 6901) to a dotted field path. "" is the whole body. */
export function pointerToField(pointer: string): string {
  return pointer
    .split('/')
    .slice(1)
    .map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'))
    .join('.')
}

function isProblemBody(data: unknown): data is Record<string, unknown> {
  return (
    typeof data === 'object' &&
    data !== null &&
    typeof (data as Record<string, unknown>).code === 'string' &&
    typeof (data as Record<string, unknown>).status === 'number'
  )
}

function fieldErrorsOf(value: unknown): FieldError[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    .map((item) => ({
      pointer: typeof item.pointer === 'string' ? item.pointer : '',
      code: typeof item.code === 'string' ? item.code : 'invalid',
      message: typeof item.message === 'string' ? item.message : 'Check this field.',
    }))
}

function retryAfter(headers: unknown): number | undefined {
  const value = (headers as Record<string, unknown> | undefined)?.['retry-after']
  const seconds = typeof value === 'string' ? Number.parseInt(value, 10) : Number.NaN
  return Number.isFinite(seconds) ? seconds : undefined
}

/** Any error from a KeyLab call, as an ApiProblem. */
export function toApiProblem(error: unknown): ApiProblem {
  if (error instanceof ApiProblem) {
    return error
  }
  if (!axios.isAxiosError(error)) {
    return new ApiProblem({ status: 0, code: 'client_error', title: 'Something went wrong in the app' })
  }
  const response = error.response
  if (!response) {
    return new ApiProblem({
      status: 0,
      code: 'network_error',
      title: 'No connection',
      detail: 'Check your connection and try again.',
    })
  }
  const data = response.data
  if (isProblemBody(data)) {
    return new ApiProblem({
      status: data.status as number,
      code: data.code as string,
      title: typeof data.title === 'string' ? data.title : 'Something went wrong',
      detail: typeof data.detail === 'string' ? data.detail : undefined,
      errors: fieldErrorsOf(data.errors),
      retryAfterSeconds: retryAfter(response.headers),
    })
  }
  // Not problem+json: the gateway's own answers (401 with no body, Redis
  // down as JSON { error, message }) or a proxy in between.
  const outage = outageMessage(error)
  if (outage) {
    return new ApiProblem({
      status: response.status,
      code: 'api_unavailable',
      title: 'The service is temporarily unavailable',
      detail: outage === UNAVAILABLE ? undefined : outage,
      retryAfterSeconds: retryAfter(response.headers),
    })
  }
  if (response.status === 401) {
    return new ApiProblem({ status: 401, code: 'unauthenticated', title: 'Sign in to continue' })
  }
  if (response.status === 403) {
    return new ApiProblem({ status: 403, code: 'forbidden', title: 'You do not have access to this' })
  }
  return new ApiProblem({ status: response.status, code: 'unexpected', title: 'Something went wrong' })
}
