---
title: Login flow
description: Sequence diagram of the authorization code flow with PKCE through the gateway.
---

# Login flow

The gateway runs the OAuth2 authorization code flow with PKCE. The browser
only carries a one-time `code` between Keycloak and the gateway. The tokens
are exchanged server to server and never pass through the browser.

```mermaid
sequenceDiagram
    actor B as Browser
    participant G as Gateway (BFF)
    participant K as Keycloak
    participant R as Redis

    B->>G: GET /bff/me (no session)
    G-->>B: 401 (never a redirect)
    Note over B: the SPA shows "Sign in"

    B->>G: GET /oauth2/authorization/gateway (top-level navigation)
    G->>R: save pre-login session (state, nonce, code_verifier)
    G-->>B: 302 to Keycloak authorize (code_challenge S256, state, nonce)

    Note over B,K: front channel: plain browser redirects
    B->>K: GET authorize
    B->>K: POST credentials on the login page
    K-->>B: 302 to /login/oauth2/code/gateway?code=...&state=...

    B->>G: GET /login/oauth2/code/gateway?code=...
    Note over G,K: back channel: server to server
    G->>K: POST token (code + code_verifier + client secret)
    K-->>G: access token, refresh token, id token
    G->>R: save session under a new id (security context + tokens)
    G-->>B: Set-Cookie SESSION (HttpOnly), 302 to /

    B->>G: GET /bff/me (Cookie: SESSION)
    G-->>B: 200 profile
```

## What to notice

- **PKCE even with a client secret.** The gateway is a confidential client, and
  Spring Security adds PKCE on its own only for public clients. The gateway
  opts in, and the realm enforces `S256` for this client.
- **The session id changes at login.** The session that held the authorization
  request gets a new id once the user is signed in, so an id planted before
  login is worth nothing afterwards (session fixation).
- **`SameSite=Lax`, not `Strict`.** The redirect back from Keycloak is a
  top-level navigation that must carry the pre-login session cookie.
- **401, not a redirect, for XHR.** The SPA turns the `401` into a "Sign in"
  state and starts login with a full page navigation.

## Google and GitHub

Social login adds one more redirect in the middle. Keycloak sends the browser
to Google or GitHub, receives the result at its own broker endpoint, and then
continues exactly as above. The gateway cannot tell the difference: it still
receives a `code` from Keycloak and creates the same session. See
[Login](../use-cases/login.md).

## Try it

The README has a step by step tour with the requests to look for in the
browser's network tab, the Redis keys, and `curl` commands:
[Follow the flow](https://github.com/vandatnguyen919/playaround/blob/main/README.md#4-follow-the-flow).

Decision record: [BFF and token relay](../decisions/bff-and-token-relay.md).
