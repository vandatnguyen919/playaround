#!/usr/bin/env node
// One entry point for the automated checks. Headless, no prompts, runs the same in CI.
//
//   ./verify                     every default suite (Windows: node verify.mjs)
//   ./verify gateway attacks     only the named suites
//   ./verify smoke:login,logout  a suite with its own check names (or test classes)
//   ./verify --list              suites, what they need, and whether they run by default
//
// Each suite first probes what it needs (Docker, Keycloak, the app...). If that
// is missing the suite is BLOCKED, not skipped: the run exits nonzero and says
// what to start. `node verify-stack.mjs up` starts the whole dev stack headless.
// Exit codes: 0 all passed, 1 a suite failed or was blocked, 2 unknown suite name.
//
// This run's logs and summary go to .shipit/verify/evidence/latest/ (cleared at
// the start of every run, so nothing there is from an older run). Suites that
// collect their own evidence say where in their log.
import { spawn, spawnSync } from "node:child_process"
import { createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import net from "node:net"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = dirname(fileURLToPath(import.meta.url))
const WIN = process.platform === "win32"
const LATEST = join(ROOT, ".shipit/verify/evidence/latest")

// Dev secrets rendered from local Vault (infra/vault/vault.mjs), read the way the
// gateway's bootRun does. A variable already set in the shell wins.
const DEV_ENV_KEYS = ["GATEWAY_CLIENT_SECRET", "REDIS_PASSWORD", "KC_BOOTSTRAP_ADMIN_USERNAME", "KC_BOOTSTRAP_ADMIN_PASSWORD"]
function loadDevEnv(root) {
  const file = join(root, "infra/.env")
  if (!existsSync(file)) return
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m && DEV_ENV_KEYS.includes(m[1]) && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^'(.*)'$/, "$1")
    }
  }
}
loadDevEnv(ROOT)

const KC = process.env.KC_URL ?? "http://localhost:8080"
const MAILPIT = process.env.MAILPIT_URL ?? "http://localhost:8025"
const APP = process.env.APP_URL ?? "http://localhost:5174"
const GATEWAY = process.env.GATEWAY_URL ?? "http://localhost:8181"
const MANAGEMENT = process.env.MANAGEMENT_URL ?? "http://localhost:9181"
const COMPOSE_ENV = process.env.COMPOSE_ENV_FILE ?? join(ROOT, "deploy/compose/.env")

// --- What suites need ---------------------------------------------------------

async function httpUp(url, accept = (s) => s < 500) {
  try {
    const res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(5000) })
    return accept(res.status)
  } catch {
    return false
  }
}

function tcpUp(host, port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port, timeout: 3000 })
    socket.once("connect", () => (socket.destroy(), resolve(true)))
    socket.once("error", () => resolve(false))
    socket.once("timeout", () => (socket.destroy(), resolve(false)))
  })
}

const needs = {
  docker: {
    what: "Docker (Testcontainers)",
    probe: async () => spawnSync("docker", ["info"], { stdio: "ignore" }).status === 0,
    fix: "start Docker",
  },
  keycloak: {
    what: `dev Keycloak with the realm (${KC})`,
    probe: () => httpUp(`${KC}/realms/playground`, (s) => s === 200),
    fix: "node verify-stack.mjs up (or docker compose -f infra/docker-compose.yml up -d keycloak keycloak-config)",
  },
  mailpit: {
    what: `Mailpit API (${MAILPIT})`,
    probe: () => httpUp(`${MAILPIT}/api/v1/info`, (s) => s === 200),
    fix: "node verify-stack.mjs up (or docker compose -f infra/docker-compose.yml up -d mailpit)",
  },
  redis: {
    what: "dev Redis (localhost:6379)",
    probe: () => tcpUp(process.env.REDIS_HOST ?? "localhost", Number(process.env.REDIS_PORT ?? 6379)),
    fix: "node verify-stack.mjs up (or docker compose -f infra/docker-compose.yml up -d redis)",
  },
  gateway: {
    what: `the gateway (${GATEWAY}), serving the built SPA`,
    // 401 without a session means the gateway and its Redis are up.
    probe: () => httpUp(`${GATEWAY}/bff/me`, (s) => s === 401),
    fix: "node verify-stack.mjs up (gateway with SPA_LOCATION=file:../web/dist/)",
  },
  management: {
    what: `the gateway's management port (${MANAGEMENT})`,
    probe: () => httpUp(`${MANAGEMENT}/actuator/health`, (s) => s === 200),
    fix: "node verify-stack.mjs up",
  },
  app: {
    what: `the app origin (${APP}) proxying to the gateway`,
    probe: () => httpUp(`${APP}/bff/me`, (s) => s === 401),
    fix: "node verify-stack.mjs up (or npm --prefix web run dev)",
  },
  playwright: {
    what: "Playwright and its Chromium (e2e/)",
    probe: async () => existsSync(join(ROOT, "e2e/node_modules/@playwright/test")),
    fix: "npm --prefix e2e ci && npm --prefix e2e exec playwright install chromium",
  },
  docsDeps: {
    what: "the docs site's npm packages (docs/node_modules)",
    probe: async () => existsSync(join(ROOT, "docs/node_modules/@docusaurus/core")),
    fix: "npm --prefix docs ci",
  },
  composeEnv: {
    what: `the compose.prod.yml stack and its env file (${COMPOSE_ENV})`,
    probe: async () => existsSync(COMPOSE_ENV),
    fix: "start deploy/compose/compose.prod.yml locally and set COMPOSE_ENV_FILE (README, Local production stack)",
  },
}

// A loaded host (for example right after the Testcontainers suites) can miss a
// single 5 s probe, so a need gets this long to answer before the suite is BLOCKED.
async function answersWithin(probe, ms) {
  const deadline = Date.now() + ms
  for (;;) {
    if (await probe()) return true
    if (Date.now() >= deadline) return false
    await new Promise((r) => setTimeout(r, 2000))
  }
}

// --- Suites ---------------------------------------------------------------------

// Absolute: cmd.exe may not search the current directory (NoDefaultCurrentDirectoryInExePath).
// gradlew is not executable in git, so run it with bash, as CI does.
const gradle = (args) => (WIN ? [`"${join(ROOT, "gradlew.bat")}"`, args] : ["bash", ["./gradlew", ...args]])
const npm = WIN ? "npm.cmd" : "npm"

// Gradle test selection: class names become --tests filters.
const gradleTests = (module) => (args) => [
  gradle([`:${module}:test`, "--console=plain", ...args.flatMap((a) => ["--tests", a.includes(".") ? a : `*${a}`])]),
]

const suites = {
  gateway: {
    what: "Gateway tests: Redis (hardening, Redis down) and Keycloak (session, token relay, logout) in Testcontainers",
    needs: ["docker"],
    run: gradleTests("gateway"),
  },
  api: {
    what: "API tests: role rules, and valid, expired, tampered and forged tokens (stub JWKS and real Keycloak)",
    needs: ["docker"],
    run: gradleTests("api"),
  },
  web: {
    what: "SPA and theme lint and unit tests",
    needs: [],
    run: () => [
      [npm, ["--prefix", "web", "run", "lint"]],
      [npm, ["--prefix", "web", "test"]],
      [npm, ["--prefix", "keycloak-theme", "run", "lint"]],
      [npm, ["--prefix", "keycloak-theme", "test"]],
    ],
  },
  attacks: {
    what: "Attack and forgot-password checks against dev Keycloak (attacks.mjs); pass when the attack fails safely",
    needs: ["keycloak", "mailpit"],
    run: (args) => [[process.execPath, ["attacks.mjs", ...args]]],
  },
  smoke: {
    what: "Login, roles, CSRF, logout, fixation, back-channel, refresh over HTTP (smoke.mjs)",
    needs: ["keycloak", "redis", "gateway", "app"],
    run: (args) => [[process.execPath, ["smoke.mjs", ...args]]],
  },
  headers: {
    what: "Security headers, CORS and actuator exposure (check-headers.mjs)",
    needs: ["gateway", "management"],
    run: () => [[process.execPath, ["check-headers.mjs", GATEWAY, MANAGEMENT]]],
  },
  e2e: {
    what: "Browser flows in Playwright: login, logout, register with email, forgot password, 401 and 403",
    needs: ["playwright", "keycloak", "mailpit", "app"],
    run: (args) => [[npm, ["--prefix", "e2e", "exec", "--", "playwright", "test", "--config", "e2e/playwright.config.ts", ...args]]],
  },
  docs: {
    what: "Docs site: Docusaurus build with broken links as errors, then a scan for content that must not be public",
    needs: ["docsDeps"],
    run: () => [
      [npm, ["--prefix", "docs", "run", "build"]],
      [process.execPath, ["docs/check-public.mjs"]],
    ],
  },
  compose: {
    what: "The local or VM compose.prod.yml stack (deploy/compose/check.mjs); only when named",
    needs: ["composeEnv"],
    default: false,
    run: (args) => [[process.execPath, ["deploy/compose/check.mjs", "--env-file", COMPOSE_ENV, ...args]]],
  },
}

// --- Arguments --------------------------------------------------------------------

const argv = process.argv.slice(2)
if (argv.includes("--list") || argv.includes("--help")) {
  for (const [name, s] of Object.entries(suites)) {
    console.log(`${name.padEnd(8)} ${s.default === false ? "(named only) " : ""}${s.what}`)
    if (s.needs.length) console.log(`         needs: ${s.needs.map((n) => needs[n].what).join("; ")}`)
  }
  process.exit(0)
}
const requested = argv.map((a) => {
  const [name, rest] = a.split(":")
  return { name, args: rest ? rest.split(",").filter(Boolean) : [] }
})
const unknown = requested.filter((r) => !(r.name in suites)).map((r) => r.name)
if (unknown.length) {
  console.error(`Unknown suite: ${unknown.join(", ")}. Available: ${Object.keys(suites).join(", ")}`)
  process.exit(2)
}
const selected = requested.length
  ? requested
  : Object.entries(suites).filter(([, s]) => s.default !== false).map(([name]) => ({ name, args: [] }))

// --- Run --------------------------------------------------------------------------

function git(...args) {
  const r = spawnSync("git", args, { cwd: ROOT, encoding: "utf8" })
  return r.status === 0 ? r.stdout.trim() : null
}

function run(cmd, args, log) {
  return new Promise((resolve) => {
    log.write(`$ ${cmd} ${args.join(" ")}\n`)
    // npm and gradlew are .cmd/.bat files on Windows, which need a shell.
    const child = spawn(cmd, args, {
      cwd: ROOT,
      shell: WIN && !cmd.endsWith(".exe"),
      env: { ...process.env, FORCE_COLOR: "0" },
      stdio: ["ignore", "pipe", "pipe"],
    })
    for (const stream of [child.stdout, child.stderr]) {
      stream.on("data", (chunk) => {
        process.stdout.write(chunk)
        log.write(chunk)
      })
    }
    child.on("error", (err) => {
      log.write(`spawn failed: ${err.message}\n`)
      resolve(127)
    })
    child.on("close", (code) => resolve(code ?? 1))
  })
}

rmSync(LATEST, { recursive: true, force: true })
mkdirSync(LATEST, { recursive: true })
const runId = new Date().toISOString()
const results = []

for (const { name, args } of selected) {
  const suite = suites[name]
  const started = Date.now()
  console.log(`\n=== ${name}: ${suite.what}`)
  const missing = []
  for (const n of suite.needs) if (!(await answersWithin(needs[n].probe, 30_000))) missing.push(n)
  if (missing.length) {
    const detail = missing.map((n) => `${needs[n].what} is not reachable. Fix: ${needs[n].fix}`)
    detail.forEach((d) => console.log(`BLOCKED  ${d}`))
    results.push({ suite: name, status: "blocked", detail, seconds: 0 })
    continue
  }
  const log = createWriteStream(join(LATEST, `${name}.log`))
  let code = 0
  for (const [cmd, cmdArgs] of suite.run(args)) {
    code = await run(cmd, cmdArgs, log)
    if (code !== 0) break
  }
  await new Promise((r) => log.end(r))
  const seconds = Math.round((Date.now() - started) / 1000)
  results.push({ suite: name, status: code === 0 ? "passed" : "failed", exitCode: code, seconds, args })
}

writeFileSync(
  join(LATEST, "summary.json"),
  JSON.stringify({ runId, commit: git("rev-parse", "HEAD"), dirty: Boolean(git("status", "--porcelain")), results }, null, 2)
)

console.log(`\n=== Summary (run ${runId})`)
for (const r of results) {
  console.log(`${r.status.toUpperCase().padEnd(8)} ${r.suite}${r.seconds ? `  ${r.seconds}s` : ""}`)
}
console.log(`Logs: .shipit/verify/evidence/latest/`)
process.exit(results.every((r) => r.status === "passed") ? 0 : 1)
