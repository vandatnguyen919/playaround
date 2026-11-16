import { keylab, type Schemas } from './client.ts'
import type { AdminSwitch } from './adminSwitches.ts'

// ADM-04 and ADM-05 (US-38): a presigned upload, the file PUT to it, then a
// recording attached to a switch slot, processed in the background. Photos
// use the same uploads (purpose switch_photo) and attach on ADM-02.

export type AdminSound = Schemas['AdminSound']
export type UploadTicket = Schemas['UploadTicket']
export type Purpose = 'sound' | 'switch_photo'

export async function requestUpload(purpose: Purpose, file: File, contentType: string): Promise<UploadTicket> {
  const response = await keylab.post<UploadTicket>(
    '/admin/uploads',
    { purpose, contentType, bytes: file.size, fileName: file.name },
    { headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() } },
  )
  return response.data
}

/**
 * PUTs the file to the ticket's URL. The URL may be relative to this origin
 * (keylab-api stores files itself); made absolute here so it does not get the
 * client's /bff/keylab/v1 prefix twice. Same origin, so the XSRF header goes along.
 */
export async function putFile(ticket: UploadTicket, file: File, onProgress?: (percent: number) => void): Promise<void> {
  await keylab.put(new URL(ticket.url, window.location.origin).href, file, {
    headers: { ...(ticket.headers ?? {}) },
    onUploadProgress: (event) => {
      if (onProgress && event.total) {
        onProgress(Math.round((event.loaded / event.total) * 100))
      }
    },
  })
}

export async function attachSound(
  switchId: string,
  uploadId: string,
  variant: 'stock' | 'lubed' | 'foam',
  stroke: 'press' | 'release',
): Promise<AdminSound> {
  const response = await keylab.post<AdminSound>(
    `/admin/switches/${encodeURIComponent(switchId)}/sounds`,
    { uploadId, variant, stroke },
    { headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() } },
  )
  return response.data
}

export async function getSound(id: string): Promise<AdminSound> {
  const response = await keylab.get<AdminSound>(`/admin/sounds/${encodeURIComponent(id)}`)
  return response.data
}

type Page<T> = { data: T[]; page: { nextPageToken?: string | null } }

/** Every page of a list, up to {@code maxPages} of 100. */
async function all<T>(path: string, params: Record<string, string>, maxPages = 20): Promise<T[]> {
  const items: T[] = []
  let token: string | null | undefined
  for (let n = 0; n < maxPages; n++) {
    const response = await keylab.get<Page<T>>(path, {
      params: { ...params, page_size: 100, ...(token ? { page_token: token } : {}) },
    })
    items.push(...response.data.data)
    token = response.data.page.nextPageToken
    if (!token) {
      break
    }
  }
  return items
}

/** ADM-05: recordings, newest first, for one switch or all. */
export function listSounds(switchId?: string): Promise<AdminSound[]> {
  return all<AdminSound>('/admin/sounds', switchId ? { switch_id: switchId } : {})
}

/** ADM-02 list, drafts included, by name. */
export function listAdminSwitches(q: string): Promise<AdminSwitch[]> {
  return all<AdminSwitch>('/admin/switches', q.trim() ? { q: q.trim() } : {}, 5)
}
