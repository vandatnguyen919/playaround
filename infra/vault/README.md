# Local Vault

Vault 2.2.1 on Raft, in `infra/docker-compose.yml`, on `127.0.0.1:8200` only. It holds
the dev secrets, and `infra/.env` is rendered from it. The apps never talk to Vault:
they read environment variables, as they do in every environment. There is no Spring
Cloud Vault and no AppRole. Phase 2 swaps the render step for External Secrets, with
the same paths and policies.

## Use

```
node infra/vault/vault.mjs up
```

Starts Vault, initializes it on the first run, unseals it, applies the mount and
policies, stores any missing value, and renders `infra/.env`. It is safe to rerun. Run it
again after a restart of Vault or of Docker, because Vault starts sealed (`unseal` does
only that part). Then start the stack as usual. Without Vault the dev stack still runs
on compose's defaults, which CI relies on.

| Command | Does |
| --- | --- |
| `status` | initialized, sealed, version |
| `render` | writes `infra/.env` from Vault; on any failure leaves the file as it was |
| `rotate` | new gateway client secret: KV version, `infra/.env`, Keycloak |
| `external-secret <service>` | prints that service's phase 2 manifests |

`node infra/vault/check.mjs --restart` checks all of this against the running Vault.

**Unseal key and root token** are in `infra/vault/.local/init.json`, which git ignores.
There is one key share, because every share would sit in that one file. This fits only a
throwaway local Vault holding dev values. On the VM, phase 2 uses the `azurekeyvault`
seal and the recovery keys go to Dan's password manager. Losing the file means losing
this Vault's data; the values can be seeded again. Only `vault.mjs` uses the root token,
to mint 5 minute tokens: `render` holds `compose-render`, and `seed` and `rotate` hold
`secrets-writer`.

## Inventory

KV v2 at mount `secret/`. One path per secret, so a rotation writes one place, and each
service's policy lists exactly the paths it reads. `secrets.json` is the source for this
table; `check.mjs` fails if it and the policy files disagree, or if a token can do more
than it says.

| Path under `secret/` | Keys | Env variable | Read by | In `infra/.env` | Local value |
| --- | --- | --- | --- | --- | --- |
| `playground/gateway-client` | `client_secret` | `GATEWAY_CLIENT_SECRET` | gateway, keycloak-config | yes | dev default until rotated |
| `playground/jenkins-client` | `client_secret` | `JENKINS_CLIENT_SECRET` | jenkins, keycloak-config | yes | dev default |
| `playground/redis` | `password` | `REDIS_PASSWORD` | redis, gateway | yes | dev default |
| `playground/keycloak-admin` | `username`, `password` | `KC_BOOTSTRAP_ADMIN_*` | keycloak | yes | dev default |
| `playground/idp-google` | `client_id`, `client_secret` | `GOOGLE_CLIENT_*` | keycloak-config | yes | placeholder |
| `playground/idp-github` | `client_id`, `client_secret` | `GITHUB_CLIENT_*` | keycloak-config | yes | placeholder |
| `playground/keycloak-config-client` | `client_id`, `client_secret` | `KC_CONFIG_CLIENT_*` | keycloak, keycloak-config | no | generated, unused in dev |
| `playground/keycloak-db` | `password` | `KC_DB_PASSWORD` | keycloak, postgres | no | generated, unused in dev (H2) |
| `playground/smtp` | `user`, `password` | `SMTP_USER`, `SMTP_PASSWORD` | keycloak-config | no | placeholder (Mailpit needs none) |

The api has no secrets, so it has no policy. Two more policies are for tools:
`compose-render` reads the "yes" rows, and `secrets-writer` writes under `playground/`
but cannot delete, destroy or touch policies.

The first run stores what `infra/.env` already holds, or the dev default, so it changes
nothing the dev stack uses. `seed` never overwrites a stored value.

**Not stored here, on purpose:**

- Real values of the deployed site. They stay in the VM's root-owned `.env` until phase 2.
- Jenkins' `vm-deploy-key` and `notify-smtp`, in a Kubernetes Secret until phase 2.
- `SMOKE_ADMIN_CLIENT_SECRET`: a throwaway client made per run.
- Test users' passwords in `infra/playground-users-dev.json`. They are public dev fixtures.
- Cloud credentials. There are none: Azure uses `az login` and a managed identity.

## Rotate the gateway client secret

Needs no image and no Vault client in the app, because the gateway reads the secret
from its environment at start.

```
node infra/vault/vault.mjs rotate
```

Then restart `bootRun`, which reads `infra/.env` (`gateway/build.gradle`), or recreate the
container. Between Keycloak's update and that restart, logins and token refreshes fail,
since Keycloak holds one secret per client.

To repeat the proof on the real image, in a scratch project that removes itself:

```
node infra/vault/rotate-demo.mjs
```

The old version stays in KV history. To go back, write it as a new version.

## Phase 2: External Secrets

`vault.mjs external-secret gateway` prints a `SecretStore` and `ExternalSecret` from
`secrets.json`:

```yaml
- secretKey: GATEWAY_CLIENT_SECRET     # env variable the pod reads
  remoteRef:
    key: playground/gateway-client     # path under the mount
    property: client_secret            # key in the KV document
```

Each service gets its own store, with Kubernetes auth role `<service>` bound to its
ServiceAccount and to the policy of the same name. A single `ClusterSecretStore` would
need one policy that reads everything. Phase 2 adds the Kubernetes auth method, the
roles and the seal. The paths and policies stay. `check.mjs` reads every `remoteRef`
with a token holding only that service's policy; the manifests have not been applied to
a cluster yet.
