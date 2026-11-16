import { useEffect, useRef, useState } from 'react'
import { getSwitch, type SwitchDetail } from '../api/switches.ts'

// The compared switches' specs, force curves and recordings (CAT-02 with
// sounds), each loaded once for the page's life.

export type DetailState = SwitchDetail | 'loading' | 'error'

export function useSwitchDetails(slugs: string[]): (slug: string) => DetailState {
  const asked = useRef(new Set<string>())
  const [loaded, setLoaded] = useState<Record<string, SwitchDetail | 'error'>>({})
  const key = slugs.join(',')

  useEffect(() => {
    for (const slug of key ? key.split(',') : []) {
      if (asked.current.has(slug)) {
        continue
      }
      asked.current.add(slug)
      getSwitch(slug, 'sounds')
        .then((sw) => setLoaded((now) => ({ ...now, [slug]: sw })))
        .catch(() => {
          // Picking it again tries again.
          asked.current.delete(slug)
          setLoaded((now) => ({ ...now, [slug]: 'error' }))
        })
    }
  }, [key])

  return (slug) => loaded[slug] ?? 'loading'
}
