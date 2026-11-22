import { expect, test, type Page } from '@playwright/test'
import { createUser, deleteUser, newUser, signIn } from './support'
import { createDraft, markStockSoundsReady, setPublished } from './keylab-support'

// US-07, end to end: Case & plate (/keylab/case). Browser → Vite → gateway
// BFF → keylab-api (CAT-08 for the parts, BLD-10 for every sound). The
// recordings are served by the test on the app's own origin; the page reports
// each stroke it plays as a `keylab-sound` window event.
const editor = newUser('keylab-case')
const token = `Cs${Date.now().toString(36)}`
const SOUNDS = '/bff/keylab/v1/assets/sounds/e2e-case/'
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
async function setUp(page: Page, build: Record<string, unknown> | null = null): Promise<{ recipes: URLSearchParams[] }> {
  await page.route(`**${SOUNDS}**`, (route) => route.fulfill({ status: 200, contentType: 'audio/wav', body: wav() }))
  await page.addInitScript((held) => {
    const w = window as unknown as { played: unknown[] }
    w.played = []
    window.addEventListener('keylab-sound', (e) => w.played.push((e as CustomEvent).detail))
    try {
      // Once per test: later pages in the same test keep what the page saved.
      if (!window.sessionStorage.getItem('e2e-build')) {
        window.sessionStorage.setItem('e2e-build', '1')
        if (held) window.localStorage.setItem('keylab.build', JSON.stringify(held))
        else window.localStorage.removeItem('keylab.build')
      }
    } catch {
      // Not needed for the test.
    }
  }, build)
  const recipes: URLSearchParams[] = []
  page.on('request', (r) => {
    if (r.url().includes('/v1/sound-recipe')) recipes.push(new URL(r.url()).searchParams)
  })
  return { recipes }
}

const played = (page: Page) => page.evaluate(() => (window as unknown as { played: Played[] }).played)
const clearPlayed = (page: Page) => page.evaluate(() => ((window as unknown as { played: Played[] }).played.length = 0))
const preview = (page: Page) => page.getByTestId('keyboard').first()
const saved = (page: Page) => page.evaluate(() => JSON.parse(window.localStorage.getItem('keylab.build') ?? '{}').case)

/** Clicks and waits for one key, press and release; returns them. */
async function playOne(page: Page, click: () => Promise<void>): Promise<Played[]> {
  await clearPlayed(page)
  await click()
  await expect.poll(async () => (await played(page)).map((p) => p.stroke)).toEqual(['press', 'release'])
  return played(page)
}

const asks = (recipes: URLSearchParams[], from: number, want: Record<string, string>) =>
  recipes.slice(from).some((q) => Object.entries(want).every(([k, v]) => q.get(k) === v))

test.beforeAll(async ({ browser }) => {
  await createUser(editor, ['keylab-editor'])
  const page = await browser.newPage()
  await signIn(page, editor)
  sw = await createDraft(page, { name: `${token} Case`, type: 'linear', profile: 'deep', forceG: 50 })
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

test('case options come from CAT-08; each pick moves the preview and the meter and is kept for saving', async ({ page }, info) => {
  const { recipes } = await setUp(page, { mods: { 'case-foam': 1 }, keycapSet: 'navy-sun' })
  await page.setViewportSize({ width: 1440, height: 1100 })
  await page.goto(`/keylab/case?switch=${sw.slug}`)

  await expect(page.getByRole('heading', { level: 1, name: 'Case & plate' })).toBeVisible()
  await expect(page.getByText('What holds the switches shapes the sound as much as the switches do.')).toBeVisible()

  // CAT-08: four materials with their notes, the eight case colours, five plates, three mounts.
  const options = await (await page.request.get('/bff/keylab/v1/case-options')).json()
  expect(options.materials.map((m: { slug: string }) => m.slug)).toEqual(['alu', 'pc', 'plastic', 'wood'])
  for (const m of options.materials) {
    await expect(page.getByTestId(`material-${m.slug}`)).toContainText(m.name)
    await expect(page.getByTestId(`material-${m.slug}`)).toContainText(m.soundEffect)
  }
  await expect(page.getByRole('radiogroup', { name: 'Case material' }).getByRole('radio')).toHaveCount(4)
  await expect(page.locator('.cse-colors button')).toHaveCount(8)
  await expect(page.getByRole('radiogroup', { name: 'Plate' }).getByRole('radio')).toHaveCount(5)
  await expect(page.getByRole('radiogroup', { name: 'Mount style' }).getByRole('radio')).toHaveCount(3)
  for (const t of options.mounts) {
    await expect(page.getByTestId(`mount-${t.slug}`)).toContainText(t.name)
    await expect(page.getByTestId(`mount-${t.slug}`)).toContainText(t.soundEffect)
  }

  // Nothing saved yet: the design's aluminum, navy blue, brass and gasket.
  await expect(page.getByTestId('material-alu')).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByRole('button', { name: 'Navy blue' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('heading', { name: 'Case color · Navy blue' })).toBeVisible()
  await expect(page.getByTestId('plate-brass')).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByTestId('plate-note')).toHaveText('Brass. Heavy and stiff. Bright, sharp and loud.')
  await expect(page.getByTestId('mount-gasket')).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByTestId('case-picked')).toContainText('CaseAluminum')
  await expect(page.getByTestId('case-picked')).toContainText('MountGasket')
  // One preview at a time: the phone's board is hidden on a desktop.
  await expect(page.getByTestId('keyboard')).toHaveCount(2)
  await expect(page.getByTestId('keyboard').nth(1)).toBeHidden()
  await expect(preview(page)).toHaveAttribute('data-case', '#2B4677')
  await expect(preview(page)).toHaveAttribute('data-plate', '#4c3d1a')
  // The whole build is heard: switch, mods, the keycap set and the case.
  const whole = { switch: sw.slug, mod: 'case-foam', keycap_set: 'navy-sun', case_material: 'alu', plate: 'brass', mount: 'gasket' }
  await expect.poll(() => asks(recipes, 0, whole)).toBe(true)
  await expect(page.getByTestId('case-meter')).toHaveAttribute('data-position', /\d/)
  expect(await saved(page)).toEqual({ material: 'alu', color: '#2B4677', plate: 'brass', mount: 'gasket' })

  // Wood: a new recipe, one key plays, the meter moves deeper and the case turns to grain.
  const alu = await playOne(page, () => preview(page).getByRole('button', { name: 'Q', exact: true }).click())
  let from = recipes.length
  const wood = await playOne(page, () => page.getByTestId('material-wood').click())
  expect(asks(recipes, from, { ...whole, case_material: 'wood' })).toBe(true)
  expect(wood[0].url).toBe(`${SOUNDS}${token.toLowerCase()}-press.opus`)
  expect(wood[0].meter.position).toBeLessThan(alu[0].meter.position)
  await expect(page.getByTestId('case-meter')).toHaveAttribute('data-position', String(wood[0].meter.position))
  await expect(page.getByTestId('case-word')).toHaveText(wood[0].meter.word)
  await expect(preview(page)).toHaveAttribute('data-case', /^repeating-linear-gradient\(91deg, #[0-9a-f]{6} 0 6px, #2B4677 6px 14px\)$/)
  await expect(page.getByTestId('case-picked')).toContainText('CaseWood')

  // A PC plate: deeper again, the note and the preview's plate follow.
  from = recipes.length
  const pc = await playOne(page, () => page.getByTestId('plate-pc').click())
  expect(asks(recipes, from, { ...whole, case_material: 'wood', plate: 'pc' })).toBe(true)
  expect(pc[0].meter.position).toBeLessThan(wood[0].meter.position)
  await expect(page.getByTestId('plate-note')).toHaveText('Polycarbonate. Flexible and soft. Deep, muted thock.')
  await expect(page.getByTestId('case-picked')).toContainText('PlatePolycarbonate')
  await expect(preview(page)).not.toHaveAttribute('data-plate', '#4c3d1a')

  // A tray mount: firmer, so a touch brighter than the gasket.
  const tray = await playOne(page, () => page.getByTestId('mount-tray').click())
  expect(tray[0].meter.position).toBeGreaterThan(pc[0].meter.position)
  await expect(page.getByTestId('case-meter')).toHaveAttribute('data-position', String(tray[0].meter.position))

  // The colour changes the look only.
  await page.getByRole('button', { name: 'Coral' }).click()
  await expect(page.getByRole('heading', { name: 'Case color · Coral' })).toBeVisible()
  await expect(preview(page)).toHaveAttribute('data-case', /#F16B53 6px 14px/)
  await expect(page.getByTestId('case-picked')).toContainText('ColorCoral')
  await page.screenshot({ path: info.outputPath('case-desktop.png'), fullPage: true })

  // Kept in the builder state (BuildParts.case) for saving, and the other pages hear it.
  expect(await saved(page)).toEqual({ material: 'wood', color: '#F16B53', plate: 'pc', mount: 'tray' })
  await page.reload()
  await expect(page.getByTestId('material-wood')).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByTestId('plate-pc')).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByTestId('mount-tray')).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByRole('button', { name: 'Coral' })).toHaveAttribute('aria-pressed', 'true')
  from = recipes.length
  await page.goto(`/keylab/mods?switch=${sw.slug}`)
  await expect(page.getByTestId('mods-count')).toHaveText('1 of 6 mods applied')
  await expect.poll(() => recipes.length).toBeGreaterThan(from)
  expect(recipes.slice(from).every((q) => q.get('case_material') === 'wood' && q.get('plate') === 'pc' && q.get('mount') === 'tray')).toBe(true)
  await expect(preview(page)).toHaveAttribute('data-case', /#F16B53 6px 14px/)
  await expect(page.getByText('This sound could not be played.')).toHaveCount(0)
})

test('a part CAT-08 no longer offers falls back to the default', async ({ page }) => {
  const { recipes } = await setUp(page, { case: { material: 'carbon', color: '#123456', plate: 'steel', mount: 'top-mount' } })
  await page.setViewportSize({ width: 1440, height: 1100 })
  await page.goto(`/keylab/case?switch=${sw.slug}`)
  await expect(page.getByTestId('material-alu')).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByRole('button', { name: 'Navy blue' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('plate-brass')).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByTestId('mount-top-mount')).toHaveAttribute('aria-checked', 'true')
  await expect.poll(() => asks(recipes, 0, { case_material: 'alu', plate: 'brass', mount: 'top-mount' })).toBe(true)
  expect(recipes.some((q) => q.get('case_material') === 'carbon' || q.get('plate') === 'steel')).toBe(false)
})

test('the phone layout follows CaseMobile', async ({ page }, info) => {
  await setUp(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`/keylab/case?switch=${sw.slug}`)
  await expect(page.getByRole('heading', { level: 1, name: 'Case & plate' })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Desk pad: Sky/ })).toBeVisible()
  await expect(page.locator('.cse-meter.sm').getByText('BRIGHT', { exact: true })).toBeVisible()
  await expect(page.getByTestId('case-picked')).toBeHidden()
  await expect(page.getByTestId('keyboard').first()).toBeHidden()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await page.screenshot({ path: info.outputPath('case-mobile.png') })

  const fr4 = await playOne(page, () => page.getByTestId('plate-fr4').click())
  expect(fr4[0].url).toContain(SOUNDS)
  await expect(page.getByTestId('keyboard').nth(1)).not.toHaveAttribute('data-plate', '#4c3d1a')
  await expect(page.getByRole('link', { name: 'Hear it in the playground' })).toBeVisible()
  await page.screenshot({ path: info.outputPath('case-mobile-scrolled.png'), fullPage: true })
})
