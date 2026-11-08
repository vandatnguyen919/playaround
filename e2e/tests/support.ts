// Test data and helpers: throwaway users through the Keycloak admin API, and
// mail read from the Mailpit API. Every test makes its own user with a random
// email and deletes it afterwards, so tests never share state.
import { expect, type Page } from '@playwright/test'
import { randomBytes } from 'node:crypto'

export const APP = process.env.APP_URL ?? 'http://localhost:5174'
export const KC = process.env.KC_URL ?? 'http://localhost:8080'
export const MAILPIT = process.env.MAILPIT_URL ?? 'http://localhost:8025'
const ADMIN_USER = process.env.KC_BOOTSTRAP_ADMIN_USERNAME ?? 'admin'
const ADMIN_PASS = process.env.KC_BOOTSTRAP_ADMIN_PASSWORD ?? 'admin'
const REALM = 'playground'

export const JWT = /eyJ[\w-]+\.eyJ[\w-]+\.[\w-]+/

export type TestUser = { id?: string; email: string; password: string; fullName: string }

export function newUser(prefix: string): TestUser {
  const tag = randomBytes(4).toString('hex')
  return { email: `e2e-${prefix}-${tag}@example.com`, password: `E2e-pass-${tag}`, fullName: `E2E ${prefix} ${tag}` }
}

async function adminToken(): Promise<string> {
  const res = await fetch(`${KC}/realms/master/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'password', client_id: 'admin-cli', username: ADMIN_USER, password: ADMIN_PASS }),
  })
  if (!res.ok) throw new Error(`Keycloak admin token failed: HTTP ${res.status}`)
  return (await res.json()).access_token
}

async function admin(path: string, init: { method?: string; json?: unknown } = {}): Promise<Response> {
  return fetch(`${KC}/admin/realms/${REALM}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      authorization: `Bearer ${await adminToken()}`,
      ...(init.json ? { 'content-type': 'application/json' } : {}),
    },
    body: init.json ? JSON.stringify(init.json) : undefined,
  })
}

/** A verified user with a password. Realm default roles give "user"; extraRoles adds more. */
export async function createUser(user: TestUser, extraRoles: string[] = []): Promise<TestUser> {
  const res = await admin('/users', {
    method: 'POST',
    json: {
      username: user.email,
      email: user.email,
      enabled: true,
      emailVerified: true,
      attributes: { fullName: [user.fullName] },
      credentials: [{ type: 'password', value: user.password, temporary: false }],
    },
  })
  if (res.status !== 201) throw new Error(`Create user failed: HTTP ${res.status} ${await res.text()}`)
  const id = res.headers.get('location')!.split('/').pop()!
  if (extraRoles.length) {
    const roles = await Promise.all(extraRoles.map(async (r) => (await admin(`/roles/${r}`)).json()))
    const mapped = await admin(`/users/${id}/role-mappings/realm`, { method: 'POST', json: roles })
    if (mapped.status !== 204) throw new Error(`Role mapping failed: HTTP ${mapped.status}`)
  }
  return { ...user, id }
}

/** Deletes every user with this email (also users created by the register flow). */
export async function deleteUser(email: string): Promise<void> {
  const found = await (await admin(`/users?exact=true&email=${encodeURIComponent(email)}`)).json()
  for (const u of found) await admin(`/users/${u.id}`, { method: 'DELETE' })
}

export async function findUser(email: string): Promise<{ id: string; emailVerified: boolean; attributes?: Record<string, string[]> } | null> {
  const found = await (await admin(`/users?exact=true&email=${encodeURIComponent(email)}`)).json()
  return found[0] ?? null
}

type Mail = { ID: string; Subject: string; Text: string; HTML: string }

/** Waits for the newest mail to this address (polls the Mailpit API, no fixed sleep). */
export async function waitForMail(to: string, timeoutMs = 30_000): Promise<Mail> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const list = await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`)).json()
    if (list.messages?.length) {
      return (await fetch(`${MAILPIT}/api/v1/message/${list.messages[0].ID}`)).json()
    }
    if (Date.now() > deadline) throw new Error(`No mail to ${to} within ${timeoutMs} ms`)
    await new Promise((r) => setTimeout(r, 500))
  }
}

/** The Keycloak action link (verify email, reset password) in a mail. */
export function actionLink(mail: Mail): string {
  const link = mail.Text.match(/https?:\/\/\S+action-token\S+/)?.[0]
  if (!link) throw new Error(`No action link in mail "${mail.Subject}"`)
  return link.replace(/&amp;/g, '&')
}

/** From the SPA home page through the themed Keycloak login form, back to the app. */
export async function signIn(page: Page, user: TestUser): Promise<void> {
  await page.goto('/')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expectLoginPage(page)
  await fillLogin(page, user.email, user.password)
  await expect(page).toHaveURL(`${APP}/`)
}

export async function fillLogin(page: Page, email: string, password: string): Promise<void> {
  await page.locator('input[name="username"]').fill(email)
  await page.locator('input[name="password"]').fill(password)
  await page.locator('button[type="submit"]').click()
}

export async function expectLoginPage(page: Page): Promise<void> {
  await expect(page).toHaveURL(new RegExp(`^${KC}/realms/${REALM}/`))
  await expect(page.getByRole('heading', { name: /Welcome Back/ })).toBeVisible()
}

export async function expectProfile(page: Page, user: TestUser): Promise<void> {
  await page.goto('/me')
  await expect(page.getByRole('heading', { name: 'Your profile' })).toBeVisible()
  await expect(page.getByRole('heading', { name: user.fullName })).toBeVisible()
  await expect(page.locator('dd').first()).toHaveText(user.email)
}
