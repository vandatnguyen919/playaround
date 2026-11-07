#!/usr/bin/env node
// Local Vault. No command prints a secret value.
//
//   node infra/vault/vault.mjs up        start, init on first run, unseal, apply
//                                        policies, store what is missing, render .env
//   node infra/vault/vault.mjs status    initialized, sealed, version
//   node infra/vault/vault.mjs unseal    after a Vault restart
//   node infra/vault/vault.mjs render    write infra/.env from Vault
//   node infra/vault/vault.mjs rotate    new gateway client secret in Vault, .env and Keycloak
//   node infra/vault/vault.mjs external-secret <service>   the phase 2 manifests, as YAML
import { apply, compose, externalSecretYaml, init, render, rotateGatewayClient, seed, sealStatus, unseal } from "./lib.mjs"

const commands = {
  async up() {
    compose(["up", "-d", "--wait", "vault"])
    console.log((await init()) ? "initialized Vault; key and root token in infra/vault/.local/init.json" : "already initialized")
    console.log((await unseal()) ? "unsealed" : "already unsealed")
    await apply()
    console.log("KV v2 mount and policies applied")
    for (const { name, added } of await seed()) console.log(`${name}: ${added ? `stored ${added} value(s)` : "already stored"}`)
    console.log(`rendered ${await render()} variables`)
  },
  async status() {
    const { initialized, sealed, version, storage_type: storage } = await sealStatus()
    console.log({ initialized, sealed, version, storage })
  },
  async unseal() {
    console.log((await unseal()) ? "unsealed" : "already unsealed")
  },
  async render() {
    console.log(`rendered ${await render()} variables`)
  },
  async rotate() {
    const { from, to } = await rotateGatewayClient()
    console.log(`gateway-client: version ${from} to ${to}; infra/.env rendered; Keycloak updated`)
    console.log("Restart bootRun, or recreate the gateway container, to pick it up.")
  },
  async "external-secret"(service) {
    process.stdout.write(externalSecretYaml(service))
  },
}

const [command, ...args] = process.argv.slice(2)
if (!commands[command]) {
  console.error(`usage: vault.mjs ${Object.keys(commands).join("|")}`)
  process.exit(2)
}
try {
  await commands[command](...args)
} catch (err) {
  console.error(`vault.mjs ${command}: ${err.message}`)
  process.exit(1)
}
