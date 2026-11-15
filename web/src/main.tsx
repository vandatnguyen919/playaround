import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'

// Two apps in one build: KeyLab under /keylab, the playground everywhere else.
// Each is its own chunk, so neither loads the other's code or styles.
const isKeylab = window.location.pathname === '/keylab' || window.location.pathname.startsWith('/keylab/')
const Root = isKeylab ? lazy(() => import('./keylab/KeylabApp.tsx')) : lazy(() => import('./App.tsx'))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense>
      <Root />
    </Suspense>
  </StrictMode>,
)
