# Gateway client secret rotation, no image rebuild (2026-11-07)

Run: `node infra/vault/rotate-demo.mjs`. Scratch compose project `playground-vault-demo`:
dev Keycloak (H2), Redis, and the gateway and API from local GHCR images. No values here.

Image `sha256:12cd7f44b587` (`playground-gateway:latest`, built 2026-10-30), id checked
before and after. The compose file has no build section, and the run used `--no-build`
with `pull_policy: never`.

| Step | Result |
| --- | --- |
| Keycloak accepts the current secret, refuses a wrong one | pass |
| Smoke before | 45 of 45 |
| Vault version 2 to 3, old version still readable in KV history | pass |
| `infra/.env` rendered with the new value | pass |
| Keycloak refuses the old secret, accepts the new one | pass |
| Same gateway container, old secret: login fails, lands on `/login?error` | pass |
| Recreated container: same image id, new secret, not the old | pass |
| Image env and layer history hold neither secret | pass |
| Smoke after | 45 of 45 |

102 s from the Vault write to a healthy gateway. That includes the deliberate failed
login, on a machine also running the local prod stack.

The first run (version 1 to 2) reported one failure: the check for an accepted secret
was wrong. It read the error name, which Keycloak returns unchanged for a right and a
wrong secret (401 `unauthorized_client`), so the "accepts" checks could not fail. Only
`error_description` differs. Fixed, with a wrong-secret control added, then rerun in
full. The table is the rerun.

`bootRun` (`gateway/build.gradle` reading `infra/.env`) against the same stack, with the
rotated value: `node smoke.mjs login`, 10 of 10.

Not run: the same rotation on the VM, which keeps its `.env` and has no Vault.
