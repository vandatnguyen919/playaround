// Drill only. Stands in for the two GitHub calls the pipeline makes: the workflow runs of
// a commit (/api/...) and raw files at a commit (/raw/<sha>/<path>, which the stand-in VM
// fetches). drill.mjs sets a commit's CI state with POST /state/<sha>, and unpacks files
// under /raw with docker exec.
import fs from "node:fs"
import http from "node:http"
import path from "node:path"

const REPO = "vandatnguyen919/playaround"
const runs = new Map()

http
  .createServer((req, res) => {
    const url = new URL(req.url, "http://x")
    const state = url.pathname.match(/^\/state\/([0-9a-f]{40})$/)
    if (req.method === "POST" && state) {
      let body = ""
      req.on("data", (d) => (body += d))
      req.on("end", () => {
        runs.set(state[1], JSON.parse(body))
        res.end("ok")
      })
      return
    }
    if (url.pathname === `/api/repos/${REPO}/actions/workflows/ci.yml/runs`) {
      const sha = url.searchParams.get("head_sha")
      const run = runs.get(sha)
      res.setHeader("content-type", "application/json")
      res.end(JSON.stringify({ workflow_runs: run ? [{ head_sha: sha, head_branch: "main", repository: { full_name: REPO }, created_at: "2026-11-06T00:00:00Z", ...run }] : [] }))
      return
    }
    if (url.pathname.startsWith("/raw/")) {
      const file = path.normalize(url.pathname)
      if (file.startsWith("/raw/") && fs.existsSync(file) && fs.statSync(file).isFile()) {
        fs.createReadStream(file).pipe(res)
        return
      }
    }
    res.statusCode = 404
    res.end("not found")
  })
  .listen(8080)
