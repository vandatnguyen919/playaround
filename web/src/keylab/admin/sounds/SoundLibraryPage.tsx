import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router'
import { listAdminSwitches, listSounds, type AdminSound } from '../../api/adminSounds.ts'
import type { AdminSwitch } from '../../api/adminSwitches.ts'
import { SIGN_IN_URL, toApiProblem } from '../../api/problem.ts'
import { useHealth } from '../../api/useHealth.ts'
import { play, stopSounds } from '../../catalog/sounds.ts'
import { AdminTopbar } from '../AdminShell.tsx'
import Toast, { type Notice } from '../Toast.tsx'
import StatusBadge from './StatusBadge.tsx'
import StrokeWave from './StrokeWave.tsx'
import UploadDropZone from './UploadDropZone.tsx'
import { useSoundUpload } from './useSoundUpload.ts'
import {
  CHECKLIST,
  STROKES,
  VARIANTS,
  badgeFor,
  bySwitch,
  fileNote,
  formatLength,
  formatLufs,
  hasVariant,
  latest,
  readyFiles,
  type Stroke,
  type Variant,
} from './soundLibrary.ts'

// Sound library (US-38), AdminSounds.dc.html: switches with their recording
// status on the left, the chosen switch's press and release per variant on
// the right, and a drop zone to add a take. Switch names come from ADM-02,
// recordings from ADM-05. The chosen switch is in the URL (?switch=<id>).

const EDITOR = 'keylab-editor'
const TITLE = 'Sound library'
const CRUMB = 'Catalog · press and release recordings'
const POLL_MS = 1500

export default function SoundLibraryPage() {
  const health = useHealth()
  let gate: ReactNode = null
  if (health.state === 'loading') {
    gate = <p className="ad-note mono">Checking…</p>
  } else if (health.state === 'error') {
    gate = <p className="ad-note">{health.problem.userMessage}</p>
  } else if (!health.health.authenticated) {
    gate = (
      <p className="ad-note">
        <a href={SIGN_IN_URL}>Sign in</a> with a KeyLab team account to manage sounds.
      </p>
    )
  } else if (!health.health.roles.includes(EDITOR)) {
    gate = <p className="ad-note">You need the editor role to manage sounds.</p>
  }
  return (
    <>
      <AdminTopbar title={TITLE} crumb={CRUMB} />
      <main id="ad-main" className="ad-main" tabIndex={-1}>
        {gate ?? <SoundLibrary />}
      </main>
    </>
  )
}

function typeLabel(type: string | undefined) {
  return type ? type[0].toUpperCase() + type.slice(1) : ''
}

/** "Tactile · Clack Works · 62 g" */
function metaOf(sw: AdminSwitch): string {
  return [typeLabel(sw.type), sw.brand, sw.forceG !== undefined ? `${sw.forceG} g` : undefined].filter(Boolean).join(' · ')
}

function SoundLibrary() {
  const [params, setParams] = useSearchParams()
  const [q, setQ] = useState('')
  const [switches, setSwitches] = useState<AdminSwitch[] | null>(null)
  const [sounds, setSounds] = useState<AdminSound[] | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [variant, setVariant] = useState<Variant>('stock')
  const [notice, setNotice] = useState<Notice | null>(null)

  // Switches by name, as the search box narrows them.
  useEffect(() => {
    let active = true
    const timer = setTimeout(() => {
      listAdminSwitches(q)
        .then((list) => active && setSwitches(list))
        .catch((error: unknown) => active && setProblem(toApiProblem(error).userMessage))
    }, q ? 250 : 0)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [q])

  const refresh = useCallback(() => {
    return listSounds()
      .then(setSounds)
      .catch((error: unknown) => setProblem(toApiProblem(error).userMessage))
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const groups = useMemo(() => bySwitch(sounds ?? []), [sounds])
  const selectedId = params.get('switch') ?? switches?.[0]?.id ?? null
  const current = switches?.find((sw) => sw.id === selectedId) ?? null
  const mine = useMemo(() => (selectedId ? (groups.get(selectedId) ?? []) : []), [groups, selectedId])
  const anyProcessing = mine.some((s) => s.status === 'processing')

  // Keep the badges moving while a take of this switch is processing.
  useEffect(() => {
    if (!anyProcessing) {
      return
    }
    const timer = setInterval(() => void refresh(), POLL_MS)
    return () => clearInterval(timer)
  }, [anyProcessing, refresh])

  const pick = (id: string) => {
    setVariant('stock')
    setParams({ switch: id }, { replace: true })
  }

  if (problem) {
    return (
      <p className="ad-note" role="alert">
        {problem}
      </p>
    )
  }

  return (
    <div className="snd">
      <nav aria-label="Switches with recordings" className="ad-card snd-nav">
        <div className="snd-find">
          <label htmlFor="snd-q" className="lbl">
            Find a switch
          </label>
          <input id="snd-q" className="field" type="search" placeholder="Name" value={q} onChange={(event) => setQ(event.target.value)} />
        </div>
        {switches === null || sounds === null ? (
          <p className="snd-empty mono">Loading…</p>
        ) : switches.length === 0 ? (
          <p className="snd-empty">{q ? 'No switch matches this name.' : 'No switches yet. Add one under Switches.'}</p>
        ) : (
          switches.map((sw) => {
            const own = groups.get(sw.id) ?? []
            const files = readyFiles(own)
            return (
              <button key={sw.id} type="button" className="snd-pick" aria-current={sw.id === selectedId} onClick={() => pick(sw.id)}>
                <span aria-hidden="true" className="snd-stem" style={{ background: sw.stemColor ?? '#FFFDF5' }} />
                <span className="snd-pick-text">
                  <span className="snd-pick-name">{sw.name}</span>
                  <span className="mono snd-pick-files">
                    {files} {files === 1 ? 'FILE' : 'FILES'}
                  </span>
                </span>
                <StatusBadge status={badgeFor(own)} />
              </button>
            )
          })
        )}
      </nav>

      {current && (
        <div className="snd-main">
          <section className="ad-card" aria-labelledby="sd-h">
            <div className="snd-head">
              <div className="snd-who">
                <span aria-hidden="true" className="snd-big-stem" style={{ background: current.stemColor ?? '#FFFDF5' }} />
                <div>
                  <h2 id="sd-h" className="h2 snd-name">
                    {current.name}
                  </h2>
                  <p className="snd-meta">{metaOf(current)}</p>
                </div>
              </div>
              <div role="tablist" aria-label="Mod variant" className="snd-tabs">
                {VARIANTS.map((v) => (
                  <button key={v.value} type="button" role="tab" className="kc" aria-selected={variant === v.value} onClick={() => setVariant(v.value)}>
                    {v.label}
                  </button>
                ))}
              </div>
            </div>
            {hasVariant(mine, variant) ? (
              <VariantTable sw={current} sounds={mine} variant={variant} />
            ) : (
              <div role="status" className="snd-none">
                <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="2.4" aria-hidden="true">
                  <path d="M4 9v6h4l5 4V5L8 9H4z" />
                  <path d="M17 9l4 6M21 9l-4 6" />
                </svg>
                <div className="snd-none-text">
                  <strong>No sound available yet</strong>
                  <span className="snd-sub">
                    The public page shows this switch with a “Sound coming soon” label and it can’t be picked in the builder’s sound compare. Upload a stock press and release to fix that.
                  </span>
                </div>
                <Link to={`/keylab/admin/switches/${current.id}`} className="kc go">
                  Open switch
                </Link>
              </div>
            )}
          </section>

          <div className="snd-row">
            <AddRecording
              key={current.id}
              sw={current}
              onAttached={() => {
                void refresh()
                setNotice({
                  kind: 'success',
                  title: 'Recording uploaded',
                  body: 'Processing the waveform and loudness. It goes live once you publish the switch.',
                  action: { label: 'Open switch', to: `/keylab/admin/switches/${current.id}` },
                })
              }}
              onDone={() => void refresh()}
            />
            <section className="ad-card sky snd-check" aria-labelledby="qc-h">
              <h2 id="qc-h" className="h2">
                Recording checklist
              </h2>
              <ul>
                {CHECKLIST.map((item) => (
                  <li key={item}>
                    <span aria-hidden="true" className="snd-box" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </div>
      )}
      {notice && <Toast notice={notice} onDismiss={() => setNotice(null)} />}
    </div>
  )
}

function VariantTable({ sw, sounds, variant }: { sw: AdminSwitch; sounds: AdminSound[]; variant: Variant }) {
  const [playError, setPlayError] = useState<string | null>(null)
  const variantLabel = VARIANTS.find((v) => v.value === variant)?.label ?? 'Stock'
  const press = latest(sounds, variant, 'press')
  const release = latest(sounds, variant, 'release')
  return (
    <>
      <div role="tabpanel" aria-label={`${variantLabel} recordings`} className="snd-table">
        <div className="snd-vt snd-vt-head">
          <span className="lbl">Stroke</span>
          <span className="lbl">Waveform</span>
          <span className="lbl">Length</span>
          <span className="lbl">Loudness</span>
          <span className="lbl">Status</span>
        </div>
        {STROKES.map((stroke) => {
          const take = stroke.value === 'press' ? press : release
          const ready = take?.status === 'ready'
          return (
            <div key={stroke.value} className="snd-vt">
              <div className="snd-stroke">
                <button
                  type="button"
                  className="kc coral snd-play"
                  aria-label={`Play ${sw.name} ${variantLabel.toLowerCase()} ${stroke.value}`}
                  disabled={!ready}
                  onClick={() => {
                    setPlayError(null)
                    stopSounds()
                    if (take?.url) {
                      play([{ variant: take.variant, stroke: take.stroke, url: take.url }]).catch(() => setPlayError('This sound could not be played.'))
                    }
                  }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M6 4l14 8-14 8z" fill="#000" />
                  </svg>
                </button>
                <span className="snd-stroke-name">{stroke.label}</span>
              </div>
              <div className="snd-wave">
                {ready ? (
                  <StrokeWave peaks={take.peaks} label={`Waveform of the ${variantLabel.toLowerCase()} ${stroke.value}`} />
                ) : take?.status === 'failed' ? (
                  <span className="snd-fail">{take.error}</span>
                ) : null}
              </div>
              <span className="mono snd-num">{ready ? formatLength(take.durationMs) : '—'}</span>
              <span className="mono snd-num">{ready ? formatLufs(take.loudnessLufs) : '—'}</span>
              <StatusBadge status={take === undefined ? 'missing' : take.status === 'ready' ? 'recorded' : take.status} />
            </div>
          )
        })}
      </div>
      <p className="mono snd-note">{playError ?? fileNote(press, release)}</p>
    </>
  )
}

function AddRecording({
  sw,
  onAttached,
  onDone,
}: {
  sw: AdminSwitch
  onAttached: () => void
  onDone: () => void
}) {
  const [variant, setVariant] = useState<Variant>('stock')
  const [stroke, setStroke] = useState<Stroke>('press')
  const switchId = useCallback(async () => sw.id, [sw.id])
  const { state, upload, reset } = useSoundUpload({ switchId, variant, stroke, onAttached, onDone })
  // Each pick of variant or stroke starts a fresh drop zone; what is there shows in the table above.
  useEffect(() => {
    if (state.step !== 'uploading') {
      reset()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variant, stroke])
  return (
    <section className="ad-card snd-add" aria-labelledby="up-h">
      <h2 id="up-h" className="h2">
        Add a recording
      </h2>
      <div className="snd-selects">
        <div className="fg">
          <label htmlFor="up-v" className="lbl">
            Variant
          </label>
          <select id="up-v" className="field" value={variant} onChange={(event) => setVariant(event.target.value as Variant)} disabled={state.step === 'uploading'}>
            {VARIANTS.map((v) => (
              <option key={v.value} value={v.value}>
                {v.label}
              </option>
            ))}
          </select>
        </div>
        <div className="fg">
          <label htmlFor="up-s" className="lbl">
            Stroke
          </label>
          <select id="up-s" className="field" value={stroke} onChange={(event) => setStroke(event.target.value as Stroke)} disabled={state.step === 'uploading'}>
            {STROKES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <UploadDropZone
        label={`${sw.name} · drop a .wav`}
        state={state}
        onFile={(file) => void upload(file)}
        onReset={reset}
        doneNote={variant === 'stock' ? 'Levels OK · ready to publish' : 'Levels OK'}
      />
    </section>
  )
}
