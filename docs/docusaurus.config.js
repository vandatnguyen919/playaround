// @ts-check
// Docs for authn-authz-playground. Docs-only site (no blog, no landing page),
// served from GitHub Pages at /playaround/.
// Source of truth is PRODUCT.md and README.md in the repo: pages here summarise
// and link. See README.md in this folder for what must never be published.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import yaml from 'js-yaml'
import { themes as prismThemes } from 'prism-react-renderer'

const repo = 'https://github.com/vandatnguyen919/playaround'
const baseUrl = '/playaround/'

// KeyLab API reference. The spec stays in keylab/ (outside the pages) and is
// copied into .generated/ each time the site starts or builds, so the page always
// shows the current openapi-v1.yaml. check-public scans the copy in build/.
// The copy puts each operation's x-endpoint-id in front of its summary
// ("CAT-01 · List switches") so the IDs show in the page's nav and search.
// Scalar's browser bundle is copied too, so the page loads nothing from a CDN.
const generated = new URL('./.generated/', import.meta.url)
mkdirSync(new URL('./keylab/', generated), { recursive: true })
writeFileSync(new URL('./keylab/openapi-v1.yaml', generated), keylabSpec(new URL('./keylab/openapi-v1.yaml', import.meta.url)))
copyFileSync(new URL('./node_modules/@scalar/api-reference/dist/browser/standalone.js', import.meta.url), new URL('./scalar-standalone.js', generated))

/** Reads the KeyLab spec and prefixes every summary with its endpoint ID. */
function keylabSpec(file) {
  const spec = yaml.load(readFileSync(file, 'utf8'))
  const methods = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']
  for (const [path, item] of Object.entries(spec.paths)) {
    for (const method of methods) {
      const op = item[method]
      if (!op) continue
      const id = op['x-endpoint-id']
      if (!id) throw new Error(`keylab/openapi-v1.yaml: ${method.toUpperCase()} ${path} has no x-endpoint-id`)
      op.summary = op.summary ? `${id} · ${op.summary}` : id
    }
  }
  return yaml.dump(spec, { lineWidth: -1, noRefs: true })
}

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: 'authn-authz-playground',
  tagline: 'A BFF login playground: the browser never sees tokens',
  url: 'https://vandatnguyen919.github.io',
  baseUrl,
  organizationName: 'vandatnguyen919',
  projectName: 'playaround',
  trailingSlash: true,

  staticDirectories: ['static', '.generated'],

  onBrokenLinks: 'throw',
  onBrokenAnchors: 'throw',
  onDuplicateRoutes: 'throw',

  markdown: {
    mermaid: true,
    hooks: {
      onBrokenMarkdownLinks: 'throw',
      onBrokenMarkdownImages: 'throw',
    },
  },
  themes: [
    '@docusaurus/theme-mermaid',
    // Search over every page. The index is built with the site and searched in
    // the browser: no outside service, no key, nothing sent anywhere.
    [
      '@easyops-cn/docusaurus-search-local',
      {
        hashed: true,
        indexBlog: false,
        docsRouteBasePath: '/',
        language: ['en'],
        highlightSearchTermsOnTargetPage: true,
        explicitSearchResultPath: true,
      },
    ],
  ],

  plugins: [
    // The Mermaid theme imports the optional ELK layout package behind a flag
    // that is false when the package is absent, but webpack 5.112 still tries
    // to resolve it and fails the build. Resolve it to an empty module; the
    // import never runs. Remove once a build passes without this.
    function mermaidElkStub() {
      return {
        name: 'mermaid-elk-stub',
        configureWebpack() {
          return { resolve: { alias: { '@mermaid-js/layout-elk': false } } }
        },
      }
    },
    [
      '@scalar/docusaurus',
      {
        label: 'KeyLab API',
        route: '/keylab-api/',
        cdn: `${baseUrl}scalar-standalone.js`,
        configuration: {
          url: `${baseUrl}keylab/openapi-v1.yaml`,
          // Nothing leaves the page: no hosted fonts, no AI chat, no request proxy.
          withDefaultFonts: false,
          agent: { disabled: true },
          hideClientButton: true,
          showDeveloperTools: 'never',
        },
      },
    ],
  ],

  // Click an image or diagram to open it in a zoom view.
  clientModules: ['./src/zoom.js'],

  i18n: { defaultLocale: 'en', locales: ['en'] },

  presets: [
    [
      'classic',
      /** @type {import('@docusaurus/preset-classic').Options} */
      ({
        docs: {
          routeBasePath: '/',
          sidebarPath: './sidebars.js',
          editUrl: `${repo}/edit/main/docs/`,
        },
        blog: false,
        theme: { customCss: './src/css/custom.css' },
      }),
    ],
  ],

  themeConfig:
    /** @type {import('@docusaurus/preset-classic').ThemeConfig} */
    ({
      colorMode: { respectPrefersColorScheme: true },
      navbar: {
        title: 'authn-authz-playground',
        items: [
          { type: 'docSidebar', sidebarId: 'docs', position: 'left', label: 'Docs' },
          { href: repo, label: 'GitHub', position: 'right' },
          { type: 'search', position: 'right' },
        ],
      },
      footer: {
        style: 'dark',
        links: [
          {
            title: 'Docs',
            items: [
              { label: 'Overview', to: '/' },
              { label: 'Architecture', to: '/architecture/' },
              { label: 'Running locally', to: '/running-locally/' },
            ],
          },
          {
            title: 'Source of truth',
            items: [
              { label: 'PRODUCT.md (plan and decisions)', href: `${repo}/blob/main/PRODUCT.md` },
              { label: 'README.md (walkthroughs)', href: `${repo}/blob/main/README.md` },
            ],
          },
        ],
        copyright: 'A learning project. Built with Docusaurus.',
      },
      prism: {
        theme: prismThemes.github,
        darkTheme: prismThemes.dracula,
        additionalLanguages: ['bash', 'json', 'yaml', 'java'],
      },
      mermaid: { theme: { light: 'neutral', dark: 'dark' } },
    }),
}

export default config
