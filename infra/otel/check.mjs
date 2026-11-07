#!/usr/bin/env node
// Usage: node infra/otel/check.mjs
// Needs the dev stack with lgtm, both bootRuns and the SPA dev server (README).
// Signs in as alice, calls /bff/me, then asks Grafana's data sources for the
// result: one trace through gateway and API, JVM and HTTP metrics, logs, and
// no token, cookie or session id in anything stored in the last hour.
// Exits nonzero on any failure.
import { randomBytes } from "node:crypto"
import { readdirSync, readFileSync } from "node:fs"

const APP = process.env.APP_URL ?? "http://localhost:5174"
const GRAFANA = process.env.GRAFANA_URL ?? "http://127.0.0.1:3300"
const LOG_DIR = new URL("../../build/dev-logs/", import.meta.url)
const SERVICES = ["gateway", "api"]
// Sent on the /bff/me call, so the check looks up that request and no older one.
const TRACE_ID = randomBytes(16).toString("hex")

let failed = 0
function check(name, ok, detail = "") {
  if (!ok) failed++
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`)
}

// Signs in the way the SPA's button does. Returns the cookies the browser holds.
async function signIn() {
  const jar = new Map()
  async function go(url, init = {}) {
    for (let hop = 0, current = url; hop < 15; hop++) {
      const res = await fetch(current, {
        ...init,
        redirect: "manual",
        headers: { ...init.headers, cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") },
      })
      for (const line of res.headers.getSetCookie()) {
        const [pair] = line.split(";")
        const eq = pair.indexOf("=")
        jar.set(pair.slice(0, eq), pair.slice(eq + 1))
      }
      const location = res.headers.get("location")
      if (res.status < 300 || res.status >= 400 || !location) return { res, html: await res.text() }
      current = new URL(location, current).toString()
      init = {}
    }
    throw new Error("Too many redirects")
  }
  const form = await go(`${APP}/oauth2/authorization/gateway`)
  const action = form.html.match(/"loginAction":\s*"([^"]+)"/)?.[1]
  if (!action) throw new Error("No Keycloak login form. Is the stack up?")
  await go(action.replace(/\\\//g, "/").replace(/\\u0026/g, "&").replace(/&amp;/g, "&"), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username: "alice@example.com", password: "alice1234" }).toString(),
  })
  const me = await go(`${APP}/bff/me`, {
    headers: { accept: "application/json", traceparent: `00-${TRACE_ID}-${randomBytes(8).toString("hex")}-01` },
  })
  return { status: me.res.status, session: jar.get("SESSION"), xsrf: jar.get("XSRF-TOKEN") }
}

async function ds(uid, path) {
  const res = await fetch(`${GRAFANA}/api/datasources/proxy/uid/${uid}${path}`)
  if (!res.ok) throw new Error(`${uid} ${path}: ${res.status} ${await res.text()}`)
  return res.json()
}

const until = async (fn, ms = 60_000) => {
  for (const end = Date.now() + ms; ; await new Promise((r) => setTimeout(r, 2000))) {
    const value = await fn()
    if (value || Date.now() > end) return value
  }
}

const { status, session, xsrf } = await signIn()
check("alice signs in and /bff/me answers through the gateway", status === 200 && session, `HTTP ${status}`)

const end = () => Math.floor(Date.now() / 1000) + 60
const start = Math.floor(Date.now() / 1000) - 3600

async function traces() {
  const q = encodeURIComponent('{resource.service.name="gateway"}')
  const found = await ds("tempo", `/api/search?q=${q}&limit=500&start=${start}&end=${end()}`)
  return Promise.all((found.traces ?? []).map((t) => ds("tempo", `/api/traces/${t.traceID}`)))
}

const spansOf = (trace, service) =>
  (trace.batches ?? [])
    .filter((b) => b.resource.attributes.some((a) => a.key === "service.name" && a.value.stringValue === service))
    .flatMap((b) => b.scopeSpans.flatMap((s) => s.spans))

// The API's server span must be the child of the gateway's client span.
const isOneTrace = (trace) => {
  const gatewayIds = new Set(spansOf(trace, "gateway").map((s) => s.spanId))
  return spansOf(trace, "api").some((s) => s.name === "http get /api/me" && gatewayIds.has(s.parentSpanId))
}

const oneTrace = await until(async () => {
  const res = await fetch(`${GRAFANA}/api/datasources/proxy/uid/tempo/api/traces/${TRACE_ID}`)
  return res.ok && isOneTrace(await res.json())
})
check("this /bff/me request is one trace, the API span a child of the gateway's", oneTrace, TRACE_ID)
// Search lags the lookup by id on a fresh Tempo. Wait for this trace, so the
// scan below cannot pass on nothing.
const stored = await until(async () => {
  const list = await traces()
  return list.some(isOneTrace) && list
}, 120_000)
check("Tempo's search returns stored traces to scan", Boolean(stored), `${stored ? stored.length : 0} traces`)
const resource = (stored || []).flatMap((t) => t.batches ?? []).map((b) => b.resource.attributes)
for (const service of SERVICES) {
  check(
    `spans of ${service} carry deployment.environment=dev`,
    resource.some(
      (r) =>
        r.some((a) => a.key === "service.name" && a.value.stringValue === service) &&
        r.some((a) => a.key === "deployment.environment" && a.value.stringValue === "dev"),
    ),
  )
}

const metric = (e) =>
  until(async () => {
    const { data } = await ds("prometheus", `/api/v1/query?query=${encodeURIComponent(e)}`)
    const names = data.result.map((r) => r.metric.service_name)
    return SERVICES.every((s) => names.includes(s)) && names
  })
for (const [what, name] of [
  ["JVM", "jvm_memory_used_bytes"],
  ["HTTP", "http_server_requests_milliseconds_count"],
]) {
  check(`${what} metrics for both services`, await metric(`count by (service_name) (${name}{deployment_environment="dev"})`))
}

const loki = async (e) => {
  const q = encodeURIComponent(e)
  const { data } = await ds("loki", `/loki/api/v1/query_range?query=${q}&limit=5000&start=${start}000000000&end=${end()}000000000`)
  return data.result
}
for (const service of SERVICES) {
  const streams = await until(async () => {
    const r = await loki(`{service_name="${service}",deployment_environment="dev"}`)
    return r.length && r
  })
  check(`logs of ${service} in Loki`, streams, `${streams ? streams.reduce((n, s) => n + s.values.length, 0) : 0} lines`)
}

// Names that are not secrets, so the patterns do not trip on them: the span
// "authenticate bearertoken", types like BearerTokenAuthenticationToken.
const SECRETS = [
  [/Bearer\s+[A-Za-z0-9._~+/-]{8,}/, "a bearer header"],
  [/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/, "a JWT"],
  [/\b(?:SESSION|XSRF-TOKEN|JSESSIONID)=[^\s"]/, "a cookie"],
  [/(?:access_token|refresh_token|id_token|client_secret)["=:]/, "an OAuth field"],
  [/[?&](?:code|state|session_state)=/, "an OAuth query value"],
  [/spring:session:sessions:/, "a Redis session key"],
  [/alice1234|gateway-dev-secret|redis-dev-password/, "a dev password"],
]
// The session id in Redis is the cookie value, base64 decoded.
const literal = (value) => ({ test: (text) => Boolean(value) && text.includes(value) })
SECRETS.push([literal(session), "this session's cookie"])
SECRETS.push([literal(session && Buffer.from(session, "base64").toString()), "this session's id"])
SECRETS.push([literal(xsrf), "this session's CSRF token"])

const leaks = (text) => SECRETS.filter(([pattern]) => pattern.test(text)).map(([, what]) => what)
const files = readdirSync(LOG_DIR).filter((f) => f.endsWith(".log"))
const scanned = {
  "stored traces": JSON.stringify(stored),
  "Loki": JSON.stringify(await loki(`{service_name=~".+"}`)),
  "the raw log files": files.map((f) => readFileSync(new URL(f, LOG_DIR), "utf8")).join("\n"),
}
for (const [where, text] of Object.entries(scanned)) {
  const found = leaks(text)
  check(`no secrets in ${where}`, found.length === 0, found.join(", ") || `${text.length} characters`)
}

console.log(failed ? `\n${failed} failed.` : "\nAll passed.")
process.exit(failed ? 1 : 0)
