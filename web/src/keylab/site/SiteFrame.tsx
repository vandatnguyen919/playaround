import { useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useParams } from 'react-router'
import { SIGN_IN_URL } from '../api/problem.ts'
import './site.css'

// The public site frame: MktNav.dc.html on top, MktFooter.dc.html below.
// Pages that are not built yet go to /keylab/pages/<name>, which says so.

const NAV = [
  { label: 'Features', to: '/keylab/pages/features' },
  { label: 'Switch library', to: '/keylab/library' },
  { label: 'Pricing', to: '/keylab/pages/pricing' },
  { label: 'Community', to: '/keylab/pages/community' },
]

const FOOTER = [
  {
    title: 'Product',
    links: [
      ['Build a keyboard', '/keylab'],
      ['Switch library', '/keylab/library'],
      ['Sound playground', '/keylab/playground'],
      ['Pricing', '/keylab/pages/pricing'],
    ],
  },
  {
    title: 'Community',
    links: [
      ['Builds gallery', '/keylab/pages/community'],
      ['Share a build', '/keylab/builds'],
      ['[DISCORD LINK]', '/keylab/pages/discord'],
      ['[NEWSLETTER]', '/keylab/pages/newsletter'],
    ],
  },
  {
    title: 'Support',
    links: [
      ['FAQ', '/keylab/pages/faq'],
      ['Help center', '/keylab/pages/help'],
      ['Contact us', '/keylab/pages/contact'],
      ['Request a switch', '/keylab/pages/request-a-switch'],
    ],
  },
  {
    title: 'Legal',
    links: [
      ['Terms', '/keylab/pages/terms'],
      ['Privacy', '/keylab/pages/privacy'],
      ['Cookies', '/keylab/pages/cookies'],
      ['Sound credits', '/keylab/pages/sound-credits'],
    ],
  },
]

function Logo({ footer = false }: { footer?: boolean }) {
  return (
    <>
      <span aria-hidden="true" className={footer ? 'mk-logo-k foot' : 'mk-logo-k'}>
        K
      </span>
      <span className={footer ? 'mk-logo-t foot' : 'mk-logo-t'}>KEYLAB</span>
    </>
  )
}

export default function SiteFrame() {
  // The menu belongs to the page it was opened on: following a link closes it.
  const location = useLocation()
  const [openOn, setOpenOn] = useState<string | null>(null)
  const open = openOn === location.pathname
  const setOpen = (value: boolean) => setOpenOn(value ? location.pathname : null)

  return (
    <div className="kl mk">
      <a className="kl-skip" href="#mk-main">
        Skip to content
      </a>
      <header className="mk-nav">
        <div className="mk-nav-in">
          <Link to="/keylab/home" aria-label="KeyLab home" className="mk-logo">
            <Logo />
          </Link>
          <nav aria-label="Main" className="mk-links">
            {NAV.map((item) => (
              <NavLink key={item.to} to={item.to} className="mn-l">
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="mk-cta">
            <a className="mn-b ghost" href={SIGN_IN_URL}>
              Log in
            </a>
            <Link className="mn-b go" to="/keylab">
              Start building
            </Link>
          </div>
          <div className="mk-cta-m">
            <Link className="mn-b go sm" to="/keylab">
              Start
            </Link>
            <button
              type="button"
              className="mn-b icon"
              aria-expanded={open}
              aria-controls="mn-menu"
              aria-label={open ? 'Close menu' : 'Open menu'}
              onClick={() => setOpen(!open)}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="3" strokeLinecap="square" aria-hidden="true">
                <path d={open ? 'M6 6l12 12M18 6L6 18' : 'M4 7h16M4 12h16M4 17h16'} />
              </svg>
            </button>
          </div>
        </div>
        {open && (
          <nav id="mn-menu" aria-label="Main" className="mk-menu">
            {NAV.map((item) => (
              <NavLink key={item.to} to={item.to} className="mn-m">
                {item.label}
              </NavLink>
            ))}
            <a className="mn-m" href={SIGN_IN_URL}>
              Log in
            </a>
          </nav>
        )}
      </header>
      <Outlet />
      <footer className="mk-foot">
        <div className="mk-foot-in">
          <div className="mk-foot-brand">
            <span className="mk-logo">
              <Logo footer />
            </span>
            <p>Hear a mechanical keyboard before you buy a single part.</p>
          </div>
          {FOOTER.map((col) => (
            <nav key={col.title} aria-label={col.title} className="mk-foot-col">
              <h2>{col.title}</h2>
              {col.links.map(([label, to]) => (
                <Link key={label} className="mf-l" to={to}>
                  {label}
                </Link>
              ))}
            </nav>
          ))}
        </div>
        <div className="mk-foot-bar">
          <div className="mk-foot-bar-in mono">
            <span>© {new Date().getFullYear()} KeyLab</span>
            <span>Keyboard sounds recorded in-house</span>
          </div>
        </div>
      </footer>
    </div>
  )
}

/** A public page that is not built yet. */
export function SitePlaceholder() {
  const { page = '' } = useParams()
  const title = page.replace(/-/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) || 'Nothing here'
  return (
    <main id="mk-main" className="mk-main" tabIndex={-1}>
      <section className="mk-hero">
        <div className="wrap mk-hero-in">
          <h1 className="mk-h1">{title.toUpperCase()}</h1>
          <p className="mk-body">This page is not built yet.</p>
        </div>
      </section>
    </main>
  )
}
