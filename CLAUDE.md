# CLAUDE.md

## KeyLab

KeyLab (hear a keyboard build before you buy it) has its specs in `docs/keylab/`. Read `docs/keylab/README.md` first.

When you implement a user story (`US-xx`):

1. Find it in `docs/keylab/user-stories.md`. It lists the module, endpoint IDs, dependencies, screens and the "Done when" checks. The checks are the acceptance test.
2. Look up each endpoint ID (`CAT-01`, `BLD-04`, …) in `docs/keylab/api-design-v1.md` for behaviour and in `docs/keylab/openapi-v1.yaml` (search `x-endpoint-id`) for exact shapes. Follow the doc's conventions: `/v1` in the path, RFC 9457 problem+json errors, JSON Merge Patch with `If-Match`, `Idempotency-Key` on creates, cursor paging (`page_size`, `page_token`). Naming follows the REST API standards at https://github.com/vandatnguyen919/api-docs (`snake_case` path and query parameters, hyphenated plural paths, repeated singular parameter for multiple values); the design doc's Conventions section lists the deliberate exceptions.
3. Put backend code in the Spring Modulith module the story names, following `docs/keylab/modulith-plan.md`: one package per module under `app.keylab`, other modules reached only through the module's public API or events, one Postgres schema per module. Inside the module, follow the "Package structure" section of that file: a module with real business rules (catalog, sound, builds, billing) uses ports and adapters (`domain/`, `application/`, `query/`, `adapter/in/...`, `adapter/out/...`), and every new module of that kind starts that way; a thin module (backoffice, moderation, account) may go controller, application service, JDBC. Keep `ModularityTests` and the module's architecture test (such as `CatalogArchitectureTest`) passing.
4. Build the UI from the screens listed for the story in `docs/keylab/design/screens/`. Look at the `.png`, then read the `.dc.html` for exact copy, colours, spacing, states and links. `docs/keylab/design/README.md` explains the format and the style.
5. Data model: `docs/keylab/database-design.md`.
6. When the story's PR is opened, update its Notion ticket (Task Manager): tick the "Done when" items you verified, set PR to the PR URL, set Status to In review, and fix the ticket's module, endpoints or screens if they changed. Dan moves it to Done or Accepted. If Notion is not available in the session, list these updates under the story in `.shipit/open.md` instead.

If the specs disagree, `user-stories.md` wins for behaviour and the design screens win for visuals. Update the losing file in the same change and say so.

`docs/keylab/` is outside the Docusaurus site (`docs/docs`), so it is not published. Don't move it into `docs/docs` without running `docs/check-public.mjs`.
