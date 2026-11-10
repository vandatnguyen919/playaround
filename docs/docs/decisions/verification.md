---
title: Verification
description: One verify command for every automated check, real Keycloak in tests, and a no-retry policy.
---

# Verification

## Decision

One entry point, `./verify`, runs every automated check. It is headless, asks
nothing, and CI calls the same command.

```bash
./verify
```

It runs named suites. Name one or more to run only those.

| Suite | What it checks |
| --- | --- |
| `gateway` | Sessions, token relay, logout, back-channel logout, and Redis hardening, against Redis and Keycloak in Testcontainers. |
| `api` | Role rules and JWT validation: valid, expired, tampered and forged tokens. |
| `web` | Lint and unit tests of the SPA and the theme. |
| `attacks` | Attacks that must fail safely. See [Auth abuse protection](./auth-abuse-protection.md). |
| `smoke` | Login, roles, CSRF, logout, session fixation, back-channel logout and token refresh over HTTP. |
| `headers` | Security headers, CORS and actuator exposure. |
| `e2e` | Browser flows in Playwright. |
| `docs` | This site builds with broken links as errors, and holds nothing it must not publish. |

## Rules

- **Blocked is not skipped.** If a suite's services do not answer, the suite
  is reported as blocked and the run fails. Nothing is skipped quietly.
- **Tests use a real Keycloak.** The Java tests start Keycloak in a container
  with the same image and realm file as development, so the realm under test
  is the real one.
- **Token tests in two layers.** A stub key set lets the API be tested with
  tokens Keycloak would never issue (expired, forged, `alg: none`). Real
  Keycloak tokens prove the wiring.
- **Attack checks pass when the attack fails.** They are regression tests for
  the security choices.

## Flaky tests

- **No automatic retries**, anywhere. A retry that passes hides the failure
  that matters.
- **A red run stays red.** A rerun may collect logs, but its result does not
  replace the first one.
- **Wait on a condition, never on a fixed sleep.**
- **Each test makes and deletes its own users.** No test depends on another.
- **Quarantine is explicit and short**, with a written reason.

Full text:
[Verification in PRODUCT.md](https://github.com/vandatnguyen919/playaround/blob/main/PRODUCT.md#verification).
How to run it:
[Verify in the README](https://github.com/vandatnguyen919/playaround/blob/main/README.md#verify).
