import { keylab, type Schemas } from './client.ts'

// ADM-02 for one switch (US-37). GET returns the ETag that PATCH and DELETE
// send back as If-Match; a create sends an Idempotency-Key so a retried
// click never makes two switches.

export type AdminSwitch = Schemas['AdminSwitch']

export type Versioned = { sw: AdminSwitch; etag: string }

function etagOf(headers: unknown): string {
  const value = (headers as Record<string, unknown>)['etag']
  return typeof value === 'string' ? value : ''
}

export async function getSwitch(id: string): Promise<Versioned> {
  const response = await keylab.get<AdminSwitch>(`/admin/switches/${encodeURIComponent(id)}`)
  return { sw: response.data, etag: etagOf(response.headers) }
}

export async function createSwitch(body: unknown, idempotencyKey: string): Promise<Versioned> {
  const response = await keylab.post<AdminSwitch>('/admin/switches', body, {
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
  })
  return { sw: response.data, etag: etagOf(response.headers) }
}

/** JSON Merge Patch: fields left out keep their value, null clears one. */
export async function updateSwitch(id: string, patch: unknown, etag: string): Promise<Versioned> {
  const response = await keylab.patch<AdminSwitch>(`/admin/switches/${encodeURIComponent(id)}`, patch, {
    headers: { 'Content-Type': 'application/merge-patch+json', 'If-Match': etag },
  })
  return { sw: response.data, etag: etagOf(response.headers) }
}

export async function deleteSwitch(id: string, etag: string): Promise<void> {
  await keylab.delete(`/admin/switches/${encodeURIComponent(id)}`, { headers: { 'If-Match': etag } })
}

/**
 * ADM-03 (US-39): into the public library. 409 missing_required_sounds until
 * the stock press and release recordings are ready.
 */
export async function publishSwitch(id: string, markNew: boolean): Promise<Versioned> {
  const response = await keylab.post<AdminSwitch>(
    `/admin/switches/${encodeURIComponent(id)}/publication`,
    { markNew },
    { headers: { 'Content-Type': 'application/json' } },
  )
  return { sw: response.data, etag: etagOf(response.headers) }
}

/** ADM-03: out of the public library. The switch stays for builds that use it. */
export async function unpublishSwitch(id: string): Promise<void> {
  await keylab.delete(`/admin/switches/${encodeURIComponent(id)}/publication`)
}
