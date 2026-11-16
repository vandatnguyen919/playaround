import { deflateSync, crc32 } from 'node:zlib'
import { expect, test, type Page } from '@playwright/test'
import { createUser, deleteUser, newUser, signIn } from './support'
import { createDraft, xsrf } from './keylab-support'

// US-38, end to end: an editor uploads press and release recordings and a
// photo. Browser → Vite → gateway BFF → keylab-api: ADM-04 ticket, signed PUT,
// attach (202), processing to ready or failed (ADM-05), catalog hearing of it
// (the publish checklist), and the photo on ADM-02.
const editor = newUser('keylab-sounds')

test.beforeAll(async () => {
  await createUser(editor, ['keylab-editor'])
})

test.afterAll(async () => {
  await deleteUser(editor.email)
})

/** A mono PCM WAV: 100 ms of silence, then a decaying 1 kHz click. */
function wav(rate = 48_000, bits = 24, channels = 1, seconds = 0.2): Buffer {
  const frames = Math.round(rate * seconds)
  const bytes = bits / 8
  const data = Buffer.alloc(frames * bytes * channels)
  const full = 2 ** (bits - 1) - 1
  for (let i = 0; i < frames; i++) {
    const t = (i - rate / 10) / rate
    const v = t < 0 ? 0 : 0.5 * Math.exp(-t * 40) * Math.sin(2 * Math.PI * 1000 * t)
    for (let c = 0; c < channels; c++) {
      data.writeIntLE(Math.round(v * full), (i * channels + c) * bytes, bytes)
    }
  }
  const head = Buffer.alloc(44)
  head.write('RIFF', 0)
  head.writeUInt32LE(36 + data.length, 4)
  head.write('WAVEfmt ', 8)
  head.writeUInt32LE(16, 16)
  head.writeUInt16LE(1, 20)
  head.writeUInt16LE(channels, 22)
  head.writeUInt32LE(rate, 24)
  head.writeUInt32LE(rate * channels * bytes, 28)
  head.writeUInt16LE(channels * bytes, 32)
  head.writeUInt16LE(bits, 34)
  head.write('data', 36)
  head.writeUInt32LE(data.length, 40)
  return Buffer.concat([head, data])
}

/** A plain coral PNG, size × size. */
function png(size: number): Buffer {
  const chunk = (type: string, body: Buffer) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(body.length)
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type), body])))
    return Buffer.concat([len, Buffer.from(type), body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: size }, () => [0xf1, 0x6b, 0x53]).flat())])
  const raw = Buffer.concat(Array.from({ length: size }, () => row))
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

async function shot(page: Page, path: string): Promise<string> {
  await page.screenshot({ path, fullPage: true })
  return path
}

test('an editor uploads recordings and a photo and sees them processed', async ({ page }, testInfo) => {
  test.setTimeout(150_000)
  await signIn(page, editor)
  await page.setViewportSize({ width: 1440, height: 1400 })
  const name = `Coral Pop ${Date.now().toString(36)}`
  const sw = await createDraft(page, { name })

  // --- Sound library: no sound yet ---------------------------------------------------
  await page.goto(`/keylab/admin/sounds?switch=${sw.id}`)
  await expect(page.getByRole('heading', { level: 1, name: 'Sound library' })).toBeVisible()
  await expect(page.getByRole('heading', { level: 2, name })).toBeVisible()
  await page.getByLabel('Find a switch').fill(name)
  const pick = page.getByRole('navigation', { name: 'Switches with recordings' }).getByRole('button', { name: new RegExp(name) })
  await expect(pick).toContainText('0 FILES')
  await expect(pick).toContainText('Missing')
  await expect(page.getByText('No sound available yet')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Open switch' })).toHaveAttribute('href', `/keylab/admin/switches/${sw.id}`)
  await testInfo.attach('sound library, no sound', { path: await shot(page, testInfo.outputPath('sounds-empty.png')), contentType: 'image/png' })

  // --- A good press take: 202, processing, then ready with length and loudness -----
  const attached = page.waitForResponse((res) => /\/admin\/switches\/[^/]+\/sounds$/.test(res.url()) && res.request().method() === 'POST')
  await page.getByLabel(/drop a \.wav file$/).setInputFiles({ name: 'coral-pop_stock_press.wav', mimeType: 'audio/wav', buffer: wav() })
  expect((await attached).status()).toBe(202)
  await expect(page.getByRole('status').filter({ hasText: 'Recording uploaded' })).toBeVisible()
  const pressRow = page.getByRole('tabpanel', { name: 'Stock recordings' }).locator('.snd-vt').nth(1)
  await expect(pressRow).toContainText('Recorded')
  await expect(pressRow).toContainText('0.20 s')
  await expect(pressRow).toContainText(/−\d+ LUFS/)
  await expect(pressRow.getByRole('img', { name: 'Waveform of the stock press' })).toBeVisible()
  await expect(pick).toContainText('1 FILE')
  await expect(page.getByText('coral-pop_stock_press.wav · 48 kHz · 24-bit')).toBeVisible()

  // --- A CD-quality release take is refused by processing, with the reason ---------
  await page.getByLabel('Stroke').selectOption('release')
  await page.getByLabel(/drop a \.wav file$/).setInputFiles({ name: 'cd.wav', mimeType: 'audio/wav', buffer: wav(44_100, 16, 2) })
  await expect(page.getByRole('alert').filter({ hasText: 'That file can’t be used' })).toContainText(
    'It is 44.1 kHz, 16-bit stereo. Upload a 48 kHz, 24-bit mono WAV.',
  )
  const releaseRow = page.getByRole('tabpanel', { name: 'Stock recordings' }).locator('.snd-vt').nth(2)
  await expect(releaseRow).toContainText('Failed')
  // A FLAC never leaves the browser.
  await page.getByRole('button', { name: 'Try again' }).click()
  await page.getByLabel(/drop a \.wav file$/).setInputFiles({ name: 'take.flac', mimeType: 'audio/flac', buffer: Buffer.from('fLaC') })
  await expect(page.getByRole('alert').filter({ hasText: 'Only WAV files work here.' })).toBeVisible()
  await testInfo.attach('sound library, press ready, release failed', { path: await shot(page, testInfo.outputPath('sounds-library.png')), contentType: 'image/png' })

  // --- The switch page: press shows as uploaded; the release goes in from here -----
  await page.goto(`/keylab/admin/switches/${sw.id}`)
  await expect(page.getByRole('heading', { level: 1, name: 'Edit switch' })).toBeVisible()
  const checklist = page.getByRole('list').filter({ hasText: 'Stock press sound' })
  await expect(checklist.getByRole('listitem').filter({ hasText: 'Stock press sound' })).toContainText('done')
  await expect(checklist.getByRole('listitem').filter({ hasText: 'Stock release sound' })).toContainText('to do')
  await expect(page.getByRole('button', { name: 'Play stock · press sound' })).toBeVisible()
  await page.getByLabel('Choose a stock · release sound file').setInputFiles({ name: 'coral-pop_stock_release.wav', mimeType: 'audio/wav', buffer: wav() })
  await expect(page.getByRole('button', { name: 'Play stock · release sound' })).toBeVisible({ timeout: 30_000 })
  await expect(checklist.getByRole('listitem').filter({ hasText: 'Stock release sound' })).toContainText('done')
  await expect(page.getByText('Everything required is in. Publishing makes it visible to everyone.')).toBeVisible()

  // --- Photo: too small is refused, a square 800 px PNG attaches --------------------
  await page.getByLabel('Choose a switch photo').setInputFiles({ name: 'small.png', mimeType: 'image/png', buffer: png(200) })
  await expect(page.getByRole('alert').filter({ hasText: 'The photo is 200 px wide. Use at least 800 px.' })).toBeVisible()
  await page.getByLabel('Choose a switch photo').setInputFiles({ name: 'coral-pop.png', mimeType: 'image/png', buffer: png(800) })
  await expect(checklist.getByRole('listitem').filter({ hasText: 'Photo (optional)' })).toContainText('done')
  await expect(page.locator('.se-photo-img img')).toHaveAttribute('src', /\/bff\/keylab\/v1\/assets\/photos\/[0-9a-f]{64}\.png$/)
  await testInfo.attach('switch page with sounds and photo', { path: await shot(page, testInfo.outputPath('switch-edit-sounds.png')), contentType: 'image/png' })

  // The recorded file is served from the app's own origin, cached for good.
  const library = await page.request.get(`/bff/keylab/v1/admin/sounds?switch_id=${sw.id}`)
  const ready = (await library.json()).data.find((s: { status: string }) => s.status === 'ready')
  const file = await page.request.get(ready.url)
  expect(file.status()).toBe(200)
  expect(file.headers()['content-type']).toBe('audio/wav')
  expect(file.headers()['cache-control']).toContain('immutable')

  // Clean up: the draft goes (its takes stay in the sound schema, by id only).
  const current = await page.request.get(`/bff/keylab/v1/admin/switches/${sw.id}`)
  await page.request.delete(`/bff/keylab/v1/admin/switches/${sw.id}`, {
    headers: { 'X-XSRF-TOKEN': await xsrf(page), 'If-Match': current.headers()['etag'] },
  })
})
