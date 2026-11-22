import { expect, test, type Page } from '@playwright/test'
import { createUser, deleteUser, newUser, signIn } from './support'
import { createDraft, markStockSoundsReady, setPublished } from './keylab-support'

// US-06, end to end: the Keycaps studio (/keylab/keycaps). Browser → Vite →
// gateway BFF → keylab-api (CAT-05 and CAT-06 for the sets, BLD-10 for every
// sound). The recordings are served by the test on the app's own origin; the
// page reports each stroke it plays as a `keylab-sound` window event.
const editor = newUser('keylab-keycaps')
const token = `Kc${Date.now().toString(36)}`
const SOUNDS = '/bff/keylab/v1/assets/sounds/e2e-keycaps/'
let sw = { id: '', slug: '', name: '' }

type Played = { stroke: string; url: string; filters: Record<string, number>; meter: { position: number; word: string } }

/** 50 ms of silence, 8 kHz mono 16-bit: enough for Web Audio to decode and play. */
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

/** Serves the recordings, collects played strokes, and lists every BLD-10 request. */
async function setUp(page: Page, build: Record<string, unknown> | null = null): Promise<{ recipes: string[] }> {
  await page.route(`**${SOUNDS}**`, (route) => route.fulfill({ status: 200, contentType: 'audio/wav', body: wav() }))
  await page.addInitScript((held) => {
    const w = window as unknown as { played: unknown[] }
    w.played = []
    window.addEventListener('keylab-sound', (e) => w.played.push((e as CustomEvent).detail))
    try {
      // Once per test: later pages in the same test keep what the studio saved.
      if (!window.sessionStorage.getItem('e2e-build')) {
        window.sessionStorage.setItem('e2e-build', '1')
        if (held) window.localStorage.setItem('keylab.build', JSON.stringify(held))
        else window.localStorage.removeItem('keylab.build')
      }
    } catch {
      // Not needed for the test.
    }
  }, build)
  const recipes: string[] = []
  page.on('request', (r) => {
    if (r.url().includes('/v1/sound-recipe')) recipes.push(new URL(r.url()).search)
  })
  return { recipes }
}

const played = (page: Page) => page.evaluate(() => (window as unknown as { played: Played[] }).played)
const clearPlayed = (page: Page) => page.evaluate(() => ((window as unknown as { played: Played[] }).played.length = 0))
const tile = (page: Page, slug: string) => page.getByTestId(`set-${slug}`)
const preview = (page: Page) => page.getByTestId('keyboard').first()

/** Clicks and waits for one key, press and release; returns them. */
async function playOne(page: Page, click: () => Promise<void>): Promise<Played[]> {
  await clearPlayed(page)
  await click()
  await expect.poll(async () => (await played(page)).map((p) => p.stroke)).toEqual(['press', 'release'])
  return played(page)
}

test.beforeAll(async ({ browser }) => {
  await createUser(editor, ['keylab-editor'])
  const page = await browser.newPage()
  await signIn(page, editor)
  sw = await createDraft(page, { name: `${token} Cream`, type: 'linear', profile: 'deep', forceG: 50 })
  markStockSoundsReady(sw.id, token.toLowerCase(), SOUNDS)
  expect(await setPublished(page, sw.id, true)).toBe(200)
  await page.close()
})

test.afterAll(async ({ browser }) => {
  const page = await browser.newPage()
  await signIn(page, editor)
  if (sw.id) {
    await setPublished(page, sw.id, false)
  }
  await page.close()
  await deleteUser(editor.email)
})

test('sets are listed with material, profile and colourway, each pick re-fetches the recipe and plays it', async ({ page }, info) => {
  const { recipes } = await setUp(page, { mods: { 'case-foam': 1 } })
  await page.setViewportSize({ width: 1440, height: 1300 })
  await page.goto(`/keylab/keycaps?switch=${sw.slug}`)

  await expect(page.getByRole('heading', { level: 1, name: 'Keycaps studio' })).toBeVisible()
  await expect(page.getByText('Click any key to hear it.')).toBeVisible()
  // CAT-05: the published sets in the editors' order; the draft and the hidden one never show.
  await expect(page.getByTestId('keycap-sets').getByRole('button')).toHaveCount(4)
  for (const [slug, name, meta] of [
    ['cream-paper', 'Cream Paper', 'PBT · CHERRY'],
    ['navy-sun', 'Navy Sun', 'PBT · CHERRY'],
    ['sky-lab', 'Sky Lab', 'ABS · OEM'],
    ['coral-reef', 'Coral Reef', 'PBT · XDA'],
  ]) {
    await expect(tile(page, slug)).toContainText(name)
    await expect(tile(page, slug)).toContainText(meta)
  }
  await expect(tile(page, 'lime-pop')).toHaveCount(0)
  await expect(tile(page, 'ink-blank')).toHaveCount(0)

  // Deep-to-bright shift on every set, in words and on the scale (bright left).
  for (const [slug, word, shift] of [
    ['cream-paper', 'A touch deeper', '-0.25'],
    ['navy-sun', 'A touch deeper', '-0.25'],
    ['sky-lab', 'Brighter', '0.5'],
    ['coral-reef', 'Like stock', '0'],
  ]) {
    await expect(page.getByTestId(`shift-${slug}`)).toHaveAttribute('data-shift', shift)
    await expect(page.getByTestId(`shift-${slug}`)).toContainText(word)
  }

  // Nothing picked before: the first set, on the preview and in the summary.
  await expect(tile(page, 'cream-paper')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('keycaps-summary')).toHaveText('CHERRY · PBT · CREAM PAPER')
  await expect(preview(page)).toHaveAttribute('data-alpha', '#fffdf5')
  await expect(preview(page)).toHaveAttribute('data-profile', 'cherry')
  await expect(page.getByRole('radio', { name: 'Cherry' })).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByRole('radio', { name: /^PBT/ })).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByRole('radio', { name: 'SA' })).toBeDisabled()
  await expect(page.getByTestId('profile-spec')).toHaveText('CHERRY · SCULPTED, LOW')

  // A pick: a new BLD-10 request with the set (and the build's mods), then one key plays it.
  const cream = await playOne(page, () => page.getByTestId('keyboard').first().getByRole('button', { name: 'Q', exact: true }).click())
  const asked = recipes.length
  const sky = await playOne(page, () => tile(page, 'sky-lab').click())
  const skyAsk = recipes.slice(asked).map((s) => new URLSearchParams(s))
  expect(skyAsk.some((q) => q.get('keycap_set') === 'sky-lab' && q.get('switch') === sw.slug && q.getAll('mod').join() === 'case-foam')).toBe(true)
  expect(sky[0].url).toBe(`${SOUNDS}${token.toLowerCase()}-press.opus`)
  // Brighter caps: a brighter sound than the cream PBT set.
  expect(sky[0].meter.position).toBeGreaterThan(cream[0].meter.position)
  expect(sky[0].filters).not.toEqual(cream[0].filters)
  await expect(page.getByTestId('keycaps-summary')).toHaveText('OEM · ABS · SKY LAB')
  await expect(preview(page)).toHaveAttribute('data-alpha', '#fffdf5')
  await expect(preview(page)).toHaveAttribute('data-profile', 'oem')
  await expect(page.getByRole('radio', { name: /^ABS/ })).toHaveAttribute('aria-checked', 'true')

  // Profile and Material pick a set too: XDA leads to Coral Reef, which sounds like stock.
  const coral = await playOne(page, () => page.getByRole('radio', { name: 'XDA' }).click())
  await expect(tile(page, 'coral-reef')).toHaveAttribute('aria-pressed', 'true')
  await expect(preview(page)).toHaveAttribute('data-alpha', '#fff1c7')
  expect(coral[0].meter.position).toBeLessThan(sky[0].meter.position)
  expect(coral[0].meter.position).toBeGreaterThan(cream[0].meter.position)
  // Back to Cherry keeps PBT: the first PBT Cherry set.
  await playOne(page, () => page.getByRole('radio', { name: 'Cherry' }).click())
  await expect(tile(page, 'cream-paper')).toHaveAttribute('aria-pressed', 'true')
  await page.screenshot({ path: info.outputPath('keycaps-desktop.png'), fullPage: true })

  // The pick is kept for the build, and the Mods workshop now hears it too.
  await playOne(page, () => tile(page, 'navy-sun').click())
  expect(await page.evaluate(() => JSON.parse(window.localStorage.getItem('keylab.build') ?? '{}').keycapSet)).toBe('navy-sun')
  const before = recipes.length
  await page.goto(`/keylab/mods?switch=${sw.slug}`)
  await expect(page.getByTestId('mods-count')).toHaveText('1 of 6 mods applied')
  await expect.poll(() => recipes.slice(before).every((s) => new URLSearchParams(s).get('keycap_set') === 'navy-sun')).toBe(true)
  expect(recipes.length).toBeGreaterThan(before)
  await expect(page.getByText('This sound could not be played.')).toHaveCount(0)
})

test('a set named in the link loads with CAT-06; a hidden one gives way to the first set', async ({ page }) => {
  await setUp(page)
  await page.setViewportSize({ width: 1440, height: 1300 })
  const one: string[] = []
  page.on('request', (r) => {
    if (/\/v1\/keycap-sets\/[^?]/.test(r.url())) one.push(new URL(r.url()).pathname)
  })
  await page.goto(`/keylab/keycaps?switch=${sw.slug}&keycap_set=coral-reef`)
  await expect(tile(page, 'coral-reef')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('keycaps-summary')).toHaveText('XDA · PBT · CORAL REEF')
  expect(one.some((p) => p.endsWith('/keycap-sets/coral-reef'))).toBe(true)

  // Ink Blank is hidden: CAT-06 answers 404 and the studio shows the first set.
  const hidden = await page.request.get('/bff/keylab/v1/keycap-sets/ink-blank')
  expect(hidden.status()).toBe(404)
  expect((await hidden.json()).code).toBe('keycap_set_not_found')
  await page.goto(`/keylab/keycaps?switch=${sw.slug}&keycap_set=ink-blank`)
  await expect(tile(page, 'cream-paper')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('keycaps-summary')).toHaveText('CHERRY · PBT · CREAM PAPER')
})

test('the phone layout follows KeycapsMobile', async ({ page }, info) => {
  await setUp(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`/keylab/keycaps?switch=${sw.slug}`)
  await expect(page.getByRole('heading', { level: 1, name: 'Keycaps studio' })).toBeVisible()
  // Colors is the open tab; the others show one section each.
  await expect(page.getByRole('tab', { name: 'Colors' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('heading', { name: 'Colorways' })).toBeVisible()
  await expect(page.getByRole('radio', { name: /^PBT/ })).toBeHidden()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)

  const sky = await playOne(page, () => tile(page, 'sky-lab').click())
  expect(sky[0].url).toContain(SOUNDS)
  await expect(page.getByTestId('keyboard').nth(1)).toHaveAttribute('data-profile', 'oem')
  await page.screenshot({ path: info.outputPath('keycaps-mobile-colors.png') })

  await page.getByRole('tab', { name: 'Material' }).click()
  await expect(page.getByText('Tap a key in the preview to hear the difference.')).toBeVisible()
  await expect(page.getByRole('radio', { name: /^ABS/ })).toHaveAttribute('aria-checked', 'true')
  await playOne(page, () => page.getByRole('radio', { name: /^PBT/ }).click())
  await expect(page.getByTestId('keycaps-summary')).toHaveText('CHERRY · PBT · CREAM PAPER')
  await page.getByRole('tab', { name: 'Profile' }).click()
  await expect(page.getByText('XDA · UNIFORM, LOW WITH A FLAT TOP')).toBeVisible()
  await page.screenshot({ path: info.outputPath('keycaps-mobile-profile.png') })
})
