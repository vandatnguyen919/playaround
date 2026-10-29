#!/usr/bin/env node
// Checks what the gateway sends and exposes: security headers on the SPA
// page, HSTS on https, CORS refusal for other origins, and the actuator only
// on the management port with health and info.
// Usage: node check-headers.mjs [app-url] [management-url]
//   app-url         default http://localhost:8181 (the gateway itself, not Vite)
//   management-url  default http://localhost:9181
// On plain http the HSTS check sends X-Forwarded-Proto: https, which only
// works when the gateway runs with FORWARD_HEADERS_STRATEGY=native (as behind
// Traefik); otherwise that check is skipped. Exits nonzero on any failure.
const APP = (process.argv[2] ?? "http://localhost:8181").replace(/\/$/, "")
const MANAGEMENT = (process.argv[3] ?? "http://localhost:9181").replace(/\/$/, "")
const EXPECTED_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self'",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ")

let failures = 0
function check(name, ok, detail = "") {
  if (!ok) failures++
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  (" + detail + ")" : ""}`)
}

const get = (url, headers = {}, method = "GET") => fetch(url, { method, headers, redirect: "manual" })

// The SPA page: every header the browser enforces.
const page = await get(`${APP}/me`, { accept: "text/html" })
const h = page.headers
console.log(`GET ${APP}/me -> ${page.status}`)
for (const name of ["content-security-policy", "x-content-type-options", "x-frame-options", "referrer-policy",
  "strict-transport-security", "cache-control"]) {
  console.log(`  ${name}: ${h.get(name) ?? "(none)"}`)
}
check("SPA page is served by the gateway", page.status === 200 && (await page.text()).includes('<div id="root">'))
check("Content-Security-Policy", h.get("content-security-policy") === EXPECTED_CSP)
check("X-Content-Type-Options: nosniff", h.get("x-content-type-options") === "nosniff")
check("X-Frame-Options: DENY", h.get("x-frame-options") === "DENY")
check("Referrer-Policy: same-origin", h.get("referrer-policy") === "same-origin")

// HSTS: only on https, as browsers require.
if (APP.startsWith("https:")) {
  check("HSTS on https", /max-age=31536000.*includeSubDomains/.test(h.get("strict-transport-security") ?? ""))
} else {
  check("no HSTS on plain http", !h.has("strict-transport-security"))
  const viaProxy = await get(`${APP}/`, { "x-forwarded-proto": "https" })
  const hsts = viaProxy.headers.get("strict-transport-security")
  if (hsts) check("HSTS when the proxy says https", /max-age=31536000.*includeSubDomains/.test(hsts), hsts)
  else console.log("SKIP  HSTS via X-Forwarded-Proto (gateway not started with FORWARD_HEADERS_STRATEGY=native)")
}

// The SPA's own assets load under the CSP: same origin, real JS and CSS types.
const html = await (await get(`${APP}/`)).text()
for (const src of html.match(/\/assets\/[^"]+/g) ?? []) {
  const asset = await get(`${APP}${src}`)
  const type = asset.headers.get("content-type") ?? ""
  check(`asset ${src}`, asset.status === 200 && /javascript|css/.test(type), type)
}
check("SPA page has no inline script or style", !/<script(?![^>]*\bsrc=)[^>]*>|<style|\sstyle=/i.test(html))

// CORS: other origins are refused, preflight or not; the app origin passes.
const evil = "https://evil.example"
const preflight = await get(`${APP}/bff/me`, { origin: evil, "access-control-request-method": "GET" }, "OPTIONS")
check("preflight from another origin is 403", preflight.status === 403 && !preflight.headers.has("access-control-allow-origin"))
const simple = await get(`${APP}/bff/csrf`, { origin: evil })
check("GET from another origin is 403", simple.status === 403, `status ${simple.status}`)
const own = await get(`${APP}/bff/csrf`, { origin: APP })
check("GET from the app origin passes", own.status === 200, `status ${own.status}`)

// Actuator: not on the app port; on the management port only health and info.
const appActuator = await get(`${APP}/actuator/health`)
check("no actuator on the app port", [401, 404].includes(appActuator.status), `status ${appActuator.status}`)
const health = await get(`${MANAGEMENT}/actuator/health`)
const healthBody = await health.json().catch(() => ({}))
check("management health is UP without details", health.status === 200 && healthBody.status === "UP" && !healthBody.components,
  JSON.stringify(healthBody))
check("management info", (await get(`${MANAGEMENT}/actuator/info`)).status === 200)
for (const path of ["env", "beans", "configprops", "heapdump", "gateway/routes"]) {
  const res = await get(`${MANAGEMENT}/actuator/${path}`)
  check(`/actuator/${path} not served`, [401, 404].includes(res.status), `status ${res.status}`)
}

console.log(failures ? `\n${failures} failed` : "\nAll header checks passed")
process.exit(failures ? 1 : 0)
