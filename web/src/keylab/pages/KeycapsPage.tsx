import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { getKeycapSet, getSoundRecipe, listKeycapSets, listMods, type KeycapSet, type RecipeQuery, type SoundRecipe } from '../api/parts.ts'
import { loadBuild, saveBuild } from '../builder/buildState.ts'
import { buildParts, caseLook } from '../builder/caseParts.ts'
import Keyboard, { type KeyboardHandle } from '../builder/Keyboard.tsx'
import {
  keyColors,
  materialsShown,
  pickBy,
  profileCaps,
  PROFILES,
  shiftOf,
  shiftWord,
  shiftX,
  summary,
  type Material,
  type Profile,
} from '../builder/keycaps.ts'
import { cleanLevels, modParams } from '../builder/mods.ts'
import { PADS } from '../builder/pads.ts'
import { preload, playStroke } from '../builder/recipePlayer.ts'
import { useBuildSwitch } from '../builder/useBuildSwitch.ts'
import './mods.css'
import './keycaps.css'

// US-06, the Keycaps studio (KeycapsDesktop, KeycapsMobile): pick a keycap
// set (CAT-05) and the preview takes its colours and profile; the sound
// recipe (BLD-10) is fetched again with the set and one key plays it. Every
// set's tile shows where it moves the sound on the deep ↔ bright scale. A set
// named by `?keycap_set=` or picked before is loaded with CAT-06.
//
// Not built here (no story or API yet): the 3D views and orbit, the custom
// painter, legends, artisans and Save build (US-08).

type Tab = 'profile' | 'material' | 'colors'
const TABS: [Tab, string][] = [
  ['profile', 'Profile'],
  ['material', 'Material'],
  ['colors', 'Colors'],
]

export default function KeycapsPage() {
  const sw = useBuildSwitch()
  const switchSlug = sw && 'slug' in sw ? sw.slug : null
  const [params] = useSearchParams()
  const [sets, setSets] = useState<KeycapSet[] | null>(null)
  const [setsError, setSetsError] = useState(false)
  const [chosen, setChosen] = useState<KeycapSet | null>(null)
  const [mod, setMod] = useState<string[] | null>(null)
  const [recipe, setRecipe] = useState<SoundRecipe | null>(null)
  const [playError, setPlayError] = useState<string | null>(null)
  const [pad, setPad] = useState(0)
  const [padOpen, setPadOpen] = useState(false)
  const [tab, setTab] = useState<Tab>('colors')
  const keyboard = useRef<KeyboardHandle>(null)
  const phoneKeyboard = useRef<KeyboardHandle>(null)
  const wanted = params.get('keycap_set') ?? loadBuild().keycapSet ?? ''
  // The keyboards keep one onStroke for the page's life and read the recipe
  // from a ref, so a pick does not re-render their keys twice.
  const currentRef = useRef<SoundRecipe | null>(null)
  const shouldPlay = useRef(false)
  // The saved case (US-07) is heard and drawn here too; the set comes from this page.
  const [saved] = useState(() => loadBuild())
  const look = useMemo(() => caseLook(saved.case), [saved])

  /** Presses one key on the preview that is on screen, which plays the current recipe. */
  const ping = useCallback(() => {
    const board = window.matchMedia('(max-width: 767px)').matches ? phoneKeyboard : keyboard
    board.current?.ping()
  }, [])

  // The sets (CAT-05) and the one asked for (CAT-06), side by side. A set
  // that no longer loads (hidden, unknown) gives way to the first listed one.
  useEffect(() => {
    document.title = 'Keycaps studio · KeyLab'
    let active = true
    const one = wanted ? getKeycapSet(wanted).catch(() => null) : Promise.resolve(null)
    one.then((set) => active && set && setChosen((now) => now ?? set))
    Promise.all([listKeycapSets(), one])
      .then(([list, set]) => {
        if (!active) return
        setSets(list)
        setChosen((now) => now ?? set ?? list[0] ?? null)
      })
      .catch(() => active && setSetsError(true))
    return () => {
      active = false
    }
  }, [wanted])

  // The build's mods (US-05) stay in every mix heard here.
  useEffect(() => {
    let active = true
    listMods()
      .then((list) => active && setMod(modParams(list, cleanLevels(list, loadBuild().mods ?? {}))))
      .catch(() => active && setMod([]))
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (chosen) saveBuild({ keycapSet: chosen.slug })
  }, [chosen])

  const query = useCallback(
    (set: KeycapSet | null): RecipeQuery | null =>
      switchSlug && mod && set ? { switch: switchSlug, mod, ...buildParts(saved), keycap_set: set.slug } : null,
    [switchSlug, mod, saved],
  )

  // The recipe of the chosen set: on load it is fetched and preloaded; a pick
  // fetches it again and plays one key once it is here.
  useEffect(() => {
    const q = query(chosen)
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
  }, [query, chosen, ping])

  const onStroke = useCallback((stroke: 'press' | 'release') => {
    const r = currentRef.current
    if (!r) return
    playStroke(r, stroke).catch(() => setPlayError('This sound could not be played.'))
  }, [])

  function choose(set: KeycapSet | undefined) {
    if (!set) return
    setPlayError(null)
    shouldPlay.current = true
    if (set.slug === chosen?.slug) {
      // Same set: play it again, no new request.
      if (recipe) {
        shouldPlay.current = false
        ping()
      }
      return
    }
    setChosen(set)
  }

  /** A tile reached by pointer or focus fetches its recipe, so its pick plays at once. */
  function warm(set: KeycapSet) {
    const q = query(set)
    if (q) getSoundRecipe(q).then(preload, () => undefined)
  }

  const colors = useMemo(() => (chosen ? keyColors(chosen.colors) : undefined), [chosen])
  const padNow = PADS[pad]
  const list = sets ?? []
  const materials = materialsShown(list)
  const profileSpec = PROFILES.find((p) => p.id === chosen?.profile)?.spec ?? ''

  const profileGroup = (
    <section aria-labelledby="pf-h" className="kcs-sec sec-profile">
      <h2 id="pf-h" className="lbl desk">
        Profile
      </h2>
      <div role="radiogroup" aria-labelledby="pf-h" className="kcs-profiles">
        {PROFILES.map((p) => {
          const offered = list.some((s) => s.profile === p.id)
          return (
            <button
              key={p.id}
              type="button"
              role="radio"
              className="tile kcs-profile"
              aria-checked={chosen?.profile === p.id}
              disabled={!offered}
              title={offered ? undefined : 'No keycap set in this profile yet.'}
              onClick={() => choose(pickBy(list, chosen, { profile: p.id as Profile }))}
            >
              <svg className="kcs-caps" viewBox="0 0 120 48" aria-hidden="true">
                <line x1="0" y1="45.5" x2="120" y2="45.5" stroke="#000" strokeWidth="4" />
                {profileCaps(p.id).map((d, i) => (
                  <path key={i} d={d} fill="#99D6FF" stroke="#000" strokeWidth="3" strokeLinejoin="miter" />
                ))}
              </svg>
              <span className="kcs-profile-text">
                <span className="kcs-profile-name">{p.name}</span>
                <span className="mono kcs-profile-spec phone">{p.spec}</span>
              </span>
            </button>
          )
        })}
      </div>
      <p className="mono kcs-spec desk" data-testid="profile-spec">
        {profileSpec}
      </p>
    </section>
  )

  const materialGroup = (
    <section aria-labelledby="mt-h" className="kcs-sec sec-material">
      <h2 id="mt-h" className="lbl desk">
        Material
      </h2>
      <div role="radiogroup" aria-labelledby="mt-h" className="kcs-materials">
        {materials.map((m) => {
          const offered = list.some((s) => s.material === m.id)
          return (
            <button
              key={m.id}
              type="button"
              role="radio"
              className="tile kcs-material"
              aria-checked={chosen?.material === m.id}
              disabled={!offered}
              title={offered ? undefined : 'No keycap set in this material yet.'}
              onClick={() => choose(pickBy(list, chosen, { material: m.id as Material }))}
            >
              <span aria-hidden="true" className={`kcs-mat-swatch phone mat-${m.swatch}`} />
              <span className="kcs-mat-text">
                <span className="kcs-mat-head">
                  <span className="kcs-mat-name">{m.name}</span>
                  <span className="mono kcs-mat-sound">{m.sound}</span>
                </span>
                <span className="kcs-mat-desc desk">{m.desk}</span>
                <span className="kcs-mat-desc phone">{m.phone}</span>
              </span>
            </button>
          )
        })}
      </div>
      <p className="kcs-mat-hint phone">Tap a key in the preview to hear the difference.</p>
    </section>
  )

  const colorGroup = (
    <section aria-labelledby="th-h" className="kcs-sec sec-colors">
      <h2 id="th-h" className="lbl">
        Colorways
      </h2>
      <div className="kcs-sets" data-testid="keycap-sets">
        {list.map((set) => {
          const shift = shiftOf(set)
          const word = shiftWord(shift)
          const c = set.colors
          return (
            <button
              key={set.slug}
              type="button"
              className="tile kcs-set"
              aria-pressed={chosen?.slug === set.slug}
              data-testid={`set-${set.slug}`}
              onPointerEnter={() => warm(set)}
              onFocus={() => warm(set)}
              onClick={() => choose(set)}
            >
              <span aria-hidden="true" className="kcs-swatches">
                <Sq hex={c?.accent} />
                <Sq hex={c?.alpha} />
                <Sq hex={c?.alpha} />
                <Sq hex={c?.mod} />
              </span>
              <span className="kcs-set-name">{set.name}</span>
              <span className="mono kcs-set-meta">
                {set.material.toUpperCase()} · {set.profile === 'cherry' ? 'CHERRY' : set.profile.toUpperCase()}
              </span>
              <span className="kcs-shift" data-testid={`shift-${set.slug}`} data-shift={shift}>
                <span className="sr-only">Sound: </span>
                <span className="mono kcs-shift-word">{word}</span>
                <span aria-hidden="true" className="kcs-shift-track">
                  <ShiftMark x={shiftX(shift)} />
                </span>
              </span>
            </button>
          )
        })}
      </div>
      <p aria-hidden="true" className="mono kcs-shift-scale">
        <span>BRIGHT</span>
        <span>| = STOCK</span>
        <span>DEEP</span>
      </p>
    </section>
  )

  return (
    <div className="kcs" data-tab={tab}>
      <div className="kcs-head">
        <h1 className="h1">Keycaps studio</h1>
        <p className="mono kcs-summary" data-testid="keycaps-summary">
          {chosen ? summary(chosen) : '…'}
        </p>
      </div>

      {sw && 'error' in sw && (
        <p className="page-note" role="alert">
          {sw.error} <Link to="/keylab/switches">Pick a switch</Link>
        </p>
      )}
      {setsError && (
        <p className="page-note" role="alert">
          The keycap sets could not be loaded. Reload to try again.
        </p>
      )}
      {sets && sets.length === 0 && <p className="page-note">No keycap sets yet.</p>}
      {playError && (
        <p className="mods-error mono" role="status">
          {playError}
        </p>
      )}

      <section aria-label="Keyboard preview on desk pad" className={`kcs-stage ${padNow.className}`}>
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
        <div className="kcs-hint desk">
          <p className="kcs-hint-main">Click any key to hear it.</p>
        </div>
        <div className="stage-board desk">
          <Keyboard ref={keyboard} width={720} onStroke={onStroke} typing colors={colors} profile={chosen?.profile} {...look} />
        </div>
        <div className="stage-board phone">
          <Keyboard ref={phoneKeyboard} width={310} onStroke={onStroke} colors={colors} profile={chosen?.profile} {...look} />
        </div>
        <div className="kcs-stage-foot phone">
          <button
            type="button"
            className="kc sm kcs-padbtn"
            onClick={() => setPad((pad + 1) % PADS.length)}
            aria-label={`Desk pad: ${padNow.name}. Tap for the next pad`}
          >
            <span aria-hidden="true" className={`kcs-padbtn-sw ${padNow.className}`} />
            <span className="mono">PAD · {padNow.name.toUpperCase()}</span>
          </button>
        </div>
      </section>

      <div role="tablist" aria-label="Keycap options" className="kcs-tabs phone">
        {TABS.map(([id, label]) => (
          <button key={id} type="button" role="tab" className="kc sm" aria-selected={tab === id} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>

      <div className="kcs-cards">
        <div className="card kcs-card">
          {profileGroup}
          {materialGroup}
        </div>
        <div className="card kcs-card">{colorGroup}</div>
      </div>
    </div>
  )
}

function Sq({ hex }: { hex?: string }) {
  // Colours from the API go in through React's style prop (the DOM), which the CSP allows.
  return <span className="sq" style={{ background: hex ?? 'transparent' }} />
}

function ShiftMark({ x }: { x: number }) {
  return <span className="kcs-shift-dot" style={{ left: `${(x * 100).toFixed(1)}%` }} />
}
