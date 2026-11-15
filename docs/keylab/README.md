# KeyLab specs

Everything needed to build KeyLab, kept next to the code. Start here, then open the file for the part you are working on.

| File | What it is |
| --- | --- |
| [user-stories.md](user-stories.md) | US-01…US-44 in five phases: story, module, endpoints, screens, "Done when" checks, Notion ticket |
| [api-design-v1.md](api-design-v1.md) | REST API v1: versioning, conventions, every endpoint (CAT, BLD, ME, SOC, ACC, ADM) and the story ↔ endpoint map |
| [openapi-v1.yaml](openapi-v1.yaml) | The same API as OpenAPI 3.1 (draft). Operations carry `x-endpoint-id`, `x-stories`, `x-module`, `x-required-role` |
| [modulith-plan.md](modulith-plan.md) | `keylab-api` as one Spring Modulith app: 8 modules, package structure, rules that keep a later split cheap |
| [database-design.md](database-design.md) | Postgres schema, storage map, how builds are versioned; [schema.drawio](schema.drawio) has every table |
| [design/README.md](design/README.md) | Design style, how to read a `.dc.html`, and the list of all artboards in [design/screens](design/screens/) |
| [diagrams/](diagrams/) | Diagram images used by the docs above |

Precedence when two files disagree: `user-stories.md` "Done when" › `api-design-v1.md` › `openapi-v1.yaml` › the design screens for behaviour; the design screens win for layout, copy and visuals. Fix the losing file in the same change.

This folder sits outside `docs/docs`, so the public Docusaurus site neither publishes nor scans it.
