import { bars } from '../../catalog/sounds.ts'

// Waveform.dc.html for one stroke, drawn from the stored peaks: bars around a
// centre line, louder at the start as a keystroke decays.

export default function StrokeWave({
  peaks,
  color = '#2C2A5A',
  height = 48,
  label,
}: {
  peaks?: number[]
  color?: string
  height?: number
  label: string
}) {
  const count = 56
  const mid = height / 2
  const amp = mid - 3
  return (
    <svg width="100%" height={height} viewBox={`0 0 400 ${height}`} preserveAspectRatio="none" role="img" aria-label={label} className="sw-wave">
      <line x1="0" y1={mid} x2="400" y2={mid} stroke={color} strokeWidth="1.5" />
      {bars(peaks, count).map((v, i) => {
        const h = Math.max(1, v * amp)
        return <rect key={i} x={(i * 400) / count + 1} y={mid - h} width="3" height={h * 2} fill={color} />
      })}
    </svg>
  )
}
