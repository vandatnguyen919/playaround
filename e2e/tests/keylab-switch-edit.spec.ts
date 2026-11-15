import { expect, test, type Page } from '@playwright/test'
import { createUser, deleteUser, newUser, signIn } from './support'

// US-37, end to end: an editor adds a draft switch with its specs and force
// curve, edits it, sees invalid specs refused field by field, and deletes it.
// Browser → Vite → gateway BFF → keylab-api (ADM-02) → Postgres. A member
// without the editor role is turned away by keylab-api, and the draft never
// reaches anything a guest can read.
const editor = newUser('keylab-editor')
const member = newUser('keylab-member')

test.beforeAll(async () => {
  await createUser(editor, ['keylab-editor'])
  await createUser(member)
})

test.afterAll(async () => {
  await deleteUser(editor.email)
  await deleteUser(member.email)
})

async function shot(page: Page, path: string): Promise<string> {
  await page.screenshot({ path, fullPage: true })
  return path
}

async function point(page: Page, row: number, travel: string, force: string) {
  await page.getByLabel(`Point ${row} travel`).fill(travel)
  await page.getByLabel(`Point ${row} force`).fill(force)
}

test('an editor adds, edits and deletes a draft switch with its force curve', async ({ page }, testInfo) => {
  await signIn(page, editor)
  await page.setViewportSize({ width: 1440, height: 1500 })
  await page.goto('/keylab/admin/switches/new')

  await expect(page.getByRole('heading', { level: 1, name: 'Add switch' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Admin' }).getByRole('link', { name: 'Switches' })).toHaveAttribute(
    'aria-current',
    'page',
  )
  await expect(page.getByText('Add at least two points to draw the curve.')).toBeVisible()

  // Saving with no name is stopped in the browser.
  await page.getByRole('button', { name: 'Save draft' }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'Give the switch a name.' })).toBeVisible()

  const name = `Coral Pop ${Date.now().toString(36)}`
  await page.getByLabel('Name').fill(name)
  await page.getByLabel('Brand').fill('Clack Works')
  await page.getByRole('radio', { name: 'Tactile' }).click()
  await page.getByRole('radio', { name: 'Coral' }).click()
  await page.getByLabel('Actuation force').fill('62')
  await page.getByLabel('Actuation point').fill('2.0')
  await page.getByLabel('Total travel').fill('3.8')
  await page.getByLabel('Spring').fill('18')

  // The curve is drawn as the points are typed.
  const chart = page.getByRole('img', { name: /force curve from/ })
  const rows: [string, string][] = [['0.0', '0'], ['0.4', '38'], ['0.8', '76'], ['2.0', '62'], ['3.8', '92']]
  for (const [i, [t, f]] of rows.entries()) {
    await page.getByRole('button', { name: '+ Add point' }).click()
    await expect(page.getByLabel(`Point ${i + 1} travel`)).toBeFocused()
    await point(page, i + 1, t, f)
    if (i === 1) {
      await expect(chart).toHaveAttribute('aria-label', /from 2 points/)
    }
  }
  await expect(chart).toHaveAttribute('aria-label', /from 5 points: actuates at 62 grams after 2 millimetres/)
  const pathBefore = await chart.locator('path').nth(1).getAttribute('d')
  await page.getByLabel('Point 5 force').fill('120')
  await expect.poll(() => chart.locator('path').nth(1).getAttribute('d')).not.toBe(pathBefore)
  await page.getByLabel('Point 5 force').fill('92')

  const preview = page.getByRole('img', { name: new RegExp(`^${name}, Tactile, 62 grams, no sound available$`) })
  await expect(preview).toBeVisible()
  await expect(page.getByRole('listitem').filter({ hasText: 'Specs and force curve' })).toContainText('done')

  // Create: POST with an Idempotency-Key, then the page moves to the switch's own URL.
  const created = page.waitForResponse((res) => res.url().endsWith('/bff/keylab/v1/admin/switches') && res.request().method() === 'POST')
  await page.getByRole('button', { name: 'Save draft' }).click()
  const createdRes = await created
  expect(createdRes.status()).toBe(201)
  expect(createdRes.request().headers()['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/)
  const sw = await createdRes.json()
  expect(sw).toMatchObject({ name, brand: 'Clack Works', type: 'tactile', stemColor: '#F16B53', status: 'draft', forceG: 62 })
  expect(sw.forceCurve).toHaveLength(5)
  await expect(page).toHaveURL(new RegExp(`/keylab/admin/switches/${sw.id}$`))
  await expect(page.getByRole('status').filter({ hasText: 'Draft saved' })).toContainText('Only admins can see it.')
  await expect(page.getByRole('heading', { level: 1, name: 'Edit switch' })).toBeVisible()
  await testInfo.attach('switch-created', { path: await shot(page, testInfo.outputPath('switch-created.png')), contentType: 'image/png' })

  // Invalid specs: the API answers 422 and each field shows its message.
  await page.getByLabel('Actuation point').fill('4.0')
  await page.getByLabel('Point 2 travel').fill('0.0')
  await page.getByLabel('Actuation force').fill('62g')
  const refused = page.waitForResponse((res) => res.url().includes(`/admin/switches/${sw.id}`) && res.request().method() === 'PATCH')
  await page.getByRole('button', { name: 'Save draft' }).click()
  const refusedRes = await refused
  expect(refusedRes.status()).toBe(422)
  expect(refusedRes.request().headers()['content-type']).toContain('application/merge-patch+json')
  expect(refusedRes.request().headers()['if-match']).toBe('"1"')
  await expect(page.getByRole('alert').filter({ hasText: 'Some fields need a fix' })).toBeVisible()
  await expect(page.getByLabel('Actuation point')).toHaveAttribute('aria-invalid', 'true')
  await expect(page.getByText('Must be less than the total travel.')).toBeVisible()
  await expect(page.getByLabel('Actuation force')).toHaveAttribute('aria-invalid', 'true')
  await expect(page.getByText('Enter a number.')).toBeVisible()
  await expect(page.getByLabel('Point 2 travel')).toHaveAttribute('aria-invalid', 'true')
  await expect(page.getByText('Point 2 travel: Another point already sits at 0 mm.')).toBeVisible()
  await testInfo.attach('switch-invalid', { path: await shot(page, testInfo.outputPath('switch-invalid.png')), contentType: 'image/png' })

  // Fix and save: PATCH with the ETag, which moves on.
  await page.getByLabel('Actuation point').fill('2.0')
  await page.getByLabel('Point 2 travel').fill('0.4')
  await page.getByLabel('Actuation force').fill('65')
  await page.getByLabel('Brand').fill('')
  const saved = page.waitForResponse((res) => res.url().includes(`/admin/switches/${sw.id}`) && res.request().method() === 'PATCH')
  await page.getByRole('button', { name: 'Save draft' }).click()
  const savedRes = await saved
  expect(savedRes.status()).toBe(200)
  expect(savedRes.headers()['etag']).toBe('"2"')
  const edited = await savedRes.json()
  expect(edited.forceG).toBe(65)
  expect(edited.brand).toBeUndefined()
  await expect(page.getByLabel('Actuation force')).not.toHaveAttribute('aria-invalid', 'true')

  // A reload shows what was stored.
  await page.reload()
  await expect(page.getByLabel('Name')).toHaveValue(name)
  await expect(page.getByLabel('Actuation force')).toHaveValue('65')
  await expect(page.getByLabel('Point 5 force')).toHaveValue('92')

  // Admin is also checked at 1024 px: icon sidebar, nothing scrolls sideways.
  await page.setViewportSize({ width: 1024, height: 1300 })
  await expect(page.getByRole('navigation', { name: 'Admin' }).getByText('Sound library')).toBeHidden()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1024)
  await testInfo.attach('switch-1024', { path: await shot(page, testInfo.outputPath('switch-1024.png')), contentType: 'image/png' })
  await page.setViewportSize({ width: 1440, height: 1500 })

  // The draft is not for guests: the admin API wants a sign-in, and the public library leaves it out.
  const guest = await page.context().browser()!.newContext({ baseURL: page.url() })
  const guestGet = await guest.request.get(`/bff/keylab/v1/admin/switches/${sw.id}`)
  expect(guestGet.status()).toBe(401)
  expect((await guest.request.get(`/bff/keylab/v1/switches/${sw.slug}`)).status()).toBe(404)
  const library = await guest.request.get(`/bff/keylab/v1/switches?q=${encodeURIComponent(name)}`)
  expect(library.status()).toBe(200)
  expect((await library.json()).data).toHaveLength(0)
  await guest.close()

  // Publishing waits for sounds (US-38, US-39).
  // aria-disabled keeps it focusable, so it can say why; Playwright will not click it.
  const publish = page.getByRole('button', { name: 'Publish to library' })
  await expect(publish).toHaveAttribute('aria-disabled', 'true')
  await publish.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('alert').filter({ hasText: 'Can’t publish yet' })).toBeVisible()

  // Delete, after a confirmation.
  await page.getByRole('button', { name: 'Delete draft' }).click()
  await expect(page.getByRole('alertdialog')).toContainText(`Delete ${name}?`)
  const deleted = page.waitForResponse((res) => res.url().includes(`/admin/switches/${sw.id}`) && res.request().method() === 'DELETE')
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete', exact: true }).click()
  const deletedRes = await deleted
  expect(deletedRes.status()).toBe(204)
  expect(deletedRes.request().headers()['if-match']).toBe('"2"')
  await expect(page).toHaveURL(/\/keylab\/admin\/switches$/)
  await expect(page.getByRole('status').filter({ hasText: 'Draft deleted' })).toBeVisible()
  expect((await page.request.get(`/bff/keylab/v1/admin/switches/${sw.id}`)).status()).toBe(404)
})

test('a member without the editor role cannot add switches', async ({ page }) => {
  await signIn(page, member)
  await page.goto('/keylab/admin/switches/new')
  await expect(page.getByText('You need the editor role to add or edit switches.')).toBeVisible()
  const res = await page.request.post('/bff/keylab/v1/admin/switches', {
    data: { name: 'Sneaky', type: 'linear' },
    headers: { 'X-XSRF-TOKEN': (await page.context().cookies()).find((c) => c.name === 'XSRF-TOKEN')?.value ?? '' },
  })
  expect(res.status()).toBe(403)
})
