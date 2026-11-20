import { createBrowserRouter, RouterProvider } from 'react-router'
import './styles/tokens.css'
import './styles/base.css'
import AppShell from './layout/AppShell.tsx'
import { BuildPage, Placeholder } from './pages/Pages.tsx'
import SwitchesPage from './pages/SwitchesPage.tsx'
import ModsPage from './pages/ModsPage.tsx'
import AdminShell, { AdminPlaceholder } from './admin/AdminShell.tsx'
import SwitchEditPage from './admin/switches/SwitchEditPage.tsx'
import SoundLibraryPage from './admin/sounds/SoundLibraryPage.tsx'
import SiteFrame, { SitePlaceholder } from './site/SiteFrame.tsx'
import LibraryPage from './site/LibraryPage.tsx'
import SwitchPage from './site/SwitchPage.tsx'
import LandingPage from './site/LandingPage.tsx'

// The KeyLab app, under /keylab. The gateway serves index.html for /keylab/**
// (SpaConfig), and main.tsx loads this chunk for those paths only.
const router = createBrowserRouter([
  {
    // The admin dashboard: its own frame, no app sidebar. keylab-api checks
    // the team role on every call; the pages only explain a missing one.
    path: '/keylab/admin',
    element: <AdminShell />,
    children: [
      { index: true, element: <AdminPlaceholder title="Overview" /> },
      { path: 'switches', element: <AdminPlaceholder title="Switches" /> },
      // "new" and an id share one route, so saving a new switch keeps the page.
      { path: 'switches/:id', element: <SwitchEditPage /> },
      { path: 'sounds', element: <SoundLibraryPage /> },
      { path: 'keycap-sets', element: <AdminPlaceholder title="Keycap sets" /> },
      { path: 'mods', element: <AdminPlaceholder title="Mods" /> },
      { path: 'users', element: <AdminPlaceholder title="Users" /> },
      { path: 'community', element: <AdminPlaceholder title="Community builds" /> },
      { path: 'reports', element: <AdminPlaceholder title="Reports" /> },
      { path: 'settings', element: <AdminPlaceholder title="Settings" /> },
      { path: '*', element: <AdminPlaceholder title="Nothing here" /> },
    ],
  },
  {
    // The public site: marketing nav and footer, open to guests.
    path: '/keylab',
    element: <SiteFrame />,
    children: [
      // The landing page. /keylab itself is the builder (the app).
      { path: 'home', element: <LandingPage /> },
      { path: 'library', element: <LibraryPage /> },
      { path: 'library/:slug', element: <SwitchPage /> },
      { path: 'pages/:page', element: <SitePlaceholder /> },
    ],
  },
  {
    path: '/keylab',
    element: <AppShell />,
    children: [
      { index: true, element: <BuildPage /> },
      { path: 'switches', element: <SwitchesPage /> },
      { path: 'mods', element: <ModsPage /> },
      { path: 'keycaps', element: <Placeholder label="Keycaps" title="Keycaps" /> },
      { path: 'case', element: <Placeholder label="Case & plate" title="Case & plate" /> },
      { path: 'playground', element: <Placeholder label="Playground" title="Sound playground" /> },
      { path: 'builds', element: <Placeholder label="My builds" title="My builds" /> },
      { path: 'profile', element: <Placeholder label="Profile" title="Profile" /> },
      { path: 'settings', element: <Placeholder label="Settings" title="Settings" /> },
      { path: '*', element: <Placeholder label="404" title="Nothing here" /> },
    ],
  },
])

export default function KeylabApp() {
  return <RouterProvider router={router} />
}
