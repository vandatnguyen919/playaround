import { get, toSearchParams, type Schemas } from './client.ts'

// The builder's parts besides switches (CAT-05 to CAT-07) and the sound recipe
// (BLD-10). Both are public and cached for 300 s; recipes are also kept in
// memory for the page's life, so toggling back to a mix heard before answers
// at once (US-05: under 100 ms from cache).

export type Mod = Schemas['Mod']
export type KeycapSet = Schemas['KeycapSet']
export type SoundRecipe = Schemas['SoundRecipe']

/** CAT-07: every live mod, in the order the builder shows them. One page holds them all. */
export async function listMods(): Promise<Mod[]> {
  const page = await get('/mods', { query: { page_size: 100 } })
  return page.data
}

/** CAT-05: every published keycap set, in the editors' order. One page holds them all. */
export async function listKeycapSets(): Promise<KeycapSet[]> {
  const page = await get('/keycap-sets', { query: { page_size: 100 } })
  return page.data
}

/** CAT-06: one keycap set with its colourway; rejects with 404 keycap_set_not_found for a draft, hidden or unknown slug. */
export function getKeycapSet(slug: string): Promise<KeycapSet> {
  return get('/keycap-sets/{slug}', { path: { slug } })
}

export type RecipeQuery = {
  switch: string
  variant?: 'stock' | 'lubed' | 'foam'
  /** `slug` for a toggle mod, `slug:level` for a level mod. */
  mod?: string[]
  keycap_set?: string
  case_material?: string
  plate?: string
  mount?: string
}

/**
 * The query string of a recipe, with the `mod` values sorted and the
 * parameters in a fixed order: equal mixes make equal URLs, so they share one
 * entry in the browser's HTTP cache and in ours (api-design-v1.md, BLD-10).
 */
export function recipeSearch(query: RecipeQuery): string {
  return toSearchParams(normalized(query)).toString()
}

function normalized(query: RecipeQuery): RecipeQuery {
  return {
    switch: query.switch,
    variant: query.variant,
    mod: query.mod && query.mod.length > 0 ? [...query.mod].sort() : undefined,
    keycap_set: query.keycap_set,
    case_material: query.case_material,
    plate: query.plate,
    mount: query.mount,
  }
}

const recipes = new Map<string, Promise<SoundRecipe>>()
const answered = new Map<string, SoundRecipe>()

/** BLD-10, from memory when this exact mix was asked for before. A failed call is forgotten. */
export function getSoundRecipe(query: RecipeQuery): Promise<SoundRecipe> {
  const key = recipeSearch(query)
  let pending = recipes.get(key)
  if (!pending) {
    pending = get('/sound-recipe', { query: normalized(query) })
    pending.then(
      (recipe) => answered.set(key, recipe),
      () => recipes.delete(key),
    )
    recipes.set(key, pending)
  }
  return pending
}

/** The recipe of a mix already answered, at once, so a toggle back renders without waiting. */
export function cachedRecipe(query: RecipeQuery): SoundRecipe | undefined {
  return answered.get(recipeSearch(query))
}
