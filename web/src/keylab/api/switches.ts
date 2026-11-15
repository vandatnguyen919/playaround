import { get, type Schemas } from './client.ts'

// The public switch library (CAT-01 to CAT-04). Guests welcome; answers are
// cached for 300 s, so the browser revalidates with the ETag on its own.

export type SwitchSummary = Schemas['SwitchSummary']
export type SwitchDetail = Schemas['Switch']
export type Recording = Schemas['Recording']
export type SwitchSounds = Schemas['SwitchSounds']

export type LibraryQuery = {
  type?: string
  profile?: string
  sound?: 'recorded' | 'missing'
  q?: string
  force_min?: number
  force_max?: number
  sort?: 'popular' | '-publishedAt' | 'force'
  page_size?: number
  page_token?: string
}

export type LibraryPage = { data: SwitchSummary[]; nextPageToken: string | null }

export async function listSwitches(query: LibraryQuery): Promise<LibraryPage> {
  const page = await get('/switches', { query })
  return { data: page.data, nextPageToken: page.page.nextPageToken ?? null }
}

/** CAT-02 with its recordings and the "Sounds similar" four. */
export async function getSwitch(slug: string): Promise<SwitchDetail> {
  return get('/switches/{slug}', { path: { slug }, query: { include: 'sounds,related' } })
}

/** CAT-03: what a card plays. */
export async function getSwitchSounds(slug: string): Promise<SwitchSounds> {
  return get('/switches/{slug}/sounds', { path: { slug } })
}
