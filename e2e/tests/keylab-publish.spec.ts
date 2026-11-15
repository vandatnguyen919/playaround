import { expect, test, type Page } from '@playwright/test'
import { createUser, deleteUser, newUser, signIn } from './support'
import { createDraft, markStockSoundsReady, setPublished } from './keylab-support'

// US-39, end to end: an editor can publish a switch only once its stock
// press and release sounds are ready, and then it shows in the public
// library with the New sticker. Browser → Vite → gateway BFF → keylab-api
// (ADM-03, CAT-01) → Postgres. Sound uploads are US-38, so the test marks the
// stock sounds ready in the database the way the SoundProcessed listener does.
const editor = newUser('keylab-publisher')
let published: string | null = null

test.beforeAll(async () => {
  await createUser(editor, ['keylab-editor'])
})

test.afterAll(async ({ browser }) => {
  if (published) {
    // Pull it again, so the dev library does not fill up with test switches.
    const page = await browser.newPage()
    await signIn(page, editor)
    await setPublished(page, published, false)
    await page.close()
  }
  await deleteUser(editor.email)
})

async function shot(page: Page, path: string): Promise<string> {
  await page.screenshot({ path, fullPage: true })
  return path
}

test('an editor publishes a switch once its stock sounds exist, and it shows in the public library', async ({ page }, testInfo) => {
  await signIn(page, editor)
  await page.setViewportSize({ width: 1440, height: 1500 })
  const name = `Coral Pop ${Date.now().toString(36)}`
  const sw = await createDraft(page, { name })

  // No sounds yet: the publish button explains itself, and the API refuses.
  await page.goto(`/keylab/admin/switches/${sw.id}`)
  const publish = page.getByRole('button', { name: 'Publish to library' })
  await expect(publish).toHaveAttribute('aria-disabled', 'true')
  await expect(page.getByText('Upload the stock press and release sounds to publish.')).toBeVisible()
  await expect(page.getByRole('listitem').filter({ hasText: 'Stock press sound' })).toContainText('to do')
  const refused = await page.request.post(`/bff/keylab/v1/admin/switches/${sw.id}/publication`, {
    data: { markNew: true },
    headers: { 'X-XSRF-TOKEN': (await page.context().cookies()).find((c) => c.name === 'XSRF-TOKEN')?.value ?? '' },
  })
  expect(refused.status()).toBe(409)
  expect((await refused.json()).code).toBe('missing_required_sounds')

  // Stock press and release ready: the checklist ticks and publishing opens.
  markStockSoundsReady(sw.id)
  await page.reload()
  await expect(page.getByRole('listitem').filter({ hasText: 'Stock press sound' })).toContainText('done')
  await expect(page.getByRole('listitem').filter({ hasText: 'Stock release sound' })).toContainText('done')
  await expect(page.getByText('Everything required is in. Publishing makes it visible to everyone.')).toBeVisible()
  await expect(publish).toHaveAttribute('aria-disabled', 'false')
  await expect(page.getByRole('switch', { name: 'Mark as New in the library' })).toHaveAttribute('aria-checked', 'true')

  const publishing = page.waitForResponse((res) => res.url().endsWith(`/admin/switches/${sw.id}/publication`) && res.request().method() === 'POST')
  await publish.click()
  const publishedRes = await publishing
  expect(publishedRes.status()).toBe(200)
  expect(publishedRes.request().postDataJSON()).toEqual({ markNew: true })
  published = sw.id
  expect(await publishedRes.json()).toMatchObject({ status: 'published', isNew: true })
  const toast = page.getByRole('status').filter({ hasText: `${name} published` })
  await expect(toast).toContainText('It’s live in the public switch library.')
  await expect(page.getByText('Live in the public library.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Pull from library' })).toBeVisible()
  await testInfo.attach('admin-published', { path: await shot(page, testInfo.outputPath('admin-published.png')), contentType: 'image/png' })

  // The toast leads to the public library, where the switch shows with the New sticker.
  await toast.getByRole('link', { name: 'View in library' }).click()
  await expect(page).toHaveURL(/\/keylab\/library$/)
  await expect(page.getByRole('heading', { level: 1 })).toContainText('KEYBOARD SWITCHES, BY SOUND')
  await page.getByLabel('Search').fill(name)
  await expect(page).toHaveURL(/q=Coral/)
  const card = page.getByTestId('library-card').filter({ hasText: name })
  await expect(card).toHaveCount(1)
  await expect(card.getByText('New', { exact: true })).toBeVisible()
  await expect(card).toContainText('62g · 2.0mm · Poppy')
  await expect(card.getByRole('link', { name: `${name} details` })).toHaveAttribute('href', `/keylab/library/${sw.slug}`)
  await expect(page.getByRole('heading', { name: '1 switch' })).toBeVisible()
  await testInfo.attach('library-desktop', { path: await shot(page, testInfo.outputPath('library-desktop.png')), contentType: 'image/png' })

  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByRole('button', { name: 'Open menu' })).toBeVisible()
  await expect(page.getByRole('group', { name: 'Sound' })).toBeHidden()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await testInfo.attach('library-mobile', { path: await shot(page, testInfo.outputPath('library-mobile.png')), contentType: 'image/png' })

  // Guests get the same library, cacheable for one window (300 s) with an ETag.
  const guest = await page.context().browser()!.newContext({ baseURL: page.url() })
  const list = await guest.request.get(`/bff/keylab/v1/switches?q=${encodeURIComponent(name)}`)
  expect(list.status()).toBe(200)
  expect(list.headers()['cache-control']).toContain('max-age=300')
  expect(list.headers()['etag']).toBeTruthy()
  const body = await list.json()
  expect(body.data).toHaveLength(1)
  expect(body.data[0]).toMatchObject({ id: sw.id, isNew: true, soundStatus: 'recorded' })
  const again = await guest.request.get(`/bff/keylab/v1/switches?q=${encodeURIComponent(name)}`, {
    headers: { 'If-None-Match': list.headers()['etag'] },
  })
  expect(again.status()).toBe(304)
  await guest.close()
})
