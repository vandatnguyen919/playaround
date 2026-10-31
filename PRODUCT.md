# authn-authz-playground

## Purpose

A learning playground that shows how a browser, a BFF gateway, and an identity
provider fit together in a modern authentication and authorization setup. The
core teaching point: the browser never sees tokens. It holds only a session
cookie. Tokens live on the server side.

Mode: small project / demo.

Second goal (added 2026-10-27, Dan): run it publicly, first on Azure for
Students (replaced Oracle Cloud on 2026-10-30), later on AWS, to learn the
platform side (IaC, Kubernetes, CI, secrets, observability). Learning first,
production readiness where practical. See Deployment platform.

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
- Spending beyond the Azure for Students credit ($100 a year). Everything
  must fit the plan in Deployment platform until Dan decides otherwise.

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
  old id and wipe the cookie. The refresh token provider's own OIDC user
  refresh handler must be given this repository (on the provider, not the
  client manager, whose default success handler is what stores refreshed
  tokens in the session). Before 2026-10-29 it sat on the manager: every
  refresh rotated the id and the new tokens were never saved, so a burst of
  parallel calls at token expiry got 500s. `node smoke.mjs refresh` covers it.
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
- **Keycloak over the private network in containers** (2026-10-31). The
  gateway cannot reach the public `AUTH_HOST` from inside Docker, so with
  `KEYCLOAK_DISCOVERY_URI` set it reads discovery from
  `http://keycloak:8080/...` and refuses to start unless the issuer there
  equals `KEYCLOAK_ISSUER_URI` (public). `KC_HOSTNAME_BACKCHANNEL_DYNAMIC`
  makes Keycloak answer with public browser endpoints (authorization, end
  session) and private token, JWKS and userinfo endpoints
  (`KeycloakBackChannelConfig`). Unset in dev, where Spring Boot's own
  discovery runs. The API checks the public issuer and fetches keys from
  `KEYCLOAK_JWK_SET_URI`, so it never needs discovery.
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
- **Same origin through the gateway, no CORS** (other origins are refused;
  see Redis and gateway hardening). The gateway serves or proxies
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

### Redis and gateway hardening

Decided 2026-10-28 (Dan asked for each item; the values are ours).

**Redis** (`infra/redis/redis.conf`, `infra/redis/start.sh`, same files in dev
and prod):

- **ACL, no shared password.** `start.sh` writes the ACL file from
  `REDIS_PASSWORD` at start, so the password is only in `.env`. The `default`
  user is off. User `gateway` may touch only `spring:session:*`,
  `playground:*` and `request_rate_limiter.*`, has no pub/sub, and has no
  `@dangerous` commands (FLUSHALL, KEYS, CONFIG, DEBUG...) except INFO for the
  health check. No admin user; debugging goes through the gateway user or a
  restart.
- **Network.** Prod: only on the internal `backend` network, no published
  port. Dev: published on `127.0.0.1:6379` only, because the gateway runs on
  the host. No TLS: traffic never leaves the VM.
- **Persistence: RDB snapshots (`save 300 1`, `save 60 1000`), no AOF.** A
  restart or redeploy keeps most sessions; at worst five minutes of logins
  sign in again. The dump holds refresh tokens, so it stays on the VM volume
  and is never backed up.
- **Memory: `maxmemory 96mb`, `volatile-ttl`, container limit 128 MB.** Every
  key has a TTL. `volatile-ttl` evicts rate limiter buckets and nearly idle
  sessions before the 10 hour OIDC registry entries that back-channel logout
  needs. `noeviction` would fail every new login when full; LRU would evict
  the registry first, since it is read only at logout.
- **Stretch: Sentinel.** One primary, one replica and three Sentinels would
  survive a Redis crash, and Lettuce and Spring Data Redis support it. Not
  now: HA is a non-goal and one VM cannot give it.

**Session** (gateway):

- **Idle timeout 30 minutes** (`SESSION_IDLE_TIMEOUT`), the Redis TTL that
  each request pushes out. Matches Keycloak's SSO Session Idle (set
  explicitly in the realm, see Auth abuse protection).
- **Absolute timeout 10 hours** (`SESSION_ABSOLUTE_TIMEOUT`). Login stamps the
  session; once the stamp is older, the next request invalidates it (401) even
  if active. Token refreshes do not extend it. Matches Keycloak's SSO Session
  Max (set explicitly), so a re-login after it really asks for the password.
- **Session id rotation on login** was already in place
  (`StableSessionSecurityContextRepository`); the absolute timeout lives there
  too.

**Gateway:**

- **Gateway serves the built SPA** (`SPA_LOCATION`, for example
  `file:web/dist/`) so the HTML carries the headers. Dev still uses Vite for
  hot reload; its HTML has no CSP (Vite's dev client needs inline script).
- **Headers:** CSP `default-src 'self'; script-src 'self'; style-src 'self';
  img-src 'self'; font-src 'self'; connect-src 'self'; object-src 'none';
  base-uri 'self'; form-action 'self'; frame-ancestors 'none'` (the Vite build
  has no inline code), `X-Content-Type-Options: nosniff`, `X-Frame-Options:
  DENY`, `Referrer-Policy: same-origin`, HSTS one year with
  `includeSubDomains`, no preload (needs the domain first). HSTS goes out on
  https only, so behind Traefik the gateway runs with
  `FORWARD_HEADERS_STRATEGY=native`.
- **CORS:** only `APP_URL` (credentials, GET and POST, `Content-Type` and
  `X-XSRF-TOKEN`). Any other origin gets 403, preflight or not.
- **Actuator:** health and info only, on management port 9181
  (`MANAGEMENT_PORT`), bound to 127.0.0.1 by default
  (`MANAGEMENT_ADDRESS=0.0.0.0` for a container or pod probe). Never routed by
  Traefik. Health shows no details. Liveness ignores Redis, so a Redis outage
  does not restart the gateway.
- **Toward the API:** connect timeout 1 s, response timeout 5 s, Resilience4j
  time limit 3 s, circuit breaker `api` (20 call window, opens at 50% failures
  or 80% calls over 2 s, after at least 10 calls; 5xx counts as failure; 15 s
  open, then 3 trial calls). Fallback JSON: 504 `api_timeout`, 503
  `api_unavailable` (open, `Retry-After: 15`), 502 `api_error`.
- **Rate limiter:** Redis `RequestRateLimiter` on every route, 10 requests per
  second with bursts of 20 (`RATE_LIMIT_PER_SECOND`, `RATE_LIMIT_BURST`), per
  signed-in user and route, by client address when anonymous. Over the limit:
  429. If Redis fails, the limiter lets requests through (Spring's default);
  the session lookup fails first anyway.
- **Redis down:** a stopped Redis fails at once (refused connection, Lettuce
  rejects commands while disconnected); a hung one after the 5 s command
  timeout (`REDIS_TIMEOUT`; 2 s gave false outages on a starved dev host).
  Replies are handled off Lettuce's I/O thread (`publishOnScheduler`). Users get 503 with
  `Retry-After: 30`: page loads see a small "We'll be right back" page (its
  own stricter CSP, style inlined by hash), the SPA's calls get JSON
  `session_store_unavailable` and the SPA shows the message. No cookie is
  cleared, so sessions that survive in Redis still work afterwards.

### Auth abuse protection

Decided 2026-10-29 (Dan asked for each item; the values are ours). Realm
values live in `infra/playground-realm.json` (applied by keycloak-config),
edge limits in `deploy/compose/compose.prod.yml`. Checked by `./verify`
(attack checks pass when the attack fails safely) and `node smoke.mjs
refresh`.

**Brute force (realm), temporary lockout only:**

| Setting | Value | Why |
| --- | --- | --- |
| `permanentLockout`, `maxTemporaryLockouts` | false, 0 | A permanent lock lets anyone lock any user out for good by guessing; only an admin could undo it. |
| `bruteForceStrategy` | MULTIPLE | Wait grows with each further block of 5 failures. |
| `failureFactor` | 5 | Locks after 5 failures in a row. |
| `waitIncrementSeconds` | 60 | First lock 1 minute, then 2, 3... |
| `maxFailureWaitSeconds` | 900 | Never more than 15 minutes, which bounds the lockout an attacker can force on a victim. |
| `maxDeltaTimeSeconds` | 43200 | The failure count resets 12 hours after the last failure. |
| `quickLoginCheckMilliSeconds`, `minimumQuickLoginWaitSeconds` | 1000, 60 | Two failures under 1 s apart (a script, not a person) lock for 1 minute at once. |

A locked account must not tell that it exists, so Keycloak's "Account is
temporarily disabled" text is overridden (realm `messageBundles`, en) with
the wrong-password text. Without it two quick guesses against an email
showed whether it had an account. Per-user lockout does not stop one
password tried across many accounts; the edge limit does.

**Password policy:** `length(8) and notUsername and notEmail`. Matches the
theme's 8+ hint. Usernames are emails, so both rules refuse the email as
password. No max length is set (Keycloak's own input limits apply).

**Lifespans (realm, explicit):**

- SSO Session Idle 30 min (1800 s) and SSO Session Max 10 h (36000 s), the
  gateway's idle and absolute timeouts, so both ends expire together.
- Access token 5 min (300 s). The gateway refreshes it out of sight, so a
  short token costs nothing.
- Reset link 15 min (`actionTokenGeneratedByUserLifespan.reset-credentials`
  900 s). Keycloak's 5 min default is short for mail delay; 15 min bounds the
  accepted older-link gap below. Other user action tokens (verify email) stay
  at 5 min.

**Refresh token rotation: off** (`revokeRefreshToken` false). Tested
through the gateway with 8 parallel calls at token expiry: with rotation on
and no reuse, 7 of 8 got 502 (Keycloak rejects the reused refresh token);
with it off, 8 of 8 got 200 over two rounds. Rotation mainly protects public
clients. Here the refresh token never leaves the gateway and Redis, and using
it needs the client secret. Revisit if tokens ever leave the server, or if
the gateway serializes refreshes per session.

**Edge rate limits (Traefik, per client IP, production only):**

| Paths | Limit | Why |
| --- | --- | --- |
| `/realms/playground/login-actions/authenticate` | 10 per minute, burst 10 | Caps credential stuffing at 10 guesses a minute per IP while a person with typos is never blocked. |
| `/login-actions/registration`, `/protocol/openid-connect/registrations` | 5 per minute, burst 5 | Caps account creation, verify mail, and the "email exists" lookup. |
| `/login-actions/reset-credentials` | 5 per minute, burst 5 | Caps reset mail (each POST can send one). |

Each group has its own router and buckets, so a flood on one does not block
another. Over the limit is a plain 429 with `Retry-After`. Traefik is the
edge (Cloudflare DNS only), so the remote address is the client. In memory,
one Traefik. The gateway's Redis limiter already covers `/bff` and `/api`.
Not limited: the verify-email resend link (`/login-actions/required-action`),
shared with other required actions.

**Enumeration:**

- Login, forgot password and a locked account all answer the same for known
  and unknown emails (regression checks `enumeration`, `enumdiff`,
  `stuffing`, `lockout`).
- **Registration keeps "Email already exists."** Hiding it needs the same
  answer for new and taken emails ("check your inbox") plus a mail to the
  owner, which Keycloak cannot do without a custom registration SPI (a Stop,
  like the OTP reset). Accepted, bounded by the 5 per minute limit. The check
  pins that a taken email creates nothing, sends nothing and leaves the
  owner's password working. With email as username Keycloak shows "Email
  already exists. Username already exists."
- **IdP account-exists page stays.** It only shows to someone who signed in
  at Google or GitHub with that email, and both verify emails, so it tells
  the owner about their own account. Linking still needs email verification
  or re-authentication (no auto link). The email is masked (email masking
  rule).

**Accepted: older reset links live out their 15 min** (decided 2026-10-29).
Keycloak checks each reset token on its own, so an older unused link still
sets the password after a newer one was used, until it expires. Only someone
with the older mail can use it, and the window is at most 15 min. Closing it
needs a custom SPI (a Stop), which is not worth it for this risk. The
`olderlink` check pins the bound instead: the realm keeps 900 s, and with the
lifespan cut short for the run, the older link stops working at expiry even
after a newer one was used. Revisit if reset links get longer.

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

**Realm config as code with keycloak-config-cli 6.5.1
(`adorsys/keycloak-config-cli:6.5.1-26.5.5`, multi-arch).** Changed 2026-10-28
(Dan) from Keycloak's `--import-realm`, which runs only when the realm does not
exist, so every later change was a one-off admin API or console edit.

The realm stays in `infra/playground-realm.json` (realm export format). A
`keycloak-config` compose service applies it through the admin API after
Keycloak is healthy, on every `up`, then exits. The import cache is off, so
each run also puts back console drift. Dev applies
`infra/playground-users-dev.json` (test users) as well; production does not.
Files run in name order. Per-environment values are `$(env:NAME)` placeholders
(config-cli's syntax, which leaves Keycloak's `${...}` message keys alone):
client and IdP secrets, `APP_URL` (redirect URIs and web origins), the
back-channel logout URL, and SMTP. The file carries the gateway client and its
mappers (`fullName` to `name`, realm roles to `realm_access.roles`), default
roles (`user` in `default-roles-playground`), Google and GitHub with their
`name` to `fullName` mappers, the user profile, and the flow configs.

Why not the Terraform provider: it would mean rewriting the working realm JSON
as HCL, a state file that holds client secrets, and a `terraform apply` per
realm change, which is a Stop. config-cli reuses the JSON as is, runs inside
compose (later a Kubernetes Job) next to Keycloak, and needs no state store.
Tradeoff: no plan/diff preview before applying, and config-cli builds lag
Keycloak (6.5.1 targets 26.5.5 and is run against 26.8.1). Revisit if a plan
step becomes worth it, or config-cli stops keeping up with Keycloak.

In production config-cli signs in with the bootstrap admin service account
client (`KC_BOOTSTRAP_ADMIN_CLIENT_*`), created on first boot. Keycloak flags
bootstrap admins as temporary; replacing it with a permanent one is open.

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
  gateway 8181 (management 9181), api 8182, web dev server 5174. Ports 8081 and 8082 were already
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
  environments send real mail (Brevo SMTP, see Email delivery).

Unresolved questions: none blocking the first build. Real Google and GitHub
OAuth credentials are needed before feature 3 can be tested live.

## Deployment platform

Azure for Students first, AWS later. Decided 2026-10-30 (delegated by Dan),
replacing Oracle Cloud Always Free: OCI registration is blocked. Every term,
price and version below was checked on 2026-10-30 against Microsoft docs, the
Azure Retail Prices API and release feeds (sources at the end). Prices are
Linux pay-as-you-go list prices in USD. These versions are pinned under the
same rule as the version stack: re-check only when a build fails or a major
upgrade is planned.

### Azure for Students: what we get

- **$100 credit for 12 months, no credit card.** Renewable once a year while
  Dan is a full-time student, by signing up again. Treat it as **$100 a
  year**, not $100 a month.
- **At zero credit or after 12 months, whichever comes first:** the
  subscription is canceled and every deployed resource is decommissioned and
  unreachable, Blob backups included. Dan has 90 days to upgrade to pay as
  you go before that is final. There is no card, so nothing can bill beyond
  the credit: the risk is losing access, not a surprise bill.
- **Use:** education, non-commercial research, and building or demonstrating
  software for those. A learning playground fits. The credit does not cover
  Marketplace offers, so every image we run is from a publisher directly
  (Canonical Ubuntu), not a Marketplace listing.
- **Free extras, not counted on.** The offer mentions 12 months of free
  amounts "for new Azure customers" (two 64 GiB P6 disks, 750 h of
  `B2pts_v2`, 750 h of PostgreSQL Flexible B1MS, 5 GB Blob) and always free
  amounts (100 GB egress a month, Cost Management). If the bill shows the
  disks free, the runway below gets longer. The budget assumes it does not.
- **Region allow list.** Student subscriptions carry an "Allowed resource
  deployment regions" policy whose list differs per subscription and is not
  published. Check Policy, Assignments (or the error text of a failed
  deploy) before choosing the region.
- **No Cost Management budgets.** Microsoft lists Azure for Students
  (MS-AZR-0170P) as an unsupported offer for Cost Management, so an
  `azurerm_consumption_budget_*` resource or a portal budget is not an
  option. See Budget and runway.
- **Port 25 outbound is blocked** for every subscription type except
  Enterprise Agreement and MCA-E. Authenticated relays on 587 are not
  blocked. See Email delivery.

### VM size, region and cost

**`Standard_B2pls_v2` (2 vCPU Ampere Altra arm64, 4 GiB) for phase 1, resized
to `Standard_B2ps_v2` (2 vCPU, 8 GiB) for phase 2. Region `centralindia` if
the allow list has it, else `southeastasia`, else the cheapest allowed region
in the table.**

| Region | B2pls v2 / h | B2ps v2 / h | Notes |
| --- | --- | --- | --- |
| centralindia | $0.0224 | $0.0448 | cheapest checked; Asia |
| westus3 | $0.0300 | $0.0600 | cheapest US |
| eastus | $0.0336 | $0.0672 | |
| southeastasia | $0.0424 | $0.0848 | closest to Dan; dearest of these |

- **Why not `B2pts_v2`:** it is the free one, but 1 GiB cannot hold Keycloak
  (its sizing guide asks for a 1250 MB request) beside anything else.
- **Burst credits:** B2pls v2 has a 30% baseline (36 credits banked per hour,
  864 max), B2ps v2 40%. Steady load is a few percent, so credits bank up
  between Keycloak starts and builds. A long build that drains them falls to
  baseline speed; that is the visible symptom, not a failure.
- **Resize, not replace:** both sizes are in the Bpsv2 family, so phase 2 is
  `vm_size` in Terraform, a deallocate and a start. Disks and the public IP
  stay.
- **Image:** Canonical Ubuntu Server 24.04 LTS arm64, Gen2 (Bpsv2 has no Gen1
  and no local temp disk).
- **Disks:** a 32 GiB Standard SSD OS disk (E4) and a 64 GiB Standard SSD data
  disk (E6) for container volumes, images and Postgres. The data disk is a
  separate resource with `prevent_destroy`, so the VM can be rebuilt without
  losing data. Premium P6 ($10.21) only if Standard SSD proves too slow.
- **Public IP:** one Standard static IPv4, $0.005 an hour. Basic IPs are
  retired. Billed while the VM is stopped.
- **Egress:** the first 100 GB a month are free; a demo stays far below.
- **Quota:** check `az vm list-usage --location <region>` for the
  Bpsv2 family and regional vCPUs before the first apply.

**Monthly cost, centralindia** (IP $3.65, E4 $2.64, E6 $5.28, Blob, Key Vault
and disk operations about $0.50, so about $12 fixed):

| Setup | Per month | $100 lasts |
| --- | --- | --- |
| Phase 1, B2pls v2, always on | $16.35 + $12 = about $28 | 3.5 months |
| Phase 2, B2ps v2, always on | $32.70 + $12 = about $45 | 2.2 months |
| Phase 2, B2ps v2, on 10 h a day | $13.44 + $12 = about $25 | 4 months |
| Phase 1 in southeastasia, always on | $30.95 + $11 = about $42 | 2.4 months |
| Phase 2 in southeastasia, always on | $61.90 + $11 = about $73 | 1.4 months |

### Budget and runway

Plan for one credit year: **phase 1 always on for about 6 weeks (about $43),
then phase 2 on B2ps v2 with nightly auto-shutdown for about 6 weeks (about
$38), keeping a reserve of about $19.** Phase 2 continues after the next
renewal if it is not done.

- **Auto-shutdown:** `azurerm_dev_test_global_vm_shutdown_schedule` stops and
  deallocates the VM every night (free). Off in phase 1, so the public demo
  stays up; on in phase 2. Dan starts the VM with `az vm start`. Deallocated
  compute costs nothing; disks and IP keep billing.
- **Alerts without Cost Management:** cost is almost entirely fixed per
  hour, so the runway is arithmetic. Two checks instead of a budget:
  1. Weekly, compare the balance in the Azure Sponsorships portal with the
     table above. A gap of more than $5 means something unplanned is
     running.
  2. An Azure Monitor metric alert on the VM (CPU credits remaining under
     50, and VM availability) with an email action group. Each metric alert
     rule is about $0.10 a month. This catches a stuck build or a crash loop, which
     the old OCI alarm covered.
- **Runway rule:** at $20 left, copy the latest backups off Azure and decide
  with Dan: renew, upgrade to pay as you go (a Stop), or let it lapse. At
  zero the backups in Blob become unreachable along with everything else.
- **Guard rails in Terraform:** one resource group per env, tags on
  everything, and no resource outside this section's list (a Stop).

### Phases

1. **Compose on one VM.** Traefik, Keycloak in production mode, Postgres,
   Redis, gateway (serves the SPA, no separate web service), api. Images built
   and pushed to GHCR by GitHub Actions (see CI and CD below). Secrets in a
   root-owned 0600 `.env` on the VM. Done when `smoke.mjs`
   passes against the public URL with `COOKIE_SECURE=true`.
2. **k3s on the same VM**, resized to 8 GiB, replacing compose. Adds
   cert-manager, Vault, External Secrets, CloudNativePG, the LGTM stack (with
   Prometheus, see below) and the Jenkins controller for CD. Done when a
   push to `main` is built by GitHub Actions, deployed by Jenkins, passes
   `smoke.mjs`, and its traces show in Grafana.
3. **AWS.** A new Terraform env with the same Kubernetes layer. Choose EKS or
   k3s on EC2 then.

Reason for compose first: the first public problems (Keycloak hostname and
proxy headers, Secure cookies, TLS, real SMTP, Postgres) are easier to see
without Kubernetes in the way, Traefik carries over to k3s, and phase 1 fits
on the cheaper 4 GiB size. Revisit: skip straight to phase 2 if Dan prefers.

**Phase 1 memory (4 GiB, limits):** OS and Docker 0.6, Traefik 0.1, Keycloak
1.4, Postgres 0.3, Redis 0.1, gateway 0.5, api 0.4: about 3.4 GB.
Tight but under 4 GiB with JVM heaps capped (`-XX:MaxRAMPercentage`) and a 1
GiB swap file on the data disk as a cushion, not as working memory. If
Keycloak is OOM killed, resize to B2ps v2 early.

### Kubernetes: k3s on one VM

**k3s v1.36.5+k3s1 (stable channel), one server node on the one VM.** Not AKS.

- AKS free tier has no control plane fee, but its nodes are separate VMs at
  the same price, it wants a Standard Load Balancer (hourly charge plus
  rules) for ingress, and the system node pool alone would eat most of the
  credit. k3s on our one VM costs nothing extra.
- k3s ships Traefik, ServiceLB, local-path storage and a network policy
  controller. ServiceLB binds 80/443 on the VM's public IP, so no Azure load
  balancer and no cloud-specific annotations.
- The same install runs on a laptop, Azure or EC2, which keeps the AWS move
  portable. Learning value: we own control plane upgrades.
- Datastore: embedded SQLite (the single-server default). Cluster state is
  rebuilt from git, so only data (Postgres, Vault) is backed up.

Revisit at the AWS step, where EKS is the managed equivalent.

Risk: one node means no HA. Losing the VM means rebuilding from Terraform and
backups. Accepted for a learning project.

**Phase 2 memory budget (8 GiB, limits):**

| Component | Namespace | Memory |
| --- | --- | --- |
| OS, k3s, Traefik, CoreDNS, metrics-server | system | 1.2 GB reserved |
| cert-manager | cert-manager | 0.2 GB |
| Keycloak (its sizing guide: 1250 MB request) | playground | 1.4 GB |
| Postgres and CloudNativePG operator | playground, cnpg-system | 0.7 GB |
| Redis | playground | 0.1 GB |
| gateway | playground | 0.5 GB |
| api | playground | 0.4 GB |
| web (static files) | playground | 0.05 GB |
| Vault and External Secrets | vault | 0.4 GB |
| Grafana, Prometheus, Loki, Tempo, Alloy | observability | 1.7 GB |
| Jenkins controller | ci | 1.0 GB |
| **Total** | | **about 7.7 of 8 GiB** |

**What phase 2 cut to fit 8 GiB** (both were the fallbacks already named in
the 12 GB plan):

- **Prometheus v3.15.1 in place of Mimir.** It accepts OTLP and saves about
  0.5 GB. Mimir is the thing to try on AWS.
- **No build agent on the node.** GitHub Actions builds the images (see CI
  and CD), so no Gradle, npm or BuildKit pod. Saves 2.5 GB and the CPU
  credits a build would burn.

Not cut: Vault, CloudNativePG, Grafana, Loki, Tempo, the Jenkins controller.
If the node still runs out, the next cut is the Jenkins controller (deploy
from Dan's machine with `helm upgrade`), then Tempo retention.
Moving to `B4ps_v2` (16 GiB, about $65 a month in centralindia) is a Stop.

Rules: every pod has a memory limit. App pods get a higher PriorityClass than
`ci`, so under pressure Jenkins is evicted, not Keycloak. CPU is 2 burstable
cores, so Keycloak starts slowly.

### Registry, ingress, TLS, DNS

- **Registry: GHCR** (`ghcr.io/vandatnguyen919/...`). GitHub Packages is free
  for public packages, and Container registry storage and bandwidth are
  currently free. The repo is public, and images carry no secrets (the realm
  JSON uses `${VAR}` placeholders). Not Azure Container Registry: Basic is a
  daily charge against the credit and ties images to Azure. Revisit if images
  must become private.
- **arm64 everywhere, multi-arch images required.** Every image we build is
  published for `linux/arm64` and `linux/amd64` (AWS may be Graviton or x86,
  and dev is x86 Windows). Base images checked multi-arch:
  `eclipse-temurin:26-jre`, `quay.io/keycloak/keycloak:26.8.1`,
  `postgres:18.6-alpine`, `redis:8.10-alpine`, `traefik:v3.7.16`,
  `jenkins/jenkins:2.580.1-lts-jdk25`. Build rule: compile JARs and the SPA
  once in `FROM --platform=$BUILDPLATFORM` stages, and make final stages only
  COPY onto multi-arch bases, so no compile runs under QEMU. The Keycloak
  image runs `kc.sh build` per platform: native on the CI runners, emulated
  for arm64 on an x86 dev machine (slow but acceptable). Check both platforms with `docker buildx
  imagetools inspect` before any deploy.
- **Ingress: Traefik.** Compose: `traefik:v3.7.16` with Docker labels. k3s:
  the Traefik that k3s ships. Not Caddy (v2.11.7): its automatic TLS is
  simpler, but Traefik is one tool across both phases.
- **TLS: Let's Encrypt, HTTP-01.** Phase 1 uses Traefik's built-in ACME.
  Phase 2 uses cert-manager v1.21.3 with a ClusterIssuer solving HTTP-01
  through Traefik. HTTP-01 keeps DNS API tokens off the server. Tradeoff: no
  wildcard certs, which is fine for a few hostnames. Use the Let's Encrypt
  staging endpoint until a cert issues (rate limits).
- **DNS: Cloudflare free plan, records "DNS only"** (not proxied), so TLS ends
  at Traefik and Keycloak sees one proxy hop. Reason: free on every plan, a
  free API and Terraform provider, and it stays the same on AWS. Azure DNS
  would bill per zone and tie DNS to the credit lapsing. Needs a registered
  domain (costs money, a Stop) pointed at Cloudflare's nameservers (turn
  DNSSEC off at the registrar first).
- **Hostnames:** `app.<domain>` (gateway, serves the SPA) and `auth.<domain>`
  (Keycloak public paths). Not public: the Keycloak admin console (blocked at
  Traefik), Grafana, Jenkins, Vault, and the Kubernetes API on 6443. Reach
  them through an SSH tunnel. The network security group opens 80/443 to
  everyone and 22 to Dan's IP only. No Azure Bastion (hourly charge).

### Email delivery

**Brevo free plan over SMTP (STARTTLS, 587), from `no-reply@<domain>`.**
Changed 2026-10-30: OCI Email Delivery went with the OCI tenancy. Brevo was
already the named fallback. Needs a Brevo account (a Stop).

| | Brevo free | Azure Communication Services Email | Resend free |
| --- | --- | --- | --- |
| Free volume | 300 a day | none; $0.00025 a mail from the credit | 3,000 a month, 100 a day |
| Rate | not stated | 30 a minute, 100 an hour (custom domain) | not stated |
| SMTP login | SMTP key | Entra app registration, client secret, SMTP Username resource | API key |
| Future | | retiring 2028-09-30; Microsoft advises against new onboarding | |
| Survives the credit lapsing, moves to AWS | yes | no | yes |

Reason: verify and reset mail is a few a day. ACS Email is retiring and
needs an Entra app registration, which a student tenant may not allow, and it
stops with the subscription. Brevo needs one sign-up, is independent of the
cloud, and the realm only sees `SMTP_*` values. Tradeoff: one more vendor
account. Resend is the fallback (same settings shape). Revisit at the AWS
step (SES).

- **Per environment, one realm file.** `smtpServer` in
  `infra/playground-realm.json` is all `$(env:SMTP_*)`. Dev compose sets
  Mailpit (no auth, no TLS); `compose.prod.yml` takes host, from, user and
  password from `.env` and refuses to start without them, with STARTTLS
  and auth on by default.
- **Settings:** `SMTP_HOST=smtp-relay.brevo.com`, port 587, the Brevo SMTP
  login and an SMTP key as the password.
- **DNS on `<domain>`:** the `brevo-code` TXT, DKIM as the two CNAMEs Brevo
  gives (`brevo1._domainkey`, `brevo2._domainkey`), SPF
  `include:spf.brevo.com ~all`, DMARC `p=none` with reports to Cloudflare
  DMARC Management, moved to `p=quarantine` after a week of clean reports.
  DMARC passes through DKIM alignment (`d=<domain>`). `mailcheck.mjs dns`
  reads the selector and SPF include from `.env`
  (`MAIL_DKIM_SELECTOR=brevo1`, `MAIL_SPF_INCLUDE=spf.brevo.com`); TXT
  lookups follow the CNAME.
- **Check:** `node deploy/compose/mailcheck.mjs` with `dns` (records in
  public DNS), `send <mailbox>` (registration and reset through the public
  host, plus the Keycloak log, since the reset page reads the same whether
  or not the mail went out), `headers <eml>...` (topmost
  `Authentication-Results` needs spf, dkim signed by `<domain>`, and dmarc
  pass) and `cleanup`.

### IaC: Terraform

**Terraform v1.17.1 with azurerm v5.12.0 and cloudflare v5.28.1.** Not
OpenTofu.

Reason: the original reason (Terraform's native `oci` backend) is gone; both
tools have an `azurerm` backend with blob lease locking and an `s3` backend
for AWS. Terraform stays because it is already chosen, and its registry
tooling is what we use to look up providers. Tradeoff: BUSL 1.1 and no state
encryption, which OpenTofu has. Revisit if state encryption starts to matter.

- **State:** backend `azurerm` with `use_azuread_auth = true` and
  `use_cli = true`, in a `tfstate` container of a storage account made once by
  a `bootstrap` root (local state outside git). Blob versioning and soft
  delete on; shared key access off. Locking is a blob lease on the state
  file.
- **Auth: Dan's own user through `az login`**, the subscription Owner. No
  service principal or client secret. Reason: Azure CLI auth needs no Entra
  app registration, which student tenants may block, and leaves no secret to
  rotate. Owner has no blob data rights, so `bootstrap` grants Dan "Storage
  Blob Data Contributor" on the state container. Recommendation for sign-up:
  a personal Microsoft account, with the school email used only for
  verification, so the subscription sits in Dan's own directory. Revisit
  when something other than Dan's machine must run Terraform: then OIDC
  workload identity, which does need an app registration.
- **Guards:** `prevent_destroy` on the data disk, the state storage account,
  the backup storage account and the Key Vault (also purge protection). The VM
  itself can be rebuilt.
- **VM identity:** a system-assigned managed identity, used by the backup jobs
  and by Vault. No credentials on the VM for Azure. A NetworkPolicy (phase
  2) blocks `169.254.169.254` for every namespace except `vault` and the
  backup jobs, so other pods cannot borrow the identity.

**Layout:** `/deploy`. `/infra` stays local dev.

```
deploy/
  terraform/
    bootstrap/            resource group, state storage account and container (local state)
    modules/
      azure-host/         VNet, subnet, NSG, public IP, B-series VM, data disk,
                          cloud-init, managed identity, auto-shutdown, metric alerts
      azure-platform/     backup storage account and lifecycle rule, Key Vault
                          and seal key, role assignments for the VM identity
      dns-cloudflare/     records
    envs/
      azure/              backend "azurerm"; outputs host_ip, backup_container_url,
                          key_vault_uri, seal_key_name; tests/ (mocked provider)
      dns/                dns-cloudflare only, own state key, host_ip as a variable
      aws/                later: backend "s3", aws-* modules with the same outputs
  compose/                phase 1: compose.prod.yml, Traefik config
  k8s/                    phase 2: Helm values and manifests, cloud-neutral
    overlays/azure/       seal config, Blob backup target, storage class
    overlays/aws/         later
```

Dockerfiles live in each module (`gateway/Dockerfile` and so on). Portability
rule: only `modules/azure-*` and `overlays/azure` know about Azure;
everything else reads module outputs. DNS has its own module and is applied
on its own, so DNS changes are always deliberate. Not in Terraform: the Brevo
account and SMTP key (the key would land in state).

### Secrets: Vault

**Vault Community v2.2.1.** Not OpenBao v2.7.2.

Reason: Vault has Azure Key Vault and AWS KMS auto-unseal built in, and the
skills carry to AWS. OpenBao also ships an Azure Key Vault seal now, so the
original edge (OCI KMS built in) is gone; Vault stays as already chosen.
Tradeoff: BUSL 1.1 under IBM, while OpenBao is MPL 2.0 under the Linux
Foundation. Revisit if the license terms change; External Secrets works with
both.

- **Storage:** integrated Raft, one node, 1 GB volume. A daily CronJob runs
  `vault operator raft snapshot save` to the backup container.
- **Unseal (phase 2): auto-unseal with the `azurekeyvault` seal.** A Standard
  Key Vault (RBAC mode, purge protection on) holds one software-protected RSA
  2048 key. The VM's managed identity has "Key Vault Crypto User" on that key
  only. Vault uses the managed identity, so no client secret exists. Cost:
  key operations are $0.03 per 10,000, a few cents a year. Recovery keys from
  `vault operator init` go to Dan's password manager, never git or chat.
  Risk: if the subscription lapses, the key becomes unreachable and Vault
  cannot unseal; the Raft snapshot plus the recovery keys are the way back on
  a new seal. On AWS: the `awskms` seal.
- **Delivery:** External Secrets Operator (chart 2.14.0) syncs Vault KV into
  Kubernetes Secrets, and apps read them as env. Phase 1 uses the `.env` file.

### Observability: Grafana LGTM with OpenTelemetry

**Grafana v13.2.4, Prometheus v3.15.1, Loki 3.7.9 and Tempo 3.1.1 (each
monolithic), and Alloy v1.21.2 as the OpenTelemetry collector.** Phase 2 only.
Prometheus replaces Mimir 3.2.3 to fit 8 GiB.

- **Flow:** gateway and api use `spring-boot-starter-opentelemetry` (Boot 4)
  to send traces and metrics over OTLP to Alloy. Keycloak sends traces with
  `tracing-enabled` (OTLP gRPC) and exposes metrics that Alloy scrapes. Alloy
  also collects pod logs from stdout and node and kube metrics. Alloy writes
  metrics to Prometheus (OTLP receiver), logs to Loki and traces to Tempo.
  (Spring's OTLP log export needs an alpha appender, so logs come from
  stdout.)
- **Storage on the data disk, not Blob.** Chunk flushes are many small writes
  that would cost per operation and add up.
- **Retention:** metrics 15 days, logs 7 days, traces 3 days. Volumes:
  Prometheus 8 GB, Loki 8 GB, Tempo 4 GB. Trace sampling stays at Boot's 10%
  default (100% while debugging).
- **Budget:** 1.7 GB.
- **Outside check:** the Azure Monitor metric alerts in Budget and runway
  still fire when the cluster is down.

### Jenkins

**Jenkins LTS 2.580.1 (`jenkins/jenkins:2.580.1-lts-jdk25`), Helm chart
5.10.0, in namespace `ci` on the same k3s node, configured as code (JCasC).**
Phase 2. Jenkins does CD only (J1, J3): it deploys images that GitHub
Actions built and published (see CI and CD below). It builds nothing, so it
needs no build agent.

- **Reaching the cluster:** deploy steps run on the controller as a
  ServiceAccount bound to a Role in the `playground` namespace only (`helm
  upgrade`). No kubeconfig leaves the cluster, and 6443 stays closed to the
  internet.
- **Triggers:** Jenkins polls GitHub every 5 minutes instead of taking
  webhooks, so it stays private. Tradeoff: up to 5 minutes of delay.
- **Credentials:** none for GHCR. The images are public, so pulls need no
  token.

### CI and CD: GitHub Actions builds, Jenkins deploys (2026-10-31)

**CI runs in GitHub Actions; CD stays in Jenkins (J1, J3).** Dan decided
this on 2026-10-31. Actions tests, scans, builds and publishes images; it
never deploys. Jenkins arrives in phase 2 and deploys a published
`sha-<git sha>` tag. Until then phase 1 deploys by hand on the VM
(`docker compose pull` and `up -d` with the tag in `.env`).

- **Workflow:** `.github/workflows/ci.yml`. Every pull request to `main`
  runs, with nothing pushed: `./gradlew build` (with tests), web and theme
  lint (oxlint) and tests (`node --test`), `./verify` against dev Keycloak
  and Mailpit, Gitleaks over the whole history, Trivy (High and Critical in
  npm lockfiles and in the built jars), and dependency review (fails on a
  new High or Critical advisory). A push to `main` runs the same checks
  except dependency review, then builds gateway, api and keycloak natively
  on `ubuntu-24.04` and `ubuntu-24.04-arm`, pushes by digest, merges into
  one tag `sha-<full git sha>` with `docker buildx imagetools create`, and
  checks both platforms and their provenance with `imagetools inspect`.
- **Supply chain:** actions pinned by commit SHA, scanner images by digest,
  OCI source labels on every image and index, BuildKit provenance
  (`mode=max`). `GITHUB_TOKEN` with `packages: write` only in the two jobs
  that write to GHCR (push by digest, and merge); every other job has
  `contents: read`. No personal token.
- **Caches:** Gradle home (setup-gradle), npm (setup-node), and image
  layers in the GitHub Actions cache, written on `main` only.
- **Updates:** Dependabot, weekly, for actions, Gradle, npm, Dockerfiles and
  compose files (`.github/dependabot.yml`). Not Renovate: Dependabot needs
  no app install. Pinned versions in this file still change only when Dan
  accepts the PR.
- **Allowlists:** `.gitleaks.toml` (verify evidence, the throwaway test
  password) and `.trivyignore.yaml` (the Spring Boot BOM findings, each
  pinned to its version and expiring 2026-11-30, so CI fails again unless
  Dan decides first).
- **Tags:** only `sha-<git sha>`, no `latest`. Deploys pin all three
  images to the same commit.
- **Why:** native arm64 runners are free for public repos, so no QEMU, no
  build load on the 8 GiB node, no dependency on Dan's machine being on,
  and no GitHub token anywhere. Tradeoff: two tools, joined by the image
  tag.

### Keycloak database and backups

**PostgreSQL 18.6 in a container.** Keycloak 26.8 supports 14 through 18 and
tests 18. Not Azure Database for PostgreSQL Flexible Server.

Reason: Flexible B1MS is free only as a 12-month new-customer amount we
cannot count on, then $0.017 an hour (about $12 a month plus storage, as much
as the VM's fixed costs). It needs either public access with firewall rules
or a delegated subnet and a private DNS zone, it lapses with the credit, and
it skips the CloudNativePG learning in phase 2. The container runs on the
data disk we already pay for and moves to AWS unchanged. Tradeoff: we own
backups, upgrades and restore drills. Revisit at the AWS step (RDS).

- **Backup target: a Blob container** in the env's backup storage account
  (StorageV2, LRS, Hot, shared key access off), written with the VM's managed
  identity ("Storage Blob Data Contributor" on that container only). A
  lifecycle rule deletes blobs after 14 days. Size is well under 1 GB, so
  cents a month.
- **Phase 1:** a `postgres:18.6-alpine` container with its volume on the data
  disk. A nightly `pg_dump -Fc` is uploaded with `azcopy` using `azcopy
  login --identity`.
- **Phase 2:** CloudNativePG 1.30.1, one instance, with the Barman Cloud
  plugin 0.15.1 for WAL archiving and a daily base backup to the same
  container through its native Azure Blob support with managed identity
  (`inheritFromAzureAD`), 7 day recovery window. A weekly `pg_dump` stays as
  a second, portable copy. Keycloak connects with
  `db-tls-mode=verify-server` using the operator's CA. Prove it with a
  restore before phase 2 is done.
- **Off-Azure copy:** Blob dies with the subscription, so the runway rule
  copies the latest dump and Vault snapshot to Dan's machine at $20 left,
  and before any planned lapse.
- **Keycloak image:** `keycloak-theme/Dockerfile` builds the theme jar on the
  build platform, then runs `kc.sh build` (Postgres, health, metrics, theme
  jar inside) and starts with `start --optimized`, so no Quarkus build on each
  start. Tracing is added in phase 2, when there is a collector. Realm config
  is applied by keycloak-config (see Realm provisioning); users live in the
  database, hence the backups.
- **Hostname and proxy (phase 1, `deploy/compose/compose.prod.yml`):**
  `KC_HOSTNAME=https://auth.<domain>` (fixed, so forwarded headers cannot
  change issuer or links), `KC_PROXY_HEADERS=xforwarded`, and
  `KC_PROXY_TRUSTED_ADDRESSES` set to Traefik's fixed IP only. TLS ends at
  Traefik; Keycloak serves plain HTTP on the compose network. Traefik routes
  only `/realms/playground/` and `/resources/`, so the admin console and API,
  the master realm, and `/` return 404 publicly. Health and metrics are on the
  management port 9000, which is never published. The admin console is at
  `KC_HOSTNAME_ADMIN=http://localhost:8080`, bound to the VM's loopback and
  reached over an SSH tunnel. The master realm's `frontendUrl` is that same
  tunnel URL, or its sign-in form would post to the blocked public host. A
  one-shot `keycloak-admin-url` step (kcadm from our image) sets it after
  keycloak-config, because the change moves the master token issuer and
  config-cli's next call in the same run fails with 401.
- **Restore drill:** a backup counts only after a restore into a scratch
  database passes `smoke.mjs`. Once per phase.
- **Redis:** sessions only, no backup. Losing it logs everyone out, which is
  acceptable. Hardening and persistence: see Redis and gateway hardening.
- **AWS later:** the same CloudNativePG setup on S3, or RDS for PostgreSQL;
  decide then.

### Open questions for Dan

- Is the Azure for Students subscription active, and under which account
  (personal Microsoft account recommended)? Which regions does its "Allowed
  resource deployment regions" policy list?
- Create a Brevo account for SMTP? Needed before real mail; a new vendor.
- Which domain? It needs registering (cost) and pointing at Cloudflare.

### Sources (checked 2026-10-30)

- Azure for Students offer: https://azure.microsoft.com/en-us/free/students/
- Education Hub FAQ (renewal, cancellation, 90 days):
  https://learn.microsoft.com/en-us/azure/education-hub/azure-dev-tools-teaching/program-faq
- Free services amounts: https://azure.microsoft.com/en-us/pricing/free-services
- Prices: Azure Retail Prices API, https://prices.azure.com/api/retail/prices
  (VM, managed disk, public IP, bandwidth, Blob, Key Vault, PostgreSQL
  Flexible, Email meters)
- Bpsv2 sizes and burst credits:
  https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/general-purpose/bpsv2-series
- Cost Management supported offers (Azure for Students unsupported):
  https://learn.microsoft.com/en-us/azure/cost-management-billing/costs/understand-cost-mgt-data
- Port 25 block:
  https://learn.microsoft.com/en-us/azure/virtual-network/troubleshoot-outbound-smtp-connectivity
- ACS Email SMTP auth, limits and retirement:
  https://learn.microsoft.com/en-us/azure/communication-services/quickstarts/email/send-email-smtp/smtp-authentication,
  https://learn.microsoft.com/en-us/azure/communication-services/concepts/service-limits,
  https://learn.microsoft.com/en-us/azure/communication-services/acs-retirement-and-breaking-changes-guide
- Student region allow list (community answers, no official list):
  https://learn.microsoft.com/en-us/answers/questions/5638283/azure-policy-blocking-resource-deployment-in-multi
- Brevo domain authentication:
  https://developers.brevo.com/docs/domain-authentication-and-verification
- Terraform `azurerm` backend: https://developer.hashicorp.com/terraform/language/backend/azurerm
- Vault Azure Key Vault seal: https://developer.hashicorp.com/vault/docs/configuration/seal/azurekeyvault
- k3s requirements: https://docs.k3s.io/installation/requirements
- Keycloak databases: https://www.keycloak.org/server/db
- Keycloak sizing:
  https://www.keycloak.org/high-availability/multi-cluster/concepts-memory-and-cpu-sizing
- Keycloak tracing: https://www.keycloak.org/observability/tracing
- Spring Boot OpenTelemetry: https://docs.spring.io/spring-boot/reference/actuator/observability.html
- GitHub Packages billing:
  https://docs.github.com/en/billing/concepts/product-billing/github-packages
- Cloudflare DNS FAQ: https://developers.cloudflare.com/dns/faq/
- Versions: Terraform registry (azurerm, cloudflare), HashiCorp releases API,
  GitHub releases API for each project, the k3s channel server
  (https://update.k3s.io/v1-release/channels), Jenkins update center, and
  Docker Hub / Quay manifests for image architectures.

## Current state

Present tense only. Dated history is in git log.

Works and verified:

- **Login (feature 1).** BFF code + PKCE flow, Redis session, TokenRelay to the
  API, `/bff/user` returns the profile, 401 without a session, RP-initiated
  and back-channel logout. `node smoke.mjs` checks login, roles, CSRF, logout,
  session fixation, cookie flags, back-channel logout and parallel token
  refreshes against the live stack (45 assertions).
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
  (`login-update-profile.ftl`, the fallback for users without `fullName`), and
  all informational and confirm status pages
  render on `AuthShell`. Pages that collect credentials or set up factors (OTP,
  WebAuthn, recovery codes, X.509, update email, select authenticator or
  organization) still use the default theme.

- **Redis and gateway hardening.** Redis ACL, policy and network; session
  idle and absolute timeouts; security headers, CORS, actuator port, time
  limiter, circuit breaker, rate limiter, and the Redis outage page.
  `.\gradlew.bat :gateway:test` runs them against Redis in Testcontainers
  with the real config. `node check-headers.mjs <gateway> <management>`
  checks a running gateway (it must serve the SPA, so not through Vite).
- **Auth abuse protection.** Temporary lockout, password policy, explicit
  lifespans, rotation off, edge rate limits, enumeration choices (see
  Decisions). `./verify` runs the attack checks against dev Keycloak
  (`stuffing`, `lockout`, `policy`, `enumeration`, `enumdiff`, `reset`,
  `expiredlink`); `flood` runs against the compose.prod.yml stack with
  `EDGE_HOST=auth.localhost EDGE_INSECURE=1`. Edge limits checked locally
  with Traefik's self-signed cert, not yet on a real domain.

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
- Test users (dev only, `infra/playground-users-dev.json`):
  `alice@example.com` / `alice1234` and `admin@example.com` / `admin1234`.
  Usernames equal emails because the realm uses email as username;
  keycloak-config-cli rejects anything else. Each needs a `fullName`
  attribute: users go through the admin API, which enforces the user profile.
- Not checked by a tool: visual match to the shadcnstudio blocks and page
  switch flicker. Status pages other than expired and error were checked from
  Keycloakify mocks only.

- **Keycloak production slice (phase 1, local only).**
  `deploy/compose/compose.prod.yml`: Traefik, Keycloak from the custom image
  in production mode, Postgres 18.6 on a named volume, keycloak-config and
  keycloak-admin-url. One `up -d` from empty volumes gives a fully configured
  realm; `node deploy/compose/check.mjs` checks it (43 checks: prod profile,
  Postgres, health and metrics on 9000 only, issuer and forged
  `X-Forwarded-Host`, themed login, admin console and master realm 404 on the
  public host, console sign-in over the tunnel, client, mappers, default
  roles, IdPs, user profile, no test users). A console edit is undone by
  rerunning keycloak-config. Checked on the dev machine with `auth.localhost`
  and Traefik's self-signed cert, not yet with a real domain or Let's Encrypt.
- **Real email, prepared, not yet sent.** Provider chosen, realm and
  compose ready, `mailcheck.mjs` checked locally: `send` passes against the
  local prod stack pointed at Mailpit (both mails arrive) and fails on a
  dead SMTP host; `headers` and `dns` pass and fail on fixtures and public
  domains. Real mailbox and SPF/DKIM proof wait on a Brevo account, a
  domain and DNS. `deploy/compose/EMAIL.md` step 1 and `.env.example` still
  describe OCI.
- **Terraform for Azure, written, not applied.** `deploy/terraform`
  (bootstrap, `envs/azure`, `envs/dns`, `modules/azure-*`,
  `modules/dns-cloudflare`) passes `terraform validate` against azurerm
  5.12.0 and cloudflare 5.28.1, and `terraform -chdir=envs/azure test` (4
  runs, mocked provider: phase 1 and phase 2 wiring, VM size and operator IP
  guards). Run order in `deploy/terraform/README.md`. azurerm 5 note:
  subnet service endpoints are `service_endpoint` blocks.
- **Images (phase 1), built locally; CI written, not yet run on GitHub.** `gateway/Dockerfile` (with
  `web/dist`), `api/Dockerfile` and `keycloak-theme/Dockerfile` build for
  arm64 and amd64 with buildx; gateway and api run as uid 10001 on Spring
  Boot layers with a bash `/dev/tcp` healthcheck. `compose.prod.yml` has the
  gateway and api; the full stack from these images passes `check.mjs`
  (43), `check-headers.mjs` (20) and `smoke.mjs` (45) locally with
  `compose.local-test.yml`. Sizes and Trivy results:
  `.shipit/records/images-2026-10-31.md` (Critical/High only in Spring Boot
  BOM jars and the upstream Keycloak base). Building Keycloak for arm64 on
  the dev machine needs QEMU registered (`tonistiigi/binfmt --install
  arm64`), which Docker Desktop loses on restart.
  `.github/workflows/ci.yml` passes actionlint 1.7.12. Checked locally:
  `./gradlew build`, web and theme lint and tests, `./verify` (43/43) and
  the Gitleaks and Trivy commands pass on the repo; Gitleaks fails on a
  planted fake API key and Trivy on a planted lodash 4.17.20.
- Deployment: nothing is provisioned yet. See `.shipit/open.md`.

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
- Anything that spends credit or money beyond the plan in Deployment
  platform: any Azure resource not listed there, a bigger VM size than
  B2ps v2, turning auto-shutdown off in phase 2, the pay-as-you-go upgrade
  or adding a card, buying a domain, any AWS resource.
- The region choice, and starting or resizing the VM (it starts the meter).
- New vendor accounts: Brevo, Resend, or any other.
- Cloud credentials: `az login` sessions, role assignments to people,
  Entra app registrations or client secrets, the Brevo SMTP key, AWS keys,
  Cloudflare API tokens, GitHub tokens, or Vault recovery keys.
- DNS changes: nameservers, records, SPF and DKIM.
- Deleting data: disks, storage accounts, containers, backups, databases,
  the Key Vault or its seal key, Vault data, a realm wipe on a deployed
  environment, `docker compose down -v`, or the VM.
- Opening any port or admin UI to the internet beyond 80/443, and 22 from
  Dan's IP.
