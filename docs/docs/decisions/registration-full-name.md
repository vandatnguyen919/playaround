---
title: Registration full name
description: Why the user profile has one fullName attribute instead of first and last name.
---

# Registration full name

## Decision

The realm's user profile has one required attribute, `fullName`. Keycloak's
default `firstName` and `lastName` are hidden from registration. A protocol
mapper exposes `fullName` as the standard OIDC `name` claim.

## Why

The register form asks for one "Full name" field. Splitting it into first and
last name would mean guessing where a name divides, which is wrong for many
names. One attribute matches the form and invents nothing.

Keycloak renders registration and account forms from the profile schema, and
the theme renders those fields, so the register page gets its single field
with no extra code.

## Trade-off

`firstName` and `lastName` come pre-wired with the `given_name` and
`family_name` claims and with admin console support. This setup gives those
up.

## Allowed characters

The name is checked with a pattern that blocks HTML and script characters and
control characters, and allows Unicode letters, apostrophes, hyphens, periods
and parentheses.

Parentheses are allowed on purpose. Keycloak's built-in name validator blocks
them and cannot be configured, and display names from Google and GitHub often
contain them. Those users were being sent to a review page with a name they
could not keep.

## Social login

Each provider has a mapper that copies its display name into `fullName`, so a
first social login normally skips the profile review page.

Full text:
[Registration full name in PRODUCT.md](https://github.com/vandatnguyen919/playaround/blob/main/PRODUCT.md#registration-full-name).
