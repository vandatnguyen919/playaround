#!/usr/bin/env node
// Scans what the docs site publishes for things it must never hold: secrets
// and dev defaults, dev user passwords, the public domain and VM address,
// private container hostnames, Vault paths, and budget or cloud account
// details. It reads the sources (docs/, static/, the config and sidebar, which
// also cover Mermaid text) and the built HTML and sitemap in build/.
// Run after `npm run build`; `./verify docs` does both.
//
//   node check-public.mjs            scan the sources and build/
//   node check-public.mjs <dir>      scan every text file in a folder (used to test the check)
//
// Exit 0 when clean, 1 with file and match on any hit, 2 when build/ is missing.
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { dirname, extname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const only = process.argv[2]
const rules = [
  ["dev user password", /\b(alice|admin)1234\b/i],
  ["dev secret default", /(gateway-dev-secret|redis-dev-password)/i],
  ["public domain", /tickin\.me/i],
  ["public IPv4 address", /\b(?!127\.|0\.0\.0\.0|10\.|192\.168\.|169\.254\.)(?:\d{1,3}\.){3}\d{1,3}\b(?!\.\d)/],
  ["private IPv4 address", /\b(10\.\d{1,3}|192\.168|169\.254)\.\d{1,3}\.\d{1,3}\b/],
  ["container-only hostname", /(host\.docker\.internal|\/\/(keycloak|redis|mailpit|vault|lgtm|gateway|api|traefik)(:\d+)?\/)/i],
  ["Vault path", /secret\/(data\/)?playground/i],
  ["Vault token or key file", /(init\.json|hvs\.[A-Za-z0-9]{8,})/],
  ["cloud account detail", /(rg-playground|vm-playground|MS-AZR-|Standard_B\d|southeastasia|subscription id)/i],
  ["budget detail", /(\$\s?\d{2,}(\.\d+)?\s*(a|per)\s*(month|year)|\$100 credit|Azure for Students)/i],
  ["JWT", /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/],
  ["private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
]

// Version numbers such as 26.8.2.1 look like IPv4. Only these exact ones are allowed.
const allowedIps = new Set(["26.0.2.1"])

const textFiles = new Set([".html", ".js", ".json", ".xml", ".txt", ".css", ".md", ".mdx", ".map", ".svg", ".excalidraw"])

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(path)
    else if (textFiles.has(extname(entry.name))) yield path
  }
}

const builtOnly = new Set([".html", ".xml", ".txt"])
let sources
if (only) {
  sources = [...walk(only)]
} else {
  const build = join(HERE, "build")
  if (!existsSync(build)) {
    console.error("Nothing to scan: build/ does not exist. Run npm run build first.")
    process.exit(2)
  }
  sources = [
    ...walk(join(HERE, "docs")),
    ...(existsSync(join(HERE, "static")) ? walk(join(HERE, "static")) : []),
    join(HERE, "docusaurus.config.js"),
    join(HERE, "sidebars.js"),
    ...[...walk(build)].filter((f) => builtOnly.has(extname(f))),
  ]
}

const hits = []
for (const file of sources) {
  const name = relative(only ?? HERE, file)
  // Inline icons in the built HTML are path data, whose number runs can look
  // like addresses. Diagrams are drawn in the browser, so their text is not
  // in these SVGs; it is scanned in the Markdown sources.
  const raw = readFileSync(file, "utf8")
  const text = extname(file) === ".html" ? raw.replace(/<svg[\s\S]*?<\/svg>/g, "") : raw
  for (const [label, pattern] of rules) {
    for (const m of text.matchAll(new RegExp(pattern.source, pattern.flags + "g"))) {
      if (label === "public IPv4 address" && (allowedIps.has(m[0]) || !m[0].split(".").every((n) => Number(n) <= 255))) continue
      const at = Math.max(0, m.index - 40)
      hits.push(`${name}: ${label}: ...${text.slice(at, m.index + m[0].length + 40).replace(/\s+/g, " ")}...`)
    }
  }
}

if (hits.length) {
  console.error(`check-public: ${hits.length} match(es) in ${sources.length} files`)
  for (const h of [...new Set(hits)].slice(0, 50)) console.error(`  ${h}`)
  process.exit(1)
}
console.log(`check-public: clean, ${sources.length} files scanned`)
