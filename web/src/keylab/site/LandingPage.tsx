import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { listSwitches, type Recording, type SwitchSummary } from '../api/switches.ts'
import { toApiProblem, type ApiProblem } from '../api/problem.ts'
import { stripSpec } from '../catalog/compare.ts'
import { recordingFor } from '../catalog/sounds.ts'
import SwitchCard, { SwitchCardLoading } from '../catalog/SwitchCard.tsx'
import { useCardPlayer } from '../catalog/useCardPlayer.ts'
import Waveform from '../catalog/Waveform.tsx'
import './landing.css'

// The landing page (MktLanding.dc.html, MktLandingMobile.dc.html), so far
// the hero copy and the "Compare three switches" strip (US-03): three
// recorded switches from CAT-01, each with its press and release from CAT-03
// and a waveform drawn from the stored peaks. The hero keyboard and the
// other sections arrive with their own stories.

type Strip =
  | { state: 'loading' }
  | { state: 'error'; problem: ApiProblem }
  | { state: 'ready'; items: SwitchSummary[] }

function useStrip(): Strip {
  const [strip, setStrip] = useState<Strip>({ state: 'loading' })
  useEffect(() => {
    let active = true
    // Only recorded switches: one without sound has nothing to compare.
    listSwitches({ sound: 'recorded', sort: 'popular', page_size: 3 })
      .then((page) => active && setStrip({ state: 'ready', items: page.data }))
      .catch((error: unknown) => active && setStrip({ state: 'error', problem: toApiProblem(error) }))
    return () => {
      active = false
    }
  }, [])
  return strip
}

export default function LandingPage() {
  const strip = useStrip()
  const player = useCardPlayer()
  const [sounds, setSounds] = useState<Record<string, Recording[]>>({})
  const items = strip.state === 'ready' ? strip.items : []
  const slugs = items.map((sw) => sw.slug).join(',')

  useEffect(() => {
    document.title = 'KeyLab · Hear every switch before you buy one'
  }, [])

  const loadSounds = player.sounds
  useEffect(() => {
    for (const slug of slugs ? slugs.split(',') : []) {
      loadSounds(slug)
        .then((recordings) => setSounds((now) => ({ ...now, [slug]: recordings })))
        .catch(() => setSounds((now) => ({ ...now, [slug]: [] })))
    }
  }, [slugs, loadSounds])

  const first = items[0]

  return (
    <main id="mk-main" className="mk-main" tabIndex={-1}>
      <section aria-labelledby="hero-h" className="ld-hero">
        <div className="wrap ld-hero-in">
          <span className="mk-sticker ld-sky">Hear it before you buy it</span>
          <h1 id="hero-h" className="ld-h1">
            HEAR EVERY SWITCH BEFORE YOU BUY ONE.
          </h1>
          <p className="ld-body ld-lede">
            Build a mechanical keyboard in your browser, press its keys, and hear how each switch, mod and keycap changes the sound.
          </p>
          <div className="ld-ctas">
            <Link className="kc ld-primary" to="/keylab">
              Start building
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="square" aria-hidden="true">
                <path d="M4 12h15M13 6l6 6-6 6" />
              </svg>
            </Link>
            <button type="button" className="kc ld-big coral" disabled={!first} onClick={() => first && player.playBoth(first.slug)}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M6 4v16l14-8z" />
              </svg>
              Try the sound
            </button>
          </div>
          <p className="mono ld-note">NO SIGN-UP TO PLAY · HEADPHONES RECOMMENDED</p>
        </div>
      </section>

      <section aria-labelledby="cmp-h" className="ld-sec ld-cmp">
        <div className="wrap ld-sec-in">
          <div className="ld-sec-head">
            <h2 id="cmp-h" className="ld-h2">
              COMPARE THREE SWITCHES
            </h2>
            <p className="ld-body ld-cmp-sub">
              <span className="d-only">Press play on each, or tap the card itself. Same key, three sounds.</span>
              <span className="m-only">Swipe, press play, hear the difference.</span>
            </p>
          </div>

          {strip.state === 'loading' && (
            <ul className="ld-rail" aria-busy="true">
              {[0, 1, 2].map((i) => (
                <li key={i} className="ld-box">
                  <SwitchCardLoading />
                </li>
              ))}
            </ul>
          )}

          {strip.state === 'error' && (
            <p className="ld-body" role="alert">
              {strip.problem.userMessage}
            </p>
          )}

          {strip.state === 'ready' && items.length === 0 && <p className="ld-body">The first recorded switches arrive soon.</p>}

          {items.length > 0 && (
            <ul className="ld-rail" data-testid="compare-strip">
              {items.map((sw) => {
                const recs = sounds[sw.slug]
                return (
                  <li key={sw.id} className="ld-box" data-testid="compare-strip-item">
                    <SwitchCard sw={sw} noSound={false} playing={player.playing === sw.slug} onPress={player.onPress(sw.slug)} />
                    <div className="ld-play">
                      <button type="button" className="kc icon coral" aria-label={`Play ${sw.name}`} onClick={() => player.playBoth(sw.slug)}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                          <path d="M6 4v16l14-8z" />
                        </svg>
                      </button>
                      <span className="mono ld-spec">{stripSpec(sw)}</span>
                    </div>
                    {recs === undefined ? (
                      <div className="ld-wave-skel" role="img" aria-label="Loading waveform" />
                    ) : (
                      <>
                        <div className="d-only">
                          <Waveform press={recordingFor(recs, 'stock', 'press')} release={recordingFor(recs, 'stock', 'release')} height={64} />
                        </div>
                        <div className="m-only">
                          <Waveform press={recordingFor(recs, 'stock', 'press')} release={recordingFor(recs, 'stock', 'release')} height={40} labels={false} />
                        </div>
                      </>
                    )}
                    {player.failed === sw.slug && (
                      <p className="ld-err" role="alert">
                        This sound could not be played.
                      </p>
                    )}
                  </li>
                )
              })}
            </ul>
          )}

        </div>
      </section>
    </main>
  )
}
