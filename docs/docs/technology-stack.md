---
title: Technology stack
description: The pinned versions the playground is built on and why each was chosen.
---

# Technology stack

A summary of the pinned stack. Versions change in the repository first, so
check
[Version stack in PRODUCT.md](https://github.com/vandatnguyen919/playaround/blob/main/PRODUCT.md#version-stack)
for the current numbers and the full reasons.

## Backend

| Piece | Version | Why |
| --- | --- | --- |
| Java | 26 | Supported by the Spring Boot line in use. |
| Gradle (Groovy DSL) | 9.8.1 | Multi-project build for the gateway and the API. |
| Spring Boot, Spring Security | 4.1.x, 7 | The current line. |
| Spring Cloud | 2025.1.x (Oakwood) | The release train for Spring Boot 4.0 and 4.1. |
| Spring Cloud Gateway | 5.0.x, WebFlux flavor | `TokenRelay` is a native filter, and the CSRF, OIDC logout and back-channel logout pieces are documented for the reactive stack. |
| Spring Session Data Redis | with the above | The session cookie names a session that lives in Redis. |

The trade-off of the WebFlux flavor is a reactive stack on Netty. The WebMVC
flavor of the gateway would also work.

## Identity

| Piece | Version | Why |
| --- | --- | --- |
| Keycloak | 26.8.x | The identity provider: login, registration, reset, brokering. |
| Keycloakify | 11.x | Builds the login theme as a React app, with a shadcn/ui and Tailwind starter. |
| keycloak-config-cli | 6.5.x | Applies the realm from a JSON file on every start. See [Realm as code](./decisions/realm-as-code.md). |

## Frontend

| Piece | Why |
| --- | --- |
| React and TypeScript on Vite | A small SPA that uses a session cookie only. |
| Axios | Its default CSRF cookie and header names match Spring Security's, so the SPA needs only `withCredentials`. |

## Local infrastructure

| Piece | Version | Role |
| --- | --- | --- |
| Redis | 8.10 | Sessions, tokens, the logout registry, rate limiter buckets. |
| Mailpit | 1.31 | Catches verification and reset mail. |
| Docker Compose | v2 | Runs Keycloak, Redis and Mailpit. |

Two more containers are optional and for development only: a Grafana
OpenTelemetry stack for traces, metrics and logs, and a local Vault for
development secrets. Neither is needed to run the demo.

## Testing

| Piece | Role |
| --- | --- |
| JUnit with Testcontainers | Gateway and API tests against real Redis and Keycloak containers. |
| Node scripts | Smoke and attack checks over plain HTTP. |
| Playwright (Chromium) | Browser flows, with mail read from the Mailpit API. |
| `./verify` | One entry point that runs all of the above. See [Verification](./decisions/verification.md). |

## This site

Docusaurus 3 with the Mermaid theme, in its own npm package under `docs/`. See
[Docs site](./decisions/docs-site.md).

:::info Versions are pinned
The project does not chase the latest release. Versions are re-checked when a
build fails, a security scan asks for it, or a major upgrade is planned.
:::
