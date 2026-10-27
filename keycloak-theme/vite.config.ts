import { fileURLToPath, URL } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { keycloakify } from 'keycloakify/vite-plugin/index.js'
import { defineConfig, type Plugin } from 'vite'

// Vite drops the `blocking` attribute from the source index.html, so add it to
// the built entry script. The browser then waits for the first render before
// painting, which stops the blank frame between Keycloak pages.
const renderBlockingEntry = (): Plugin => ({
  name: 'render-blocking-entry',
  apply: 'build',
  transformIndexHtml: {
    order: 'post',
    handler: (html) =>
      html.replace(/<script type="module"/, '<script blocking="render" type="module"'),
  },
})

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    renderBlockingEntry(),
    keycloakify({
      accountThemeImplementation: 'none',
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
