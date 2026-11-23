import type { ModLevels } from './mods.ts'

// The build being made, kept in this browser. Once it is saved (US-08),
// `saved` names the saved build, so Save build changes that build instead of
// making another, and the sidebar shows it as the current build. Storage may
// be blocked (private mode): then it lives for the page only, and the pages
// still work.

const KEY = 'keylab.build'

/** The case as BuildParts keeps it (US-07): material, plate and mount slugs and the case colour. */
export type BuildCase = { material?: string; color?: string; plate?: string; mount?: string }

/** The saved build this one is, with the version its next change names in If-Match and its sidebar line. */
export type SavedRef = { id: string; name: string; version: number; spec: string }

export type BuildState = { switch?: string; mods?: ModLevels; keycapSet?: string; case?: BuildCase; saved?: SavedRef }

/** Fired on window when the build changes, so the sidebar's current build follows. */
export const BUILD_EVENT = 'keylab-build'

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
      case: caseOf(held.case),
      saved: savedOf(held.saved),
    }
  } catch {
    return {}
  }
}

function caseOf(raw: unknown): BuildCase | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined
  }
  const held = raw as Record<string, unknown>
  const text = (v: unknown) => (typeof v === 'string' ? v : undefined)
  return { material: text(held.material), color: text(held.color), plate: text(held.plate), mount: text(held.mount) }
}

function savedOf(raw: unknown): SavedRef | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined
  }
  const held = raw as Record<string, unknown>
  if (typeof held.id !== 'string' || typeof held.name !== 'string' || typeof held.version !== 'number') {
    return undefined
  }
  return { id: held.id, name: held.name, version: held.version, spec: typeof held.spec === 'string' ? held.spec : '' }
}

export function saveBuild(change: BuildState): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ ...loadBuild(), ...change }))
  } catch {
    // Blocked storage: the build lasts as long as the page.
  }
  try {
    window.dispatchEvent(new Event(BUILD_EVENT))
  } catch {
    // No window events (tests): nothing listens anyway.
  }
}

/** Starts a new build from the parts on hand: the next Save build makes a new saved build. */
export function forgetSaved(): void {
  saveBuild({ saved: undefined })
}
