# Open

## Auth abuse protection (2026-10-29)

Done and checked: see Auth abuse protection in PRODUCT.md. Left:

- **Verify-email resend is not rate limited.** It shares
  `/login-actions/required-action` with other required actions. Next action:
  check whether Keycloak 26.8 has a resend cooldown before adding a Traefik
  rule.

## Redis and gateway hardening (2026-10-28)

Done and tested (`.\gradlew.bat :gateway:test`, `node check-headers.mjs`,
`node smoke.mjs` 40/40); see PRODUCT.md. Left:

- **Gateway in compose.prod.yml.** Redis is there; the gateway service still
  needs a Dockerfile that copies `web/dist` in (`SPA_LOCATION`), and env
  `REDIS_HOST=redis`, `FORWARD_HEADERS_STRATEGY=native`, `COOKIE_SECURE=true`,
  `APP_URL`, `MANAGEMENT_ADDRESS=0.0.0.0` for its healthcheck. Part of "Rest
  of phase 1 compose" below.

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
