import { useState } from 'react'
import ForceCurveChart from '../admin/switches/ForceCurveChart.tsx'
import type { SwitchSummary } from '../api/switches.ts'
import { COMPARE_MAX, compareSpec } from '../catalog/compare.ts'
import { curveForm } from '../catalog/curveForm.ts'
import { playInTurn, playlist, recordingFor } from '../catalog/sounds.ts'
import { validStem } from '../catalog/switchLook.ts'
import { useSwitchDetails } from '../catalog/useSwitchDetails.ts'
import Waveform from '../catalog/Waveform.tsx'

// The compare panel of SwitchesDesktop.dc.html (the right-hand aside) and
// SwitchesMobile.dc.html (the sheet above the tab bar): the picked switches'
// waveforms from their stored peaks, their force curves on desktop, and
// "Play in turn", which plays each stock press then release.

export default function ComparePanel({
  picked,
  cards,
  onClear,
}: {
  picked: string[]
  /** The library cards, for the name and specs before the details arrive. */
  cards: Map<string, SwitchSummary>
  onClear: () => void
}) {
  const detail = useSwitchDetails(picked)
  const [turn, setTurn] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  const rows = picked.map((slug) => {
    const d = detail(slug)
    const sw = typeof d === 'object' ? d : cards.get(slug)
    const sounds = typeof d === 'object' ? (d.sounds ?? []) : []
    return { slug, d, sw, sounds }
  })
  const ready = rows.length > 0 && rows.every((r) => typeof r.d === 'object')

  function playAll() {
    setFailed(false)
    const lists = rows.map((r) => playlist(r.sounds, 'stock', 'both'))
    playInTurn(lists, (i) => setTurn(i === null ? null : rows[i].slug)).catch(() => {
      setTurn(null)
      setFailed(true)
    })
  }

  return (
    <aside aria-label="Compare switches" className="cmp" data-testid="compare-panel">
      <div className="cmp-head">
        <h2 className="cmp-title">
          Compare{' '}
          <span className="sticker">
            {picked.length}/{COMPARE_MAX}
          </span>
        </h2>
        <button type="button" className="kc sm" onClick={onClear}>
          Clear
        </button>
      </div>
      {picked.length === 0 && (
        <p className="cmp-empty">
          <span className="sw-d">Pick up to 3 switches from the library to hear them back to back and compare their curves.</span>
          <span className="sw-m">Pick up to 3 switches above to hear them back to back.</span>
        </p>
      )}
      {rows.length > 0 && (
        <ul className="cmp-list">
          {rows.map(({ slug, d, sw, sounds }) => (
            <li key={slug} className={turn === slug ? 'cmp-row on' : 'cmp-row'} data-testid="compare-row">
              <div className="cmp-row-head">
                <span className="cmp-name">
                  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" className="cmp-stem">
                    <rect x="1" y="1" width="10" height="10" fill={validStem(sw?.stemColor)} stroke="#000" strokeWidth="2" />
                  </svg>
                  {sw?.name ?? slug}
                </span>
                {sw && <span className="mono cmp-spec">{compareSpec(sw)}</span>}
              </div>
              {d === 'loading' && <div className="cmp-wave-skel" aria-label="Loading waveform" role="img" />}
              {d === 'error' && <p className="cmp-err">This switch could not be loaded.</p>}
              {typeof d === 'object' && (
                <>
                  <Waveform press={recordingFor(sounds, 'stock', 'press')} release={recordingFor(sounds, 'stock', 'release')} height={34} labels={false} />
                  <div className="cmp-curve">
                    <ForceCurveChart form={curveForm(d)} />
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {failed && (
        <p className="cmp-err" role="alert">
          This sound could not be played.
        </p>
      )}
      <button type="button" className="kc primary" disabled={!ready} onClick={playAll}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M6 4v16l14-8z" />
        </svg>
        Play in turn
      </button>
    </aside>
  )
}
