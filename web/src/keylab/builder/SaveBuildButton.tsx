import { useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { createBuild, updateBuild, type Build } from '../api/builds.ts'
import { listMods } from '../api/parts.ts'
import { SIGN_IN_URL, toApiProblem } from '../api/problem.ts'
import { useHealth } from '../api/useHealth.ts'
import { loadBuild, saveBuild } from './buildState.ts'
import { buildInput, defaultName, NO_NAMES, partsPatch, shortSpec } from './savedBuild.ts'
import './savedBuilds.css'

// "Save build" (KeycapsDesktop, KeycapsMobile; US-08). The first save makes a
// private build (BLD-02) named after its switch, with an Idempotency-Key that
// a retry after a failed call reuses, so a double click or a flaky network
// never saves two. Once saved, the button saves new parts to that same build
// (BLD-04, If-Match); "New build" on My builds starts another one. Then it
// opens My builds, where the build can be renamed.

export function BookmarkIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="square" strokeLinejoin="miter" aria-hidden="true">
      <path d="M6.5 3.5h11v17l-5.5-3.8-5.5 3.8z" />
    </svg>
  )
}

export default function SaveBuildButton({ switchName, className = '' }: { switchName?: string; className?: string }) {
  const health = useHealth()
  const navigate = useNavigate()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const idempotencyKey = useRef<string | null>(null)
  const signedIn = health.state === 'ok' && health.health.authenticated

  if (health.state === 'ok' && !signedIn) {
    // Guests sign in first; the build waits in this browser.
    return (
      <div className={`save-build ${className}`}>
        <a className="kc primary" href={SIGN_IN_URL}>
          <BookmarkIcon />
          Save build
        </a>
      </div>
    )
  }

  async function save() {
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      const state = loadBuild()
      if (!state.switch) {
        setError('Pick a switch first.')
        return
      }
      const mods = await listMods()
      let build: Build | null = null
      if (state.saved) {
        const input = buildInput(state, mods, state.saved.name)!
        try {
          build = await updateBuild(state.saved.id, partsPatch(input), state.saved.version)
        } catch (failure) {
          // Deleted since: save it as a new build.
          if (toApiProblem(failure).status !== 404) throw failure
        }
      }
      if (!build) {
        idempotencyKey.current ??= crypto.randomUUID()
        build = await createBuild(buildInput(state, mods, defaultName(switchName))!, idempotencyKey.current)
        idempotencyKey.current = null
      }
      const names = { ...NO_NAMES, switches: switchName && build.switch?.slug ? { [build.switch.slug]: { name: switchName } } : {} }
      saveBuild({ saved: { id: build.id, name: build.name, version: build.version ?? 1, spec: shortSpec(build, names) } })
      navigate('/keylab/builds', { state: { saved: build.id } })
    } catch (failure) {
      const problem = toApiProblem(failure)
      setError(problem.status === 412 ? 'This build changed somewhere else. Open My builds to see the latest.' : problem.userMessage)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={`save-build ${className}`}>
      <button type="button" className="kc primary" aria-disabled={saving} onClick={save} data-testid="save-build">
        <BookmarkIcon />
        {saving ? 'Saving…' : 'Save build'}
      </button>
      {error && (
        <p className="save-build-error" role="alert">
          {error} {error.includes('My builds') && <Link to="/keylab/builds">My builds</Link>}
        </p>
      )}
    </div>
  )
}
