import { chartGeometry, type FormState } from './switchForm.ts'

// ForceCurve.dc.html, drawn from the editor's points instead of a model curve,
// so every change to the table shows at once.

const COLOR = '#F16B53'
const INK = '#2C2A5A'

export default function ForceCurveChart({ form }: { form: FormState }) {
  const g = chartGeometry(form)
  return (
    <div className="fc">
      {g === null ? (
        <p className="fc-empty">Add at least two points to draw the curve.</p>
      ) : (
        <svg width="100%" viewBox={`0 0 340 ${g.height}`} role="img" aria-label={g.aria} className="fc-svg">
          {g.grid.map((line) => (
            <g key={line.label}>
              <line x1="34" y1={line.y} x2="330" y2={line.y} stroke="currentColor" strokeOpacity=".3" strokeWidth="1" strokeDasharray="2 4" />
              <text x="28" y={line.y + 3} textAnchor="end" fontSize="9" fill="currentColor">
                {line.label}
              </text>
            </g>
          ))}
          <line x1="34" y1={g.base} x2="330" y2={g.base} stroke="currentColor" strokeWidth="2.5" />
          <line x1="34" y1="12" x2="34" y2={g.base} stroke="currentColor" strokeWidth="2.5" />
          {g.actuation && (
            <line x1={g.actuation.x} y1="12" x2={g.actuation.x} y2={g.base} stroke="currentColor" strokeWidth="1.5" strokeDasharray="4 3" />
          )}
          <path d={g.area} fill={COLOR} fillOpacity=".25" />
          {g.release && <path d={g.release} fill="none" stroke={INK} strokeWidth="2" strokeDasharray="5 4" strokeLinejoin="miter" />}
          <path d={g.press} fill="none" stroke="#000" strokeWidth="5" strokeLinejoin="miter" />
          <path d={g.press} fill="none" stroke={COLOR} strokeWidth="2.5" strokeLinejoin="miter" />
          {g.actuation && (
            <>
              <circle cx={g.actuation.x} cy={g.actuation.y} r="6" fill={COLOR} stroke="#000" strokeWidth="2.5" />
              <text x={g.actuation.labelX} y={g.actuation.labelY} fontSize="10" fontWeight="700" fill="currentColor" textAnchor={g.actuation.anchor}>
                {g.actuation.label}
              </text>
              <text x={g.actuation.x} y={g.base + 14} fontSize="9" fill="currentColor" textAnchor="middle">
                {g.actuation.mm}
              </text>
            </>
          )}
          <text x="34" y={g.base + 14} fontSize="9" fill="currentColor">
            0
          </text>
          <text x="330" y={g.base + 14} fontSize="9" fill="currentColor" textAnchor="end">
            {g.totalLabel}
          </text>
        </svg>
      )}
      <div className="fc-legend">
        <span className="fc-key">
          <span className="fc-press" />
          Press
        </span>
        <span className="fc-key">
          <span className="fc-release" />
          Release
        </span>
        <span className="fc-units">force (g) · travel (mm)</span>
      </div>
    </div>
  )
}
