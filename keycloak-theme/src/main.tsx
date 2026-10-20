import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import MockupsApp from './MockupsApp.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MockupsApp />
  </StrictMode>,
)
