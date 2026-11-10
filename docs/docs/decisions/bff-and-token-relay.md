---
title: BFF and token relay
description: Why the gateway is the only OAuth2 client and the API is a plain resource server.
---

# BFF and token relay

## Decision

- The **gateway** is the only OAuth2 client. It uses the authorization code
  flow with PKCE.
- The **API** is a resource server only. It validates JWTs and knows nothing
  about sessions or login.
- The **SPA** holds no client configuration and never sees a token.
- The gateway's `TokenRelay` filter forwards the signed-in user's access token
  to the API as a bearer header.

## Why

A token in the browser can be read by any script that runs on the page, and a
stolen token works from anywhere until it expires. A session cookie that is
`HttpOnly` cannot be read by script, and it is useless without the gateway.

Keeping the client registration in one place also keeps the client secret in
one place, on the server.

## Details that matter

- **PKCE is switched on explicitly.** Spring Security adds PKCE by itself only
  for public clients. The gateway is confidential, and the realm requires
  `S256`, so the gateway opts in.
- **Tokens are stored in the session, not in memory.** Spring's default store
  for the authorized client is in memory. Here it is the Redis-backed session,
  so tokens survive a restart and work across several gateway instances.
- **Unauthenticated calls get `401`.** A redirect to Keycloak would be useless
  to an XHR, so the SPA starts login with a page navigation.

## Trade-offs

- The gateway is stateful and needs Redis.
- Every API call takes one more hop.
- Cookies bring CSRF back, which needs its own defence. See
  [CSRF and same origin](./csrf-and-same-origin.md).

Flows: [Login flow](../architecture/login-flow.md),
[Token relay](../architecture/token-relay.md).

Full text:
[BFF specifics in PRODUCT.md](https://github.com/vandatnguyen919/playaround/blob/main/PRODUCT.md#bff-specifics).
