import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { cachedRecipe, getSoundRecipe, listMods, type Mod, type SoundRecipe } from '../api/parts.ts'
import { getSwitch, listSwitches } from '../api/switches.ts'
import { loadBuild, saveBuild } from '../builder/buildState.ts'
import Keyboard, { type KeyboardHandle } from '../builder/Keyboard.tsx'
import {
  applied,
  beforeAfter,
  cleanLevels,
  countLabel,
  levelLabel,
  meterTicks,
  meterX,
  modParams,
  shiftName,
  statusLabel,
  withLevel,
  type ModLevels,
} from '../builder/mods.ts'
import { playKey, playStroke, preload } from '../builder/recipePlayer.ts'
import './mods.css'

// US-05, the Mods workshop (ModsDesktop, ModsMobile): toggle a mod and every
// key pressed on the preview uses the new sound; Before / After on each card
// plays one key without and with that mod. Every sound is a BLD-10 recipe
// played through Web Audio; recipes for the current mix and stock are fetched
// at once, a card's Before and After when the pointer or focus reaches it, so
// a click plays from memory.

const PADS = [
  { id: 'sky', name: 'Sky', className: 'pad-sky' },
  { id: 'splash', name: 'Splash', className: 'pad-splash' },
  { id: 'grid', name: 'Grid', className: 'pad-grid' },
  { id: 'dots', name: 'Dots', className: 'pad-dots' },
  { id: 'stripes', name: 'Stripes', className: 'pad-stripes' },
  { id: 'checker', name: 'Checker', className: 'pad-checker' },
  { id: 'walnut', name: 'Walnut desk', className: 'pad-walnut' },
]

type Source = { slug: string; name: string } | { error: string } | null

/** The build's switch: `?switch=`, else the one picked earlier, else the first recorded switch. */
function useBuildSwitch(): Source {
  const [params] = useSearchParams()
  const wanted = params.get('switch') ?? loadBuild().switch ?? ''
  const [source, setSource] = useState<Source>(null)
  useEffect(() => {
    let active = true
    const pick = wanted
      ? getSwitch(wanted, 'sounds').then((sw) => ({ slug: sw.slug, name: sw.name }))
      : listSwitches({ sound: 'recorded', page_size: 1 }).then((page) => {
          const first = page.data[0]
          if (!first) {
            throw new Error('No recorded switch yet.')
          }
          return { slug: first.slug, name: first.name }
        })
    pick
      .then((sw) => {
        saveBuild({ switch: sw.slug })
        if (active) setSource(sw)
      })
      .catch(() => active && setSource({ error: 'This switch could not be loaded.' }))
    return () => {
      active = false
    }
  }, [wanted])
  return source
}

/** One recipe per mix, from BLD-10 (or memory). Null until the switch's first one arrives. */
function useRecipe(switchSlug: string | null, mods: Mod[] | null, levels: ModLevels): SoundRecipe | null {
  // The switch and mod values, in one string: the effect runs once per mix.
  const key = switchSlug && mods ? [switchSlug, ...modParams(mods, levels)].join('\n') : ''
  const [held, setHeld] = useState<{ key: string; recipe: SoundRecipe } | null>(null)
  useEffect(() => {
    if (!key) {
      return
    }
    const [slug, ...mod] = key.split('\n')
    let active = true
    getSoundRecipe({ switch: slug, mod })
      .then((recipe) => {
        preload(recipe)
        if (active) setHeld({ key, recipe })
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [key])
  // A mix heard before renders at once, without waiting for the effect.
  if (key) {
    const [slug, ...mod] = key.split('\n')
    const ready = cachedRecipe({ switch: slug, mod })
    if (ready) {
      return ready
    }
  }
  // While a new mix loads, the last one of the same switch stays, so the meter
  // never jumps back to the middle between two sounds.
  return held && switchSlug && held.key.split('\n')[0] === switchSlug ? held.recipe : null
}

export default function ModsPage() {
  const sw = useBuildSwitch()
  const switchSlug = sw && 'slug' in sw ? sw.slug : null
  const [mods, setMods] = useState<Mod[] | null>(null)
  const [modsError, setModsError] = useState(false)
  const [levels, setLevels] = useState<ModLevels>(() => loadBuild().mods ?? {})
  const [pad, setPad] = useState(0)
  const [padOpen, setPadOpen] = useState(false)
  const [playError, setPlayError] = useState<string | null>(null)
  const [preview, setPreview] = useState<SoundRecipe | null>(null)
  const keyboard = useRef<KeyboardHandle>(null)
  const pingTimer = useRef<number | undefined>(undefined)
  const previewTimer = useRef<number | undefined>(undefined)

  useEffect(() => {
    document.title = 'Mods workshop · KeyLab'
    let active = true
    listMods()
      .then((list) => {
        if (!active) return
        setMods(list)
        setLevels((now) => cleanLevels(list, now))
      })
      .catch(() => active && setModsError(true))
    return () => {
      active = false
      window.clearTimeout(pingTimer.current)
      window.clearTimeout(previewTimer.current)
    }
  }, [])

  useEffect(() => {
    if (mods) saveBuild({ mods: levels })
  }, [mods, levels])

  const current = useRecipe(switchSlug, mods, levels)
  const stock = useRecipe(switchSlug, mods, {})

  // A card's Before and After (which are also the mixes its toggle leads to),
  // fetched when the pointer or focus reaches the card, so a click plays at
  // once. Not all cards up front: the gateway allows a burst of 20 requests.
  const warm = useCallback(
    (mod: Mod) => {
      if (!switchSlug || !mods) return
      const { before, after } = beforeAfter(levels, mod)
      for (const mix of [before, after]) {
        getSoundRecipe({ switch: switchSlug, mod: modParams(mods, mix) }).then(preload, () => undefined)
      }
    },
    [switchSlug, mods, levels],
  )

  const play = useCallback((recipe: Promise<SoundRecipe> | SoundRecipe | null, flash = false) => {
    if (!recipe) return
    setPlayError(null)
    Promise.resolve(recipe)
      .then((r) => {
        if (flash) {
          // The meter shows the sound being played for a moment, as the design does.
          window.clearTimeout(previewTimer.current)
          setPreview(r)
          previewTimer.current = window.setTimeout(() => setPreview(null), 380)
        }
        return playKey(r)
      })
      .catch(() => setPlayError('This sound could not be played.'))
  }, [])

  const recipeFor = useCallback(
    (mix: ModLevels) => (switchSlug && mods ? getSoundRecipe({ switch: switchSlug, mod: modParams(mods, mix) }) : null),
    [switchSlug, mods],
  )

  // The keyboards keep one onStroke for the page's life and read the current
  // recipe from a ref, so a toggle does not re-render their 136 keys.
  const currentRef = useRef<SoundRecipe | null>(null)
  useEffect(() => {
    currentRef.current = current
  }, [current])
  const onStroke = useCallback((stroke: 'press' | 'release') => {
    const recipe = currentRef.current
    if (!recipe) return
    playStroke(recipe, stroke).catch(() => setPlayError('This sound could not be played.'))
  }, [])

  function change(next: ModLevels) {
    setLevels(next)
    // A short key press after each toggle, so the change is heard.
    window.clearTimeout(pingTimer.current)
    pingTimer.current = window.setTimeout(() => keyboard.current?.ping(), 60)
  }

  const shown = preview ?? current
  const position = shown?.meter.position ?? 0.5
  const word = shown?.meter.word ?? '…'
  const stockX = stock ? `${(meterX(stock.meter.position) * 100).toFixed(1)}%` : '50%'
  const ticks = useMemo(() => ({ desk: meterTicks(position, 40), phone: meterTicks(position, 24) }), [position])
  const on = mods ? applied(mods, levels) : []
  const padNow = PADS[pad]
  const switchName = sw && 'name' in sw ? sw.name : ''

  const meterBars = (list: typeof ticks.desk, small: boolean) => (
    <div
      role="meter"
      aria-label="Sound profile, from bright to deep"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(meterX(position) * 100)}
      aria-valuetext={word}
      className={small ? 'meter-bars sm' : 'meter-bars'}
      data-testid={small ? 'meter-phone' : 'meter'}
      data-position={position}
    >
      {list.map((t, i) => (
        <span key={i} className={`tick ${t.tone}`} style={{ height: small ? Math.round(t.height * 0.69) : t.height }} />
      ))}
      <span aria-hidden="true" className="meter-stock" style={{ left: stockX }} />
    </div>
  )

  return (
    <div className="mods">
      <div className="mods-head">
        <div className="mods-title">
          <h1 className="h1">Mods workshop</h1>
          <p className="mods-lede desk">
            Toggle a mod and every key you press uses the new sound. Before / After plays one key each way.
          </p>
          <p className="mods-lede phone">Hear every mod before you buy it.</p>
        </div>
        <div className="mods-actions">
          <button type="button" className="kc tall desk" onClick={() => change({})}>
            Reset to stock
          </button>
          <button type="button" className="kc sm phone" onClick={() => change({})}>
            Reset
          </button>
          <Link className="kc primary desk" to="/keylab/keycaps">
            Next: keycaps
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="square" aria-hidden="true">
              <path d="M4 12h15M13 6l6 6-6 6" />
            </svg>
          </Link>
        </div>
      </div>

      {sw && 'error' in sw && (
        <p className="page-note" role="alert">
          {sw.error} <Link to="/keylab/switches">Pick a switch</Link>
        </p>
      )}
      {modsError && (
        <p className="page-note" role="alert">
          The mods could not be loaded. Reload to try again.
        </p>
      )}
      {playError && (
        <p className="mods-error mono" role="status">
          {playError}
        </p>
      )}

      <div className="mods-top">
        <section aria-label="Preview on desk pad" className={`mods-stage ${padNow.className}`}>
          <span aria-hidden="true" className="stage-stitch" />
          <div className="padctl desk">
            {padOpen && (
              <div className="padtray" role="radiogroup" aria-label="Desk pad">
                {PADS.map((p, i) => (
                  <button
                    key={p.id}
                    type="button"
                    role="radio"
                    aria-checked={i === pad}
                    aria-label={p.name}
                    title={p.name}
                    className={`padsw ${p.className}`}
                    onClick={() => setPad(i)}
                  />
                ))}
              </div>
            )}
            <button
              type="button"
              className="padtog"
              aria-expanded={padOpen}
              aria-label={`Desk pad: ${padNow.name}`}
              title={`Desk pad · ${padNow.name}`}
              onClick={() => setPadOpen(!padOpen)}
            >
              <span aria-hidden="true" className={`padtog-sw ${padNow.className}`} />
              <span className="lbl">Pad</span>
              <svg className={padOpen ? 'open' : undefined} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="square" aria-hidden="true">
                <path d="M15 5l-7 7 7 7" />
              </svg>
            </button>
          </div>
          <div className="stage-board desk">
            <Keyboard ref={keyboard} width={660} onStroke={onStroke} typing />
          </div>
          <div className="stage-board phone">
            <Keyboard width={326} onStroke={onStroke} />
          </div>
          <div className="meter-box desk">
            <div className="meter-head">
              <span className="lbl">Sound meter</span>
              <span className="sticker meter-word" data-testid="meter-word">
                {word}
              </span>
            </div>
            {meterBars(ticks.desk, false)}
            <div className="meter-scale mono">
              <span>HIGHER · BRIGHTER</span>
              <span>| = STOCK</span>
              <span>DEEPER · MUTED</span>
            </div>
          </div>
          <div className="meter-box phone">
            <button
              type="button"
              className={`padsq ${padNow.className}`}
              onClick={() => setPad((pad + 1) % PADS.length)}
              aria-label={`Desk pad: ${padNow.name}. Tap for the next pad`}
              title={`Desk pad · ${padNow.name}`}
            >
              <span className="mono">PAD</span>
            </button>
            <div className="meter-col">
              <div className="meter-head">
                <span className="lbl">Sound meter</span>
                <span className="sticker meter-word">{word}</span>
              </div>
              {meterBars(ticks.phone, true)}
              <div className="meter-scale sm mono">
                <span>BRIGHT</span>
                <span>| = STOCK</span>
                <span>DEEP</span>
              </div>
            </div>
            <button type="button" className="kc icon coral" aria-label="Play current sound" onClick={() => play(current)}>
              <PlayIcon size={16} />
            </button>
          </div>
        </section>

        <section aria-labelledby="shift-h" className="shift desk">
          <h2 id="shift-h" className="shift-h">
            Sound shift
          </h2>
          <div className="shift-play">
            <button type="button" className="kc tall-play" onClick={() => play(stock, true)} data-testid="play-stock">
              <span className="lbl">Stock</span>
              <span className="play-row">
                <PlayIcon size={12} />
                Play
              </span>
            </button>
            <button type="button" className="kc coral tall-play" onClick={() => play(current, true)} data-testid="play-mods">
              <span className="lbl">With mods</span>
              <span className="play-row">
                <PlayIcon size={12} />
                Play
              </span>
            </button>
          </div>
          {on.length > 0 && (
            <ul className="shift-list">
              {on.map((m) => (
                <li key={m.slug}>
                  <span className="shift-name">{shiftName(m, levels[m.slug])}</span>
                  <span className="shift-impact mono">{m.impact}</span>
                </li>
              ))}
            </ul>
          )}
          {mods && on.length === 0 && <p className="shift-none">No mods yet. This is how the switch sounds out of the box.</p>}
        </section>
      </div>

      <section aria-labelledby="mods-h" className="mods-list">
        <div className="mods-list-head">
          <h2 id="mods-h" className="lbl" data-testid="mods-count">
            {mods ? countLabel(mods, levels) : 'Mods'}
          </h2>
          {switchName && <span className="mono mods-switch phone">{switchName.toUpperCase()} · 65%</span>}
        </div>
        <div className="mods-grid">
          {(mods ?? []).map((mod) => {
            const level = levels[mod.slug] ?? 0
            const { before, after } = beforeAfter(levels, mod)
            return (
              <ModCard
                key={mod.slug}
                mod={mod}
                level={level}
                onWarm={() => warm(mod)}
                onLevel={(i) => change(withLevel(levels, mod.slug, i))}
                onBefore={() => play(recipeFor(before), true)}
                onAfter={() => play(recipeFor(after), true)}
              />
            )
          })}
        </div>
        <Link className="kc primary phone mods-next" to="/keylab/keycaps">
          Next: customize keycaps
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="square" aria-hidden="true">
            <path d="M4 12h15M13 6l6 6-6 6" />
          </svg>
        </Link>
      </section>
    </div>
  )
}

/** ToggleCard.dc.html: a toggle switch, or level buttons; Before and After; the status. */
function ModCard({
  mod,
  level,
  onWarm,
  onLevel,
  onBefore,
  onAfter,
}: {
  mod: Mod
  level: number
  onWarm: () => void
  onLevel: (level: number) => void
  onBefore: () => void
  onAfter: () => void
}) {
  const levels = mod.levels && mod.levels.length > 0 ? mod.levels : null
  const on = level > 0
  return (
    <article
      className={on ? 'mod-card on' : 'mod-card'}
      data-testid={`mod-${mod.slug}`}
      onPointerEnter={onWarm}
      onFocus={onWarm}
    >
      <div className="mod-top">
        <div className="mod-text">
          <div className="mod-title-row">
            <h3 className="mod-title">{mod.name}</h3>
            {mod.impact && <span className="mod-impact mono">{mod.impact}</span>}
          </div>
          {mod.description && <p className="mod-desc">{mod.description}</p>}
        </div>
        {!levels && (
          <button type="button" role="switch" aria-checked={on} aria-label={mod.name} className="mod-switch" onClick={() => onLevel(on ? 0 : 1)}>
            <span aria-hidden="true" className="mod-track" />
            <span aria-hidden="true" className="mod-knob" />
          </button>
        )}
      </div>
      {levels && (
        <div role="radiogroup" aria-label={`${mod.name} amount`} className="mod-levels">
          {levels.map((name, i) => (
            <button key={name} type="button" role="radio" aria-checked={i === level} className="mod-level" onClick={() => onLevel(i)}>
              {levelLabel(name)}
            </button>
          ))}
        </div>
      )}
      <div className="mod-play">
        <button type="button" className="mod-btn" onClick={onBefore} aria-label={`Before: ${mod.name} off`}>
          <PlayIcon size={12} />
          Before
        </button>
        <button type="button" className="mod-btn after" onClick={onAfter} aria-label={`After: ${mod.name} on`}>
          <PlayIcon size={12} />
          After
        </button>
        <span className="mod-status" data-testid={`status-${mod.slug}`}>
          {statusLabel(mod, level)}
        </span>
      </div>
    </article>
  )
}

function PlayIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M6 4v16l14-8z" />
    </svg>
  )
}

