import { expect, test, type Page } from '@playwright/test'
import { createUser, deleteUser, newUser, signIn } from './support'
import { createDraft, markStockSoundsReady, setPublished } from './keylab-support'

// US-04, end to end: the switch page (/keylab/library/:slug) shows specs,
// force curve, the stroke and mod-variant pickers that play the recordings,
// the "Sounds similar" row from CAT-04, and "Use in a build" opens the builder
// with this switch. Browser → Vite → gateway BFF → keylab-api (CAT-02, CAT-03,
// CAT-04). The recordings' CDN host is served by the test, with a short WAV.
const editor = newUser('keylab-switch-page')
const token = `Sp${Date.now().toString(36)}`
const ids: string[] = []
let main = { id: '', slug: '', name: '' }
let twin = { id: '', slug: '', name: '' }

/** 50 ms of silence, 8 kHz mono 16-bit: enough for the browser to play and end. */
function wav(): Buffer {
  const samples = 400
  const b = Buffer.alloc(44 + samples * 2)
  b.write('RIFF', 0)
  b.writeUInt32LE(36 + samples * 2, 4)
  b.write('WAVEfmt ', 8)
  b.writeUInt32LE(16, 16)
  b.writeUInt16LE(1, 20)
  b.writeUInt16LE(1, 22)
  b.writeUInt32LE(8000, 24)
  b.writeUInt32LE(16000, 28)
  b.writeUInt16LE(2, 32)
  b.writeUInt16LE(16, 34)
  b.write('data', 36)
  b.writeUInt32LE(samples * 2, 40)
  return b
}

async function serveSounds(page: Page): Promise<string[]> {
  const played: string[] = []
  await page.route('https://cdn.keylab.test/**', async (route) => {
    played.push(new URL(route.request().url()).pathname)
    await route.fulfill({ status: 200, contentType: 'audio/wav', body: wav() })
  })
  return played
}

test.beforeAll(async ({ browser }) => {
  await createUser(editor, ['keylab-editor'])
  const page = await browser.newPage()
  await signIn(page, editor)
  // A pair no other dev data is likely to share: silent, muted, 37 and 38 g.
  main = await createDraft(page, { name: `${token} Hush`, type: 'silent', profile: 'muted', forceG: 37, stemColor: '#E9C46A' })
  twin = await createDraft(page, { name: `${token} Twin`, type: 'silent', profile: 'muted', forceG: 38 })
  for (const sw of [main, twin]) {
    markStockSoundsReady(sw.id)
    expect(await setPublished(page, sw.id, true)).toBe(200)
    ids.push(sw.id)
  }
  await page.close()
})

test.afterAll(async ({ browser }) => {
  const page = await browser.newPage()
  await signIn(page, editor)
  for (const id of ids) {
    await setPublished(page, id, false)
  }
  await page.close()
  await deleteUser(editor.email)
})

test('a guest reads the switch page: specs, curve, sounds and similar switches', async ({ page }, testInfo) => {
  const played = await serveSounds(page)
  await page.setViewportSize({ width: 1440, height: 1400 })
  await page.goto('/keylab/library')
  await page.getByLabel('Search').fill(token)
  await page.getByRole('link', { name: `${main.name} details` }).click()
  await expect(page).toHaveURL(`/keylab/library/${main.slug}`)

  await expect(page.getByRole('heading', { level: 1, name: main.name.toUpperCase() })).toBeVisible()
  await expect(page.getByText('Recorded', { exact: true })).toBeVisible()
  const specs = page.locator('.sp-dl')
  await expect(specs).toContainText('Silent')
  await expect(specs).toContainText('37 g')
  await expect(specs).toContainText('3.8 mm')
  await expect(specs).toContainText('Milky')
  await expect(specs).toContainText('Stock')
  await expect(page.getByRole('img', { name: /force curve from 5 points/ })).toBeVisible()
  await expect(page.getByRole('img', { name: /Waveform, press then release, 360 milliseconds/ })).toBeVisible()

  // Pickers: lubed and foam are not recorded; "Both" plays press then release.
  const variants = page.getByRole('radiogroup', { name: 'Mod variant' })
  await expect(variants.getByRole('radio', { name: 'Stock' })).toHaveAttribute('aria-checked', 'true')
  await expect(variants.getByRole('radio', { name: 'Lubed' })).toHaveAttribute('aria-disabled', 'true')
  await page.getByRole('button', { name: 'Play press + release' }).click()
  await expect.poll(() => played).toEqual(['/assets/sounds/press.opus', '/assets/sounds/release.opus'])

  await page.getByRole('radiogroup', { name: 'Stroke' }).getByRole('radio', { name: 'Release' }).click()
  await page.getByRole('button', { name: 'Play release' }).click()
  await expect.poll(() => played.length).toBe(3)
  expect(played[2]).toBe('/assets/sounds/release.opus')
  await expect(page.getByText('This sound could not be played.')).toHaveCount(0)

  // Sounds similar: the twin comes first (same profile and type, 1 g apart).
  const related = page.getByTestId('related').getByRole('listitem')
  await expect(related.first()).toContainText(twin.name)
  await page.screenshot({ path: testInfo.outputPath('switch-desktop.png'), fullPage: true })

  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByRole('link', { name: '← Switch library' })).toBeVisible()
  await expect(page.getByRole('radiogroup', { name: 'Stroke' })).toBeHidden()
  await page.screenshot({ path: testInfo.outputPath('switch-mobile.png'), fullPage: true })
  await page.setViewportSize({ width: 1440, height: 1400 })

  await related.first().getByRole('link', { name: `${twin.name} details` }).click()
  await expect(page).toHaveURL(`/keylab/library/${twin.slug}`)
  await expect(page.getByRole('heading', { level: 1, name: twin.name.toUpperCase() })).toBeVisible()

  // Drafts and unknown names are not there.
  await page.goto('/keylab/library/no-such-switch')
  await expect(page.getByRole('heading', { name: 'Switch not found' })).toBeVisible()
})

test('a library card plays its stock press and release', async ({ page }) => {
  const played = await serveSounds(page)
  await page.goto(`/keylab/library?q=${token}`)
  const card = page.getByRole('button', { name: new RegExp(`^${main.name}, Silent`) })
  await card.focus()
  await page.keyboard.press('Enter')
  await expect.poll(() => played.some((path) => path.startsWith('/assets/sounds/'))).toBe(true)
})

test('"Use in a build" opens the builder with this switch selected', async ({ page }) => {
  await signIn(page, editor)
  await page.goto(`/keylab/library/${main.slug}`)
  await page.getByRole('link', { name: 'Use in a build' }).click()
  await expect(page).toHaveURL(`/keylab?switch=${main.slug}`)
  const picked = page.getByTestId('build-switch')
  await expect(picked).toContainText(main.name)
  await expect(picked).toContainText('Selected for this build.')
})
