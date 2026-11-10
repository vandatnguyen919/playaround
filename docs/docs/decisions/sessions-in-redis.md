---
title: Sessions in Redis
description: Why the session lives in Redis, when its id changes, and how long it lasts.
---

# Sessions in Redis

## Decision

The gateway keeps its sessions in Redis with Spring Session. The `SESSION`
cookie is only an id. The session behind it holds the security context and the
access and refresh tokens.

## Why

- Tokens stay server side and survive a gateway restart.
- Any gateway instance can serve any cookie.
- Deleting the Redis key ends the session at once, which is what logout and
  back-channel logout rely on.

## Session id rotation

The id changes **at login** and **only when the signed-in user changes**.

Spring's stock behaviour rotates the id on every save of the security
context. A token refresh is such a save. With several requests in flight at
the moment a token expires, the ones still carrying the old id would be
logged out. The gateway uses a small variant that keeps the id stable across
refreshes and still rotates it at login, which is what defends against session
fixation.

A smoke check covers this: 8 parallel calls at token expiry must all succeed
on the same session id.

## Timeouts

| Timeout | Value | Meaning |
| --- | --- | --- |
| Idle | 30 minutes | Ends after this long without a request. |
| Absolute | 10 hours | Ends this long after login, however active. |

Both match Keycloak's SSO session settings, so the two ends expire together
and a new login after the absolute timeout really asks for the password.

## Cookie flags

`SESSION` is `HttpOnly; SameSite=Lax; Path=/`. `Lax` rather than `Strict`
because the redirect back from Keycloak must carry the pre-login session.
`Secure` is off on plain http in development and on behind https.

## Trade-off

Redis becomes a hard dependency of login. When it is down the gateway answers
`503` with a short notice instead of failing in confusing ways, and it does
not clear cookies, so surviving sessions work again afterwards.

Full text:
[Version stack](https://github.com/vandatnguyen919/playaround/blob/main/PRODUCT.md#version-stack)
and
[Redis and gateway hardening](https://github.com/vandatnguyen919/playaround/blob/main/PRODUCT.md#redis-and-gateway-hardening)
in PRODUCT.md, and
[Session hardening](https://github.com/vandatnguyen919/playaround/blob/main/README.md#session-hardening)
in the README.
