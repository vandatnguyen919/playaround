import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import SwitchCard, { SwitchCardLoading } from '../catalog/SwitchCard.tsx'
import { togglePick } from '../catalog/compare.ts'
import ComparePanel from './ComparePanel.tsx'
import { countLabel, isFiltered, queryFrom, useLibrary, type ForceBucket } from '../catalog/useLibrary.ts'
import { useCardPlayer } from '../catalog/useCardPlayer.ts'
import type { SwitchSummary } from '../api/switches.ts'
import './switches.css'

// The switch library inside the app (US-02): the head, filter chips, grid and
// empty state of SwitchesDesktop.dc.html and SwitchesMobile.dc.html, and
// compare mode (US-03): pick up to three recorded switches and hear them in
// turn. The builder parts of those screens (keyboard preview, desk pad,
// "Apply to all", the selected-switch panel) arrive with their own stories;
// until then each card links to the switch page.

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

// The app screens draw these buckets (the public library has its own).
const FORCES: ForceBucket[] = [
  { value: 'light', label: '≤50g', max: 50 },
  { value: 'medium', label: '51–60g', min: 50.1, max: 60 },
  { value: 'heavy', label: '61g+', min: 60.1 },
]

export default function SwitchesPage() {
  const [params, setParams] = useSearchParams()
  const type = params.get('type') ?? ''
  const profile = params.get('profile') ?? ''
  const force = params.get('force') ?? ''
  const { results, showMore } = useLibrary(queryFrom(params, FORCES))
  const player = useCardPlayer()
  const [compare, setCompare] = useState(false)
  const [picked, setPicked] = useState<string[]>([])
  // Picked switches stay picked when a filter hides their card.
  const [seen, setSeen] = useState(new Map<string, SwitchSummary>())
  const items = results.state === 'ready' ? results.items : null
  const cards = useMemo(() => {
    const all = new Map(seen)
    items?.forEach((sw) => all.set(sw.slug, sw))
    return all
  }, [seen, items])

  function pick(sw: SwitchSummary) {
    setSeen((now) => new Map(now).set(sw.slug, sw))
    setPicked((now) => togglePick(now, sw.slug, sw.soundStatus === 'recorded'))
  }

  function set(name: string, value: string) {
    const next = new URLSearchParams(params)
    if (value) {
      next.set(name, value)
    } else {
      next.delete(name)
    }
    setParams(next, { replace: true })
  }

  return (
    <div className="sw-page">
      <div className="sw-col">
        <div className="sw-head">
          <div className="sw-head-text">
            <h1 className="h1">
              <span className="sw-d">Switch library</span>
              <span className="sw-m">Switches</span>
            </h1>
            <p className="sw-sub">
              <span className="sw-d">Click a card to hear it. Hold for the press, let go for the upstroke.</span>
              <span className="sw-m">Tap to hear. Hold = press, let go = release.</span>
            </p>
          </div>
          <button
            type="button"
            className="kc sw-cmp-btn"
            aria-pressed={compare}
            onClick={() => {
              setCompare(!compare)
              setPicked([])
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="square" aria-hidden="true">
              <rect x="3" y="4" width="7" height="16" />
              <rect x="14" y="4" width="7" height="16" />
            </svg>
            <span className="sw-d">Compare mode</span>
            <span className="sw-m">Compare</span>
          </button>
        </div>

        <div className="sw-filters">
          <div role="group" aria-label="Switch type" className="sw-chips">
            {TYPES.map((t) => (
              <button key={t.label} type="button" className="kc sm" aria-pressed={type === t.value} onClick={() => set('type', t.value)}>
                {t.label}
              </button>
            ))}
          </div>
          <span aria-hidden="true" className="sw-divider" />
          <div role="group" aria-label="Sound and force" className="sw-chips">
            {PROFILES.map((p) => (
              <button
                key={p.value}
                type="button"
                className="kc sm ghost"
                aria-pressed={profile === p.value}
                onClick={() => set('profile', profile === p.value ? '' : p.value)}
              >
                {p.label}
              </button>
            ))}
            {FORCES.map((f) => (
              <button
                key={f.value}
                type="button"
                className="kc sm ghost"
                aria-pressed={force === f.value}
                onClick={() => set('force', force === f.value ? '' : f.value)}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <h2 className="sr-only" aria-live="polite">
          {countLabel(results)}
        </h2>

        {results.state === 'loading' && (
          <ul className="sw-grid" aria-busy="true">
            {Array.from({ length: 8 }, (_, i) => (
              <li key={i}>
                <SwitchCardLoading />
              </li>
            ))}
          </ul>
        )}

        {results.state === 'error' && (
          <p className="page-note" role="alert">
            {results.problem.userMessage}
          </p>
        )}

        {results.state === 'ready' && results.items.length > 0 && (
          <ul className="sw-grid">
            {results.items.map((sw) => (
              <li key={sw.id} data-testid="app-library-card">
                <SwitchCard
                  sw={sw}
                  noSound={sw.soundStatus !== 'recorded'}
                  playing={player.playing === sw.slug}
                  onPress={player.onPress(sw.slug)}
                  compare={compare}
                  checked={picked.includes(sw.slug)}
                  onPick={() => pick(sw)}
                />
                <Link className="sw-dl" to={`/keylab/library/${encodeURIComponent(sw.slug)}`} aria-label={`${sw.name} details`}>
                  Details<span aria-hidden="true">→</span>
                </Link>
                {sw.isNew && <span className="sticker lime sw-new">New</span>}
              </li>
            ))}
          </ul>
        )}

        {results.state === 'ready' && results.items.length === 0 && (
          <div className="sw-empty">
            <p className="sw-empty-title">{isFiltered(params) ? 'No switches match these filters' : 'No switches yet'}</p>
            {isFiltered(params) && (
              <button type="button" className="kc sm on" onClick={() => setParams(new URLSearchParams(), { replace: true })}>
                Clear filters
              </button>
            )}
          </div>
        )}

        {results.state === 'ready' && results.next && (
          <button type="button" className="kc sw-more" disabled={results.more} aria-busy={results.more} onClick={() => void showMore()}>
            Show more switches
          </button>
        )}
      </div>
      {compare && <ComparePanel picked={picked} cards={cards} onClear={() => setPicked([])} />}
    </div>
  )
}
