---
title: Running locally
description: Start Keycloak, Redis and Mailpit with Docker Compose, then the API, the gateway and the SPA.
---

# Running locally

Everything runs on your machine. Keycloak, Redis and Mailpit run in Docker
Compose. The API, the gateway and the SPA run from source.

The repository README is the reference and has the Windows spellings:
[Run it](https://github.com/vandatnguyen919/playaround/blob/main/README.md#run-it).

## You need

- JDK 17 or newer to launch Gradle. The build downloads the Java toolchain it
  compiles with.
- Node 22.
- Docker with Compose v2.

## Steps

Run from the repository root, on macOS or Linux. On Windows use
`.\gradlew.bat`.

**1. Build the Keycloak theme.** Once, and again after theme changes.

```bash
cd keycloak-theme && npm install && npm run build-keycloak-theme && cd ..
```

**2. Start the containers.** The first start can take a few minutes while
Keycloak builds.

```bash
docker compose -f infra/docker-compose.yml up -d --wait
```

A one-shot `keycloak-config` service applies the realm from
`infra/playground-realm.json` and the development users, then exits.

**3. Start the API and the gateway**, each in its own terminal.

```bash
./gradlew :api:bootRun
```

```bash
./gradlew :gateway:bootRun
```

**4. Start the SPA.**

```bash
cd web && npm install && npm run dev
```

**5. Open http://localhost:5174** and choose **Sign in**.

## What runs where

| What | Address |
| --- | --- |
| App (Vite, proxies to the gateway) | http://localhost:5174 |
| Gateway | http://localhost:8181 |
| API | http://localhost:8182 |
| Keycloak | http://localhost:8080 |
| Mailpit inbox | http://localhost:8025 |
| Redis | `localhost:6379`, loopback only |

Always use the app address in the browser. The session cookie and the
redirect URIs are built for that origin.

## Signing in

- **Development users** are created from
  [`infra/playground-users-dev.json`](https://github.com/vandatnguyen919/playaround/blob/main/infra/playground-users-dev.json):
  one with the `user` role and one with `user` and `admin`. Their logins are
  in that file and in the README, and exist only in development.
- **Or register your own** from the login page. The verification mail arrives
  in Mailpit.
- **Google and GitHub** need your own OAuth apps. See [Login](./use-cases/login.md).

## Configuration

Compose and the apps start with development defaults, so no setup is needed
for a first run. To set your own values, copy `infra/.env.example` to
`infra/.env` and edit it. That file is ignored by git. Never commit real
values.

Changing the realm: edit `infra/playground-realm.json` and re-apply it. Do
not change settings in the Keycloak admin console, because the next start
puts the file's values back.

```bash
docker compose -f infra/docker-compose.yml up keycloak-config
```

## Check that it works

With everything running:

```bash
node smoke.mjs
```

It creates two throwaway users, drives the real login over HTTP, checks
sessions, roles, CSRF, logout and token refresh, and deletes the users. The
full set of automated checks runs through one command, described in
[Verification](./decisions/verification.md).

## Stop

```bash
docker compose -f infra/docker-compose.yml down
```

Stop the three dev processes with Ctrl+C.

## If something fails

The README has a troubleshooting list for the usual causes: "Invalid redirect
uri", a cookie that is not sent, CORS errors from absolute URLs, Redis not
running, Keycloak still starting, and a 403 from a missing CSRF header. See
[Troubleshooting](https://github.com/vandatnguyen919/playaround/blob/main/README.md#7-troubleshooting).
