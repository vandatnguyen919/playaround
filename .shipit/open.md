# Open

## Keycloak production readiness (2026-10-28)

Done and checked locally: see Current state in PRODUCT.md. Left:

- **Permanent admin for keycloak-config.** It signs in with the bootstrap admin
  client, which Keycloak marks temporary. Next action: create a permanent
  service account client in the master realm and point `KC_CONFIG_CLIENT_*`
  at it. Master realm edits must run last in a session (see
  `keycloak-admin-url`): a master frontend URL change moves the token issuer.
- **Multi-arch image to GHCR.** Only a local amd64 build was made. Next action:
  `docker buildx build --platform linux/arm64,linux/amd64 --push` to
  `ghcr.io/vandatnguyen919/playground-keycloak` and check with
  `docker buildx imagetools inspect` (needs a GitHub token: a Stop).
- **Rest of phase 1 compose.** Gateway, api, web and Redis need Dockerfiles and
  services in `deploy/compose/compose.prod.yml`. `smoke.mjs` against the public
  URL also needs a way to create its throwaway users (it uses the master realm
  admin API, which is not public).
