import { expect, test } from '@playwright/test'
import { APP, actionLink, deleteUser, expectLoginPage, expectProfile, findUser, newUser, waitForMail } from './support'

const user = newUser('register')

test.afterAll(async () => {
  await deleteUser(user.email)
})

test('register, verify the email from the Mailpit link, and land signed in', async ({ page }, testInfo) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expectLoginPage(page)
  await page.getByRole('link', { name: 'Sign Up' }).click()
  await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible()

  await page.locator('input[name="fullName"]').fill(user.fullName)
  await page.locator('input[name="email"]').fill(user.email)
  await page.locator('input[name="password"]').fill(user.password)
  await page.locator('input[name="password-confirm"]').fill(user.password)
  await page.locator('button[type="submit"]').click()

  // The realm requires a verified email before the first sign-in completes.
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible()
  const created = await findUser(user.email)
  expect(created, 'user exists in Keycloak').toBeTruthy()
  expect(created!.emailVerified).toBe(false)
  expect(created!.attributes?.fullName).toEqual([user.fullName])

  const mail = await waitForMail(user.email)
  expect(mail.Subject).toMatch(/verify/i)
  await page.goto(actionLink(mail))

  await expect(page).toHaveURL(`${APP}/`)
  await expectProfile(page, user)
  expect((await findUser(user.email))!.emailVerified).toBe(true)
  await testInfo.attach('profile-after-register', { body: await page.screenshot(), contentType: 'image/png' })
})
