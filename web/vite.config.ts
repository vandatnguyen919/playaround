import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The browser talks to one origin in dev: the Vite server proxies the BFF and
// the Spring Security endpoints to the gateway, and Keycloak is reached by
// redirect only. changeOrigin keeps Host as localhost:5174 so the gateway
// builds its redirect URIs against the SPA origin.
const gateway = {
  target: 'http://localhost:8181',
  changeOrigin: false,
}

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      '/api': gateway,
      '/bff': gateway,
      '/oauth2': gateway,
      '/login': gateway,
      '/logout': gateway,
    },
  },
})
