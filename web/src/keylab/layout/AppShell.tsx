import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet } from 'react-router'
import { useHealth } from '../api/useHealth.ts'
import { SIGN_IN_URL } from '../api/problem.ts'
import { CurrentBuild } from '../builder/RecentBuilds.tsx'
import {
  BuildIcon,
  BuildsIcon,
  CaseIcon,
  KeycapsIcon,
  ModsIcon,
  PlaygroundIcon,
  SettingsIcon,
  SwitchesIcon,
} from './icons.tsx'
import './shell.css'

type Theme = 'light' | 'dark'

const THEME_KEY = 'keylab.theme'

function storedTheme(): Theme {
  try {
    return window.localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

// Desktop sidebar, from HomeDesktop.dc.html.
const SIDE_LINKS = [
  { to: '/keylab', label: 'Build', Icon: BuildIcon, end: true },
  { to: '/keylab/switches', label: 'Switches', Icon: SwitchesIcon },
  { to: '/keylab/mods', label: 'Mods', Icon: ModsIcon },
  { to: '/keylab/keycaps', label: 'Keycaps', Icon: KeycapsIcon },
  { to: '/keylab/case', label: 'Case & plate', Icon: CaseIcon },
  { to: '/keylab/playground', label: 'Playground', Icon: PlaygroundIcon },
  { to: '/keylab/builds', label: 'My builds', Icon: BuildsIcon },
]

// Mobile tab bar, from Main.dc.html. Case and Playground are reached from the
// pages there (the header has the playground button).
const TAB_LINKS = [
  { to: '/keylab', label: 'Build', Icon: BuildIcon, end: true },
  { to: '/keylab/switches', label: 'Switches', Icon: SwitchesIcon },
  { to: '/keylab/mods', label: 'Mods', Icon: ModsIcon },
  { to: '/keylab/keycaps', label: 'Keycaps', Icon: KeycapsIcon },
  { to: '/keylab/builds', label: 'My builds', Icon: BuildsIcon },
]

function Logo() {
  return (
    <Link className="kl-logo" to="/keylab" aria-label="KeyLab home">
      <span className="kl-logo-mark" aria-hidden="true">
        K
      </span>
      <span className="kl-logo-word" aria-hidden="true">
        KEYLAB
      </span>
    </Link>
  )
}

export default function AppShell() {
  const [theme, setTheme] = useState<Theme>(storedTheme)
  const health = useHealth()
  const signedIn = health.state === 'ok' && health.health.authenticated

  useEffect(() => {
    document.title = 'KeyLab'
  }, [])

  useEffect(() => {
    try {
      window.localStorage.setItem(THEME_KEY, theme)
    } catch {
      // Private mode or blocked storage: the theme just does not persist.
    }
  }, [theme])

  return (
    <div className="kl kl-app" data-theme={theme}>
      <a className="kc sm kl-skip" href="#kl-main">
        Skip to content
      </a>

      <aside className="side" aria-label="KeyLab">
        <Logo />
        <nav className="side-nav" aria-label="Primary">
          {SIDE_LINKS.map(({ to, label, Icon, end }) => (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => (isActive ? 'sl on' : 'sl')}>
              <Icon />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="side-foot">
          <CurrentBuild />
          <button
            type="button"
            className="kc sm"
            aria-pressed={theme === 'dark'}
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          >
            {theme === 'dark' ? 'Paper theme' : 'Ink theme'}
          </button>
        </div>
        <div className="side-me">
          {signedIn ? (
            <Link className="mel" to="/keylab/profile" aria-label="Your profile">
              <span className="mel-avatar" aria-hidden="true">
                ME
              </span>
              <span className="mel-text">
                <span className="mel-name">Your profile</span>
              </span>
            </Link>
          ) : (
            <a className="mel" href={SIGN_IN_URL}>
              <span className="mel-avatar" aria-hidden="true">
                →
              </span>
              <span className="mel-text">
                <span className="mel-name">Sign in</span>
                <span className="mel-sub mono">to save builds</span>
              </span>
            </a>
          )}
          <NavLink to="/keylab/settings" className={({ isActive }) => (isActive ? 'sl on' : 'sl')}>
            <SettingsIcon />
            Settings
          </NavLink>
        </div>
      </aside>

      <header className="kl-top">
        <Logo />
        <Link className="kc icon coral" to="/keylab/playground" aria-label="Open sound playground">
          <PlaygroundIcon />
        </Link>
      </header>

      <main id="kl-main" className="kl-main" tabIndex={-1}>
        <Outlet />
      </main>

      <nav className="nav" aria-label="Primary">
        {TAB_LINKS.map(({ to, label, Icon, end }) => (
          <NavLink key={to} to={to} end={end} className={({ isActive }) => (isActive ? 'nv on' : 'nv')}>
            <span className="ic">
              <Icon size={22} stroke={2.2} />
            </span>
            {label}
          </NavLink>
        ))}
        {signedIn ? (
          <NavLink to="/keylab/profile" className={({ isActive }) => (isActive ? 'nv on' : 'nv')}>
            <span className="ic">
              <span className="nv-avatar" aria-hidden="true">
                ME
              </span>
            </span>
            Profile
          </NavLink>
        ) : (
          <a className="nv" href={SIGN_IN_URL}>
            <span className="ic">
              <span className="nv-avatar" aria-hidden="true">
                →
              </span>
            </span>
            Sign in
          </a>
        )}
      </nav>
    </div>
  )
}
