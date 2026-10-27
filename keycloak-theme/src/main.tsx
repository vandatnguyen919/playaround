import { StrictMode } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import './index.css'
import KcPage from './login/KcPage'
import type { KcContext } from './login/KcContext'

// Render synchronously so the first paint is the finished page, not an empty
// shell. With the render-blocking script this keeps page switches flicker free.
flushSync(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      {window.kcContext ? (
        <KcPage kcContext={window.kcContext as KcContext} />
      ) : (
        <h1>No Keycloak context</h1>
      )}
    </StrictMode>,
  )
})
