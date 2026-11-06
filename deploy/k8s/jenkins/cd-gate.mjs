#!/usr/bin/env node
// What must be true before anyone is asked to approve a deploy. For one commit on main:
//   1. the ci workflow's push run for that commit succeeded (waits for it);
//   2. gateway, api and keycloak are on the registry as sha-<git sha>, for both platforms;
//   3. each image's BuildKit provenance, for both platforms, names this repo and commit,
//      and was built by that same CI run.
// Writes the three index digests, in that order, so the deploy pins exactly what was
// checked. Nothing here needs a credential: the repo and images are public.
//
//   node cd-gate.mjs <git sha> <output file>
//
// ci.yml has no GitHub artifact attestation, so this reads BuildKit provenance. It is
// not signed: it proves what the build recorded, and relies on only Actions being able
// to write to these GHCR packages. A signed attestation would not rely on that.
import { execFile } from "node:child_process"
import fs from "node:fs"
import { promisify } from "node:util"

const REPO = process.env.EXPECTED_REPO || "vandatnguyen919/playaround"
const IMAGE_PREFIX = process.env.IMAGE_PREFIX || "ghcr.io/vandatnguyen919/playground-"
const GITHUB_API = process.env.GITHUB_API || "https://api.github.com"
const BUILDX = (process.env.BUILDX || "/tools/docker-buildx").split(" ")
const CI_WAIT_MINUTES = Number(process.env.CI_WAIT_MINUTES || 60)
const IMAGE_WAIT_MINUTES = Number(process.env.IMAGE_WAIT_MINUTES || 5)
const POLL_MS = Number(process.env.POLL_SECONDS || 120) * 1000
const IMAGES = ["gateway", "api", "keycloak"]
const PLATFORMS = ["linux/amd64", "linux/arm64"]
const SOURCE = `https://github.com/${REPO}`

const [sha, output] = process.argv.slice(2)
if (!/^[0-9a-f]{40}$/.test(sha ?? "") || !output) {
  console.error("usage: cd-gate.mjs <git sha> <output file>")
  process.exit(2)
}

class Stop extends Error {}
const run = promisify(execFile)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// The run for this commit, or undefined while there is none yet. Anonymous calls get 60
// an hour; a slower poll stays under that, and a limit or outage only means waiting.
async function ciRun() {
  const url = `${GITHUB_API}/repos/${REPO}/actions/workflows/ci.yml/runs?head_sha=${sha}&event=push&per_page=20`
  const res = await fetch(url, { headers: { accept: "application/vnd.github+json", "user-agent": "playground-cd" }, signal: AbortSignal.timeout(30000) })
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`)
  const { workflow_runs: runs = [] } = await res.json()
  return runs
    .filter((r) => r.head_sha === sha && r.head_branch === "main" && r.repository?.full_name === REPO)
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0]
}

async function waitForCi() {
  const deadline = Date.now() + CI_WAIT_MINUTES * 60000
  for (;;) {
    let state
    try {
      const r = await ciRun()
      if (r?.status === "completed") {
        if (r.conclusion !== "success") throw new Stop(`CI concluded ${r.conclusion} for ${sha}: ${r.html_url ?? r.id}`)
        console.log(`CI passed for ${sha}: run ${r.id}`)
        return r.id
      }
      state = r ? `run ${r.id} is ${r.status}` : "no run yet"
    } catch (e) {
      if (e instanceof Stop) throw e
      state = e.message
    }
    if (Date.now() >= deadline) throw new Stop(`no CI result for ${sha} after ${CI_WAIT_MINUTES} minutes (${state})`)
    console.log(`waiting for CI: ${state}`)
    await sleep(POLL_MS)
  }
}

async function inspect(ref, format) {
  const { stdout } = await run(BUILDX[0], [...BUILDX.slice(1), "imagetools", "inspect", ref, "--format", `{{json .${format}}}`], { maxBuffer: 1 << 28 })
  return JSON.parse(stdout)
}

async function waitForManifest(ref) {
  const deadline = Date.now() + IMAGE_WAIT_MINUTES * 60000
  for (;;) {
    try {
      return await inspect(ref, "Manifest")
    } catch (e) {
      if (Date.now() >= deadline) throw new Stop(`${ref} is not published: ${String(e.stderr ?? e.message).trim().split("\n").pop()}`)
    }
    console.log(`waiting for ${ref}`)
    await sleep(Math.min(POLL_MS, 30000))
  }
}

// Stops at the first thing that does not match. A missing field never passes.
function checkProvenance(image, platform, entry, runId) {
  const slsa = entry?.SLSA
  const args = slsa?.buildDefinition?.externalParameters?.request?.args
  const builder = slsa?.runDetails?.builder?.id
  if (!args || !builder) throw new Stop(`${image} ${platform}: no provenance in the form ci.yml produces`)
  const source = args["label:org.opencontainers.image.source"]
  const revision = args["label:org.opencontainers.image.revision"]
  if (source !== SOURCE) throw new Stop(`${image} ${platform}: built from repo ${source}, expected ${SOURCE}`)
  if (revision !== sha) throw new Stop(`${image} ${platform}: built from commit ${revision}, expected ${sha}`)
  const expected = new RegExp(`^${SOURCE.replace(/[.]/g, "\\.")}/actions/runs/${runId}/attempts/\\d+$`)
  if (!expected.test(builder)) throw new Stop(`${image} ${platform}: built by ${builder}, expected CI run ${runId} of ${REPO}`)
}

async function checkImage(image, runId) {
  const tagged = `${IMAGE_PREFIX}${image}:sha-${sha}`
  const manifest = await waitForManifest(tagged)
  const digest = manifest.digest
  if (!/^sha256:[0-9a-f]{64}$/.test(digest ?? "")) throw new Stop(`${image}: no digest for ${tagged}`)
  const have = (manifest.manifests ?? []).map((m) => `${m.platform?.os}/${m.platform?.architecture}`)
  for (const platform of PLATFORMS) {
    if (!have.includes(platform)) throw new Stop(`${image}: no ${platform} image (has ${have.join(", ")})`)
  }
  // By digest from here on, so a tag moved after this line changes nothing.
  const provenance = await inspect(`${IMAGE_PREFIX}${image}@${digest}`, "Provenance")
  for (const platform of PLATFORMS) checkProvenance(image, platform, provenance?.[platform], runId)
  console.log(`${image}: ${digest}, ${PLATFORMS.join(" and ")}, repo and commit match, built by CI run ${runId}`)
  return digest
}

try {
  const runId = await waitForCi()
  const digests = []
  for (const image of IMAGES) digests.push(await checkImage(image, runId))
  fs.writeFileSync(output, `${digests.join(" ")}\n`)
} catch (e) {
  console.error(`STOP  ${e.message}`)
  process.exit(1)
}
