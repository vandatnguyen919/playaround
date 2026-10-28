#!/usr/bin/env node
// Checks a running compose.prod.yml stack: production mode, Postgres, the
// realm applied by keycloak-config, and what the public hostname exposes.
// Usage: node deploy/compose/check.mjs [--env-file <path>] [--insecure]
//   --env-file  the .env the stack was started with (default: deploy/compose/.env)
//   --insecure  accept a self-signed cert (local runs without Let's Encrypt)
// The public host is reached at 127.0.0.1:443 with SNI and Host set to
// AUTH_HOST (PUBLIC_IP overrides), so no DNS is needed. Exits nonzero on failure.
import https from "node:https"
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const envFile = args.includes("--env-file") ? args[args.indexOf("--env-file") + 1] : join(here, ".env")
const insecure = args.includes("--insecure")

const env = {}
for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)=(.*)$/)
  if (m) env[m[1]] = m[2].trim()
}
const AUTH_HOST = env.AUTH_HOST
const APP_URL = `https://${env.APP_HOST}`
const PUBLIC_IP = process.env.PUBLIC_IP ?? "127.0.0.1"
const ADMIN = `http://127.0.0.1:${env.KC_ADMIN_PORT ?? "8080"}`
const REALM = "playground"
const compose = ["compose", "-f", join(here, "compose.prod.yml"), "--env-file", envFile]

let failures = 0
function check(name, ok, detail = "") {
  if (!ok) failures++
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  (" + detail + ")" : ""}`)
}

function docker(...rest) {
  return execFileSync("docker", [...compose, ...rest], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
}

// GET through the public entrypoint, as a browser on the internet would.
function publicGet(path, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      { host: PUBLIC_IP, port: 443, path, servername: AUTH_HOST, headers: { host: AUTH_HOST, ...headers }, rejectUnauthorized: !insecure },
      (res) => {
        let body = ""
        res.on("data", (d) => (body += d))
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }))
      },
    )
    req.on("error", reject)
    req.end()
  })
}

// GET on Keycloak's management port from inside the container (port 9000 is
// not published). Returns the HTTP status line.
function managementStatus(port, path) {
  const script = `exec 3<>/dev/tcp/127.0.0.1/${port}; printf 'GET ${path} HTTP/1.1\\r\\nHost: localhost\\r\\nConnection: close\\r\\n\\r\\n' >&3; head -c 4000 <&3`
  return docker("exec", "-T", "keycloak", "bash", "-c", script)
}

// --- Production mode, Postgres, config job -------------------------------
const logs = docker("logs", "keycloak")
check("Keycloak runs the prod profile", /Profile prod activated/.test(logs))
check("Keycloak started optimized (no build at start)", !/Updating the configuration and installing your custom providers/.test(logs))
const realms = docker("exec", "-T", "postgres", "psql", "-U", "keycloak", "-d", "keycloak", "-tAc", "select name from realm order by name")
check("realms are stored in Postgres", realms.trim().split(/\s+/).join(",") === "master,playground", realms.trim())
const job = JSON.parse(docker("ps", "-a", "keycloak-config", "--format", "json").trim().split("\n")[0])
check("keycloak-config exited 0", job.State === "exited" && job.ExitCode === 0, `${job.State} ${job.ExitCode}`)

// --- Management port: health and metrics there only -----------------------
check("health/ready is 200 on :9000", /^HTTP\/1.1 200/.test(managementStatus(9000, "/health/ready")))
const metrics = managementStatus(9000, "/metrics")
check("metrics are served on :9000", /^HTTP\/1.1 200/.test(metrics) && /jvm_|base_|vendor_|http_server/.test(metrics))
check("metrics are not on :8080", !/^HTTP\/1.1 200/.test(managementStatus(8080, "/metrics")))
check("health is not on :8080", !/^HTTP\/1.1 200/.test(managementStatus(8080, "/health/ready")))
const kc = JSON.parse(docker("ps", "keycloak", "--format", "json").trim().split("\n")[0])
const published = (kc.Publishers ?? []).filter((p) => p.PublishedPort).map((p) => `${p.URL}:${p.PublishedPort}->${p.TargetPort}`)
check("only 8080 is published, on loopback", published.length > 0 && published.every((p) => p.startsWith("127.0.0.1:") && p.endsWith("->8080")), published.join(","))

// --- Public hostname --------------------------------------------------------
const disco = await publicGet(`/realms/${REALM}/.well-known/openid-configuration`)
const issuer = disco.status === 200 ? JSON.parse(disco.body).issuer : undefined
check("public discovery document is served", disco.status === 200, `HTTP ${disco.status}`)
check("issuer is the public https URL", issuer === `https://${AUTH_HOST}/realms/${REALM}`, issuer)
const forged = await publicGet(`/realms/${REALM}/.well-known/openid-configuration`, { "x-forwarded-host": "evil.example" })
check("a forged X-Forwarded-Host does not change the issuer", forged.status === 200 && JSON.parse(forged.body).issuer === issuer)

const authPath =
  `/realms/${REALM}/protocol/openid-connect/auth?client_id=gateway&response_type=code&scope=openid` +
  `&redirect_uri=${encodeURIComponent(`${APP_URL}/login/oauth2/code/gateway`)}&code_challenge=${"A".repeat(43)}&code_challenge_method=S256`
const login = await publicGet(authPath)
check("public login page renders with the baked-in theme", login.status === 200 && /\/login\/keycloak-theme\//.test(login.body), `HTTP ${login.status}`)
const asset = login.body.match(/(?:src|href)="([^"]*\/login\/keycloak-theme\/[^"]+\.(?:js|css))"/)?.[1]
const assetRes = asset ? await publicGet(new URL(asset, `https://${AUTH_HOST}`).pathname) : { status: 0 }
check("theme assets load through the public host", assetRes.status === 200, asset)
const badRedirect = await publicGet(authPath.replace(encodeURIComponent(APP_URL), encodeURIComponent("https://evil.example")))
check("an unregistered redirect_uri is refused", badRedirect.status === 400 || !/\/login-actions\/authenticate/.test(badRedirect.body), `HTTP ${badRedirect.status}`)

for (const path of [
  "/admin/",
  "/admin/master/console/",
  `/admin/realms/${REALM}`,
  "/realms/master/.well-known/openid-configuration",
  "/realms/master/protocol/openid-connect/token",
  "/metrics",
  "/health/ready",
  "/",
]) {
  const res = await publicGet(path)
  check(`public ${path} is not reachable`, res.status === 404, `HTTP ${res.status}`)
}

// --- Admin console over the tunnel port --------------------------------------
const console_ = await fetch(`${ADMIN}/admin/master/console/`)
check("admin console answers on the loopback tunnel port", console_.status === 200, `HTTP ${console_.status}`)
// The console's sign-in runs in the master realm, which is not public, so its
// form must post back to the tunnel URL, not the public hostname.
const consoleLogin = await fetch(
  `${ADMIN}/realms/master/protocol/openid-connect/auth?client_id=security-admin-console&response_type=code&scope=openid` +
    `&redirect_uri=${encodeURIComponent(`http://localhost:${env.KC_ADMIN_PORT ?? "8080"}/admin/master/console/`)}` +
    `&code_challenge=${"A".repeat(43)}&code_challenge_method=S256`,
)
const loginAction = (await consoleLogin.text()).match(/action="([^"]+)"/)?.[1] ?? ""
check("admin console sign-in posts to the tunnel URL", loginAction.startsWith(`http://localhost:${env.KC_ADMIN_PORT ?? "8080"}/realms/master/`), loginAction.slice(0, 60))

// --- Realm as configured by keycloak-config ----------------------------------
const tokenRes = await fetch(`${ADMIN}/realms/master/protocol/openid-connect/token`, {
  method: "POST",
  body: new URLSearchParams({ grant_type: "client_credentials", client_id: env.KC_CONFIG_CLIENT_ID, client_secret: env.KC_CONFIG_CLIENT_SECRET }),
})
const token = (await tokenRes.json()).access_token
async function api(path) {
  const res = await fetch(`${ADMIN}/admin/realms/${REALM}${path}`, { headers: { authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error(`GET ${path}: HTTP ${res.status}`)
  return res.json()
}

const realm = await api("")
check("realm uses the keycloak-theme login theme", realm.loginTheme === "keycloak-theme")
check("registration, email login and verify email are on", realm.registrationAllowed && realm.registrationEmailAsUsername && realm.verifyEmail)
check("SMTP comes from the env", realm.smtpServer?.host === env.SMTP_HOST && realm.smtpServer?.auth === "true", realm.smtpServer?.host)

const roles = (await api("/roles")).map((r) => r.name)
check("realm roles user and admin exist", roles.includes("user") && roles.includes("admin"))
const defaults = (await api(`/roles-by-id/${realm.defaultRole.id}/composites`)).map((r) => r.name)
check("default roles include user", ["user", "offline_access", "uma_authorization", "view-profile", "manage-account"].every((r) => defaults.includes(r)), defaults.join(","))

const [gateway] = await api("/clients?clientId=gateway")
check("gateway client is confidential with standard flow only", gateway && !gateway.publicClient && gateway.standardFlowEnabled && !gateway.directAccessGrantsEnabled)
check("gateway redirect URIs are the public app only", JSON.stringify(gateway.redirectUris) === JSON.stringify([`${APP_URL}/*`]), gateway.redirectUris.join(","))
check("gateway requires PKCE S256", gateway.attributes["pkce.code.challenge.method"] === "S256")
check("gateway back-channel logout URL is set", gateway.attributes["backchannel.logout.url"] === "http://gateway:8181/logout/connect/back-channel/gateway")
const mappers = Object.fromEntries((gateway.protocolMappers ?? []).map((m) => [m.protocolMapper, m.config]))
check("fullName attribute maps to the name claim", mappers["oidc-usermodel-attribute-mapper"]?.["user.attribute"] === "fullName" && mappers["oidc-usermodel-attribute-mapper"]?.["claim.name"] === "name")
check("realm roles map to realm_access.roles", mappers["oidc-usermodel-realm-role-mapper"]?.["claim.name"] === "realm_access.roles")
const secret = await api(`/clients/${gateway.id}/client-secret`)
check("gateway secret comes from the env", secret.value === env.GATEWAY_CLIENT_SECRET)

const profile = await api("/users/profile")
const fullName = profile.attributes.find((a) => a.name === "fullName")
check("user profile has a required fullName with a pattern validator", fullName?.required && fullName?.validations?.pattern)
const idps = (await api("/identity-provider/instances")).map((i) => i.alias).sort()
check("Google and GitHub identity providers exist", idps.join(",") === "github,google", idps.join(","))
for (const alias of ["google", "github"]) {
  const idpMappers = await api(`/identity-provider/instances/${alias}/mappers`)
  check(`${alias} name maps to fullName`, idpMappers.some((m) => m.config.userAttribute === "fullName" && m.config.jsonField === "name"))
}
const regForm = await api("/authentication/flows/registration%20form/executions")
const pwStep = regForm.find((e) => e.providerId === "registration-password-action")
const pwConfig = pwStep?.authenticationConfig ? await api(`/authentication/config/${pwStep.authenticationConfig}`) : undefined
check("registration always shows the password field", pwConfig?.config?.always_set_password_on_register_form === "true")
const users = await api("/users?max=5")
check("no test users in the production realm", users.length === 0, users.map((u) => u.username).join(","))

console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed")
process.exit(failures ? 1 : 0)
