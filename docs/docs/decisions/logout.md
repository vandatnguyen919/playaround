---
title: Logout
description: Why logout ends both the gateway session and the Keycloak session, from either side.
---

# Logout

## Decision

Two mechanisms, one for each direction:

- **RP-initiated logout.** When the user signs out in the app, the gateway
  ends its own session and then sends the browser to Keycloak's end-session
  endpoint, which redirects back to the app.
- **Back-channel logout.** When the session ends at Keycloak first, Keycloak
  posts a signed logout token to the gateway, which deletes the matching
  session.

## Why both

Each one alone leaves a session alive somewhere:

| Only | What goes wrong |
| --- | --- |
| Local logout | The Keycloak SSO session survives. The next **Sign in** logs the user back in with no password. |
| RP-initiated logout | A logout that starts at Keycloak (an admin, another app) never reaches the gateway. |

## Details that matter

- **`POST /logout` answers with JSON, not a redirect.** The SPA calls it with
  XHR, which cannot follow the redirect chain through Keycloak. The gateway
  returns the end-session URL and the SPA navigates to it.
- **The session cookie is named `SESSION`.** The back-channel handler ends the
  session by replaying the cookie by name. Left at the framework default it
  would never match Spring Session's cookie.
- **The logout registry is in Redis.** It maps a Keycloak session to a gateway
  session. In memory, the mapping would be lost on a gateway restart while the
  sessions themselves survive in Redis, and a later Keycloak logout would do
  nothing. This was reproduced before the change.
- **The registry holds no tokens.**
- **Post-logout redirect URIs** reuse the client's redirect URIs in the realm,
  so there is one list to maintain.

## Trade-off

Back-channel logout means Keycloak must be able to reach the gateway over the
network, and the gateway exposes one endpoint that accepts unauthenticated
posts. It only acts on a logout token with a valid Keycloak signature.

Flows: [Logout use case](../use-cases/logout.md),
[Back-channel logout](../architecture/back-channel-logout.md).

Full text:
[BFF specifics in PRODUCT.md](https://github.com/vandatnguyen919/playaround/blob/main/PRODUCT.md#bff-specifics).
