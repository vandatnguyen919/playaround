import { useCallback, useEffect, useState, type KeyboardEvent } from 'react'
import { Link, useLocation } from 'react-router'
import { listMyBuilds, updateBuild, type Build } from '../api/builds.ts'
import { SIGN_IN_URL, toApiProblem } from '../api/problem.ts'
import { useHealth } from '../api/useHealth.ts'
import BuildCard from '../builder/BuildCard.tsx'
import { forgetSaved, loadBuild, saveBuild } from '../builder/buildState.ts'
import { buildSpec, NAME_MAX, nameError, shortSpec, stemColor, tileColor } from '../builder/savedBuild.ts'
import { usePartNames } from '../builder/usePartNames.ts'
import './builds.css'

// My builds (US-08): BuildsDesktop and BuildsMobile. Lists the member's
// public and private builds (BLD-01) and renames the picked one (BLD-04 with
// If-Match). A stale tag means the build changed elsewhere: the page asks to
// reload instead of overwriting it. The parts list (US-10), share card
// (US-11) and "Type on it" (US-14) come with their stories.

type Arrived = { saved?: string; select?: string } | null

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="square" aria-hidden="true">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  )
}

function PlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="square" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

function ChevronIcon() {
  return (
    <svg className="phone" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="square" aria-hidden="true">
      <path d="M9 5l7 7-7 7" />
    </svg>
  )
}

export default function BuildsPage() {
  const health = useHealth()
  const location = useLocation()
  const arrived = location.state as Arrived
  const [builds, setBuilds] = useState<Build[] | null>(null)
  const [next, setNext] = useState<string | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(arrived?.saved ?? arrived?.select ?? null)
  const [status, setStatus] = useState('')
  const names = usePartNames(builds ?? [])
  const signedIn = health.state === 'ok' && health.health.authenticated

  const load = useCallback(() => {
    return listMyBuilds({ page_size: 24 }).then(
      (page) => {
        setLoadError(false)
        setBuilds(page.data)
        setNext(page.nextPageToken)
        return page.data
      },
      () => {
        setLoadError(true)
        return null
      },
    )
  }, [])

  useEffect(() => {
    if (!signedIn) return
    let active = true
    load().then((data) => {
      if (!active || !data || !arrived?.saved) return
      const saved = data.find((b) => b.id === arrived.saved)
      if (saved) setStatus(`${saved.name} saved`)
    })
    return () => {
      active = false
    }
  }, [signedIn, load, arrived?.saved])

  function more() {
    if (!next) return
    listMyBuilds({ page_size: 24, page_token: next }).then(
      (page) => {
        setBuilds((held) => [...(held ?? []), ...page.data])
        setNext(page.nextPageToken)
      },
      () => setLoadError(true),
    )
  }

  const list = builds ?? []
  const selected = list.find((b) => b.id === selectedId) ?? list[0] ?? null

  function renamed(build: Build) {
    setBuilds((held) => (held ?? []).map((b) => (b.id === build.id ? build : b)))
    setStatus(`${build.name} saved`)
    const current = loadBuild().saved
    if (current?.id === build.id) {
      saveBuild({ saved: { id: build.id, name: build.name, version: build.version ?? current.version, spec: shortSpec(build, names) } })
    }
  }

  return (
    <div className="bld">
      <div className="bld-head">
        <div className="bld-title">
          <h1 className="h1">My builds</h1>
          <p role="status" className={status ? 'bld-status' : 'sr-only'} data-testid="builds-status">
            {status && <CheckIcon />}
            {status}
          </p>
        </div>
        <Link className="kc bld-new" to="/keylab" onClick={forgetSaved}>
          <PlusIcon />
          New build
        </Link>
      </div>

      {health.state === 'ok' && !signedIn && (
        <section className="card bld-guest">
          <p className="page-note">Sign in to see the builds you saved.</p>
          <a className="kc primary" href={SIGN_IN_URL}>
            Sign in
          </a>
        </section>
      )}
      {loadError && (
        <p className="page-note" role="alert">
          Your builds could not be loaded. Reload to try again.
        </p>
      )}
      {builds && builds.length === 0 && (
        <section className="card bld-guest" data-testid="builds-empty">
          <p className="page-note">No saved builds yet. Pick your parts, then press Save build.</p>
          <Link className="kc primary" to="/keylab/keycaps">
            Start a build
          </Link>
        </section>
      )}

      {selected && (
        <div className="bld-cols">
          <section aria-labelledby="saved-h" className="bld-list">
            <h2 id="saved-h" className="lbl">
              Saved builds<span className="desk"> · {list.length}</span>
            </h2>
            {list.map((b) => (
              <button
                key={b.id}
                type="button"
                className="tile bld-tile"
                aria-pressed={b.id === selected.id}
                data-testid={`build-${b.id}`}
                onClick={() => setSelectedId(b.id)}
              >
                <span aria-hidden="true" className="bld-swatch" style={{ background: tileColor(b, names) }}>
                  <span className="bld-stem" style={{ background: stemColor(b, names) }} />
                </span>
                <span className="bld-tile-text">
                  <span className="bld-tile-name">{b.name}</span>
                  <span className="mono bld-tile-spec">{buildSpec(b, names)}</span>
                </span>
                <ChevronIcon />
              </button>
            ))}
            {next && (
              <button type="button" className="kc" onClick={more}>
                Show more builds
              </button>
            )}
          </section>

          <section aria-label="Build summary" className="bld-summary">
            <NameField key={`${selected.id}:${selected.version}`} build={selected} onRenamed={renamed} onReload={load} />
            <div className="desk">
              <BuildCard build={selected} names={names} keyboardWidth={406} />
            </div>
            <div className="phone">
              <BuildCard build={selected} names={names} keyboardWidth={296} />
            </div>
          </section>
        </div>
      )}
    </div>
  )
}

/**
 * "Build name": renames on Enter or when the field loses focus; Escape puts
 * the name back. A stale If-Match (412) shows a reload prompt.
 */
function NameField({ build, onRenamed, onReload }: { build: Build; onRenamed: (b: Build) => void; onReload: () => Promise<unknown> }) {
  const [draft, setDraft] = useState(build.name)
  const [error, setError] = useState<string | null>(null)
  const [stale, setStale] = useState(false)
  const [saving, setSaving] = useState(false)

  async function commit() {
    if (saving || stale) return
    if (draft.trim() === build.name) {
      setDraft(build.name)
      setError(null)
      return
    }
    const invalid = nameError(draft)
    if (invalid) {
      setError(invalid)
      return
    }
    setSaving(true)
    setError(null)
    try {
      onRenamed(await updateBuild(build.id, { name: draft.trim() }, build.version))
    } catch (failure) {
      const problem = toApiProblem(failure)
      if (problem.status === 412) {
        setStale(true)
      } else if (problem.status === 404) {
        setError('This build is gone. Reload to see your builds.')
      } else {
        setError(problem.fieldErrors.name ?? problem.userMessage)
      }
    } finally {
      setSaving(false)
    }
  }

  function onKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault()
      void commit()
    } else if (event.key === 'Escape') {
      setDraft(build.name)
      setError(null)
    }
  }

  return (
    <div className="bld-name">
      <label htmlFor="bname" className="lbl">
        Build name
      </label>
      <input
        id="bname"
        className="field"
        type="text"
        value={draft}
        maxLength={NAME_MAX}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? 'bname-error' : undefined}
        disabled={stale}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={onKey}
      />
      {error && (
        <p id="bname-error" className="bld-field-error" role="alert">
          {error}
        </p>
      )}
      {stale && (
        <div className="bld-stale" role="alert" data-testid="builds-stale">
          <p>This build changed somewhere else, so your new name was not saved. Reload to get the latest version.</p>
          <button type="button" className="kc sm" onClick={() => void onReload()}>
            Reload
          </button>
        </div>
      )}
    </div>
  )
}
