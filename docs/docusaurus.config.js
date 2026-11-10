// @ts-check
// Docs for authn-authz-playground. Docs-only site (no blog, no landing page),
// served from GitHub Pages at /playaround/.
// Source of truth is PRODUCT.md and README.md in the repo: pages here summarise
// and link. See README.md in this folder for what must never be published.
import { themes as prismThemes } from 'prism-react-renderer'

const repo = 'https://github.com/vandatnguyen919/playaround'

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: 'authn-authz-playground',
  tagline: 'A BFF login playground: the browser never sees tokens',
  url: 'https://vandatnguyen919.github.io',
  baseUrl: '/playaround/',
  organizationName: 'vandatnguyen919',
  projectName: 'playaround',
  trailingSlash: true,

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
  ],

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
