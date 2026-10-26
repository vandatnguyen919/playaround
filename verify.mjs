#!/usr/bin/env node
// Usage: ./verify [check...]   (Windows: node verify [check...])
// Needs Keycloak (:8080, theme jar built) and Mailpit (:8025) from infra/docker-compose.yml.
// Checks: enumeration, reset. No arguments runs all.
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
  const message = html.match(/"message":\s*\{[^}]*?"summary":\s*"((?:[^"\\]|\\.)*)"/)?.[1]
  const themed = /\/resources\/[^"']+\/login\/keycloak-theme\//.test(html)
  return {
    pageId,
    themed,
    loginAction: loginAction && new URL(unescapeJs(loginAction), KC).toString(),
    resetUrl: resetUrl && new URL(unescapeJs(resetUrl), KC).toString(),
    message: message && unescapeJs(message),
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

async function createUser(token, email, password) {
  const res = await fetch(`${KC}/admin/realms/${REALM}/users`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      username: email,
      email,
      enabled: true,
      emailVerified: true,
      attributes: { fullName: ["Verify Person"] },
      credentials: [{ type: "password", value: password, temporary: false }],
    }),
  })
  if (res.status !== 201) throw new Error(`Create user failed: HTTP ${res.status} ${await res.text()}`)
  return res.headers.get("location").split("/").pop()
}

async function deleteUser(token, id) {
  await fetch(`${KC}/admin/realms/${REALM}/users/${id}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${token}` },
  })
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

const checks = { enumeration: checkEnumeration, reset: checkReset }
const requested = process.argv.slice(2)
const unknownNames = requested.filter((n) => !(n in checks))
if (unknownNames.length) {
  console.error(`Unknown check: ${unknownNames.join(", ")}. Available: ${Object.keys(checks).join(", ")}`)
  process.exit(2)
}
const selected = requested.length ? requested : Object.keys(checks)

mkdirSync(EVIDENCE, { recursive: true })
let token
let userId
let failed = false
try {
  token = await adminToken()
  const email = `verify-${randomBytes(4).toString("hex")}@example.com`
  const oldPassword = "OldPass-1234"
  const newPassword = "NewPass-5678"
  userId = await createUser(token, email, oldPassword)
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
  if (token && userId) await deleteUser(token, userId)
  writeFileSync(
    `${EVIDENCE}/run.json`,
    JSON.stringify({ runId, checks: selected, results, evidence }, null, 2)
  )
}

const passed = results.filter((r) => r.ok).length
console.log(`\n${passed}/${results.length} assertions passed. Evidence: ${EVIDENCE} (run ${runId})`)
process.exit(failed || results.some((r) => !r.ok) ? 1 : 0)
