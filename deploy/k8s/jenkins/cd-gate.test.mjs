#!/usr/bin/env node
// cd-gate.mjs against stand-ins for GitHub and buildx: every way it must refuse, and the
// one way it must pass. No network, Docker or credentials. Part of check.sh.
import { execFile } from "node:child_process"
import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"))
const run = promisify(execFile)
const SHA = "a".repeat(40)
const OTHER = "b".repeat(40)
const REPO = "vandatnguyen919/playaround"
const SOURCE = `https://github.com/${REPO}`
const RUN_ID = 777
const DIGEST = `sha256:${"c".repeat(64)}`
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cd-gate-"))

const entry = ({ source = SOURCE, revision = SHA, builder = `${SOURCE}/actions/runs/${RUN_ID}/attempts/1` } = {}) => ({
  SLSA: {
    buildDefinition: { externalParameters: { request: { args: { "label:org.opencontainers.image.source": source, "label:org.opencontainers.image.revision": revision } } } },
    runDetails: { builder: { id: builder } },
  },
})
const both = (one) => ({ "linux/amd64": one, "linux/arm64": one })
const manifest = (platforms = ["amd64", "arm64"]) => ({
  digest: DIGEST,
  manifests: [...platforms.map((architecture) => ({ platform: { os: "linux", architecture } })), { platform: { os: "unknown", architecture: "unknown" } }],
})
const success = { id: RUN_ID, status: "completed", conclusion: "success", head_sha: SHA, head_branch: "main", repository: { full_name: REPO } }

// A fake buildx: prints the file named for the format it was asked for.
const fake = path.join(dir, "fake-buildx.mjs")
fs.writeFileSync(
  fake,
  `import fs from "node:fs"
const format = process.argv[process.argv.indexOf("--format") + 1]
const file = process.env.FAKE_DIR + (format.includes("Provenance") ? "/provenance.json" : "/manifest.json")
if (!fs.existsSync(file)) { console.error("not found"); process.exit(1) }
process.stdout.write(fs.readFileSync(file))
`,
)

let runs = []
const server = http.createServer((req, res) => {
  res.setHeader("content-type", "application/json")
  res.end(JSON.stringify({ workflow_runs: runs }))
})
await new Promise((r) => server.listen(0, "127.0.0.1", r))
const api = `http://127.0.0.1:${server.address().port}`

async function gate({ ciRuns = [success], man = manifest(), prov = both(entry()) } = {}) {
  runs = ciRuns
  for (const [name, value] of [["manifest.json", man], ["provenance.json", prov]]) {
    const file = path.join(dir, name)
    if (value === null) fs.rmSync(file, { force: true })
    else fs.writeFileSync(file, JSON.stringify(value))
  }
  const output = path.join(dir, "digests.txt")
  fs.rmSync(output, { force: true })
  try {
    const { stdout } = await run(process.execPath, [path.join(HERE, "cd-gate.mjs"), SHA, output], {
      env: { ...process.env, FAKE_DIR: dir, BUILDX: `${process.execPath} ${fake}`, GITHUB_API: api, POLL_SECONDS: "0", CI_WAIT_MINUTES: "0", IMAGE_WAIT_MINUTES: "0" },
    })
    return { ok: true, stdout, digests: fs.readFileSync(output, "utf8").trim() }
  } catch (e) {
    return { ok: false, stderr: e.stderr ?? "", wrote: fs.existsSync(output) }
  }
}

let failed = 0
function expect(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  ${detail}`}`)
  if (!ok) failed++
}
async function refuses(name, setup, why) {
  const r = await gate(setup)
  expect(`refuses ${name}`, !r.ok && !r.wrote && why.test(r.stderr), JSON.stringify(r))
}

const good = await gate()
expect("passes with CI green and matching provenance", good.ok && good.digests === `${DIGEST} ${DIGEST} ${DIGEST}`, JSON.stringify(good))

await refuses("a failed CI run", { ciRuns: [{ ...success, conclusion: "failure" }] }, /concluded failure/)
await refuses("a cancelled CI run", { ciRuns: [{ ...success, conclusion: "cancelled" }] }, /concluded cancelled/)
await refuses("a commit with no CI run", { ciRuns: [] }, /no CI result/)
await refuses("a CI run still going", { ciRuns: [{ ...success, status: "in_progress", conclusion: null }] }, /no CI result/)
await refuses("a CI run of another branch", { ciRuns: [{ ...success, head_branch: "feature" }] }, /no CI result/)
await refuses("a CI run of a fork", { ciRuns: [{ ...success, repository: { full_name: "someone/playaround" } }] }, /no CI result/)
await refuses("images not published", { man: null }, /not published/)
await refuses("an image missing arm64", { man: manifest(["amd64"]) }, /no linux\/arm64 image/)
await refuses("no provenance at all", { prov: {} }, /no provenance/)
await refuses("provenance for one platform only", { prov: { "linux/amd64": entry() } }, /linux\/arm64: no provenance/)
await refuses("another repo", { prov: both(entry({ source: "https://github.com/someone/playaround" })) }, /built from repo/)
await refuses("a similarly named repo", { prov: both(entry({ source: `${SOURCE}-fork` })) }, /built from repo/)
await refuses("another commit", { prov: both(entry({ revision: OTHER })) }, /built from commit/)
await refuses("one platform from another commit", { prov: { "linux/amd64": entry(), "linux/arm64": entry({ revision: OTHER }) } }, /linux\/arm64: built from commit/)
await refuses("a build outside that CI run", { prov: both(entry({ builder: `${SOURCE}/actions/runs/778/attempts/1` })) }, /expected CI run/)
await refuses("a build on someone's machine", { prov: both(entry({ builder: "https://example.com/laptop" })) }, /expected CI run/)
await refuses("a builder in another repo", { prov: both(entry({ builder: `https://github.com/someone/playaround/actions/runs/${RUN_ID}/attempts/1` })) }, /expected CI run/)

const rerun = await gate({ prov: both(entry({ builder: `${SOURCE}/actions/runs/${RUN_ID}/attempts/3` })) })
expect("accepts a re-run attempt of the same CI run", rerun.ok, JSON.stringify(rerun))

server.close()
fs.rmSync(dir, { recursive: true, force: true })
process.exit(failed ? 1 : 0)
