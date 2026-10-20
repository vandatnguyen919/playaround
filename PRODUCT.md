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
4. Forgot password, sends an email.
5. Password reset using an OTP code.
6. Role-based authorization (user/admin) on API and UI routes.

## Non-goals

Not now (could come later):

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
  session. The OIDC session registry is in memory by default, fine for one
  gateway instance. Back it with Redis if we ever run more than one.

### Password reset with an OTP code

Options considered:

- **(a) Keep the built-in email link flow and only theme it.** No SPI code and
  hard to break, but it is not the requested feature, and the demo becomes
  "open Mailpit, click the link".
- **(b) Custom Keycloak authenticator SPI for email OTP, plus a Keycloakify OTP
  page.** Delivers exactly the requested flow and shows how identity provider
  flows extend. All OTP details (length, TTL, resend, attempt limits) are ours.
- **(c) A community email OTP extension** (for example
  `mesutpiskin/keycloak-2fa-email-authenticator`, 286 stars, or
  `for-keycloak/email-otp-authenticator`). These exist but are built for login
  2FA, not password reset, so they need adapting anyway. Adding one is also a
  dependency outside the stated stack, which is a Stop.

Decision: **(b)**, keeping the built-in link flow intact as a fallback. Risks:
the SPI touches Keycloak internals that can change across releases, so re-test
on every Keycloak upgrade; OTP security is ours to get right (short TTL, hashed
single-use codes, attempt limits wired to Keycloak brute force protection, no
user enumeration); more test surface than (a). Revisit if Keycloak ships a
built-in OTP reset or a maintained reset-specific extension appears.

### Registration full name

**One `fullName` attribute in the Keycloak user profile.** The default profile
is `username`, `email`, `firstName`, `lastName`. `username` and `email` cannot
be removed; `firstName` and `lastName` are just defaults and can be hidden from
registration. Add `fullName` as required, with `length` and
`person-name-prohibited-characters` validators, and expose it as the `name`
claim through an OIDC user attribute protocol mapper. Reason: it matches the
requested one-field register form and does not invent a name split. Tradeoff:
`firstName`/`lastName` arrive pre-wired with `given_name`/`family_name` claims
and admin console support. Registration and account forms render from the
profile schema, and Keycloakify renders those fields, so the register page gets
one Full name field for free.

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
  register, forgot password, OTP input, and reset password mirror the linked
  shadcn blocks so the theme work has a concrete target.
- **Local infra via docker-compose.** Keycloak, Redis, Mailpit for SMTP. Keeps
  the demo self-contained on a dev machine.

### Keycloakify page design (prototype rounds 1 to 2)

Mockups in `/keycloak-theme` (Vite dev server) confirm the look. Round 1 came
from the shadcnstudio 07 blocks and the shadcn InputOTP form example. Round 2
moved to the split layout from Dan's reference image.

- Split screen 1:1 on desktop. Left half is a dark silk wave panel (abstract
  liquid metal waves built as SVG gradients with a slow drift) with the
  uppercase headline "One cookie. Zero tokens." and one line of product copy
  at the bottom. Right half is the auth form on white. Below lg the wave
  panel is hidden and the form centers.
- Fields: label above every input, red asterisk on required ones (login and
  forgot password included), icon inside the input (mail, lock, user),
  show/hide toggle on passwords.
- Social login: Google and GitHub, full width and stacked (GitHub replaces
  Facebook). Then an "Or" divider.
- Headings are left aligned. The primary action is a full width h-11
  near-black button. Copy follows the reference pattern: "Sign in to
  authn-authz-playground".
- States: submit stays disabled until valid (reset password until both fields
  match and are 8+ characters, OTP until all 6 digits), inline error text
  under the fields, OTP shows a partial code in the 3+3 slot layout with a
  Resend Code button.
- Reusable pieces live in `/keycloak-theme/src/mockups/`: AuthShell,
  SilkWaves, PageHeading, SocialButtons, OrDivider, RequiredLabel,
  SubmitButton, EmailField, NameField, PasswordField, BackToLoginButton.

Deliberate deviations from the references: the OTP title is "Check your email"
to fit the reset flow; login shows only email and password (no name field),
matching the login feature; the wave panel carries product copy instead of the
reference photo grid.

Stated assumptions:

- Everything runs locally via docker-compose. No cloud services.
- Email is delivered to Mailpit in dev, not a real inbox.

Unresolved questions: none blocking the first build. Real Google and GitHub
OAuth credentials are needed before feature 3 can be tested live.

## Current state

Email/password login through the BFF works end to end and is verified
(2026-10-18). The gateway is the OIDC client (code + PKCE S256), keeps the
security context and the authorized client (access and refresh tokens) in the
Redis-backed WebSession, and relays the access token to the API with TokenRelay.
`GET /bff/user` returns the logged-in user's profile from the API's JWT
resource server; with no valid session it is rejected with 401. `/web` shows
the logged-in user (name, email, username, roles) with Sign in / Sign out, and
`GET /bff/csrf` seeds the XSRF-TOKEN cookie Axios uses. Verified: the session
key and the JWTs appear in Redis; localStorage and sessionStorage are empty and
JS sees only the XSRF cookie (SESSION is HttpOnly, SameSite=Lax); a second
gateway instance on 8191 serves the same session and relays the stored token;
logout (CSRF POST, then top-level navigation to Keycloak's end session) removes
the Redis session, clears the cookie, and kills the Keycloak SSO session, since
signing in again shows the login form. Keycloak `start-dev` re-runs a Quarkus
build on every start and is slow on a loaded dev machine; the compose
healthcheck allows up to 8 minutes. The Keycloakify mockups still live in
`/keycloak-theme`.

Role-based authorization is now wired through the BFF and API. Keycloak
`realm_access.roles` map to `ROLE_user` and `ROLE_admin`. `/api/me` and
`/api/admin` enforce the roles with `@PreAuthorize`; `/bff/me` and
`/bff/admin` enforce the same roles before token relay. The React app has
`/me`, `/admin`, and `/forbidden` guarded routes, with Axios redirects for
401 and 403 responses. Focused API and gateway tests cover role mapping and
anonymous, user, and admin authorization behavior.

Next useful step: registration with full name, email, password (feature 2).
Note: the Keycloak access token carries name, email, preferred_username and
realm roles but no `sub` claim; the profile endpoint returns those four.

## Stops

Pause and ask before:

- Anything needing real Google or GitHub OAuth credentials.
- Any change to the architecture above.
- Any new dependency outside the stated stack.
