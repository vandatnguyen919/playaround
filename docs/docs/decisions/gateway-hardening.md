---
title: Gateway hardening
description: Security headers, limits toward the API, behaviour when Redis is down, and Redis access control.
---

# Gateway hardening

The BFF concentrates risk in one place: the gateway holds every user's tokens
through Redis. These choices limit what a mistake or an outage can do.

## Redis

- **Access control lists, no shared password.** The default user is off. The
  gateway signs in as its own user, which may touch only its own key prefixes
  and has no dangerous commands such as flushing or listing all keys.
- **Not reachable from outside.** In development Redis listens on loopback
  only.
- **Snapshots, not an append log.** A restart keeps most sessions. At worst a
  few minutes of logins sign in again.
- **Bounded memory with a TTL-aware eviction policy.** Every key expires. When
  full, Redis drops rate limiter buckets and nearly idle sessions before the
  long-lived entries that back-channel logout needs.

## Response headers

The gateway serves the built SPA itself so that the HTML carries the headers:

- A strict Content Security Policy: everything from `'self'`, no inline
  script or style, no framing.
- `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy: same-origin`.
- HSTS, sent on https only.

## CORS

Only the app's own origin is allowed. Any other origin gets `403`, preflight
or not.

## Toward the API

| Guard | Setting | Result when it trips |
| --- | --- | --- |
| Time limit | 3 seconds | `504 api_timeout` |
| Circuit breaker | opens at 50% failures over 20 calls | `503 api_unavailable` with `Retry-After` |
| Rate limiter | 10 requests a second, bursts of 20, per user and route | `429` |

The rate limiter keeps its buckets in Redis. If Redis fails the limiter lets
requests through, but the session lookup fails first anyway.

## When Redis is down

Users get `503` with `Retry-After`: page loads see a small "We'll be right
back" page, and the SPA's calls get JSON it shows as a notice. No cookie is
cleared, so sessions that survive in Redis work again afterwards. The
gateway's liveness check ignores Redis, so a Redis outage does not restart the
gateway.

## Actuator

Health and info only, on a separate management port bound to loopback. Health
shows no details.

## Checked by

Gateway tests run against a real Redis in Testcontainers with the real
configuration: the ACL, the limiter, the time limit, the circuit breaker, and
Redis going down. A header check script runs against a live gateway.

Full text:
[Redis and gateway hardening in PRODUCT.md](https://github.com/vandatnguyen919/playaround/blob/main/PRODUCT.md#redis-and-gateway-hardening).
