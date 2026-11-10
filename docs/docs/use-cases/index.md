---
title: Use cases
description: What a user can do in the playground and which part handles each step.
---

# Use cases

Each page says what the user does, what happens behind it, and how it is
checked.

| Use case | Who does the work |
| --- | --- |
| [Register](./register.md) | Keycloak (themed page), Mailpit for the verification mail |
| [Login](./login.md) | Keycloak for credentials, the gateway for the session |
| [Forgot password](./forgot-password.md) | Keycloak, with an emailed link |
| [Logout](./logout.md) | The gateway, then Keycloak |

The gateway and the SPA have no login, register or reset forms of their own.
Those pages belong to Keycloak and are styled with a
[Keycloakify](https://www.keycloakify.dev/) theme so they look like part of the
app. The app never handles a password.

## Roles

Every new user gets the `user` role by default. `admin` is granted by hand.

| Route | Needs |
| --- | --- |
| `/me` in the SPA, `/bff/me` and `/api/me` | `user` |
| `/admin` in the SPA, `/bff/admin` and `/api/admin` | `admin` |

A signed-in user without the role gets `403`, and the SPA shows a "forbidden"
page. No session at all gets `401`.
