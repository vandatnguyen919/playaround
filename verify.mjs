#!/usr/bin/env node
// Usage: ./verify [check...]   (Windows: node verify [check...])
// Needs Keycloak (:8080, theme jar built) and Mailpit (:8025) from infra/docker-compose.yml.
// Checks: enumeration, enumdiff, stuffing, policy, reset, expiredlink,
// olderlink, lockout, layout, flood. No arguments runs all but flood, which
// needs the compose.prod.yml stack and EDGE_HOST (see checkFlood).
// Attack checks pass when the attack fails safely.
import { mkdirSync, writeFileSync } from "node:fs"
import { createHash, randomBytes } from "node:crypto"

const KC = process.env.KC_URL ?? "http://localhost:8080"
const MAILPIT = process.env.MAILPIT_URL ?? "http://localhost:8025"
const ADMIN_USER = process.env.KC_BOOTSTRAP_ADMIN_USERNAME ?? "admin"
const ADMIN_PASS = process.env.KC_BOOTSTRAP_ADMIN_PASSWORD ?? "admin"
const REALM = "playground"
const REDIRECT_URI = "http://localhost:5174/login/oauth2/code/gateway"
const EVIDENCE = ".shipit/verify/evidence/forgot-password"

const runId = new Date().toISOString()
const results = []
const evidence = {}

function record(name, ok, detail = "") {
  results.push({ name, ok, detail })
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  (" + detail + ")" : ""}`)
}

function assert(name, condition, detail = "") {
  record(name, Boolean(condition), detail)
  if (!condition) throw new Error(`Assertion failed: ${name}`)
}

class Jar {
  cookies = new Map()
  store(res) {
    for (const line of res.headers.getSetCookie()) {
      const [pair, ...attrs] = line.split(";")
      const eq = pair.indexOf("=")
      const name = pair.slice(0, eq).trim()
      const value = pair.slice(eq + 1).trim()
      const expired = attrs.some((a) => /^\s*max-age=0/i.test(a)) || value === ""
      if (expired) this.cookies.delete(name)
      else this.cookies.set(name, value)
    }
  }
  header() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ")
  }
}

// Follows redirects by hand so the stop at the app redirect_uri can be seen.
async function browse(jar, url, init = {}) {
  let current = url
  let method = init.method ?? "GET"
  let body = init.body
  for (let hop = 0; hop < 15; hop++) {
    const res = await fetch(current, {
      method,
      body,
      redirect: "manual",
      headers: { cookie: jar.header(), ...(body ? { "content-type": "application/x-www-form-urlencoded" } : {}) },
    })
    jar.store(res)
    const location = res.headers.get("location")
    if (res.status >= 300 && res.status < 400 && location) {
      const next = new URL(location, current).toString()
      if (next.startsWith(REDIRECT_URI)) return { arrivedAtApp: next, html: "", url: current }
      current = next
      method = "GET"
      body = undefined
      continue
    }
    return { arrivedAtApp: null, html: await res.text(), url: current, status: res.status }
  }
  throw new Error("Too many redirects")
}

function unescapeJs(s) {
  return s.replace(/\\\//g, "/").replace(/\\u0026/g, "&").replace(/&amp;/g, "&")
}

function page(html) {
  const pageId = html.match(/kcContext\.pageId\s*=\s*"([^"]+)"/)?.[1] ?? null
  const loginAction = html.match(/"loginAction":\s*"([^"]+)"/)?.[1]
  const resetUrl = html.match(/"loginResetCredentialsUrl":\s*"([^"]+)"/)?.[1]
  const registrationUrl = html.match(/"registrationUrl":\s*"([^"]+)"/)?.[1]
  const fieldErrors = Object.fromEntries(
    [...html.matchAll(/fieldName === '([\w-]+)'\)\{ return decodeHtmlEntities\("((?:[^"\\]|\\.)*)"\)/g)]
      .filter((m) => m[2])
      .map((m) => [m[1], m[2]])
  )
  const message = html.match(/"message":\s*\{[^}]*?"summary":\s*"((?:[^"\\]|\\.)*)"/)?.[1]
  const themed = /\/resources\/[^"']+\/login\/keycloak-theme\//.test(html)
  return {
    pageId,
    themed,
    loginAction: loginAction && new URL(unescapeJs(loginAction), KC).toString(),
    resetUrl: resetUrl && new URL(unescapeJs(resetUrl), KC).toString(),
    registrationUrl: registrationUrl && new URL(unescapeJs(registrationUrl), KC).toString(),
    message: message && unescapeJs(message),
    fieldErrors,
  }
}

function form(fields) {
  return new URLSearchParams(fields).toString()
}

async function startLogin(jar) {
  const challenge = createHash("sha256").update(randomBytes(32)).digest("base64url")
  const authUrl =
    `${KC}/realms/${REALM}/protocol/openid-connect/auth?` +
    form({
      client_id: "gateway",
      response_type: "code",
      scope: "openid",
      redirect_uri: REDIRECT_URI,
      code_challenge: challenge,
      code_challenge_method: "S256",
      state: randomBytes(6).toString("hex"),
    })
  const r = await browse(jar, authUrl)
  return { ...r, ...page(r.html) }
}

async function login(email, password) {
  const jar = new Jar()
  const p = await startLogin(jar)
  const r = await browse(jar, p.loginAction, { method: "POST", body: form({ username: email, password }) })
  return r
}

async function requestReset(email) {
  const jar = new Jar()
  const p = await startLogin(jar)
  const reset = await browse(jar, p.resetUrl)
  const rp = page(reset.html)
  const r = await browse(jar, rp.loginAction, { method: "POST", body: form({ username: email }) })
  return { jar, resetPage: rp, result: r, ...page(r.html) }
}

async function mailFor(address, { wait = 0 } = {}) {
  const deadline = Date.now() + wait
  for (;;) {
    const list = await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent("to:" + address)}`)).json()
    if (list.messages?.length) {
      const msg = await (await fetch(`${MAILPIT}/api/v1/message/${list.messages[0].ID}`)).json()
      return msg
    }
    if (Date.now() >= deadline) return null
    await new Promise((r) => setTimeout(r, 500))
  }
}

async function adminToken() {
  const res = await fetch(`${KC}/realms/master/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form({ grant_type: "password", client_id: "admin-cli", username: ADMIN_USER, password: ADMIN_PASS }),
  })
  if (!res.ok) throw new Error(`Admin token failed: HTTP ${res.status}`)
  return (await res.json()).access_token
}

// A fresh admin token per call: master realm tokens live 60 seconds, and the
// lockout check alone waits longer than that.
async function admin(path, { method = "GET", json } = {}) {
  return fetch(`${KC}/admin/realms/${REALM}${path}`, {
    method,
    headers: { authorization: `Bearer ${await adminToken()}`, ...(json ? { "content-type": "application/json" } : {}) },
    body: json && JSON.stringify(json),
  })
}

async function createUser(email, password) {
  const res = await admin("/users", {
    method: "POST",
    json: {
      username: email,
      email,
      enabled: true,
      emailVerified: true,
      attributes: { fullName: ["Verify Person"] },
      credentials: [{ type: "password", value: password, temporary: false }],
    },
  })
  if (res.status !== 201) throw new Error(`Create user failed: HTTP ${res.status} ${await res.text()}`)
  return res.headers.get("location").split("/").pop()
}

async function deleteUser(id) {
  await admin(`/users/${id}`, { method: "DELETE" })
}

// A throwaway user for one check, deleted afterwards (with any lockout).
async function withUser(prefix, fn) {
  const email = `${prefix}-${randomBytes(4).toString("hex")}@example.com`
  const password = "Attack-Test-1234"
  const id = await createUser(email, password)
  try {
    await fn({ id, email, password })
  } finally {
    await admin(`/attack-detection/brute-force/users/${id}`, { method: "DELETE" })
    await deleteUser(id)
  }
}

async function usersWithEmail(email) {
  return (await (await admin(`/users?exact=true&email=${encodeURIComponent(email)}`)).json()).length
}

async function mailCount(address) {
  const list = await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent("to:" + address)}`)).json()
  return list.messages_count ?? list.messages?.length ?? 0
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Starts registration like the login page's "Create an account" link.
async function register(fields) {
  const jar = new Jar()
  const p = await startLogin(jar)
  const reg = page((await browse(jar, p.registrationUrl)).html)
  const r = await browse(jar, reg.loginAction, { method: "POST", body: form(fields) })
  return { ...page(r.html), arrivedAtApp: r.arrivedAtApp }
}

function resetLink(mail) {
  return unescapeJs(mail.Text.match(/https?:\/\/\S+action-token\S+/)[0])
}

// Credential stuffing at the identity provider: one password tried against
// many accounts, known and unknown. Every attempt must fail the same way, so
// the answers do not tell which accounts exist. The per-IP cap on attempts is
// Traefik's job (check "flood").
async function checkStuffing() {
  await withUser("stuffing", async (known) => {
    const pages = []
    for (let i = 0; i < 6; i++) {
      const target = i === 0 ? known.email : `stuffed-${randomBytes(4).toString("hex")}@example.com`
      const r = await login(target, "Summer2026!")
      pages.push({ known: i === 0, signedIn: Boolean(r.arrivedAtApp), ...page(r.html) })
    }
    evidence.stuffing = pages.map(({ known, pageId, message }) => ({ known, pageId, message }))
    assert("no stuffed attempt signs in", pages.every((p) => !p.signedIn))
    assert("every attempt gets the login page again", pages.every((p) => p.pageId === "login.ftl"))
    assert(
      "known and unknown accounts get the same message",
      new Set(pages.map((p) => p.message)).size === 1,
      `message="${pages[0].message}"`
    )
  })
}

// Brute force on one account: temporary lockout only. After 5 failures the
// right password is refused, the answer is the same as for an email with no
// account (else a lock would tell that the account exists), the account stays
// enabled (no permanent lockout), and the lock lifts by itself.
async function checkLockout() {
  const answer = (r) => {
    const p = page(r.html)
    return JSON.stringify({ pageId: p.pageId, message: p.message, fieldErrors: p.fieldErrors })
  }
  const nobody = answer(await login(`nobody-${randomBytes(4).toString("hex")}@example.com`, "Wrong-guess-0"))
  const lockStatus = async (id) => (await admin(`/attack-detection/brute-force/users/${id}`)).json()
  await withUser("lockout", async (u) => {
    // Over 1 s apart: faster failures trip the quick-login rule first.
    for (let i = 0; i < 4; i++) {
      await login(u.email, `Wrong-guess-${i}`)
      await sleep(1200)
    }
    assert("4 spaced failures do not lock", (await lockStatus(u.id)).disabled === false)
    await login(u.email, "Wrong-guess-4")
    const status = await lockStatus(u.id)
    assert("the 5th failure locks the account", status.disabled === true, `numFailures=${status.numFailures}`)
    const locked = await login(u.email, u.password)
    assert("the right password is refused while locked", !locked.arrivedAtApp)
    assert("a locked account answers like an unknown email", answer(locked) === nobody, answer(locked))
    const user = await (await admin(`/users/${u.id}`)).json()
    assert("the account stays enabled (no permanent lockout)", user.enabled === true)

    // The first lock is waitIncrementSeconds (60 s). Poll the admin status,
    // which does not count as a login attempt.
    const started = Date.now()
    let lifted = false
    while (Date.now() - started < 90000) {
      await sleep(5000)
      if (!(await (await admin(`/attack-detection/brute-force/users/${u.id}`)).json()).disabled) {
        lifted = true
        break
      }
    }
    assert("the lock lifts by itself", lifted, `after ${Math.round((Date.now() - started) / 1000)}s`)
    assert("the right password signs in after the lock", (await login(u.email, u.password)).arrivedAtApp)
  })
}

// Password policy: length(8), notUsername, notEmail. Checked on the register
// form, the place a weak password would come in.
async function checkPolicy() {
  const email = `policy-${randomBytes(4).toString("hex")}@example.com`
  const base = { email, fullName: "Policy Person" }
  const short = await register({ ...base, password: "Short-1", "password-confirm": "Short-1" })
  assert("a 7 character password is refused", short.pageId === "register.ftl", `message="${short.message}"`)
  const same = await register({ ...base, password: email, "password-confirm": email })
  assert("the email as password is refused", same.pageId === "register.ftl", `message="${same.message}"`)
  assert("no account was created", (await usersWithEmail(email)) === 0)
}

// Enumeration, side by side: login and forgot password must not tell known
// from unknown emails. Registration does (accepted, see PRODUCT.md), so the
// check pins down that it changes nothing and sends nothing.
async function checkEnumerationDiff(email, password) {
  const unknown = `nobody-${randomBytes(4).toString("hex")}@example.com`
  const known = page((await login(email, "Not-the-password-1")).html)
  const unk = page((await login(unknown, "Not-the-password-1")).html)
  assert("login: known and unknown email get the same answer", known.pageId === unk.pageId && known.message === unk.message)

  const mailsBefore = await mailCount(email)
  const taken = await register({ email, fullName: "Someone Else", password: "Taken-Email-1", "password-confirm": "Taken-Email-1" })
  evidence.registerExisting = { pageId: taken.pageId, message: taken.message }
  assert("register with a taken email stays on the form", taken.pageId === "register.ftl" && !taken.arrivedAtApp, `message="${taken.message}"`)
  assert("it creates no second account", (await usersWithEmail(email)) === 1)
  await sleep(1500)
  assert("it sends the owner no mail", (await mailCount(email)) === mailsBefore)
  assert("the owner's password still works", (await login(email, password)).arrivedAtApp)
}

// A link past its lifespan must not open the new password form. A reused
// link is covered by "reset".
async function checkExpiredLink() {
  const key = "actionTokenGeneratedByUserLifespan.reset-credentials"
  const realm = await (await admin("")).json()
  const saved = realm.attributes?.[key]
  await admin("", { method: "PUT", json: { attributes: { ...realm.attributes, [key]: "5" } } })
  try {
    await withUser("expired", async (u) => {
      await requestReset(u.email)
      const link = resetLink(await mailFor(u.email, { wait: 15000 }))
      await sleep(7000)
      const expired = page((await browse(new Jar(), link)).html)
      evidence.expiredLink = { pageId: expired.pageId, message: expired.message }
      assert("an expired link does not open the form", expired.pageId !== "login-update-password.ftl", `pageId=${expired.pageId} message="${expired.message}"`)
      assert("the password is unchanged", (await login(u.email, u.password)).arrivedAtApp)
    })
  } finally {
    await admin("", { method: "PUT", json: { attributes: { ...realm.attributes, [key]: saved ?? "900" } } })
  }
}

// Accepted gap: Keycloak checks each reset token on its own, so after a newer
// link is used an older unused one still works until it expires. We accept
// that and pin the bound instead: the realm keeps reset links at 15 minutes,
// and an older link dies at its lifespan even after a newer one was used.
// The lifespan is cut to 20 s for the run and restored after.
async function checkOlderLink() {
  const key = "actionTokenGeneratedByUserLifespan.reset-credentials"
  const realm = await (await admin("")).json()
  const saved = realm.attributes?.[key]
  assert("reset links live 15 minutes", saved === "900", `${key}=${saved}`)
  const lifespan = 20
  await admin("", { method: "PUT", json: { attributes: { ...realm.attributes, [key]: String(lifespan) } } })
  try {
    await withUser("olderlink", async (u) => {
      const issued = Date.now()
      await requestReset(u.email)
      const first = resetLink(await mailFor(u.email, { wait: 15000 }))
      await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent("to:" + u.email)}`, { method: "DELETE" })
      await requestReset(u.email)
      const second = resetLink(await mailFor(u.email, { wait: 15000 }))
      assert("two requests give two different links", first !== second)

      const jar = new Jar()
      const op = page((await browse(jar, second)).html)
      const done = page(
        (await browse(jar, op.loginAction, { method: "POST", body: form({ "password-new": "Second-Link-1", "password-confirm": "Second-Link-1" }) })).html
      )
      assert("the newer link sets a password", done.pageId === "info.ftl", `pageId=${done.pageId}`)
      // Before expiry the older link still opens (the accepted gap); record it.
      evidence.olderLink = { opensBeforeExpiry: page((await browse(new Jar(), first)).html).pageId === "login-update-password.ftl" }

      await sleep(Math.max(0, issued + (lifespan + 2) * 1000 - Date.now()))
      const oldJar = new Jar()
      const old = page((await browse(oldJar, first)).html)
      if (old.pageId === "login-update-password.ftl") {
        await browse(oldJar, old.loginAction, { method: "POST", body: form({ "password-new": "First-Link-1", "password-confirm": "First-Link-1" }) })
      }
      evidence.olderLink.afterExpiry = { pageId: old.pageId, message: old.message }
      assert("after its lifespan the older link does not open the form", old.pageId !== "login-update-password.ftl", `pageId=${old.pageId} message="${old.message}"`)
      assert("the newer link's password still works", (await login(u.email, "Second-Link-1")).arrivedAtApp)
    })
  } finally {
    await admin("", { method: "PUT", json: { attributes: { ...realm.attributes, [key]: saved ?? "900" } } })
  }
}

// Flooding the public paths that check passwords, create accounts or send
// mail. Needs the compose.prod.yml stack: Traefik limits these per client IP.
// EDGE_HOST names the public host (auth.localhost locally); requests go to
// EDGE_IP:443 with SNI, so no DNS is needed. EDGE_INSECURE=1 accepts
// Traefik's self-signed cert.
async function edge(path, method = "POST") {
  const https = await import("node:https")
  const host = process.env.EDGE_HOST
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        host: process.env.EDGE_IP ?? "127.0.0.1",
        port: 443,
        path,
        method,
        servername: host,
        headers: { host, "content-type": "application/x-www-form-urlencoded" },
        rejectUnauthorized: process.env.EDGE_INSECURE !== "1",
      },
      (res) => {
        res.resume()
        res.on("end", () => resolve({ status: res.statusCode, retryAfter: res.headers["retry-after"] }))
      }
    )
    req.on("error", reject)
    req.end(method === "POST" ? form({ username: "flood@example.com" }) : undefined)
  })
}

async function checkFlood() {
  if (!process.env.EDGE_HOST) {
    throw new Error("flood needs EDGE_HOST (and EDGE_INSECURE=1 locally) with compose.prod.yml running")
  }
  const groups = [
    { name: "registration", path: `/realms/${REALM}/login-actions/registration`, burst: 5 },
    { name: "reset", path: `/realms/${REALM}/login-actions/reset-credentials`, burst: 5 },
    { name: "login", path: `/realms/${REALM}/login-actions/authenticate`, burst: 10 },
  ]
  evidence.flood = {}
  for (const g of groups) {
    const sent = g.burst + 10
    const answers = []
    for (let i = 0; i < sent; i++) answers.push(await edge(g.path))
    const passed = answers.filter((a) => a.status !== 429).length
    evidence.flood[g.name] = answers.map((a) => a.status)
    assert(`${g.name}: at most ${g.burst} of ${sent} rapid posts reach Keycloak`, passed <= g.burst, `${passed} passed`)
    assert(`${g.name}: the rest get 429 with Retry-After`, answers.slice(g.burst).every((a) => a.status === 429 && a.retryAfter))
  }
  const discovery = await edge(`/realms/${REALM}/.well-known/openid-configuration`, "GET")
  assert("other public paths are not limited", discovery.status === 200)
}

async function checkEnumeration(email) {
  const unknown = `nobody-${randomBytes(4).toString("hex")}@example.com`
  const known = await requestReset(email)
  const unk = await requestReset(unknown)
  evidence.enumeration = {
    known: { pageId: known.pageId, message: known.message },
    unknown: { pageId: unk.pageId, message: unk.message },
  }
  assert("unknown email lands on the login page", unk.pageId === "login.ftl", `pageId=${unk.pageId}`)
  assert("known email lands on the login page", known.pageId === "login.ftl", `pageId=${known.pageId}`)
  assert(
    "known and unknown email get the same message",
    known.message && known.message === unk.message,
    `message="${known.message}"`
  )
  assert("unknown email gets no mail", (await mailFor(unknown, { wait: 1500 })) === null)
}

async function checkReset(email, oldPassword, newPassword) {
  const sent = await requestReset(email)
  assert("reset request accepted", sent.pageId === "login.ftl", `pageId=${sent.pageId}`)

  const mail = await mailFor(email, { wait: 15000 })
  assert("reset email arrives in Mailpit", mail, "waited up to 15s")
  const link = mail.Text.match(/https?:\/\/\S+action-token\S+/)?.[0]
  assert("email contains a reset link", link)
  evidence.mail = { subject: mail.Subject, from: mail.From?.Address, to: mail.To?.[0]?.Address }
  writeFileSync(`${EVIDENCE}/reset-mail.txt`, `Subject: ${mail.Subject}\n\n${mail.Text}`)

  const jar = new Jar()
  const opened = await browse(jar, unescapeJs(link))
  const op = page(opened.html)
  writeFileSync(`${EVIDENCE}/set-new-password.html`, opened.html)
  assert("link opens the Set new password page", op.pageId === "login-update-password.ftl", `pageId=${op.pageId}`)
  assert("page is rendered by the keycloak-theme login theme", op.themed)

  const short = await browse(jar, op.loginAction, {
    method: "POST",
    body: form({ "password-new": newPassword, "password-confirm": newPassword + "x" }),
  })
  const sp = page(short.html)
  assert("mismatched passwords are rejected", sp.pageId === "login-update-password.ftl" && !short.arrivedAtApp)

  const done = await browse(jar, sp.loginAction, {
    method: "POST",
    body: form({ "password-new": newPassword, "password-confirm": newPassword }),
  })
    const dp = page(done.html)
  writeFileSync(`${EVIDENCE}/after-submit.html`, done.html)
  assert("new password is accepted (themed confirmation page)", dp.pageId === "info.ftl" && dp.themed, `pageId=${dp.pageId}`)

  const ok = await login(email, newPassword)
  assert("new password signs in", ok.arrivedAtApp)
  const bad = await login(email, oldPassword)
  assert("old password no longer signs in", !bad.arrivedAtApp && page(bad.html).pageId === "login.ftl")

  const reused = await browse(new Jar(), unescapeJs(link))
  assert("reset link cannot be used twice", page(reused.html).pageId !== "login-update-password.ftl")
}

// Static check on the deployed theme: the served bundle must carry the
// centered card shell and none of the old split layout. Rendered geometry is
// screenshot evidence for human review, not asserted here.
async function checkLayout() {
  const p = await startLogin(new Jar())
  assert("login page is rendered by the keycloak-theme login theme", p.themed, `pageId=${p.pageId}`)
  const assetUrls = [...p.html.matchAll(/(?:src|href)="([^"]+\/login\/keycloak-theme\/[^"]+\.(?:js|css))"/g)].map(
    (m) => new URL(unescapeJs(m[1]), KC).toString()
  )
  assert("theme script and stylesheet are linked", assetUrls.some((u) => u.endsWith(".js")), `${assetUrls.length} assets`)
  let bundle = ""
  for (const url of assetUrls) bundle += await (await fetch(url)).text()
  evidence.layout = { assets: assetUrls.map((u) => new URL(u).pathname) }
  const card = ["max-w-[440px]", "rounded-2xl", "bg-card", "items-center justify-center", "authn-authz-playground"]
  const missing = card.filter((c) => !bundle.includes(c))
  assert("bundle has the centered card shell", missing.length === 0, missing.length ? `missing: ${missing.join(", ")}` : "")
  const split = ["lg:grid-cols-2", "silk-drift", "One cookie."]
  const found = split.filter((c) => bundle.includes(c))
  assert("bundle has no split layout or wave panel", found.length === 0, found.length ? `found: ${found.join(", ")}` : "")
}

const checks = {
  enumeration: checkEnumeration,
  enumdiff: checkEnumerationDiff,
  stuffing: checkStuffing,
  policy: checkPolicy,
  reset: checkReset,
  expiredlink: checkExpiredLink,
  olderlink: checkOlderLink,
  lockout: checkLockout,
  layout: checkLayout,
  flood: checkFlood,
}
const requested = process.argv.slice(2)
const unknownNames = requested.filter((n) => !(n in checks))
if (unknownNames.length) {
  console.error(`Unknown check: ${unknownNames.join(", ")}. Available: ${Object.keys(checks).join(", ")}`)
  process.exit(2)
}
// flood runs by default only when the public stack is named (EDGE_HOST).
const selected = requested.length ? requested : Object.keys(checks).filter((n) => n !== "flood" || process.env.EDGE_HOST)

mkdirSync(EVIDENCE, { recursive: true })
let userId
let failed = false
try {
  const email = `verify-${randomBytes(4).toString("hex")}@example.com`
  const oldPassword = "OldPass-1234"
  const newPassword = "NewPass-5678"
  userId = await createUser(email, oldPassword)
  await mailFor(email) // fails fast if Mailpit is unreachable
  for (const name of selected) {
    console.log(`\n== ${name}`)
    await checks[name](email, oldPassword, newPassword)
  }
} catch (err) {
  failed = true
  console.error(`\nERROR: ${err.message}`)
  if (!results.some((r) => !r.ok)) record("setup or flow error", false, err.message)
} finally {
  if (userId) await deleteUser(userId)
  writeFileSync(
    `${EVIDENCE}/run.json`,
    JSON.stringify({ runId, checks: selected, results, evidence }, null, 2)
  )
}

const passed = results.filter((r) => r.ok).length
console.log(`\n${passed}/${results.length} assertions passed. Evidence: ${EVIDENCE} (run ${runId})`)
process.exit(failed || results.some((r) => !r.ok) ? 1 : 0)
