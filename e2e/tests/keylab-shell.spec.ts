import { expect, test, type Page } from '@playwright/test'
import { APP, createUser, deleteUser, JWT, newUser, signIn } from './support'

// KeyLab foundation (KL0), end to end: browser → Vite → gateway BFF
// (/bff/keylab/v1/**, token relay) → keylab-api (/v1/**). The shell renders
// both layouts, its API status comes through the BFF, errors arrive as
// problem+json, and a signed-in call reaches keylab-api with the user's
// token, which never shows up in the browser.
const user = newUser('keylab')

test.beforeAll(async () => {
  await createUser(user)
})

test.afterAll(async () => {
  await deleteUser(user.email)
})

const HEALTH = '/bff/keylab/v1/health'

function apiStatus(page: Page) {
  return page.getByTestId('api-status')
}

test('desktop: the sidebar shell, with the API status read through the BFF', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  const health = page.waitForResponse((res) => res.url().endsWith(HEALTH))
  await page.goto('/keylab')

  const res = await health
  expect(res.status()).toBe(200)
  expect(res.headers()['keylab-api-revision']).toBe('2026-11-08')

  const sidebar = page.getByRole('complementary', { name: 'KeyLab' })
  await expect(sidebar).toBeVisible()
  const nav = sidebar.getByRole('navigation', { name: 'Primary' })
  for (const item of ['Build', 'Switches', 'Mods', 'Keycaps', 'Case & plate', 'Playground', 'My builds']) {
    await expect(nav.getByRole('link', { name: item, exact: true })).toBeVisible()
  }
  await expect(nav.getByRole('link', { name: 'Build', exact: true })).toHaveAttribute('aria-current', 'page')
  // The mobile tab bar is not shown at this width.
  await expect(page.locator('nav.nav')).toBeHidden()

  await expect(page.getByRole('heading', { level: 1, name: 'Start a build' })).toBeVisible()
  await expect(apiStatus(page)).toHaveAttribute('data-state', 'ok')
  await expect(apiStatus(page)).toContainText('revision 2026-11-08')
  await expect(apiStatus(page)).toContainText('guest')
  await expect(sidebar.getByRole('link', { name: /Sign in/ })).toBeVisible()

  // Navigation stays in the app and moves the current-page marker.
  await nav.getByRole('link', { name: 'Switches', exact: true }).click()
  await expect(page).toHaveURL(/\/keylab\/switches$/)
  await expect(nav.getByRole('link', { name: 'Switches', exact: true })).toHaveAttribute('aria-current', 'page')

  // Ink theme, kept across a reload.
  await sidebar.getByRole('button', { name: 'Ink theme' }).click()
  await expect(page.locator('.kl')).toHaveAttribute('data-theme', 'dark')
  await page.reload()
  await expect(page.locator('.kl')).toHaveAttribute('data-theme', 'dark')
  await sidebar.getByRole('button', { name: 'Paper theme' }).click()

  await page.goto('/keylab')
  await expect(apiStatus(page)).toHaveAttribute('data-state', 'ok')
  await testInfo.attach('keylab-desktop', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })
})

test('mobile: the sun header and the bottom tab bar at 390 px', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/keylab')

  await expect(page.getByRole('complementary', { name: 'KeyLab' })).toBeHidden()
  await expect(page.getByRole('link', { name: 'Open sound playground' })).toBeVisible()
  const tabs = page.locator('nav.nav')
  await expect(tabs).toBeVisible()
  for (const item of ['Build', 'Switches', 'Mods', 'Keycaps', 'My builds']) {
    await expect(tabs.getByRole('link', { name: item, exact: true })).toBeVisible()
  }
  await expect(tabs.getByRole('link', { name: 'Build', exact: true })).toHaveAttribute('aria-current', 'page')

  // Every tab is a 44 px touch target or larger.
  for (const link of await tabs.getByRole('link').all()) {
    const box = await link.boundingBox()
    expect(box!.height).toBeGreaterThanOrEqual(44)
    expect(box!.width).toBeGreaterThanOrEqual(44)
  }
  // The tab bar sits at the bottom of the viewport, and nothing scrolls sideways.
  const bar = await tabs.boundingBox()
  expect(Math.round(bar!.y + bar!.height)).toBe(844)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)

  await expect(apiStatus(page)).toHaveAttribute('data-state', 'ok')
  await testInfo.attach('keylab-mobile', { body: await page.screenshot(), contentType: 'image/png' })
})

test('errors from keylab-api come through the BFF as problem+json', async ({ page }) => {
  // A guest on a members-only endpoint (BLD-01): nothing is relayed, keylab-api asks for a sign-in.
  // (A build's link, BLD-03, is open to guests since US-12, so it is no longer the example.)
  const guest = await page.request.get('/bff/keylab/v1/me/builds', { maxRedirects: 0 })
  expect(guest.status()).toBe(401)
  expect(guest.headers()['content-type']).toContain('application/problem+json')
  expect(guest.headers()['keylab-api-revision']).toBe('2026-11-08')
  expect(guest.headers()['location']).toBeUndefined()
  expect(await guest.json()).toMatchObject({
    type: 'https://keylab.app/problems/unauthenticated',
    status: 401,
    code: 'unauthenticated',
  })
})

test('signed in: keylab-api sees the user and the keylab-user role, the browser never sees a token', async ({ page }, testInfo) => {
  const seen: string[] = []
  page.on('response', async (res) => {
    if (res.url().includes('/bff/keylab/')) {
      seen.push(JSON.stringify(res.headers()))
      try {
        seen.push(await res.text())
      } catch {
        // body not available for this response
      }
    }
  })
  await signIn(page, user)

  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/keylab')
  await expect(apiStatus(page)).toHaveAttribute('data-state', 'ok')
  await expect(apiStatus(page)).toContainText('signed in · keylab-user')
  await expect(page.getByRole('link', { name: 'Your profile' })).toBeVisible()

  const health = await (await page.request.get(HEALTH)).json()
  expect(health).toEqual({ status: 'ok', revision: '2026-11-08', authenticated: true, roles: ['keylab-user'] })

  // Signed in, an unknown keylab-api path is a 404 problem, not a 401.
  const missing = await page.request.get('/bff/keylab/v1/no-such-thing')
  expect(missing.status()).toBe(404)
  expect(missing.headers()['content-type']).toContain('application/problem+json')
  expect(await missing.json()).toMatchObject({ status: 404, code: 'not_found' })

  // A member has no admin role.
  const adminCall = await page.request.get('/bff/keylab/v1/admin/anything')
  expect(adminCall.status()).toBe(403)
  expect(await adminCall.json()).toMatchObject({ code: 'forbidden' })

  // No JWT in the app's cookies, storage, or anything the BFF sent back.
  // Keycloak's own cookies (KEYCLOAK_IDENTITY is a JWT) belong to Keycloak's
  // origin and never go to the app, so only the app origin's cookies count.
  const appCookies = await page.context().cookies(APP)
  expect(appCookies.map((c) => c.name)).toContain('SESSION')
  for (const cookie of appCookies) {
    expect(cookie.value, `cookie ${cookie.name}`).not.toMatch(JWT)
  }
  const storage = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))
  expect(storage).not.toMatch(JWT)
  expect(seen.join('\n')).not.toMatch(JWT)
  await testInfo.attach('keylab-signed-in', { body: await page.screenshot(), contentType: 'image/png' })
})
