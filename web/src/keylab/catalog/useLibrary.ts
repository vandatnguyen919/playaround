import { useEffect, useState } from 'react'
import { listSwitches, type LibraryQuery, type SwitchSummary } from '../api/switches.ts'
import { toApiProblem, type ApiProblem } from '../api/problem.ts'

// The switch library as both pages use it (US-02): filters from the URL,
// CAT-01 24 at a time, "show more" by cursor.

export const PAGE_SIZE = 24

export type ForceBucket = { value: string; label: string; min?: number; max?: number }

export type Results =
  | { state: 'loading' }
  | { state: 'error'; problem: ApiProblem }
  | { state: 'ready'; items: SwitchSummary[]; next: string | null; more: boolean }

export const FILTER_NAMES = ['type', 'profile', 'force', 'sound', 'q'] as const

/** The URL's filters as a CAT-01 query. Unknown force buckets are ignored. */
export function queryFrom(params: URLSearchParams, forces: ForceBucket[]): LibraryQuery {
  const force = forces.find((f) => f.value === params.get('force'))
  const q = (params.get('q') ?? '').trim()
  const sound = params.get('sound')
  return {
    type: params.get('type') || undefined,
    profile: params.get('profile') || undefined,
    sound: sound === 'recorded' || sound === 'missing' ? sound : undefined,
    q: q || undefined,
    force_min: force?.min,
    force_max: force?.max,
    page_size: PAGE_SIZE,
  }
}

export function isFiltered(params: URLSearchParams): boolean {
  return FILTER_NAMES.some((name) => (params.get(name) ?? '').trim() !== '')
}

/** "12 switches", "1 switch", "24+ switches" when there are more pages. */
export function countLabel(results: Results): string {
  if (results.state === 'loading') {
    return 'Loading switches…'
  }
  if (results.state === 'error') {
    return 'Switches'
  }
  const n = results.items.length
  return `${n}${results.next ? '+' : ''} ${n === 1 && !results.next ? 'switch' : 'switches'}`
}

export function useLibrary(query: LibraryQuery): { results: Results; showMore: () => Promise<void> } {
  const key = JSON.stringify(query)
  // Results remember the query they answer; a new query shows loading until its own arrive.
  const [held, setHeld] = useState<{ key: string; results: Results }>({ key: '', results: { state: 'loading' } })
  const results: Results = held.key === key ? held.results : { state: 'loading' }
  const setResults = (next: Results) => setHeld({ key, results: next })

  useEffect(() => {
    let active = true
    listSwitches(JSON.parse(key) as LibraryQuery)
      .then((page) => {
        if (active) {
          setHeld({ key, results: { state: 'ready', items: page.data, next: page.nextPageToken, more: false } })
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setHeld({ key, results: { state: 'error', problem: toApiProblem(error) } })
        }
      })
    return () => {
      active = false
    }
  }, [key])

  async function showMore() {
    if (results.state !== 'ready' || !results.next) {
      return
    }
    const before = results
    setResults({ ...before, more: true })
    try {
      const page = await listSwitches({ ...(JSON.parse(key) as LibraryQuery), page_token: before.next ?? undefined })
      setResults({ state: 'ready', items: [...before.items, ...page.data], next: page.nextPageToken, more: false })
    } catch (error) {
      setResults({ state: 'error', problem: toApiProblem(error) })
    }
  }

  return { results, showMore }
}

export type { SwitchSummary }
