import { useEffect, useState } from 'react'
import { get, type Health } from './client.ts'
import { ApiProblem, toApiProblem } from './problem.ts'

export type HealthState =
  | { state: 'loading' }
  | { state: 'ok'; health: Health }
  | { state: 'error'; problem: ApiProblem }

// One shared call per page load: the shell (profile slot) and the Build page
// both read it. GET /v1/health is public, so a guest never gets a 401 here.
let inFlight: Promise<HealthState> | null = null

function loadHealth(): Promise<HealthState> {
  inFlight ??= get('/health')
    .then((health): HealthState => ({ state: 'ok', health }))
    .catch((error: unknown): HealthState => ({ state: 'error', problem: toApiProblem(error) }))
  return inFlight
}

export function useHealth(): HealthState {
  const [state, setState] = useState<HealthState>({ state: 'loading' })
  useEffect(() => {
    let active = true
    loadHealth().then((next) => {
      if (active) {
        setState(next)
      }
    })
    return () => {
      active = false
    }
  }, [])
  return state
}
