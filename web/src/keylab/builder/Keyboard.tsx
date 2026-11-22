import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { capInsets, type KeyColors, type Profile } from './keycaps.ts'
import './keyboard.css'

// The builder's keyboard preview, from Keyboard.dc.html: the 65% layout,
// flat view with the design's tilt, Cherry profile. Each key plays a press on
// pointer down and a release on pointer up, and the computer's own keyboard
// presses the matching key. Positions are inline styles set through the DOM
// (React's style prop), which the CSP allows; colours live in keyboard.css.

type Key = { x: number; y: number; w: number; label: string; code: string; group: 'alpha' | 'mod' | 'accent'; id: string }

const CODES: Record<string, string> = {
  '-': 'Minus', '=': 'Equal', '[': 'BracketLeft', ']': 'BracketRight', '\\': 'Backslash', ';': 'Semicolon',
  "'": 'Quote', ',': 'Comma', '.': 'Period', '/': 'Slash', Esc: 'Escape', Tab: 'Tab', Caps: 'CapsLock',
  Enter: 'Enter', Back: 'Backspace', Space: 'Space', Del: 'Delete', PgUp: 'PageUp', PgDn: 'PageDown',
  End: 'End', '←': 'ArrowLeft', '→': 'ArrowRight', '↑': 'ArrowUp', '↓': 'ArrowDown', Fn: 'Fn',
}

/** Keyboard.dc.html's 65% rows: label, then |width in units. */
const ROWS = [
  'Esc 1 2 3 4 5 6 7 8 9 0 - = Back|2 Del',
  'Tab|1.5 Q W E R T Y U I O P [ ] \\|1.5 PgUp',
  "Caps|1.75 A S D F G H J K L ; ' Enter|2.25 PgDn",
  'Shift|2.25 Z X C V B N M , . / Shift|1.75 ↑ End',
  'Ctrl|1.25 Win|1.25 Alt|1.25 Space|6.25 Alt Fn Ctrl ← ↓ →',
]
const UNITS_WIDE = 16
const UNITS_HIGH = 5

function layout(): Key[] {
  const keys: Key[] = []
  ROWS.forEach((row, y) => {
    let x = 0
    for (const token of row.split(' ')) {
      const [label, width] = token.split('|')
      const w = Number(width) || 1
      let code: string
      if (/^[A-Z]$/.test(label)) code = `Key${label}`
      else if (/^\d$/.test(label)) code = `Digit${label}`
      else if (['Shift', 'Ctrl', 'Alt', 'Win'].includes(label)) {
        code = ({ Shift: 'Shift', Ctrl: 'Control', Alt: 'Alt', Win: 'Meta' } as Record<string, string>)[label] + (x < 8 ? 'Left' : 'Right')
      } else code = CODES[label] ?? label
      const group = label === 'Esc' || label === 'Enter' ? 'accent' : label.length === 1 && !'←→↑↓'.includes(label) ? 'alpha' : 'mod'
      keys.push({ x, y, w, label, code, group, id: `${label}@${x},${y}` })
      x += w
    }
  })
  return keys
}

const KEYS = layout()

export type KeyboardHandle = {
  /** Presses a random letter key briefly, as the design does after a toggle. */
  ping: () => void
}

export type KeyboardProps = {
  /** Width in pixels; the height follows. */
  width: number
  onStroke: (stroke: 'press' | 'release') => void
  /** Listen to the computer's keyboard too (the page's main preview only). */
  typing?: boolean
  /** A keycap set's colours (US-06); the design's navy and mustard when left out. */
  colors?: KeyColors
  /** A keycap set's profile, which sets how much of each key the cap top covers. */
  profile?: Profile
  /** The case's face and the plate (US-07, caseParts.ts); the design's navy aluminum and brass when left out. */
  caseBg?: string
  plateBg?: string
}

const Keyboard = forwardRef<KeyboardHandle, KeyboardProps>(function Keyboard({ width, onStroke, typing = false, colors, profile, caseBg, plateBg }, ref) {
  const [pressed, setPressed] = useState<Record<string, boolean>>({})
  const u = width / (UNITS_WIDE + 1.1)
  const pad = u * 0.55
  const gap = Math.max(1.4, u * 0.055)
  const shadow = Math.max(1.5, u * 0.07) + (2.4 * u) / 160
  const caseH = UNITS_HIGH * u + pad * 2
  const perspective = width * 2
  const tilt = (22 * Math.PI) / 180
  const visibleH = (caseH * Math.cos(tilt) * perspective) / (perspective + caseH * Math.sin(tilt))

  // The keys held down, read synchronously so a release plays once per press.
  const held = useRef(new Set<string>())
  const down = useCallback(
    (id: string) => {
      if (held.current.has(id)) {
        return
      }
      held.current.add(id)
      setPressed((p) => ({ ...p, [id]: true }))
      onStroke('press')
    },
    [onStroke],
  )
  const up = useCallback(
    (id: string) => {
      if (!held.current.delete(id)) {
        return
      }
      setPressed((p) => {
        const next = { ...p }
        delete next[id]
        return next
      })
      onStroke('release')
    },
    [onStroke],
  )

  useImperativeHandle(ref, () => ({
    ping: () => {
      const letters = KEYS.filter((k) => /^[A-Z]$/.test(k.label))
      const key = letters[Math.floor(Math.random() * letters.length)]
      down(key.id)
      window.setTimeout(() => up(key.id), 95)
    },
  }), [down, up])

  useEffect(() => {
    if (!typing) {
      return
    }
    const target = (event: KeyboardEvent) => {
      const el = event.target as HTMLElement | null
      if (el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))) {
        return null
      }
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return null
      }
      return KEYS.find((k) => k.code === event.code) ?? null
    }
    const onDown = (event: KeyboardEvent) => {
      const key = target(event)
      if (!key || event.repeat) {
        return
      }
      // Space and arrows would scroll the page; Tab and Enter keep their jobs.
      if (key.code === 'Space' || key.code.startsWith('Arrow')) {
        event.preventDefault()
      }
      down(key.id)
    }
    const onUp = (event: KeyboardEvent) => {
      const key = target(event)
      if (key) {
        up(key.id)
      }
    }
    window.addEventListener('keydown', onDown)
    window.addEventListener('keyup', onUp)
    return () => {
      window.removeEventListener('keydown', onDown)
      window.removeEventListener('keyup', onUp)
    }
  }, [typing, down, up])

  const f1 = (v: number) => Math.round(v * 10) / 10
  const keys = KEYS
  const inset = capInsets(profile)
  // Colours as custom properties, read by keyboard.css.
  const palette: Record<string, string> = {}
  if (colors) {
    for (const group of ['alpha', 'mod', 'accent'] as const) {
      palette[`--kb-${group}-top`] = colors[group].top
      palette[`--kb-${group}-side`] = colors[group].side
      palette[`--kb-${group}-legend`] = colors[group].legend
    }
  }
  if (caseBg) palette['--kb-case'] = caseBg
  if (plateBg) palette['--kb-plate'] = plateBg

  return (
    <div
      className="kb"
      style={{ width, height: Math.round(visibleH + u * 0.9), ...palette }}
      data-testid="keyboard"
      data-profile={profile ?? 'cherry'}
      data-alpha={colors?.alpha.top}
      data-case={caseBg}
      data-plate={plateBg}
    >
      <div
        className="kb-tilt"
        style={{ top: f1(-(caseH - visibleH)), height: f1(caseH), transform: `perspective(${perspective}px) rotateX(22deg)` }}
      >
        <div className="kb-case" style={{ borderWidth: f1(Math.max(2, u * 0.085)), boxShadow: `${f1(u * 0.22)}px ${f1(u * 0.22)}px 0 #000` }} />
        <div className="kb-plate" style={{ left: f1(pad), top: f1(pad), width: f1(UNITS_WIDE * u), height: f1(UNITS_HIGH * u), borderRadius: f1(u * 0.12) }}>
          {keys.map((k) => {
            const isDown = !!pressed[k.id]
            const word = k.label.length > 1
            return (
              <button
                key={k.id}
                type="button"
                tabIndex={-1}
                aria-label={k.label === '\\' ? 'Backslash' : k.label}
                className={`kb-key ${k.group}${isDown ? ' down' : ''}`}
                style={{
                  left: f1(k.x * u),
                  top: f1(k.y * u),
                  width: f1(k.w * u - gap),
                  height: f1(u - gap),
                  borderWidth: f1(Math.max(1, u * 0.045)),
                  borderRadius: f1(0.12 * u * 0.45),
                  boxShadow: isDown ? 'none' : `${f1(shadow)}px ${f1(shadow)}px 0 #000`,
                  transform: isDown ? `translate(${f1(shadow)}px, ${f1(shadow)}px)` : 'none',
                }}
                onPointerDown={(e) => {
                  if (e.button > 0) return
                  down(k.id)
                }}
                onPointerUp={() => up(k.id)}
                onPointerLeave={() => up(k.id)}
              >
                <span
                  className="kb-top"
                  style={{
                    top: f1(inset.top * u),
                    left: f1(inset.side * u),
                    right: f1(inset.side * u),
                    bottom: f1(inset.bottom * u),
                    borderRadius: f1(0.1 * u * 0.4),
                    padding: f1(u * 0.08),
                    fontSize: f1(word ? u * 0.17 : u * 0.27),
                  }}
                >
                  {k.label === 'Space' ? '' : k.label}
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
})

// Memoized: the page re-renders on every toggle, the keyboard need not.
export default memo(Keyboard)
