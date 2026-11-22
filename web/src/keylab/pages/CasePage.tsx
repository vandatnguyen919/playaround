import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import { getCaseOptions, getKeycapSet, getSoundRecipe, listMods, type RecipeQuery, type SoundRecipe } from '../api/parts.ts'
import { loadBuild, saveBuild } from '../builder/buildState.ts'
import {
  caseBackground,
  colorFor,
  colorName,
  materialSample,
  mountDrawing,
  plateBackground,
  plateFull,
  plateHex,
  startChoice,
  type CaseChoice,
  type CaseOptions,
} from '../builder/caseParts.ts'
import Keyboard, { type KeyboardHandle } from '../builder/Keyboard.tsx'
import { keyColors } from '../builder/keycaps.ts'
import { cleanLevels, meterX, modParams } from '../builder/mods.ts'
import { PADS } from '../builder/pads.ts'
import { playStroke, preload } from '../builder/recipePlayer.ts'
import { useBuildSwitch } from '../builder/useBuildSwitch.ts'
import './mods.css'
import './case.css'

// US-07, Case & plate (CaseDesktop, CaseMobile): pick the case material,
// colour, plate and mount from CAT-08. The preview takes the case and plate,
// and a material, plate or mount pick fetches the sound recipe (BLD-10) with
// the whole build, moves the sound meter and plays one key. The colour only
// changes the look, as in the design. Every pick is kept in the build
// (keylab.build `case`, BuildParts.case) for saving in US-08.
//
// Not built here: the "Current build" sidebar card (no saved build yet).

type Part = 'material' | 'plate' | 'mount'

export default function CasePage() {
  const sw = useBuildSwitch()
  const switchSlug = sw && 'slug' in sw ? sw.slug : null
  const [options, setOptions] = useState<CaseOptions | null>(null)
  const [optionsError, setOptionsError] = useState(false)
  const [choice, setChoice] = useState<CaseChoice | null>(null)
  const [mod, setMod] = useState<string[] | null>(null)
  const [recipe, setRecipe] = useState<SoundRecipe | null>(null)
  const [playError, setPlayError] = useState<string | null>(null)
  const [pad, setPad] = useState(0)
  const [padOpen, setPadOpen] = useState(false)
  const [saved] = useState(() => loadBuild())
  const [keycaps, setKeycaps] = useState<ReturnType<typeof keyColors>>(undefined)
  const keyboard = useRef<KeyboardHandle>(null)
  const phoneKeyboard = useRef<KeyboardHandle>(null)
  const currentRef = useRef<SoundRecipe | null>(null)
  const shouldPlay = useRef(false)

  const ping = useCallback(() => {
    const board = window.matchMedia('(max-width: 767px)').matches ? phoneKeyboard : keyboard
    board.current?.ping()
  }, [])

  useEffect(() => {
    document.title = 'Case & plate · KeyLab'
    let active = true
    getCaseOptions()
      .then((o) => {
        if (!active) return
        setOptions(o)
        setChoice(startChoice(o, saved.case))
      })
      .catch(() => active && setOptionsError(true))
    return () => {
      active = false
    }
  }, [saved])

  // The build's mods (US-05) stay in every mix heard here.
  useEffect(() => {
    let active = true
    listMods()
      .then((list) => active && setMod(modParams(list, cleanLevels(list, saved.mods ?? {}))))
      .catch(() => active && setMod([]))
    return () => {
      active = false
    }
  }, [saved])

  // The build's keycap set (US-06) colours the keys here too.
  useEffect(() => {
    if (!saved.keycapSet) return
    let active = true
    getKeycapSet(saved.keycapSet)
      .then((set) => active && setKeycaps(keyColors(set.colors)))
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [saved])

  useEffect(() => {
    if (choice) saveBuild({ case: choice })
  }, [choice])

  const query = useCallback(
    (c: CaseChoice | null): RecipeQuery | null =>
      switchSlug && mod && c
        ? { switch: switchSlug, mod, keycap_set: saved.keycapSet, case_material: c.material, plate: c.plate, mount: c.mount }
        : null,
    [switchSlug, mod, saved],
  )

  // The recipe of the chosen parts: fetched and preloaded on load; after a
  // pick it plays one key once it is here.
  // A colour pick asks again too, but the same parts answer from memory at once.
  const q = useMemo(() => query(choice), [query, choice])
  useEffect(() => {
    if (!q) return
    let active = true
    getSoundRecipe(q)
      .then((r) => {
        preload(r)
        if (!active) return
        setRecipe(r)
        currentRef.current = r
        if (shouldPlay.current) {
          shouldPlay.current = false
          ping()
        }
      })
      .catch(() => active && setPlayError('This sound could not be played.'))
    return () => {
      active = false
    }
  }, [q, ping])

  const onStroke = useCallback((stroke: 'press' | 'release') => {
    const r = currentRef.current
    if (!r) return
    playStroke(r, stroke).catch(() => setPlayError('This sound could not be played.'))
  }, [])

  function pick(part: Part, slug: string) {
    if (!choice || !options) return
    setPlayError(null)
    if (choice[part] === slug) {
      // Same part: play it again, no new request.
      if (recipe) ping()
      return
    }
    shouldPlay.current = true
    const next = { ...choice, [part]: slug }
    if (part === 'material') next.color = colorFor(options, slug, choice.color)
    setChoice(next)
  }

  /** A tile reached by pointer or focus fetches its recipe, so its pick plays at once. */
  function warm(part: Part, slug: string) {
    const w = choice && query({ ...choice, [part]: slug })
    if (w) getSoundRecipe(w).then(preload, () => undefined)
  }

  const look = useMemo(
    () => (choice ? { caseBg: caseBackground(choice.color, choice.material), plateBg: plateBackground(choice.plate) } : {}),
    [choice],
  )

  const padNow = PADS[pad]
  const materials = options?.materials ?? []
  const plates = options?.plates ?? []
  const mounts = options?.mounts ?? []
  const material = materials.find((m) => m.slug === choice?.material)
  const plate = plates.find((p) => p.slug === choice?.plate)
  const mount = mounts.find((m) => m.slug === choice?.mount)
  const colorLabel = choice ? colorName(choice.color) : '…'
  const word = recipe?.meter.word ?? '…'
  const dotX = `${((recipe ? meterX(recipe.meter.position) : 0.5) * 100).toFixed(1)}%`

  const meter = (small: boolean) => (
    <div className={small ? 'cse-meter sm' : 'cse-meter'}>
      <div className="cse-meter-head">
        <span className="lbl">Sound</span>
        <span className="sticker cse-word" data-testid={small ? undefined : 'case-word'}>
          {word}
        </span>
      </div>
      <div
        role="meter"
        aria-label="Sound, bright to deep"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round((recipe ? meterX(recipe.meter.position) : 0.5) * 100)}
        aria-valuetext={word}
        className="cse-track"
        data-testid={small ? undefined : 'case-meter'}
        data-position={recipe?.meter.position}
      >
        <Dot left={dotX} />
      </div>
      <div className="mono cse-scale">
        {small ? (
          <>
            <span>BRIGHT</span>
            <span>DEEP</span>
          </>
        ) : (
          <>
            <span>HIGHER · BRIGHTER</span>
            <span>DEEPER · MUTED</span>
          </>
        )}
      </div>
    </div>
  )

  const playLink = (
    <Link className="kc primary" to="/keylab/playground">
      Hear it in the playground
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="square" aria-hidden="true">
        <path d="M4 12h15M13 6l6 6-6 6" />
      </svg>
    </Link>
  )

  return (
    <div className="cse">
      <div className="cse-head">
        <div className="cse-title">
          <h1 className="h1">Case &amp; plate</h1>
          <p className="cse-sub desk">What holds the switches shapes the sound as much as the switches do.</p>
        </div>
        <span className="desk">{playLink}</span>
      </div>

      {sw && 'error' in sw && (
        <p className="page-note" role="alert">
          {sw.error} <Link to="/keylab/switches">Pick a switch</Link>
        </p>
      )}
      {optionsError && (
        <p className="page-note" role="alert">
          The case options could not be loaded. Reload to try again.
        </p>
      )}
      {options && !choice && <p className="page-note">No case options yet.</p>}
      {playError && (
        <p className="mods-error mono" role="status">
          {playError}
        </p>
      )}

      <div className="cse-grid">
        <section aria-label="Preview on desk pad" className={`cse-stage ${padNow.className}`}>
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
            <Keyboard ref={keyboard} width={680} onStroke={onStroke} typing colors={keycaps} {...look} />
          </div>
          <div className="stage-board phone">
            <Keyboard ref={phoneKeyboard} width={326} onStroke={onStroke} colors={keycaps} {...look} />
          </div>
          <div className="cse-meter-box desk">{meter(false)}</div>
          <div className="cse-meter-box phone">
            <button
              type="button"
              className={`padsq ${padNow.className}`}
              onClick={() => setPad((pad + 1) % PADS.length)}
              aria-label={`Desk pad: ${padNow.name}. Tap for the next pad`}
              title={`Desk pad · ${padNow.name}`}
            >
              <span className="mono">PAD</span>
            </button>
            {meter(true)}
          </div>
          <dl className="cse-picked desk" data-testid="case-picked">
            <div>
              <dt className="lbl">Case</dt>
              <dd>{material?.name ?? '…'}</dd>
            </div>
            <div>
              <dt className="lbl">Color</dt>
              <dd>{colorLabel}</dd>
            </div>
            <div>
              <dt className="lbl">Plate</dt>
              <dd>{plate?.slug ? plateFull(plate.slug, plate.name ?? '') : '…'}</dd>
            </div>
            <div>
              <dt className="lbl">Mount</dt>
              <dd>{mount?.name ?? '…'}</dd>
            </div>
          </dl>
        </section>

        <aside aria-label="Case options" className="cse-options">
          <section aria-labelledby="cm-h" className="cse-sec">
            <h2 id="cm-h" className="lbl">
              Case material
            </h2>
            <div role="radiogroup" aria-labelledby="cm-h" className="cse-materials">
              {materials.map((m) => (
                <button
                  key={m.slug}
                  type="button"
                  role="radio"
                  className="tile"
                  aria-checked={m.slug === choice?.material}
                  data-testid={`material-${m.slug}`}
                  onPointerEnter={() => m.slug && warm('material', m.slug)}
                  onFocus={() => m.slug && warm('material', m.slug)}
                  onClick={() => m.slug && pick('material', m.slug)}
                >
                  <Swatch className="cse-mat-sample" bg={materialSample(m.slug ?? '')} />
                  <span className="cse-mat-name">{m.name}</span>
                  <span className="cse-mat-note">{m.soundEffect}</span>
                </button>
              ))}
            </div>
          </section>

          <section aria-labelledby="cc-h" className="cse-sec">
            <h2 id="cc-h" className="lbl">
              Case color · {colorLabel}
            </h2>
            <div className="cse-colors">
              {(material?.colors ?? []).map((hex) => {
                const up = hex.toUpperCase()
                return (
                  <SwatchButton
                    key={up}
                    hex={up}
                    name={colorName(up)}
                    pressed={up === choice?.color}
                    onPick={() => choice && setChoice({ ...choice, color: up })}
                  />
                )
              })}
            </div>
          </section>

          <section aria-labelledby="pl-h" className="cse-sec">
            <h2 id="pl-h" className="lbl">
              Plate
            </h2>
            <div role="radiogroup" aria-labelledby="pl-h" className="cse-plates">
              {plates.map((p) => (
                <button
                  key={p.slug}
                  type="button"
                  role="radio"
                  className="kc sm cse-plate"
                  aria-checked={p.slug === choice?.plate}
                  data-testid={`plate-${p.slug}`}
                  onPointerEnter={() => p.slug && warm('plate', p.slug)}
                  onFocus={() => p.slug && warm('plate', p.slug)}
                  onClick={() => p.slug && pick('plate', p.slug)}
                >
                  <Swatch className="cse-plate-sw" bg={plateHex(p.slug ?? '')} />
                  {p.name}
                </button>
              ))}
            </div>
            <p className="cse-plate-note" data-testid="plate-note">
              {plate && (
                <>
                  <strong>{plateFull(plate.slug ?? '', plate.name ?? '')}.</strong> {plate.soundEffect}
                </>
              )}
            </p>
          </section>

          <section aria-labelledby="mt-h" className="cse-sec">
            <h2 id="mt-h" className="lbl">
              Mount style
            </h2>
            <div role="radiogroup" aria-labelledby="mt-h" className="cse-mounts">
              {mounts.map((t) => {
                const d = mountDrawing(t.slug ?? '')
                return (
                  <button
                    key={t.slug}
                    type="button"
                    role="radio"
                    className="tile cse-mount"
                    aria-checked={t.slug === choice?.mount}
                    data-testid={`mount-${t.slug}`}
                    onPointerEnter={() => t.slug && warm('mount', t.slug)}
                    onFocus={() => t.slug && warm('mount', t.slug)}
                    onClick={() => t.slug && pick('mount', t.slug)}
                  >
                    <svg className="cse-mount-art" viewBox="0 0 60 36" aria-hidden="true" fill="none" strokeLinecap="square" strokeLinejoin="miter">
                      <path d={d.caseD} stroke="#000" strokeWidth="3" />
                      <path d="M9 17 H51" stroke="#2C2A5A" strokeWidth="4" />
                      <path d="M11 22 H49" stroke="#000" strokeWidth="2" />
                      {d.dots.map((r, i) => (
                        <rect key={i} x={r.x} y={r.y} width={r.w} height={r.h} fill="#F16B53" stroke="#000" strokeWidth="1" />
                      ))}
                    </svg>
                    <span className="cse-mount-name">{t.name}</span>
                    <span className="cse-mount-note">{t.soundEffect}</span>
                  </button>
                )
              })}
            </div>
          </section>

          <span className="phone">{playLink}</span>
        </aside>
      </div>
    </div>
  )
}

// Colours and samples go in through React's style prop (the DOM), which the CSP allows.

function Swatch({ className, bg }: { className: string; bg: string }) {
  return <span aria-hidden="true" className={className} style={{ background: bg }} />
}

function SwatchButton({ hex, name, pressed, onPick }: { hex: string; name: string; pressed: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      className="cse-sw"
      aria-label={name}
      title={name}
      aria-pressed={pressed}
      data-testid={`color-${hex.slice(1)}`}
      onClick={onPick}
      style={{ background: hex }}
    />
  )
}

function Dot({ left }: { left: string }) {
  return <span className="cse-dot" style={{ left }} />
}
