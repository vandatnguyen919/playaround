#!/usr/bin/env node
// Checks real mail delivery for the compose.prod.yml stack (see EMAIL.md).
// Usage: node deploy/compose/mailcheck.mjs <command> [--env-file <path>] [options]
//
//   dns                     SPF, DKIM and DMARC records of the SMTP_FROM domain,
//                           read from public DNS (1.1.1.1, 8.8.8.8).
//   send <mailbox>          Registers a fresh user and asks for a password reset at
//                           https://AUTH_HOST, so Keycloak sends both mails. The
//                           user's address is <mailbox> with a +mailcheck-<time>
//                           tag (Gmail and most providers deliver it to <mailbox>).
//   headers <file.eml>...   Reads saved messages (Gmail: Show original, Download)
//                           and requires spf, dkim and dmarc pass for the domain.
//   cleanup                 Deletes the +mailcheck- users over the admin tunnel.
//
// Options:
//   --env-file  the .env the stack runs with (default: deploy/compose/.env)
//   --insecure  accept a self-signed cert (local stack without Let's Encrypt)
//   PUBLIC_IP=1.2.3.4 connects there for AUTH_HOST instead of resolving it
//   (127.0.0.1 for a local stack whose AUTH_HOST is auth.localhost).
// .env keys: SMTP_FROM, MAIL_DKIM_SELECTOR, MAIL_SPF_INCLUDE, AUTH_HOST,
// APP_HOST, KC_ADMIN_PORT, KC_BOOTSTRAP_ADMIN_USERNAME/PASSWORD.
// Exits nonzero on failure.
import https from "node:https"
import { execFileSync } from "node:child_process"
import { Resolver } from "node:dns/promises"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { createHash, randomBytes } from "node:crypto"

const here = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const option = (name) => (flag(name) ? args[args.indexOf(name) + 1] : undefined)
const valued = ["--env-file", "--domain", "--selector", "--spf-include"]
const positional = args.filter((a, i) => !a.startsWith("--") && !valued.includes(args[i - 1]))
const [command, ...rest] = positional
const envFile = option("--env-file") ?? join(here, ".env")
const insecure = flag("--insecure")
const REALM = "playground"

let failures = 0
function check(name, ok, detail = "") {
  if (!ok) failures++
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  (" + detail + ")" : ""}`)
  return ok
}

function readEnv() {
  const env = {}
  try {
    for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)=(.*)$/)
      if (m) env[m[1]] = m[2].trim()
    }
  } catch {
    // headers can run without a .env when --domain is given
  }
  return { ...env, ...process.env }
}
const env = readEnv()
const fromDomain = () => option("--domain") ?? env.SMTP_FROM?.split("@")[1]

// ---- dns ----

async function txt(resolver, name) {
  try {
    return (await resolver.resolveTxt(name)).map((parts) => parts.join(""))
  } catch (e) {
    if (e.code === "ENODATA" || e.code === "ENOTFOUND") return []
    throw e
  }
}

async function checkDns() {
  const domain = fromDomain()
  const selector = option("--selector") ?? env.MAIL_DKIM_SELECTOR
  const include = option("--spf-include") ?? env.MAIL_SPF_INCLUDE
  if (!domain || !selector || !include) {
    throw new Error("Needs SMTP_FROM, MAIL_DKIM_SELECTOR and MAIL_SPF_INCLUDE (or --domain, --selector, --spf-include)")
  }
  const resolver = new Resolver()
  resolver.setServers(["1.1.1.1", "8.8.8.8"])

  const spf = (await txt(resolver, domain)).filter((r) => /^v=spf1(\s|$)/i.test(r))
  check(`one SPF record on ${domain}`, spf.length === 1, spf.length ? spf.join(" | ") : "none")
  if (spf.length === 1) {
    const terms = spf[0].split(/\s+/)
    check(`SPF includes ${include}`, terms.includes(`include:${include}`))
    check("SPF ends with ~all or -all", /^[~-]all$/.test(terms.at(-1)), terms.at(-1))
  }

  const dkimName = `${selector}._domainkey.${domain}`
  const dkim = await txt(resolver, dkimName)
  const key = dkim.join("").match(/(?:^|;)\s*p=([^;\s]*)/)?.[1]
  check(`DKIM key at ${dkimName}`, Boolean(key), key ? `${key.length} base64 chars` : "no p= key")

  const dmarc = (await txt(resolver, `_dmarc.${domain}`)).filter((r) => /^v=DMARC1\s*;/i.test(r))
  check(`one DMARC record at _dmarc.${domain}`, dmarc.length === 1, dmarc.join(" | ") || "none")
  if (dmarc.length === 1) {
    const policy = dmarc[0].match(/;\s*p=(\w+)/i)?.[1]
    check("DMARC has a policy", ["none", "quarantine", "reject"].includes(policy?.toLowerCase()), `p=${policy}`)
  }
}

// ---- send ----

class Jar {
  cookies = new Map()
  store(headers) {
    for (const line of [headers["set-cookie"] ?? []].flat()) {
      const [pair, ...attrs] = line.split(";")
      const eq = pair.indexOf("=")
      const name = pair.slice(0, eq).trim()
      const value = pair.slice(eq + 1).trim()
      if (value === "" || attrs.some((a) => /^\s*max-age=0/i.test(a))) this.cookies.delete(name)
      else this.cookies.set(name, value)
    }
  }
  header() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ")
  }
}

// node:https rather than fetch, so PUBLIC_IP can stand in for DNS.
function request(url, { method = "GET", body, jar }) {
  const u = new URL(url)
  const lookup = process.env.PUBLIC_IP
    ? (_host, opts, cb) => (opts?.all ? cb(null, [{ address: process.env.PUBLIC_IP, family: 4 }]) : cb(null, process.env.PUBLIC_IP, 4))
    : undefined
  return new Promise((resolve, reject) => {
    const req = https.request(
      u,
      {
        method,
        lookup,
        rejectUnauthorized: !insecure,
        headers: {
          cookie: jar.header(),
          ...(body ? { "content-type": "application/x-www-form-urlencoded", "content-length": Buffer.byteLength(body) } : {}),
        },
      },
      (res) => {
        let text = ""
        res.setEncoding("utf8")
        res.on("data", (c) => (text += c))
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, text }))
      }
    )
    req.on("error", reject)
    req.end(body)
  })
}

async function browse(jar, url, init = {}) {
  let current = url
  let { method = "GET", body } = init
  for (let hop = 0; hop < 15; hop++) {
    const res = await request(current, { method, body, jar })
    jar.store(res.headers)
    if (res.status >= 300 && res.status < 400 && res.headers.location) {
      const next = new URL(res.headers.location, current).toString()
      if (next.startsWith(`https://${env.APP_HOST}/`)) return { html: "", arrivedAtApp: next }
      current = next
      method = "GET"
      body = undefined
      continue
    }
    return { html: res.text, status: res.status }
  }
  throw new Error("Too many redirects")
}

const unescapeJs = (s) => s.replace(/\\\//g, "/").replace(/\\u0026/g, "&").replace(/&amp;/g, "&")
const form = (fields) => new URLSearchParams(fields).toString()

function page(html, base) {
  const url = (key) => {
    const v = html.match(new RegExp(`"${key}":\\s*"([^"]+)"`))?.[1]
    return v && new URL(unescapeJs(v), base).toString()
  }
  const message = html.match(/"message":\s*\{[^}]*?"summary":\s*"((?:[^"\\]|\\.)*)"/)?.[1]
  return {
    pageId: html.match(/kcContext\.pageId\s*=\s*"([^"]+)"/)?.[1] ?? null,
    loginAction: url("loginAction"),
    resetUrl: url("loginResetCredentialsUrl"),
    registrationUrl: url("registrationUrl"),
    message: message && unescapeJs(message),
  }
}

async function startLogin(jar, kc) {
  const authUrl =
    `${kc}/realms/${REALM}/protocol/openid-connect/auth?` +
    form({
      client_id: "gateway",
      response_type: "code",
      scope: "openid",
      redirect_uri: `https://${env.APP_HOST}/login/oauth2/code/gateway`,
      code_challenge: createHash("sha256").update(randomBytes(32)).digest("base64url"),
      code_challenge_method: "S256",
      state: randomBytes(6).toString("hex"),
    })
  const r = await browse(jar, authUrl)
  return page(r.html, kc)
}

async function send(mailbox) {
  if (!mailbox?.includes("@")) throw new Error("Usage: send <mailbox>, for example you@gmail.com")
  if (!env.AUTH_HOST || !env.APP_HOST) throw new Error(`AUTH_HOST and APP_HOST must be set in ${envFile}`)
  const kc = `https://${env.AUTH_HOST}`
  const [local, domain] = mailbox.split("@")
  const tag = new Date().toISOString().replace(/\D/g, "").slice(0, 14)
  const address = `${local}+mailcheck-${tag}@${domain}`
  const password = `Mailcheck-${randomBytes(6).toString("hex")}`
  const started = new Date(Date.now() - 5000).toISOString()

  const regJar = new Jar()
  const login = await startLogin(regJar, kc)
  if (!check("login page loads", login.pageId === "login.ftl", `pageId=${login.pageId}`)) return
  const reg = page((await browse(regJar, login.registrationUrl)).html, kc)
  const registered = await browse(regJar, reg.loginAction, {
    method: "POST",
    body: form({ email: address, fullName: "Mailcheck Person", password, "password-confirm": password }),
  })
  const after = page(registered.html, kc)
  check("registration asks to verify the email (verify mail sent)", after.pageId === "login-verify-email.ftl", `pageId=${after.pageId} message="${after.message ?? ""}"`)

  const resetJar = new Jar()
  const again = await startLogin(resetJar, kc)
  const resetPage = page((await browse(resetJar, again.resetUrl)).html, kc)
  const reset = page((await browse(resetJar, resetPage.loginAction, { method: "POST", body: form({ username: address }) })).html, kc)
  // Keycloak shows this page even when the send fails (so it does not tell
  // which emails exist). Only the log and the mailbox show the real outcome.
  check("reset request accepted", reset.pageId === "login.ftl" && /receive an email/i.test(reset.message ?? ""), `pageId=${reset.pageId} message="${reset.message ?? ""}"`)

  let logs
  try {
    logs = execFileSync("docker", ["compose", "-f", join(here, "compose.prod.yml"), "--env-file", envFile, "logs", "--no-log-prefix", "--since", started, "keycloak"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    })
  } catch {
    console.log("SKIP  Keycloak log check (no docker compose for this stack here; run on the VM)")
  }
  if (logs !== undefined) {
    const errors = logs.split(/\r?\n/).filter((l) => /SEND_(VERIFY_EMAIL|RESET_PASSWORD)_ERROR|Failed to send/.test(l))
    check("Keycloak logged no mail send errors", errors.length === 0, errors[0]?.slice(0, 200))
  }

  if (failures) {
    console.log(`\nA mail was not sent. See: docker compose -f deploy/compose/compose.prod.yml logs keycloak`)
    return
  }
  console.log(`\nTwo mails went to ${address}:`)
  console.log('  "Verify email" and "Reset password", from ' + (env.SMTP_FROM ?? "SMTP_FROM"))
  console.log("Open each, click its link, then save the original message (Gmail: More, Show original,")
  console.log("Download Original) and run:")
  console.log(`  node deploy/compose/mailcheck.mjs headers <verify.eml> <reset.eml>`)
  console.log("Remove the user afterwards with: node deploy/compose/mailcheck.mjs cleanup")
}

// ---- headers ----

// Unfolds continuation lines and returns [name, value] pairs in order.
function parseHeaders(raw) {
  const head = raw.split(/\r?\n\r?\n/)[0]
  const out = []
  for (const line of head.split(/\r?\n/)) {
    if (/^[ \t]/.test(line) && out.length) out.at(-1)[1] += " " + line.trim()
    else {
      const i = line.indexOf(":")
      if (i > 0) out.push([line.slice(0, i).trim().toLowerCase(), line.slice(i + 1).trim()])
    }
  }
  return out
}

// The topmost Authentication-Results is the receiving mailbox's verdict;
// lower ones could have been added by anyone on the way.
function verdict(raw, domain) {
  const headers = parseHeaders(raw)
  const get = (n) => headers.find(([k]) => k === n)?.[1]
  const results = get("authentication-results") ?? ""
  const method = (name) => results.match(new RegExp(`(?:^|;)\\s*${name}=(\\w+)([^;]*)`, "i"))
  const spf = method("spf")
  const dkims = [...results.matchAll(/(?:^|;)\s*dkim=(\w+)([^;]*)/gi)]
  const dmarc = method("dmarc")
  const fromDomainOf = (get("from") ?? "").match(/@([\w.-]+)/)?.[1]?.toLowerCase()
  const d = domain.toLowerCase()
  const dkimForDomain = dkims.find((m) => m[1].toLowerCase() === "pass" && new RegExp(`header\\.(?:d=|i=[^\\s;]*@)${d.replace(/\./g, "\\.")}(\\s|;|$)`, "i").test(m[2]))
  return {
    subject: get("subject"),
    receivedBy: results.split(";")[0].trim(),
    from: fromDomainOf === d,
    fromDomain: fromDomainOf,
    spf: spf?.[1]?.toLowerCase() === "pass",
    spfDetail: spf ? `${spf[1]}${(spf[2].match(/smtp\.mailfrom=\S+/) ?? [""])[0] ? " " + spf[2].match(/smtp\.mailfrom=\S+/)[0] : ""}` : "missing",
    dkim: Boolean(dkimForDomain),
    dkimDetail: dkims.map((m) => `${m[1]}${(m[2].match(/header\.[di]=\S+/) ?? [""])[0] ? " " + m[2].match(/header\.[di]=\S+/)[0] : ""}`).join(", ") || "missing",
    dmarc: dmarc?.[1]?.toLowerCase() === "pass",
    dmarcDetail: dmarc ? dmarc[1] : "missing",
  }
}

function checkHeaders(files) {
  const domain = fromDomain()
  if (!domain) throw new Error("Needs SMTP_FROM in the .env or --domain")
  if (!files.length) throw new Error("Usage: headers <file.eml>...")
  for (const file of files) {
    const v = verdict(readFileSync(file, "utf8"), domain)
    console.log(`\n${file}: "${v.subject ?? "?"}" (${v.receivedBy || "no Authentication-Results"})`)
    check(`From is on ${domain}`, v.from, v.fromDomain)
    check("SPF pass", v.spf, v.spfDetail)
    check(`DKIM pass signed by ${domain}`, v.dkim, v.dkimDetail)
    check("DMARC pass", v.dmarc, v.dmarcDetail)
  }
}

// ---- cleanup ----

async function cleanup() {
  const admin = `http://127.0.0.1:${env.KC_ADMIN_PORT ?? "8080"}`
  const tokenRes = await fetch(`${admin}/realms/master/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form({ grant_type: "password", client_id: "admin-cli", username: env.KC_BOOTSTRAP_ADMIN_USERNAME, password: env.KC_BOOTSTRAP_ADMIN_PASSWORD }),
  })
  if (!tokenRes.ok) throw new Error(`Admin sign-in at ${admin} failed: HTTP ${tokenRes.status} (is the SSH tunnel up?)`)
  const auth = { authorization: `Bearer ${(await tokenRes.json()).access_token}` }
  const users = await (await fetch(`${admin}/admin/realms/${REALM}/users?search=${encodeURIComponent("*+mailcheck-*")}&max=100`, { headers: auth })).json()
  const ours = users.filter((u) => /\+mailcheck-\d{14}@/.test(u.email ?? ""))
  for (const u of ours) {
    const res = await fetch(`${admin}/admin/realms/${REALM}/users/${u.id}`, { method: "DELETE", headers: auth })
    check(`deleted ${u.email}`, res.status === 204, `HTTP ${res.status}`)
  }
  if (!ours.length) console.log("No +mailcheck- users found.")
}

// ---- main ----

const commands = { dns: checkDns, send: () => send(rest[0]), headers: () => checkHeaders(rest), cleanup }
if (!(command in commands)) {
  console.error(`Unknown command "${command ?? ""}". Use one of: ${Object.keys(commands).join(", ")}`)
  process.exit(2)
}
try {
  await commands[command]()
} catch (e) {
  console.error(`ERROR  ${e.message}`)
  process.exit(2)
}
process.exit(failures ? 1 : 0)
