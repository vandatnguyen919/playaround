import type { ModLevels } from './mods.ts'

// The build being made, kept in this browser until builds can be saved
// (US-08). Storage may be blocked (private mode): then it lives for the page
// only, and the pages still work.

const KEY = 'keylab.build'

export type BuildState = { switch?: string; mods?: ModLevels; keycapSet?: string }

export function loadBuild(): BuildState {
  try {
    const raw = window.localStorage.getItem(KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : {}
    if (!parsed || typeof parsed !== 'object') {
      return {}
    }
    const held = parsed as Record<string, unknown>
    const mods: ModLevels = {}
    if (held.mods && typeof held.mods === 'object') {
      for (const [slug, level] of Object.entries(held.mods as Record<string, unknown>)) {
        if (typeof level === 'number') {
          mods[slug] = level
        }
      }
    }
    return {
      switch: typeof held.switch === 'string' ? held.switch : undefined,
      mods,
      keycapSet: typeof held.keycapSet === 'string' ? held.keycapSet : undefined,
    }
  } catch {
    return {}
  }
}

export function saveBuild(change: BuildState): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ ...loadBuild(), ...change }))
  } catch {
    // Blocked storage: the build lasts as long as the page.
  }
}
