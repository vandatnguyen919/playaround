# 0001 · Where the sound recipe (BLD-10) is computed

- **Status:** Accepted: option B, server-computed in `catalog` (Dan, KL2-0, 2026-11-20)
- **Answers:** the open question in [api-design-v1.md](../api-design-v1.md#open-questions): is the sound recipe computed on the server, or shipped as a rule table so the browser computes it offline?
- **Affects:** US-05, US-06, US-07, US-09, US-14, US-19 now; the build's saved sound (US-08), sound signature (US-16) and share card (US-11) later

## What a recipe is

Input: a parts mix. Switch and variant, mods with levels, keycap set, case material, plate, mount.
Output (`SoundRecipe` in [openapi-v1.yaml](../openapi-v1.yaml)): the samples to play, four filter
settings (`lowShelfDb`, `highShelfDb`, `reverbMix`, `gainDb`), and the meter position (0 deep to 1
bright) with its word ("Deep & muted"). It is a small pure function over a dozen numbers.

## What the decision has to work with

- **Call rate.** The Mods workshop ([ModsDesktop](../design/screens/ModsDesktop.png)) shows Stock
  and With mods, plus Before and After on each of 6 mod cards, and "every key you press uses the
  new sound". That is up to 8 recipes per state, and every toggle makes a new state. Keycaps and
  Case & plate add one recipe per pick.
- **Inputs are catalog data.** Every part's effect is `sound_fx` on a catalog row (mods, keycap
  materials, case materials, plates, mounts), seeded in KL2-1 and edited in ADM-07 (US-40). The
  samples are `catalog.switch_recordings`, catalog's copy of the ready takes. CAT-03, CAT-05,
  CAT-07 and CAT-08 already send every part's effect to the browser. What the browser lacks is
  the rule that combines them: how effects add up and clamp, and how the result maps to the meter
  and its word.
- **Module direction.** `catalog` depends on `sound` (it listens to `SoundProcessed`), so `sound`
  must never refer to a catalog type. Code in `sound` can read catalog data only through a port
  that catalog implements, as `SwitchDirectory` does.
- **Split order.** `sound` is the first module planned to leave as its own service
  ([modulith-plan.md](../modulith-plan.md#where-splitting-pays-off-and-where-it-doesnt)).
- **Measured round trip.** From Dan's machine to production (`app.tickin.me`, Azure
  `southeastasia`), a public `GET /bff/keylab/v1/switches` through the gateway took 34 to 37 ms on
  a warm connection (4 requests) and 150 to 210 ms when it opened a new TLS connection (7
  requests). A builder tab keeps its connection warm. People further away pay more; Europe or the
  US would plausibly add 150 to 250 ms (estimate, not measured).
- **The bigger cost on a lube toggle is the sample, not the recipe.** Lube changes the variant, so
  the first play needs a different WAV in every option. WAVs are content-addressed and cache
  forever once fetched.
- **No offline story exists.** Assets are served by keylab-api and the VM shuts down at night in
  phase 2, so nothing plays without the server unless samples are already cached.

## Options

| | A. Server, in `sound` (as written) | B. Server, in `catalog` | C. Browser only, from a rule table | D. Browser copy plus server reference |
| --- | --- | --- | --- | --- |
| How | `GET /v1/sound-recipe` in `sound`; reads part effects through a port catalog implements | Same endpoint, owned by `catalog`, which already holds every input | `GET /v1/sound-rules` returns effects and constants; BLD-10 removed | B, plus the same function in the web app; both run one golden fixture |
| Latency per toggle | One round trip on a miss (about 35 ms measured warm); near 0 on a browser-cache hit | Same as A | 0 after the rules are loaded | 0 |
| Before / After cards | Up to 8 small GETs per state, in parallel | Same as A | Computed locally | Computed locally |
| Offline | No | No | Yes, once rules and samples are cached | Yes, same as C |
| Caching | `public, max-age=300` plus `ETag`, keyed by the URL, so the client must sort parameters. Few hits while exploring: the parts space is large; hits come from toggling back | Same as A | One small rules document, cached the same way | Same as C for toggles; BLD-10 cached as A |
| Who owns the rule table | Data: catalog. Rule: sound. Two owners and a port between them | Catalog owns data and rule | Data: catalog. Rule: web app | Catalog owns data, rule and fixture; web app keeps a copy |
| Cross-module call on the hot path | Yes. After `sound` splits it becomes an HTTP call back to the monolith, or `sound` keeps a catalog copy fed by events whose types would move to `shared` | None | None | None |
| Server can compute a recipe (saved sound, signature, share card) | Yes | Yes | No: it trusts numbers from the browser or gets a second copy later | Yes |
| Implementations to keep equal | 1 | 1 | 1 (in TypeScript) | 2, held equal by the fixture |
| Story text | Unchanged | US-05 module `sound` -> `catalog` | US-05 checks 1 and 3, US-06, US-09, US-14 rewritten | US-05 gains a fixture check |

## Recommendation: B, server-computed in `catalog`

1. **Catalog already has every input.** Effects and samples are catalog rows, so the hottest path
   makes no cross-module call. When `sound` splits out, the recipe stays behind with its data,
   and the read-only catalog copy the module plan foresaw for `sound` is never needed.
2. **One implementation, and the story as written.** US-05's three checks hold word for word. The
   measured warm round trip (about 35 ms) is inside the 100 ms target even on a cache miss for
   people near the VM.
3. **The fast path stays open.** D is B plus a browser copy and a fixture, with no `/v1` change.
   Do it when a measured toggle-to-sound on a miss passes 100 ms at p75 for real users, or when a
   story asks for building offline.

Not A: it puts a port call on every miss and gets worse when `sound` splits. Not C: saved
builds, sound signatures and share cards need the server to compute the same numbers, and it
rewrites four stories. Not D yet: a second implementation and fixture before any user has felt a
delay.

**Cost of B:** BLD-10 changes module. The request, response and URL do not change.

## What changed with the choice

Done in KL2-0 unless marked otherwise:

- **api-design-v1.md:** BLD-10 details paragraph (module `catalog`, sorted repeatable `mod`
  values so equal mixes share a URL, `public, max-age=300` with `ETag` and `304`, errors for an
  unknown or unpublished part); the open question ticked with a link here.
- **openapi-v1.yaml:** BLD-10 `x-module: catalog`, the `Cache-Control` header, `304`, and the
  error responses.
- **modulith-plan.md:** BLD-10 moves from the `sound` row to `catalog` in the Modules table; the
  "catalog + builds" row in "Where splitting pays off" loses the catalog copy for `sound`; the
  catalog tree gains the recipe (`domain/SoundRecipe`, `query` or `application` entry,
  `adapter/in/web/SoundRecipeController`); `sound/package-info.java` drops "the sound recipe".
- **user-stories.md and the US-05 Notion ticket:** module `sound` -> `catalog`, and the ticket's
  prompt ("Build it in the keylab-api module `sound`") to `catalog`. The Done when checks stay.
- **builds:** a save stores the recipe's sound parameters in `config.sound`, read through
  `CatalogApi` (database-design.md, How a build is stored). Planned; built in US-08.

The catalog tree's recipe entries are a plan; US-05 builds them.
