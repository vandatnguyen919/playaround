import { expect, test } from '@playwright/test'
import { createUser, deleteUser, expectLoginPage, newUser, signIn } from './support'

// 401 and 403 as the SPA handles them: no session sends the browser to the
// Keycloak login (top-level navigation, never an XHR redirect); a signed-in
// user without the role gets the Access denied page.
const user = newUser('authz-user')
const admin = newUser('authz-admin')

test.beforeAll(async () => {
  await createUser(user)
  await createUser(admin, ['admin'])
})

test.afterAll(async () => {
  await deleteUser(user.email)
  await deleteUser(admin.email)
})

test('401: the API answers 401 with no redirect, and the SPA sends the browser to sign in', async ({ page }) => {
  const res = await page.request.get('/bff/me', { maxRedirects: 0 })
  expect(res.status()).toBe(401)
  expect(res.headers()['location']).toBeUndefined()
  expect((await page.request.get('/bff/admin', { maxRedirects: 0 })).status()).toBe(401)

  await page.goto('/me')
  await expectLoginPage(page)
})

test('403: a user without the admin role sees Access denied', async ({ page }, testInfo) => {
  await signIn(page, user)
  expect((await page.request.get('/bff/admin')).status()).toBe(403)

  await page.goto('/admin')
  await expect(page).toHaveURL(/\/forbidden$/)
  await expect(page.getByRole('heading', { name: 'Access denied' })).toBeVisible()
  await testInfo.attach('forbidden-page', { body: await page.screenshot(), contentType: 'image/png' })
})

test('an admin reaches the admin area', async ({ page }) => {
  await signIn(page, admin)
  await page.goto('/admin')
  await expect(page.getByText('Admin access granted.')).toBeVisible()
  expect((await page.request.get('/bff/admin')).status()).toBe(200)
})
