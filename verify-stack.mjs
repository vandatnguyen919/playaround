#!/usr/bin/env node
// Starts or stops the whole dev stack headless, for ./verify and CI.
//
//   node verify-stack.mjs up [--build]   compose services, realm, api, gateway, Vite
//   node verify-stack.mjs status         what answers on each port
//   node verify-stack.mjs down           stops the api, gateway and Vite started by up
//
// up builds what is missing (theme jar, web/dist, boot jars), or everything with
// --build. It reuses anything already answering, so it is safe next to a dev
// session that already runs some of it. Compose services stay up after down
// (docker compose -f infra/docker-compose.yml stop, when wanted). Nothing here
// deletes data or volumes.
//
// The gateway serves the built SPA (SPA_LOCATION) with FORWARD_HEADERS_STRATEGY=native,
// as check-headers.mjs expects. Vite on :5174 proxies to it, as in dev, so the
// realm's redirect URIs (APP_URL) and back-channel URL (host.docker.internal:8181) hold.
// MANAGEMENT_PORT moves the gateway's management port (set MANAGEMENT_URL for ./verify).
// Process logs: build/verify-stack/*.log.
import { spawn, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, openSync, readdirSync, readFileSync, writeFileSync, rmSync } from "node:fs"
import net from "node:net"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = dirname(fileURLToPath(import.meta.url))
const WIN = process.platform === "win32"
const STATE = join(ROOT, "build/verify-stack")
const PIDS = join(STATE, "pids.json")

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
const COMPOSE = [
  "compose",
  "-f",
  join(ROOT, "infra/docker-compose.yml"),
  ...(process.platform === "linux" ? ["-f", join(ROOT, "infra/compose.verify.yml")] : []),
]
const MANAGEMENT_PORT = process.env.MANAGEMENT_PORT ?? "9181"
// The boot jars need Java 26+. VERIFY_JAVA picks the java binary when JAVA_HOME is older.
const java =
  process.env.VERIFY_JAVA ?? (process.env.JAVA_HOME ? join(process.env.JAVA_HOME, "bin", WIN ? "java.exe" : "java") : "java")

async function status(url, accept) {
  try {
    const res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(3000) })
    return accept(res.status)
  } catch {
    return false
  }
}

const services = {
  keycloak: { url: "http://localhost:8080/realms/playground", accept: (s) => s === 200 },
  mailpit: { url: "http://localhost:8025/api/v1/info", accept: (s) => s === 200 },
  api: { url: "http://localhost:8182/actuator/health", accept: (s) => s === 200 },
  gateway: { url: "http://localhost:8181/bff/me", accept: (s) => s === 401 },
  management: { url: `http://localhost:${MANAGEMENT_PORT}/actuator/health`, accept: (s) => s === 200 },
  app: { url: "http://localhost:5174/bff/me", accept: (s) => s === 401 },
}
const isUp = (name) => status(services[name].url, services[name].accept)

function tcp(host, port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port, timeout: 3000 })
    socket.once("connect", () => (socket.destroy(), resolve(true)))
    socket.once("error", () => resolve(false))
    socket.once("timeout", () => (socket.destroy(), resolve(false)))
  })
}

function sh(cmd, args, opts = {}) {
  console.log(`$ ${cmd} ${args.join(" ")}`)
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: "inherit", shell: WIN && !cmd.endsWith(".exe") && cmd !== "docker", ...opts })
  if (r.status !== 0) {
    console.error(`FAILED (exit ${r.status}): ${cmd} ${args.join(" ")}`)
    process.exit(1)
  }
}

const npm = WIN ? "npm.cmd" : "npm"
// Absolute: cmd.exe may not search the current directory (NoDefaultCurrentDirectoryInExePath).
// gradlew is not executable in git, so run it with bash, as CI does.
const gradle = (args) => (WIN ? [`"${join(ROOT, "gradlew.bat")}"`, args] : ["bash", ["./gradlew", ...args]])

function bootJar(module) {
  const dir = join(ROOT, module, "build/libs")
  const jar = existsSync(dir) && readdirSync(dir).find((f) => f.endsWith(".jar") && !f.endsWith("-plain.jar"))
  return jar ? join(dir, jar) : null
}

function build(force) {
  if (force || !existsSync(join(ROOT, "keycloak-theme/dist_keycloak/keycloak-theme-for-kc-all-other-versions.jar"))) {
    if (!existsSync(join(ROOT, "keycloak-theme/node_modules"))) sh(npm, ["--prefix", "keycloak-theme", "ci"])
    sh(npm, ["--prefix", "keycloak-theme", "run", "build-keycloak-theme"])
  }
  if (!existsSync(join(ROOT, "web/node_modules"))) sh(npm, ["--prefix", "web", "ci"])
  if (force || !existsSync(join(ROOT, "web/dist/index.html"))) sh(npm, ["--prefix", "web", "run", "build"])
  if (force || !bootJar("api") || !bootJar("gateway")) sh(...gradle([":api:bootJar", ":gateway:bootJar", "--console=plain"]))
}

function startDetached(name, cmd, args, env = {}) {
  mkdirSync(STATE, { recursive: true })
  const out = openSync(join(STATE, `${name}.log`), "w")
  const child = spawn(cmd, args, {
    cwd: ROOT,
    detached: true,
    shell: WIN && !cmd.endsWith(".exe") && cmd !== "java",
    stdio: ["ignore", out, out],
    env: { ...process.env, ...env },
    windowsHide: true,
  })
  child.unref()
  const pids = existsSync(PIDS) ? JSON.parse(readFileSync(PIDS, "utf8")) : {}
  pids[name] = child.pid
  writeFileSync(PIDS, JSON.stringify(pids, null, 2))
  console.log(`started ${name} (pid ${child.pid}), log build/verify-stack/${name}.log`)
}

async function waitFor(name, seconds) {
  const deadline = Date.now() + seconds * 1000
  while (Date.now() < deadline) {
    if (await isUp(name)) return console.log(`up       ${name}`)
    await new Promise((r) => setTimeout(r, 1000))
  }
  console.error(`TIMEOUT  ${name} did not answer at ${services[name].url} within ${seconds}s`)
  const log = join(STATE, `${name}.log`)
  if (existsSync(log)) console.error(readFileSync(log, "utf8").split("\n").slice(-40).join("\n"))
  process.exit(1)
}

async function up(force) {
  build(force)
  // Compose services: only the ones not answering yet. A running Keycloak is
  // reused as it is (rerun keycloak-config yourself if the realm file changed).
  const missing = []
  if (!(await isUp("keycloak"))) missing.push("keycloak")
  if (!(await isUp("mailpit"))) missing.push("mailpit")
  if (!(await tcp("localhost", 6379))) missing.push("redis")
  if (missing.length) sh("docker", [...COMPOSE, "up", "-d", "--wait", "--wait-timeout", "600", ...missing])
  if (missing.includes("keycloak")) sh("docker", [...COMPOSE, "run", "--rm", "keycloak-config"])
  else console.log("reusing Keycloak on :8080 (realm not reapplied)")
  await waitFor("keycloak", 60)

  if (!(await isUp("api"))) startDetached("api", java, ["-jar", bootJar("api")])
  if (!(await isUp("gateway"))) {
    startDetached("gateway", java, ["-jar", bootJar("gateway")], {
      SPA_LOCATION: `file:${join(ROOT, "web/dist").replaceAll("\\", "/")}/`,
      FORWARD_HEADERS_STRATEGY: "native",
      MANAGEMENT_PORT,
    })
  }
  if (!(await isUp("app"))) startDetached("app", npm, ["--prefix", "web", "run", "dev", "--", "--strictPort"])
  await waitFor("api", 180)
  await waitFor("gateway", 180)
  await waitFor("management", 30)
  await waitFor("app", 60)
  console.log("Stack is up. Run ./verify (Windows: node verify.mjs).")
}

function down() {
  if (!existsSync(PIDS)) return console.log("Nothing started by verify-stack.mjs up.")
  for (const [name, pid] of Object.entries(JSON.parse(readFileSync(PIDS, "utf8")))) {
    if (WIN) spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" })
    else {
      try {
        process.kill(-pid, "SIGTERM")
      } catch {
        // already gone
      }
    }
    console.log(`stopped  ${name} (pid ${pid})`)
  }
  rmSync(PIDS)
}

const [command, ...flags] = process.argv.slice(2)
if (command === "up") await up(flags.includes("--build"))
else if (command === "down") down()
else if (command === "status") {
  for (const name of Object.keys(services)) console.log(`${(await isUp(name)) ? "up  " : "down"}  ${name}  ${services[name].url}`)
} else {
  console.error("Usage: node verify-stack.mjs up [--build] | status | down")
  process.exit(2)
}
