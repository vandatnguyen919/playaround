#!/usr/bin/env node
// One-off fix for a playground realm imported before `user` was a default role.
// Usage: node infra/fix-default-roles.mjs [--dry-run]
// Needs Keycloak on :8080 (override with KC_URL) and the bootstrap admin login.
//
// 1. Adds `user` to the realm's default role composite (default-roles-playground),
//    the same setting the realm import now carries. Every user holds that composite,
//    so they all get `user` from it, and so does every user created later.
// 2. Grants `user` directly to any remaining user whose effective roles still lack it
//    (for example, someone whose default role mapping was removed by hand).
// Safe to run more than once: both steps skip what is already in place.

const KC = process.env.KC_URL ?? "http://localhost:8080"
const ADMIN_USER = process.env.KC_BOOTSTRAP_ADMIN_USERNAME ?? "admin"
const ADMIN_PASS = process.env.KC_BOOTSTRAP_ADMIN_PASSWORD ?? "admin"
const REALM = "playground"
const ROLE = "user"
const PAGE_SIZE = 100
const dryRun = process.argv.includes("--dry-run")

async function adminToken() {
  const res = await fetch(`${KC}/realms/master/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "password",
      client_id: "admin-cli",
      username: ADMIN_USER,
      password: ADMIN_PASS,
    }).toString(),
  })
  if (!res.ok) throw new Error(`Admin token failed: HTTP ${res.status}`)
  return (await res.json()).access_token
}

const token = await adminToken()

async function admin(path, init = {}) {
  const res = await fetch(`${KC}/admin/realms/${REALM}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
  })
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path} failed: HTTP ${res.status} ${await res.text()}`)
  return res.status === 204 || res.status === 201 ? null : res.json()
}

const realm = await admin("")
const userRole = await admin(`/roles/${ROLE}`)
const defaultRole = realm.defaultRole
const defaultComposites = await admin(`/roles-by-id/${defaultRole.id}/composites/realm`)

const defaultHasRole = defaultComposites.some((role) => role.name === ROLE)
if (defaultHasRole) {
  console.log(`${defaultRole.name} already includes ${ROLE}`)
} else {
  console.log(`${dryRun ? "Would add" : "Adding"} ${ROLE} to ${defaultRole.name}`)
  if (!dryRun) {
    await admin(`/roles-by-id/${defaultRole.id}/composites`, { method: "POST", body: JSON.stringify([userRole]) })
  }
}

let checked = 0
let granted = 0
for (let first = 0; ; first += PAGE_SIZE) {
  const users = await admin(`/users?first=${first}&max=${PAGE_SIZE}&briefRepresentation=true`)
  for (const user of users) {
    checked++
    // Effective roles: the default role composite counts once step 1 has run.
    const effective = await admin(`/users/${user.id}/role-mappings/realm/composite`)
    if (effective.some((role) => role.name === ROLE)) continue
    // A dry run skipped step 1, so count holders of the default role as covered.
    if (dryRun && !defaultHasRole && effective.some((role) => role.name === defaultRole.name)) continue
    granted++
    console.log(`${dryRun ? "Would grant" : "Granting"} ${ROLE} to ${user.username}`)
    if (!dryRun) {
      await admin(`/users/${user.id}/role-mappings/realm`, { method: "POST", body: JSON.stringify([userRole]) })
    }
  }
  if (users.length < PAGE_SIZE) break
}

console.log(`Checked ${checked} users; ${granted} needed a direct grant${dryRun ? " (dry run, nothing changed)" : ""}.`)
