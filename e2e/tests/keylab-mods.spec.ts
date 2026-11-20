import { expect, test, type Page } from '@playwright/test'
import { createUser, deleteUser, newUser, signIn } from './support'
import { createDraft, markStockSoundsReady, setPublished } from './keylab-support'

// US-05, end to end: the Mods workshop (/keylab/mods). Browser → Vite →
// gateway BFF → keylab-api (CAT-07 for the mods, BLD-10 for every sound). The
// recordings are served by the test on the app's own origin, as keylab-api
// serves them in production; the page reports each stroke it plays as a
// `keylab-sound` window event, which the test collects.
const editor = newUser('keylab-mods')
const token = `Md${Date.now().toString(36)}`
const SOUNDS = '/bff/keylab/v1/assets/sounds/e2e-mods/'
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
async function setUp(page: Page): Promise<{ recipes: string[] }> {
  await page.route(`**${SOUNDS}**`, (route) => route.fulfill({ status: 200, contentType: 'audio/wav', body: wav() }))
  await page.addInitScript(() => {
    const w = window as unknown as { played: unknown[] }
    w.played = []
    window.addEventListener('keylab-sound', (e) => w.played.push((e as CustomEvent).detail))
    try {
      window.localStorage.removeItem('keylab.build')
    } catch {
      // Not needed for the test.
    }
  })
  const recipes: string[] = []
  page.on('request', (r) => {
    if (r.url().includes('/v1/sound-recipe')) recipes.push(new URL(r.url()).search)
  })
  return { recipes }
}

const played = (page: Page) => page.evaluate(() => (window as unknown as { played: Played[] }).played)
const clearPlayed = (page: Page) => page.evaluate(() => ((window as unknown as { played: Played[] }).played.length = 0))
const meter = (page: Page) => page.getByTestId('meter')
const position = async (page: Page) => Number(await meter(page).getAttribute('data-position'))
const card = (page: Page, slug: string) => page.getByTestId(`mod-${slug}`)

/** Clicks and waits for a played press and release; returns them. */
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
  sw = await createDraft(page, { name: `${token} Milk`, type: 'linear', profile: 'deep', forceG: 50 })
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

test('each mod card plays before and after, and the meter moves with every toggle', async ({ page }, testInfo) => {
  const { recipes } = await setUp(page)
  await page.setViewportSize({ width: 1440, height: 1300 })
  await page.goto(`/keylab/mods?switch=${sw.slug}`)

  await expect(page.getByRole('heading', { level: 1, name: 'Mods workshop' })).toBeVisible()
  await expect(page.getByText('Toggle a mod and every key you press uses the new sound. Before / After plays one key each way.')).toBeVisible()
  await expect(page.getByTestId('mods-count')).toHaveText('0 of 6 mods applied')
  await expect(page.getByText('No mods yet. This is how the switch sounds out of the box.')).toBeVisible()
  for (const name of ['Lube', 'Case foam', 'PE foam / tape mod', 'Stabilizer tuning', 'O-rings', 'Spring swap']) {
    await expect(page.getByRole('heading', { level: 3, name })).toBeVisible()
  }
  await expect(card(page, 'lube')).toContainText('smoother · deeper')
  // Stock of a "deep" switch, from BLD-10.
  await expect(page.getByTestId('meter-word')).toHaveText('Deep & rounded')
  const stock = await position(page)
  expect(stock).toBe(0.38)

  // Toggles: each one changes the mix, the meter and the list in Sound shift.
  let before = stock
  for (const [slug, control] of [
    ['case-foam', () => card(page, 'case-foam').getByRole('switch', { name: 'Case foam' })],
    ['stabs', () => card(page, 'stabs').getByRole('switch', { name: 'Stabilizer tuning' })],
    ['lube', () => card(page, 'lube').getByRole('radio', { name: 'Light' })],
    ['lube', () => card(page, 'lube').getByRole('radio', { name: 'Heavy' })],
    ['pe-foam', () => card(page, 'pe-foam').getByRole('switch', { name: 'PE foam / tape mod' })],
    ['o-rings', () => card(page, 'o-rings').getByRole('switch', { name: 'O-rings' })],
  ] as const) {
    await control().click()
    await expect.poll(() => position(page), { message: `meter after ${slug}` }).not.toBe(before)
    before = await position(page)
  }
  await expect(page.getByTestId('mods-count')).toHaveText('5 of 6 mods applied')
  await expect(page.getByTestId('status-lube')).toHaveText('Heavy')
  await expect(page.getByTestId('status-case-foam')).toHaveText('On')
  const shift = page.locator('.shift-list li')
  await expect(shift).toHaveText([
    'Heavy lubesmoother · deeper',
    'Case foamdeeper · less echo',
    'PE foam / tape modpoppier · brighter',
    'Stabilizer tuningno rattle',
    'O-ringsquieter · shorter',
  ])
  // Spring swap's levels carry no sound effect in the seed: the card works, the meter stays.
  await card(page, 'spring-swap').getByRole('radio', { name: 'Heavier' }).click()
  await expect(page.getByTestId('status-spring-swap')).toHaveText('Heavier')
  await expect(page.getByTestId('mods-count')).toHaveText('6 of 6 mods applied')
  await page.screenshot({ path: testInfo.outputPath('mods-desktop.png'), fullPage: true })

  // Before and After on every card: one key each way, our recordings, the
  // mix without and with that mod. Only spring swap sounds the same both ways.
  for (const slug of ['lube', 'case-foam', 'pe-foam', 'stabs', 'o-rings', 'spring-swap']) {
    const off = await playOne(page, () => card(page, slug).getByRole('button', { name: /^Before/ }).click())
    const on = await playOne(page, () => card(page, slug).getByRole('button', { name: /^After/ }).click())
    expect(off[0].url).toBe(`${SOUNDS}${token.toLowerCase()}-press.opus`)
    expect(off[1].url).toBe(`${SOUNDS}${token.toLowerCase()}-release.opus`)
    if (slug === 'spring-swap') {
      expect(on[0].filters).toEqual(off[0].filters)
    } else {
      expect(on[0].filters, slug).not.toEqual(off[0].filters)
    }
  }
  // Case foam deepens: After sits deeper on the meter than Before.
  const foamOff = await playOne(page, () => card(page, 'case-foam').getByRole('button', { name: /^Before/ }).click())
  const foamOn = await playOne(page, () => card(page, 'case-foam').getByRole('button', { name: /^After/ }).click())
  expect(foamOn[0].meter.position).toBeLessThan(foamOff[0].meter.position)

  // Sound shift: Stock plays the switch as it is, With mods the current mix.
  const stockPlayed = await playOne(page, () => page.getByTestId('play-stock').click())
  expect(stockPlayed[0].meter.position).toBe(stock)
  const modsPlayed = await playOne(page, () => page.getByTestId('play-mods').click())
  expect(modsPlayed[0].meter.position).toBe(await position(page))

  // Every key pressed uses the current sound: a click on the preview and a real key.
  await clearPlayed(page)
  await page.getByTestId('keyboard').first().getByRole('button', { name: 'Q', exact: true }).click()
  await page.keyboard.press('KeyA')
  await expect.poll(async () => (await played(page)).length).toBe(4)
  for (const p of await played(page)) {
    expect(p.meter.position).toBe(await position(page))
  }
  await expect(page.getByText('This sound could not be played.')).toHaveCount(0)

  // Equal mixes share one URL: mod values sorted.
  for (const search of recipes) {
    const mods = new URLSearchParams(search).getAll('mod')
    expect(mods).toEqual([...mods].sort())
  }

  await page.getByRole('button', { name: 'Reset to stock' }).click()
  await expect(page.getByTestId('mods-count')).toHaveText('0 of 6 mods applied')
  await expect.poll(() => position(page)).toBe(stock)
})

test('recipes are cacheable and a toggle back plays from cache in under 100 ms', async ({ page }, info) => {
  const { recipes } = await setUp(page)
  await page.setViewportSize({ width: 1440, height: 1300 })
  await page.goto(`/keylab/mods?switch=${sw.slug}`)
  await expect(page.getByTestId('mods-count')).toHaveText('0 of 6 mods applied')

  // BLD-10 answers carry the catalog's cache headers.
  const answer = await page.request.get(`/bff/keylab/v1/sound-recipe?switch=${sw.slug}&mod=case-foam`)
  expect(answer.status()).toBe(200)
  expect(answer.headers()['cache-control']).toBe('max-age=300, public')
  const etag = answer.headers()['etag']
  expect(etag).toBeTruthy()
  const again = await page.request.get(`/bff/keylab/v1/sound-recipe?switch=${sw.slug}&mod=case-foam`, {
    headers: { 'If-None-Match': etag },
  })
  expect(again.status()).toBe(304)

  // On load: the current mix and stock only, well inside the gateway's burst of 20.
  await page.waitForLoadState('networkidle')
  expect(recipes.length).toBeLessThanOrEqual(2)
  // Reaching a card fetches its Before and After, so its toggle needs no request.
  await card(page, 'case-foam').hover()
  await expect.poll(() => recipes.some((s) => new URLSearchParams(s).getAll('mod').join() === 'case-foam')).toBe(true)
  await page.waitForLoadState('networkidle')
  const asked = recipes.length

  /** Milliseconds from a click on the case foam switch to the meter's change. */
  const toggleTime = () =>
    page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          const el = document.querySelector('[data-testid=meter]')!
          const control = document.querySelector<HTMLButtonElement>('[data-testid=mod-case-foam] [role=switch]')!
          const start = performance.now()
          const watch = new MutationObserver(() => {
            watch.disconnect()
            resolve(performance.now() - start)
          })
          watch.observe(el, { attributes: true, attributeFilter: ['data-position'] })
          control.click()
        }),
    )
  // Eight toggles, judged at p75 as decision 0001 judges real users. Against
  // the Vite dev server (React's dev build) on a loaded machine a single
  // sample now and then passes 100 ms (128 and 147 ms seen) while the rest
  // sit near 20 ms; the production build measured 1 to 13 ms for all eight.
  const timings: number[] = []
  for (let i = 0; i < 8; i++) {
    timings.push(await toggleTime())
  }
  info.annotations.push({ type: 'toggle-ms', description: timings.map((t) => t.toFixed(1)).join(', ') })
  const p75 = [...timings].sort((a, b) => a - b)[Math.ceil(timings.length * 0.75) - 1]
  expect(p75, `toggle times ${timings.join(', ')}`).toBeLessThan(100)
  // On and off, four times: all from memory, no new request for those two mixes.
  const fresh = recipes.slice(asked).filter((s) => {
    const mods = new URLSearchParams(s).getAll('mod')
    return mods.length === 0 || (mods.length === 1 && mods[0] === 'case-foam')
  })
  expect(fresh).toEqual([])
})

test('the phone layout follows ModsMobile', async ({ page }, info) => {
  await setUp(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`/keylab/mods?switch=${sw.slug}`)
  await expect(page.getByText('Hear every mod before you buy it.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Reset', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Reset to stock' })).toBeHidden()
  await expect(page.getByText(`${sw.name.toUpperCase()} · 65%`)).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Sound shift' })).toBeHidden()
  await card(page, 'case-foam').getByRole('switch', { name: 'Case foam' }).click()
  await expect(page.getByTestId('mods-count')).toHaveText('1 of 6 mods applied')
  // The toggle is heard: one key press and release with the new sound.
  await expect.poll(async () => (await played(page)).map((p) => p.stroke)).toEqual(['press', 'release'])
  const play = await playOne(page, () => page.getByRole('button', { name: 'Play current sound' }).click())
  expect(play[0].url).toContain(SOUNDS)
  await page.screenshot({ path: info.outputPath('mods-mobile.png') })
  await expect(page.getByRole('link', { name: 'Next: customize keycaps' })).toBeAttached()
})
