import axios, { type AxiosInstance } from 'axios'
import type { components, paths } from './schema'
import { SIGN_IN_URL, toApiProblem } from './problem.ts'

// keylab-api through the BFF: the browser sends the session cookie, the
// gateway relays the access token. Same cookie and XSRF setup as the
// playground client (App.tsx). Types come from schema.d.ts, generated from
// docs/keylab/openapi-v1.yaml (npm run gen:api).

export const API_BASE = '/bff/keylab/v1'

export type Schemas = components['schemas']
export type Health = Schemas['Health']

type JsonOk<Op> = Op extends { responses: { 200: { content: { 'application/json': infer Body } } } }
  ? Body
  : never

/** API paths that have a GET with a JSON 200 answer. */
export type GetPath = {
  [P in keyof paths]: paths[P] extends { get: infer Op } ? (JsonOk<Op> extends never ? never : P) : never
}[keyof paths]

export type GetResult<P extends GetPath> = paths[P] extends { get: infer Op } ? JsonOk<Op> : never

type Query = Record<string, string | number | boolean | Array<string | number> | undefined>

/** "/switches/{slug}" with { slug: "milk yellow" } becomes "/switches/milk%20yellow". */
export function fillPath(template: string, params: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (_, name: string) => {
    const value = params[name]
    if (value === undefined) {
      throw new Error(`Missing path parameter ${name} for ${template}`)
    }
    return encodeURIComponent(String(value))
  })
}

/**
 * Repeated singular parameters for several values (?mod=foam&mod=tape), as
 * the API naming rules ask, instead of Axios's default mod[]=.
 */
export function toSearchParams(query: Query = {}): URLSearchParams {
  const search = new URLSearchParams()
  for (const [name, value] of Object.entries(query)) {
    if (value === undefined) {
      continue
    }
    for (const item of Array.isArray(value) ? value : [value]) {
      search.append(name, String(item))
    }
  }
  return search
}

export function createKeylabClient(onUnauthorized: () => void): AxiosInstance {
  const http = axios.create({
    baseURL: API_BASE,
    withCredentials: true,
    xsrfCookieName: 'XSRF-TOKEN',
    xsrfHeaderName: 'X-XSRF-TOKEN',
    headers: { Accept: 'application/json, application/problem+json' },
    paramsSerializer: (params) => toSearchParams(params as Query).toString(),
  })
  http.interceptors.response.use(
    (response) => response,
    (error) => {
      const problem = toApiProblem(error)
      if (problem.status === 401) {
        onUnauthorized()
      }
      return Promise.reject(problem)
    },
  )
  return http
}

// 401 means the call needs a signed-in user: go to Keycloak through the
// gateway, which brings the user back to the app afterwards.
export const keylab = createKeylabClient(() => window.location.assign(SIGN_IN_URL))

export async function get<P extends GetPath>(
  path: P,
  options: { path?: Record<string, string | number>; query?: Query } = {},
): Promise<GetResult<P>> {
  const response = await keylab.get<GetResult<P>>(fillPath(path, options.path), { params: options.query })
  return response.data
}
