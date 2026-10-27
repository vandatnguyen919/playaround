# authn-authz-playground

## Purpose

A learning playground that shows how a browser, a BFF gateway, and an identity
provider fit together in a modern authentication and authorization setup. The
core teaching point: the browser never sees tokens. It holds only a session
cookie. Tokens live on the server side.

Mode: small project / demo.

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

Outside this project's purpose:

- Production deployment.
- Kubernetes.
- Multi-tenant realms.

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

- Everything runs locally via docker-compose. No cloud services.
- Email is delivered to Mailpit in dev, not a real inbox.

Unresolved questions: none blocking the first build. Real Google and GitHub
OAuth credentials are needed before feature 3 can be tested live.

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

Next: every feature except Google and GitHub login is done. Feature 3 is
blocked on real OAuth credentials (a Stop).

## Stops

Pause and ask before:

- Anything needing real Google or GitHub OAuth credentials.
- Any change to the architecture above.
- Any new dependency outside the stated stack.
