import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'
import { createUser, deleteUser, newUser, signIn } from './support'
import { createDraft, markStockSoundsReady, setPublished, xsrf } from './keylab-support'

// US-08, end to end: Save build on the Keycaps studio (BLD-02), My builds
// (BLD-01) and renaming there (BLD-04 with If-Match). Browser → Vite → gateway
// BFF → keylab-api; the member's builds land in the builds schema.
const member = newUser('keylab-builds')
const token = `Bd${Date.now().toString(36)}`
const SOUNDS = '/bff/keylab/v1/assets/sounds/e2e-builds/'
let sw = { id: '', slug: '', name: '' }

const API = '/bff/keylab/v1'

async function myBuilds(page: Page): Promise<{ id: string; name: string; visibility: string; version: number }[]> {
  const res = await page.request.get(`${API}/me/builds`)
  expect(res.status()).toBe(200)
  return (await res.json()).data
}

/** BLD-04 straight through the API: the "somewhere else" a stale tab does not know about. */
async function renameElsewhere(page: Page, id: string, version: number, name: string): Promise<void> {
  const res = await page.request.patch(`${API}/builds/${id}`, {
    data: JSON.stringify({ name }),
    headers: { 'Content-Type': 'application/merge-patch+json', 'If-Match': `"${version}"`, 'X-XSRF-TOKEN': await xsrf(page) },
  })
  expect(res.status()).toBe(200)
}

test.beforeAll(async ({ browser }) => {
  // The member is also an editor, only to publish the switch the build uses.
  await createUser(member, ['keylab-editor'])
  const page = await browser.newPage()
  await signIn(page, member)
  sw = await createDraft(page, { name: `${token} Milk`, type: 'linear', profile: 'deep', forceG: 50 })
  markStockSoundsReady(sw.id, token.toLowerCase(), SOUNDS)
  expect(await setPublished(page, sw.id, true)).toBe(200)
  await page.close()
})

test.afterAll(async ({ browser }) => {
  const page = await browser.newPage()
  await signIn(page, member)
  if (sw.id) {
    await setPublished(page, sw.id, false)
  }
  await page.close()
  await deleteUser(member.email)
})

test('Save build makes a private build once, My builds lists public and private, a rename needs the current tag', async ({ page }, info) => {
  await page.addInitScript((slug) => {
    if (!window.sessionStorage.getItem('e2e-build')) {
      window.sessionStorage.setItem('e2e-build', '1')
      window.localStorage.setItem('keylab.build', JSON.stringify({ switch: slug, mods: { 'case-foam': 1 }, keycapSet: 'navy-sun' }))
    }
  }, sw.slug)
  await signIn(page, member)
  await page.setViewportSize({ width: 1440, height: 1200 })

  // Save build: one BLD-02 with an Idempotency-Key, private, named after the switch.
  const creates: { key: string | null }[] = []
  page.on('request', (r) => {
    if (r.method() === 'POST' && new URL(r.url()).pathname === `${API}/builds`) creates.push({ key: r.headers()['idempotency-key'] ?? null })
  })
  await page.goto(`/keylab/keycaps?switch=${sw.slug}`)
  await expect(page.getByTestId('keycaps-summary')).toContainText('NAVY SUN')
  await page.getByTestId('save-build').first().click()

  await expect(page).toHaveURL(/\/keylab\/builds$/)
  const first = `${sw.name} 65`
  await expect(page.getByTestId('builds-status')).toHaveText(`${first} saved`)
  await expect(page.getByLabel('Build name')).toHaveValue(first)
  expect(creates).toHaveLength(1)
  expect(creates[0].key).toMatch(/^[0-9a-f-]{36}$/)
  let saved = await myBuilds(page)
  expect(saved).toHaveLength(1)
  expect(saved[0]).toMatchObject({ name: first, visibility: 'private' })
  const card = page.getByTestId('build-card').first()
  await expect(card).toContainText('Case foam')
  await expect(card).toContainText('PBT · Cherry · Navy Sun')
  await expect(page.getByTestId('current-build')).toContainText(first)

  // A public build made elsewhere: My builds lists both, newest change first.
  const pub = await page.request.post(`${API}/builds`, {
    data: { name: `${token} Public`, visibility: 'public', layout: '65', switch: { slug: sw.slug } },
    headers: { 'Idempotency-Key': randomUUID(), 'X-XSRF-TOKEN': await xsrf(page) },
  })
  expect(pub.status()).toBe(201)
  expect((await pub.json()).visibility).toBe('public')
  await page.reload()
  await expect(page.getByRole('heading', { name: /Saved builds/ })).toContainText('· 2')
  const tiles = page.getByRole('region', { name: /Saved builds/ }).getByRole('button')
  await expect(tiles).toHaveCount(2)
  await expect(tiles.nth(0)).toContainText(`${token} Public`)
  await expect(tiles.nth(1)).toContainText(first)

  // Rename with Enter: BLD-04 with If-Match, the status pill and the list follow.
  await tiles.nth(1).click()
  await expect(page.getByLabel('Build name')).toHaveValue(first)
  await page.getByLabel('Build name').fill(`${token} Night Thock`)
  await page.getByLabel('Build name').press('Enter')
  await expect(page.getByTestId('builds-status')).toHaveText(`${token} Night Thock saved`)
  saved = await myBuilds(page)
  const mine = saved.find((b) => b.name === `${token} Night Thock`)!
  expect(mine.visibility).toBe('private')
  await expect(page.getByTestId('current-build')).toContainText(`${token} Night Thock`)
  await page.screenshot({ path: info.outputPath('builds-desktop.png'), fullPage: true })

  // Renamed somewhere else meanwhile: the page's tag is stale, so 412 and a reload prompt.
  await renameElsewhere(page, mine.id, mine.version, `${token} Elsewhere`)
  await page.getByLabel('Build name').fill(`${token} Mine`)
  await page.getByLabel('Build name').press('Enter')
  await expect(page.getByTestId('builds-stale')).toContainText('This build changed somewhere else')
  await expect(page.getByLabel('Build name')).toBeDisabled()
  expect((await myBuilds(page)).some((b) => b.name === `${token} Mine`)).toBe(false)
  await page.getByTestId('builds-stale').getByRole('button', { name: 'Reload' }).click()
  await expect(page.getByLabel('Build name')).toHaveValue(`${token} Elsewhere`)
  await expect(page.getByTestId('builds-stale')).toHaveCount(0)

  // An empty name never leaves the page.
  await page.getByLabel('Build name').fill('   ')
  await page.getByLabel('Build name').press('Enter')
  await expect(page.getByRole('alert')).toHaveText('Give the build a name.')

  // Recent builds on the Build page, newest first.
  await page.goto('/keylab')
  const recent = page.getByTestId('recent-builds')
  await expect(recent.getByRole('link', { name: /Elsewhere/ })).toBeVisible()
  await expect(recent.getByRole('link', { name: 'See all' })).toHaveAttribute('href', '/keylab/builds')

  // BuildsMobile: summary first, then the list.
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/keylab/builds')
  await expect(page.getByTestId('build-card').last()).toBeVisible()
  await page.screenshot({ path: info.outputPath('builds-mobile.png'), fullPage: true })
})

test('a guest is asked to sign in', async ({ page }) => {
  await page.goto('/keylab/builds')
  await expect(page.getByText('Sign in to see the builds you saved.')).toBeVisible()
})
