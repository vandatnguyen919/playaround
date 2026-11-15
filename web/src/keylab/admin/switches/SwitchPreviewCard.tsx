import type { SwitchType } from './switchForm.ts'

// SwitchCard.dc.html as the library would show this switch: specs only until
// sounds exist, so it shows "No sound yet" and does not play. Colours that
// depend on the switch are SVG attributes, which the style-src CSP allows.

const HOUSING = { top: '#F3F0EA', bot: '#E4DED2', stroke: '#9E9583', edge: '#B8AF9E' }

function shade(hex: string, amount: number): string {
  const h = /^#[0-9a-f]{6}$/i.test(hex) ? hex.slice(1) : '888888'
  return (
    '#' +
    [0, 2, 4]
      .map((i) => {
        const c = parseInt(h.slice(i, i + 2), 16)
        const v = Math.round(amount < 0 ? c * (1 + amount) : c + (255 - c) * amount)
        return Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')
      })
      .join('')
  )
}

export default function SwitchPreviewCard(props: {
  name: string
  type: SwitchType
  typeLabel: string
  stem: string
  force: string
  act: string
  profile?: string
}) {
  const stem = /^#[0-9a-f]{6}$/i.test(props.stem.trim()) ? props.stem.trim() : '#888888'
  const h = stem.slice(1)
  const light = (parseInt(h.slice(0, 2), 16) + parseInt(h.slice(2, 4), 16) + parseInt(h.slice(4, 6), 16)) / 3 > 170
  const cross = light ? shade(stem, -0.25) : shade(stem, 0.32)
  // Numbers get their unit; anything else shows as typed until the API refuses it.
  const force = props.force.trim()
  const act = props.act.trim()
  const spec = [
    force === '' ? null : Number.isFinite(Number(force)) ? `${Number(force)}g` : force,
    act === '' ? null : Number.isFinite(Number(act)) ? `${Number(act).toFixed(1)}mm` : act,
    props.profile ? props.profile[0].toUpperCase() + props.profile.slice(1) : null,
  ]
    .filter(Boolean)
    .join(' · ')
  return (
    <div className="scard" role="img" aria-label={`${props.name}, ${props.typeLabel}${props.force.trim() ? `, ${props.force.trim()} grams` : ''}, no sound available`}>
      <span className="scard-top">
        <svg width="100" height="100" viewBox="0 0 120 120" aria-hidden="true">
          <rect x="18" y="18" width="96" height="96" rx="10" fill="#000" />
          <rect x="7" y="46" width="8" height="28" rx="1" fill={HOUSING.edge} stroke="#000" strokeWidth="1.5" />
          <rect x="105" y="46" width="8" height="28" rx="1" fill={HOUSING.edge} stroke="#000" strokeWidth="1.5" />
          <rect x="12" y="12" width="96" height="96" rx="10" fill={HOUSING.bot} stroke="#000" strokeWidth="2.5" />
          <rect x="19" y="17" width="82" height="84" rx="7" fill={HOUSING.top} stroke={HOUSING.stroke} strokeWidth="1.2" />
          <rect x="54" y="18.5" width="12" height="5" rx="1" fill="#C98A55" stroke="#000" strokeWidth="1" />
          <rect x="33" y="88" width="22" height="6" rx="1" fill="rgba(0,0,0,.3)" />
          <rect x="65" y="88" width="22" height="6" rx="1" fill="rgba(0,0,0,.3)" />
          <rect x="45" y="45" width="30" height="30" rx="2" fill={stem} stroke="#000" strokeWidth="2" />
          <rect x="56" y="49" width="8" height="22" rx="1" fill={cross} />
          <rect x="49" y="56" width="22" height="8" rx="1" fill={cross} />
        </svg>
        <span className={`scard-tag ${props.type}`}>{props.typeLabel}</span>
        <span className="scard-nosound">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="square" aria-hidden="true">
            <path d="M4 9v6h4l5 4V5L8 9z" />
            <path d="M17 9l4 6M21 9l-4 6" />
          </svg>
          No sound yet
        </span>
      </span>
      <span className="scard-body">
        <span className="scard-row">
          <span className="scard-name">{props.name}</span>
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" className="scard-stem">
            <rect x="1" y="1" width="10" height="10" fill={stem} stroke="#000" strokeWidth="2" />
          </svg>
        </span>
        <span className="mono scard-spec">{spec}</span>
        <span className="scard-hint">Specs only</span>
      </span>
    </div>
  )
}
