import { useState, type DragEvent } from 'react'
import { play, stopSounds } from '../../catalog/sounds.ts'
import type { UploadState } from './useSoundUpload.ts'
import StrokeWave from './StrokeWave.tsx'

// UploadDropZone.dc.html: idle (and drag-over), uploading, done, error. The
// upload itself runs in useSoundUpload; this draws it.

export default function UploadDropZone({
  label,
  state,
  onFile,
  onReset,
  doneNote = 'Levels OK · ready to publish',
}: {
  label: string
  state: UploadState
  onFile: (file: File) => void
  onReset: () => void
  doneNote?: string
}) {
  const [over, setOver] = useState(false)
  const [playError, setPlayError] = useState(false)
  const lower = label.toLowerCase()

  const drop = (event: DragEvent) => {
    event.preventDefault()
    setOver(false)
    const file = event.dataTransfer?.files?.[0]
    if (file) {
      onFile(file)
    }
  }

  return (
    <div className="udz">
      <span className="udz-label">{label}</span>

      {state.step === 'idle' && (
        <div
          className={over ? 'udz-zone over' : 'udz-zone'}
          onDragOver={(event) => {
            event.preventDefault()
            setOver(true)
          }}
          onDragLeave={() => setOver(false)}
          onDrop={drop}
        >
          <span aria-hidden="true" className="udz-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="2.6" strokeLinecap="square">
              <path d="M12 16V4M7 9l5-5 5 5M4 20h16" />
            </svg>
          </span>
          <div className="udz-text">
            <span className="udz-drop">{over ? 'Drop to upload' : 'Drag a WAV here'}</span>
            <span className="mono udz-accept">48 kHz · 24-bit · mono · under 10 MB</span>
          </div>
          <label className="udz-btn udz-pick">
            Choose file
            <input
              type="file"
              accept=".wav,audio/wav"
              aria-label={`Choose a ${lower} file`}
              onChange={(event) => {
                const file = event.target.files?.[0]
                event.target.value = ''
                if (file) {
                  onFile(file)
                }
              }}
            />
          </label>
        </div>
      )}

      {state.step === 'uploading' && (
        <div className="udz-busy" aria-busy="true">
          <div className="udz-busy-row">
            <span className="mono udz-file">{state.file}</span>
            <span className="udz-busy-note">Uploading and checking levels…</span>
          </div>
          <div
            role="progressbar"
            aria-label="Upload progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={state.percent}
            className="udz-bar"
          >
            <span style={{ width: `${state.percent}%` }} />
          </div>
        </div>
      )}

      {state.step === 'done' && (
        <div className="udz-done">
          <div className="udz-done-row">
            <button
              type="button"
              className="udz-btn coral udz-play"
              aria-label={`Play ${lower}`}
              onClick={() => {
                setPlayError(false)
                stopSounds()
                if (state.sound.url) {
                  play([{ variant: state.sound.variant, stroke: state.sound.stroke, url: state.sound.url }]).catch(() => setPlayError(true))
                }
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="#000" aria-hidden="true">
                <path d="M6 4v16l14-8z" />
              </svg>
            </button>
            <div className="udz-done-text">
              <span className="mono udz-file">{state.sound.fileName ?? 'recording.wav'}</span>
              <span className="udz-done-note">{playError ? 'This sound could not be played.' : doneNote}</span>
            </div>
            <span className="udz-chip">Uploaded</span>
            <button type="button" className="udz-btn" onClick={onReset}>
              Replace
            </button>
          </div>
          <StrokeWave peaks={state.sound.peaks} height={44} label={`Waveform of the ${lower}`} />
        </div>
      )}

      {state.step === 'error' && (
        <div className="udz-error" role="alert">
          <div className="udz-error-text">
            <span className="udz-error-title">That file can’t be used</span>
            <span className="udz-error-body">{state.message}</span>
          </div>
          <button type="button" className="udz-btn" onClick={onReset}>
            Try again
          </button>
        </div>
      )}
    </div>
  )
}
