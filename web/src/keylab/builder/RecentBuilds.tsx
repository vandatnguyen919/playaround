import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { listMyBuilds, type Build } from '../api/builds.ts'
import { useHealth } from '../api/useHealth.ts'
import { BUILD_EVENT, loadBuild, type SavedRef } from './buildState.ts'
import { buildSpec, stemColor, tileColor, whenLabel } from './savedBuild.ts'
import { usePartNames } from './usePartNames.ts'
import './savedBuilds.css'

// Recent builds on the Build page (HomeDesktop; Main scrolls them sideways):
// the member's two last changed builds (BLD-01), each opening My builds.
// Guests and members with no saved build see nothing.

export default function RecentBuilds() {
  const health = useHealth()
  const signedIn = health.state === 'ok' && health.health.authenticated
  const [builds, setBuilds] = useState<Build[]>([])
  const names = usePartNames(builds)

  useEffect(() => {
    if (!signedIn) return
    let active = true
    listMyBuilds({ page_size: 2 }).then(
      (page) => active && setBuilds(page.data),
      () => undefined,
    )
    return () => {
      active = false
    }
  }, [signedIn])

  if (!signedIn || builds.length === 0) {
    return null
  }
  return (
    <section aria-labelledby="rec-h" className="recent" data-testid="recent-builds">
      <div className="recent-head">
        <h2 id="rec-h" className="lbl">
          Recent builds
        </h2>
        <Link className="recent-all" to="/keylab/builds">
          See all
        </Link>
      </div>
      <div className="recent-list">
        {builds.map((b) => (
          <Link key={b.id} className="recent-tile" to="/keylab/builds" state={{ select: b.id }}>
            <span aria-hidden="true" className="recent-swatch" style={{ background: tileColor(b, names) }}>
              <span className="recent-stem" style={{ background: stemColor(b, names) }} />
            </span>
            <span className="recent-text">
              <span className="recent-name">{b.name}</span>
              <span className="mono recent-spec">{buildSpec(b, names)}</span>
            </span>
            <span className="recent-when">{whenLabel(b.updatedAt ?? b.createdAt)}</span>
          </Link>
        ))}
      </div>
    </section>
  )
}

/** The sidebar's "Current build": the saved build the builder is on, kept in step with saves and renames. */
export function CurrentBuild() {
  const [saved, setSaved] = useState<SavedRef | undefined>(() => loadBuild().saved)
  useEffect(() => {
    const sync = () => setSaved(loadBuild().saved)
    window.addEventListener(BUILD_EVENT, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(BUILD_EVENT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])
  if (!saved) {
    return null
  }
  return (
    <div className="side-build" data-testid="current-build">
      <span className="lbl">Current build</span>
      <span className="side-build-name">{saved.name}</span>
      <span className="mono side-build-spec">{saved.spec}</span>
    </div>
  )
}
