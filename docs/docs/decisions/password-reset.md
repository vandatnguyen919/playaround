---
title: Password reset
description: Why password reset uses Keycloak's built-in emailed link instead of a custom one-time code.
---

# Password reset

## Decision

Use Keycloak's built-in "forgot password" flow, which emails a link, and
style it with the theme. No custom Keycloak extension.

## What was considered

The first plan was a reset by an emailed one-time code, built as a custom
authenticator inside Keycloak. Keycloak has no built-in one.

## Why the link flow won

- It already worked and was verified end to end.
- A custom authenticator means Keycloak internals to maintain across upgrades,
  and one-time code security to get right: attempts, expiry, resend limits.
- None of that adds to what the playground teaches, which is the BFF pattern.

## Trade-off

The reset happens by clicking a link, not by typing a code into the app. And
one known gap of the built-in flow stays: an older unused link works until it
expires. See [Auth abuse protection](./auth-abuse-protection.md).

## Revisit when

A one-time code reset becomes a goal again. It would mean a custom extension
or a community one.

Flow: [Forgot password](../use-cases/forgot-password.md).

Full text:
[Password reset in PRODUCT.md](https://github.com/vandatnguyen919/playaround/blob/main/PRODUCT.md#password-reset).
