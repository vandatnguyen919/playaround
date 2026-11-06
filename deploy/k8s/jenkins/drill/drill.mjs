#!/usr/bin/env node
// Jenkins recreate drill, on a throwaway k3s in Docker (same version as PRODUCT.md)
// and the local compose.prod.yml stack's Keycloak. Touches nothing on Azure and
// pushes nothing to GitHub. Needs: Docker, kubectl, helm, git, and that stack running
// with the jenkins client (README.md, "Local prod stack").
//
//   node deploy/k8s/jenkins/drill/drill.mjs --env-file <local stack env> [step...]
//
// Steps, in order: cluster install access deploy drift backup recreate restore
// keycloak-down. No step named runs them all. "clean" removes the k3s container.
// Exits nonzero on the first failed check.
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
const WORK = path.join(process.env.DRILL_DIR ?? os.tmpdir(), "jenkins-drill")
fs.mkdirSync(WORK, { recursive: true })
const KUBECONFIG = path.join(WORK, "kubeconfig")
const URL_BASE = "http://localhost:8090"
const JOB = "deploy-playground"
const PIN = "sha-8721ca747da7fcc9a42bfa9630ae041742612a31"
const USERS = {
  admin: { username: "drill-jenkins-admin@example.com", roles: ["jenkins-admin"] },
  plain: { username: "drill-jenkins-plain@example.com", roles: [] },
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
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex").slice(0, 16)

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

// ---- Port-forward, the same way a tunnel reaches Jenkins on the VM.
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
  const res = await adminBrowser.request(`${URL_BASE}${pathname}`, init)
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
  check(`${label}: same settings (JCasC export)`, a.settings === b.settings, `${b.settings.split("\n").length} lines, sha ${sha(b.settings)}`)
  check(`${label}: same jobs`, JSON.stringify(a.jobs) === JSON.stringify(b.jobs), b.jobs.join(","))
  check(`${label}: same job config`, JSON.stringify(a.jobConfigs) === JSON.stringify(b.jobConfigs), `sha ${sha(JSON.stringify(b.jobConfigs))}`)
  check(`${label}: same credential ids`, JSON.stringify(a.credentials) === JSON.stringify(b.credentials), b.credentials.map((c) => c.split("|")[0]).join(","))
}

async function buildJson(n) {
  const res = await api(`/job/${JOB}/${n}/api/json?tree=number,result,building,actions[causes[shortDescription]]`)
  return res.status === 200 ? res.json() : undefined
}
const buildLog = async (n) => (await api(`/job/${JOB}/${n}/consoleText`)).text()
async function waitForBuild(n, minutes = 12) {
  const start = Date.now()
  const peaks = {}
  const done = await until(
    `build #${n}`,
    async () => {
      // Memory of the agent pod while it exists.
      try {
        const pods = kubectl("-n", "ci", "get", "pods", "-l", "jenkins/label", "-o", "name").trim().split("\n").filter(Boolean)
        for (const pod of pods) {
          for (const c of ["jnlp", "helm"]) {
            const value = Number(kubectl("-n", "ci", "exec", pod, "-c", c, "--", "cat", "/sys/fs/cgroup/memory.peak").trim())
            peaks[c] = Math.max(peaks[c] ?? 0, value)
          }
        }
      } catch {
        // The pod comes and goes; a missed sample is fine.
      }
      const b = await buildJson(n)
      return b && !b.building ? b : undefined
    },
    { minutes, every: 4000 },
  )
  if (done.result !== "SUCCESS") console.log((await buildLog(n)).split("\n").filter((l) => !/^\s+at /.test(l)).slice(-25).join("\n"))
  const cause = done.actions.flatMap((a) => a.causes ?? []).map((c) => c.shortDescription).join(",")
  console.log(`   build #${n}: ${done.result}, ${Math.round((Date.now() - start) / 1000)} s after first seen waiting, cause: ${cause}`)
  return { ...done, cause, peaks }
}
const deployedTag = () => kubectl("-n", "playground", "get", "configmap", "deployed", "-o", "jsonpath={.data.imageTag}").trim()

function controllerHealth() {
  const status = JSON.parse(kubectl("-n", "ci", "get", "pod", "jenkins-0", "-o", "json")).status.containerStatuses[0]
  const stat = kubectl("-n", "ci", "exec", "jenkins-0", "-c", "jenkins", "--", "sh", "-c", "cat /sys/fs/cgroup/memory.peak; grep -E '^anon ' /sys/fs/cgroup/memory.stat; grep -E '^oom_kill ' /sys/fs/cgroup/memory.events").trim().split("\n")
  return { restarts: status.restartCount, ready: status.ready, peak: Number(stat[0]), anon: Number(stat[1].split(" ")[1]), oomKills: Number(stat[2].split(" ")[1]) }
}
const mib = (b) => `${Math.round(b / 1048576)} MiB`

// ---- Steps

const stepsImpl = {
  async cluster() {
    say("Cluster: k3s in Docker, Keycloak service, scratch git repo, users")
    const running = run("docker", ["ps", "-a", "--filter", `name=^${CONTAINER}$`, "--format", "{{.Status}}"]).trim()
    if (!running) {
      run("docker", ["run", "-d", "--name", CONTAINER, "--hostname", CONTAINER, "--privileged", "-p", "127.0.0.1:16443:6443", "-v", "jk-k3s-data:/var/lib/rancher/k3s", "--tmpfs", "/run", "--tmpfs", "/var/run", "--memory=5g", K3S_IMAGE, "server", "--disable=traefik", "--disable=servicelb", "--disable=metrics-server", "--tls-san=127.0.0.1", "--write-kubeconfig-mode=600"])
    } else if (!running.startsWith("Up")) run("docker", ["start", CONTAINER])
    const networks = run("docker", ["inspect", CONTAINER, "--format", "{{json .NetworkSettings.Networks}}"])
    if (!networks.includes("playground-prod_edge")) run("docker", ["network", "connect", "playground-prod_edge", CONTAINER])
    const kubeconfig = await until("k3s kubeconfig", () => run("docker", ["exec", CONTAINER, "cat", "/etc/rancher/k3s/k3s.yaml"]), { minutes: 2, every: 2000 })
    fs.writeFileSync(KUBECONFIG, kubeconfig.replace("https://127.0.0.1:6443", "https://127.0.0.1:16443"))
    await until("the node", () => /\bReady\b/.test(kubectl("get", "nodes", "--no-headers")), { minutes: 3 })
    run("docker", ["exec", CONTAINER, "sh", "-c", "mkdir -p /var/lib/jk-drill-backups && chmod 777 /var/lib/jk-drill-backups"])

    const ip = run("docker", ["inspect", "playground-prod-keycloak-1", "--format", '{{(index .NetworkSettings.Networks "playground-prod_edge").IPAddress}}']).trim()
    // A brand new namespace has no default ServiceAccount for a moment.
    await until("the fixtures", () => run("kubectl", ["apply", "-f", "-"], { input: fs.readFileSync(path.join(HERE, "fixtures.yaml"), "utf8").replace("__KEYCLOAK_IP__", ip) }), { minutes: 1, every: 3000 })
    kubectl("-n", "drill", "wait", "pod/git", "--for=condition=Ready", "--timeout=5m")

    await pushScratchRepo("first commit")
    await ensureUsers()
    check("k3s version is the decided one", kubectl("get", "nodes", "-o", "jsonpath={.items[0].status.nodeInfo.kubeletVersion}") === "v1.36.5+k3s1")
  },

  async install() {
    say("Install from the repo")
    install()
    await waitForController()
    const h = controllerHealth()
    check("controller is ready with no restarts", h.ready && h.restarts === 0, `restarts ${h.restarts}`)
  },

  async access() {
    say("Sign-in and exposure")
    await startForward()
    const anon = await fetch(`${URL_BASE}/`, { redirect: "manual" })
    check("anonymous gets nothing", anon.status === 403 || anon.status === 302, `${anon.status}`)
    const job = await fetch(`${URL_BASE}/job/${JOB}/api/json`, { redirect: "manual" })
    check("anonymous cannot read the job", job.status === 403 || job.status === 404, `${job.status}`)

    const plain = await signIn(USERS.plain)
    check("a user without the role passes Keycloak", plain.done.hops.some((u) => u.startsWith(`${URL_BASE}/securityRealm/finishLogin`)))
    check("a user without the role is refused by Jenkins", plain.done.res.status === 403, `${plain.done.res.status}`)
    const plainApi = await plain.browser.request(`${URL_BASE}/api/json`)
    check("a user without the role cannot use the API", plainApi.status === 403, `${plainApi.status}`)

    const admin = await signIn(USERS.admin)
    adminBrowser = admin.browser
    check("the login form is the public Keycloak host", new URL(admin.form.url).host === "auth.localhost", admin.form.url.split("?")[0])
    check("the login request carries PKCE S256", admin.form.hops.some((u) => u.includes("code_challenge_method=S256")))
    const who = await (await api("/whoAmI/api/json")).json()
    check("the role holder signs in over OIDC", who.name === USERS.admin.username && who.authenticated, who.name)
    check("the role arrives as a group", (who.authorities ?? []).includes("jenkins-admin"), (who.authorities ?? []).join(","))
    const me = await (await api(`/me/api/json?tree=fullName`)).json()
    check("the full name comes from Keycloak", me.fullName === "Drill Jenkins", me.fullName)

    const computer = await (await api("/computer/api/json?tree=totalExecutors")).json()
    check("the controller runs no builds", computer.totalExecutors === 0, `${computer.totalExecutors} executors`)

    const ci = kubectl("-n", "ci", "get", "svc,ingress", "-o", "json")
    const items = JSON.parse(ci).items
    check("nothing public: only a ClusterIP service, no Ingress", items.length === 1 && items[0].kind === "Service" && items[0].spec.type === "ClusterIP", items.map((i) => `${i.kind}/${i.metadata.name}`).join(","))
    check("the agent port is closed", !items[0].spec.ports.some((p) => p.port === 50000))

    // A pod outside ci, then one inside: the policy's own negative and positive case.
    const curl = (ns, pod) => {
      const cmd = "curl -s -m 8 -o /dev/null -w '%{http_code}' http://jenkins.ci.svc.cluster.local:8080/login || echo blocked"
      return kubectl("-n", ns, "exec", pod, "--", "sh", "-c", cmd).trim()
    }
    const probe = (ns) => {
      if (ns === "drill") return curl("drill", "git")
      kubectl("-n", ns, "run", "probe", "--restart=Never", "--image=jenkins/jenkins:2.580.1-lts-jdk25", "--command", "--", "sleep", "300")
      kubectl("-n", ns, "wait", "pod/probe", "--for=condition=Ready", "--timeout=2m")
      try {
        return curl(ns, "probe")
      } finally {
        kubectl("-n", ns, "delete", "pod", "probe", "--wait=false")
      }
    }
    check("another namespace cannot reach Jenkins", /blocked|000/.test(probe("drill")))
    check("namespace ci can reach Jenkins", probe("ci").includes("200"))

    const can = (verb, resource, ns) => kubectl("auth", "can-i", verb, resource, "-n", ns, "--as=system:serviceaccount:ci:jenkins-deploy").trim()
    const canNot = (verb, resource, ns) => {
      try {
        return can(verb, resource, ns) === "no"
      } catch (e) {
        return e.stdout?.trim() === "no"
      }
    }
    check("the deploy token can deploy in playground", can("update", "deployments.apps", "playground") === "yes")
    check("the deploy token cannot touch ci", canNot("get", "secrets", "ci"))
    check("the deploy token has nothing cluster wide", canNot("list", "nodes", "default") && canNot("list", "secrets", "kube-system"))
    check("the deploy token cannot grant itself rights", canNot("create", "rolebindings.rbac.authorization.k8s.io", "playground"))
  },

  async deploy() {
    say("Deploy: the poll finds a commit, a deploy-only agent ships it")
    await startForward()
    const job = await (await api(`/job/${JOB}/api/json?tree=lastBuild[number]`)).json()
    // The poll may have got there first. A fresh install has at most build #1.
    const first = job.lastBuild?.number ?? 1
    console.log(`   waiting for build #${first} from the poll (up to 5 min, H/5)`)
    await until("the first poll", () => buildJson(first), { minutes: 7 })
    const b1 = await waitForBuild(first)
    check("the poll started a deploy", /SCM change/i.test(b1.cause), b1.cause)
    check("the first deploy succeeded", b1.result === "SUCCESS", b1.result)
    check("the fixture chart got the pinned tag", deployedTag() === PIN, deployedTag())
    const log = await buildLog(first)
    check("it ran on the deploy agent, not the controller", /Running on deploy-\S+ in \/home\/jenkins\/agent/.test(log))
    check("it really checked GHCR", log.includes(`all images published as ${PIN}`))
    check("the token is masked in the log", !log.includes(kubectl("-n", "ci", "get", "secret", "jenkins-deploy-token", "-o", "jsonpath={.data.token}")) && !log.includes(decodedToken()))

    const pods = await until("the agent pod to go", () => kubectl("-n", "ci", "get", "pods", "-l", "jenkins/label", "--no-headers").trim() === "", { minutes: 3 })
    check("the agent pod is gone after the build", pods)

    await pushScratchRepo("second commit")
    console.log(`   pushed a commit; waiting for build #${first + 1} from the poll (up to 5 min, H/5)`)
    await until("the next poll", () => buildJson(first + 1), { minutes: 7 })
    const b2 = await waitForBuild(first + 1)
    check("a new commit is deployed with no webhook", b2.result === "SUCCESS" && /SCM change/i.test(b2.cause), `${b2.result}, ${b2.cause}`)

    const budget = 640 + 256 + 128
    const h = controllerHealth()
    console.log(`   memory: controller peak ${mib(h.peak)}, anon ${mib(h.anon)}, agent jnlp ${b2.peaks.jnlp ? mib(b2.peaks.jnlp) : "not sampled"}, helm ${b2.peaks.helm ? mib(b2.peaks.helm) : "not sampled"}`)
    check("limits add up to the 1.0 GB budget", budget === 1024, `${budget} Mi`)
    check("the controller was never OOM killed", h.oomKills === 0 && h.restarts === 0, `oom ${h.oomKills}, restarts ${h.restarts}`)
    // Not the peak: page cache fills any limit and is given back on demand.
    check("the controller's own memory stays under its limit", h.anon < 640 * 1048576, mib(h.anon))
    const events = kubectl("-n", "ci", "get", "events", "--field-selector", "reason=OOMKilling", "--no-headers", "--ignore-not-found").trim()
    check("no OOM events in namespace ci", events === "", events)
    fs.writeFileSync(path.join(WORK, "lastbuild.json"), JSON.stringify({ number: first + 1 }))
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
    const entries = run("tar", ["-tzf", local.replace(/\\/g, "/"), "--force-local"]).trim().split("\n")
    const { number } = JSON.parse(fs.readFileSync(path.join(WORK, "lastbuild.json"), "utf8"))
    check("the backup has the build history", entries.includes(`jobs/${JOB}/builds/${number}/build.xml`) && entries.includes(`jobs/${JOB}/nextBuildNumber`), `${entries.length} entries`)
    check("the backup has no keys or credentials", !entries.some((e) => /secret|credentials\.xml|identity\.key|^users\//.test(e)))
    // The bytes too: nothing the deploy token or client secret could leak through.
    const raw = run("tar", ["-xzOf", local.replace(/\\/g, "/"), "--force-local"])
    check("the deploy token is nowhere in it", !raw.includes(decodedToken()))
    check("the client secret is nowhere in it", !raw.includes(stackEnv.JENKINS_CLIENT_SECRET))
    fs.writeFileSync(path.join(WORK, "history.json"), JSON.stringify({ number, log: await buildLog(number) }))
    kubectl("-n", "ci", "delete", "job", name)
  },

  async recreate() {
    say("Delete the controller and everything around it, then recreate from the repo")
    const before = JSON.parse(fs.readFileSync(FP_FILE, "utf8"))
    const oldToken = decodedToken()
    stopForward()
    run("helm", ["uninstall", "jenkins", "-n", "ci", "--wait"])
    kubectl("delete", "namespace", "ci", "--wait=true", "--timeout=5m")
    kubectl("delete", "priorityclass", "ci")
    kubectl("delete", "namespace", "playground", "--wait=true", "--timeout=5m")
    const pvs = kubectl("get", "pv", "--no-headers", "--ignore-not-found").trim()
    check("JENKINS_HOME is gone", !/jenkins/.test(pvs), pvs || "no volumes left")
    check("namespace ci is gone", !kubectl("get", "ns", "--no-headers").includes("ci "))
    const ip = run("docker", ["inspect", "playground-prod-keycloak-1", "--format", '{{(index .NetworkSettings.Networks "playground-prod_edge").IPAddress}}']).trim()
    run("kubectl", ["apply", "-f", "-"], { input: fs.readFileSync(path.join(HERE, "fixtures.yaml"), "utf8").replace("__KEYCLOAK_IP__", ip) })

    const started = Date.now()
    install()
    await waitForController()
    console.log(`   recreated in ${Math.round((Date.now() - started) / 1000)} s`)
    freshSession()
    check("the deploy token was rotated", decodedToken() !== oldToken)

    console.log("   waiting for the poll to redeploy (up to 5 min, H/5)")
    await until("the first poll after the recreate", () => buildJson(1), { minutes: 7 })
    const b = await waitForBuild(1)
    check("the recreated controller deploys with the new token", b.result === "SUCCESS", b.result)
    check("the recreated job really ran on an agent", /Running on deploy-/.test(await buildLog(1)))
    check("the deploy landed", deployedTag() === PIN, deployedTag())
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
    run("bash", [path.join(JENKINS, "restore.sh").replace(/\\/g, "/"), path.join(WORK, "jenkins-backup.tar.gz").replace(/\\/g, "/")])
    await startForward()
    freshSession()
    const restored = await buildLog(number)
    const stripVolatile = (s) => s.replace(/\r\n/g, "\n")
    check("the old build is back with its log", stripVolatile(restored) === stripVolatile(log), `build #${number}, ${restored.length} bytes`)
    compareFingerprints(before, await fingerprint(), "after a restore")
    const next = await (await api(`/job/${JOB}/api/json?tree=nextBuildNumber`)).json()
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
    const ip = run("docker", ["inspect", "playground-prod-keycloak-1", "--format", '{{(index .NetworkSettings.Networks "playground-prod_edge").IPAddress}}']).trim()
    if (ok) {
      const res = await fetch(`${URL_BASE}/`, { redirect: "manual" })
      check("the controller starts without Keycloak", h.ready && h.restarts === 0, `restarts ${h.restarts}`)
      check("nobody gets in while Keycloak is down", res.status !== 200, `${res.status}`)
    }
    run("kubectl", ["apply", "-f", "-"], { input: fs.readFileSync(path.join(HERE, "fixtures.yaml"), "utf8").replace("__KEYCLOAK_IP__", ip) })
    check("the controller starts without Keycloak", ok)
    freshSession()
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
    say("Remove the k3s container and the drill's users")
    const kc = await keycloakAdmin()
    for (const user of Object.values(USERS)) {
      const [existing] = await (await kc(`/users?exact=true&username=${encodeURIComponent(user.username)}`)).json()
      if (existing) await kc(`/users/${existing.id}`, { method: "DELETE" })
    }
    run("docker", ["rm", "-f", CONTAINER])
    run("docker", ["volume", "rm", "jk-k3s-data"])
    fs.rmSync(WORK, { recursive: true, force: true })
  },
}

function install() {
  const here = path.relative(REPO, JENKINS).replace(/\\/g, "/")
  run("bash", [`${here}/install.sh`, `${here}/drill/overlay`, "-f", `${here}/drill/values-drill.yaml`], {
    cwd: REPO,
    env: { ...childEnv, JENKINS_CLIENT_SECRET: stackEnv.JENKINS_CLIENT_SECRET },
  })
}

function decodedToken() {
  return Buffer.from(kubectl("-n", "ci", "get", "secret", "jenkins-deploy-token", "-o", "jsonpath={.data.token}"), "base64").toString()
}

// The scratch repo: this working tree's pipeline files, plus the stand-in chart.
async function pushScratchRepo(message) {
  const dir = path.join(WORK, "repo")
  const git = (...argv) => run("git", ["-c", "user.name=drill", "-c", "user.email=drill@example.invalid", "-c", "core.autocrlf=false", "-C", dir, ...argv])
  if (!fs.existsSync(path.join(dir, ".git"))) {
    fs.mkdirSync(dir, { recursive: true })
    run("git", ["init", "-q", "-b", "main", dir])
  }
  const target = path.join(dir, "deploy/k8s")
  fs.rmSync(target, { recursive: true, force: true })
  fs.mkdirSync(path.join(target, "jenkins"), { recursive: true })
  for (const f of ["deploy.Jenkinsfile", "wait-for-images.sh"]) {
    fs.writeFileSync(path.join(target, "jenkins", f), fs.readFileSync(path.join(JENKINS, f), "utf8").replace(/\r\n/g, "\n"))
  }
  fs.cpSync(path.join(HERE, "playground-fixture"), path.join(target, "playground"), { recursive: true })
  fs.writeFileSync(path.join(dir, "marker.txt"), `${message} ${Date.now()}\n`)
  git("add", "-A")
  git("commit", "-q", "-m", message)
  // As a bundle through kubectl exec: a git:// push hangs through a port-forward.
  const bundle = path.join(WORK, "repo.bundle")
  git("bundle", "create", "-q", bundle.replace(/\\/g, "/"), "main")
  run("kubectl", ["-n", "drill", "exec", "-i", "git", "--", "sh", "-c", "cat > /tmp/repo.bundle && git -C /srv/playground.git fetch -q --force /tmp/repo.bundle main:main"], { input: fs.readFileSync(bundle) })
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
    user.password = crypto.createHash("sha256").update(`${stackEnv.KC_CONFIG_CLIENT_SECRET}:${user.username}`).digest("hex").slice(0, 24)
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

const order = ["cluster", "install", "access", "deploy", "drift", "backup", "recreate", "restore", "keycloak-down"]
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
