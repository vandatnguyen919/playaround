import { expect, test } from '@playwright/test'
import {
  APP,
  actionLink,
  createUser,
  deleteUser,
  expectLoginPage,
  expectProfile,
  fillLogin,
  newUser,
  signIn,
  waitForMail,
} from './support'

const user = newUser('reset')
const newPassword = `${user.password}-new`

test.beforeAll(async () => {
  await createUser(user)
})

test.afterAll(async () => {
  await deleteUser(user.email)
})

test('forgot password: the emailed link sets a new password, and only the new one signs in', async ({ page, browser }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expectLoginPage(page)
  await page.getByRole('link', { name: /Forgot Password/i }).click()
  await expect(page.getByRole('heading', { name: 'Forgot Password?' })).toBeVisible()
  await page.locator('input[name="username"]').fill(user.email)
  await page.getByRole('button', { name: 'Send Reset Link' }).click()
  // Same answer for known and unknown emails (enumeration); back on the login page.
  await expectLoginPage(page)
  await expect(page.getByRole('status')).toContainText('You should receive an email shortly')

  const mail = await waitForMail(user.email)
  expect(mail.Subject).toMatch(/reset/i)
  const link = actionLink(mail)
  await page.goto(link)

  await expect(page.getByRole('heading', { name: 'Set new password' })).toBeVisible()
  await page.locator('input[name="password-new"]').fill(newPassword)
  await page.locator('input[name="password-confirm"]').fill(newPassword)
  await page.getByRole('button', { name: 'Reset Password' }).click()

  // The reset started from the app, so Keycloak finishes the sign-in and returns there.
  await expect(page).toHaveURL(`${APP}/`)
  await expectProfile(page, user)

  // Fresh browsers: the old password fails, the new one works, the link is spent.
  const fresh = await browser.newContext()
  const p = await fresh.newPage()
  await p.goto('/')
  await p.getByRole('button', { name: 'Sign in' }).click()
  await fillLogin(p, user.email, user.password)
  await expectLoginPage(p)
  await expect(p.getByRole('alert')).toHaveText('Invalid username or password.')
  await signIn(p, { ...user, password: newPassword })
  await expectProfile(p, user)
  await p.goto(link)
  await expect(p.getByRole('heading', { name: 'Set new password' })).toHaveCount(0)
  await fresh.close()
})
