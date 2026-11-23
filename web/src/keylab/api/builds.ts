import { get, keylab, type Schemas } from './client.ts'

// A member's saved builds (US-08): BLD-01 lists them, BLD-02 saves one with an
// Idempotency-Key so a retried click never makes two, BLD-04 renames or
// changes one with If-Match. A build's `version` is its ETag's value.

export type Build = Schemas['Build']
export type BuildInput = Schemas['BuildInput']
export type Layout = Build['layout']

export type BuildsPage = { data: Build[]; nextPageToken: string | null }

/** BLD-01: public and private, newest change first. */
export async function listMyBuilds(query: { page_size?: number; page_token?: string } = {}): Promise<BuildsPage> {
  const page = await get('/me/builds', { query })
  return { data: page.data, nextPageToken: page.page.nextPageToken ?? null }
}

/** BLD-02. Starts private. 422 names each part that is not offered any more. */
export async function createBuild(body: BuildInput, idempotencyKey: string): Promise<Build> {
  const response = await keylab.post<Build>('/builds', body, {
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
  })
  return response.data
}

/** The If-Match tag of a build as the API sent it. */
export function etagOf(build: Pick<Build, 'version'>): string {
  return `"${build.version ?? 0}"`
}

/**
 * BLD-04, JSON Merge Patch: fields left out keep their value. Rejects with
 * 412 precondition_failed when the build changed since `version`.
 */
export async function updateBuild(id: string, patch: Record<string, unknown>, version: number | undefined): Promise<Build> {
  const response = await keylab.patch<Build>(`/builds/${encodeURIComponent(id)}`, patch, {
    headers: { 'Content-Type': 'application/merge-patch+json', 'If-Match': etagOf({ version }) },
  })
  return response.data
}

/**
 * BLD-05: soft delete. Afterwards the build is 404 everywhere, its link
 * included. Rejects with 412 when the build changed since `version`.
 */
export async function deleteBuild(id: string, version: number | undefined): Promise<void> {
  await keylab.delete(`/builds/${encodeURIComponent(id)}`, { headers: { 'If-Match': etagOf({ version }) } })
}
