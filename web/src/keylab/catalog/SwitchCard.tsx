import { useState } from 'react'
import './catalog.css'
import { crossOf, housingOf, specLine, typeLabel, validStem } from './switchLook.ts'

// SwitchCard.dc.html. A playable card is a button: press plays the
// downstroke, letting go plays the upstroke; a keyboard click plays both.
// Without sound it is a picture with "No sound yet". Colours that depend on
// the switch are SVG attributes, which the style-src CSP allows.

export type CardSwitch = {
  name: string
  type: string
  stemColor?: string
  housing?: string
  forceG?: number
  actuationMm?: number
  profile?: string
}

export default function SwitchCard(props: {
  sw: CardSwitch
  /** Specs only: draws "No sound yet" and does not play. */
  noSound: boolean
  playing?: boolean
  onPress?: (stroke: 'press' | 'release') => void
}) {
  const { sw, noSound } = props
  const [down, setDown] = useState(false)
  const stem = validStem(sw.stemColor)
  const label = typeLabel(sw.type)
  const aria = `${sw.name}, ${label}${sw.forceG !== undefined ? `, ${sw.forceG} grams` : ''}${noSound ? ', no sound available' : ''}`
  const hint = noSound ? 'Specs only' : down ? 'Let go: upstroke' : 'Tap or hold to hear'
  const top = (
    <span className="scard-top">
      <SwitchArt stem={stem} housing={sw.housing} />
      <span className={`scard-tag ${sw.type}`}>{label}</span>
      {props.playing && !noSound && (
        <span aria-hidden="true" className="scard-playing">
          <span />
          <span />
          <span />
          <span />
        </span>
      )}
      {noSound && (
        <span className="scard-nosound">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="square" aria-hidden="true">
            <path d="M4 9v6h4l5 4V5L8 9z" />
            <path d="M17 9l4 6M21 9l-4 6" />
          </svg>
          No sound yet
        </span>
      )}
    </span>
  )
  const body = (
    <span className="scard-body">
      <span className="scard-row">
        <span className="scard-name">{sw.name}</span>
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" className="scard-stem">
          <rect x="1" y="1" width="10" height="10" fill={stem} stroke="#000" strokeWidth="2" />
        </svg>
      </span>
      <span className="mono scard-spec">{specLine(sw)}</span>
      <span className="scard-hint">{hint}</span>
    </span>
  )

  if (noSound || !props.onPress) {
    return (
      <div className="scard" role="img" aria-label={aria}>
        {top}
        {body}
      </div>
    )
  }
  const onPress = props.onPress
  return (
    <button
      type="button"
      className={down ? 'scard down' : 'scard'}
      aria-label={aria}
      onPointerDown={(event) => {
        if (event.button > 0) {
          return
        }
        setDown(true)
        onPress('press')
      }}
      onPointerUp={() => {
        if (down) {
          setDown(false)
          onPress('release')
        }
      }}
      onPointerLeave={() => setDown(false)}
      onClick={(event) => {
        // A keyboard click (Enter or Space) has no pointer: play both strokes.
        if (event.detail === 0) {
          onPress('press')
          window.setTimeout(() => onPress('release'), 150)
        }
      }}
    >
      {top}
      {body}
    </button>
  )
}

export function SwitchCardLoading() {
  return (
    <div className="scard loading" aria-label="Loading switch" role="img">
      <div className="scard-top">
        <div className="scard-skel-art" />
      </div>
      <div className="scard-skel">
        <div className="scard-skel-l1" />
        <div className="scard-skel-l2" />
        <div className="scard-skel-l3" />
      </div>
    </div>
  )
}

/** The switch drawing: housing, stem and cross. */
export function SwitchArt({ stem, housing, size = 100 }: { stem: string; housing?: string; size?: number }) {
  const h = housingOf(housing)
  const slot = h.dark ? 'rgba(255,255,255,.2)' : 'rgba(0,0,0,.3)'
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" aria-hidden="true">
      <rect x="18" y="18" width="96" height="96" rx="10" fill="#000" />
      <rect x="7" y="46" width="8" height="28" rx="1" fill={h.edge} stroke="#000" strokeWidth="1.5" />
      <rect x="105" y="46" width="8" height="28" rx="1" fill={h.edge} stroke="#000" strokeWidth="1.5" />
      <rect x="12" y="12" width="96" height="96" rx="10" fill={h.bot} stroke="#000" strokeWidth="2.5" />
      <rect x="19" y="17" width="82" height="84" rx="7" fill={h.top} stroke={h.stroke} strokeWidth="1.2" />
      <rect x="54" y="18.5" width="12" height="5" rx="1" fill="#C98A55" stroke="#000" strokeWidth="1" />
      <rect x="33" y="88" width="22" height="6" rx="1" fill={slot} />
      <rect x="65" y="88" width="22" height="6" rx="1" fill={slot} />
      <rect x="45" y="45" width="30" height="30" rx="2" fill={stem} stroke="#000" strokeWidth="2" />
      <rect x="56" y="49" width="8" height="22" rx="1" fill={crossOf(stem)} />
      <rect x="49" y="56" width="22" height="8" rx="1" fill={crossOf(stem)} />
    </svg>
  )
}
