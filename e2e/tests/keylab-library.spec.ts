import { expect, test } from '@playwright/test'
import { createUser, deleteUser, newUser, signIn } from './support'
import { createDraft, markStockSoundsReady, setPublished } from './keylab-support'

// US-02, end to end: the public library (/keylab/library) and the app
// library (/keylab/switches) filter published switches through CAT-01, and
// an empty result offers "Clear filters". Two switches with a shared name
// token are published for the run, so the search keeps other dev data out.
const editor = newUser('keylab-librarian')
const token = `Lib${Date.now().toString(36)}`
const ids: string[] = []

test.beforeAll(async ({ browser }) => {
  await createUser(editor, ['keylab-editor'])
  const page = await browser.newPage()
  await signIn(page, editor)
  for (const seed of [
    { name: `${token} Alpha`, type: 'linear', profile: 'deep', forceG: 45 },
    { name: `${token} Beta`, type: 'tactile', profile: 'poppy', forceG: 62 },
  ]) {
    const sw = await createDraft(page, seed)
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

test('a guest filters the public library and clears an empty result', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1400 })
  await page.goto('/keylab/library')
  const cards = page.getByTestId('library-card')

  await page.getByLabel('Search').fill(token)
  await expect(page).toHaveURL(new RegExp(`q=${token}`))
  await expect(cards).toHaveCount(2)
  await expect(page.getByRole('heading', { name: '2 switches' })).toBeVisible()

  await page.getByRole('group', { name: 'Type' }).getByRole('button', { name: 'Linear' }).click()
  await expect(cards).toHaveCount(1)
  await expect(cards.first()).toContainText(`${token} Alpha`)

  await page.getByRole('group', { name: 'Sound' }).getByRole('button', { name: 'Poppy' }).click()
  await expect(cards).toHaveCount(0)
  await expect(page.getByText('No switches match these filters')).toBeVisible()

  await page.getByRole('button', { name: 'Clear filters' }).click()
  await expect(page).toHaveURL(/\/keylab\/library$/)
  await expect(page.getByLabel('Search')).toHaveValue('')
  await expect(page.getByText('No switches match these filters')).toHaveCount(0)
  await expect(cards.first()).toBeVisible()

  // Force and recording filters, straight from the URL.
  await page.goto(`/keylab/library?q=${token}&force=heavy`)
  await expect(cards).toHaveCount(0)
  await page.goto(`/keylab/library?q=${token}&force=medium&sound=recorded`)
  await expect(cards).toHaveCount(1)
  await expect(cards.first()).toContainText(`${token} Beta`)
})

test('a member filters the app library and clears an empty result', async ({ page }, testInfo) => {
  await signIn(page, editor)
  await page.setViewportSize({ width: 1440, height: 1200 })
  await page.goto(`/keylab/switches?q=${token}`)
  const cards = page.getByTestId('app-library-card')
  await expect(page.getByRole('heading', { name: 'Switch library' })).toBeVisible()
  await expect(cards).toHaveCount(2)
  await page.screenshot({ path: testInfo.outputPath('switches-desktop.png'), fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByRole('heading', { name: 'Switches', exact: true })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('switches-mobile.png'), fullPage: true })
  await page.setViewportSize({ width: 1440, height: 1200 })

  await page.getByRole('group', { name: 'Switch type' }).getByRole('button', { name: 'Tactile' }).click()
  await expect(cards).toHaveCount(1)
  await expect(cards.first()).toContainText(`${token} Beta`)

  await page.getByRole('button', { name: '≤50g' }).click()
  await expect(cards).toHaveCount(0)
  await expect(page.getByText('No switches match these filters')).toBeVisible()

  await page.getByRole('button', { name: 'Clear filters' }).click()
  await expect(page).toHaveURL(/\/keylab\/switches$/)
  await expect(cards.first()).toBeVisible()

  await cards.first().getByRole('link', { name: /details/ }).click()
  await expect(page).toHaveURL(/\/keylab\/library\//)
})
