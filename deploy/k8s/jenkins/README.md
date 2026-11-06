# Jenkins

CD only: GitHub Actions tests and publishes images, Jenkins ships them to the VM over SSH.
Decisions and reasons are in `PRODUCT.md` (Jenkins). It runs in k3s on the VM, beside compose.

| File | What it holds |
| --- | --- |
| `values.yaml` | Chart values and all settings as JCasC: sign-in, permissions, agent, credentials, jobs |
| `plugins.yaml` | Every plugin and dependency, pinned |
| `base.yaml` | Namespace, PriorityClass, NetworkPolicies |
| `backup.yaml`, `overlays/azure/jenkins/` | Daily backup and where it goes |
| `deploy.Jenkinsfile`, `rollback.Jenkinsfile` | The two jobs |
| `cd-gate.mjs` | CI result, images and provenance for one commit |
| `notify.sh`, `vm-ssh-config.sh` | Mail one line; point ssh at the key and the pinned host key |
| `vm-install.sh` | The whole install on the VM: k3s, helm, Keycloak client, deploy key, chart |
| `install.sh`, `restore.sh` | Create or update; put history back |
| `check.sh`, `cd-gate.test.mjs` | Offline checks, also in CI |
| `drill/` | Proof on a throwaway k3s with a stand-in VM |
| `../../compose/vm-deploy.sh`, `vm-ssh-gate.sh` | The VM side: deploy, rollback, history; what the key may run |

## How a deploy goes

1. `deploy-playground` polls `main` every 5 minutes. No webhooks, since nothing here is public.
2. `cd-gate.mjs` waits up to 60 minutes for the `ci` workflow's push run on that commit. Any
   result but success stops it.
3. It checks gateway, api and keycloak as `sha-<git sha>`: both platforms, and each platform's
   BuildKit provenance must name this repo, this commit and that same CI run. It keeps the
   three index digests. `ci.yml` has no GitHub artifact attestation, so this is what there is.
4. It mails you and asks for approval, holding no agent pod while it waits. Unanswered after
   24 hours, the build aborts and nothing changes.
5. `vm-deploy.sh deploy` on the VM fetches the compose files of that exact commit from
   GitHub, checks them against `.env`, and pulls the images. A failure so far changes nothing.
   Then it sets the digests in `.env`, runs `docker compose up -d` and waits for every health
   check.
6. `smoke-public.mjs` runs `smoke.mjs` against the public URL.
7. All good: the release counts as good, and you get a mail. Anything failed after the switch:
   it rolls back to the newest good release, runs smoke again and mails you. The build stays
   failed, since that commit did not ship.

The next new commit starts this again. A commit that failed is not retried until something
new lands, or you run the job by hand.

The first poll of an empty JENKINS_HOME builds the head of `main` and asks for approval.
Refuse it if that commit is already running. A poll in the moment before a build's checkout
can queue the same commit twice, so you may be asked again: refuse the second one.

## Roll back by hand

Run `rollback-playground`, one click with no parameters. It goes to the newest good release
that is not running, runs smoke and mails you. The release it left stops counting as good, so
another click goes one further back. It asks for no approval, and only `jenkins-admin` can
start it. To stop bad commits being deployed again, fix or revert them on `main`.

**It restores images and compose files, not data.** If a release changed the Keycloak database
schema, an older Keycloak may refuse to start on it: then use `deploy/compose/RESTORE.md`.

Without Jenkins, the same works by hand on the VM:

```bash
sudo sh /srv/playground/deploy/compose/vm-deploy.sh rollback manual
```

## History

On the VM, on the data disk, so it outlives any controller:

```bash
sudo sh /srv/playground/deploy/compose/vm-deploy.sh history
```

`/srv/playground/releases/` has `deploys.log`, `good`, `current`, and a folder per release with
its digests and compose files. Jenkins keeps the last 100 builds of each job with their logs,
and those go in the backup.

## Not in git

One Secret, `jenkins-secrets` in namespace `ci`. Delete everything and this is all you need
back. JCasC loads it into the credential store at each start:

| Key | Becomes | What it is |
| --- | --- | --- |
| `oidc-client-secret` | sign-in | The Keycloak `jenkins` client secret, as `JENKINS_CLIENT_SECRET` in the VM's `.env` |
| `vm-deploy-key` | `vm-deploy-key` | Private half of the deploy key |
| `notify-smtp-user`, `notify-smtp-password` | `notify-smtp` | SMTP login for mail |
| `notify-recipient` | `notify-recipient` | Who gets the mail. Here so no address is in a public repo |

## Install

Run these from the repo root, on a commit that has this pipeline.

1. Let k3s pods reach the Kubernetes API and the VM's SSH. Nothing opens to the internet:

   ```bash
   ssh -t playground@<vm> "sudo ufw allow from 10.42.0.0/16 to any port 6443 proto tcp comment k3s-pods-to-api && sudo ufw allow from 10.42.0.0/16 to 10.20.1.4 port 22 proto tcp comment jenkins-agent-ssh"
   ```

2. Copy the files to the VM. Deploys update the compose files later, but never `vm-deploy.sh`
   or `vm-ssh-gate.sh`.

   ```bash
   tar -cf - deploy/compose/vm-deploy.sh deploy/compose/vm-ssh-gate.sh deploy/compose/vm-env.sh deploy/compose/compose.prod.yml deploy/compose/smoke-access.sh infra/playground-realm.json deploy/k8s/jenkins deploy/k8s/overlays/azure/jenkins | ssh playground@<vm> sudo tar -xf - --no-same-owner -C /srv/playground
   ```

3. Run the install. It makes the client secret and applies the realm without restarting
   Keycloak, makes the deploy key, and keeps every secret on the VM. It stops if under 1.5 GiB
   of memory is free. Set `NOTIFY_SMTP_USER=resend`, `NOTIFY_SMTP_PASSWORD` and
   `NOTIFY_RECIPIENT` for it, or mail stays off.

   ```bash
   ssh playground@<vm> sudo sh /srv/playground/deploy/k8s/jenkins/vm-install.sh
   ```

4. Grant the realm role `jenkins-admin` to your own user in the admin console. Nobody has it by
   default, and the realm has public registration, so signing in alone gets a 403.

The deploy key can run only `vm-ssh-gate.sh` and open a tunnel to Keycloak's loopback port.
**`compose.prod.yml` refuses to start without `JENKINS_CLIENT_SECRET`**, which step 3 makes.

After a change here, copy the files and run step 3 again. To change the Secret, run
`install.sh` on the VM with all its variables set. Plugins download at each start, about a
minute. If a controller is crash looping, the StatefulSet will not replace it after an
upgrade: `sudo k3s kubectl -n ci delete pod jenkins-0`.

To remove it all: `sudo /usr/local/bin/k3s-uninstall.sh`. Compose is left alone.

After a VM rebuild its host key changes, and deploys stop on the mismatch. Update
`VM_KNOWN_HOSTS` in `values.yaml`, and add the key again.

## Reach it

No public route. Open a tunnel and leave it running:

```bash
ssh -L 8090:127.0.0.1:8090 playground@<vm> sudo k3s kubectl -n ci port-forward svc/jenkins 8090:8080
```

Then http://localhost:8090. That address is fixed in the realm and in `values.yaml`.
Sign-in goes through Keycloak, at `KEYCLOAK_WELL_KNOWN_URL` in `values.yaml`.

**If Keycloak is down, nobody can sign in**, so nobody can approve a deploy or click rollback.
A restart is safe (the drill checks this), and there is no local admin on purpose. Roll back
by hand on the VM instead (above).

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

A throwaway k3s in Docker and, on one Docker network, a stand-in VM (Docker-in-Docker with
sshd and the real `compose.prod.yml`), a TLS registry holding multi-arch images with BuildKit
provenance, a fake GitHub API and Mailpit. Sign-in uses the local prod stack's Keycloak, with
`JENKINS_CLIENT_SECRET` in its env file. It ships a good version, one that fails smoke, one
that never gets healthy, and rolls back by hand. It also tries commits that must stop before
approval, then deletes and recreates the controller. Needs about 8 GB for Docker. Pushes
nothing to GitHub or GHCR and touches nothing on Azure.

```bash
node deploy/k8s/jenkins/drill/drill.mjs --env-file <local stack env>
```

```bash
node deploy/k8s/jenkins/drill/drill.mjs --env-file <local stack env> clean
```
