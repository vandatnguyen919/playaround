---
title: API
description: The endpoints the gateway exposes to the browser and the protected endpoints of the API behind it.
---

# API

Two layers. The browser only ever talks to the **gateway**. The **API** sits
behind it and accepts bearer tokens.

Ports are the local development ones: the app origin is
`http://localhost:5174` (Vite, proxying to the gateway on `8181`), and the API
listens on `8182`.

## Gateway endpoints

What the browser can call. All are same origin.

### Session and login

| Method and path | Auth | What it does |
| --- | --- | --- |
| `GET /oauth2/authorization/gateway` | none | Starts login. Answers `302` to Keycloak. Open it as a top-level navigation, not with XHR. |
| `GET /login/oauth2/code/gateway` | none | The OAuth2 callback. Exchanges the code, creates the session, sets `SESSION`, redirects to `/`. |
| `GET /bff/csrf` | none | Returns the CSRF token and writes the `XSRF-TOKEN` cookie. The SPA calls it once on load. |
| `POST /logout` | session + CSRF header | Ends the session. Answers `200` with `{"logoutUrl": "..."}` for the SPA to open. |
| `POST /logout/connect/back-channel/gateway` | signed logout token | For Keycloak only. Ends the session named by the token. |

### Relayed to the API

The gateway checks the session and role, adds the bearer token, and forwards.

| Method and path | Needs | Forwards to |
| --- | --- | --- |
| `GET /bff/me` | role `user` | `GET /api/me` |
| `GET /bff/admin` | role `admin` | `GET /api/admin` |
| `GET /bff/user` | a session | `GET /api/me` (kept for compatibility) |
| `/api/**` | a session | the same path on the API |

### Static files

In a built setup the gateway also serves the SPA (`/`, `/index.html`,
`/assets/**`, and the SPA routes `/me`, `/admin`, `/forbidden`), so the HTML
carries the security headers. In development Vite serves it.

### Health

Actuator is on a separate management port (`9181`), bound to loopback, and
exposes only `/actuator/health` and `/actuator/info`. It is not reachable
through the app origin.

### What a caller can get back

| Status | Meaning |
| --- | --- |
| `401` | No valid session. Never a redirect: the SPA starts login itself. |
| `403` | Signed in but missing the role, or a state-changing request without a valid `X-XSRF-TOKEN` header, or a cross-origin call. |
| `429` | Over the rate limit (10 requests a second, bursts of 20, per user and route). |
| `502` `api_error`, `503` `api_unavailable`, `504` `api_timeout` | The API failed, the circuit is open, or it was too slow. JSON body with `error` and `message`. |
| `503` `session_store_unavailable` | Redis is down. Carries `Retry-After`. Page loads get a small "be right back" page. |

### Calling it from the SPA

```js
import axios from 'axios'

// Relative URLs only. Axios copies the XSRF-TOKEN cookie into the
// X-XSRF-TOKEN header by default.
const http = axios.create({ withCredentials: true })

await http.get('/bff/csrf')           // make sure the CSRF cookie exists
const me = await http.get('/bff/me')  // 200 with the profile, or 401

// Login and logout end in a full page navigation:
window.location.assign('/oauth2/authorization/gateway')
const { data } = await http.post('/logout')
window.location.assign(data.logoutUrl)
```

## Protected API endpoints

The API is a JWT resource server. It validates the signature against
Keycloak's keys, the issuer and the expiry, then checks the role from
`realm_access.roles`. It has no session and no cookies.

| Method and path | Role | Response |
| --- | --- | --- |
| `GET /api/me` (alias `/api/user`) | `user` | The caller's profile, built from the token's claims. |
| `GET /api/admin` | `admin` | A confirmation message and the caller's username. |
| `GET /actuator/health` | none | Health status. |

Example profile:

```json
{
  "name": "Ada Example",
  "preferredUsername": "ada@example.com",
  "email": "ada@example.com",
  "roles": ["user"]
}
```

Without a valid token the API answers `401`. With a valid token but the wrong
role it answers `403`.

:::tip The API is not meant to be called from a browser
In development you can reach port `8182` directly, but only with a bearer
token, and the browser never has one. That is the point of the pattern.
:::

Sources: the route table in
[`gateway/src/main/resources/application.yml`](https://github.com/vandatnguyen919/playaround/blob/main/gateway/src/main/resources/application.yml)
and
[`UserController.java`](https://github.com/vandatnguyen919/playaround/blob/main/api/src/main/java/dev/playground/api/UserController.java).
