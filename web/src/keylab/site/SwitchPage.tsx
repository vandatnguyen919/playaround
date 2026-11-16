import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { getSwitch, type SwitchDetail } from '../api/switches.ts'
import { toApiProblem, type ApiProblem } from '../api/problem.ts'
import ForceCurveChart from '../admin/switches/ForceCurveChart.tsx'
import { curveForm } from '../catalog/curveForm.ts'
import SwitchCard from '../catalog/SwitchCard.tsx'
import Waveform from '../catalog/Waveform.tsx'
import { profileLabel, typeLabel, validStem } from '../catalog/switchLook.ts'
import { useCardPlayer } from '../catalog/useCardPlayer.ts'
import {
  play,
  playLabel,
  playlist,
  recordingFor,
  recordingsLabel,
  stopSounds,
  STROKES,
  VARIANTS,
  variantsWithSound,
  type StrokeChoice,
  type Variant,
} from '../catalog/sounds.ts'

// The switch page (US-04): MktSwitch.dc.html and MktSwitchMobile.dc.html.
// One published switch from CAT-02 with its recordings and the "Sounds
// similar" four embedded; the player picks a stroke and a mod variant.

type Loaded = { state: 'loading' } | { state: 'error'; problem: ApiProblem } | { state: 'ready'; sw: SwitchDetail }

function useSwitch(slug: string): Loaded {
  const [held, setHeld] = useState<{ slug: string; loaded: Loaded }>({ slug: '', loaded: { state: 'loading' } })
  useEffect(() => {
    let active = true
    getSwitch(slug)
      .then((sw) => active && setHeld({ slug, loaded: { state: 'ready', sw } }))
      .catch((error: unknown) => active && setHeld({ slug, loaded: { state: 'error', problem: toApiProblem(error) } }))
    return () => {
      active = false
    }
  }, [slug])
  return held.slug === slug ? held.loaded : { state: 'loading' }
}

const mm = (value: number | undefined) => (value === undefined ? '–' : `${value.toFixed(1)} mm`)
const capital = (text: string | undefined) => (text ? text[0].toUpperCase() + text.slice(1) : '–')

/** The lede: CAT-02 has no description yet, so it says what the data says. */
function lede(sw: SwitchDetail): string {
  const word = sw.soundSummary?.word?.toLowerCase()
  return `A ${word ? `${word} ` : ''}${typeLabel(sw.type).toLowerCase()} switch${sw.brand ? ` by ${sw.brand}` : ''}.`
}

export default function SwitchPage() {
  const { slug = '' } = useParams()
  const loaded = useSwitch(slug)

  if (loaded.state === 'loading') {
    return (
      <section className="sp-hero" aria-busy="true">
        <div className="wrap sp-hero-in">
          <p className="mk-body">Loading switch…</p>
        </div>
      </section>
    )
  }
  if (loaded.state === 'error') {
    const missing = loaded.problem.status === 404
    return (
      <section className="sp-hero" aria-labelledby="sw-h">
        <div className="wrap sp-hero-in">
          <h1 id="sw-h" className="sp-h1">
            {missing ? 'Switch not found' : 'Something went wrong'}
          </h1>
          <p className="mk-body" role="alert">
            {missing ? 'This switch is not in the library.' : loaded.problem.userMessage}
          </p>
          <Link className="kc sp-alt" to="/keylab/library">
            All switches
          </Link>
        </div>
      </section>
    )
  }
  return <SwitchView key={loaded.sw.id} sw={loaded.sw} />
}

function SwitchView({ sw }: { sw: SwitchDetail }) {
  const sounds = sw.sounds ?? []
  const related = sw.related ?? []
  const available = variantsWithSound(sounds)
  const recorded = sw.soundStatus === 'recorded' && available.length > 0
  const [stroke, setStroke] = useState<StrokeChoice>('both')
  const [variant, setVariant] = useState<Variant>(available[0] ?? 'stock')
  const [playing, setPlaying] = useState(false)
  const [failed, setFailed] = useState(false)
  const cards = useCardPlayer()
  const profile = profileLabel(sw.profile)
  const stem = validStem(sw.stemColor)

  useEffect(() => stopSounds, [])

  function start(list: ReturnType<typeof playlist>) {
    setFailed(false)
    setPlaying(true)
    play(list)
      .catch(() => {
        stopSounds()
        setFailed(true)
      })
      .finally(() => setPlaying(false))
  }

  function pickVariant(next: Variant) {
    setVariant(next)
    start(playlist(sounds, next, stroke))
  }

  const strokes = (
    <div className="sp-pick d-only">
      <span id="st-h" className="mk-lbl">
        Stroke
      </span>
      <div role="radiogroup" aria-labelledby="st-h" className="sp-opts">
        {STROKES.map((o) => (
          <button key={o.value} type="button" role="radio" className="kc sm" aria-checked={stroke === o.value} onClick={() => setStroke(o.value)}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
  const variants = (
    <div className="sp-pick">
      <span id="mv-h" className="mk-lbl">
        Mod variant
      </span>
      <div role="radiogroup" aria-labelledby="mv-h" className="sp-opts variants">
        {VARIANTS.map((o) => {
          const has = available.includes(o.value)
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              className="kc sm"
              aria-checked={variant === o.value}
              aria-disabled={!has}
              title={has ? undefined : 'Not recorded yet'}
              onClick={() => has && pickVariant(o.value)}
            >
              {o.label}
            </button>
          )
        })}
      </div>
    </div>
  )
  const playButton = (
    <button
      type="button"
      className="kc sp-play"
      aria-disabled={!recorded}
      onClick={() => recorded && start(playlist(sounds, variant, stroke))}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M6 4v16l14-8z" />
      </svg>
      {recorded ? (
        <>
          <span className="d-only">{playLabel(stroke)}</span>
          <span className="m-only">Play press + release</span>
        </>
      ) : (
        'No sound yet'
      )}
    </button>
  )
  const build = `/keylab?switch=${encodeURIComponent(sw.slug)}`

  return (
    <>
      <section aria-labelledby="sw-h" className="sp-hero">
        <div className="wrap sp-hero-in">
          <nav aria-label="Breadcrumb" className="mk-crumb d-only">
            <Link to="/keylab">Home</Link>
            <span aria-hidden="true">/</span>
            <Link to="/keylab/library">Switch library</Link>
            <span aria-hidden="true">/</span>
            <span aria-current="page">{sw.name}</span>
          </nav>
          <Link className="sp-back m-only" to="/keylab/library">
            ← Switch library
          </Link>
          <div className="sp-top">
            <div className="sp-intro">
              <div className="sp-tags">
                <span className="sp-tag ink">{typeLabel(sw.type)}</span>
                {profile && <span className="sp-tag sky">{profile}</span>}
                <span className={`sbadge ${sw.soundStatus === 'recorded' ? 'published' : ''}`}>
                  <span aria-hidden="true" className="sbadge-dot" />
                  {sw.soundStatus === 'recorded' ? 'Recorded' : 'No sound yet'}
                </span>
              </div>
              <h1 id="sw-h" className="sp-h1">
                {sw.name.toUpperCase()}
              </h1>
              <p className="sp-lede">{lede(sw)}</p>
              <div className="sp-actions d-only">
                <Link className="kc sp-build" to={build}>
                  Use in a build
                </Link>
                <Link className="kc sp-alt" to="/keylab/switches">
                  Compare with others
                </Link>
              </div>
            </div>
            <div className="sp-player">
              <div className="sp-player-top">
                <div className="sp-card">
                  <SwitchCard
                    sw={sw}
                    noSound={!recorded}
                    playing={playing}
                    onPress={(s) => start(playlist(sounds, variant, s))}
                  />
                </div>
                <div className="sp-controls">
                  {strokes}
                  {variants}
                  <span className="d-only">{playButton}</span>
                </div>
              </div>
              <div className="sp-wave">
                <Waveform press={recordingFor(sounds, variant, 'press')} release={recordingFor(sounds, variant, 'release')} />
              </div>
              <span className="m-only">{playButton}</span>
              {failed && (
                <p className="sp-note" role="alert">
                  This sound could not be played.
                </p>
              )}
            </div>
          </div>
          <Link className="kc sp-build m-only" to={build}>
            Use in a build
          </Link>
        </div>
      </section>

      <section aria-labelledby="spec-h" className="sp-specs">
        <div className="wrap sp-specs-in">
          <div className="sp-curve">
            <h2 className="sp-h2">Force curve</h2>
            <ForceCurveChart form={curveForm(sw)} />
          </div>
          <div className="sp-table">
            <h2 id="spec-h" className="sp-h2">
              Specs
            </h2>
            <dl className="sp-dl">
              <dt>Type</dt>
              <dd>{typeLabel(sw.type)}</dd>
              <dt className="d-only">Actuation force</dt>
              <dd className="d-only">{sw.forceG === undefined ? '–' : `${sw.forceG} g`}</dd>
              <dt className="d-only">Actuation point</dt>
              <dd className="d-only">{mm(sw.actuationMm)}</dd>
              <dt className="m-only">Actuation</dt>
              <dd className="m-only">
                {sw.forceG === undefined ? '–' : `${sw.forceG} g`} · {mm(sw.actuationMm)}
              </dd>
              <dt>Total travel</dt>
              <dd>{mm(sw.travelMm)}</dd>
              <dt>Spring</dt>
              <dd>{sw.spring || '–'}</dd>
              <dt className="d-only">Stem</dt>
              <dd className="d-only">
                <span className="sp-stem">
                  <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
                    <rect x="1" y="1" width="12" height="12" fill={stem} stroke="#000" strokeWidth="2" />
                  </svg>
                  {sw.stemColor?.toUpperCase() ?? '–'}
                </span>
              </dd>
              <dt>Housing</dt>
              <dd>{capital(sw.housing)}</dd>
              <dt className="last">Recordings</dt>
              <dd className="last">{recordingsLabel(sounds)}</dd>
            </dl>
          </div>
        </div>
      </section>

      <section aria-labelledby="rel-h" className="sp-related">
        <div className="wrap sp-related-in">
          <div className="sp-related-head">
            <h2 id="rel-h" className="sp-h2 big">
              SOUNDS SIMILAR
            </h2>
            <Link className="kc d-only" to="/keylab/library">
              All switches
            </Link>
          </div>
          {related.length === 0 ? (
            <p className="mk-body">No similar switches yet.</p>
          ) : (
            <ul className="sp-rail" data-testid="related">
              {related.map((r) => (
                <li key={r.id}>
                  <SwitchCard
                    sw={r}
                    noSound={r.soundStatus !== 'recorded'}
                    playing={cards.playing === r.slug}
                    onPress={cards.onPress(r.slug)}
                  />
                  <Link className="lib-dl" to={`/keylab/library/${encodeURIComponent(r.slug)}`} aria-label={`${r.name} details`}>
                    Details<span aria-hidden="true">→</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </>
  )
}
