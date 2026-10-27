# authn-authz-playground

## Purpose

A learning playground that shows how a browser, a BFF gateway, and an identity
provider fit together in a modern authentication and authorization setup. The
core teaching point: the browser never sees tokens. It holds only a session
cookie. Tokens live on the server side.

Mode: small project / demo.

Second goal (added 2026-10-27, Dan): run it publicly, first on Oracle Cloud
Always Free, later on AWS, to learn the platform side (IaC, Kubernetes, CI,
secrets, observability). Learning first, production readiness where
practical. See Deployment platform.

## First useful result

A user can register with full name, email, and password, log in with
email/password, see their profile returned by a protected API through the
gateway, and log out. Tokens never reach the browser at any point.

Acceptance criteria:

1. Register creates a user in Keycloak with full name, email, and password.
2. Login with email/password starts a gateway session and sets a session cookie.
3. A call through the gateway to the protected profile endpoint returns the
   user's profile data. The request carries no bearer token. The gateway relays
   the token to the API.
4. Logging out ends the session and clears the cookie.
5. With no valid session, the profile call is rejected.

## Features

In priority order. Everything after the first result builds on it.

1. Email/password login.
2. Register with full name, email, password.
3. Login with Google and GitHub.
4. Forgot password, sends an email with a reset link.
5. Role-based authorization (user/admin) on API and UI routes.

## Non-goals

Not now (could come later):

- Password reset with an emailed OTP code (dropped 2026-10-27, Dan; the
  email link flow covers reset).
- MFA enrollment.
- Admin UI.
- Mobile apps.
- High availability (several nodes or regions). One free VM cannot give it.
- Paid cloud resources. Everything must fit Oracle Always Free until Dan
  decides otherwise.

Outside this project's purpose:

- Multi-tenant realms.

Production deployment and Kubernetes moved into scope on 2026-10-27 (Dan).

## Decisions

Choices made, with reasons. Versions were checked against official docs on
2026-10-18.

### Version stack

- **Java 26, Gradle (Groovy DSL) 9.8.1.** Spring Boot 4.1.1 supports Java 17
  through 26, and supports Gradle 8.14+ and 9.x, so 9.8.1 is fine.
- **Spring Boot 4.1.x (current 4.1.1) with Spring Security 7.** Current line,
  required by the Java 26 target.
- **Spring Cloud 2025.1.x (Oakwood).** This is the release train for Spring Boot
  4.0.x and 4.1.x (2025.1.2+ for Boot 4.1). Use the latest service release
  (2025.1.3) via the `spring-cloud-dependencies` BOM.
- **Spring Cloud Gateway 5.0.3, starter `spring-cloud-starter-gateway-server-webflux`.**
  WebFlux flavor. It is the flagship flavor, `TokenRelay` is a native filter,
  and every security piece we need (CSRF cookie repository, OIDC logout,
  back-channel logout) is documented for the reactive stack. Tradeoff: the
  stack is reactive on Netty. The WebMVC flavor
  (`spring-cloud-starter-gateway-server-webmvc`) is equally capable with servlet
  Spring Session. Revisit only if we prefer a servlet model or reactive proves
  to distract from the teaching point.
- **Spring Session Data Redis in the gateway via `@EnableRedisWebSession`.**
  This backs the WebFlux `WebSession` with a `ReactiveSessionRepository` in
  Redis, so the session cookie names a session that lives in Redis. The
  security context repository is a small variant that changes the session id
  only when the signed-in principal changes: the stock one rotates on every
  save, and a token refresh save would then strand parallel requests on the
  old id and wipe the cookie.
- **Keycloak 26.8.1 with Keycloakify 11.x (current 11.16.3).** Latest stable of
  each. Keycloakify themes target the latest Keycloak and run on older ones.
  Keycloakify ships a shadcn/ui + Tailwind starter theme, which is our starting
  point for the theme. Revisit the pairing when either major version changes.
- **These versions are pinned.** Do not re-check them against docs unless a
  build fails or a major upgrade is planned.

### BFF specifics

- **OAuth2 client registration lives on the gateway only.** The gateway is the
  OIDC client (authorization code + PKCE) via
  `spring-boot-starter-oauth2-client`. PKCE is applied with
  `OAuth2AuthorizationRequestCustomizers.withPkce()` on the authorization
  request resolver: Spring Security only adds PKCE automatically for public
  clients, and the realm enforces S256 on this client. The API is a resource
  server only (JWT, issuer-uri). The SPA holds no client config and sees no
  tokens.
- **Token relay.** The `TokenRelay` filter, with no client registration id,
  forwards the logged-in user's access token to the API as a bearer header. The
  default authorized client store is in memory. Store the authorized client
  (access and refresh token) in the Redis-backed session instead, so tokens
  live only server side and survive restarts and multiple gateway instances.
- **CSRF: cookie to header.** `CookieServerCsrfTokenRepository.withHttpOnlyFalse()`
  writes cookie `XSRF-TOKEN` and reads header `X-XSRF-TOKEN`. Axios uses those
  names by default, so the SPA only needs `withCredentials`. Use the SPA
  deferred-token request handler so the cookie holds the raw token while
  request tokens can be BREACH masked. Login and logout POSTs are CSRF
  protected automatically.
- **Same origin through the gateway, no CORS.** The gateway serves or proxies
  the SPA. In dev, the Vite server proxies `/api`, `/bff`, `/oauth2`, `/login`,
  and `/logout` to the gateway with `changeOrigin: false`, so redirect URIs
  build against the SPA origin. The browser talks to one origin; Keycloak is
  reached by redirect only. Unauthenticated calls get 401, never a login
  redirect: XHR cannot follow the cross-origin redirect to Keycloak (CORS), so
  the SPA drives login with a top-level navigation to
  `/oauth2/authorization/gateway`.
- **RP-initiated logout.** `OidcClientInitiatedServerLogoutSuccessHandler` on
  the gateway with post-logout redirect `{baseUrl}/`. The SPA POSTs `/logout`
  with the CSRF header; the gateway ends the local session and answers with the
  end-session URL as JSON, which the SPA opens as a top-level navigation
  (XHR cannot follow the redirect chain through Keycloak either). The realm
  sets `post.logout.redirect.uris` to `+`, the Keycloak value that reuses the
  client's redirect URIs. Note: that attribute is parsed whitespace-separated;
  a comma-joined list is read as one URI and fails with "Invalid redirect uri".
- **Back-channel logout.** Enable `oidcLogout().backChannel()` with
  `OidcBackChannelServerLogoutHandler`. The endpoint is
  `{baseUrl}/logout/connect/back-channel/{registrationId}`. Set the session
  cookie name to `SESSION` (the Spring Session default); the default is
  `JSESSIONID` and would never match. Register this URL as the client's
  Backchannel Logout URL in Keycloak so a logout at Keycloak kills the Redis
  session. The OIDC session registry is stored in Redis
  (`RedisReactiveOidcSessionRegistry`, keys `playground:oidc:*`, 10 hour TTL
  matching Keycloak's SSO max lifespan). Changed 2026-10-27 from the in-memory
  default: sessions outlive a gateway restart in Redis but the in-memory
  registry did not, so after a restart a Keycloak logout left the session
  alive (reproduced). The registry stores issuer, audience, subject, sid and
  the replayed CSRF header, no tokens.
- **Cookie flags.** `SESSION` is `HttpOnly; SameSite=Lax; Path=/` via
  `server.reactive.session.cookie.*`; `XSRF-TOKEN` is `SameSite=Lax` and not
  HttpOnly. `Lax` because the redirect back from Keycloak must carry the
  pre-login session. `Secure` follows `COOKIE_SECURE` (default false, since dev
  is plain http) for both cookies.

### Password reset

**Keycloak's built-in email link flow, themed. No custom SPI.** Changed
2026-10-27 (Dan) from a custom email OTP authenticator SPI. Reason: the link
flow already works and is verified, and the SPI would add Keycloak internals
to maintain and OTP security to get right for no gain in the teaching point.
Revisit only if an OTP reset becomes a goal again; Keycloak has no built-in
one, so it would mean a custom SPI or a community extension (a Stop).

### Registration full name

**One `fullName` attribute in the Keycloak user profile.** The default profile
is `username`, `email`, `firstName`, `lastName`. `username` and `email` cannot
be removed; `firstName` and `lastName` are just defaults and can be hidden from
registration. Add `fullName` as required, with `length` (max 120) and `pattern`
validators, and expose it as the `name`
claim through an OIDC user attribute protocol mapper. Reason: it matches the
requested one-field register form and does not invent a name split. Tradeoff:
`firstName`/`lastName` arrive pre-wired with `given_name`/`family_name` claims
and admin console support. Registration and account forms render from the
profile schema, and Keycloakify renders those fields, so the register page gets
one Full name field for free.

Name characters (changed 2026-10-27, Dan): the built-in
`person-name-prohibited-characters` validator was replaced by a `pattern`
validator with the same blocked set minus `(` and `)`:
`< > & " $ % ! # ? § ; * ~ / \ | ^ = [ ] { }` and control characters. Reason:
Google and GitHub display names often carry parentheses (for example
"Nguyen Van Dat (K18 HCM)"), and the built-in list cannot be configured, so
those users were forced onto the review page with a name they could not keep.
The pattern still blocks HTML and script characters, and Keycloakify checks a
`pattern` in the browser, so the error shows when the field loses focus. Unicode
letters, apostrophes, hyphens and periods are allowed. The running realm was
updated through the admin API; the realm JSON carries the same config.

### Realm provisioning

**A realm import JSON in `/infra`, named `<realm>-realm.json`** (for example
`playground-realm.json`), mounted into `/opt/keycloak/data/import` and imported
on startup with `start-dev --import-realm`. Keycloak resolves `${VAR}`
placeholders in realm files from environment variables, so Google and GitHub
client ids and secrets stay in `.env`, for example `${GOOGLE_CLIENT_ID}`. The
same file carries the gateway client, redirect and post-logout URIs, the
back-channel logout URL, the Google and GitHub identity providers, the user
profile config, and the reset flow binding. Note: import is skipped when the
realm already exists, so wipe the volume (or delete the realm) to re-import.

### Repo layout

**Monorepo: `/gateway`, `/api`, `/web`, `/keycloak-theme`, `/infra`.**

- `/gateway`: Spring Cloud Gateway BFF. Gradle subproject.
- `/api`: resource server. Gradle subproject.
- `/web`: Vite React TypeScript SPA with Axios. npm.
- `/keycloak-theme`: Keycloakify theme, builds a theme jar. npm.
- `/infra`: docker-compose (Keycloak, Redis, Mailpit), realm import JSON, env
  example.

Gradle multi-project at the root for the Java modules (`settings.gradle`
includes `gateway` and `api`), with one Spring Boot and Spring Cloud BOM version
at the root. npm keeps `/web` and `/keycloak-theme`; Gradle does not drive npm.

### Also decided

- **Local ports.** Keycloak 8080, Mailpit 8025 (UI) and 1025 (SMTP), Redis 6379,
  gateway 8181, api 8182, web dev server 5174. Ports 8081 and 8082 were already
  taken by another local stack on the dev machine.
- **React + TypeScript SPA (Vite) with Axios.** Uses a session cookie only and
  never handles tokens, which is the point of the demo.
- **Keycloak as the identity provider** with a Keycloakify theme. Login,
  register, forgot password, and reset password mirror the linked
  shadcn blocks so the theme work has a concrete target.
- **Local infra via docker-compose.** Keycloak, Redis, Mailpit for SMTP. Keeps
  the demo self-contained on a dev machine.

### Keycloakify page design

Mockups in `/keycloak-theme` (Vite dev server) confirm the look. Earlier
rounds (shadcnstudio 07 blocks, then a split layout) are in git history.

- Layout: one centered card (shadcnstudio login-page-01 style). `AuthShell` is
  a full screen flex container on a light gray canvas (`bg-muted/40`) holding a
  `max-w-[440px]` card (`rounded-2xl`, border, `shadow-sm`), single column. The
  card starts with the brand mark and "authn-authz-playground", then the page
  content. All pages use `AuthShell`.
- Fields: label above every input, red asterisk on required ones (login and
  forgot password included), icon inside the input (mail, lock, user),
  show/hide toggle on passwords.
- Social login: Google and GitHub, full width and stacked (GitHub replaces
  Facebook). Then an "Or" divider.
- Headings are centered. The primary action is a full width h-11
  near-black button. Copy follows the reference pattern: "Sign in to
  authn-authz-playground".
- States: submit stays disabled until valid (reset password until both fields
  match and are 8+ characters), inline error text under the fields.
- Reusable pieces live in `/keycloak-theme/src/mockups/AuthShell.tsx`:
  AuthShell, PageHeading, SocialButtons, OrDivider, RequiredLabel,
  SubmitButton, EmailField, NameField, PasswordField, BackToLoginButton.

Deliberate deviation from the references: login shows only email and password
(no name field), matching the login feature.

Stated assumptions:

- Local dev runs via docker-compose in `/infra`. The public deployment is
  described in Deployment platform.
- Email is delivered to Mailpit in dev, not a real inbox. Deployed
  environments send real mail (OCI Email Delivery).

Unresolved questions: none blocking the first build. Real Google and GitHub
OAuth credentials are needed before feature 3 can be tested live.

## Deployment platform

Oracle Cloud Always Free first, AWS later. Decided 2026-10-27 (delegated by
Dan). Every limit and version below was checked against official docs or
release feeds on 2026-10-27 (sources at the end). These versions are pinned
under the same rule as the version stack: re-check only when a build fails or
a major upgrade is planned.

### Oracle Always Free: what we get

All free resources live in the tenancy's home region.

- **Ampere A1 (arm64): 2 OCPU and 12 GB in total.** The Always Free page says
  all tenancies get 1,500 OCPU hours and 9,000 GB hours per month on
  `VM.Standard.A1.Flex`, "equivalent to 2 OCPUs and 12 GB of memory" for
  Always Free tenancies, as one or two VMs. Conflict: the Arm compute page
  still says 3,000 OCPU hours and 18,000 GB hours (the older 4 OCPU / 24 GB).
  We plan for the smaller number and check the tenancy's limits page after
  sign-up.
- **AMD micro: two `VM.Standard.E2.1.Micro`**, 1/8 OCPU, 1 GB, amd64, 50 Mbps.
- **Block storage: 200 GB in total** across boot and block volumes, and 5
  volume backups in total. Each boot volume is at least 47 to 50 GB (the page
  gives both numbers). A sixth backup fails with an error instead of billing.
- **Object Storage: 20 GB in total and 50,000 API requests per month.**
- **Load balancing:** one Flexible Load Balancer fixed at 10 Mbps, and one
  Network Load Balancer.
- **Egress: 10 TB per month.**
- **Vault (KMS):** software-protected keys are free; 20 HSM key versions and
  150 secrets. Private vaults are not free.
- **Email Delivery:** 3,000 emails per month. **Monitoring:** 500 million
  ingestion data points. **Notifications:** 1,000 emails per month.
- **Not free or not stated:** OCI DNS needs a paid account. OCI Container
  Registry stores images at the Object Storage price, and the docs do not say
  it uses the free 20 GB. Reserved public IPs are not on the Always Free page.
- **OKE basic cluster:** no control plane fee, an SLO but no SLA, and no
  workload identity, virtual nodes or node cycling. Its worker nodes are A1
  compute and use the same 2 OCPU / 12 GB.

**Idle reclamation.** Oracle may reclaim an Always Free instance that is idle
over 7 days: CPU 95th percentile under 20%, network under 20%, and memory
under 20% (A1 only). All three must hold, so a running stack is safe: it keeps
memory well above 20% of 12 GB. Risk: a stopped or crash-looping stack can
look idle. Mitigation: an OCI Monitoring alarm on the VM (free, outside the
cluster) emails Dan when memory stays low. Oracle's page does not say Pay As
You Go tenancies are exempt.

**Out of host capacity.** Oracle says this error means a temporary lack of
Always Free shapes in the home region; retry in another availability domain,
wait, or upgrade to Pay As You Go. The home region cannot be changed later.
Consequences for us: create the A1 VM once and keep it across phases; mark
the instance, its boot volume and the data volume `prevent_destroy` in
Terraform, because capacity may not come back after a destroy.

**Pay As You Go upgrade: recommended, Dan decides (a Stop).** Oracle names it
as the capacity fix and keeps Always Free resources free after the upgrade.
Risk: anything above the limits bills the card. If chosen, set compartment
quotas and a small budget alert first.

**arm64 everywhere, multi-arch images required.** Every image we build is
published for `linux/arm64` and `linux/amd64` (AWS may be Graviton or x86, and
dev is x86 Windows). Base images checked multi-arch: `eclipse-temurin:26-jre`,
`quay.io/keycloak/keycloak:26.8.1`, `postgres:18.6-alpine`,
`redis:8.10-alpine`, `traefik:v3.7.16`,
`jenkins/jenkins:2.580.1-lts-jdk25`. Build rule: compile JARs and the SPA once
in `FROM --platform=$BUILDPLATFORM` stages, and make final stages only COPY
onto multi-arch bases, so no compile runs under QEMU. The Keycloak image runs
`kc.sh build` per platform, which is emulated for the foreign one: slow but
acceptable. Check both platforms with `docker buildx imagetools inspect`
before any deploy.

### Phases

1. **Compose on one A1 VM.** Traefik, Keycloak in production mode, Postgres,
   Redis, gateway, api, web. Images built locally with buildx and pushed to
   GHCR. Secrets in a root-owned 0600 `.env` on the VM. Done when `smoke.mjs`
   passes against the public URL with `COOKIE_SECURE=true`.
2. **k3s on the same VM**, replacing compose. Adds cert-manager, Vault,
   External Secrets, CloudNativePG, the LGTM stack and Jenkins. Done when a
   push to `main` is built by Jenkins, deployed, passes `smoke.mjs`, and its
   traces show in Grafana.
3. **AWS.** A new Terraform env with the same Kubernetes layer. Choose EKS or
   k3s on EC2 then.

Reason for compose first: the first public problems (Keycloak hostname and
proxy headers, Secure cookies, TLS, real SMTP, Postgres) are easier to see
without Kubernetes in the way, and Traefik carries over to k3s. Revisit: skip
straight to phase 2 if Dan prefers.

### Kubernetes: k3s on one VM

**k3s v1.36.5+k3s1 (stable channel), one server node on one A1 VM with all 2
OCPU and 12 GB.** Not OKE basic, and not two VMs.

- k3s needs at least 2 cores and 2 GB for a server. With 2 OCPU in total, two
  VMs would give a 1-core server, and a second OS and kubelet would eat into
  12 GB.
- k3s ships Traefik, ServiceLB, local-path storage and a network policy
  controller. ServiceLB binds 80/443 on the VM's public IP, so no OCI load
  balancer (10 Mbps cap) and no cloud-specific annotations.
- The same install runs on a laptop, OCI or EC2, which keeps the AWS move
  portable. Learning value: we own control plane upgrades.
- Datastore: embedded SQLite (the single-server default). Cluster state is
  rebuilt from git, so only data (Postgres, Vault) is backed up.

Tradeoff: OKE basic moves the control plane off the VM (roughly a GB and some
CPU back) and is closer to EKS. But its nodes share the same 12 GB, ingress
needs the OCI load balancer or NLB, and basic has no workload identity.
Revisit if control plane upkeep distracts, or at the AWS step, where EKS is
the managed equivalent.

Risk: one node means no HA. Losing the VM means rebuilding from Terraform and
backups. Accepted for a learning project.

The two AMD micro VMs stay unused for now (1 GB is too small for Jenkins or a
loaded k3s agent). A possible later use is an amd64 box for testing the
amd64 images.

**Memory budget (limits, phase 2):**

| Component | Namespace | Memory |
| --- | --- | --- |
| OS, k3s, Traefik, CoreDNS, metrics-server | system | 1.5 GB reserved |
| cert-manager | cert-manager | 0.2 GB |
| Keycloak (its sizing guide: 1250 MB request) | playground | 1.4 GB |
| Postgres and CloudNativePG operator | playground, cnpg-system | 0.7 GB |
| Redis | playground | 0.1 GB |
| gateway | playground | 0.5 GB |
| api | playground | 0.4 GB |
| web (static files) | playground | 0.05 GB |
| Vault and External Secrets | vault | 0.4 GB |
| Grafana, Mimir, Loki, Tempo, Alloy | observability | 2.2 GB |
| Jenkins controller | ci | 1.0 GB |
| One build agent (Gradle, npm, BuildKit) | ci | 2.5 GB |
| **Total** | | **about 10.9 of 12 GB** |

Rules: every pod has a memory limit. App pods get a higher PriorityClass than
`ci`, so under pressure the build agent is evicted, not Keycloak. A
ResourceQuota on `ci` allows one agent at a time. CPU is 2 cores in total, so
builds take minutes and Keycloak starts slowly. If the budget breaks, first
swap Mimir for Prometheus, then move the build agent off the VM.

**Disk:** the 50 GB boot volume plus one 100 GB block volume for k3s
local-path volumes and container images, leaving 50 GB unallocated. A custom
volume backup policy keeps the total at 5 backups or fewer.

### Registry, ingress, TLS, DNS

- **Registry: GHCR** (`ghcr.io/vandatnguyen919/...`). GitHub Packages is free
  for public packages, and Container registry storage and bandwidth are
  currently free. The repo is public, and images carry no secrets (the realm
  JSON uses `${VAR}` placeholders). Private images would hit GitHub Free's
  500 MB fast. Tradeoff: images are public, and the registry sits outside the
  cloud. Not OCIR: it bills at the Object Storage price and ties images to
  OCI. Revisit if images must become private.
- **Ingress: Traefik.** Compose: `traefik:v3.7.16` with Docker labels. k3s: the
  Traefik that k3s ships. Not Caddy (v2.11.7): its automatic TLS is simpler,
  but Traefik is one tool across both phases.
- **TLS: Let's Encrypt, HTTP-01.** Phase 1 uses Traefik's built-in ACME.
  Phase 2 uses cert-manager v1.21.3 with a ClusterIssuer solving HTTP-01
  through Traefik. HTTP-01 keeps DNS API tokens off the server. Tradeoff: no
  wildcard certs, which is fine for a few hostnames. Use the Let's Encrypt
  staging endpoint until a cert issues (rate limits).
- **DNS: Cloudflare free plan, records "DNS only"** (not proxied), so TLS ends
  at Traefik and Keycloak sees one proxy hop. Reason: OCI DNS needs a paid
  account; Cloudflare DNS is free on every plan, has a free API and Terraform
  provider, and stays the same when we move to AWS. Tradeoff: one more
  account. Needs a registered domain (costs money, a Stop) pointed at
  Cloudflare's nameservers (turn DNSSEC off at the registrar first).
- **Hostnames:** `app.<domain>` (gateway, serves the SPA) and `auth.<domain>`
  (Keycloak public paths). Not public: the Keycloak admin console (blocked at
  Traefik), Grafana, Jenkins, Vault, and the Kubernetes API on 6443. Reach
  them through an SSH tunnel. The security list opens 80/443 to everyone and
  22 to Dan's IP only.
- **Email: OCI Email Delivery SMTP** replaces Mailpit for verify and reset
  mail. Needs SPF and DKIM records (a DNS change). On AWS: SES.

### IaC: Terraform

**Terraform v1.17.0 with the OCI provider v9.11.0.** Not OpenTofu v1.13.2.

Reason: Terraform has a native `oci` backend that keeps state in OCI Object
Storage and locks with `If-None-Match: *`. OpenTofu has no `oci` backend; its
`s3` backend lockfile needs conditional writes, and Oracle's S3 compatibility
docs don't list them, so locking on OCI would be unproven. On AWS both use the
`s3` backend with `use_lockfile`. Tradeoff: Terraform is BUSL 1.1 (fine for
personal use) and has no state encryption, which OpenTofu does. Revisit if
OpenTofu gains an OCI backend or the license starts to matter.

- **State:** a versioned `tfstate` bucket in Object Storage, created once by a
  `bootstrap` root that keeps local state outside git. Lock objects sit next
  to the state.
- **Auth:** an OCI API key in `~/.oci/config` on Dan's machine. Keys and state
  files never go into git.
- **Guards:** `prevent_destroy` on the A1 instance, its boot volume, the data
  volume and the state bucket.

**Layout:** a new `/deploy`. `/infra` stays local dev.

```
deploy/
  terraform/
    bootstrap/            state bucket (local state)
    modules/
      oci-host/           VCN, subnet, security list, A1 VM, block volume, cloud-init
      oci-platform/       buckets, KMS vault and key, dynamic group, IAM policies, email
      dns-cloudflare/     records
    envs/
      oci-free/           backend "oci"; outputs host_ip, s3_endpoint, kms_key_id
      aws/                later: backend "s3", aws-* modules with the same outputs
  compose/                phase 1: compose.prod.yml, Traefik config
  k8s/                    phase 2: Helm values and manifests, cloud-neutral
    overlays/oci/         seal config, S3 endpoint, storage class
    overlays/aws/         later
```

Dockerfiles live in each module (`gateway/Dockerfile` and so on). Portability
rule: only `modules/oci-*` and `overlays/oci` know about Oracle; everything
else reads module outputs. DNS has its own module and is applied on its own,
so DNS changes are always deliberate.

### Secrets: Vault

**Vault Community v2.2.1.** Not OpenBao v2.7.2.

Reason: Vault has OCI KMS and AWS KMS auto-unseal built in. OpenBao 2.7 moved
OCI KMS to an external plugin, one more artifact to fetch and check for arm64.
The API is the same, so skills and manifests mostly carry over. Tradeoff:
BUSL 1.1 under IBM, while OpenBao is MPL 2.0 under the Linux Foundation.
Revisit if the license terms change; External Secrets works with both.

- **Storage:** integrated Raft, one node, 1 GB volume. (OpenBao's docs call
  Postgres easier to operate, but that would tie secrets to the Keycloak DB.)
  A daily CronJob runs `vault operator raft snapshot save` to Object Storage.
- **Unseal:** auto-unseal with OCI KMS, using a software-protected key (free)
  in a default vault, through instance principal (a dynamic group and a
  policy that allows use of that one key). Recovery keys from `vault operator
  init` go to Dan's password manager, never git or chat. Risk: any pod on the
  node can reach the instance principal through the metadata endpoint, so a
  NetworkPolicy blocks `169.254.169.254` for every namespace except `vault`.
  On AWS: the `awskms` seal.
- **Delivery:** External Secrets Operator (chart 2.14.0) syncs Vault KV into
  Kubernetes Secrets, and apps read them as env. Phase 1 uses the `.env` file.

### Observability: Grafana LGTM with OpenTelemetry

**Grafana v13.2.4, Mimir 3.2.3, Loki 3.7.9 and Tempo 3.1.1 (each
monolithic), and Alloy v1.21.2 as the OpenTelemetry collector.** Phase 2 only.

- **Flow:** gateway and api use `spring-boot-starter-opentelemetry` (Boot 4)
  to send traces and metrics over OTLP to Alloy. Keycloak sends traces with
  `tracing-enabled` (OTLP gRPC) and exposes metrics that Alloy scrapes. Alloy
  also collects pod logs from stdout and node and kube metrics. Alloy writes
  metrics to Mimir, logs to Loki and traces to Tempo. (Spring's OTLP log export
  needs an alpha appender, so logs come from stdout.)
- **Storage on the block volume, not Object Storage.** 50,000 requests per
  month would run out within days of chunk flushes.
- **Retention:** metrics 15 days, logs 7 days, traces 3 days. Volumes: Mimir
  10 GB, Loki 10 GB, Tempo 5 GB. Trace sampling stays at Boot's 10% default
  (100% while debugging).
- **Budget:** 2.2 GB. Fallback if tight: Prometheus v3.15.1, which accepts
  OTLP, in place of Mimir.
- **Outside check:** the OCI Monitoring alarm above still fires when the
  cluster is down.

### Jenkins

**Jenkins LTS 2.580.1 (`jenkins/jenkins:2.580.1-lts-jdk25`), Helm chart
5.10.0, in namespace `ci` on the same k3s node, configured as code (JCasC).**
Phase 2. Phase 1 has no Jenkins; images are built and pushed with buildx
from Dan's machine.

- **Agents:** Kubernetes plugin pod agents, one at a time, at lower priority
  than the apps. Images are built with rootless BuildKit v0.34.1 in a pod for
  `linux/arm64` and `linux/amd64` and pushed to GHCR.
- **Reaching the cluster:** from inside, as a ServiceAccount bound to a Role in
  the `playground` namespace only (deploys with `helm upgrade`). No kubeconfig
  leaves the cluster, and 6443 stays closed to the internet.
- **Triggers:** Jenkins polls GitHub every 5 minutes instead of taking
  webhooks, so it stays private. Tradeoff: up to 5 minutes of delay.
- **Credentials:** a GitHub token with package write, stored in Vault and
  synced by External Secrets.

Tradeoff: builds compete with the apps for 2 cores and 12 GB; the priority
and quota rules keep the apps up. Revisit if builds starve the node: run the
agent on Dan's machine as an inbound agent.

### Keycloak database and backups

**PostgreSQL 18.6.** Keycloak 26.8 supports 14 through 18 and tests 18.

- **Phase 1:** a `postgres:18.6-alpine` container with its volume on the block
  volume. A nightly `pg_dump -Fc` goes to Object Storage, keeping 14.
- **Phase 2:** CloudNativePG 1.30.1, one instance, with the Barman Cloud
  plugin 0.15.1 for WAL archiving and a daily base backup to Object Storage
  through its S3 compatible endpoint, with a 7 day recovery window. A weekly
  `pg_dump` stays as a second, portable copy. Keycloak connects with
  `db-tls-mode=verify-server` using the operator's CA. Risk: Barman Cloud on
  OCI's S3 compatibility API is untested here, and WAL segments count toward
  the 50,000 requests. Prove it with a restore before phase 2 is done.
- **Keycloak image:** runs `start` (production mode) from an image built with
  `kc.sh build` (Postgres, health, metrics, tracing, theme jar inside), so no
  Quarkus build on each start. Realm config stays in `playground-realm.json`
  and is imported on first boot only; users live in the database, hence the
  backups.
- **Restore drill:** a backup counts only after a restore into a scratch
  database passes `smoke.mjs`. Once per phase.
- **Redis:** sessions only, no backup. Losing it logs everyone out, which is
  acceptable.
- **AWS later:** the same CloudNativePG setup on S3, or RDS for PostgreSQL;
  decide then.

### Open questions for Dan

- Is there an OCI tenancy yet, and in which home region? The home region
  cannot change, and A1 capacity differs by region.
- Upgrade to Pay As You Go? Recommended above; a Stop.
- Which domain? It needs registering (cost) and pointing at Cloudflare.

### Sources (checked 2026-10-27)

- Oracle Always Free resources:
  https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm
- Oracle Arm compute (the conflicting 3,000 / 18,000 figure):
  https://docs.oracle.com/en-us/iaas/Content/Compute/References/arm.htm
- OKE basic and enhanced clusters:
  https://docs.oracle.com/en-us/iaas/Content/ContEng/Tasks/contengcomparingenhancedwithbasicclusters_topic.htm
- OCI S3 compatibility API:
  https://docs.oracle.com/en-us/iaas/Content/Object/Tasks/s3compatibleapi_topic-Amazon_S3_Compatibility_API_Support.htm
- OCI DNS pricing (paid account required):
  https://www.oracle.com/cloud/networking/dns/pricing/
- Container Registry billing: https://www.oracle.com/cloud/cloud-native/container-registry/
- k3s requirements: https://docs.k3s.io/installation/requirements
- Terraform `oci` backend: https://developer.hashicorp.com/terraform/language/backend/oci
- OpenTofu backends: https://opentofu.org/docs/language/settings/backends/configuration/
- Vault OCI KMS seal: https://developer.hashicorp.com/vault/docs/configuration/seal/ocikms
- OpenBao seals and storage: https://openbao.org/docs/configuration/seal/ocikms/ and
  https://openbao.org/docs/configuration/storage/
- Keycloak databases: https://www.keycloak.org/server/db
- Keycloak sizing:
  https://www.keycloak.org/high-availability/multi-cluster/concepts-memory-and-cpu-sizing
- Keycloak tracing: https://www.keycloak.org/observability/tracing
- Spring Boot OpenTelemetry: https://docs.spring.io/spring-boot/reference/actuator/observability.html
- GitHub Packages billing:
  https://docs.github.com/en/billing/concepts/product-billing/github-packages
- Cloudflare DNS FAQ: https://developers.cloudflare.com/dns/faq/
- Versions: GitHub releases API for each project, the k3s channel server
  (https://update.k3s.io/v1-release/channels), Jenkins update center, and
  Docker Hub / Quay manifests for image architectures.

## Current state

Present tense only. Dated history is in git log.

Works and verified:

- **Login (feature 1).** BFF code + PKCE flow, Redis session, TokenRelay to the
  API, `/bff/user` returns the profile, 401 without a session, RP-initiated
  and back-channel logout. `node smoke.mjs` checks login, roles, CSRF, logout,
  session fixation, cookie flags and back-channel logout against the live
  stack (40 assertions).
- **Register (feature 2).** Full name, email, password, confirm password.
  `verifyEmail` is on, mail goes to Mailpit (http://localhost:8025).
  `registrationEmailAsUsername` is true. The "Password Validation" step sets
  `always_set_password_on_register_form`, or Keycloak drops the password field
  when `verifyEmail` is on.
- **Forgot password, link flow (feature 4).** Known and unknown emails get the
  same page. `./verify` checks it end to end, including old password rejected.
- **Roles (feature 5).** `realm_access.roles` map to `ROLE_user` and
  `ROLE_admin`, enforced on `/api/*` and `/bff/*`. The SPA has `/me`, `/admin`
  and `/forbidden` routes.
- **Theme.** Login, register, forgot and reset password, profile completion
  (`login-update-profile.ftl`, the fallback for users without `fullName`, such
  as the `alice` fixture), and all informational and confirm status pages
  render on `AuthShell`. Pages that collect credentials or set up factors (OTP,
  WebAuthn, recovery codes, X.509, update email, select authenticator or
  organization) still use the default theme.

Rules in force:

- **Email masking (Dan).** Any email shown to the user is masked to its first
  3 characters plus the domain with a fixed-width mask (`van•••••@gmail.com`;
  short local parts keep at least one character hidden). Use `maskEmail` and
  `maskEmails`. Editable inputs show the real value. On the IdP review page an
  IdP-supplied email is masked read-only text in a hidden input, and stays
  editable when missing, malformed or rejected.

Facts worth knowing:

- The access token has name, email, preferred_username and realm roles but no
  `sub` claim.
- Keycloak `start-dev` re-runs a Quarkus build on every start. The compose
  healthcheck allows up to 8 minutes.
- The `alice` fixture password is `alice1234` after a fresh realm import.
- Not checked by a tool: visual match to the shadcnstudio blocks and page
  switch flicker. Status pages other than expired and error were checked from
  Keycloakify mocks only.

- Deployment: decisions recorded in Deployment platform. Nothing is built or
  provisioned yet.

Next: every feature except Google and GitHub login is done. Feature 3 is
blocked on real OAuth credentials (a Stop). Deployment phase 1 can start once
the open questions in Deployment platform are answered.

## Stops

Pause and ask before:

- Anything needing real Google or GitHub OAuth credentials.
- Any change to the architecture above.
- Any new dependency outside the stated stack (the Deployment platform section
  counts as part of the stack).
- `terraform apply` or `terraform destroy`, in any root or env. Show the plan
  and wait for a yes.
- Anything that costs money: the Pay As You Go upgrade, buying a domain, any
  paid OCI or AWS resource, anything beyond the Always Free list.
- Cloud credentials: creating, entering or rotating OCI API keys, AWS keys,
  Cloudflare API tokens, GitHub tokens, or Vault recovery keys.
- DNS changes: nameservers, records, SPF and DKIM.
- Deleting data: volumes, buckets, backups, databases, Vault data, a realm
  wipe on a deployed environment, `docker compose down -v`, or the A1 VM.
- Opening any port or admin UI to the internet beyond 80/443, and 22 from
  Dan's IP.
