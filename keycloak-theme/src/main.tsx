import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import KcPage from './login/KcPage'
import type { KcContext } from './login/KcContext'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {window.kcContext ? (
      <KcPage kcContext={window.kcContext as KcContext} />
    ) : (
      <h1>No Keycloak context</h1>
    )}
  </StrictMode>,
)
