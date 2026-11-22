import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'
import { getSwitch, listSwitches } from '../api/switches.ts'
import { loadBuild, saveBuild } from './buildState.ts'

export type BuildSwitch = { slug: string; name: string } | { error: string } | null

/** The build's switch: `?switch=`, else the one picked earlier, else the first recorded switch. */
export function useBuildSwitch(): BuildSwitch {
  const [params] = useSearchParams()
  const wanted = params.get('switch') ?? loadBuild().switch ?? ''
  const [source, setSource] = useState<BuildSwitch>(null)
  useEffect(() => {
    let active = true
    const pick = wanted
      ? getSwitch(wanted, 'sounds').then((sw) => ({ slug: sw.slug, name: sw.name }))
      : listSwitches({ sound: 'recorded', page_size: 1 }).then((page) => {
          const first = page.data[0]
          if (!first) {
            throw new Error('No recorded switch yet.')
          }
          return { slug: first.slug, name: first.name }
        })
    pick
      .then((sw) => {
        saveBuild({ switch: sw.slug })
        if (active) setSource(sw)
      })
      .catch(() => active && setSource({ error: 'This switch could not be loaded.' }))
    return () => {
      active = false
    }
  }, [wanted])
  return source
}
