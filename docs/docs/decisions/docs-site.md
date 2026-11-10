---
title: Docs site
description: What this documentation site is, where its content comes from, and what it never publishes.
---

# Docs site

## Decision

A Docusaurus site in `docs/`, as its own npm package, separate from the SPA.
It is published to GitHub Pages by a GitHub Actions workflow when `docs/`
changes on the main branch.

## Scope

For developers learning the BFF pattern: the idea, the flows, the endpoints,
how to run it locally, and why it is built this way.

Not in scope: how the project is deployed and operated.

## Source of truth

PRODUCT.md and the README stay the source of truth. Pages here summarise and
link to them. A page should never become the only place a decision is
written down.

## What is never published here

- Secrets, tokens, keys, and the development default values of secrets.
- Development user passwords.
- Addresses of anything deployed, and hostnames that only exist inside a
  container network.
- Paths in the secret store.
- Budget, billing and cloud account details.

Addresses on `localhost` and the names of files in the repository are fine.

## How that is enforced

`./verify docs` builds the site and then runs a scan over the page sources
and the built HTML for those kinds of content. A match fails the run. The
same suite runs in CI on every pull request, and the publishing workflow runs
it again before anything is uploaded.

The build itself fails on a broken link, a broken anchor or a broken image.

## Why Docusaurus

Markdown pages with a sidebar, Mermaid diagrams rendered from text, and a
broken link check in the build. It needs no server: the output is static
files.

## Trade-off

One more npm package with its own lockfile to keep updated. Dependabot covers
it with the other packages.
