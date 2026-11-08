#!/usr/bin/env node
// Rotates the gateway client secret on a stack running the gateway image, and shows
// the image never changes. Own compose project (compose.image-demo.yml), so it leaves
// the dev stack and the local prod stack alone. Needs vault.mjs up first. Prints no
// value. A real rotation: infra/.env and Vault keep the new secret.
//
//   node infra/vault/rotate-demo.mjs          run, then stop and remove the scratch stack
//   node infra/vault/rotate-demo.mjs --keep   leave the scratch stack running
import { execFileSync, spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import path from "node:path"
import { ENV_FILE, ROOT, VAULT_DIR, compose, parseEnv, readInit, readSecret, rotateGatewayClient } from "./lib.mjs"

const PROJECT = ["-p", "playground-vault-demo", "-f", path.join(VAULT_DIR, "compose.image-demo.yml")]
const dc = (args, options = {}) => compose(args, { extra: PROJECT, ...options })
const docker = (...args) => execFileSync("docker", args, { encoding: "utf8" }).trim()
const KC_TOKEN = "http://localhost:8080/realms/playground/protocol/openid-connect/token"
const SMOKE_ENV = { ...process.env, APP_URL: "http://localhost:8181", REDIS_PORT: "16380" }

let failed = 0
function check(name, pass, detail = "") {
  if (!pass) failed++
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`)
}

/**
 * Does Keycloak accept this secret? The client has no service account, so a right
 * secret still gets no token. Status and error name are the same (401
 * unauthorized_client) either way; only the description tells them apart.
 */
async function keycloakAccepts(secret) {
  const res = await fetch(KC_TOKEN, {
    method: "POST",
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: "gateway", client_secret: secret }),
  })
  const { error_description: description } = await res.json()
  if (description === "Client not enabled to retrieve service account") return true
  if (description === "Invalid client or Invalid client credentials") return false
  throw new Error(`unexpected answer from Keycloak: ${res.status} ${description}`)
}

function smoke(...checks) {
  const env = { ...SMOKE_ENV, REDIS_PASSWORD: parseEnv(readFileSync(ENV_FILE, "utf8")).REDIS_PASSWORD }
  const run = spawnSync("node", ["smoke.mjs", ...checks], { cwd: ROOT, env, encoding: "utf8" })
  const output = `${run.stdout}${run.stderr}`
  return { passed: run.status === 0, count: (output.match(/^PASS/gm) ?? []).length, fails: output.match(/^FAIL.*$/gm) ?? [] }
}

const gatewayContainer = () => dc(["ps", "-q", "gateway"], { capture: true }).trim()
const imageId = (container) => docker("inspect", "-f", "{{.Image}}", container)
const containerEnv = (container) => docker("inspect", "-f", "{{json .Config.Env}}", container)

const keep = process.argv.includes("--keep")
try {
  readInit()
  console.log("Starting the scratch stack from existing images (no build section; first Keycloak start takes minutes)")
  dc(["up", "-d", "--wait", "--wait-timeout", "600", "--no-build", "gateway"], { capture: true })

  const root = readInit().root_token
  const before = await readSecret("gateway-client", root)
  const oldSecret = before.data.client_secret
  const oldContainer = gatewayContainer()
  const oldImage = imageId(oldContainer)
  console.log(`\nBefore: Vault gateway-client version ${before.version}, image ${oldImage.slice(0, 19)}`)
  check("Keycloak accepts the current secret", (await keycloakAccepts(oldSecret)) === true)
  check("Keycloak refuses a wrong one", (await keycloakAccepts("not-the-secret")) === false)
  check("the running gateway holds it", containerEnv(oldContainer).includes(oldSecret))
  const baseline = smoke()
  check("smoke passes before the rotation", baseline.passed, `${baseline.count} assertions ${baseline.fails.join("; ")}`)

  console.log("\nRotating: new KV version, infra/.env, keycloak-config. The gateway is not touched.")
  const started = Date.now()
  const { to } = await rotateGatewayClient({ composeExtra: PROJECT })
  const after = await readSecret("gateway-client", root)
  const newSecret = after.data.client_secret
  check("Vault holds a new version with a new value", after.version === to && to === before.version + 1 && newSecret !== oldSecret, `version ${to}`)
  check("the old version is still in KV history", (await readSecret(`gateway-client?version=${before.version}`, root)).data.client_secret === oldSecret)
  check("infra/.env has the new value", parseEnv(readFileSync(ENV_FILE, "utf8")).GATEWAY_CLIENT_SECRET === newSecret)
  check("Keycloak now refuses the old secret", (await keycloakAccepts(oldSecret)) === false)
  check("Keycloak accepts the new secret", (await keycloakAccepts(newSecret)) === true)

  console.log("\nThe gateway still runs the old secret, so a login has to fail. That shows the rotation is real.")
  check("still the same container, holding the old secret", gatewayContainer() === oldContainer && containerEnv(oldContainer).includes(oldSecret))
  const stale = smoke("login")
  check("login fails with the old secret", !stale.passed, stale.fails[0]?.slice(0, 90))

  console.log("\nRecreating the gateway container from the same image: no build, no pull.")
  dc(["up", "-d", "--wait", "--no-build", "--no-deps", "--force-recreate", "gateway"], { capture: true })
  const newContainer = gatewayContainer()
  const windowSeconds = Math.round((Date.now() - started) / 1000)
  check("a new container", newContainer !== oldContainer)
  check("the same image id", imageId(newContainer) === oldImage, oldImage.slice(0, 19))
  check("it holds the new secret and not the old", containerEnv(newContainer).includes(newSecret) && !containerEnv(newContainer).includes(oldSecret))
  const imageConfig = docker("image", "inspect", "-f", "{{json .Config.Env}}", oldImage)
  const history = docker("history", "--no-trunc", "--format", "{{.CreatedBy}}", oldImage)
  check("the image's env and layer history hold neither secret", ![oldSecret, newSecret].some((s) => imageConfig.includes(s) || history.includes(s)))
  const final = smoke()
  check("smoke passes after the rotation", final.passed, `${final.count} assertions ${final.fails.join("; ")}`)
  console.log(`\nSeconds from the Vault write to a healthy gateway, including the failed login above: ${windowSeconds}`)
} catch (err) {
  failed++
  console.error(`rotate-demo: ${err.message.split("\n")[0]}`)
} finally {
  if (!keep) {
    // Only this scratch project's containers, network and volumes.
    dc(["down", "-v", "--remove-orphans"], { capture: true })
    console.log("Scratch stack removed.")
  }
}
console.log(failed ? `\n${failed} FAILED` : "\nall passed")
process.exit(failed ? 1 : 0)
