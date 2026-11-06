#!/usr/bin/env node
// Jenkins drill, on a throwaway k3s in Docker (same version as PRODUCT.md), with the local
// compose.prod.yml stack's Keycloak for sign-in. Proves the CD pipeline and the recreate.
//
// Real: Jenkins, the pipeline, ssh and the gate, BuildKit provenance on multi-arch images,
// a TLS registry, compose.prod.yml with its images in Docker-in-Docker (the stand-in VM),
// smoke.mjs against it, mail to Mailpit. Standing in: the VM, GHCR, and GitHub's API and
// raw files. Touches nothing on Azure and pushes nothing to GitHub or GHCR.
//
// Needs: Docker with about 8 GB, kubectl, helm, git, openssl, and the local stack running
// with the jenkins client (README.md, "Local prod stack").
//
//   node deploy/k8s/jenkins/drill/drill.mjs --env-file <local stack env> [step...]
//
// Steps, in order: cluster install access gate ship-good ship-bad rollback stops ship-crash
// ship-final history drift backup recreate restore keycloak-down. No step named runs them
// all. "clean" removes everything it made. Exits nonzero on the first failed check.
import { execFileSync, spawn } from "node:child_process"
import crypto from "node:crypto"
import dns from "node:dns"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

// *.localhost is 127.0.0.1, which Windows does not resolve by itself.
const lookup = dns.lookup
dns.lookup = function (hostname, options, callback) {
  if (typeof options === "function") [callback, options] = [options, {}]
  if (typeof options === "number") options = { family: options }
  if (!/\.localhost$/i.test(hostname)) return lookup.call(this, hostname, options, callback)
  process.nextTick(() => (options?.all ? callback(null, [{ address: "127.0.0.1", family: 4 }]) : callback(null, "127.0.0.1", 4)))
  return {}
}
// Traefik's self-signed cert on auth.localhost.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"
process.removeAllListeners("warning")

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"))
const REPO = path.resolve(HERE, "../../../..")
const JENKINS = path.resolve(HERE, "..")
const K3S_IMAGE = "rancher/k3s:v1.36.5-k3s1"
const CONTAINER = "jk-k3s"
const NETWORK = "jk-drill"
const SUBNET = "172.31.99"
const VM = "jk-vm"
const FIXTURE = "jk-fixture"
const REGISTRY = "jk-registry"
const MAILPIT = "jk-mailpit"
const BUILDER = "jk-builder"
const REGISTRY_HOST = "registry.drill.test:5000"
const REAL_SHA = "13163e5ec4210f7b6c00d85be05307ea556c116b"
const REAL_REPO = "vandatnguyen919/playaround"
const COMPOSE = "/srv/playground/deploy/compose"
const WORK = path.join(process.env.DRILL_DIR ?? os.tmpdir(), "jenkins-drill")
fs.mkdirSync(WORK, { recursive: true })
const KUBECONFIG = path.join(WORK, "kubeconfig")
const URL_BASE = "http://localhost:8090"
const DEPLOY = "deploy-playground"
const ROLLBACK = "rollback-playground"
const MAIL_API = "http://127.0.0.1:18025/api/v1"
const FAKE_API = "http://127.0.0.1:18099"
const USERS = {
  admin: { username: "drill-jenkins-admin@example.com", roles: ["jenkins-admin"] },
  plain: { username: "drill-jenkins-plain@example.com", roles: [] },
}
// What each commit ships, so a step can look back at earlier versions after a restart.
const STATE_FILE = path.join(WORK, "versions.json")
const versions = fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) : {}
const remember = (name, value) => {
  versions[name] = value
  fs.writeFileSync(STATE_FILE, JSON.stringify(versions, null, 2))
}

const args = process.argv.slice(2)
const envIndex = args.indexOf("--env-file")
if (envIndex < 0) {
  console.error("usage: drill.mjs --env-file <local stack env> [step...]")
  process.exit(2)
}
const stackEnv = Object.fromEntries(
  fs.readFileSync(args[envIndex + 1], "utf8").split(/\r?\n/).filter((l) => /^\w+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
)
const steps = args.filter((_, i) => i !== envIndex && i !== envIndex + 1)
const KC_ADMIN = `http://localhost:${stackEnv.KC_ADMIN_PORT ?? 8080}`
const KC_PUBLIC = `https://${stackEnv.AUTH_HOST}`
if (stackEnv.AUTH_HOST !== "auth.localhost") throw new Error("This drill runs only against a local stack (AUTH_HOST=auth.localhost)")

const childEnv = { ...process.env, KUBECONFIG, MSYS_NO_PATHCONV: "1" }
const run = (cmd, argv, options = {}) => execFileSync(cmd, argv, { encoding: "utf8", env: childEnv, stdio: ["pipe", "pipe", "pipe"], maxBuffer: 1 << 28, ...options })
const kubectl = (...argv) => run("kubectl", argv)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex").slice(0, 16)
const posix = (p) => p.replace(/\\/g, "/")

let passed = 0
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`)
  if (!ok) throw new Error(`Check failed: ${name}`)
  passed++
}
const say = (s) => console.log(`\n== ${s}`)

async function until(what, fn, { minutes = 10, every = 5000 } = {}) {
  const end = Date.now() + minutes * 60_000
  for (;;) {
    let value
    try {
      value = await fn()
    } catch {
      value = undefined
    }
    if (value) return value
    if (Date.now() > end) throw new Error(`Timed out after ${minutes} min waiting for ${what}`)
    await sleep(every)
  }
}

// ---- Port-forward, the same way a tunnel reaches Jenkins.
let forward
function stopForward() {
  forward?.kill()
  forward = undefined
}
process.on("exit", stopForward)
async function startForward() {
  stopForward()
  forward = spawn("kubectl", ["-n", "ci", "port-forward", "pod/jenkins-0", "8090:8080"], { env: childEnv, stdio: "ignore" })
  await until("the tunnel", async () => (await fetch(`${URL_BASE}/login`)).status === 200, { minutes: 2, every: 1000 })
}
async function waitForController() {
  stopForward()
  kubectl("-n", "ci", "rollout", "status", "statefulset/jenkins", "--timeout=15m")
  await startForward()
}

// ---- A browser with one cookie jar per host.
class Browser {
  jars = new Map()
  async request(url, { method = "GET", body, headers = {} } = {}) {
    const host = new URL(url).host
    const jar = this.jars.get(host) ?? new Map()
    this.jars.set(host, jar)
    const res = await fetch(url, {
      method,
      body,
      redirect: "manual",
      headers: { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; "), ...(typeof body === "string" ? { "content-type": "application/x-www-form-urlencoded" } : {}), ...headers },
    })
    for (const line of res.headers.getSetCookie()) {
      const [pair] = line.split(";")
      jar.set(pair.slice(0, pair.indexOf("=")).trim(), pair.slice(pair.indexOf("=") + 1).trim())
    }
    return res
  }
  async navigate(url, init = {}) {
    let current = url
    let next = init
    const hops = []
    for (let hop = 0; hop < 15; hop++) {
      const res = await this.request(current, next)
      hops.push(current)
      const location = res.headers.get("location")
      if (res.status >= 300 && res.status < 400 && location) {
        current = new URL(location, current).toString()
        next = {}
        continue
      }
      return { res, url: current, html: await res.text(), hops }
    }
    throw new Error("Too many redirects")
  }
}

async function signIn(user) {
  const browser = new Browser()
  const form = await browser.navigate(`${URL_BASE}/securityRealm/commenceLogin?from=%2F`)
  const raw = form.html.match(/"loginAction":\s*"([^"]+)"/)?.[1]
  if (!raw) throw new Error(`No Keycloak login form at ${form.url} (${form.res.status})`)
  const action = new URL(raw.replace(/\\\//g, "/").replace(/\\u0026/g, "&").replace(/&amp;/g, "&"), KC_PUBLIC).toString()
  const done = await browser.navigate(action, { method: "POST", body: new URLSearchParams({ username: user.username, password: user.password }).toString() })
  return { browser, form, done }
}

let adminBrowser
async function api(pathname, init = {}) {
  adminBrowser ??= (await signIn(USERS.admin)).browser
  let res = await adminBrowser.request(`${URL_BASE}${pathname}`, init)
  // The session may have ended with a restart or the local Keycloak's idle timeout.
  if ((res.status === 401 || res.status === 403 || res.status === 302) && pathname !== "/whoAmI/api/json") {
    const who = await (await adminBrowser.request(`${URL_BASE}/whoAmI/api/json`)).json().catch(() => undefined)
    if (!who?.authenticated || who.name === "anonymous") {
      adminBrowser = (await signIn(USERS.admin)).browser
      res = await adminBrowser.request(`${URL_BASE}${pathname}`, init)
    }
  }
  return res
}
async function withCrumb(init = {}) {
  const res = await api("/crumbIssuer/api/json")
  if (res.status !== 200) throw new Error(`crumb: ${res.status}`)
  const crumb = await res.json()
  return { ...init, method: "POST", headers: { ...init.headers, [crumb.crumbRequestField]: crumb.crumb } }
}
const freshSession = () => {
  adminBrowser = undefined
}

// ---- What "identical" means. Encrypted values differ per install by design (each
// has its own master key), so they are compared by being used, not by their bytes.
async function fingerprint() {
  const plugins = (await (await api("/pluginManager/api/json?tree=plugins[shortName,version,active,enabled]")).json()).plugins
    .map((p) => `${p.shortName}:${p.version}:${p.active && p.enabled}`)
    .sort()
  const exportRes = await api("/manage/configuration-as-code/export", await withCrumb())
  if (exportRes.status !== 200) throw new Error(`JCasC export: ${exportRes.status}`)
  const settings = (await exportRes.text()).replace(/\r\n/g, "\n").replace(/\{AQAAAB[^}"\s]*\}/g, "{encrypted}")
  const jobs = (await (await api("/api/json?tree=jobs[name]")).json()).jobs.map((j) => j.name).sort()
  const jobConfigs = {}
  for (const name of jobs) jobConfigs[name] = (await (await api(`/job/${name}/config.xml`)).text()).replace(/\r\n/g, "\n")
  const credentials = (await (await api("/manage/credentials/store/system/domain/_/api/json?depth=1&tree=credentials[id,typeName,description]")).json()).credentials
    .map((c) => `${c.id}|${c.typeName}|${c.description}`)
    .sort()
  return { plugins, settings, jobs, jobConfigs, credentials }
}
const FP_FILE = path.join(WORK, "fingerprint.json")
function compareFingerprints(a, b, label) {
  check(`${label}: same plugins and versions`, JSON.stringify(a.plugins) === JSON.stringify(b.plugins), `${b.plugins.length} plugins`)
  if (a.settings !== b.settings) {
    fs.writeFileSync(path.join(WORK, "a.yaml"), a.settings)
    fs.writeFileSync(path.join(WORK, "b.yaml"), b.settings)
  }
  check(`${label}: same settings (JCasC export)`, a.settings === b.settings, `${b.settings.split("\n").length} lines, sha ${sha256(b.settings)}`)
  check(`${label}: same jobs`, JSON.stringify(a.jobs) === JSON.stringify(b.jobs), b.jobs.join(","))
  check(`${label}: same job config`, JSON.stringify(a.jobConfigs) === JSON.stringify(b.jobConfigs), `sha ${sha256(JSON.stringify(b.jobConfigs))}`)
  check(`${label}: same credential ids`, JSON.stringify(a.credentials) === JSON.stringify(b.credentials), b.credentials.map((c) => c.split("|")[0]).join(","))
}

// ---- Builds
async function buildJson(job, n) {
  const res = await api(`/job/${job}/${n}/api/json?tree=number,result,building,description,actions[causes[shortDescription]]`)
  return res.status === 200 ? res.json() : undefined
}
const buildLog = async (job, n) => (await api(`/job/${job}/${n}/consoleText`)).text()
const lastBuildNumber = async (job) => (await (await api(`/job/${job}/api/json?tree=lastBuild[number]`)).json()).lastBuild?.number ?? 0

const peaks = { jnlp: 0 }
function sampleAgent() {
  try {
    for (const pod of kubectl("-n", "ci", "get", "pods", "-l", "jenkins/label", "-o", "name").trim().split("\n").filter(Boolean)) {
      peaks.jnlp = Math.max(peaks.jnlp, Number(kubectl("-n", "ci", "exec", pod, "-c", "jnlp", "--", "cat", "/sys/fs/cgroup/memory.peak").trim()))
    }
  } catch {
    // The pod comes and goes; a missed sample is fine.
  }
}

async function waitForBuild(job, n, minutes = 25) {
  const start = Date.now()
  const done = await until(
    `${job} #${n}`,
    async () => {
      sampleAgent()
      const b = await buildJson(job, n)
      return b && !b.building ? b : undefined
    },
    { minutes, every: 5000 },
  )
  const cause = done.actions.flatMap((a) => a.causes ?? []).map((c) => c.shortDescription).join(",")
  console.log(`   ${job} #${n}: ${done.result}, ${Math.round((Date.now() - start) / 1000)} s, cause: ${cause}, description: ${done.description ?? ""}`)
  return { ...done, cause }
}

async function failLog(job, n) {
  console.log((await buildLog(job, n)).split("\n").filter((l) => !/^\s+at /.test(l)).slice(-40).join("\n"))
}

// Polls now rather than waiting up to 5 minutes. One ship waits for the timer, to prove it.
async function forcePoll() {
  const res = await api(`/job/${DEPLOY}/polling`, await withCrumb())
  if (res.status >= 400) throw new Error(`polling: ${res.status}`)
}

const queued = async () => (await (await api(`/job/${DEPLOY}/api/json?tree=inQueue`)).json()).inQueue

async function nextBuild(previous, minutes = 7) {
  return until("the poll to start a build", async () => {
    const n = await lastBuildNumber(DEPLOY)
    return n > previous ? n : undefined
  }, { minutes, every: 3000 })
}

async function waitForApproval(n, minutes = 20) {
  const state = await until(`build #${n} to ask for approval`, async () => {
    sampleAgent()
    const log = await buildLog(DEPLOY, n)
    if (log.includes("to the VM?")) return "asking"
    const b = await buildJson(DEPLOY, n)
    return b && !b.building ? "ended" : undefined
  }, { minutes, every: 5000 })
  if (state === "ended") {
    await failLog(DEPLOY, n)
    throw new Error(`build #${n} ended without asking for approval`)
  }
}
const approve = async (n) => {
  const res = await api(`/job/${DEPLOY}/${n}/input/Deploy/proceedEmpty`, await withCrumb())
  if (res.status >= 400) throw new Error(`approve #${n}: ${res.status}`)
}
const reject = async (n) => {
  const res = await api(`/job/${DEPLOY}/${n}/input/Deploy/abort`, await withCrumb())
  if (res.status >= 400) throw new Error(`reject #${n}: ${res.status}`)
}

// ---- The stand-in VM, seen from outside the pipeline.
const vmExec = (...argv) => run("docker", ["exec", VM, ...argv])
const vmDeploy = (...argv) => vmExec("sh", `${COMPOSE}/vm-deploy.sh`, ...argv).trim()
const running = (service) => vmExec("docker", "inspect", "-f", "{{.Config.Image}}", `playground-prod-${service}-1`).trim()
const runningDigests = () => ["gateway", "api", "keycloak"].map((s) => running(s).split("@")[1])
const vmHealthy = () => ["gateway", "api", "keycloak", "redis", "postgres"].every((s) => vmExec("docker", "inspect", "-f", "{{.State.Health.Status}}", `playground-prod-${s}-1`).trim() === "healthy")
const history = () => vmDeploy("history")
const digestsOf = (log) => {
  const found = [...log.matchAll(/(gateway|api|keycloak): (sha256:[0-9a-f]{64}),/g)]
  return ["gateway", "api", "keycloak"].map((s) => found.find((m) => m[1] === s)?.[2])
}

// ---- Mail
async function mails() {
  const { messages } = await (await fetch(`${MAIL_API}/messages?limit=200`)).json()
  return messages.map((m) => m.Subject)
}
async function waitForMail(pattern) {
  return until(`a mail matching ${pattern}`, async () => (await mails()).find((s) => pattern.test(s)), { minutes: 2, every: 2000 })
}

// ---- Scratch commits and their images, as CI would publish them.
const SCRATCH_FILES = [
  ["deploy/k8s/jenkins/deploy.Jenkinsfile"],
  ["deploy/k8s/jenkins/rollback.Jenkinsfile"],
  ["deploy/k8s/jenkins/cd-gate.mjs"],
  ["deploy/k8s/jenkins/notify.sh"],
  ["deploy/k8s/jenkins/vm-ssh-config.sh"],
  ["deploy/compose/smoke-public.mjs"],
  ["deploy/compose/compose.prod.yml"],
  ["deploy/compose/smoke-access.sh"],
  ["infra/playground-realm.json"],
  ["infra/redis/redis.conf"],
  ["infra/redis/start.sh"],
  ["smoke.mjs"],
]
const scratchDir = path.join(WORK, "repo")
const git = (...argv) => run("git", ["-c", "user.name=drill", "-c", "user.email=drill@example.invalid", "-c", "core.autocrlf=false", "-C", scratchDir, ...argv])

// change: per file, an edit made in the scratch copy only. The working tree is never touched.
function pushScratchRepo(message, change = {}) {
  if (!fs.existsSync(path.join(scratchDir, ".git"))) {
    fs.mkdirSync(scratchDir, { recursive: true })
    run("git", ["init", "-q", "-b", "main", scratchDir])
  }
  for (const [file] of SCRATCH_FILES) {
    const target = path.join(scratchDir, file)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    const text = fs.readFileSync(path.join(REPO, file), "utf8").replace(/\r\n/g, "\n")
    fs.writeFileSync(target, change[file] ? change[file](text) : text)
  }
  fs.copyFileSync(path.join(WORK, "ca.pem"), path.join(scratchDir, "deploy/k8s/jenkins/drill-ca.pem"))
  fs.writeFileSync(path.join(scratchDir, "marker.txt"), `${message} ${Date.now()}\n`)
  git("add", "-A")
  git("commit", "-q", "-m", message)
  const sha = git("rev-parse", "HEAD").trim()
  // As a bundle through kubectl exec: a git:// push hangs through a port-forward.
  const bundle = path.join(WORK, "repo.bundle")
  git("bundle", "create", "-q", posix(bundle), "main")
  run("kubectl", ["-n", "drill", "exec", "-i", "git", "--", "sh", "-c", "cat > /tmp/repo.bundle && git -C /srv/playground.git fetch -q --force /tmp/repo.bundle main:main"], { input: fs.readFileSync(bundle) })
  // The raw files the VM fetches for this commit.
  run("docker", ["exec", FIXTURE, "mkdir", "-p", `/raw/${sha}`])
  const archive = execFileSync("git", ["-c", "core.autocrlf=false", "-C", scratchDir, "archive", "--format=tar", sha], { maxBuffer: 1 << 28, env: childEnv })
  run("docker", ["exec", "-i", FIXTURE, "tar", "-x", "-C", `/raw/${sha}`], { input: archive })
  return sha
}

let runCounter = Date.now() % 1000000
// lines: extra Dockerfile lines per image. labels and builder let a step forge provenance.
function publishImages(sha, runId, { lines = {}, revision = sha, source = `https://github.com/${REAL_REPO}` } = {}) {
  const context = path.join(WORK, "context")
  fs.mkdirSync(context, { recursive: true })
  for (const image of ["gateway", "api", "keycloak"]) {
    const dockerfile = [`FROM ghcr.io/vandatnguyen919/playground-${image}:sha-${REAL_SHA}`, `ENV DRILL_COMMIT=${sha}`, ...(lines[image] ?? [])].join("\n")
    run("docker", ["buildx", "build", "--builder", BUILDER, "--platform", "linux/amd64,linux/arm64", "--progress", "quiet",
      "--attest", `type=provenance,mode=max,version=v1,builder-id=https://github.com/${REAL_REPO}/actions/runs/${runId}/attempts/1`,
      "--label", `org.opencontainers.image.source=${source}`, "--label", `org.opencontainers.image.revision=${revision}`,
      "--push", "-t", `${REGISTRY_HOST}/playground-${image}:sha-${sha}`, "-f", "-", posix(context)], { input: dockerfile })
  }
}

async function setCi(sha, state) {
  const res = await fetch(`${FAKE_API}/state/${sha}`, { method: "POST", body: JSON.stringify(state) })
  if (!res.ok) throw new Error(`fake GitHub: ${res.status}`)
}

// A commit lands, the poll sees it, then CI runs and publishes. Returns the waiting build.
async function commitAndPublish(message, { lines, revision, source, change, ci = "success", timer = false } = {}) {
  // Let go of anything still open: a rerun may have left a build waiting for approval, and
  // a poll in the moment before a build's checkout queues the same commit twice.
  await until("earlier builds to end", async () => {
    const last = await lastBuildNumber(DEPLOY)
    if (!last || !(await buildJson(DEPLOY, last))?.building) return (await queued()) ? undefined : true
    if ((await buildLog(DEPLOY, last)).includes("to the VM?")) await reject(last)
    return undefined
  }, { minutes: 10, every: 3000 })
  const previous = await lastBuildNumber(DEPLOY)
  const sha = pushScratchRepo(message, change)
  const runId = ++runCounter
  await setCi(sha, { id: runId, status: "in_progress", conclusion: null })
  if (timer) console.log("   waiting for the timer poll (up to 5 min, H/5)")
  else await forcePoll()
  const n = await nextBuild(previous)
  console.log(`   ${message}: ${sha.slice(0, 12)}, build #${n}`)
  // CI finishes only once the gate is watching, so the wait itself is tested.
  await until(`build #${n} to wait for CI`, async () => (await buildLog(DEPLOY, n)).includes("waiting for CI"), { minutes: 6, every: 2000 })
  if (ci === "success") publishImages(sha, runId, { lines, revision, source })
  await setCi(sha, { id: runId, status: "completed", conclusion: ci })
  return { sha, n, runId }
}

function renderValues() {
  const hostKey = vmExec("cat", "/etc/ssh/ssh_host_ed25519_key.pub").trim().split(" ").slice(0, 2).join(" ")
  const file = path.join(WORK, "values-drill.yaml")
  fs.writeFileSync(file, fs.readFileSync(path.join(HERE, "values-drill.yaml"), "utf8").replace("value: __KNOWN_HOSTS__", () => `value: vm.drill.test ${hostKey}`))
  return file
}

function install() {
  const here = posix(path.relative(REPO, JENKINS))
  run("bash", [`${here}/install.sh`, `${here}/drill/overlay`, "-f", posix(renderValues())], {
    cwd: REPO,
    env: {
      ...childEnv,
      JENKINS_CLIENT_SECRET: stackEnv.JENKINS_CLIENT_SECRET,
      VM_DEPLOY_KEY_FILE: posix(path.join(WORK, "deploy-key")),
      NOTIFY_SMTP_USER: "drill-user",
      NOTIFY_SMTP_PASSWORD: notifyPassword(),
      NOTIFY_RECIPIENT: "drill@example.invalid",
    },
  })
}
const notifyPassword = () => crypto.createHash("sha256").update(`notify:${stackEnv.KC_CONFIG_CLIENT_SECRET}`).digest("hex").slice(0, 24)
const deployKey = () => fs.readFileSync(path.join(WORK, "deploy-key"), "utf8")
const keyBody = () => deployKey().split("\n").filter((l) => l && !l.startsWith("-----")).join("")

function controllerHealth() {
  const status = JSON.parse(kubectl("-n", "ci", "get", "pod", "jenkins-0", "-o", "json")).status.containerStatuses[0]
  const stat = kubectl("-n", "ci", "exec", "jenkins-0", "-c", "jenkins", "--", "sh", "-c", "cat /sys/fs/cgroup/memory.peak; grep -E '^anon ' /sys/fs/cgroup/memory.stat; grep -E '^oom_kill ' /sys/fs/cgroup/memory.events").trim().split("\n")
  return { restarts: status.restartCount, ready: status.ready, peak: Number(stat[0]), anon: Number(stat[1].split(" ")[1]), oomKills: Number(stat[2].split(" ")[1]) }
}
const waitForNoAgent = () => until("the agent to go", () => kubectl("-n", "ci", "get", "pods", "-l", "jenkins/label", "--no-headers").trim() === "", { minutes: 3 })
const mib = (b) => `${Math.round(b / 1048576)} MiB`

const keycloakIp = () => run("docker", ["inspect", "playground-prod-keycloak-1", "--format", '{{(index .NetworkSettings.Networks "playground-prod_edge").IPAddress}}']).trim()
const applyFixtures = () => run("kubectl", ["apply", "-f", "-"], { input: fs.readFileSync(path.join(HERE, "fixtures.yaml"), "utf8").replace("__KEYCLOAK_IP__", keycloakIp()).replaceAll("__SUBNET__", SUBNET) })

function ensureContainer(name, argv) {
  const status = run("docker", ["ps", "-a", "--filter", `name=^${name}$`, "--format", "{{.Status}}"]).trim()
  if (!status) return run("docker", ["run", "-d", "--name", name, "--network", NETWORK, ...argv])
  if (!status.startsWith("Up")) run("docker", ["start", name])
  return undefined
}

// ---- Steps

const stepsImpl = {
  async cluster() {
    say("Cluster: k3s, stand-in VM, registry, fake GitHub, Mailpit, users")
    const networks = run("docker", ["network", "ls", "--format", "{{.Name}}"]).split(/\r?\n/)
    if (!networks.includes(NETWORK)) run("docker", ["network", "create", "--subnet", `${SUBNET}.0/24`, NETWORK])

    // The registry's certificate.
    if (!fs.existsSync(path.join(WORK, "ca.pem"))) {
      const w = posix(WORK)
      run("openssl", ["req", "-x509", "-newkey", "ed25519", "-nodes", "-days", "3", "-subj", "/CN=drill-ca", "-keyout", `${w}/ca.key`, "-out", `${w}/ca.pem`])
      run("openssl", ["req", "-newkey", "ed25519", "-nodes", "-subj", "/CN=registry.drill.test", "-keyout", `${w}/registry.key`, "-out", `${w}/registry.csr`])
      fs.writeFileSync(path.join(WORK, "san.ext"), "subjectAltName=DNS:registry.drill.test\n")
      run("openssl", ["x509", "-req", "-days", "3", "-in", `${w}/registry.csr`, "-CA", `${w}/ca.pem`, "-CAkey", `${w}/ca.key`, "-CAcreateserial", "-extfile", `${w}/san.ext`, "-out", `${w}/registry.pem`])
      run("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-C", "jenkins-deploy-drill", "-f", `${w}/deploy-key`])
    }

    if (ensureContainer(REGISTRY, ["--ip", `${SUBNET}.11`, "--network-alias", "registry.drill.test", "-v", "jk-registry-data:/var/lib/registry", "-e", "REGISTRY_HTTP_TLS_CERTIFICATE=/certs/registry.pem", "-e", "REGISTRY_HTTP_TLS_KEY=/certs/registry.key", "--entrypoint", "sh", "registry:3.0.0", "-c", "until [ -f /certs/ready ]; do sleep 1; done; exec registry serve /etc/distribution/config.yml"])) {
      run("docker", ["exec", REGISTRY, "mkdir", "-p", "/certs"])
      for (const f of ["registry.pem", "registry.key"]) run("docker", ["cp", path.join(WORK, f), `${REGISTRY}:/certs/${f}`])
      run("docker", ["exec", REGISTRY, "touch", "/certs/ready"])
    }
    if (ensureContainer(FIXTURE, ["--ip", `${SUBNET}.12`, "--network-alias", "fake-github.drill.test", "-p", "127.0.0.1:18099:8080", "--entrypoint", "sh", "node:22.20.0-slim", "-c", "mkdir -p /raw; until [ -f /app.mjs.ready ]; do sleep 1; done; exec node /app.mjs"])) {
      run("docker", ["cp", path.join(HERE, "fake-github.mjs"), `${FIXTURE}:/app.mjs`])
      run("docker", ["exec", FIXTURE, "touch", "/app.mjs.ready"])
    }
    ensureContainer(MAILPIT, ["--ip", `${SUBNET}.13`, "--network-alias", "mailpit.drill.test", "-p", "127.0.0.1:18025:8025", "-e", "MP_SMTP_AUTH_ACCEPT_ANY=1", "-e", "MP_SMTP_AUTH_ALLOW_INSECURE=1", "axllent/mailpit:v1.29.6"])

    const builders = run("docker", ["buildx", "ls", "--format", "{{.Name}}"])
    if (!builders.split(/\r?\n/).includes(BUILDER)) {
      const toml = path.join(WORK, "buildkitd.toml")
      fs.writeFileSync(toml, `[registry."${REGISTRY_HOST}"]\n  insecure = true\n`)
      run("docker", ["buildx", "create", "--name", BUILDER, "--driver", "docker-container", "--driver-opt", `network=${NETWORK}`, "--buildkitd-config", posix(toml), "--bootstrap"])
    }

    const k3sStatus = run("docker", ["ps", "-a", "--filter", `name=^${CONTAINER}$`, "--format", "{{.Status}}"]).trim()
    if (!k3sStatus) {
      run("docker", ["run", "-d", "--name", CONTAINER, "--hostname", CONTAINER, "--privileged", "-p", "127.0.0.1:16443:6443", "-v", "jk-k3s-data:/var/lib/rancher/k3s", "--tmpfs", "/run", "--tmpfs", "/var/run", "--memory=3g", K3S_IMAGE, "server", "--disable=traefik", "--disable=servicelb", "--disable=metrics-server", "--tls-san=127.0.0.1", "--write-kubeconfig-mode=600"])
    } else if (!k3sStatus.startsWith("Up")) run("docker", ["start", CONTAINER])
    const attached = run("docker", ["inspect", CONTAINER, "--format", "{{json .NetworkSettings.Networks}}"])
    for (const net of ["playground-prod_edge", NETWORK]) if (!attached.includes(net)) run("docker", ["network", "connect", net, CONTAINER])
    const kubeconfig = await until("k3s kubeconfig", () => run("docker", ["exec", CONTAINER, "cat", "/etc/rancher/k3s/k3s.yaml"]), { minutes: 2, every: 2000 })
    fs.writeFileSync(KUBECONFIG, kubeconfig.replace("https://127.0.0.1:6443", "https://127.0.0.1:16443"))
    await until("the node", () => /\bReady\b/.test(kubectl("get", "nodes", "--no-headers")), { minutes: 3 })
    run("docker", ["exec", CONTAINER, "sh", "-c", "mkdir -p /var/lib/jk-drill-backups && chmod 777 /var/lib/jk-drill-backups"])
    // A brand new namespace has no default ServiceAccount for a moment.
    await until("the fixtures", () => applyFixtures(), { minutes: 1, every: 3000 })
    kubectl("-n", "kube-system", "rollout", "restart", "deployment/coredns")
    kubectl("-n", "kube-system", "rollout", "status", "deployment/coredns", "--timeout=2m")
    kubectl("-n", "drill", "wait", "pod/git", "--for=condition=Ready", "--timeout=5m")
    check("k3s version is the decided one", kubectl("get", "nodes", "-o", "jsonpath={.items[0].status.nodeInfo.kubeletVersion}") === "v1.36.5+k3s1")

    // The stand-in VM, running the first version the way a hand deploy left it.
    const vmUp = run("docker", ["ps", "-a", "--filter", `name=^${VM}$`, "--format", "{{.Status}}"]).trim()
    if (!vmUp) {
      run("docker", ["create", "--name", VM, "--network", NETWORK, "--ip", `${SUBNET}.10`, "--network-alias", "vm.drill.test", "--privileged", "--memory=3500m", "-e", "DOCKER_TLS_CERTDIR=", "-v", "jk-vm-docker:/var/lib/docker", "--entrypoint", "sh", "docker:29.1.5-dind", "/vm-start.sh"])
      fs.writeFileSync(path.join(WORK, "vm-start.sh"), fs.readFileSync(path.join(HERE, "vm-start.sh"), "utf8").replace(/\r\n/g, "\n"))
      run("docker", ["cp", path.join(WORK, "vm-start.sh"), `${VM}:/vm-start.sh`])
      run("docker", ["cp", path.join(WORK, "ca.pem"), `${VM}:/ca.pem`])
      run("docker", ["start", VM]).trim()
    } else if (!vmUp.startsWith("Up")) run("docker", ["start", VM])
    await until("the stand-in VM's Docker", () => vmExec("docker", "info", "--format", "{{.ServerVersion}}"), { minutes: 3, every: 2000 })
    await until("sshd", () => vmExec("sh", "-c", "pgrep sshd && test -f /etc/ssh/ssh_host_ed25519_key.pub"), { minutes: 2, every: 2000 })
    const tree = execFileSync("tar", ["--force-local", "-cf", "-", "-C", posix(REPO), "--exclude=.env", "deploy/compose/compose.prod.yml", "deploy/compose/smoke-access.sh", "deploy/compose/vm-env.sh", "deploy/compose/vm-deploy.sh", "deploy/compose/vm-ssh-gate.sh", "infra/playground-realm.json", "infra/redis/redis.conf", "infra/redis/start.sh"], { maxBuffer: 1 << 28, env: childEnv })
    vmExec("mkdir", "-p", "/srv/playground")
    run("docker", ["exec", "-i", VM, "tar", "-x", "-C", "/srv/playground", "--no-same-owner"], { input: tree })
    vmExec("sh", "-c", `sed -i 's/\\r$//' ${COMPOSE}/*.sh ${COMPOSE}/compose.prod.yml /srv/playground/infra/redis/*`)
    run("docker", ["exec", "-i", VM, "sh", "-c", `cat > ${COMPOSE}/vm-deploy.conf`], {
      input: `IMAGE_PREFIX=${REGISTRY_HOST}/playground-\nRAW_BASE=http://fake-github.drill.test:8080/raw\nHEALTH_TIMEOUT=240\n`,
    })

    if (!versions.v1) {
      const sha = pushScratchRepo("v1, running before Jenkins")
      const runId = ++runCounter
      console.log(`   publishing v1 (${sha.slice(0, 12)}): builds both platforms, slow the first time`)
      publishImages(sha, runId)
      await setCi(sha, { id: runId, status: "completed", conclusion: "success" })
      vmExec("sh", `${COMPOSE}/vm-env.sh`, "init", "app.drill.test", "auth.drill.test", "no-reply@drill.test", "drill@example.invalid", sha)
      vmExec("sh", "-c", `sed -i 's#ghcr.io/vandatnguyen919/#${REGISTRY_HOST}/#' ${COMPOSE}/.env; echo TLS_CERT_RESOLVER= >> ${COMPOSE}/.env`)
      console.log("   starting the stack on the stand-in VM: a few minutes")
      vmExec("sh", "-c", `cd ${COMPOSE} && docker compose -f compose.prod.yml pull -q && docker compose -f compose.prod.yml up -d --no-build`)
      remember("v1", { sha })
    }
    await until("the stack on the stand-in VM", () => vmHealthy(), { minutes: 10 })
    check("the stand-in VM runs the first version", vmExec("docker", "inspect", "-f", "{{.Config.Image}}", "playground-prod-gateway-1").includes(versions.v1.sha), running("gateway"))

    // The real command for putting the key in place.
    run("docker", ["exec", "-i", VM, "sh", `${COMPOSE}/vm-deploy.sh`, "add-deploy-key"], { input: fs.readFileSync(path.join(WORK, "deploy-key.pub"), "utf8") })
    await ensureUsers()
  },

  async install() {
    say("Install from the repo")
    install()
    await waitForController()
    const h = controllerHealth()
    check("controller is ready with no restarts", h.ready && h.restarts === 0, `restarts ${h.restarts}`)
    await startForward()
    // A new job's first poll builds the head commit, which here is already running.
    if ((await lastBuildNumber(DEPLOY)) === 0) {
      await forcePoll()
      const first = await nextBuild(0)
      await waitForApproval(first)
      await reject(first)
      await waitForBuild(DEPLOY, first, 5)
    }
  },

  async access() {
    say("Sign-in and exposure")
    await startForward()
    const anon = await fetch(`${URL_BASE}/`, { redirect: "manual" })
    check("anonymous gets nothing", anon.status === 403 || anon.status === 302, `${anon.status}`)
    const job = await fetch(`${URL_BASE}/job/${DEPLOY}/api/json`, { redirect: "manual" })
    check("anonymous cannot read the job", job.status === 403 || job.status === 404, `${job.status}`)

    const plain = await signIn(USERS.plain)
    check("a user without the role passes Keycloak", plain.done.hops.some((u) => u.startsWith(`${URL_BASE}/securityRealm/finishLogin`)))
    check("a user without the role is refused by Jenkins", plain.done.res.status === 403, `${plain.done.res.status}`)
    const plainApi = await plain.browser.request(`${URL_BASE}/api/json`)
    check("a user without the role cannot use the API", plainApi.status === 403, `${plainApi.status}`)
    const plainRollback = await plain.browser.request(`${URL_BASE}/job/${ROLLBACK}/build`, { method: "POST" })
    check("a user without the role cannot start a rollback", plainRollback.status === 403, `${plainRollback.status}`)

    const admin = await signIn(USERS.admin)
    adminBrowser = admin.browser
    check("the login form is the public Keycloak host", new URL(admin.form.url).host === "auth.localhost", admin.form.url.split("?")[0])
    check("the login request carries PKCE S256", admin.form.hops.some((u) => u.includes("code_challenge_method=S256")))
    const who = await (await api("/whoAmI/api/json")).json()
    check("the role holder signs in over OIDC", who.name === USERS.admin.username && who.authenticated, who.name)
    check("the role arrives as a group", (who.authorities ?? []).includes("jenkins-admin"), (who.authorities ?? []).join(","))

    const computer = await (await api("/computer/api/json?tree=totalExecutors")).json()
    check("the controller runs no builds", computer.totalExecutors === 0, `${computer.totalExecutors} executors`)

    const items = JSON.parse(kubectl("-n", "ci", "get", "svc,ingress", "-o", "json")).items
    check("nothing public: only a ClusterIP service, no Ingress", items.length === 1 && items[0].kind === "Service" && items[0].spec.type === "ClusterIP", items.map((i) => `${i.kind}/${i.metadata.name}`).join(","))
    check("the agent port is closed", !items[0].spec.ports.some((p) => p.port === 50000))

    const curl = (ns, pod) => kubectl("-n", ns, "exec", pod, "--", "sh", "-c", "curl -s -m 8 -o /dev/null -w '%{http_code}' http://jenkins.ci.svc.cluster.local:8080/login || echo blocked").trim()
    check("another namespace cannot reach Jenkins", /blocked|000/.test(curl("drill", "git")))
    const credentials = (await (await api("/manage/credentials/store/system/domain/_/api/json?depth=1&tree=credentials[id]")).json()).credentials.map((c) => c.id).sort()
    check("deploy credentials are in the credential store", credentials.join(",") === "notify-recipient,notify-smtp,vm-deploy-key", credentials.join(","))
  },

  async gate() {
    say("The deploy key on the VM: what it can and cannot do, over real ssh")
    vmExec("sh", "-c", "mkdir -p /tmp/k && chmod 700 /tmp/k")
    run("docker", ["exec", "-i", VM, "sh", "-c", "cat > /tmp/k/id && chmod 600 /tmp/k/id"], { input: deployKey() })
    const ssh = (extra, command) => {
      try {
        return { code: 0, out: vmExec("ssh", "-i", "/tmp/k/id", "-o", "IdentitiesOnly=yes", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=accept-new", "-o", "UserKnownHostsFile=/tmp/k/kh", ...extra, "playground@127.0.0.1", ...command) }
      } catch (e) {
        return { code: e.status, out: `${e.stdout}${e.stderr}` }
      }
    }
    check("the key can ask what is running", ssh([], ["current"]).code === 0)
    for (const attempt of [["id"], ["cat", `${COMPOSE}/.env`], ["sudo", "id"], ["sudo", "sh", `${COMPOSE}/vm-deploy.sh`, "add-deploy-key"], ["current;", "id"], ["sh", "-c", "id"]]) {
      const r = ssh([], attempt)
      check(`the key cannot run: ${attempt.join(" ")}`, r.code === 126 && r.out.includes("refused") && !/uid=/.test(r.out), `exit ${r.code}`)
    }
    const shell = ssh(["-T"], [])
    check("the key gets no shell", shell.code === 126 && shell.out.includes("refused"), `exit ${shell.code}`)
    const pty = ssh(["-tt"], [])
    check("the key gets no terminal", pty.code !== 0 && pty.out.includes("PTY allocation request failed"), `exit ${pty.code}`)
    const secret = vmExec("sh", "-c", `sed -n 's/^KC_DB_PASSWORD=//p' ${COMPOSE}/.env`).trim()
    check("the key's allowed output has no secrets", !ssh([], ["history"]).out.includes(secret))
    const envMode = vmExec("stat", "-c", "%a", `${COMPOSE}/.env`).trim()
    check(".env stays 0600", envMode === "600", envMode)

    // Tunnels: Keycloak's loopback port yes, anything else no.
    const tunnel = (dest) => {
      try {
        return vmExec("sh", "-c", `ssh -i /tmp/k/id -o IdentitiesOnly=yes -o BatchMode=yes -o UserKnownHostsFile=/tmp/k/kh -o ExitOnForwardFailure=yes -N -L 127.0.0.1:19000:${dest} playground@127.0.0.1 & pid=$!; sleep 2; curl -s -m 5 -o /dev/null -w '%{http_code}' http://127.0.0.1:19000/; kill $pid`).trim()
      } catch (e) {
        return `failed ${e.stderr}`
      }
    }
    const allowed = tunnel("127.0.0.1:8080")
    check("the key can tunnel to Keycloak's loopback port", /^[23][0-9][0-9]$/.test(allowed), allowed.slice(0, 40))
    const direct = vmExec("sh", "-c", "curl -s -m 5 -o /dev/null -w '%{http_code}' http://127.0.0.1:80/").trim()
    check("port 80 answers directly, so the next check can fail", /^[23][0-9][0-9]$/.test(direct), direct)
    const denied = tunnel("127.0.0.1:80")
    check("the key cannot tunnel anywhere else", denied === "000", denied.slice(0, 60))
    vmExec("rm", "-rf", "/tmp/k")
  },

  async "ship-good"() {
    say("Ship a good version: the poll finds it, CI and provenance pass, approval, deploy, smoke")
    await startForward()
    const before = vmDeploy("current")
    const v1Digests = running("gateway")
    await waitForNoAgent()
    const { sha, n } = await commitAndPublish("v2, good", { timer: true })
    await waitForApproval(n)
    let log = await buildLog(DEPLOY, n)
    check("the poll started it, on its timer", /SCM change/i.test((await buildJson(DEPLOY, n)).actions.flatMap((a) => a.causes ?? []).map((c) => c.shortDescription).join(",")))
    check("it waited for CI", /waiting for CI: run \d+ is in_progress/.test(log))
    check("it checked provenance for all three images", (log.match(/linux\/amd64 and linux\/arm64, repo and commit match, built by CI run \d+/g) ?? []).length === 3)
    check("it ran on the deploy agent", /Running on deploy-\S+ in \/home\/jenkins\/agent/.test(log))
    check("nothing is deployed before approval", running("gateway") === v1Digests && vmDeploy("current") === before)
    await until("the agent to go while waiting", () => kubectl("-n", "ci", "get", "pods", "-l", "jenkins/label", "--no-headers").trim() === "", { minutes: 3 })
    check("no agent pod is held while waiting for approval", true)
    check("a mail asks for approval", Boolean(await waitForMail(new RegExp(`Approve deploy of ${sha.slice(0, 12)}`))))

    await approve(n)
    const b = await waitForBuild(DEPLOY, n)
    if (b.result !== "SUCCESS") await failLog(DEPLOY, n)
    check("the deploy succeeded", b.result === "SUCCESS", b.result)
    log = await buildLog(DEPLOY, n)
    const digests = digestsOf(log)
    check("the VM runs exactly the digests that were checked", JSON.stringify(runningDigests()) === JSON.stringify(digests), digests[0].slice(0, 19))
    check("the images are pinned by digest, not tag", running("gateway").includes("@sha256:") && !running("gateway").includes(":sha-"), running("gateway"))
    check("the VM records it as current", vmDeploy("current") === sha)
    check("smoke really ran and passed", log.includes("SESSION is HttpOnly") && !/^FAIL/m.test(log))
    check("the deploy key is not in the log", !log.includes(keyBody()))
    check("a mail says it deployed", Boolean(await waitForMail(new RegExp(`Deployed ${sha.slice(0, 12)}`))))
    const envMode = vmExec("stat", "-c", "%a", `${COMPOSE}/.env`).trim()
    check(".env is still 0600 after a deploy", envMode === "600", envMode)
    check("the previous release was recorded, for rollback", history().includes(versions.v1.sha))
    remember("v2", { sha, digests })
    await until("the agent to go", () => kubectl("-n", "ci", "get", "pods", "-l", "jenkins/label", "--no-headers").trim() === "", { minutes: 3 })
    check("the agent pod is gone after the build", true)
  },

  async "ship-bad"() {
    say("Ship a version that is healthy but fails smoke: it must roll back by itself")
    await startForward()
    // Starts fine and passes its health check; only smoke sees the cookie lost HttpOnly.
    const { sha, n } = await commitAndPublish("v3, passes health, fails smoke", { lines: { gateway: ["ENV SERVER_REACTIVE_SESSION_COOKIE_HTTP_ONLY=false"] } })
    await waitForApproval(n)
    const beforeBad = runningDigests()
    check("the good version runs until approval", JSON.stringify(beforeBad) === JSON.stringify(versions.v2.digests))
    await approve(n)
    const b = await waitForBuild(DEPLOY, n)
    const log = await buildLog(DEPLOY, n)
    if (!/rolled back from/.test(log)) await failLog(DEPLOY, n)
    check("the build fails", b.result === "FAILURE", b.result)
    check("it really deployed the bad version first", log.includes(`${sha} is running and healthy`))
    check("smoke caught it", /FAIL.*SESSION is HttpOnly/.test(log), log.split("\n").find((l) => /FAIL.*SESSION/.test(l)) ?? "")
    check("it rolled back by itself", log.includes(`rolled back from ${sha} to ${versions.v2.sha}`))
    check("the VM runs the last good digests again", JSON.stringify(runningDigests()) === JSON.stringify(versions.v2.digests), running("gateway"))
    check("the VM records the good version as current", vmDeploy("current") === versions.v2.sha)
    check("smoke passed on the rolled back version", /rollback-verified/.test(history()) && vmHealthy())
    const good = history().split("events:")[0]
    check("the bad version never counted as good", !good.includes(sha))
    check("a mail says it rolled back", Boolean(await waitForMail(new RegExp(`Rolled back: ${sha.slice(0, 12)} failed, now running ${versions.v2.sha.slice(0, 12)}`))))
    remember("v3", { sha })
  },

  async rollback() {
    say("Manual rollback: ship another good version, then one click")
    await startForward()
    const { sha, n } = await commitAndPublish("v4, good")
    await waitForApproval(n)
    await approve(n)
    const b = await waitForBuild(DEPLOY, n)
    if (b.result !== "SUCCESS") await failLog(DEPLOY, n)
    check("v4 deployed", b.result === "SUCCESS" && vmDeploy("current") === sha, b.result)
    const v4 = runningDigests()
    await sleep(70_000) // The edge's sign-in limit, since smoke runs again straight away.

    const previous = await lastBuildNumber(ROLLBACK)
    const res = await api(`/job/${ROLLBACK}/build`, await withCrumb())
    check("one POST starts the rollback, with no parameters", res.status < 400, `${res.status}`)
    const r = await until("the rollback build", async () => {
      const m = await lastBuildNumber(ROLLBACK)
      return m > previous ? m : undefined
    }, { minutes: 3, every: 2000 })
    const done = await waitForBuild(ROLLBACK, r)
    if (done.result !== "SUCCESS") await failLog(ROLLBACK, r)
    check("the rollback job succeeded", done.result === "SUCCESS", done.result)
    check("v4 is no longer running", JSON.stringify(runningDigests()) !== JSON.stringify(v4))
    check("the VM runs the last good version", JSON.stringify(runningDigests()) === JSON.stringify(versions.v2.digests) && vmDeploy("current") === versions.v2.sha, running("gateway"))
    const log = await buildLog(ROLLBACK, r)
    check("it ran smoke afterwards", log.includes("SESSION is HttpOnly") && /rollback-verified/.test(log))
    check("the deploy key is not in the log", !log.includes(keyBody()))
    check("a mail says so", Boolean(await waitForMail(new RegExp(`Rolled back by hand to ${versions.v2.sha.slice(0, 12)}`))))
    check("v4 no longer counts as good, so another click goes further back", !history().split("events:")[0].includes(sha))
    remember("v4", { sha })
  },

  async stops() {
    say("Commits that must never reach approval, and a refused approval")
    await startForward()
    const before = JSON.stringify(runningDigests())
    const stopped = async (message, options, reason) => {
      const { sha, n } = await commitAndPublish(message, options)
      const b = await waitForBuild(DEPLOY, n, 15)
      const log = await buildLog(DEPLOY, n)
      check(`${message}: the build fails`, b.result === "FAILURE", b.result)
      check(`${message}: for the right reason`, reason.test(log), log.split("\n").find((l) => l.startsWith("STOP")) ?? "")
      check(`${message}: nobody is asked to approve`, !log.includes("to the VM?"))
      check(`${message}: nothing changed on the VM`, JSON.stringify(runningDigests()) === before)
      check(`${message}: a mail says it stopped`, Boolean(await waitForMail(new RegExp(`Not deployed: ${sha.slice(0, 12)}`))))
    }
    await stopped("CI failed", { ci: "failure" }, /STOP +CI concluded failure/)
    await stopped("images claim another commit", { revision: "f".repeat(40) }, /STOP +gateway linux\/amd64: built from commit f{40}/)
    await stopped("images claim another repo", { source: "https://github.com/someone/playaround" }, /STOP +gateway linux\/amd64: built from repo https:\/\/github\.com\/someone/)

    const { n } = await commitAndPublish("v5, approval refused")
    await waitForApproval(n)
    await reject(n)
    const b = await waitForBuild(DEPLOY, n, 5)
    check("a refused approval deploys nothing", b.result === "ABORTED" && JSON.stringify(runningDigests()) === before, b.result)

    // The VM cannot be reached: no rollback to attempt, and the mail must still go out.
    const down = await commitAndPublish("v5b, VM unreachable")
    await waitForApproval(down.n)
    vmExec("pkill", "sshd")
    try {
      await approve(down.n)
      const unreachable = await waitForBuild(DEPLOY, down.n, 8)
      check("an unreachable VM fails the build", unreachable.result === "FAILURE", unreachable.result)
      check("an unreachable VM still gets a mail", Boolean(await waitForMail(new RegExp(`Cannot reach the VM while deploying ${down.sha.slice(0, 12)}`))))
      check("an unreachable VM changes nothing", JSON.stringify(runningDigests()) === before)
    } finally {
      vmExec("/usr/sbin/sshd")
    }

    // A compose file that does not fit .env stops before anything running changes.
    const unfit = `      DRILL_REQUIRED: \${DRILL_NOT_IN_ENV:?set DRILL_NOT_IN_ENV}\n`
    const anchor = /^( +)REDIS_PASSWORD: \$\{REDIS_PASSWORD:\?set REDIS_PASSWORD\}\n/m
    const broken = await commitAndPublish("v5c, compose file needs a variable .env lacks", {
      change: { "deploy/compose/compose.prod.yml": (text) => text.replace(anchor, (line) => line + unfit) },
    })
    await waitForApproval(broken.n)
    await approve(broken.n)
    const unfitBuild = await waitForBuild(DEPLOY, broken.n, 10)
    const unfitLog = await buildLog(DEPLOY, broken.n)
    check("a compose file that does not fit .env fails the build", unfitBuild.result === "FAILURE" && /does not work with this \.env/.test(unfitLog), unfitBuild.result)
    check("it fails before anything changes", JSON.stringify(runningDigests()) === before && !/rolled back from/.test(unfitLog))
    check("a mail says nothing changed", Boolean(await waitForMail(new RegExp(`Not deployed: ${broken.sha.slice(0, 12)} failed before anything changed`))))
  },

  async "ship-crash"() {
    say("Ship a version that never gets healthy: it must roll back too")
    await startForward()
    const before = JSON.stringify(runningDigests())
    const { sha, n } = await commitAndPublish("v6, gateway crashes on start", { lines: { gateway: ['ENTRYPOINT ["sh", "-c", "exit 1"]'] } })
    await waitForApproval(n)
    await approve(n)
    const b = await waitForBuild(DEPLOY, n)
    const log = await buildLog(DEPLOY, n)
    if (!/rolled back from/.test(log)) await failLog(DEPLOY, n)
    check("the build fails", b.result === "FAILURE", b.result)
    check("the health wait caught it", /not healthy after|compose up failed/.test(log), log.split("\n").find((l) => /not healthy after|compose up failed/.test(l)) ?? "")
    check("it rolled back by itself", log.includes(`rolled back from ${sha} to ${versions.v2.sha}`))
    check("the VM runs the last good digests again", JSON.stringify(runningDigests()) === before && vmHealthy())
  },

  async "ship-final"() {
    say("A good version after all of that, so the recreate has a good commit at the head")
    await startForward()
    const { sha, n } = await commitAndPublish("v7, good")
    await waitForApproval(n)
    await approve(n)
    const b = await waitForBuild(DEPLOY, n)
    if (b.result !== "SUCCESS") await failLog(DEPLOY, n)
    check("v7 deployed", b.result === "SUCCESS" && vmDeploy("current") === sha, b.result)
    remember("v7", { sha })
    remember("lastDeployBuild", { number: n })
  },

  async history() {
    say("Deploy history")
    await startForward()
    const text = history()
    console.log(text.split("\n").map((l) => `   ${l}`).join("\n"))
    const events = text.split("events:")[1]
    check("the VM's log has the auto rollback", events.includes(`note\t${versions.v3.sha}\tdeploy-or-smoke-failed`) && /rollback\t\S+\thealthy\tdeploy-playground\//.test(events))
    check("the VM's log has the manual rollback", /rollback\t\S+\thealthy\trollback-playground\//.test(events))
    check("the VM's log has good deploys with who did it", events.includes(`mark-good\t${versions.v7.sha}\tgood\tdeploy-playground/`))
    const builds = (await (await api(`/job/${DEPLOY}/api/json?tree=builds[number,result,description]`)).json()).builds
    check("Jenkins keeps the builds, with what each shipped", builds.some((b) => /rolled back to/.test(b.description ?? "")) && builds.length >= 8, `${builds.length} builds`)
    const h = controllerHealth()
    console.log(`   memory: controller peak ${mib(h.peak)}, anon ${mib(h.anon)}, agent peak ${mib(peaks.jnlp)}`)
    check("the controller was never OOM killed", h.oomKills === 0 && h.restarts === 0, `oom ${h.oomKills}, restarts ${h.restarts}`)
    check("the controller's own memory stays under its limit", h.anon < 640 * 1048576, mib(h.anon))
    if (peaks.jnlp) check("the agent stays under its limit", peaks.jnlp < 384 * 1048576, mib(peaks.jnlp))
    const events2 = kubectl("-n", "ci", "get", "events", "--field-selector", "reason=OOMKilling", "--no-headers", "--ignore-not-found").trim()
    check("no OOM events in namespace ci", events2 === "", events2)
    const subjects = await mails()
    check("no mail carries a secret", !subjects.some((s) => s.includes(notifyPassword())))
  },

  async drift() {
    say("Drift: a change made in Jenkins does not survive a restart")
    await startForward()
    const before = await fingerprint()
    const res = await api("/scriptText", await withCrumb({ body: new URLSearchParams({ script: 'jenkins.model.Jenkins.get().setSystemMessage("drifted"); jenkins.model.Jenkins.get().save(); println("ok")' }).toString() }))
    check("the drift applied", res.status === 200 && (await res.text()).trim() === "ok")
    const drifted = await fingerprint()
    check("the export shows the drift (so this check can fail)", drifted.settings !== before.settings && drifted.settings.includes("drifted"))
    kubectl("-n", "ci", "delete", "pod", "jenkins-0")
    await waitForController()
    freshSession()
    compareFingerprints(before, await fingerprint(), "after a restart")
    fs.writeFileSync(FP_FILE, JSON.stringify(before))
  },

  async backup() {
    say("Backup")
    await startForward()
    const name = `drill-${Date.now()}`
    kubectl("-n", "ci", "create", "job", name, "--from=cronjob/jenkins-backup")
    kubectl("-n", "ci", "wait", `job/${name}`, "--for=condition=complete", "--timeout=5m")
    console.log(`   ${kubectl("-n", "ci", "logs", `job/${name}`, "-c", "archive").trim()}`)
    console.log(`   ${kubectl("-n", "ci", "logs", `job/${name}`, "-c", "upload").trim()}`)
    const file = run("docker", ["exec", CONTAINER, "sh", "-c", "ls -t /var/lib/jk-drill-backups | head -1"]).trim()
    const local = path.join(WORK, "jenkins-backup.tar.gz")
    fs.writeFileSync(local, execFileSync("docker", ["exec", CONTAINER, "cat", `/var/lib/jk-drill-backups/${file}`], { maxBuffer: 1 << 28 }))
    const entries = run("tar", ["-tzf", posix(local), "--force-local"]).trim().split("\n")
    const { number } = versions.lastDeployBuild
    check("the backup has the build history", entries.includes(`jobs/${DEPLOY}/builds/${number}/build.xml`) && entries.includes(`jobs/${DEPLOY}/nextBuildNumber`), `${entries.length} entries`)
    check("the backup has no keys or credentials", !entries.some((e) => /secret|credentials\.xml|identity\.key|^users\//.test(e)))
    // The bytes too: nothing the credentials could leak through.
    const raw = run("tar", ["-xzOf", posix(local), "--force-local"])
    check("the deploy key is nowhere in it", !raw.includes(keyBody()))
    check("the SMTP password is nowhere in it", !raw.includes(notifyPassword()))
    check("the client secret is nowhere in it", !raw.includes(stackEnv.JENKINS_CLIENT_SECRET))
    fs.writeFileSync(path.join(WORK, "history.json"), JSON.stringify({ number, log: await buildLog(DEPLOY, number) }))
    kubectl("-n", "ci", "delete", "job", name)
  },

  async recreate() {
    say("Delete the controller and everything around it, then recreate from the repo")
    const before = JSON.parse(fs.readFileSync(FP_FILE, "utf8"))
    stopForward()
    run("helm", ["uninstall", "jenkins", "-n", "ci", "--wait"])
    kubectl("delete", "namespace", "ci", "--wait=true", "--timeout=5m")
    kubectl("delete", "priorityclass", "ci")
    const pvs = kubectl("get", "pv", "--no-headers", "--ignore-not-found").trim()
    check("JENKINS_HOME is gone", !/jenkins/.test(pvs), pvs || "no volumes left")
    check("namespace ci is gone", !kubectl("get", "ns", "--no-headers").includes("ci "))

    const started = Date.now()
    install()
    await waitForController()
    console.log(`   recreated in ${Math.round((Date.now() - started) / 1000)} s`)
    freshSession()

    console.log("   waiting for the poll to find the head commit (up to 5 min, H/5)")
    await until("the first poll after the recreate", () => buildJson(DEPLOY, 1), { minutes: 7 })
    await waitForApproval(1)
    await approve(1)
    const b = await waitForBuild(DEPLOY, 1)
    if (b.result !== "SUCCESS") await failLog(DEPLOY, 1)
    check("the recreated controller deploys with the key from its store", b.result === "SUCCESS", b.result)
    check("the recreated job really ran on an agent", /Running on deploy-/.test(await buildLog(DEPLOY, 1)))
    check("the VM's history outlived the controller", history().includes(versions.v3.sha) && vmDeploy("current") === versions.v7.sha)
    const h = controllerHealth()
    check("the recreated controller stayed within limits", h.oomKills === 0 && h.restarts === 0, `own memory ${mib(h.anon)}`)

    // After that deploy: a running agent shows in the export, and is not a setting.
    await until("the agent to go", () => kubectl("-n", "ci", "get", "pods", "-l", "jenkins/label", "--no-headers").trim() === "", { minutes: 3 })
    const after = await until("the agent to leave the export", async () => {
      const fp = await fingerprint()
      return fp.settings.includes('name: "deploy-') ? undefined : fp
    }, { minutes: 3 })
    compareFingerprints(before, after, "after a recreate")
  },

  async restore() {
    say("Restore the backed-up history onto the recreated controller")
    const { number, log } = JSON.parse(fs.readFileSync(path.join(WORK, "history.json"), "utf8"))
    const before = JSON.parse(fs.readFileSync(FP_FILE, "utf8"))
    stopForward()
    run("bash", [posix(path.join(JENKINS, "restore.sh")), posix(path.join(WORK, "jenkins-backup.tar.gz"))])
    await startForward()
    freshSession()
    const restored = await buildLog(DEPLOY, number)
    const stripVolatile = (s) => s.replace(/\r\n/g, "\n")
    check("the old build is back with its log", stripVolatile(restored) === stripVolatile(log), `build #${number}, ${restored.length} bytes`)
    compareFingerprints(before, await fingerprint(), "after a restore")
    const next = await (await api(`/job/${DEPLOY}/api/json?tree=nextBuildNumber`)).json()
    check("build numbers continue", next.nextBuildNumber > number, `next ${next.nextBuildNumber}`)
  },

  async "keycloak-down"() {
    say("Keycloak down: Jenkins does not fall over, and login fails closed")
    run("kubectl", ["-n", "playground", "delete", "endpointslice", "keycloak-compose"])
    kubectl("-n", "ci", "delete", "pod", "jenkins-0")
    stopForward()
    let ok = false
    try {
      await waitForController()
      ok = true
    } catch (e) {
      console.log(`   ${e.message}`)
    }
    const h = ok ? controllerHealth() : { restarts: "n/a" }
    if (ok) {
      const res = await fetch(`${URL_BASE}/`, { redirect: "manual" })
      check("the controller starts without Keycloak", h.ready && h.restarts === 0, `restarts ${h.restarts}`)
      check("nobody gets in while Keycloak is down", res.status !== 200, `${res.status}`)
    }
    applyFixtures()
    check("the controller starts without Keycloak", ok)
    const who = await until(
      "sign-in after Keycloak returns",
      async () => {
        freshSession()
        return (await (await api("/whoAmI/api/json")).json()).authenticated
      },
      { minutes: 5, every: 15000 },
    )
    check("sign-in works again once Keycloak is back, with no restart", who && controllerHealth().restarts === 0)
  },

  async clean() {
    say("Remove everything the drill made")
    const kc = await keycloakAdmin()
    for (const user of Object.values(USERS)) {
      const [existing] = await (await kc(`/users?exact=true&username=${encodeURIComponent(user.username)}`)).json()
      if (existing) await kc(`/users/${existing.id}`, { method: "DELETE" })
    }
    for (const name of [CONTAINER, VM, FIXTURE, REGISTRY, MAILPIT]) run("docker", ["rm", "-f", name])
    try {
      run("docker", ["buildx", "rm", BUILDER])
    } catch {
      // Already gone.
    }
    for (const volume of ["jk-k3s-data", "jk-vm-docker", "jk-registry-data"]) {
      try {
        run("docker", ["volume", "rm", volume])
      } catch {
        // Already gone.
      }
    }
    run("docker", ["network", "rm", NETWORK])
    fs.rmSync(WORK, { recursive: true, force: true })
  },
}

// Throwaway users on the local stack, through the admin API over its loopback port.
async function keycloakAdmin() {
  const tokenRes = await fetch(`${KC_ADMIN}/realms/master/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: stackEnv.KC_CONFIG_CLIENT_ID, client_secret: stackEnv.KC_CONFIG_CLIENT_SECRET }),
  })
  const { access_token } = await tokenRes.json()
  return (p, init = {}) => fetch(`${KC_ADMIN}/admin/realms/playground${p}`, { ...init, headers: { authorization: `Bearer ${access_token}`, "content-type": "application/json", ...init.headers } })
}

async function ensureUsers() {
  const kc = await keycloakAdmin()
  for (const user of Object.values(USERS)) {
    let [existing] = await (await kc(`/users?exact=true&username=${encodeURIComponent(user.username)}`)).json()
    if (!existing) {
      const res = await kc("/users", {
        method: "POST",
        body: JSON.stringify({ username: user.username, email: user.username, enabled: true, emailVerified: true, attributes: { fullName: ["Drill Jenkins"] }, credentials: [{ type: "password", value: user.password, temporary: false }] }),
      })
      if (res.status !== 201) throw new Error(`create user: ${res.status} ${await res.text()}`)
      ;[existing] = await (await kc(`/users?exact=true&username=${encodeURIComponent(user.username)}`)).json()
    }
    for (const role of user.roles) {
      const rep = await (await kc(`/roles/${role}`)).json()
      await kc(`/users/${existing.id}/role-mappings/realm`, { method: "POST", body: JSON.stringify([rep]) })
    }
  }
}

// Passwords come from the stack's own secret, so a later step can sign in alone.
for (const user of Object.values(USERS)) {
  user.password = crypto.createHash("sha256").update(`${stackEnv.KC_CONFIG_CLIENT_SECRET}:${user.username}`).digest("hex").slice(0, 24)
}

const order = ["cluster", "install", "access", "gate", "ship-good", "ship-bad", "rollback", "stops", "ship-crash", "ship-final", "history", "drift", "backup", "recreate", "restore", "keycloak-down"]
try {
  for (const step of steps.length ? steps : order) {
    if (!stepsImpl[step]) throw new Error(`Unknown step ${step}`)
    await stepsImpl[step]()
  }
  console.log(`\nAll ${passed} checks passed.`)
} catch (e) {
  console.error(`\n${e.message}\n${passed} checks passed before this.`)
  process.exitCode = 1
} finally {
  stopForward()
}
