---
title: Realm as code
description: Why the Keycloak realm is a JSON file applied on every start with keycloak-config-cli.
---

# Realm as code

## Decision

The whole realm lives in one file, `infra/playground-realm.json`. A one-shot
Compose service runs
[keycloak-config-cli](https://github.com/adorsys/keycloak-config-cli), which
applies the file through Keycloak's admin API after Keycloak is healthy, on
every start, and then exits.

## What it replaced

Keycloak's own `--import-realm`. That import runs only when the realm does not
exist yet. Every later change had to be made by hand in the admin console or
through a one-off API call, and the file drifted from the running realm.

## Why this tool

- It reuses the realm export format as is. No rewrite.
- It runs next to Keycloak inside Compose and needs no state store.
- With its import cache off, every run also undoes changes made in the
  console. The file is the truth.

A Terraform provider was the alternative. It would mean rewriting the working
JSON in another language, keeping a state file that contains client secrets,
and a separate apply step for each realm change.

## How values differ per environment

Secrets and addresses are placeholders in the file, filled from environment
variables when the tool runs: client and provider secrets, the app URL used
for redirect URIs, the back-channel logout URL, and mail settings. The file
itself holds no secrets.

Development applies a second file with test users. Other environments do not.

## Trade-offs

- No preview of what will change before it is applied.
- The tool's releases lag behind Keycloak's.

## In practice

Change the realm by editing the file and re-running the config service. Do not
click settings in the admin console: the next start puts the file's values
back. See [Running locally](../running-locally.md).

Full text:
[Realm provisioning in PRODUCT.md](https://github.com/vandatnguyen919/playaround/blob/main/PRODUCT.md#realm-provisioning).
