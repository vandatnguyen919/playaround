import { createBrowserRouter, RouterProvider } from 'react-router'
import './styles/tokens.css'
import './styles/base.css'
import AppShell from './layout/AppShell.tsx'
import { BuildPage, Placeholder } from './pages/Pages.tsx'

// The KeyLab app, under /keylab. The gateway serves index.html for /keylab/**
// (SpaConfig), and main.tsx loads this chunk for those paths only.
const router = createBrowserRouter([
  {
    path: '/keylab',
    element: <AppShell />,
    children: [
      { index: true, element: <BuildPage /> },
      { path: 'switches', element: <Placeholder label="Switches" title="Switch library" /> },
      { path: 'mods', element: <Placeholder label="Mods" title="Mods" /> },
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
