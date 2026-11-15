import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { createSwitch, deleteSwitch, getSwitch, updateSwitch } from '../../api/adminSwitches.ts'
import { ApiProblem, SIGN_IN_URL, toApiProblem } from '../../api/problem.ts'
import { useHealth } from '../../api/useHealth.ts'
import { AdminTopbar } from '../AdminShell.tsx'
import Toast, { type Notice } from '../Toast.tsx'
import ForceCurveChart from './ForceCurveChart.tsx'
import SwitchPreviewCard from './SwitchPreviewCard.tsx'
import {
  STEMS,
  TYPES,
  bodyFromForm,
  emptyForm,
  fieldErrorsFrom,
  formFromSwitch,
  newRow,
  readiness,
  type FieldErrors,
  type FormState,
  type SwitchData,
} from './switchForm.ts'

// Add / edit switch (US-37), AdminSwitchEdit.dc.html. One route for both,
// /keylab/admin/switches/new and /keylab/admin/switches/:id, so saving a new
// switch moves to its own URL without losing the page. Sounds (US-38),
// photos (they need ADM-04 uploads) and publishing (US-39) are drawn but
// not active yet.

const EDITOR = 'keylab-editor'

type Loaded = { id: string; slug: string; etag: string; status: string; profile?: string }

export default function SwitchEditPage() {
  const health = useHealth()
  const { id = 'new' } = useParams()
  const isNew = id === 'new'
  const title = isNew ? 'Add switch' : 'Edit switch'

  let gate: ReactNode = null
  if (health.state === 'loading') {
    gate = <p className="ad-note mono">Checking…</p>
  } else if (health.state === 'error') {
    gate = <p className="ad-note">{health.problem.userMessage}</p>
  } else if (!health.health.authenticated) {
    gate = (
      <p className="ad-note">
        <a href={SIGN_IN_URL}>Sign in</a> with a KeyLab team account to edit switches.
      </p>
    )
  } else if (!health.health.roles.includes(EDITOR)) {
    gate = <p className="ad-note">You need the editor role to add or edit switches.</p>
  }

  if (gate) {
    return (
      <>
        <AdminTopbar title={title} crumb={isNew ? 'Catalog · Switches · new' : 'Catalog · Switches'} />
        <main id="ad-main" className="ad-main" tabIndex={-1}>
          {gate}
        </main>
      </>
    )
  }
  return <SwitchEditor id={id} />
}

function SwitchEditor({ id }: { id: string }) {
  const navigate = useNavigate()
  const isNew = id === 'new'
  const [form, setForm] = useState<FormState>(emptyForm)
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [loadProblem, setLoadProblem] = useState<ApiProblem | null>(null)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [nameTouched, setNameTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [markNew, setMarkNew] = useState(true)
  const idempotencyKey = useRef(crypto.randomUUID())
  const nameInput = useRef<HTMLInputElement>(null)
  const focusRow = useRef<number | null>(null)

  // Load the switch, unless this page just created it and already holds it.
  useEffect(() => {
    if (isNew) {
      setLoaded(null)
      setForm(emptyForm())
      return
    }
    if (loaded?.id === id) {
      return
    }
    let active = true
    setLoadProblem(null)
    getSwitch(id)
      .then(({ sw, etag }) => {
        if (!active) {
          return
        }
        setForm(formFromSwitch(sw as SwitchData))
        setLoaded({ id: sw.id, slug: sw.slug, etag, status: sw.status, profile: sw.profile })
      })
      .catch((error: unknown) => {
        if (active) {
          setLoadProblem(toApiProblem(error))
        }
      })
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, isNew])

  useEffect(() => {
    if (focusRow.current !== null) {
      document.getElementById(`pt-${focusRow.current}-t`)?.focus()
      focusRow.current = null
    }
  }, [form.points.length])

  const title = isNew ? 'Add switch' : 'Edit switch'
  const crumb = isNew ? 'Catalog · Switches · new' : `Catalog · Switches · ${loaded?.slug ?? '…'}`

  if (loadProblem) {
    return (
      <>
        <AdminTopbar title={title} crumb={crumb} />
        <main id="ad-main" className="ad-main" tabIndex={-1}>
          <p className="ad-note" role="alert">
            {loadProblem.code === 'switch_not_found' ? 'No switch with this id.' : loadProblem.userMessage}{' '}
            <Link to="/keylab/admin/switches/new">Add a switch</Link>
          </p>
        </main>
      </>
    )
  }
  if (!isNew && loaded === null) {
    return (
      <>
        <AdminTopbar title={title} crumb={crumb} />
        <main id="ad-main" className="ad-main" tabIndex={-1}>
          <p className="ad-note mono">Loading…</p>
        </main>
      </>
    )
  }

  const update = (changes: Partial<FormState>) => {
    setForm((current) => ({ ...current, ...changes }))
  }
  const clearError = (...fields: string[]) => {
    if (fields.some((field) => field in errors)) {
      setErrors((current) => {
        const next = { ...current }
        for (const field of fields) {
          delete next[field]
        }
        return next
      })
    }
  }

  const { nameOk, specsOk } = readiness(form)
  const nameBad = (nameTouched && !nameOk) || 'name' in errors
  const nameMessage = errors.name ?? 'Give the switch a name.'
  const typeLabel = TYPES.find((type) => type.value === form.type)?.label ?? 'Linear'

  async function save() {
    if (!nameOk) {
      setNameTouched(true)
      nameInput.current?.focus()
      return
    }
    setBusy(true)
    setNotice(null)
    try {
      const body = bodyFromForm(form)
      if (loaded === null) {
        const { sw, etag } = await createSwitch(body, idempotencyKey.current)
        idempotencyKey.current = crypto.randomUUID()
        setLoaded({ id: sw.id, slug: sw.slug, etag, status: sw.status, profile: sw.profile })
        setForm(formFromSwitch(sw as SwitchData))
        navigate(`/keylab/admin/switches/${sw.id}`, { replace: true })
      } else {
        const { sw, etag } = await updateSwitch(loaded.id, body, loaded.etag)
        setLoaded({ id: sw.id, slug: sw.slug, etag, status: sw.status, profile: sw.profile })
        setForm(formFromSwitch(sw as SwitchData))
      }
      setErrors({})
      setNotice({ kind: 'info', title: 'Draft saved', body: 'Only admins can see it.' })
    } catch (error) {
      const problem = toApiProblem(error)
      if (problem.status === 422 && problem.errors.length > 0) {
        const { fields, other } = fieldErrorsFrom(problem.errors, form)
        setErrors(fields)
        setNotice({
          kind: 'error',
          title: problem.title,
          body: other.length > 0 ? other.join(' ') : 'Check the fields marked in red.',
        })
      } else if (problem.code === 'precondition_failed') {
        setNotice({ kind: 'error', title: problem.title, body: 'Someone else saved it first. Reload to see their version.' })
      } else {
        setNotice({ kind: 'error', title: problem.title, body: problem.detail ?? 'Try again in a moment.' })
      }
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (loaded === null) {
      return
    }
    setBusy(true)
    try {
      await deleteSwitch(loaded.id, loaded.etag)
      navigate('/keylab/admin/switches', {
        state: { notice: { kind: 'info', title: 'Draft deleted', body: `${form.name.trim() || 'The switch'} is gone.` } },
      })
    } catch (error) {
      const problem = toApiProblem(error)
      setConfirmDelete(false)
      setNotice({
        kind: 'error',
        title: problem.title,
        body: problem.code === 'precondition_failed' ? 'Someone else saved it first. Reload to see their version.' : (problem.detail ?? 'Try again in a moment.'),
      })
    } finally {
      setBusy(false)
    }
  }

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    void save()
  }

  const describe = (field: string) => (field in errors ? `err-${field}` : undefined)
  const fieldError = (field: string) =>
    field in errors ? (
      <span id={`err-${field}`} className="err">
        {errors[field]}
      </span>
    ) : null

  const checks = [
    { label: 'Name and type', done: nameOk },
    { label: 'Specs and force curve', done: specsOk },
    { label: 'Stock press sound', done: false },
    { label: 'Stock release sound', done: false },
    { label: 'Photo (optional)', done: false },
  ]
  const draft = (loaded?.status ?? 'draft') === 'draft'

  return (
    <>
      <AdminTopbar title={title} crumb={crumb} />
      <main id="ad-main" className="ad-main" tabIndex={-1}>
        <div className="se-bar">
          <nav aria-label="Breadcrumb" className="crumb">
            <Link to="/keylab/admin/switches">Switches</Link>
            <span aria-hidden="true">/</span>
            <span aria-current="page">{nameOk ? form.name.trim() : 'New switch'}</span>
          </nav>
          <div className="se-actions">
            <span className={`sbadge ${draft ? 'draft' : 'published'}`}>
              <span aria-hidden="true" className="sbadge-dot" />
              {draft ? 'Draft' : 'Published'}
            </span>
            {loaded !== null && draft && !confirmDelete && (
              <button type="button" className="kc tall" disabled={busy} onClick={() => setConfirmDelete(true)}>
                Delete draft
              </button>
            )}
            <button type="submit" form="switch-form" className="kc tall" disabled={busy} aria-busy={busy}>
              Save draft
            </button>
            <button
              type="button"
              className="kc go"
              aria-disabled="true"
              aria-describedby="pub-why"
              onClick={() => setNotice({ kind: 'error', title: 'Can’t publish yet', body: 'Add the stock press and release sounds first.' })}
            >
              Publish to library
            </button>
          </div>
        </div>

        {confirmDelete && (
          <div className="se-confirm" role="alertdialog" aria-labelledby="del-h" aria-describedby="del-b">
            <span id="del-h" className="se-confirm-title">
              Delete {form.name.trim() || 'this draft'}?
            </span>
            <span id="del-b">It goes for good, with its specs and force curve.</span>
            <div className="se-actions">
              <button type="button" className="kc coral" disabled={busy} onClick={() => void remove()}>
                Delete
              </button>
              <button type="button" className="kc" disabled={busy} onClick={() => setConfirmDelete(false)} autoFocus>
                Cancel
              </button>
            </div>
          </div>
        )}

        <div className="se-grid">
          <form id="switch-form" className="se-form" onSubmit={onSubmit} noValidate>
            <section className="ad-card" aria-labelledby="b-h">
              <h2 id="b-h" className="h2">
                <span className="n">1</span>Basics
              </h2>
              <div className="se-two">
                <div className="fg">
                  <label htmlFor="e-name" className="lbl">
                    Name
                  </label>
                  <input
                    id="e-name"
                    ref={nameInput}
                    className="field"
                    value={form.name}
                    maxLength={60}
                    onChange={(event) => {
                      update({ name: event.target.value })
                      clearError('name')
                    }}
                    onBlur={() => setNameTouched(true)}
                    aria-invalid={nameBad}
                    aria-describedby={nameBad ? 'e-name-err' : undefined}
                  />
                  {nameBad && (
                    <span id="e-name-err" className="err" role="alert">
                      {nameMessage}
                    </span>
                  )}
                </div>
                <div className="fg">
                  <label htmlFor="e-brand" className="lbl">
                    Brand
                  </label>
                  <input
                    id="e-brand"
                    className="field"
                    value={form.brand}
                    maxLength={60}
                    onChange={(event) => {
                      update({ brand: event.target.value })
                      clearError('brand')
                    }}
                    aria-invalid={'brand' in errors}
                    aria-describedby={describe('brand')}
                  />
                  {fieldError('brand')}
                </div>
              </div>
              <div className="fg">
                <span id="e-type" className="lbl">
                  Type
                </span>
                <div role="radiogroup" aria-labelledby="e-type" aria-describedby={describe('type')} className="se-row">
                  {TYPES.map((type) => (
                    <button
                      key={type.value}
                      type="button"
                      role="radio"
                      className="kc"
                      aria-checked={form.type === type.value}
                      onClick={() => {
                        update({ type: type.value })
                        clearError('type')
                      }}
                    >
                      {type.label}
                    </button>
                  ))}
                </div>
                {fieldError('type')}
              </div>
              <div className="fg">
                <span id="e-stem" className="lbl">
                  Stem color
                </span>
                <div className="se-stem">
                  <div role="radiogroup" aria-labelledby="e-stem" className="se-swatches">
                    {STEMS.map((stem) => (
                      <button
                        key={stem.hex}
                        type="button"
                        role="radio"
                        className="sw"
                        aria-checked={form.stem.toUpperCase() === stem.hex}
                        aria-label={stem.name}
                        title={stem.name}
                        onClick={() => {
                          update({ stem: stem.hex })
                          clearError('stem')
                        }}
                      >
                        <svg width="100%" height="100%" viewBox="0 0 10 10" preserveAspectRatio="none" aria-hidden="true">
                          <rect width="10" height="10" fill={stem.hex} />
                        </svg>
                      </button>
                    ))}
                  </div>
                  <label htmlFor="e-hex" className="lbl se-hex-l">
                    Hex
                  </label>
                  <input
                    id="e-hex"
                    className="field mono se-hex"
                    value={form.stem}
                    maxLength={7}
                    onChange={(event) => {
                      update({ stem: event.target.value })
                      clearError('stem')
                    }}
                    aria-invalid={'stem' in errors}
                    aria-describedby={describe('stem')}
                  />
                </div>
                {fieldError('stem')}
              </div>
            </section>

            <section className="ad-card" aria-labelledby="s-h">
              <h2 id="s-h" className="h2">
                <span className="n">2</span>Specs and force curve
              </h2>
              <div className="se-four">
                <UnitField id="e-f" label="Actuation force" unit="g" mode="numeric" value={form.force} error={errors.force} errorId="err-force"
                  onChange={(value) => { update({ force: value }); clearError('force') }} />
                <UnitField id="e-a" label="Actuation point" unit="mm" mode="decimal" value={form.act} error={errors.act} errorId="err-act"
                  onChange={(value) => { update({ act: value }); clearError('act') }} />
                <UnitField id="e-t" label="Total travel" unit="mm" mode="decimal" value={form.total} error={errors.total} errorId="err-total"
                  onChange={(value) => { update({ total: value }); clearError('total') }} />
                <UnitField id="e-s" label="Spring" unit="mm" mode="decimal" value={form.spring} error={errors.spring} errorId="err-spring"
                  onChange={(value) => { update({ spring: value }); clearError('spring') }} />
              </div>
              <div className="se-curve">
                <div className="se-points">
                  <span className="lbl">Force curve points</span>
                  <table className="pt">
                    <thead>
                      <tr>
                        <th scope="col">Travel (mm)</th>
                        <th scope="col">Force (g)</th>
                        <th scope="col">
                          <span className="sr-only">Remove</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {form.points.map((row, index) => {
                        const tKey = `point.${row.key}.t`
                        const fKey = `point.${row.key}.f`
                        return (
                          <tr key={row.key}>
                            <td>
                              <input
                                id={`pt-${row.key}-t`}
                                className="field"
                                inputMode="decimal"
                                aria-label={`Point ${index + 1} travel`}
                                value={row.t}
                                aria-invalid={tKey in errors}
                                aria-describedby={describe(tKey)}
                                onChange={(event) => {
                                  const t = event.target.value
                                  setForm((current) => ({
                                    ...current,
                                    points: current.points.map((r) => (r.key === row.key ? { ...r, t } : r)),
                                  }))
                                  clearError(tKey, 'curve')
                                }}
                              />
                            </td>
                            <td>
                              <input
                                className="field"
                                inputMode="decimal"
                                aria-label={`Point ${index + 1} force`}
                                value={row.f}
                                aria-invalid={fKey in errors}
                                aria-describedby={describe(fKey)}
                                onChange={(event) => {
                                  const f = event.target.value
                                  setForm((current) => ({
                                    ...current,
                                    points: current.points.map((r) => (r.key === row.key ? { ...r, f } : r)),
                                  }))
                                  clearError(fKey, 'curve')
                                }}
                              />
                            </td>
                            <td className="pt-x">
                              <button
                                type="button"
                                className="kc pt-rm"
                                aria-label={`Remove point ${index + 1}`}
                                onClick={() => {
                                  setForm((current) => ({ ...current, points: current.points.filter((r) => r.key !== row.key) }))
                                  clearError(tKey, fKey, 'curve')
                                }}
                              >
                                ×
                              </button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                  {form.points.map((row, index) =>
                    [`point.${row.key}.t`, `point.${row.key}.f`].map((key) =>
                      key in errors ? (
                        <span key={key} id={`err-${key}`} className="err">
                          Point {index + 1} {key.endsWith('.t') ? 'travel' : 'force'}: {errors[key]}
                        </span>
                      ) : null,
                    ),
                  )}
                  {fieldError('curve')}
                  <button
                    type="button"
                    className="kc se-add"
                    onClick={() => {
                      const row = newRow()
                      focusRow.current = row.key
                      setForm((current) => ({ ...current, points: [...current.points, row] }))
                    }}
                  >
                    + Add point
                  </button>
                </div>
                <div className="se-chart">
                  <ForceCurveChart form={form} />
                </div>
              </div>
            </section>

            <section className="ad-card" aria-labelledby="snd-h">
              <h2 id="snd-h" className="h2">
                <span className="n">3</span>Sounds
              </h2>
              <p className="se-p">Upload one press and one release per variant. Stock is required to publish; lubed and foam can follow.</p>
              <div className="se-two se-two-wide">
                <DropZone label="Stock · press sound" />
                <DropZone label="Stock · release sound" />
              </div>
            </section>

            <section className="ad-card" aria-labelledby="ph-h">
              <h2 id="ph-h" className="h2">
                <span className="n">4</span>Photo
              </h2>
              <label className="se-photo">
                <span aria-hidden="true" className="se-photo-img">
                  IMG
                </span>
                <span className="se-photo-text">
                  <span className="se-photo-title">Drop a photo or choose a file</span>
                  <span className="mono se-photo-sub">PNG OR JPG · SQUARE · AT LEAST 800 PX</span>
                </span>
                <input type="file" accept="image/png,image/jpeg" aria-label="Choose a switch photo" className="se-photo-input" disabled />
              </label>
            </section>
          </form>

          <aside aria-label="Preview and publishing" className="se-aside">
            <section className="ad-card sky" aria-labelledby="pv-h">
              <h2 id="pv-h" className="h2">
                Library preview
              </h2>
              <div className="se-preview">
                <SwitchPreviewCard
                  name={nameOk ? form.name.trim() : 'New switch'}
                  type={form.type}
                  typeLabel={typeLabel}
                  stem={form.stem}
                  force={form.force}
                  act={form.act}
                  profile={loaded?.profile}
                />
              </div>
              <span className="se-small">Press the card to hear the stock sound.</span>
            </section>
            <section className="ad-card" aria-labelledby="ck-h">
              <h2 id="ck-h" className="h2">
                Ready to publish?
              </h2>
              <ul className="ck">
                {checks.map((check) => (
                  <li key={check.label}>
                    <span aria-hidden="true" className={check.done ? 'ck-box done' : 'ck-box'}>
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="4" strokeLinecap="square">
                        <path d={check.done ? 'M5 12.5l4.5 4.5L19 7.5' : 'M6 12h12'} />
                      </svg>
                    </span>
                    <span>{check.label}</span>
                    <span className="sr-only">{check.done ? 'done' : 'to do'}</span>
                  </li>
                ))}
              </ul>
              <p id="pub-why" className="se-small">
                Upload the stock press and release sounds to publish.
              </p>
              <div className="se-toggle">
                <button type="button" className="tg" role="switch" aria-checked={markNew} aria-labelledby="ft-l" onClick={() => setMarkNew(!markNew)}>
                  <span />
                </button>
                <span id="ft-l" className="se-toggle-l">
                  Mark as New in the library
                </span>
              </div>
            </section>
          </aside>
        </div>

        {notice && <Toast notice={notice} onDismiss={() => setNotice(null)} />}
      </main>
    </>
  )
}

function UnitField(props: {
  id: string
  label: string
  unit: string
  mode: 'numeric' | 'decimal'
  value: string
  error?: string
  errorId: string
  onChange: (value: string) => void
}) {
  return (
    <div className="fg">
      <label htmlFor={props.id} className="lbl">
        {props.label}
      </label>
      <div className="unit">
        <input
          id={props.id}
          className="field"
          inputMode={props.mode}
          value={props.value}
          onChange={(event) => props.onChange(event.target.value)}
          aria-invalid={props.error !== undefined}
          aria-describedby={props.error !== undefined ? props.errorId : undefined}
        />
        <span aria-hidden="true">{props.unit}</span>
      </div>
      {props.error !== undefined && (
        <span id={props.errorId} className="err">
          {props.error}
        </span>
      )}
    </div>
  )
}

/** UploadDropZone.dc.html, idle. Recording uploads arrive with their own story. */
function DropZone({ label }: { label: string }) {
  return (
    <div className="udz">
      <span className="udz-label">{label}</span>
      <div className="udz-zone">
        <span aria-hidden="true" className="udz-icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="2.6" strokeLinecap="square">
            <path d="M12 16V4M7 9l5-5 5 5M4 20h16" />
          </svg>
        </span>
        <div className="udz-text">
          <span className="udz-drop">Drag a WAV or FLAC here</span>
          <span className="mono udz-accept">48 kHz · 24-bit · mono · under 10 MB</span>
        </div>
        <label className="udz-btn udz-pick" aria-disabled="true">
          Choose file
          <input type="file" accept=".wav,.flac,audio/wav,audio/flac" aria-label={`Choose a ${label.toLowerCase()} file`} disabled />
        </label>
      </div>
    </div>
  )
}
