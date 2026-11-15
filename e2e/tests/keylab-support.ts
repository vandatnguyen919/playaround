// KeyLab test data. Sound uploads arrive with US-38; until then a test marks a
// switch's stock press and release as ready the way catalog's SoundProcessed
// listener would, straight in the dev Postgres (catalog.switch_recordings).
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import type { Page } from '@playwright/test'

const PG_CONTAINER =
  process.env.KEYLAB_PG_CONTAINER ?? `${process.env.COMPOSE_PROJECT_NAME ?? 'authn-authz-playground'}-postgres-1`

function psql(sql: string): string {
  return execFileSync('docker', ['exec', '-i', PG_CONTAINER, 'psql', '-U', 'keylab', '-d', 'keylab', '-v', 'ON_ERROR_STOP=1', '-tA'], {
    input: sql,
    encoding: 'utf8',
  })
}

/** What catalog keeps when sound reports the stock press and release ready. */
export function markStockSoundsReady(switchId: string): void {
  if (!/^[0-9a-f-]{36}$/.test(switchId)) {
    throw new Error(`Not a switch id: ${switchId}`)
  }
  const rows = ['press', 'release']
    .map(
      (stroke) =>
        `('${switchId}', 'stock', '${stroke}', '${randomUUID()}', 'https://cdn.keylab.test/assets/sounds/${stroke}.opus', 180, -14.5, '[0.1,0.8,0.3]', now())`,
    )
    .join(', ')
  psql(`
    INSERT INTO catalog.switch_recordings (switch_id, variant, stroke, recording_id, url, duration_ms, loudness_lufs, peaks, processed_at)
    VALUES ${rows}
    ON CONFLICT (switch_id, variant, stroke) DO NOTHING;
    UPDATE catalog.switches SET sound_status = 'recorded' WHERE id = '${switchId}';
  `)
}

export async function xsrf(page: Page): Promise<string> {
  return (await page.context().cookies()).find((c) => c.name === 'XSRF-TOKEN')?.value ?? ''
}

export type SwitchSeed = { name: string; type?: string; profile?: string; forceG?: number; stemColor?: string }

/** A draft through ADM-02, as the signed-in editor on this page. */
export async function createDraft(page: Page, seed: SwitchSeed): Promise<{ id: string; slug: string; name: string }> {
  // A first GET hands out the XSRF cookie the POST needs.
  await page.request.get('/bff/keylab/v1/health')
  const res = await page.request.post('/bff/keylab/v1/admin/switches', {
    data: {
      name: seed.name,
      brand: 'E2E Works',
      type: seed.type ?? 'tactile',
      profile: seed.profile ?? 'poppy',
      stemColor: seed.stemColor ?? '#F16B53',
      forceG: seed.forceG ?? 62,
      actuationMm: 2.0,
      travelMm: 3.8,
      housing: 'milky',
      forceCurve: [
        { travelMm: 0, forceG: 0 },
        { travelMm: 0.4, forceG: 38 },
        { travelMm: 0.8, forceG: 76 },
        { travelMm: 2.0, forceG: 62 },
        { travelMm: 3.8, forceG: 92 },
      ],
    },
    headers: { 'X-XSRF-TOKEN': await xsrf(page), 'Idempotency-Key': randomUUID() },
  })
  if (res.status() !== 201) {
    throw new Error(`Create switch failed: HTTP ${res.status()} ${await res.text()}`)
  }
  const sw = await res.json()
  return { id: sw.id, slug: sw.slug, name: sw.name }
}

/** ADM-03 straight through the API, for setup and clean-up. */
export async function setPublished(page: Page, id: string, published: boolean, markNew = false): Promise<number> {
  const headers = { 'X-XSRF-TOKEN': await xsrf(page) }
  const url = `/bff/keylab/v1/admin/switches/${id}/publication`
  const res = published
    ? await page.request.post(url, { data: { markNew }, headers })
    : await page.request.delete(url, { headers })
  return res.status()
}
