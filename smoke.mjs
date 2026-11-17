#!/usr/bin/env node
// Usage: ./smoke [check...]   (Windows: node smoke.mjs [check...])
// Needs the whole stack: infra/docker-compose.yml (Keycloak, Redis, Mailpit),
// the API (:8182), keylab-api (:8183), the gateway (:8181) and the SPA dev server (:5174).
// Checks: anonymous, login, roles, csrf, logout, fixation, backchannel, refresh, keylab.
// No arguments runs all of those. Only when named: restored (the restore drill) and
// keylab-write (adds, uploads, publishes and pulls a switch; needs keylab-api).
// Exits nonzero on any failure.
// Against the deployed stack use deploy/compose/smoke-public.mjs, which sets the
// SMOKE_* variables below.
import { execFile } from "node:child_process"
import net from "node:net"
import { randomBytes } from "node:crypto"

const APP = process.env.APP_URL ?? "http://localhost:5174"
const KC = process.env.KC_URL ?? "http://localhost:8080"
// Keycloak as the browser sees it. Same as KC_URL in dev; in compose.prod.yml
// KC_URL is the admin tunnel and this is https://AUTH_HOST.
const KC_PUBLIC = process.env.KC_PUBLIC_URL ?? KC
const REDIS_HOST = process.env.REDIS_HOST ?? "localhost"
const REDIS_PORT = Number(process.env.REDIS_PORT ?? 6379)
// The gateway's ACL user (infra/redis/start.sh); the default user is off.
const REDIS_USERNAME = process.env.REDIS_USERNAME ?? "gateway"
const REDIS_PASSWORD = process.env.REDIS_PASSWORD ?? "redis-dev-password"
const ADMIN_USER = process.env.KC_BOOTSTRAP_ADMIN_USERNAME ?? "admin"
const ADMIN_PASS = process.env.KC_BOOTSTRAP_ADMIN_PASSWORD ?? "admin"
// A service account client in the realm, used instead of the master admin.
const ADMIN_CLIENT_ID = process.env.SMOKE_ADMIN_CLIENT_ID
const ADMIN_CLIENT_SECRET = process.env.SMOKE_ADMIN_CLIENT_SECRET
// JSON argv that answers EXISTS <key>, for a Redis that has no reachable port.
const REDIS_EXEC = process.env.SMOKE_REDIS_EXEC && JSON.parse(process.env.SMOKE_REDIS_EXEC)
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
  return raw && new URL(raw.replace(/\\\//g, "/").replace(/\\u0026/g, "&").replace(/&amp;/g, "&"), KC_PUBLIC).toString()
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
  if (REDIS_EXEC) {
    return new Promise((resolve, reject) => {
      execFile(REDIS_EXEC[0], [...REDIS_EXEC.slice(1), args[1]], (err, stdout) => {
        if (err) reject(err)
        else resolve(Number(stdout.trim()))
      })
    })
  }
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
  const res = await fetch(`${KC}/realms/${ADMIN_CLIENT_ID ? REALM : "master"}/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(
      ADMIN_CLIENT_ID
        ? { grant_type: "client_credentials", client_id: ADMIN_CLIENT_ID, client_secret: ADMIN_CLIENT_SECRET }
        : { grant_type: "password", client_id: "admin-cli", username: ADMIN_USER, password: ADMIN_PASS },
    ),
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
  assert("POST /logout is 200 with a Keycloak logoutUrl", res.status === 200 && logoutUrl?.startsWith(`${KC_PUBLIC}/realms/${REALM}/`), logoutUrl)
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

// Parallel token refreshes. The gateway refreshes an access token within 60 s
// of expiry (Spring's default clock skew), so with a 75 s lifespan the token is
// due 15 s after it was issued and every request in a burst tries to refresh.
// Two rounds: the second refreshes with whatever refresh token the first left
// in the session, which is where refresh token rotation would break.
async function checkRefresh() {
  const realm = await (await adminApi("")).json()
  const saved = realm.accessTokenLifespan
  const rotation = realm.revokeRefreshToken ? `rotation on, max reuse ${realm.refreshTokenMaxReuse}` : "rotation off"
  await adminApi("", { method: "PUT", json: { accessTokenLifespan: 75 } })
  try {
    const b = new Browser()
    const { session } = await signIn(b, USER)
    for (const round of [1, 2]) {
      await new Promise((r) => setTimeout(r, 17000))
      const burst = await Promise.all(Array.from({ length: 8 }, () => b.xhr("/bff/me").then((r) => r.status)))
      assert(`round ${round}: 8 parallel calls due a refresh all get 200 (${rotation})`, burst.every((s) => s === 200), burst.join(","))
      assert(`round ${round}: the next call still gets 200`, (await b.xhr("/bff/me")).status === 200)
    }
    assert("the session id did not change", b.cookies.get("SESSION") === session)
  } finally {
    await adminApi("", { method: "PUT", json: { accessTokenLifespan: saved } })
  }
}

// Restore drill (deploy/compose/RESTORE.md). The other checks make their own
// users, so they would pass on an empty database. This one proves the data came
// back: a user made before the dump signs in with its old password, and a user
// made after it does not exist.
async function checkRestored() {
  const before = process.env.DRILL_BEFORE_USER
  const after = process.env.DRILL_AFTER_USER
  if (!before || !after) throw new Error("Set DRILL_BEFORE_USER, DRILL_BEFORE_PASSWORD and DRILL_AFTER_USER")
  const b = new Browser()
  await signIn(b, { username: before, password: process.env.DRILL_BEFORE_PASSWORD })
  const me = await b.xhr("/bff/me")
  assert("a user from before the dump signs in with its old password", me.status === 200, `HTTP ${me.status}`)
  assert("the profile is that user's", (await me.json()).preferredUsername === before)
  const found = await (await adminApi(`/users?exact=true&username=${encodeURIComponent(after)}`)).json()
  assert("a user from after the dump does not exist", found.length === 0, `${found.length} found`)
}

// ---- KeyLab (keylab-api behind the gateway's /bff/keylab/v1/**)

const KEYLAB = "/bff/keylab/v1"

// Read only and anonymous, so it signs in nowhere and creates nothing: safe in every
// deploy's smoke. An empty library is fine (a fresh install has no switches yet).
// SMOKE_KEYLAB=off skips it: smoke-public.mjs sets that when the running release has no
// keylab-api, as after a rollback to one from before KeyLab.
async function checkKeylab() {
  if (process.env.SMOKE_KEYLAB === "off") {
    console.log("SKIP  KeyLab: the running release has no keylab-api")
    return
  }
  const b = new Browser()
  const health = await b.xhr(`${KEYLAB}/health`, { csrf: false })
  assert("KeyLab health answers through the gateway", health.status === 200, `HTTP ${health.status}`)
  const library = await b.xhr(`${KEYLAB}/switches`, { csrf: false })
  const text = await library.text()
  assert("the switch library is 200 JSON from keylab-api, not the fallback", library.status === 200 && library.headers.get("keylab-api-revision"), `HTTP ${library.status} ${text.slice(0, 120)}`)
  let data
  try {
    data = JSON.parse(text).data
  } catch {
    data = undefined
  }
  assert("the library lists switches as data[]", Array.isArray(data), text.slice(0, 120))
  if (data.length > 0) {
    const page = await b.xhr(`${KEYLAB}/switches/${encodeURIComponent(data[0].slug)}`, { csrf: false })
    assert(`the page of ${data[0].slug} loads`, page.status === 200 && (await page.json()).slug === data[0].slug, `HTTP ${page.status}`)
  } else {
    console.log("SKIP  a switch page: the library is empty")
  }
  const spa = await b.request(`${APP}/keylab/switches`, { headers: { accept: "text/html" } })
  assert("the SPA serves /keylab/switches", spa.status === 200 && (spa.headers.get("content-type") ?? "").includes("text/html"), `HTTP ${spa.status}`)
}

/** A mono 48 kHz 24-bit WAV: 100 ms of silence, then a decaying 1 kHz click (keylab-sounds.spec.ts). */
function wav(rate = 48_000, bits = 24, seconds = 0.2, peak = 0.5) {
  const frames = Math.round(rate * seconds)
  const bytes = bits / 8
  const data = Buffer.alloc(frames * bytes)
  const full = 2 ** (bits - 1) - 1
  for (let i = 0; i < frames; i++) {
    const t = (i - rate / 10) / rate
    const v = t < 0 ? 0 : peak * Math.exp(-t * 40) * Math.sin(2 * Math.PI * 1000 * t)
    data.writeIntLE(Math.max(-full, Math.min(full, Math.round(v * full))), i * bytes, bytes)
  }
  const head = Buffer.alloc(44)
  head.write("RIFF", 0)
  head.writeUInt32LE(36 + data.length, 4)
  head.write("WAVEfmt ", 8)
  head.writeUInt32LE(16, 16)
  head.writeUInt16LE(1, 20)
  head.writeUInt16LE(1, 22)
  head.writeUInt32LE(rate, 24)
  head.writeUInt32LE(rate * bytes, 28)
  head.writeUInt16LE(bytes, 32)
  head.writeUInt16LE(bits, 34)
  head.write("data", 36)
  head.writeUInt32LE(data.length, 40)
  return Buffer.concat([head, data])
}

// A signed-in SPA call with a JSON body, the XSRF header and an Idempotency-Key.
async function keylabJson(b, path, { method = "POST", json } = {}) {
  const res = await b.request(`${APP}${KEYLAB}${path}`, {
    method,
    body: json === undefined ? undefined : JSON.stringify(json),
    headers: {
      accept: "application/json",
      ...(json === undefined ? {} : { "content-type": "application/json" }),
      "x-xsrf-token": b.cookies.get("XSRF-TOKEN") ?? "",
      ...(method === "POST" ? { "idempotency-key": crypto.randomUUID() } : {}),
    },
  })
  const text = await res.text()
  let body = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }
  return { status: res.status, body, text }
}

// Opt-in, like restored: it writes. An editor adds a switch, uploads both stock strokes,
// publishes it, sees it in the public library and hears its file, then pulls it again.
// Published switches cannot be deleted, so each run leaves one pulled "Smoke" switch.
async function checkKeylabWrite() {
  const editor = { username: `smoke-editor-${tag}@example.com`, password: "Smoke-1234", roles: ["user", "keylab-editor"] }
  const b = new Browser()
  let switchId = null
  let published = false
  try {
    await createUser(editor)
    await signIn(b, editor)
    await b.xhr("/bff/csrf")
    const name = `Smoke ${tag}`
    const created = await keylabJson(b, "/admin/switches", {
      json: {
        name,
        brand: "Smoke Test",
        type: "tactile",
        profile: "poppy",
        stemColor: "#F16B53",
        forceG: 62,
        actuationMm: 2.0,
        travelMm: 3.8,
        housing: "milky",
        forceCurve: [
          { travelMm: 0, forceG: 0 },
          { travelMm: 0.4, forceG: 38 },
          { travelMm: 2.0, forceG: 62 },
          { travelMm: 3.8, forceG: 92 },
        ],
      },
    })
    assert("a keylab-editor adds a switch (ADM-02)", created.status === 201 && created.body?.id, `HTTP ${created.status} ${created.text.slice(0, 200)}`)
    switchId = created.body.id
    const slug = created.body.slug

    const file = wav()
    for (const stroke of ["press", "release"]) {
      const ticket = await keylabJson(b, "/admin/uploads", {
        json: { purpose: "sound", contentType: "audio/wav", bytes: file.length, fileName: `smoke-${stroke}.wav` },
      })
      assert(`an upload ticket for the ${stroke} WAV (ADM-04)`, ticket.status === 201 && ticket.body?.url, `HTTP ${ticket.status} ${ticket.text.slice(0, 200)}`)
      const put = await b.request(new URL(ticket.body.url, APP).href, {
        method: "PUT",
        body: file,
        headers: { ...(ticket.body.headers ?? {}), "x-xsrf-token": b.cookies.get("XSRF-TOKEN") ?? "" },
      })
      assert(`the ${stroke} WAV goes up to the signed URL`, put.status >= 200 && put.status < 300, `HTTP ${put.status}`)
      const attached = await keylabJson(b, `/admin/switches/${switchId}/sounds`, { json: { uploadId: ticket.body.uploadId, variant: "stock", stroke } })
      assert(`the ${stroke} take is attached (202)`, attached.status === 202 && attached.body?.id, `HTTP ${attached.status} ${attached.text.slice(0, 200)}`)
      let sound = attached.body
      await until(async () => {
        sound = (await keylabJson(b, `/admin/sounds/${sound.id}`, { method: "GET" })).body
        return sound?.status !== "processing"
      }, 60_000)
      assert(`the ${stroke} take is processed and ready`, sound?.status === "ready", `${sound?.status} ${sound?.error ?? ""}`)
    }

    // Catalog hears of ready takes through an event, a moment after sound marks them.
    let soundStatus
    await until(async () => {
      soundStatus = (await keylabJson(b, `/admin/switches/${switchId}`, { method: "GET" })).body?.soundStatus
      return soundStatus === "recorded"
    }, 30_000)
    assert("catalog sees both stock takes (soundStatus recorded)", soundStatus === "recorded", soundStatus)

    const publish = await keylabJson(b, `/admin/switches/${switchId}/publication`, { json: { markNew: false } })
    published = publish.status === 200
    assert("it publishes (ADM-03)", published && publish.body?.status === "published", `HTTP ${publish.status} ${publish.text.slice(0, 200)}`)

    const anyone = new Browser()
    const search = await anyone.xhr(`${KEYLAB}/switches?q=${encodeURIComponent(name)}`, { csrf: false })
    const found = search.status === 200 ? (await search.json()).data.some((s) => s.slug === slug) : false
    assert("it shows in the public library, signed out", found, `HTTP ${search.status}`)
    const page = await anyone.xhr(`${KEYLAB}/switches/${slug}`, { csrf: false })
    assert("its public page loads", page.status === 200, `HTTP ${page.status}`)
    const sounds = await anyone.xhr(`${KEYLAB}/switches/${slug}/sounds`, { csrf: false })
    const recordings = sounds.status === 200 ? (await sounds.json()).data : []
    const press = recordings.find((r) => r.stroke === "press" && r.variant === "stock")
    assert("its stock press is listed (CAT-03)", press?.url, `HTTP ${sounds.status}, ${recordings.length} recordings`)
    const audio = await anyone.request(new URL(press.url, APP).href)
    const bytes = Buffer.from(await audio.arrayBuffer())
    assert(
      "the recording plays from the app's own origin",
      audio.status === 200 && new URL(press.url, APP).origin === new URL(APP).origin && bytes.subarray(0, 4).toString() === "RIFF",
      `HTTP ${audio.status} ${audio.headers.get("content-type")} ${press.url}`,
    )
  } finally {
    if (published) {
      const pulled = await keylabJson(b, `/admin/switches/${switchId}/publication`, { method: "DELETE" })
      console.log(`${pulled.status < 300 ? "INFO" : "WARN"}  pulled the smoke switch from the library (HTTP ${pulled.status})`)
    } else if (switchId) {
      // A draft can still be deleted.
      const etag = (await b.request(`${APP}${KEYLAB}/admin/switches/${switchId}`, { headers: { accept: "application/json" } })).headers.get("etag")
      await b.request(`${APP}${KEYLAB}/admin/switches/${switchId}`, { method: "DELETE", headers: { "if-match": etag ?? "*", "x-xsrf-token": b.cookies.get("XSRF-TOKEN") ?? "" } })
    }
    if (editor.id) await adminApi(`/users/${editor.id}`, { method: "DELETE" })
  }
}

const checks = {
  anonymous: checkAnonymous,
  login: checkLogin,
  roles: checkRoles,
  csrf: checkCsrf,
  logout: checkLogout,
  fixation: checkFixation,
  backchannel: checkBackchannel,
  refresh: checkRefresh,
  restored: checkRestored,
  keylab: checkKeylab,
  "keylab-write": checkKeylabWrite,
}
// Run only when asked for: restored needs the drill's markers, keylab-write leaves a
// pulled switch behind.
const defaults = Object.keys(checks).filter((n) => n !== "restored" && n !== "keylab-write")
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
  for (const name of requested.length ? requested : defaults) {
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
