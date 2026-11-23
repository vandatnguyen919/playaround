import { useEffect, useMemo, useState } from 'react'
import type { Build } from '../api/builds.ts'
import { getCaseOptions, listKeycapSets, listMods } from '../api/parts.ts'
import { getSwitchOnce } from '../api/switches.ts'
import { NO_NAMES, type PartNames } from './savedBuild.ts'

// The catalog names a saved build's cards show (US-08). BLD-01 sends slugs;
// the mods, keycap sets and case options are one call each, and each switch
// one CAT-02 call, all cached for the page's life. A part the catalog no
// longer answers for keeps a name made from its slug.

let parts: Promise<Omit<PartNames, 'switches'>> | null = null

function loadParts(): Promise<Omit<PartNames, 'switches'>> {
  if (!parts) {
    parts = Promise.all([
      listMods().catch(() => []),
      listKeycapSets().catch(() => []),
      getCaseOptions().catch(() => null),
    ]).then(([mods, keycapSets, caseOptions]) => ({ mods, keycapSets, caseOptions }))
  }
  return parts
}

export function usePartNames(builds: Build[]): PartNames {
  const [base, setBase] = useState<Omit<PartNames, 'switches'>>(NO_NAMES)
  const [switches, setSwitches] = useState<PartNames['switches']>({})
  const slugs = useMemo(
    () => [...new Set(builds.map((b) => b.switch?.slug).filter((s): s is string => !!s))].sort().join(' '),
    [builds],
  )

  useEffect(() => {
    let active = true
    loadParts().then((p) => active && setBase(p))
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    let active = true
    for (const slug of slugs ? slugs.split(' ') : []) {
      getSwitchOnce(slug).then(
        (sw) =>
          active &&
          setSwitches((held) =>
            held[slug] ? held : { ...held, [slug]: { name: sw.name, type: sw.type, forceG: sw.forceG, stemColor: sw.stemColor } },
          ),
        () => undefined,
      )
    }
    return () => {
      active = false
    }
  }, [slugs])

  return useMemo(() => ({ ...base, switches }), [base, switches])
}
