# Open

## Docs site (live since 2026-11-10)

See Docs site and Current state in PRODUCT.md, and `docs/README.md`. Left:

- **Dan's four other Pages projects moved address** when the custom domain came off the
  user site, back to `vandatnguyen919.github.io/<repo>/`. Next action: Dan updates any link
  that used the old addresses.
- **Content was written from PRODUCT.md, README and the code, and not reviewed by Dan.**
  Next action: Dan reads the live pages.
- **`bff-architecture.excalidraw` was written by a script, not saved from Excalidraw,** and
  has not been opened there. Next action: Dan opens it at excalidraw.com once; if it loads
  wrong, redraw from the SVG.

## Verification (2026-11-08)

See Verification in PRODUCT.md and Verify in README.md. Left:

- **CI on PR #38:** the first two runs failed only on back-channel logout (the gateway
  Keycloak test and smoke), on Linux. The cause was in the gateway, not the tests: Spring
  Security 7.1 replays the logout to the host Keycloak called (`host.docker.internal`),
  which a Linux host does not resolve. The gateway now replays to localhost (SecurityConfig),
  and the test calls the gateway by a name only Keycloak's container knows, so it fails on
  every OS if this comes back. Next action: confirm the next CI run is green.
- **`./verify compose` fails locally on setup:** `deploy/compose/.env` has no
  `JENKINS_CLIENT_SECRET`, so `docker compose` refuses the file (see Jenkins CD below).
  Next action: Dan adds it to the local env file.
- **Stale dev Keycloak container** (see Local Vault): `verify-stack.mjs up` runs
  `docker compose up keycloak` when nothing answers on :8080, which may replace it. The
  2026-11-08 run used a separate compose project, `playground-verify`, instead. Next action:
  Dan decides on the stale container before running `verify-stack.mjs up` locally.
- **Keycloak in Testcontainers is slow here:** about 6 minutes per module on Docker Desktop
  (gateway and api each start one). Next action, if it hurts: share one container across both
  modules or enable Testcontainers reuse.
- **Flaky-policy entry, 2026-11-08, `./verify` (all defaults):** `attacks` was BLOCKED. The
  single 5 s probe of Keycloak on :8080 failed right after the `gateway` and `api` suites,
  and `smoke` passed against the same Keycloak a minute later. Suspected cause: the host
  was loaded by the Testcontainers Keycloaks. Change: a need now gets 30 s to answer. The
  run stays red. Next action: watch for a repeat.
- **Flaky-policy entry, 2026-11-10, CI job `verify` on PR #46 (head f810dcb, run
  42762088039):** failed in "Start the stack", before any suite ran. `docker compose up`
  got `keycloak Error received unexpected HTTP status: 504 Gateway Time-out` from the
  registry while pulling the Keycloak image. Suspected cause: a registry outage; the PR
  changes only docs files, and `gradle`, which pulls the same image through Testcontainers,
  passed in the same run. That run stays red. The commit that adds this entry starts a new
  run. Next action: if image pulls fail again, consider a pull retry in
  `verify-stack.mjs`, which is setup, not a test retry (Dan decides).
- **Quarantined tests:** none.
- **Local stack on this machine (2026-11-09):** `JAVA_HOME` is JDK 21 and
  `playground-prod-gateway-1` holds 9181, so the stack started only with
  `COMPOSE_PROJECT_NAME=playground-verify MANAGEMENT_PORT=9191
  VERIFY_JAVA=".../jdk-27/bin/java.exe" node verify-stack.mjs up`, then
  `MANAGEMENT_URL=http://localhost:9191 node verify.mjs`. Next action: Dan
  decides whether the local prod stack keeps running.

## Local Vault (2026-11-07)

See Secrets: Vault and Current state in PRODUCT.md, runbook in `infra/vault/README.md`. Left:

- **Phase 2:** the Kubernetes auth method, one role per service, the `azurekeyvault` seal,
  Raft snapshots, and applying the External Secrets manifests. Next action: part of phase 2.
- **Secrets on this disk that Gitleaks flags, all ignored by git:** `deploy/compose/.env`
  (local prod stack) and `deploy/terraform/bootstrap/terraform.tfstate`. Next action: Dan
  decides whether the state file is worth moving. Nothing is in git history.
- **Stale dev Keycloak container:** `a931a2a25821_authn-authz-playground-keycloak-1`, stopped,
  left by an earlier recreate. Not touched, since its H2 may hold dev data. The next
  `docker compose up` may replace it. Next action: Dan removes it if the data is not wanted.

## Jenkins CD (live on the VM, phase 1 of Jenkins closed 2026-11-06)

See Jenkins and Current state in PRODUCT.md, runbook in `deploy/k8s/jenkins/README.md`. Left:

- **Local stacks:** `compose.prod.yml` now refuses to start without `JENKINS_CLIENT_SECRET`.
  The VM has it. Any local stack env file needs it too.
- **Copy of `.env`:** it gained `JENKINS_CLIENT_SECRET`. Next action: Dan updates the copy in
  the password manager.
- **Not proven on the VM:** a real Blob upload of Jenkins history (wiring checked with a stub
  `azcopy`). Next action: after 19:30 UTC check `kubectl -n ci get jobs`. Also the block on
  `169.254.169.254`.
- **A smoke failure on the public site was not run.** It would break the site for real, for
  about 2 minutes per deploy plus the rollback. Next action: Dan decides whether to run it.
- **Tight memory:** controller 627 of 640 Mi in the worst full run, about 530 in others.
  An OOM kill during a deploy was not tested. Next action: move 64 Mi from the agent (peak
  253 of 384), which keeps the 1.0 GB budget, and rerun the drill.
- **Disk:** every release leaves its images on the VM's 64 GiB data disk, and nothing prunes
  them. Next action: add pruning that keeps the good releases' images, before the disk fills.
- **Downtime:** a deploy restarts all three images, about 2 minutes unavailable on the
  stand-in. Accepted for one instance; phase 2 can do better.
- **Provenance is not signed:** revisit with `actions/attest-build-provenance` if anyone
  else gets write access to the packages.

## Images for phase 1 (2026-10-31)

Built and checked locally: see Current state in PRODUCT.md and
`.shipit/records/images-2026-10-31.md`. Left:

- **Keycloak base findings left in 26.8.2** (2026-11-09; 26.8.2 fixed the
  ca-certificates Critical and OpenJDK CVE-2026-91415): OpenJDK 21
  CVE-2026-91403 and sqlite-libs CVE-2026-119373 / CVE-2026-119586 (no fix
  yet), guava 33.6.0 CVE-2026-102554 (fixed in 33.7.2, bundled by Keycloak).
  CI does not scan images, so nothing fails on them. Next action: take the
  next 26.8.x image when Dependabot offers it.
- **Dependabot #20 and #32** overlap the 2026-11-09 bump. #32 (Keycloak
  26.8.2) is fully covered and can be closed. #20 also moves Spring Cloud to
  2025.1.4 and the Gradle wrapper, which stay Dan's call.

## Azure for Students replaces Oracle Cloud (2026-10-30)

Decided: see Deployment platform in PRODUCT.md. Host provisioned and hardened:
see Current state. The meter is running. Left:

- **DNS by hand:** `app.tickin.me` and `auth.tickin.me` resolve to
  `104.215.148.123`, not proxied, set by Dan, not through `envs/dns`. Next action:
  move them into `dns-cloudflare` with the mail records, which needs a Cloudflare
  token (a Stop).
- **Google and GitHub buttons do not work in public** (placeholders). Next action:
  Dan decides between real credentials (a Stop) and hiding them until then.
- **Backups still to be seen working (see `deploy/compose/RESTORE.md`):** the resolve
  mail arrived after Dan verified the receiver; a firing mail has not been seen since.
  Next action: on the next real firing, confirm its mail arrives. On 2026-11-06 check `backup.sh list` shows the 19:00 UTC dump; on or after
  2026-11-20 check the 2026-11-05 dump is gone, which proves the lifecycle rule.
- **Drill scratch left (2026-11-05):** on the VM, stopped Docker project
  `playground-drill` with its volumes, `/srv/playground/drill.dump` and `drill.env`;
  on Dan's machine, Docker projects `playground-drill` and `playground-drill2` with
  their volumes, and a plain dump in the session scratchpad. Next action: Dan decides
  on removing them (deleting a database or backup is a Stop).
- **Copy of `.env` in a password manager:** it lives only on the data disk. Next
  action: Dan keeps one (RESTORE.md).
- **k3s and the firewall (phase 2):** `ufw` and `DOCKER-USER` were written for
  Docker; Jenkins' k3s added two `ufw` rules for its pods. Next action: revisit them when
  k3s replaces compose.
- **Install Terraform 1.17.1 properly:** this session ran a checksum-checked copy
  from an old temp folder, and winget stops at 1.16.6. Next action: Dan installs
  it from the releases page (README).
- **Budget mail:** if no 80% mail arrives by the end of the first full month,
  the budget is not seeing cost. Next action: Dan tells Claude, then turn it
  off and keep the weekly balance check.

## Real email delivery (Resend, proven on the public host 2026-11-05)

See Email delivery and Current state in PRODUCT.md. Left:

- **`send.tickin.me` records, unexplained:** MX `feedback.forge.rmta.net` and an
  SPF with fixed IPs. Mail uses `rsend.tickin.me`. Next action: Dan says whether
  they are needed, then remove them if not.
- **DMARC:** move to `p=quarantine` after a week of clean reports in Cloudflare.
- Later: put the DNS records in `dns-cloudflare` once Terraform runs (plan not
  yet run with the MX record). The account and key stay manual.

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
