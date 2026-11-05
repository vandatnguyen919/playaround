# Jenkins

CD only: GitHub Actions tests and publishes images, Jenkins deploys them. Decisions and
reasons are in `PRODUCT.md` (Jenkins). Phase 2: this needs k3s on the 8 GiB VM, which does
not exist yet. Nothing here runs on Azure today.

| File | What it holds |
| --- | --- |
| `values.yaml` | Chart values and all settings as JCasC: sign-in, permissions, agent, credential, job |
| `plugins.yaml` | Every plugin and dependency, pinned |
| `base.yaml` | Namespaces, PriorityClass, deploy ServiceAccount and Role, NetworkPolicies |
| `backup.yaml`, `overlays/azure/jenkins/` | Daily backup and where it goes |
| `deploy.Jenkinsfile`, `wait-for-images.sh` | The one job |
| `install.sh`, `restore.sh` | Create or update; put history back |
| `check.sh` | Offline checks, also in CI |
| `drill/` | Delete and recreate proof on a throwaway k3s |

## Not in git

Two Secrets, both in namespace `ci`. Delete everything and these are all you need back:

- `jenkins-secrets`, key `oidc-client-secret`: the Keycloak `jenkins` client secret. Same
  value as `JENKINS_CLIENT_SECRET` in the VM's `.env` until External Secrets takes over.
- `jenkins-deploy-token`, key `token`: Kubernetes makes it from `base.yaml`, so a recreate
  gets a new token by itself.

## Install

First, once per environment:

1. On the VM, make the client secret, then apply the realm. **`compose.prod.yml` refuses
   to start without `JENKINS_CLIENT_SECRET`**, so do this before the next `up`.

   ```bash
   sudo sh vm-env.sh add-jenkins-client-secret
   ```

   ```bash
   sudo docker compose -f compose.prod.yml up keycloak-config keycloak-admin-url
   ```

2. Grant the realm role `jenkins-admin` to your own user in the admin console. Nobody has
   it by default, and the realm has public registration, so signing in alone gets a 403.

3. Tell the backup where to write, from the Terraform output `backup_container_url`:

   ```bash
   kubectl apply -f deploy/k8s/jenkins/base.yaml
   ```

   ```bash
   kubectl -n ci create configmap jenkins-backup-target --from-literal=BACKUP_CONTAINER_URL=<url>
   ```

Then, and after any change here:

```bash
JENKINS_CLIENT_SECRET=<value> bash deploy/k8s/jenkins/install.sh deploy/k8s/overlays/azure/jenkins
```

Needs `helm` and `kubectl` on the VM, and internet for the plugins: they download at each
start, about a minute. If a controller is crash looping, the StatefulSet will not replace
it after an upgrade: `kubectl -n ci delete pod jenkins-0`.

`deploy/compose/backup.sh install` must have run, since the upload uses its `azcopy` from
`/srv/playground/bin`. Keycloak must answer as `keycloak.playground.svc.cluster.local:8080`
with `KC_HOSTNAME_BACKCHANNEL_DYNAMIC`, as in `compose.prod.yml`. k3s's local-path volumes
must be on the data disk.

## Reach it

No public route. Two steps, since 6443 is closed too:

```bash
ssh -L 8090:127.0.0.1:8090 playground@<vm> sudo kubectl -n ci port-forward svc/jenkins 8090:8080
```

Then http://localhost:8090. That address is fixed in the realm and in `values.yaml`.
Sign-in goes through the public Keycloak.

**If Keycloak is down, nobody can sign in**, but polling and deploys carry on and a
restart is safe (the drill checks this). There is no local admin on purpose. To fix a bad
Keycloak deploy, run `helm upgrade` by hand on the VM.

## The job

`deploy-playground` polls `main` every 5 minutes. For each new commit it waits up to 45
minutes for `sha-<git sha>` on GHCR, then runs `helm upgrade --atomic` on
`deploy/k8s/playground` from the agent, with the token from the credential store. If CI
failed, no images appear, and the job fails without deploying.

- An empty JENKINS_HOME has no last build, so the first poll after a recreate redeploys
  the current `main`. Harmless, since it is the same tag.
- `deploy/k8s/playground` does not exist yet (phase 2), so until then the job stops there
  with a clear error.
- To hold every deploy on one version, set `DEPLOY_TAG_PIN` in `values.yaml` and install.

## Change a plugin

Edit the version in `plugins.yaml`, run `check.sh`, and it tells you which dependency
differs. Copy those lines in and repeat. Then install.

## Backup and restore

`jenkins-backup` runs at 19:30 UTC and archives each job's build history, to `jenkins/` in
the backup container, kept 14 days by the same lifecycle rule. It holds no keys, credentials
or users: they are rebuilt, so a copy opens nothing. Its failures show only in
`kubectl -n ci get jobs`; `BackupAgeHours` watches the database dump alone. That is
accepted, since losing this history loses no config.

```bash
azcopy copy "<container url>/jenkins/<file>" backup.tar.gz
```

```bash
bash deploy/k8s/jenkins/restore.sh backup.tar.gz
```

## Drill

Throwaway k3s in Docker (container `jk-k3s`), the local prod stack's Keycloak with
`JENKINS_CLIENT_SECRET` in its env file, a scratch git repo, and a stand-in for the app
chart. Pushes nothing and touches nothing on Azure. About 25 minutes, mostly waiting for
polls.

```bash
node deploy/k8s/jenkins/drill/drill.mjs --env-file <local stack env>
```

```bash
node deploy/k8s/jenkins/drill/drill.mjs --env-file <local stack env> clean
```
