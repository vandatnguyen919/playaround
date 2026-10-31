# Open

## Azure for Students replaces Oracle Cloud (2026-10-30)

Decided: see Deployment platform in PRODUCT.md. Terraform written and
checked offline (validate, mocked `terraform test`); nothing provisioned.
Left:

- **Dan:** activate the subscription (personal Microsoft account, school
  email for verification), then read the "Allowed resource deployment
  regions" policy and `az vm list-usage --location centralindia` for Bpsv2
  quota. The region follows from that.
- **First real plan:** after `az login`, run bootstrap then `envs/azure`
  per `deploy/terraform/README.md` and show Dan both plans (apply is a
  Stop). Unproven until then: the arm64 Ubuntu image in the chosen region,
  the Bpsv2 quota, the student region policy, and cloud-init on a real VM
  (data disk at LUN 0, Docker on `/srv`).
- **Backup jobs** are not written yet: nightly `pg_dump` plus `azcopy login
  --identity` upload to the backup container (phase 1).
- **Email tooling still says OCI:** rewrite `deploy/compose/EMAIL.md` step 1
  and the `SMTP_*` / `MAIL_*` comments in `.env.example` for Brevo once Dan
  agrees to the account. `mailcheck.mjs` needs no change.

## Real email delivery (2026-10-29)

Built and checked locally: see Email delivery in PRODUCT.md. Left, blocked on
Dan (Stops: new vendor account, a domain, DNS):

- **Brevo account and SMTP key** (replaces the OCI step 1 in
  `deploy/compose/EMAIL.md`, which is out of date).
- **Domain and DNS records** (SPF, DKIM CNAME, DMARC), step 2. Needs the
  domain on Cloudflare.
- **Proof:** `mailcheck.mjs dns`, then `send <real mailbox>`, then `headers`
  on both saved originals must pass; both links must work. Can run against
  the local prod stack (`--insecure`, `PUBLIC_IP=127.0.0.1`) before the VM
  exists, since the mail leaves through Brevo either way.
- Later: put the Brevo DNS records in `dns-cloudflare` once Terraform
  exists. The Brevo account and SMTP key stay manual (the key would land
  in state).

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
