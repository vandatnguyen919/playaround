import { expect, test } from '@playwright/test'
import { APP, JWT, createUser, deleteUser, expectLoginPage, expectProfile, newUser, signIn } from './support'

const user = newUser('login')

test.beforeAll(async () => {
  await createUser(user)
})

test.afterAll(async () => {
  await deleteUser(user.email)
})

test('sign in shows the profile, and the browser holds only the session cookie', async ({ page, context }) => {
  await signIn(page, user)
  await expectProfile(page, user)
  await expect(page.locator('dd').nth(2)).toContainText('user')

  const appCookies = (await context.cookies(APP)).filter((c) => c.path === '/')
  const session = appCookies.find((c) => c.name === 'SESSION')
  expect(session, 'SESSION cookie').toBeTruthy()
  expect(session!.httpOnly).toBe(true)
  expect(session!.sameSite).toBe('Lax')
  for (const c of appCookies) expect(c.value, `cookie ${c.name}`).not.toMatch(JWT)

  const storage = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }))
  expect(storage, 'web storage').not.toMatch(JWT)
})

test('wrong password stays on the login page with an error', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.locator('input[name="username"]').fill(user.email)
  await page.locator('input[name="password"]').fill('not-the-password')
  await page.locator('button[type="submit"]').click()
  await expectLoginPage(page)
  await expect(page.getByRole('alert')).toHaveText('Invalid username or password.')
})

test('sign out ends the session at the gateway and at Keycloak', async ({ page, context }) => {
  await signIn(page, user)
  await expectProfile(page, user)

  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page).toHaveURL(`${APP}/`)
  await expect(page.getByRole('heading', { name: 'authn-authz-playground' })).toBeVisible()

  const cookies = await context.cookies(APP)
  expect(cookies.find((c) => c.name === 'SESSION' && c.path === '/'), 'SESSION cookie after logout').toBeFalsy()
  expect((await page.request.get('/bff/me')).status()).toBe(401)

  // Keycloak's SSO session is gone too: signing in asks for the password again.
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expectLoginPage(page)
})
