# Open

## Images for phase 1 (2026-10-31)

Built and checked locally: see Current state in PRODUCT.md and
`.shipit/records/images-2026-10-31.md`. Left:

- **First run on `main`.** Pull request checks are proven (PR #11 passes;
  #12 to #14 failed as planned and are closed). Next action: Dan merges
  #11. Unproven until then: native arm64 builds on `ubuntu-24.04-arm`,
  push by digest with `GITHUB_TOKEN`, the merge, and the attestation count
  in the inspect check.
- **Trivy ignores expire 2026-11-30** (`.trivyignore.yaml`). After that
  every CI run fails until the Spring Boot BOM item below is decided.
- **Dan, after the first run on `main`:** make the three packages public
  (GitHub, Packages, each package, Package settings, Change visibility).
  They start private, so the VM cannot pull them without a login.
- **Trivy Critical/High in Spring Boot BOM jars:** Tomcat 11.0.24 (4
  Critical, api) and Jackson 3.1.5 / 2.21.5 (High, both). Versions are
  pinned in PRODUCT.md, so Dan decides: a Spring Boot patch release that
  carries Tomcat 11.0.25 and Jackson 3.1.7 / 2.21.7, or BOM property
  overrides (`tomcat.version`, `jackson-bom.version`). Rerun gateway tests,
  smoke and Trivy after.
- **Keycloak base findings** (ca-certificates Critical, OpenJDK 21 High with
  no fix, guava High) come from `quay.io/keycloak/keycloak:26.8.1`. Next
  action: check for a 26.8.x patch image before deploy.

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

## Keycloak production readiness (2026-10-28)

Done and checked locally: see Current state in PRODUCT.md. Left:

- **Permanent admin for keycloak-config.** It signs in with the bootstrap admin
  client, which Keycloak marks temporary. Next action: create a permanent
  service account client in the master realm and point `KC_CONFIG_CLIENT_*`
  at it. Master realm edits must run last in a session (see
  `keycloak-admin-url`): a master frontend URL change moves the token issuer.
- **Multi-arch image to GHCR:** CI publishes it on `main` (see Images
  above).
- **smoke.mjs against the public URL** needs a way to create its throwaway
  users (it uses the master realm admin API, which is not public) and Redis
  access (local runs publish it with `compose.local-test.yml`, never on the
  VM). Next action: run it over the SSH tunnel with both forwarded.
