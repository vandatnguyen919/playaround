---
title: Decisions
description: Short records of the main design choices, each linking to the full text in PRODUCT.md.
---

# Decisions

Short records of the choices that shape the playground. Each page gives the
decision, the reason, and the trade-off, then links to the full text.

The source is the
[Decisions section of PRODUCT.md](https://github.com/vandatnguyen919/playaround/blob/main/PRODUCT.md#decisions).
These pages are summaries. They leave out values and history that only matter
when you change the code.

| Decision | In one line |
| --- | --- |
| [BFF and token relay](./bff-and-token-relay.md) | The gateway is the only OAuth2 client. The API only validates tokens. |
| [Sessions in Redis](./sessions-in-redis.md) | The cookie names a session in Redis that also holds the tokens. |
| [CSRF and same origin](./csrf-and-same-origin.md) | One origin, no CORS, a cookie-to-header CSRF token. |
| [Logout](./logout.md) | Logout ends both sessions, from either side. |
| [Gateway hardening](./gateway-hardening.md) | Headers, timeouts, a circuit breaker, a rate limiter, and a locked-down Redis. |
| [Auth abuse protection](./auth-abuse-protection.md) | Temporary lockout, no account enumeration, short lifespans. |
| [Password reset](./password-reset.md) | Keycloak's emailed link, not a custom one-time code. |
| [Registration full name](./registration-full-name.md) | One `fullName` attribute instead of first and last name. |
| [Realm as code](./realm-as-code.md) | The realm is a JSON file applied on every start. |
| [Verification](./verification.md) | One `./verify` command, real Keycloak in tests, no retries. |
| [Docs site](./docs-site.md) | This site: what it is and what it never publishes. |

## Not covered here

PRODUCT.md also records how the project is deployed and operated. That is
outside the scope of this site, which is about the BFF pattern and the local
setup.
