#!/usr/bin/env node
// Checks the running local Vault against the code: raft, KV v2, policies, what each
// service can and cannot do, the rendered .env, and that no value reaches git.
//
//   node infra/vault/check.mjs             needs node infra/vault/vault.mjs up
//   node infra/vault/check.mjs --restart   also restarts Vault: render must fail
//                                          sealed, leaving .env alone, then unseal
import { execFileSync } from "node:child_process"
import { readFileSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import {
  BUILT_IN_POLICIES, ENV_FILE, INIT_FILE, ROOT, compose, dataPath, envLine, externalSecretYaml, kvKey, manifest, ok, parseEnv,
  policyFiles, readInit, readSecret, remoteRefs, render, sealStatus, tokenFor, unseal, vault,
} from "./lib.mjs"

let failed = 0
function check(name, pass, detail = "") {
  if (!pass) failed++
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`)
}
const secretNames = Object.keys(manifest.secrets)
const git = (...args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8" })
const root = readInit().root_token

// Server
const status = await sealStatus()
check("initialized and unsealed", status.initialized && !status.sealed)
check("Vault 2.2.1 on raft", status.version === "2.2.1" && status.storage_type === "raft", `${status.version} ${status.storage_type}`)
const raft = await ok("sys/storage/raft/configuration", { token: root })
check("raft has one voting node", raft.data.config.servers.length === 1 && raft.data.config.servers[0].voter)
const published = compose(["port", "vault", "8200"], { capture: true }).trim()
check("published on loopback only", published === "127.0.0.1:8200", published)
const { data: mounts } = await ok("sys/mounts", { token: root })
check(`${manifest.mount}/ is KV v2`, mounts[`${manifest.mount}/`]?.type === "kv" && mounts[`${manifest.mount}/`]?.options?.version === "2")

// Policies: what is in Vault is what is in the repo.
const files = policyFiles()
const { data: listed } = await ok("sys/policies/acl?list=true", { token: root })
const extra = listed.keys.filter((name) => !(name in files) && !BUILT_IN_POLICIES.has(name))
check("no policy outside the repo", extra.length === 0, extra.join(", "))
for (const [name, policy] of Object.entries(files)) {
  const { data } = await ok(`sys/policies/acl/${name}`, { token: root })
  check(`policy ${name} matches its file`, data.policy === policy)
}

// Each file's paths are the manifest's readers, exactly.
const paths = (policy) => [...policy.matchAll(/^path "([^"]+)"/gm)].map((m) => m[1]).sort()
for (const service of Object.keys(manifest.services)) {
  const expected = secretNames.filter((name) => manifest.secrets[name].readers.includes(service)).map(dataPath).sort()
  check(`${service}: policy file lists its readers exactly`, JSON.stringify(paths(files[service])) === JSON.stringify(expected))
}
const composePaths = secretNames.filter((name) => Object.values(manifest.secrets[name].keys).some((k) => k.compose)).map(dataPath).sort()
check("compose-render: policy file lists compose secrets exactly", JSON.stringify(paths(files["compose-render"])) === JSON.stringify(composePaths))

// Each service with a real token: reads its own, nothing else, writes nothing.
for (const service of Object.keys(manifest.services)) {
  const token = await tokenFor([service])
  const denied = []
  const missing = []
  for (const name of secretNames) {
    const allowed = manifest.secrets[name].readers.includes(service)
    const { status: code } = await vault(dataPath(name), { token })
    if (allowed && code !== 200) missing.push(name)
    if (!allowed && code !== 403) denied.push(name)
  }
  check(`${service}: reads its secrets`, missing.length === 0, missing.join(", "))
  check(`${service}: 403 on every other secret`, denied.length === 0, denied.join(", "))
  const own = secretNames.find((name) => manifest.secrets[name].readers.includes(service))
  const write = await vault(dataPath(own), { token, method: "POST", body: { data: { nope: "1" } } })
  const list = await vault(`${manifest.mount}/metadata/${manifest.prefix}?list=true`, { token })
  const history = await vault(`${manifest.mount}/metadata/${kvKey(own)}`, { token })
  const remove = await vault(`${manifest.mount}/destroy/${kvKey(own)}`, { token, method: "POST", body: { versions: [1] } })
  const admin = await vault("sys/policies/acl", { token: token })
  check(`${service}: cannot write, list, see metadata, destroy or read policies`, [write, list, history, remove, admin].every((r) => r.status === 403), [write, list, history, remove, admin].map((r) => r.status).join(" "))

  // What External Secrets does: read remoteRef.key, take remoteRef.property.
  const refs = remoteRefs(service)
  const yaml = externalSecretYaml(service)
  let readable = refs.length > 0
  for (const { env, key, property, name } of refs) {
    const { data } = await readSecret(name, token)
    if (typeof data[property] !== "string" || !yaml.includes(`secretKey: ${env}`) || !yaml.includes(`key: ${key}`)) readable = false
  }
  check(`${service}: every ExternalSecret remoteRef resolves with its policy`, readable, `${refs.length} refs`)
}

// compose-render and secrets-writer stay inside their lines.
const renderToken = await tokenFor(["compose-render"])
check("compose-render: 403 on prod-only secrets", (await Promise.all(secretNames.filter((n) => !composePaths.includes(dataPath(n))).map((n) => vault(dataPath(n), { token: renderToken })))).every((r) => r.status === 403))
check("compose-render: cannot write", (await vault(dataPath("gateway-client"), { token: renderToken, method: "POST", body: { data: {} } })).status === 403)
const writerToken = await tokenFor(["secrets-writer"])
check("secrets-writer: cannot destroy, delete or touch policies", [
  await vault(`${manifest.mount}/destroy/${kvKey("redis")}`, { token: writerToken, method: "POST", body: { versions: [1] } }),
  await vault(dataPath("redis"), { token: writerToken, method: "DELETE" }),
  await vault("sys/policies/acl/gateway", { token: writerToken, method: "POST", body: { policy: "" } }),
].every((r) => r.status === 403))

// The rendered file equals Vault. A second render changes nothing but is safe.
const envVars = parseEnv(readFileSync(ENV_FILE, "utf8"))
let inSync = true
for (const [name, secret] of Object.entries(manifest.secrets)) {
  for (const [key, spec] of Object.entries(secret.keys)) {
    if (!spec.compose) {
      if (spec.env in envVars) inSync = false
      continue
    }
    const { data } = await readSecret(name, root)
    if (envVars[spec.env] !== data[key]) inSync = false
  }
}
check("infra/.env equals Vault and holds no prod-only secret", inSync)

// compose reads a hostile value literally.
const hostile = 'a$b#c d"e\\f${HOME}'
const tmp = path.join(os.tmpdir(), `vault-check-${process.pid}.env`)
writeFileSync(tmp, envLine("GATEWAY_CLIENT_SECRET", hostile) + "\n")
try {
  const config = JSON.parse(compose(["--env-file", tmp, "config", "--format", "json", "keycloak-config"], { capture: true }))
  // `config` prints a literal $ as $$; a container gets the single $.
  check("a value with $ # and quotes survives compose literally", config.services["keycloak-config"].environment.GATEWAY_CLIENT_SECRET.replaceAll("$$", "$") === hostile)
} finally {
  rmSync(tmp, { force: true })
}
let refused = false
try {
  envLine("X", "it's")
} catch {
  refused = true
}
check("a value .env cannot hold is refused", refused)

// Git
const ignored = (file) => {
  try {
    git("check-ignore", "-q", file)
    return true
  } catch {
    return false
  }
}
check("init.json and .env are ignored by git", ignored(INIT_FILE) && ignored(ENV_FILE))
const sensitive = [readInit().root_token, ...readInit().keys]
for (const name of secretNames) {
  const { data } = await readSecret(name, root)
  for (const [key, value] of Object.entries(data)) if (!manifest.secrets[name].keys[key]?.default && value) sensitive.push(value)
}
const rotated = (await readSecret("gateway-client", root)).data.client_secret
if (rotated !== manifest.secrets["gateway-client"].keys.client_secret.default) sensitive.push(rotated)
const leaked = sensitive.filter((value) => {
  try {
    git("grep", "-q", "--fixed-strings", "--untracked", "--", value)
    return true
  } catch {
    return false
  }
})
check("no generated value in any file git would see", leaked.length === 0, `${sensitive.length} values`)

// Sealed: render fails and leaves the file alone; a restart comes back by script.
if (process.argv.includes("--restart")) {
  const before = readFileSync(ENV_FILE)
  compose(["restart", "vault"], { capture: true })
  for (let i = 0; i < 30; i++) {
    try {
      await sealStatus()
      break
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  }
  check("restart leaves Vault sealed", (await sealStatus()).sealed)
  let message = ""
  try {
    await render()
  } catch (err) {
    message = err.message
  }
  check("render fails while sealed", message !== "", message.slice(0, 80))
  check("the failed render left .env unchanged", before.equals(readFileSync(ENV_FILE)))
  await unseal()
  check("unseal brings it back, data intact", !(await sealStatus()).sealed && (await readSecret("gateway-client", root)).version > 0)
  await render()
  check("render works again, same content", before.equals(readFileSync(ENV_FILE)))
}

console.log(failed ? `\n${failed} FAILED` : "\nall passed")
process.exit(failed ? 1 : 0)
