#!/usr/bin/env node
// Usage: ./smoke [check...]   (Windows: node smoke.mjs [check...])
// Needs the whole stack: infra/docker-compose.yml (Keycloak, Redis, Mailpit),
// the API (:8182), the gateway (:8181) and the SPA dev server (:5174).
// Checks: anonymous, login, roles, csrf, logout, fixation, backchannel. No arguments runs all.
// Exits nonzero on any failure.
import net from "node:net"
import { randomBytes } from "node:crypto"

const APP = process.env.APP_URL ?? "http://localhost:5174"
const KC = process.env.KC_URL ?? "http://localhost:8080"
const REDIS_HOST = process.env.REDIS_HOST ?? "localhost"
const REDIS_PORT = Number(process.env.REDIS_PORT ?? 6379)
// The gateway's ACL user (infra/redis/start.sh); the default user is off.
const REDIS_USERNAME = process.env.REDIS_USERNAME ?? "gateway"
const REDIS_PASSWORD = process.env.REDIS_PASSWORD ?? "redis-dev-password"
const ADMIN_USER = process.env.KC_BOOTSTRAP_ADMIN_USERNAME ?? "admin"
const ADMIN_PASS = process.env.KC_BOOTSTRAP_ADMIN_PASSWORD ?? "admin"
// Set COOKIE_SECURE=true when the gateway runs with the same variable.
const COOKIE_SECURE = process.env.COOKIE_SECURE === "true"
const REALM = "playground"
// Throwaway users, created at start and deleted at the end.
const tag = randomBytes(4).toString("hex")
const USER = { username: `smoke-user-${tag}@example.com`, password: "Smoke-1234", roles: ["user"] }
const ADMIN = { username: `smoke-admin-${tag}@example.com`, password: "Smoke-1234", roles: ["user", "admin"] }

const results = []

function assert(name, condition, detail = "") {
  const ok = Boolean(condition)
  results.push({ name, ok })
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  (" + detail + ")" : ""}`)
  if (!ok) throw new Error(`Assertion failed: ${name}`)
}

function parseSetCookie(line) {
  const [pair, ...rest] = line.split(";")
  const eq = pair.indexOf("=")
  const attrs = {}
  for (const a of rest) {
    const [k, ...v] = a.trim().split("=")
    attrs[k.toLowerCase()] = v.join("=") || true
  }
  return { name: pair.slice(0, eq).trim(), value: pair.slice(eq + 1).trim(), attrs }
}

// A cookie jar for one browser. Cookies on localhost are shared across ports,
// as in a real browser, so one jar covers the SPA origin and Keycloak.
class Browser {
  cookies = new Map()
  setCookies = [] // every Set-Cookie seen, for attribute checks

  store(res, url) {
    for (const line of res.headers.getSetCookie()) {
      const c = parseSetCookie(line)
      c.origin = new URL(url).origin
      this.setCookies.push(c)
      if (c.value === "" || c.attrs["max-age"] === "0") this.cookies.delete(c.name)
      else this.cookies.set(c.name, c.value)
    }
  }

  header() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ")
  }

  async request(url, { method = "GET", body, headers = {} } = {}) {
    const res = await fetch(url, {
      method,
      body,
      redirect: "manual",
      headers: {
        cookie: this.header(),
        ...(typeof body === "string" ? { "content-type": "application/x-www-form-urlencoded" } : {}),
        ...headers,
      },
    })
    this.store(res, url)
    return res
  }

  // Follows redirects like a top-level navigation and returns the last response.
  async navigate(url, init = {}) {
    let current = url
    let next = init
    for (let hop = 0; hop < 15; hop++) {
      const res = await this.request(current, next)
      const location = res.headers.get("location")
      if (res.status >= 300 && res.status < 400 && location) {
        current = new URL(location, current).toString()
        next = {}
        continue
      }
      return { res, url: current, html: await res.text() }
    }
    throw new Error("Too many redirects")
  }

  // XHR-style call from the SPA: same origin, CSRF header echoed from the cookie.
  async xhr(path, { method = "GET", csrf = true } = {}) {
    const headers = { accept: "application/json" }
    if (csrf && this.cookies.has("XSRF-TOKEN")) headers["x-xsrf-token"] = this.cookies.get("XSRF-TOKEN")
    return this.request(`${APP}${path}`, { method, headers })
  }

  lastSetCookie(name) {
    return this.setCookies.filter((c) => c.name === name).at(-1)
  }
}

function loginAction(html) {
  const raw = html.match(/"loginAction":\s*"([^"]+)"/)?.[1]
  return raw && new URL(raw.replace(/\\\//g, "/").replace(/\\u0026/g, "&").replace(/&amp;/g, "&"), KC).toString()
}

function pageId(html) {
  return html.match(/kcContext\.pageId\s*=\s*"([^"]+)"/)?.[1] ?? null
}

// Signs in through the gateway like the SPA's Sign in button does.
async function signIn(browser, user) {
  const form = await browser.navigate(`${APP}/oauth2/authorization/gateway`)
  const preLogin = browser.cookies.get("SESSION")
  const action = loginAction(form.html)
  if (!action) throw new Error(`No Keycloak login form (page ${pageId(form.html)}, ${form.url})`)
  const done = await browser.navigate(action, {
    method: "POST",
    body: new URLSearchParams({ username: user.username, password: user.password }).toString(),
  })
  return { preLogin, session: browser.cookies.get("SESSION"), landed: done.url }
}

// Minimal RESP client: AUTH, then one command per connection, integer
// replies only.
function redis(...args) {
  const encode = (parts) => `*${parts.length}\r\n` + parts.map((a) => `$${Buffer.byteLength(a)}\r\n${a}\r\n`).join("")
  return new Promise((resolve, reject) => {
    const socket = net.connect(REDIS_PORT, REDIS_HOST)
    let reply = ""
    socket.on("error", reject)
    socket.on("data", (chunk) => {
      reply += chunk
      const lines = reply.split("\r\n")
      if (lines.length < 3) return
      socket.end()
      const [auth, result] = lines
      if (auth !== "+OK") reject(new Error(`Redis AUTH failed: ${auth}`))
      else if (result.startsWith("-")) reject(new Error(result))
      else resolve(Number(result.slice(1)))
    })
    socket.write(encode(["AUTH", REDIS_USERNAME, REDIS_PASSWORD]) + encode(args))
  })
}

const sessionInRedis = async (id) => (await redis("EXISTS", `spring:session:sessions:${id}`)) === 1

// A fresh admin token per call: master realm tokens live 60 seconds, and a
// run on a slow machine takes longer than that.
async function adminApi(path, { method = "GET", json } = {}) {
  const bearer = await adminToken()
  return fetch(`${KC}/admin/realms/${REALM}${path}`, {
    method,
    headers: { authorization: `Bearer ${bearer}`, ...(json ? { "content-type": "application/json" } : {}) },
    body: json && JSON.stringify(json),
  })
}

async function createUser(user) {
  const res = await adminApi("/users", {
    method: "POST",
    json: {
      username: user.username,
      email: user.username,
      enabled: true,
      emailVerified: true,
      attributes: { fullName: ["Smoke Test"] },
      credentials: [{ type: "password", value: user.password, temporary: false }],
    },
  })
  if (res.status !== 201) throw new Error(`Create user failed: HTTP ${res.status} ${await res.text()}`)
  user.id = res.headers.get("location").split("/").pop()
  const roles = []
  for (const name of user.roles) roles.push(await (await adminApi(`/roles/${name}`)).json())
  await adminApi(`/users/${user.id}/role-mappings/realm`, { method: "POST", json: roles })
}

async function adminToken() {
  const res = await fetch(`${KC}/realms/master/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "password", client_id: "admin-cli", username: ADMIN_USER, password: ADMIN_PASS }),
  })
  if (!res.ok) throw new Error(`Admin token failed: HTTP ${res.status}`)
  return (await res.json()).access_token
}

async function until(fn, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (await fn()) return true
    if (Date.now() >= deadline) return false
    await new Promise((r) => setTimeout(r, 250))
  }
}

const looksLikeJwt = (s) => /eyJ[\w-]+\.[\w-]+\.[\w-]+/.test(s)

async function checkAnonymous() {
  const b = new Browser()
  assert("GET /bff/me without a session is 401", (await b.xhr("/bff/me")).status === 401)
  assert("GET /bff/admin without a session is 401", (await b.xhr("/bff/admin")).status === 401)
  const csrf = await b.xhr("/bff/csrf")
  assert("GET /bff/csrf is 200 and sets XSRF-TOKEN", csrf.status === 200 && b.cookies.has("XSRF-TOKEN"))
  const xsrf = b.lastSetCookie("XSRF-TOKEN")
  assert("XSRF-TOKEN is readable by JS (no HttpOnly)", !xsrf.attrs.httponly)
  assert("XSRF-TOKEN has SameSite=Lax", String(xsrf.attrs.samesite).toLowerCase() === "lax", `SameSite=${xsrf.attrs.samesite}`)
  assert(`XSRF-TOKEN Secure flag is ${COOKIE_SECURE}`, Boolean(xsrf.attrs.secure) === COOKIE_SECURE)
  const planted = new Browser()
  planted.cookies.set("SESSION", randomBytes(16).toString("hex"))
  assert("a made-up SESSION id is rejected with 401", (await planted.xhr("/bff/me")).status === 401)
}

async function checkLogin() {
  const b = new Browser()
  const { session, landed } = await signIn(b, USER)
  assert("login lands back on the SPA", landed === `${APP}/`, landed)
  assert("login sets a SESSION cookie", session)
  const cookie = b.lastSetCookie("SESSION")
  assert("SESSION is HttpOnly", cookie.attrs.httponly)
  assert("SESSION has SameSite=Lax", String(cookie.attrs.samesite).toLowerCase() === "lax", `SameSite=${cookie.attrs.samesite}`)
  assert("SESSION has Path=/", cookie.attrs.path === "/")
  assert(`SESSION Secure flag is ${COOKIE_SECURE}`, Boolean(cookie.attrs.secure) === COOKIE_SECURE)
  assert("session lives in Redis", await sessionInRedis(session))

  const me = await b.xhr("/bff/me")
  const body = await me.text()
  assert("GET /bff/me returns 200 with the cookie alone", me.status === 200, body)
  assert("profile is the signed-in user's", JSON.parse(body).preferredUsername === USER.username)
  // Keycloak's own cookies (path /realms/...) are not the app's concern.
  const appCookies = b.setCookies.filter((c) => c.origin === new URL(APP).origin).map((c) => c.value)
  const leaked = [...appCookies, body].filter(looksLikeJwt)
  assert("no token reaches the browser (app cookies and body)", leaked.length === 0, `${appCookies.length} app cookies`)
}

async function checkRoles() {
  const user = new Browser()
  await signIn(user, USER)
  assert("user can call /bff/me", (await user.xhr("/bff/me")).status === 200)
  assert("user gets 403 on /bff/admin", (await user.xhr("/bff/admin")).status === 403)
  const admin = new Browser()
  await signIn(admin, ADMIN)
  assert("admin gets 200 on /bff/admin", (await admin.xhr("/bff/admin")).status === 200)
}

async function checkCsrf() {
  const b = new Browser()
  await signIn(b, USER)
  await b.xhr("/bff/csrf")
  assert("POST /logout without the CSRF header is 403", (await b.xhr("/logout", { method: "POST", csrf: false })).status === 403)
  assert("the session survives the rejected POST", (await b.xhr("/bff/me")).status === 200)
}

async function checkLogout() {
  const b = new Browser()
  const { session } = await signIn(b, USER)
  await b.xhr("/bff/csrf")
  const res = await b.xhr("/logout", { method: "POST" })
  const { logoutUrl } = await res.json()
  assert("POST /logout is 200 with a Keycloak logoutUrl", res.status === 200 && logoutUrl?.startsWith(`${KC}/realms/${REALM}/`))
  assert("logout expires the SESSION cookie", !b.cookies.has("SESSION"))
  assert("logout deletes the session from Redis", !(await sessionInRedis(session)))
  assert("logout removes the OIDC session registry entry", (await redis("EXISTS", `playground:oidc:session:${session}`)) === 0)
  const stale = new Browser()
  stale.cookies.set("SESSION", session)
  assert("the old SESSION id is rejected with 401", (await stale.xhr("/bff/me")).status === 401)

  const back = await b.navigate(logoutUrl)
  assert("Keycloak end_session redirects back to the SPA", back.url === `${APP}/`, back.url)
  const again = await b.navigate(`${APP}/oauth2/authorization/gateway`)
  assert("signing in again shows the login form (SSO session ended)", pageId(again.html) === "login.ftl", pageId(again.html))
}

async function checkFixation() {
  // An attacker plants a session id in the victim's browser before login.
  const b = new Browser()
  const { preLogin, session } = await signIn(b, USER)
  assert("a session exists before login (it holds the authorization request)", preLogin)
  assert("login issues a new session id", session && session !== preLogin)
  assert("the pre-login session id is gone from Redis", !(await sessionInRedis(preLogin)))
  const attacker = new Browser()
  attacker.cookies.set("SESSION", preLogin)
  assert("the pre-login session id does not grant access", (await attacker.xhr("/bff/me")).status === 401)

  // Same-user requests (including token refresh saves) keep the id stable.
  await b.xhr("/bff/me")
  await b.xhr("/bff/me")
  assert("authenticated requests keep the same session id", b.cookies.get("SESSION") === session)
}

async function checkBackchannel() {
  const b = new Browser()
  const { session } = await signIn(b, USER)
  assert("signed in before the Keycloak-side logout", (await b.xhr("/bff/me")).status === 200)
  // The Keycloak-to-gateway session map is in Redis, so it survives a gateway restart.
  assert("the OIDC session registry entry is in Redis", (await redis("EXISTS", `playground:oidc:session:${session}`)) === 1)

  // Ending the SSO session at Keycloak (admin console, another app, account
  // console) must kill the gateway session through the back-channel.
  const out = await adminApi(`/users/${USER.id}/logout`, { method: "POST" })
  assert("Keycloak admin logout of the user is accepted", out.status === 204, `HTTP ${out.status}`)

  const gone = await until(async () => !(await sessionInRedis(session)), 10000)
  assert("back-channel logout deletes the session from Redis", gone, "waited up to 10s")
  assert("the browser's SESSION cookie no longer works", (await b.xhr("/bff/me")).status === 401)
  assert("the registry entry is removed too", (await redis("EXISTS", `playground:oidc:session:${session}`)) === 0)
}

const checks = {
  anonymous: checkAnonymous,
  login: checkLogin,
  roles: checkRoles,
  csrf: checkCsrf,
  logout: checkLogout,
  fixation: checkFixation,
  backchannel: checkBackchannel,
}
const requested = process.argv.slice(2)
const unknownNames = requested.filter((n) => !(n in checks))
if (unknownNames.length) {
  console.error(`Unknown check: ${unknownNames.join(", ")}. Available: ${Object.keys(checks).join(", ")}`)
  process.exit(2)
}

let failed = false
try {
  await createUser(USER)
  await createUser(ADMIN)
  // A failing check is reported and the rest still run.
  for (const name of requested.length ? requested : Object.keys(checks)) {
    console.log(`\n== ${name}`)
    const before = results.length
    try {
      await checks[name]()
    } catch (err) {
      failed = true
      if (results.slice(before).every((r) => r.ok)) console.log(`FAIL  ${name}: ${err.message}`)
    }
  }
} catch (err) {
  failed = true
  console.log(`FAIL  setup: ${err.message}`)
} finally {
  for (const user of [USER, ADMIN]) if (user.id) await adminApi(`/users/${user.id}`, { method: "DELETE" })
}

const passed = results.filter((r) => r.ok).length
console.log(`\n${passed}/${results.length} assertions passed${failed ? ", with failures" : ""}.`)
process.exit(failed ? 1 : 0)
