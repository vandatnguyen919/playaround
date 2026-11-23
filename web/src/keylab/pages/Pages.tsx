import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { useHealth } from '../api/useHealth.ts'
import { getSwitch, type SwitchDetail } from '../api/switches.ts'
import SwitchCard from '../catalog/SwitchCard.tsx'
import { saveBuild } from '../builder/buildState.ts'
import RecentBuilds from '../builder/RecentBuilds.tsx'

// KL0 ships the shell only. Each page fills in with its user story
// (docs/keylab/user-stories.md); until then it shows its title.

function PageHead({ label, title }: { label: string; title: string }) {
  return (
    <div className="page-head">
      <span className="lbl">{label}</span>
      <h1 className="h1">{title}</h1>
    </div>
  )
}

export function Placeholder({ label, title }: { label: string; title: string }) {
  return (
    <>
      <PageHead label={label} title={title} />
      <p className="page-note mut">This page is not built yet.</p>
    </>
  )
}

export function BuildPage() {
  return (
    <>
      <div className="page-head">
        <span className="sticker lime">New build</span>
        <h1 className="h1">Start a build</h1>
      </div>
      <SelectedSwitch />
      <RecentBuilds />
      <ApiStatus />
    </>
  )
}

/**
 * The switch a build starts with, from "Use in a build" on a switch page
 * (`/keylab?switch=slug`, US-04). The rest of the builder comes with KL2.
 */
function SelectedSwitch() {
  const [params] = useSearchParams()
  const slug = params.get('switch') ?? ''
  const [held, setHeld] = useState<{ slug: string; sw: SwitchDetail | null }>({ slug: '', sw: null })
  useEffect(() => {
    if (!slug) {
      return
    }
    let active = true
    getSwitch(slug)
      .then((sw) => {
        // The builder's other pages (Mods, US-05) start from this switch.
        saveBuild({ switch: sw.slug })
        if (active) {
          setHeld({ slug, sw })
        }
      })
      .catch(() => active && setHeld({ slug, sw: null }))
    return () => {
      active = false
    }
  }, [slug])
  const sw = held.slug === slug ? held.sw : null
  if (!slug || !sw) {
    return null
  }
  return (
    <section className="card build-switch" aria-labelledby="build-switch-h" data-testid="build-switch">
      <h2 id="build-switch-h" className="lbl">
        Switch
      </h2>
      <div className="build-switch-row">
        <div className="build-switch-card">
          <SwitchCard sw={sw} noSound={sw.soundStatus !== 'recorded'} />
        </div>
        <div className="build-switch-text">
          <p className="build-switch-name">{sw.name}</p>
          <p className="mut">Selected for this build.</p>
          <Link className="kc sm" to="/keylab/switches">
            Change switch
          </Link>
        </div>
      </div>
    </section>
  )
}

/** keylab-api as seen through the BFF: GET /bff/keylab/v1/health. */
function ApiStatus() {
  const health = useHealth()
  return (
    <section className="card status-card" aria-labelledby="api-status-h">
      <h2 id="api-status-h" className="lbl">
        API status
      </h2>
      <div role="status" className="status-row" data-testid="api-status" data-state={health.state}>
        {health.state === 'loading' && <span className="mono status-line">Checking…</span>}
        {health.state === 'ok' && (
          <>
            <span className="sticker lime">Online</span>
            <span className="mono status-line">
              revision {health.health.revision} ·{' '}
              {health.health.authenticated
                ? `signed in · ${health.health.roles.join(', ') || 'no KeyLab role'}`
                : 'guest'}
            </span>
          </>
        )}
        {health.state === 'error' && (
          <>
            <span className="sticker coral">Offline</span>
            <span className="mono status-line">
              {health.problem.userMessage} ({health.problem.code})
            </span>
          </>
        )}
      </div>
    </section>
  )
}
