import { useEffect } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router'
import Toast, { type Notice } from './Toast.tsx'
import './admin.css'

// The admin dashboard frame: AdminSidebar.dc.html on the left, each page
// brings its own AdminTopbar. Counts on the sidebar and the catalog publish
// date come from stories not built yet, so they are left out until then.

const ICONS = {
  overview: 'M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z',
  switches: 'M12 2.5v7M8.5 6h7M4.5 11h15v9.5h-15z',
  sounds: 'M3 12h2l2-6 3 12 3-9 2 5 2-2h4',
  keycaps: 'M3.5 19.5h17L18 6H6zM9 10.5h6',
  mods: 'M4 7h9M17 7h3M4 17h3M11 17h9M13 5h4v4h-4zM7 15h4v4H7z',
  users:
    'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20c.5-4 3.2-6 6.5-6s6 2 6.5 6M16 4.5a3.3 3.3 0 0 1 0 6.3M18 14c2.2.6 3.4 2.6 3.6 6',
  community: 'M4 5h16v11H9l-5 4zM8 9h8M8 12.5h5',
  reports: 'M5 20V10M10 20V4M15 20v-7M20 20v-11',
  settings:
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1',
}

const ITEMS: { to: string; label: string; icon: keyof typeof ICONS; end?: boolean }[] = [
  { to: '/keylab/admin', label: 'Overview', icon: 'overview', end: true },
  { to: '/keylab/admin/switches', label: 'Switches', icon: 'switches' },
  { to: '/keylab/admin/sounds', label: 'Sound library', icon: 'sounds' },
  { to: '/keylab/admin/keycap-sets', label: 'Keycap sets', icon: 'keycaps' },
  { to: '/keylab/admin/mods', label: 'Mods', icon: 'mods' },
  { to: '/keylab/admin/users', label: 'Users', icon: 'users' },
  { to: '/keylab/admin/community', label: 'Community builds', icon: 'community' },
  { to: '/keylab/admin/reports', label: 'Reports', icon: 'reports' },
  { to: '/keylab/admin/settings', label: 'Settings', icon: 'settings' },
]

export function Icon({ path, size = 18, stroke = 2.4 }: { path: string; size?: number; stroke?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden="true"
      className="ad-ic"
    >
      <path d={path} />
    </svg>
  )
}

export default function AdminShell() {
  return (
    <div className="kl kl-admin ad">
      <a className="kc ad-skip" href="#ad-main">
        Skip to content
      </a>
      <div className="ad-side">
        <nav aria-label="Admin" className="asb">
          <Link to="/keylab/admin" aria-label="KeyLab admin, overview" className="asb-logo">
            <span aria-hidden="true" className="asb-mark">
              K
            </span>
            <span className="asb-word">KEYLAB</span>
            <span className="asb-tag">ADMIN</span>
          </Link>
          <div className="asb-items">
            {ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                title={item.label}
                className={({ isActive }) => (isActive ? 'sbi on' : 'sbi')}
              >
                <Icon path={ICONS[item.icon]} />
                <span className="sbi-label">{item.label}</span>
              </NavLink>
            ))}
          </div>
          <div className="asb-foot">
            <Link className="asb-site" to="/keylab" title="View public site">
              <Icon path="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6" size={16} stroke={2.6} />
              <span className="sbi-label">View public site</span>
            </Link>
          </div>
        </nav>
      </div>
      <div className="ad-col">
        <Outlet />
      </div>
    </div>
  )
}

/** AdminTopbar.dc.html: the crumb and the page title. Search, range and account come with their stories. */
export function AdminTopbar({ title, crumb }: { title: string; crumb: string }) {
  useEffect(() => {
    document.title = `KeyLab admin · ${title}`
  }, [title])
  return (
    <header className="atb">
      <div className="atb-head">
        <span className="mono atb-crumb">{crumb}</span>
        <h1 className="atb-title">{title}</h1>
      </div>
    </header>
  )
}

/** Admin pages that are not built yet. Shows a notice handed over by navigation, such as "Draft deleted". */
export function AdminPlaceholder({ title }: { title: string }) {
  const location = useLocation()
  const notice = (location.state as { notice?: Notice } | null)?.notice
  return (
    <>
      <AdminTopbar title={title} crumb="KeyLab admin" />
      <main id="ad-main" className="ad-main" tabIndex={-1}>
        <p className="ad-note">This page is not built yet.</p>
        {notice && <Toast notice={notice} />}
      </main>
    </>
  )
}
