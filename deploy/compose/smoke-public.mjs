#!/usr/bin/env node
// Runs the checks against the deployed stack from this machine, so the browser
// flows use the real public URL and certificate.
// Usage: node deploy/compose/smoke-public.mjs <user@vm> smoke [check...]
//        node deploy/compose/smoke-public.mjs <user@vm> headers
//        node deploy/compose/smoke-public.mjs <user@vm> mail-cleanup
//
// The admin API and the actuator are not public, and stay that way:
// - admin API: an SSH tunnel to Keycloak's loopback port, signed in as a
//   throwaway client limited to the playground realm (smoke-access.sh), deleted
//   when the run ends. No master realm credential leaves the VM.
// - Redis: one read-only EXISTS per call through smoke-access.sh, so its
//   password stays on the VM.
// - gateway actuator (headers): an SSH tunnel to its private address.
// Exits with the status of the check it runs.
import { execFile, spawn } from "node:child_process"
import net from "node:net"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, "..", "..")
const [target, command, ...rest] = process.argv.slice(2)
if (!target || !["smoke", "headers", "mail-cleanup"].includes(command)) {
  console.error("Usage: node deploy/compose/smoke-public.mjs <user@vm> smoke|headers|mail-cleanup [check...]")
  process.exit(2)
}

const SSH = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=15"]
const ACCESS = process.env.SMOKE_ACCESS ?? "/srv/playground/deploy/compose/smoke-access.sh"
const remote = ["ssh", ...SSH, target, "sudo", "sh", ACCESS]

const run = promisify(execFile)
const access = async (...args) => (await run(remote[0], [...remote.slice(1), ...args])).stdout.trim()

// A free port, so a local stack on a fixed port cannot answer in the VM's place.
function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })
}

async function openTunnel(destination) {
  const port = await freePort()
  const child = spawn("ssh", [...SSH, "-N", "-o", "ExitOnForwardFailure=yes", "-L", `${port}:${destination}`, target], { stdio: "ignore" })
  let exited = false
  child.once("exit", () => (exited = true))
  const deadline = Date.now() + 20000
  for (;;) {
    if (exited) throw new Error(`SSH tunnel to ${destination} exited`)
    const up = await new Promise((resolve) => {
      const socket = net.connect(port, "127.0.0.1")
      socket.once("connect", () => {
        socket.destroy()
        resolve(true)
      })
      socket.once("error", () => resolve(false))
    })
    if (up) return { child, port }
    if (Date.now() > deadline) {
      child.kill()
      throw new Error(`SSH tunnel to ${destination} did not come up`)
    }
    await new Promise((r) => setTimeout(r, 300))
  }
}

function runNode(args, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { cwd: root, stdio: "inherit", env: { ...process.env, ...env } })
    child.on("exit", (code) => resolve(code ?? 1))
  })
}

const hosts = Object.fromEntries((await access("hosts")).split(/\r?\n/).map((line) => line.trim().split("=")))
const appUrl = `https://${hosts.APP_HOST}`
const authUrl = `https://${hosts.AUTH_HOST}`

let status = 1
let tunnel
let opened = false
try {
  if (command === "headers") {
    const { child, port } = await openTunnel(`${await access("address", "gateway")}:9181`)
    tunnel = child
    status = await runNode(["check-headers.mjs", appUrl, `http://127.0.0.1:${port}`], {})
  } else {
    const { child, port } = await openTunnel("127.0.0.1:8080")
    tunnel = child
    opened = true
    const adminEnv = {
      KC_URL: `http://127.0.0.1:${port}`,
      KC_ADMIN_PORT: String(port),
      SMOKE_ADMIN_CLIENT_ID: "smoke-runner",
      SMOKE_ADMIN_CLIENT_SECRET: await access("open"),
    }
    if (command === "smoke") {
      status = await runNode(["smoke.mjs", ...rest], {
        ...adminEnv,
        APP_URL: appUrl,
        KC_PUBLIC_URL: authUrl,
        COOKIE_SECURE: "true",
        SMOKE_REDIS_EXEC: JSON.stringify([...remote, "redis-exists"]),
      })
    } else {
      // Placeholders only, so the local .env is not read. Node itself also reads
      // --env-file, even after the script name, and exits if the file is missing.
      status = await runNode([join(here, "mailcheck.mjs"), "cleanup", "--env-file", join(here, ".env.example")], adminEnv)
    }
  }
} catch (err) {
  console.error(`ERROR  ${err.message}`)
} finally {
  if (opened) await access("close").catch((err) => console.error(`WARN  could not delete smoke-runner: ${err.message}`))
  tunnel?.kill()
}
process.exit(status)
