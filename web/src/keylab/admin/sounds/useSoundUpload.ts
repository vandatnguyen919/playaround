import { useCallback, useEffect, useRef, useState } from 'react'
import { attachSound, getSound, putFile, requestUpload, type AdminSound } from '../../api/adminSounds.ts'
import { toApiProblem } from '../../api/problem.ts'
import { checkWav, refuseFile, type Stroke, type Variant } from './soundLibrary.ts'

// One drop zone's upload (US-38): refuse what the browser can tell is wrong,
// get a ticket, PUT the file, attach it to the slot (202), then poll until
// processing says ready or failed.

export type UploadState =
  | { step: 'idle' }
  | { step: 'uploading'; file: string; percent: number }
  | { step: 'done'; sound: AdminSound }
  | { step: 'error'; file?: string; message: string }

const POLL_MS = 1000
const POLL_LIMIT = 120

export function useSoundUpload(options: {
  /** The switch to attach to; may save a new switch first. Null stops the upload with no message. */
  switchId: () => Promise<string | null>
  variant: Variant
  stroke: Stroke
  /** The slot's current ready take, shown as done until a new upload starts. */
  current?: AdminSound
  onAttached?: (sound: AdminSound) => void
  onDone?: (sound: AdminSound) => void
}) {
  const [state, setState] = useState<UploadState>(options.current ? { step: 'done', sound: options.current } : { step: 'idle' })
  const alive = useRef(true)
  const busy = state.step === 'uploading'
  const current = options.current

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  // A take that arrives from elsewhere (the page loads, another upload ends) shows unless one is running.
  useEffect(() => {
    setState((now) => (now.step === 'uploading' ? now : current ? { step: 'done', sound: current } : now.step === 'error' ? now : { step: 'idle' }))
  }, [current?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const upload = useCallback(
    async (file: File) => {
      const refused = refuseFile(file, 'sound') ?? (await checkWav(file))
      if (refused) {
        if (alive.current) {
          setState({ step: 'error', file: file.name, message: refused })
        }
        return
      }
      setState({ step: 'uploading', file: file.name, percent: 4 })
      try {
        const switchId = await options.switchId()
        if (switchId === null) {
          setState(current ? { step: 'done', sound: current } : { step: 'idle' })
          return
        }
        const ticket = await requestUpload('sound', file, 'audio/wav')
        await putFile(ticket, file, (percent) => {
          if (alive.current) {
            // The file is most of the wait; processing takes the last stretch.
            setState({ step: 'uploading', file: file.name, percent: Math.min(80, 4 + Math.round(percent * 0.76)) })
          }
        })
        let sound = await attachSound(switchId, ticket.uploadId, options.variant, options.stroke)
        options.onAttached?.(sound)
        for (let n = 0; sound.status === 'processing' && n < POLL_LIMIT; n++) {
          if (!alive.current) {
            return
          }
          setState({ step: 'uploading', file: file.name, percent: Math.min(96, 82 + n * 2) })
          await new Promise((resolve) => setTimeout(resolve, POLL_MS))
          sound = await getSound(sound.id ?? '')
        }
        if (!alive.current) {
          return
        }
        if (sound.status === 'ready') {
          setState({ step: 'done', sound })
        } else {
          setState({
            step: 'error',
            file: file.name,
            message: sound.error ?? 'It is still processing. Check the sound library in a minute.',
          })
        }
        options.onDone?.(sound)
      } catch (error) {
        if (alive.current) {
          const problem = toApiProblem(error)
          setState({ step: 'error', file: file.name, message: problem.errors[0]?.message ?? problem.userMessage })
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [options.variant, options.stroke, options.switchId, current?.id],
  )

  const reset = useCallback(() => setState({ step: 'idle' }), [])

  return { state, upload, reset, busy }
}
