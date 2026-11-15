import { useRef, useState } from 'react'
import { getSwitchSounds, type Recording } from '../api/switches.ts'
import { play, playlist, stopSounds } from './sounds.ts'

// Library cards play their stock press on pointer down and the release on
// pointer up. Recordings come from CAT-03 the first time a card is pressed
// and are kept for the page's life.

export function useCardPlayer(): {
  playing: string | null
  failed: string | null
  onPress: (slug: string) => (stroke: 'press' | 'release') => void
} {
  const cache = useRef(new Map<string, Promise<Recording[]>>())
  const [playing, setPlaying] = useState<string | null>(null)
  const [failed, setFailed] = useState<string | null>(null)

  function sounds(slug: string): Promise<Recording[]> {
    let pending = cache.current.get(slug)
    if (!pending) {
      pending = getSwitchSounds(slug).then((s) => s.data)
      pending.catch(() => cache.current.delete(slug))
      cache.current.set(slug, pending)
    }
    return pending
  }

  function onPress(slug: string) {
    return (stroke: 'press' | 'release') => {
      setFailed(null)
      setPlaying(slug)
      sounds(slug)
        .then((recordings) => play(playlist(recordings, 'stock', stroke)))
        .catch(() => {
          stopSounds()
          setFailed(slug)
        })
        .finally(() => setPlaying((now) => (now === slug && stroke === 'release' ? null : now)))
    }
  }

  return { playing, failed, onPress }
}
