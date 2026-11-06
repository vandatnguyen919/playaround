# Open

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

- **Trivy ignores expire 2026-11-30** (`.trivyignore.yaml`). After that
  every CI run fails until the Spring Boot BOM item below is decided.
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
