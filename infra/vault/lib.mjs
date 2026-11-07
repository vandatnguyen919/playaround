// Shared by vault.mjs, check.mjs and rotate-demo.mjs. Talks to Vault over its HTTP
// API, so the host needs only Node and Docker. Never prints a secret value.
import { execFileSync } from "node:child_process"
import { randomBytes } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

export const VAULT_DIR = path.dirname(fileURLToPath(import.meta.url))
export const ROOT = path.resolve(VAULT_DIR, "../..")
export const ENV_FILE = process.env.VAULT_ENV_FILE ?? path.join(ROOT, "infra/.env")
const ADDR = process.env.VAULT_ADDR ?? "http://127.0.0.1:8200"
// Unseal key and root token. Ignored by git. Local dev only: see README.md.
export const INIT_FILE = path.join(VAULT_DIR, ".local/init.json")
const COMPOSE = ["compose", "-f", path.join(ROOT, "infra/docker-compose.yml")]

export const manifest = JSON.parse(readFileSync(path.join(VAULT_DIR, "secrets.json"), "utf8"))

/** Key under the KV mount: what an ExternalSecret's remoteRef.key names. */
export const kvKey = (name) => `${manifest.prefix}/${name}`
export const dataPath = (name) => `${manifest.mount}/data/${kvKey(name)}`

export function policyFiles() {
  const dir = path.join(VAULT_DIR, "policies")
  return Object.fromEntries(
    readdirSync(dir)
      .filter((f) => f.endsWith(".hcl"))
      .map((f) => [f.slice(0, -4), readFileSync(path.join(dir, f), "utf8")]),
  )
}

export async function vault(apiPath, { token, method = "GET", body } = {}) {
  let res
  try {
    res = await fetch(`${ADDR}/v1/${apiPath}`, {
      method,
      headers: token ? { "X-Vault-Token": token } : {},
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "manual",
    })
  } catch (err) {
    throw new Error(`Vault is not reachable at ${ADDR} (${err.cause?.code ?? err.message})`)
  }
  const text = await res.text()
  return { status: res.status, json: text ? JSON.parse(text) : {} }
}

/** Like vault(), but anything but 2xx is an error. Vault's messages hold no values. */
export async function ok(apiPath, options) {
  const res = await vault(apiPath, options)
  if (res.status >= 300) throw new Error(`${options?.method ?? "GET"} ${apiPath}: ${res.status} ${JSON.stringify(res.json.errors ?? [])}`)
  return res.json
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export const sealStatus = () => ok("sys/seal-status")

export function readInit() {
  if (!existsSync(INIT_FILE)) throw new Error(`${INIT_FILE} is missing, so Vault cannot be unsealed or administered from here`)
  return JSON.parse(readFileSync(INIT_FILE, "utf8"))
}

export async function init() {
  const status = await sealStatus()
  if (status.initialized) {
    readInit()
    return false
  }
  // Not overwritten: it may be the only copy of the key to data in another volume.
  if (existsSync(INIT_FILE)) throw new Error(`Vault is empty but ${INIT_FILE} exists. Move that file away first`)
  // One share: every share would land in this one file, so more add no safety.
  const result = await ok("sys/init", { method: "POST", body: { secret_shares: 1, secret_threshold: 1 } })
  mkdirSync(path.dirname(INIT_FILE), { recursive: true })
  writeFileSync(INIT_FILE, JSON.stringify({ keys: result.keys, root_token: result.root_token }, null, 2) + "\n", { mode: 0o600, flag: "wx" })
  return true
}

export async function unseal() {
  const status = await sealStatus()
  if (status.sealed) {
    for (const key of readInit().keys) await ok("sys/unseal", { method: "POST", body: { key } })
  }
  // Raft needs a moment to elect itself after an unseal.
  for (let i = 0; i < 60; i++) {
    if ((await vault("sys/health")).status === 200) return status.sealed
    await sleep(500)
  }
  throw new Error("Vault did not become active after unsealing")
}

/** A short-lived token that holds only the named policies. */
export async function tokenFor(policies, { ttl = "5m" } = {}) {
  const { auth } = await ok("auth/token/create", {
    method: "POST",
    token: readInit().root_token,
    body: { policies, ttl, renewable: false, display_name: policies.join("-") },
  })
  return auth.client_token
}

export const BUILT_IN_POLICIES = new Set(["default", "root", "default-ceiling"])

/** Makes the KV mount and the policies match the code. Removes policies not in it. */
export async function apply() {
  const root = readInit().root_token
  const { data: mounts } = await ok("sys/mounts", { token: root })
  const mount = mounts[`${manifest.mount}/`]
  if (!mount) {
    await ok(`sys/mounts/${manifest.mount}`, { method: "POST", token: root, body: { type: "kv", options: { version: "2" } } })
  } else if (mount.type !== "kv" || mount.options?.version !== "2") {
    throw new Error(`mount ${manifest.mount}/ exists and is not KV v2`)
  }
  const files = policyFiles()
  for (const [name, policy] of Object.entries(files)) {
    await ok(`sys/policies/acl/${name}`, { method: "POST", token: root, body: { policy } })
  }
  const { data } = await ok("sys/policies/acl?list=true", { token: root })
  for (const name of data.keys) {
    if (!(name in files) && !BUILT_IN_POLICIES.has(name)) {
      await ok(`sys/policies/acl/${name}`, { method: "DELETE", token: root })
    }
  }
}

async function readSecret(name, token) {
  const res = await vault(dataPath(name), { token })
  if (res.status === 404) return { data: {}, version: 0 }
  if (res.status >= 300) throw new Error(`read ${kvKey(name)}: ${res.status}`)
  return { data: res.json.data.data ?? {}, version: res.json.data.metadata.version }
}
export { readSecret }

async function writeSecret(name, data, version, token) {
  // cas: refuses to overwrite a version this run did not read. A fresh KV mount
  // answers 400 for a few seconds while it upgrades, hence the retry.
  for (let i = 0; ; i++) {
    const res = await vault(dataPath(name), { method: "POST", token, body: { options: { cas: version }, data } })
    if (res.status < 300) return res.json.data.version
    if (res.status !== 400 || i >= 30) throw new Error(`write ${kvKey(name)}: ${res.status} ${JSON.stringify(res.json.errors ?? [])}`)
    await sleep(500)
  }
}

export const newSecret = () => randomBytes(32).toString("hex")

/**
 * Stores what is missing, keeping what is there. A missing value comes from the
 * current infra/.env, then the manifest's dev default, or else is generated, so a
 * first run changes nothing the dev stack already uses.
 */
export async function seed() {
  const token = await tokenFor(["secrets-writer"])
  const current = existsSync(ENV_FILE) ? parseEnv(readFileSync(ENV_FILE, "utf8")) : {}
  const report = []
  for (const [name, secret] of Object.entries(manifest.secrets)) {
    const { data, version } = await readSecret(name, token)
    const next = { ...data }
    for (const [key, spec] of Object.entries(secret.keys)) next[key] ??= current[spec.env] ?? spec.default ?? newSecret()
    const added = Object.keys(next).length - Object.keys(data).length
    if (added > 0) await writeSecret(name, next, version, token)
    report.push({ name, added })
  }
  return report
}

export function parseEnv(text) {
  const vars = {}
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line)
    if (!match) continue
    const single = /^'(.*)'\s*$/.exec(match[2])
    vars[match[1]] = single ? single[1] : match[2].trim()
  }
  return vars
}

/** One .env line. Single quotes keep $ and # literal in compose's parser. */
export function envLine(name, value) {
  if (/['\r\n]/.test(value)) throw new Error(`${name}: a single quote or newline cannot be written to .env`)
  return /^[A-Za-z0-9_.@:+/=-]*$/.test(value) ? `${name}=${value}` : `${name}='${value}'`
}

/**
 * Writes infra/.env from Vault with a read-only token. All or nothing: any failure
 * (sealed, denied, bad value) leaves the file as it was. Variables Vault does not
 * own are kept at the end.
 */
export async function render(file = ENV_FILE) {
  const token = await tokenFor(["compose-render"])
  const lines = ["# Written by infra/vault/vault.mjs render from Vault. Edits to these values are", "# overwritten: change them in Vault. Ignored by git, never commit it.", ""]
  const owned = new Set()
  for (const [name, secret] of Object.entries(manifest.secrets)) {
    const composeKeys = Object.entries(secret.keys).filter(([, spec]) => spec.compose)
    if (composeKeys.length === 0) continue
    const { data, version } = await readSecret(name, token)
    if (version === 0) throw new Error(`${kvKey(name)} is not in Vault. Run: node infra/vault/vault.mjs up`)
    lines.push(`# ${kvKey(name)} (version ${version})`)
    for (const [key, spec] of composeKeys) {
      if (data[key] === undefined) throw new Error(`${kvKey(name)} has no ${key}`)
      lines.push(envLine(spec.env, data[key]))
      owned.add(spec.env)
    }
  }
  if (existsSync(file)) {
    const others = Object.entries(parseEnv(readFileSync(file, "utf8"))).filter(([name]) => !owned.has(name))
    if (others.length) lines.push("", "# Not from Vault", ...others.map(([name, value]) => envLine(name, value)))
  }
  const tmp = `${file}.tmp`
  writeFileSync(tmp, lines.join("\n") + "\n", { mode: 0o600 })
  renameSync(tmp, file)
  return owned.size
}

export function compose(args, { extra = [], capture = false } = {}) {
  return execFileSync("docker", [...COMPOSE, ...extra, ...args], { cwd: ROOT, stdio: capture ? "pipe" : "inherit", encoding: "utf8" })
}

/**
 * New gateway client secret: a new KV version, the rendered .env, and Keycloak's
 * client through keycloak-config. The running gateway keeps the old value until
 * its container is recreated or bootRun restarted.
 */
export async function rotateGatewayClient({ composeExtra = [] } = {}) {
  const token = await tokenFor(["secrets-writer"])
  const { data, version } = await readSecret("gateway-client", token)
  const newVersion = await writeSecret("gateway-client", { ...data, client_secret: newSecret() }, version, token)
  await render()
  compose(["run", "--rm", "keycloak-config"], { extra: composeExtra, capture: true })
  return { from: version, to: newVersion }
}

/** The ExternalSecret and SecretStore phase 2 applies for one service, as YAML. */
export function externalSecretYaml(service) {
  const spec = manifest.services[service]
  if (!spec) throw new Error(`unknown service ${service}. One of: ${Object.keys(manifest.services).join(", ")}`)
  const data = remoteRefs(service).flatMap(({ env, key, property }) => [
    `    - secretKey: ${env}`,
    `      remoteRef:`,
    `        key: ${key}`,
    `        property: ${property}`,
  ])
  return [
    "apiVersion: external-secrets.io/v1",
    "kind: SecretStore",
    "metadata:",
    `  name: vault-${service}`,
    `  namespace: ${spec.namespace}`,
    "spec:",
    "  provider:",
    "    vault:",
    "      server: http://vault.vault.svc:8200",
    `      path: ${manifest.mount}`,
    "      version: v2",
    "      auth:",
    "        kubernetes:",
    "          mountPath: kubernetes",
    `          role: ${service}`,
    "          serviceAccountRef:",
    `            name: ${service}`,
    "---",
    "apiVersion: external-secrets.io/v1",
    "kind: ExternalSecret",
    "metadata:",
    `  name: ${service}`,
    `  namespace: ${spec.namespace}`,
    "spec:",
    "  refreshInterval: 1h",
    "  secretStoreRef:",
    "    kind: SecretStore",
    `    name: vault-${service}`,
    "  target:",
    `    name: ${service}-secrets`,
    "  data:",
    ...data,
    "",
  ].join("\n")
}

export function remoteRefs(service) {
  return Object.entries(manifest.secrets)
    .filter(([, secret]) => secret.readers.includes(service))
    .flatMap(([name, secret]) => Object.entries(secret.keys).map(([property, { env }]) => ({ env, key: kvKey(name), property, name })))
}
