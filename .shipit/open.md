# Open

## KL2-1 Parts catalog: seed and CAT-05 to CAT-08 (2026-11-20)

PR #63 open (`feat/kl2-1-parts-catalog`); Notion ticket In review with five Done when items
ticked. Left:

- **Production migration:** V5 was only simulated on a throwaway Postgres. Next action: after
  the deploy, check V5 in production's `catalog.flyway_schema_history` and tick the second
  Done when item.
- **AdminCatalog.png is stale:** its tab still reads "Mods · 6" (the `.dc.html` now says 7
  and lists the builder's mods). Next action: re-render the PNG with the next design export.

## US-05 Toggle mods and hear before and after (2026-11-20, PR #64, stacked on PR #63)

Built on top of `feat/kl2-1-parts-catalog` (PR #63), committed on `feat/us-05-mods-workshop`. BLD-10
(`GET /v1/sound-recipe`) is computed in `catalog` as decision 0001 says: `domain/SoundRecipe`,
`domain/PartSounds` port, `application/ComposeSoundRecipe`, `adapter/out/persistence/JdbcPartSounds`,
`adapter/in/web/SoundRecipeController`. `/keylab/mods` is the Mods workshop (ModsDesktop,
ModsMobile). Verified: all 147 keylab-api tests (new `SoundRecipeTest`, `SoundRecipeApiTest`),
web unit tests (46), `tsc`, lint, `vite build`, `check:api`, all KeyLab e2e incl. the new
`keylab-mods.spec.ts` (3 tests, three clean runs in a row) against the local stack, after
restarting keylab-api from the new jar. Toggle back to a heard mix: 1 to 13 ms on the
production build through the gateway (browser pane, 8 samples, real CSP); 16 to 93 ms on the
Vite dev server. An uncached BLD-10 call took 24 ms locally. Left:

- **Toggle test judges p75, not every sample:** on the dev server one sample now and then
  passed 100 ms (128, 147 ms) from machine load while the rest sat near 20 ms; decision 0001
  judges real users at p75. It also checks that no request goes out. Next action: Dan accepts
  or asks for a production-build e2e (sign-in on :8181 does not work for the e2e users).
- **Gateway rate limit (10/s, burst 20):** loading the page used to send about 19 requests, so
  recipes are no longer all fetched up front: a card's Before and After are fetched when the
  pointer or focus reaches it. A first tap on a phone card waits one round trip.

- **Recipe rule is invented:** level scaling (heavy = twice light), the shelf, gain and reverb
  formulas, the profile bases and the logistic meter (api-design-v1.md, BLD-10 details). They
  sound plausible with the seed but nobody has listened to real takes. Next action: Dan listens
  with a real switch and tunes the numbers in `SoundRecipe`.
- **Spring swap makes no sound:** its seeded `sound_fx` is all zero, and "lighter" and
  "heavier" go in opposite directions, which one set of steps scaled by level cannot express.
  Before and After play the same, and the meter stays when it is toggled. Next action: Dan
  decides whether mods get one `sound_fx` per level (a V6 migration and the ADM-07 editor).
- **Variant is not tied to lube:** the page always asks for the stock takes and lube works
  through its filters. Sending `variant=lubed` too would count lube twice. Next action: decide
  with real lubed takes.
- **CAT-07 gained `impact`** (the card's sticker); openapi, api-design and the e2e of
  PartsCatalogApiTest updated.
- **Copy not in the design:** "This switch could not be loaded." with "Pick a switch", "The mods
  could not be loaded. Reload to try again.", "This sound could not be played.", "…" in the
  meter before the first recipe. On a phone "Mods workshop" wraps to two lines beside Reset;
  the design fits it on one. Not built: the sidebar "Current build" card (waits for
  builds). The switch comes from `?switch=`, else the one from "Use in a build" (kept in
  localStorage `keylab.build` with the mods), else the first recorded switch.
- **Production:** the local library had no published switch with sound, so only test switches
  were heard, with silent WAVs. Next action: after deploy, open `/keylab/mods` on
  app.tickin.me and listen.

## US-06 Pick a keycap set and hear the shift (2026-11-22, PR #70, stacked on PR #64)

Committed on `feat/us-06-keycaps-studio`, on top of `feat/us-05-mods-workshop` (PR #64). No backend
change: CAT-05, CAT-06 and BLD-10's `keycap_set` already ship in `catalog` (KL2-1, US-05).
`/keylab/keycaps` is the Keycaps studio (KeycapsDesktop, KeycapsMobile): `pages/KeycapsPage.tsx`,
`builder/keycaps.ts`, the preview `Keyboard` takes a set's colours and profile. The set is kept
in `keylab.build` (`keycapSet`), and the Mods workshop now sends it with every recipe.
Verified: web unit tests (53, new `keycaps.test.ts`), `tsc`, lint, `vite build`, `check:api`,
new `keylab-keycaps.spec.ts` (3 tests; it fails when `keycap_set` is left out of the recipe
call) and all 21 KeyLab e2e against the local stack. keylab-api tests not rerun (no change).
Left:

- **Review.** Ticket ticked, PR set, In review. Next action: Dan reviews PR #70 after PR #64.
- **The design and the data disagree on what a pick is:** the screens pick profile, material
  and colourway on their own and add a custom painter; a keycap set (CAT-05, database design)
  is one material, one profile and one colourway. So Colorways lists the sets, and a Profile or
  Material pick chooses the first set with it (keeping the other choice when it can); profiles
  and materials no set has are greyed out. MT3 is not drawn: the API has no MT3. Next action:
  Dan decides whether the design changes, or sets get split into parts (an API change).
- **Not built (no story or API yet):** the 3D views, orbit and spin, the custom painter,
  legends, shine-through, artisans, Save build (US-08) and the "Current build" sidebar card.
  The phone tabs are Profile, Material and Colors only.
- **Copy not in the design:** each set's shift ("A touch deeper", "Like stock", "Brighter")
  with a small scale and "BRIGHT · | = STOCK · DEEP" under the sets; the set's
  "PBT · CHERRY" line; the hint is "Click any key to hear it." (the painter half dropped);
  POM's card ("MUTED", "Dense and slick. A soft, muted sound."), shown only when a POM set is
  published; "No keycap set in this profile yet." on a greyed tile; "The keycap sets could not
  be loaded. Reload to try again."; "No keycap sets yet.". Next action: Dan reviews.
- **Flaky-policy entry, 2026-11-22, all KeyLab e2e (local, dev server):**
  `keylab-library.spec.ts` "a guest filters the public library" failed once after "Clear
  filters" (no library card within 15 s); it passed alone and in a full rerun (21 of 21). This
  change does not touch the library. Suspected cause: load from the run before it. Next
  action: watch for a repeat.

## KL2-0 Prep: builds package plan and sound recipe decision (2026-11-20)

Done: planned trees for `builds` and `sound` and one line per other module in
`docs/keylab/modulith-plan.md` (Planned trees); decision record
`docs/keylab/decisions/0001-sound-recipe.md`, accepted by Dan: option B, BLD-10 is
server-computed in `catalog`. BLD-10 details in `api-design-v1.md` and `openapi-v1.yaml`
(module `catalog`, cache, 304, error codes), Modules table and catalog tree, both
package-info javadocs and US-05's module follow it. `unlisted` dropped from
`database-design.md` to match the API and stories. Merged in PR #62. Left:

- **sound is still in the pre-KL-R1 layout.** Next action: Dan decides whether to make a
  refactor ticket (like KL-R1) to move it into the planned tree.
- **like_count:** community owns likes, the database design puts the count on `builds`.
  Next action: decide in US-21.

## KL-D1 Deploy KeyLab to production (live since 2026-11-17)

KeyLab is live on https://app.tickin.me (PRODUCT.md, Current state). Shipped by PR #58
(`3e07f7e`) and PR #59 (`cff6ddc`, Jenkins `deploy-playground/11`: healthy, smoke passed,
marked good). On the VM: V0 baseline, V1 `vm-deploy.sh` and `vm-env.sh`, V2 both KeyLab secrets,
V4 `backup.sh` with one run (Keycloak dump, KeyLab dump, files tarball) and the KeyLab dump
restored into a throwaway Postgres (15 tables in 9 schemas, as live, owned by `keylab`), V5
`keylab-write` 15 of 15 from outside. PR #60 (`589e7f9`, `deploy-playground/12`) deployed with
memory sampled every second: low 844 MiB, in PRODUCT.md. The Jenkins drill passed all 138
checks on 2026-11-18 (images from `cff6ddc`): the automatic rollback after failed smoke, the
one after a version that never got healthy, and one `rollback-playground` click each brought
back all four previous digests, keylab-api included. Old copies of the three scripts are kept
on the VM as `*.pre-kld1`. Left:

- **Dan:** open https://app.tickin.me/keylab/switches and a switch page; grant yourself
  `keylab-admin` in the admin console over the tunnel (not in the realm file); refresh the
  `.env` copy in the password manager (it gained both KeyLab secrets).
- **A rollback cannot cross a Keycloak upgrade:** 26.8.2 (in `main` since 2026-11-09, first
  deployed 2026-11-17) migrated the database, and 26.8.1 then fails (`No such provider
  'default-roles'`), so its `keycloak-config` exits 1 and the gateway never starts. Deploy #10's
  smoke failed (see below), its automatic rollback went to `c1edefd` and failed, and the app was
  down from 08:45 to about 08:51 UTC until a roll forward by hand. `rollback-playground` goes to
  the newest good release that is not running: now `cff6ddc`, then `3e07f7e` (both safe); a
  third click would go to `c1edefd` and take the site down. Next action: before a deploy that bumps Keycloak, take a
  fresh dump, and decide whether `vm-deploy.sh` should refuse a rollback to an older Keycloak
  and say to use RESTORE.md instead.
- **Keycloak 26.8.2 and our admin clients:** the Admin REST API takes only tokens with the
  built-in `kc-admin-api` scope. `smoke-access.sh open` gives the throwaway `smoke-runner` that
  scope (PR #59). Any new service client that calls the admin API needs it too.
- **Each `keylab-write` run leaves one pulled "smoke" switch** in production, since published
  switches cannot be deleted. That is why it is opt-in and not in the deploy smoke. One is
  there from 2026-11-17.
- **Rollback to the release before KeyLab** leaves keylab-api running as an orphan with its
  data; the old gateway does not call it. Not run anywhere; after the Keycloak upgrade no such
  rollback can start anyway.
- **Local stacks:** `deploy/compose/.env` needs `KEYLAB_DB_PASSWORD` and
  `KEYLAB_UPLOAD_SIGNING_KEY` before it starts with the new `compose.prod.yml`. Not changed,
  since it is Dan's file. Next action: `sh deploy/compose/vm-env.sh add-keylab-secrets`.
- **Not run:** `infra/vault/check.mjs` against a running Vault (the manifest and policies were
  checked offline).

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
- **Tight memory, and it bit (found 2026-11-17):** the controller was OOM-killed at its 640 Mi
  limit on 2026-11-12, after 3 days up. Every restart since failed in the chart's `init`
  container: the pod's plugin volume survived, `cp` asked to overwrite each plugin and got no
  answer. So Jenkins polled and mailed nothing for 5 days, and nothing alerted. Fixed by
  deleting the pod (README). Right after the restart the controller used 553 MB of 640 Mi.
  Next action: move 64 Mi from the agent (peak 253 of 384) to the controller, which keeps the
  1.0 GB budget, rerun the drill; and add an alert or mail when `jenkins-0` is not ready.
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

## KL-R1 Catalog to DDD + hexagonal (branch refactor/kl-r1-catalog-hexagonal, 2026-11-16)

Verified: all 123 keylab-api tests (the five named catalog tests unedited, new
`CatalogContractTest`, `SwitchTest`, `PublishSwitchTest`, `CatalogArchitectureTest`,
`ModularityTests`), and `node verify.mjs keylab e2e` (23 e2e) against the local stack.
No migration changed. keylab-api on :8183 was restarted from the new jar. Left:

- **PR:** not opened yet. Next action: Dan reviews the branch and opens it.
- **Public types the doc names:** the Package structure lists `CatalogApi` and
  `SwitchPublished` in catalog's root; neither exists yet. `SwitchEvent.Published` is
  recorded and published inside catalog, but nothing listens. Next action: when
  `sound` needs it (Module map), make a public `SwitchPublished` from it.
- **Test shim:** `application/AdminSwitches` stays only so `AdminSwitchesTest` runs
  unedited; `CatalogArchitectureTest` exempts it by name. Next action: Dan decides whether
  to move that test to `Slug` and `JsonMergePatch` and delete the shim.

## US-03 Compare switch sounds (branch feature/us-03-compare-sounds, 2026-11-16)

Verified: web unit tests (36, incl. `compare.test.ts`), `tsc`, lint, `vite build`,
`check:api`, and all 15 KeyLab e2e incl. the new `keylab-compare.spec.ts` (landing strip
plays the right files and draws waveforms before any audio is fetched; compare mode picks
three, ignores a fourth and a switch with no sound, plays in turn in pick order; mobile)
against the local stack. No backend change: CAT-01 to CAT-03 already serve it. Left:

- **Module:** the story names `sound`, but CAT-01 to CAT-03 live in `catalog`
  (modulith-plan.md) and needed nothing new, so no `sound` code changed.
- **Endpoint added to the story:** the compare panel draws force curves, which only CAT-02
  has, so it calls CAT-02 with `include=sounds`. user-stories.md and api-design-v1.md now
  list CAT-02 for US-03.
- **Landing page is partial:** `/keylab/home` has the hero copy and the compare strip only.
  The hero keyboard and switch picker, and the other sections (how it works, library,
  mods, keycaps, playground, community, testimonials, FAQ, final call) wait for their
  stories. Next action: Dan confirms `/keylab/home` as the landing URL (the logo points
  there; `/keylab` stays the builder).
- **Design changed:** SwitchCard, SwitchesDesktop and SwitchesMobile `.dc.html` let a
  no-sound card be picked in compare mode; the story says it cannot, so they now block it,
  hide its check box and say "Sound coming soon".
- **Copy not in the design:** "This switch could not be loaded." in a compare row,
  "The first recorded switches arrive soon." when the landing has no recorded switch, and
  the card's spoken label ", sound coming soon, cannot be compared". "Try the sound" plays
  the first switch of the strip. Next action: Dan reviews.

## US-38 Sound uploads (merged in PR #53)

Verified: `keylab-api` tests (new `SoundApiTest` with 10 cases, `WavAnalysisTest` incl.
BS.1770 loudness, `AdminSwitchApiTest`, `ModularityTests`), web unit tests (33), `tsc`,
lint, `vite build`, `check:api`, and all 13 KeyLab e2e incl. the new
`keylab-sounds.spec.ts` (ticket, signed PUT, 202, ready and failed, no-sound state,
photo refused then attached) against the local stack, after restarting keylab-api from
the new jar (Dan approved). Left:

- **Storage is local disk** (`KEYLAB_STORAGE_DIR`, default the temp folder) behind
  `BlobStore`, and keylab-api serves files at `/v1/assets/…` from the app's own origin, so
  the gateway CSP needs no media host. In production (KL-D1) it is the named volume
  `keylab-files` on the data disk, archived nightly with the keylab dump, and
  `KEYLAB_UPLOAD_SIGNING_KEY` is in Vault and the VM's `.env`. Nothing cleans up unused
  uploads or old files, and takes of a deleted draft stay in `sound.recordings`. Next
  action: a later ticket moves files to Azure Blob behind the same `BlobStore` port, and
  adds cleanup.
- **WAV, not Opus:** recordings are served as the checked WAV (about 30 KB per stroke).
  Next action: transcode if file size starts to matter.
- **Mono only:** the checklist says mono, so stereo is refused. Dan may want stereo allowed.
- **Copy not in the design:** the "Failed" badge and its reason in the table, "Levels OK
  · ready to publish", "Uploading the photo…", the photo errors, the sound library empty
  states ("No switch matches this name.", "No switches yet. Add one under Switches."), and "It is still
  processing. Check the sound library in a minute." Next action: Dan reviews.
- **Design changed:** UploadDropZone said "Drag a WAV or FLAC here"; US-38 and ADM-04
  say WAV only, so the design file now says "Drag a WAV here".
- **No delete in the UI:** `DELETE /v1/admin/sounds/{id}` works; the screens draw no
  button. A new upload to a slot replaces what plays.
- **Bad files (branch fix/us-38-wav-check, 2026-11-16, Dan's report):** a 44.1 kHz stereo
  WAV uploaded and left a Failed row over the good take. Now the browser reads the WAV
  header and refuses a wrong format with processing's words before any upload, and the
  table row shows the take that plays, with "Last upload failed, this take still plays."
  and the reason under it when a newer take failed. Clipping still needs processing.
  Copy not in the design: that note. Next action: Dan reviews the note.
- **`GET /v1/admin/switches`** was added in a minimal form (name search, paging) for the
  sound library. Next action: US-36 adds its other filters.
- **Test seeding:** `keylab-publish` and `keylab-switch-page` still seed
  `catalog.switch_recordings` with psql (`markStockSoundsReady` in `keylab-support.ts`).
  That still works; they could upload instead now, at the cost of speed.

## US-04 Switch page (branch feature/kl0-keylab-foundation, 2026-11-15)

Verified: `SwitchDetailApiTest` (CAT-02 specs, curve, `include`, 304; CAT-03 order and
empty list; CAT-04 ranking, never itself, default four, bad `page_size`; drafts, pulled
and unknown are 404), web tests for picking and resampling sounds, `tsc`, lint,
`vite build`, `check:api`, and `keylab-switch-page.spec.ts` (page, pickers play the
right recordings from a test-served CDN, card playback, related, "Use in a build") plus
the other KeyLab e2e against the local stack, after restarting keylab-api from the new
jar (Dan approved). Left:

- **Copy and data not in the design:** the lede is built from the data ("A soft & muted
  silent switch by E2E Works.") because switches have no description field; the stem row
  shows the hex code, not a colour name; "No sound yet" on the badge and play button;
  "Switch not found" / "This switch is not in the library."; "No similar switches yet.";
  the play error "This sound could not be played."; and on the build page "Switch",
  "Selected for this build." and "Change switch". Next action: Dan reviews, and decides
  whether switches get a description field (ADM-02).
- **The builder is still a placeholder:** "Use in a build" shows the picked switch on
  `/keylab`, nothing more, until KL2. The app's selected-switch sheet (SwitchesLight)
  belongs to that builder and is not built.
- **"Compare with others"** links to the app library, where compare mode now lives (US-03);
  it does not turn compare mode on by itself.
- **Sound summary words** for each profile are invented (api-design-v1.md lists them).

## US-02 Browse the switch library (branch feature/kl0-keylab-foundation, 2026-11-15)

Verified: `SwitchLibraryApiTest` (paging of 24 with no repeats, force sort across pages,
a token from another sort refused, every filter incl. literal `%` in search, bad values
400), web tests for the URL-to-query mapping, `tsc`, lint, `vite build`, `check:api`,
and `keylab-library.spec.ts` (public and app library, filters, empty state with
"Clear filters") plus the other KeyLab e2e against the local stack. Left:

- **App page scope:** `/keylab/switches` has the head, chips and grid of SwitchesDesktop
  and SwitchesMobile. The keyboard preview, desk pad, "Apply to all", compare mode, the
  selected-switch panel and the "Short travel" chip need the builder and are left out
  (compare mode came with US-03);
  each card links to its page instead. Next action: the builder stories.
- **Copy not in the design:** the public "Recording" filter with "Has sound" and "No sound
  yet" (US-02 asks for a sound status filter, the screens draw none), "Details" under each
  app card, and the app empty state ("No switches match these filters", "No switches
  yet"). Next action: Dan reviews.
- **No search on the app page:** the app screens draw no search box. `?q=` still works in
  the URL. Next action: Dan decides if the app page needs one.
- **Each e2e run leaves two more pulled test switches** in the dev database.

## US-39 Publish a switch (branch feature/kl0-keylab-foundation, 2026-11-15)

Verified: `PublishSwitchApiTest` (409 until stock press and release, the
SoundProcessed listener incl. late and failed events and two at once, library with
New sticker, 304 on the ETag, pull and republish), `AdminSwitchApiTest` (drafts not in
CAT-01), `ModularityTests`, web tests, `tsc`, lint, `vite build`, `check:api`, and
`keylab-publish.spec.ts` plus the other KeyLab e2e against the local stack. Left:

- **`KeycloakTokenIntegrationTest` failed once** in a full `keylab-api` run (Keycloak
  container not ready in time) and passed when rerun alone. See "Keycloak in
  Testcontainers is slow here" under Verification.
- **Copy not in the design:** "Pull from library", "Save changes", the "[name] pulled" and
  "Changes saved" toasts, "Hidden" badge, the public "Show more switches" button, the
  "24+ switches" count when more pages exist, the unfiltered empty state ("No switches
  yet" / "The first recorded switches arrive soon."), and "This page is not built yet."
  for public links with no page. Next action: Dan reviews.
- **"popular" sort** has no play counts, so it lists the newest first. Next action: when
  plays are recorded.
- **Local stack:** keylab-api was restarted from the new jar (Dan approved) with
  `COMPOSE_PROJECT_NAME=playground-verify MANAGEMENT_PORT=9191` and JDK 27; e2e needs
  `COMPOSE_PROJECT_NAME=playground-verify` to find the Postgres container. `verify-stack.mjs up`
  starts the jar that is there, so run `./gradlew :keylab-api:bootJar` first. Each e2e run leaves one pulled
  ("hidden") test switch in the dev database by design (published switches
  cannot be deleted).

## US-37 Add or edit a switch (merged in PR #50)

Verified 2026-11-15: `keylab-api` tests all green (new `AdminSwitchApiTest`,
`AdminSwitchesTest`), web unit tests, `tsc -b`, lint, `vite build`, `check:api`,
and the KeyLab e2e (6 incl. the new `keylab-switch-edit.spec.ts`) against the local
stack. keylab-api on :8183 was restarted from the new jar. Left:

- **Audit events:** api-design says every admin write records one (ADM-13); nothing
  records them yet. Next action: part of US-44.
- **Copy not in the design:** "Edit switch" title and slug crumb when editing, the
  "Delete draft" button and its confirm ("Delete [name]? It goes for good, with its
  specs and force curve."), "Add at least two points to draw the curve.", the sign-in
  and editor-role messages, error toast bodies ("Check the fields marked in red.",
  "Someone else saved it first. Reload to see their version."), "Draft deleted".
  Next action: Dan reviews.
- **Drawn but inactive until their stories:** the admin topbar search, range, bell and account, sidebar
  counts and "Last publish". Release force points can be sent through the API and are
  drawn, but the table edits press points only.
- **PR:** open for review against main.

## KL0 KeyLab foundation (merged in PR #49)

Verified 2026-11-15: full `node verify.mjs` green (gateway, api, keylab, web, attacks,
smoke 45, headers, e2e 12 incl. 4 KeyLab, docs), run with
`COMPOSE_PROJECT_NAME=playground-verify MANAGEMENT_PORT=9191` because the local prod
gateway holds 9181. Left:

- **openapi-typescript runs through npx** (it wants TypeScript 5, web is on 6), so
  `check:api` needs npm registry access on first run. Dan may prefer another approach.
- **Shell copy not in the designs:** Sign in slot ("Sign in / to save builds"), "This page is
  not built yet.", the API status card. The sidebar "Current build" card is left out until
  builds exist. Next action: Dan reviews, or the first stories replace them.
- **Gateway CORS** allows GET and POST only. Same origin today; PATCH and DELETE need adding
  if KeyLab ever calls cross-origin.
