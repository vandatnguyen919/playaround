import { expect, test, type Page } from '@playwright/test'
import { createUser, deleteUser, newUser, signIn } from './support'
import { createDraft, markSoundsMissing, markStockSoundsReady, setPublished } from './keylab-support'

// US-03, end to end: compare up to three switches side by side, on the
// landing strip (/keylab/home) and in compare mode on the app library
// (/keylab/switches). Browser → Vite → gateway BFF → keylab-api (CAT-01,
// CAT-03, and CAT-02 with sounds for the compare panel's force curves). The
// recordings' CDN host is served by the test, which records what played.
const editor = newUser('keylab-compare')
const token = `Cm${Date.now().toString(36)}`
type Seeded = { id: string; slug: string; name: string; tag: string }
const recorded: Seeded[] = []
let silent: Seeded = { id: '', slug: '', name: '', tag: '' }

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

/** Serves the CDN and lists each file fetched, in order: "<tag>-press" and so on. */
async function serveSounds(page: Page): Promise<string[]> {
  const played: string[] = []
  await page.route('https://cdn.keylab.test/**', async (route) => {
    played.push(new URL(route.request().url()).pathname.replace('/assets/sounds/', '').replace('.opus', ''))
    await route.fulfill({ status: 200, contentType: 'audio/wav', body: wav() })
  })
  return played
}

const strokes = (tag: string) => [`${tag}-press`, `${tag}-release`]

test.beforeAll(async ({ browser }) => {
  await createUser(editor, ['keylab-editor'])
  const page = await browser.newPage()
  await signIn(page, editor)
  const types = ['linear', 'tactile', 'clicky', 'silent']
  for (const [i, type] of types.entries()) {
    const sw = await createDraft(page, { name: `${token} ${type}`, type, profile: 'deep', forceG: 45 + i * 5 })
    const tag = `${token.toLowerCase()}-${i}`
    markStockSoundsReady(sw.id, tag)
    expect(await setPublished(page, sw.id, true)).toBe(200)
    recorded.push({ ...sw, tag })
  }
  // Published with sound, then the recordings were removed: "missing".
  const gone = await createDraft(page, { name: `${token} proto`, type: 'tactile', profile: 'poppy', forceG: 58 })
  markStockSoundsReady(gone.id)
  expect(await setPublished(page, gone.id, true)).toBe(200)
  markSoundsMissing(gone.id)
  silent = { ...gone, tag: '' }
  await page.close()
})

test.afterAll(async ({ browser }) => {
  const page = await browser.newPage()
  await signIn(page, editor)
  for (const sw of [...recorded, silent]) {
    if (sw.id) {
      await setPublished(page, sw.id, false)
    }
  }
  await page.close()
  await deleteUser(editor.email)
})

test('the landing strip plays three recorded switches and draws their stored peaks', async ({ page }, testInfo) => {
  const played = await serveSounds(page)
  await page.setViewportSize({ width: 1440, height: 1200 })
  await page.goto('/keylab/home')
  await expect(page.getByRole('heading', { level: 1, name: 'HEAR EVERY SWITCH BEFORE YOU BUY ONE.' })).toBeVisible()
  await expect(page.getByRole('heading', { level: 2, name: 'COMPARE THREE SWITCHES' })).toBeVisible()

  // The newest three recorded switches; the one without sound is never offered.
  const items = page.getByTestId('compare-strip-item')
  await expect(items).toHaveCount(3)
  const newest = recorded.slice(1).reverse()
  for (const [i, sw] of newest.entries()) {
    await expect(items.nth(i)).toContainText(sw.name)
  }
  await expect(page.getByTestId('compare-strip')).not.toContainText(silent.name)

  // Waveforms come from CAT-03's peaks: drawn before anything was fetched from the CDN.
  const waves = page.getByTestId('compare-strip').getByRole('img', { name: 'Waveform, press then release, 360 milliseconds' })
  await expect(waves).toHaveCount(3)
  await expect(waves.first().locator('rect')).not.toHaveCount(0)
  expect(played).toEqual([])
  await page.screenshot({ path: testInfo.outputPath('landing-desktop.png'), fullPage: true })

  // Each play button plays its own press, then release.
  await page.getByRole('button', { name: `Play ${newest[1].name}` }).click()
  await expect.poll(() => played).toEqual(strokes(newest[1].tag))
  await page.getByRole('button', { name: 'Try the sound' }).click()
  await expect.poll(() => played).toEqual([...strokes(newest[1].tag), ...strokes(newest[0].tag)])
  await expect(page.getByText('This sound could not be played.')).toHaveCount(0)

  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByText('Swipe, press play, hear the difference.')).toBeVisible()
  await page.getByRole('heading', { name: 'COMPARE THREE SWITCHES' }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: testInfo.outputPath('landing-mobile.png') })
})

test('compare mode picks up to three recorded switches and plays them in turn', async ({ page }, testInfo) => {
  const played = await serveSounds(page)
  await page.setViewportSize({ width: 1440, height: 1300 })
  await page.goto(`/keylab/switches?q=${token}`)
  await expect(page.getByTestId('app-library-card')).toHaveCount(5)

  await page.getByRole('button', { name: 'Compare mode' }).click()
  await expect(page.getByRole('button', { name: 'Compare mode' })).toHaveAttribute('aria-pressed', 'true')
  const panel = page.getByTestId('compare-panel')
  await expect(panel.getByRole('heading', { name: 'Compare 0/3' })).toBeVisible()
  await expect(panel).toContainText('Pick up to 3 switches from the library to hear them back to back and compare their curves.')

  // No recording: "Sound coming soon", and pressing it picks nothing.
  const noSound = page.getByRole('img', { name: new RegExp(`^${silent.name}, .*sound coming soon`) })
  await expect(noSound).toContainText('Sound coming soon')
  await noSound.click()
  await expect(panel.getByRole('heading', { name: 'Compare 0/3' })).toBeVisible()

  const card = (sw: Seeded) => page.getByRole('button', { name: new RegExp(`^${sw.name}, `) })
  for (const sw of recorded.slice(0, 3)) {
    await card(sw).click()
  }
  await expect(card(recorded[0])).toHaveAttribute('aria-pressed', 'true')
  // A fourth is not taken.
  await card(recorded[3]).click()
  await expect(card(recorded[3])).toHaveAttribute('aria-pressed', 'false')
  await expect(panel.getByRole('heading', { name: 'Compare 3/3' })).toBeVisible()

  const rows = panel.getByTestId('compare-row')
  await expect(rows).toHaveCount(3)
  for (const [i, sw] of recorded.slice(0, 3).entries()) {
    await expect(rows.nth(i)).toContainText(sw.name)
    await expect(rows.nth(i).getByRole('img', { name: 'Waveform, press then release, 360 milliseconds' })).toBeVisible()
    await expect(rows.nth(i).getByRole('img', { name: /force curve/ })).toBeVisible()
  }
  await page.screenshot({ path: testInfo.outputPath('compare-desktop.png'), fullPage: true })

  // "Play in turn": each switch's press then release, in the order picked.
  played.length = 0
  await panel.getByRole('button', { name: 'Play in turn' }).click()
  await expect.poll(() => played, { timeout: 10_000 }).toEqual(recorded.slice(0, 3).flatMap((sw) => strokes(sw.tag)))
  await expect(panel.getByText('This sound could not be played.')).toHaveCount(0)

  // Unpick one, then Clear.
  await card(recorded[1]).click()
  await expect(panel.getByRole('heading', { name: 'Compare 2/3' })).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByRole('button', { name: 'Compare', exact: true })).toBeVisible()
  await expect(panel).toBeInViewport()
  await page.screenshot({ path: testInfo.outputPath('compare-mobile.png') })
  await panel.getByRole('button', { name: 'Clear' }).click()
  await expect(panel.getByRole('heading', { name: 'Compare 0/3' })).toBeVisible()
  await expect(panel).toContainText('Pick up to 3 switches above to hear them back to back.')
})
