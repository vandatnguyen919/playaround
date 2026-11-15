import type { Recording } from '../api/switches.ts'
import { bars } from './sounds.ts'

// Waveform.dc.html: the press (ink) then the release (coral) on one dashed
// line, drawn from the recordings' peaks, with the total length on the right.

const INK = '#2C2A5A'
const CORAL = '#F16B53'
const BARS = 34

export default function Waveform({ press, release, height = 64 }: { press?: Recording; release?: Recording; height?: number }) {
  const mid = height / 2 - 6
  const amp = mid - 4
  const total = (press?.durationMs ?? 0) + (release?.durationMs ?? 0)
  const side = (peaks: number[] | undefined, x0: number, x1: number, color: string) =>
    bars(peaks, BARS).map((v, i) => {
      const x = x0 + ((x1 - x0) * i) / BARS
      // Louder at the start, as a keystroke decays.
      const h = Math.max(1.5, v * amp * (1 - (i / BARS) * 0.6))
      return <rect key={`${color}${i}`} x={x.toFixed(1)} y={(mid - h).toFixed(1)} width="2.6" height={(h * 2).toFixed(1)} fill={color} />
    })
  const label = press || release ? `Waveform, press then release${total ? `, ${total} milliseconds` : ''}` : 'No recording yet'
  return (
    <svg width="100%" viewBox={`0 0 480 ${height}`} role="img" aria-label={label} className="wave">
      <line x1="8" y1={mid} x2="472" y2={mid} stroke="#000" strokeWidth="1.5" strokeDasharray="3 3" />
      {side(press?.peaks, 60, 250, INK)}
      {side(release?.peaks, 280, 440, CORAL)}
      <text x="70" y={height - 2} fontSize="10" fill="#000">
        press
      </text>
      <text x="290" y={height - 2} fontSize="10" fill="#000">
        release
      </text>
      {total > 0 && (
        <text x="472" y={height - 2} fontSize="10" fill="#000" textAnchor="end">
          {total} ms
        </text>
      )}
    </svg>
  )
}
