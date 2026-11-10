# docs

The documentation site: Docusaurus 3 with Mermaid, its own npm package.
Published to GitHub Pages at https://vandatnguyen919.github.io/playaround/ by
`.github/workflows/docs.yml` on a push to `main` that touches `docs/`.

```
npm ci
npm start             (dev server with hot reload, http://localhost:3000/playaround/)
npm run build         (static site in build/; fails on a broken link, anchor or image)
npm run check-public  (scans sources and build/ for content that must not be published)
npm run serve         (serves build/ locally)
```

From the repo root, `./verify docs` runs the build and the scan.

## Rules for content

- PRODUCT.md and the root README are the source of truth. Summarise and link;
  do not copy sections wholesale.
- Never publish: secrets or their dev defaults, dev user passwords, the public
  domain or VM address, container-only hostnames, Vault paths, budget or cloud
  account details. `check-public.mjs` holds the patterns; add one when a new
  kind of private value appears.
- Deployment (Azure, the VM, Jenkins, Vault) is out of scope for the site (Dan,
  2026-11-10).
- Hand-drawn diagrams are Excalidraw files in `static/img/`: the `.excalidraw` file is
  the source and the `.svg` beside it is what the page shows. To change one, open the
  `.excalidraw` file at excalidraw.com, edit, save it back, and export an SVG with a
  white background over the old one. Sequence diagrams stay in Mermaid.
- Search is `@easyops-cn/docusaurus-search-local`: the index is made by
  `npm run build`, so the search box works in `npm run serve`, not in `npm start`.
- Pages live in `docs/`, the sidebar in `sidebars.js`. A new page must be added
  to the sidebar.
