import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { listSwitches, type LibraryQuery, type SwitchSummary } from '../api/switches.ts'
import { toApiProblem, type ApiProblem } from '../api/problem.ts'
import SwitchCard, { SwitchCardLoading } from '../catalog/SwitchCard.tsx'

// The public switch library (US-39, US-02): MktLibrary.dc.html and
// MktLibraryMobile.dc.html. Published switches from CAT-01, 24 at a time.
// Filters live in the URL, so a filtered library can be shared.

const TYPES = [
  { value: '', label: 'All' },
  { value: 'linear', label: 'Linear' },
  { value: 'tactile', label: 'Tactile' },
  { value: 'clicky', label: 'Clicky' },
  { value: 'silent', label: 'Silent' },
]

const PROFILES = [
  { value: 'deep', label: 'Deep' },
  { value: 'poppy', label: 'Poppy' },
  { value: 'clacky', label: 'Clacky' },
  { value: 'muted', label: 'Muted' },
]

// Force accepts one decimal place, so the buckets meet at 50.1 and 62.1.
const FORCES: { value: string; label: string; min?: number; max?: number }[] = [
  { value: 'light', label: '≤50g', max: 50 },
  { value: 'medium', label: '51–62g', min: 50.1, max: 62 },
  { value: 'heavy', label: '63g+', min: 62.1 },
]

const EXPLAIN = [
  { t: 'linear', label: 'Linear', h: 'Smooth all the way down', d: 'No bump and no click. Sound comes from the bottom-out, so case and keycaps shape it most.' },
  { t: 'tactile', label: 'Tactile', h: 'A bump you can feel', d: 'A small bump tells your finger the key has fired. Bump size and sound vary a lot by switch.' },
  { t: 'clicky', label: 'Clicky', h: 'A bump and a click', d: 'A click jacket or bar makes a sharp sound on every press. Loud by design.' },
  { t: 'silent', label: 'Silent', h: 'Dampened top and bottom', d: 'Rubber dampeners soften both strokes. Good for shared rooms and late nights.' },
]

const PAGE_SIZE = 24

type Results =
  | { state: 'loading' }
  | { state: 'error'; problem: ApiProblem }
  | { state: 'ready'; items: SwitchSummary[]; next: string | null; more: boolean }

export function queryFrom(params: URLSearchParams): LibraryQuery {
  const force = FORCES.find((f) => f.value === params.get('force'))
  const q = (params.get('q') ?? '').trim()
  return {
    type: params.get('type') || undefined,
    profile: params.get('profile') || undefined,
    q: q || undefined,
    force_min: force?.min,
    force_max: force?.max,
    page_size: PAGE_SIZE,
  }
}

export default function LibraryPage() {
  const [params, setParams] = useSearchParams()
  const [q, setQ] = useState(params.get('q') ?? '')
  const [results, setResults] = useState<Results>({ state: 'loading' })
  const type = params.get('type') ?? ''
  const profile = params.get('profile') ?? ''
  const force = params.get('force') ?? ''
  const filtered = Boolean(type || profile || force || (params.get('q') ?? '').trim())
  const key = params.toString()

  useEffect(() => {
    document.title = 'Switch library · KeyLab'
  }, [])

  // Typing waits a moment before it asks the API.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if ((params.get('q') ?? '') !== q) {
        set({ q })
      }
    }, 250)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q])

  useEffect(() => {
    let active = true
    setResults({ state: 'loading' })
    listSwitches(queryFrom(new URLSearchParams(key)))
      .then((page) => {
        if (active) {
          setResults({ state: 'ready', items: page.data, next: page.nextPageToken, more: false })
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setResults({ state: 'error', problem: toApiProblem(error) })
        }
      })
    return () => {
      active = false
    }
  }, [key])

  function set(changes: Record<string, string>) {
    const next = new URLSearchParams(params)
    for (const [name, value] of Object.entries(changes)) {
      if (value) {
        next.set(name, value)
      } else {
        next.delete(name)
      }
    }
    setParams(next, { replace: true })
  }

  function clear() {
    setQ('')
    setParams(new URLSearchParams(), { replace: true })
  }

  async function showMore() {
    if (results.state !== 'ready' || !results.next) {
      return
    }
    setResults({ ...results, more: true })
    try {
      const page = await listSwitches({ ...queryFrom(params), page_token: results.next })
      setResults({ state: 'ready', items: [...results.items, ...page.data], next: page.nextPageToken, more: false })
    } catch (error) {
      setResults({ state: 'error', problem: toApiProblem(error) })
    }
  }

  const count = results.state === 'ready' ? results.items.length : 0
  const countLabel =
    results.state === 'loading'
      ? 'Loading switches…'
      : results.state === 'error'
        ? 'Switches'
        : `${count}${results.next ? '+' : ''} ${count === 1 && !results.next ? 'switch' : 'switches'}`

  return (
    <main id="mk-main" className="mk-main" tabIndex={-1}>
      <section aria-labelledby="lib-h" className="mk-hero">
        <div className="wrap mk-hero-in">
          <nav aria-label="Breadcrumb" className="mk-crumb d-only">
            <Link to="/keylab">Home</Link>
            <span aria-hidden="true">/</span>
            <span aria-current="page">Switch library</span>
          </nav>
          <h1 id="lib-h" className="mk-h1">
            <span className="d-only">MECHANICAL </span>KEYBOARD SWITCHES, BY SOUND
          </h1>
          <p className="mk-body d-only">
            Compare linear, tactile, clicky and silent switches side by side. Every recorded switch plays its real press and release, with force, travel and a force curve.
          </p>
          <p className="mk-body m-only">Tap any card to hear its press and release.</p>
        </div>
      </section>

      <section aria-label="Filters" className="lib-filters">
        <div className="wrap lib-filters-in">
          <div className="lib-fg search">
            <label htmlFor="lib-q" className="mk-lbl">
              Search
            </label>
            <div className="lib-search">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="2.8" strokeLinecap="square" aria-hidden="true">
                <path d="M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM15.5 15.5L20 20" />
              </svg>
              <input id="lib-q" className="lib-field" type="search" placeholder="Name or brand" maxLength={60} value={q} onChange={(event) => setQ(event.target.value)} />
            </div>
          </div>
          <div className="lib-fg type">
            <span id="ty-h" className="mk-lbl">
              Type
            </span>
            <div role="group" aria-labelledby="ty-h" className="lib-chips">
              {TYPES.map((t) => (
                <button key={t.label} type="button" className="kc sm" aria-pressed={type === t.value} onClick={() => set({ type: t.value })}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <div className="lib-fg desktop-filter">
            <span id="pf-h" className="mk-lbl">
              Sound
            </span>
            <div role="group" aria-labelledby="pf-h" className="lib-chips">
              {PROFILES.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  className="kc sm ghost"
                  aria-pressed={profile === p.value}
                  onClick={() => set({ profile: profile === p.value ? '' : p.value })}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          <div className="lib-fg desktop-filter">
            <span id="fo-h" className="mk-lbl">
              Force
            </span>
            <div role="group" aria-labelledby="fo-h" className="lib-chips">
              {FORCES.map((f) => (
                <button
                  key={f.value}
                  type="button"
                  className="kc sm ghost"
                  aria-pressed={force === f.value}
                  onClick={() => set({ force: force === f.value ? '' : f.value })}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section aria-labelledby="res-h" className="lib-results">
        <div className="wrap lib-results-in">
          <div className="lib-head">
            <h2 id="res-h" className="mk-h2" aria-live="polite">
              {countLabel}
            </h2>
            {filtered && results.state === 'ready' && count > 0 && (
              <button type="button" className="kc sm" onClick={clear}>
                Clear filters
              </button>
            )}
          </div>

          {results.state === 'loading' && (
            <ul className="lib-grid" aria-busy="true">
              {Array.from({ length: 8 }, (_, i) => (
                <li key={i}>
                  <SwitchCardLoading />
                </li>
              ))}
            </ul>
          )}

          {results.state === 'error' && (
            <p className="lib-note" role="alert">
              {results.problem.userMessage}
            </p>
          )}

          {results.state === 'ready' && count > 0 && (
            <ul className="lib-grid" data-testid="library-grid">
              {results.items.map((sw) => (
                <li key={sw.id} data-testid="library-card">
                  <SwitchCard sw={sw} noSound={sw.soundStatus !== 'recorded'} />
                  <Link className="lib-dl" to={`/keylab/library/${encodeURIComponent(sw.slug)}`} aria-label={`${sw.name} details`}>
                    Details<span aria-hidden="true">→</span>
                  </Link>
                  {sw.isNew && <span className="mk-sticker lib-new">New</span>}
                </li>
              ))}
            </ul>
          )}

          {results.state === 'ready' && count === 0 && (
            <div className="lib-empty">
              <span aria-hidden="true" className="lib-empty-art" />
              <div className="lib-empty-text">
                <p className="lib-empty-title">{filtered ? 'No switches match these filters' : 'No switches yet'}</p>
                <p className="lib-empty-sub">{filtered ? 'Try another sound profile or force range.' : 'The first recorded switches arrive soon.'}</p>
              </div>
              {filtered && (
                <button type="button" className="kc" onClick={clear}>
                  Clear filters
                </button>
              )}
            </div>
          )}

          {results.state === 'ready' && results.next && (
            <button type="button" className="kc lib-more" disabled={results.more} aria-busy={results.more} onClick={() => void showMore()}>
              Show more switches
            </button>
          )}

          <Link className="kc primary lib-build-m" to="/keylab">
            Put one in a build
          </Link>
        </div>
      </section>

      <section aria-labelledby="types-h" className="lib-types">
        <div className="wrap lib-types-in">
          <h2 id="types-h" className="mk-h2">
            SWITCH TYPES, EXPLAINED
          </h2>
          <div className="lib-types-grid">
            {EXPLAIN.map((e) => (
              <article key={e.t} className="lib-type">
                <span className={`lib-type-tag ${e.t}`}>{e.label}</span>
                <h3>{e.h}</h3>
                <p>{e.d}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section aria-labelledby="cta-h" className="lib-cta">
        <div className="wrap lib-cta-in">
          <h2 id="cta-h" className="mk-h2">
            FOUND ONE YOU LIKE? PUT IT IN A BUILD.
          </h2>
          <Link className="kc primary" to="/keylab">
            Start building
          </Link>
        </div>
      </section>
    </main>
  )
}
