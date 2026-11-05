# Backups and restore (phase 1)

What is backed up, how to get it back, and what the last drill measured.
Decisions in short are in `PRODUCT.md`, Keycloak database and backups.

**Status: running on the Azure VM since 2026-11-05, drill passed, alert mail received.**
The nightly timer and the lifecycle rule are still to be seen working. See
[Drill results](#drill-results).

## What is backed up

| Data | Backed up | Why |
| --- | --- | --- |
| Keycloak database (users, password hashes, realm, signing keys) | Yes, nightly | It cannot be rebuilt from anything else. |
| Realm config | In git | keycloak-config applies it on every `up`. |
| Images | GHCR | Pinned by `sha-<git sha>` in `.env`. |
| Redis | **No** | See below. |
| `.env` | **No**, your job | See [Keep a copy of `.env`](#keep-a-copy-of-env). |
| Let's Encrypt certs | No | Traefik issues new ones. |

**Why Redis is not backed up.** It holds gateway sessions, the OIDC session
registry and rate limiter buckets, and nothing else.

- Losing it signs everyone out. They sign in again, and no account data is lost.
- Its dump holds refresh tokens, so a copy in Blob would be a new secret to guard
  for 14 days, for data that expires anyway (30 minutes idle, 10 hours at most).
- Restoring it would do harm: a day-old snapshot brings back sessions that have
  since logged out, which undoes logout.

## How the backup works

`backup.sh run`, from `backup.timer`, every night at 19:00 UTC (02:00 in Vietnam,
before the 20:00 UTC reboot window). A missed night runs when the VM is back.

1. `pg_dump -Fc` inside the Postgres container, one snapshot of the live database.
2. `pg_restore --list` must read the dump and find `user_entity` data. If not,
   nothing is uploaded.
3. `azcopy copy` to `backups/postgres/keycloak-<UTC stamp>.dump`, with an MD5, never
   overwriting. The local copy is removed when the run ends.

**Retention:** a lifecycle rule deletes blobs more than 14 days old, so 14 or 15
nightly dumps exist. Azure runs the rule about once a day. Deleted blobs stay
restorable for 7 more days (blob soft delete). `backup.sh` cannot delete on purpose:
it has no such command. Retention goes by age, not count: **if backups stop and the
alert is ignored, every dump is gone 14 days later.**

**Credential:** the VM's managed identity, so no secret exists on the VM.

| Role | Scope | Allows |
| --- | --- | --- |
| Storage Blob Data Contributor | the `backups` container only | Read, write and delete blobs there. Nothing else in the account or subscription. |
| Monitoring Metrics Publisher | the VM only | Publish that VM's metrics. |

Shared keys are off on the account, and its firewall allows only the host subnet
and `operator_ip`. Azure has no built-in write-only blob role, so a stolen identity
could delete blobs. Soft delete bounds that.

**No client-side encryption (decided 2026-11-05).** Blob encrypts at rest with
Microsoft-managed keys, twice (`infrastructure_encryption_enabled`).

- Everyone who can read the blobs can already read the live database: the VM's
  identity runs on the VM, and Dan is Owner of the VM. Client-side encryption
  would keep out nobody new.
- The data disk holds the same data under the same kind of keys, so the dump is no
  more exposed than the database.
- It would add a way to lose everything. The key must live off the VM and off Azure,
  or it dies with what it protects, and a lost key means no restore.

**This changes off Azure.** The dump holds password hashes, realm signing keys and
the Resend API key. A copy on a laptop has none of the protections above, so encrypt
it first (see [Copy a dump off Azure](#copy-a-dump-off-azure)). Revisit if anyone
other than Dan gets a role on this subscription, or if real users' data arrives.

## The alert

`alert-playground-backup-age` mails Dan when the newest dump in Blob is over 26
hours old. `backup.sh report`, from `backup-report.timer`, publishes the age hourly
as the custom metric `playground/backups` `BackupAgeHours`.

It looks at what is in Blob, not at whether the job ran, so one rule catches a
failed dump, a failed upload, a dead nightly timer, a lost role, or a firewall
change. A night that fails at 19:00 UTC mails about 2 to 3 hours later.
An unreadable or empty container reports 9999. So `backup.sh install` on an empty
container fires the alert once: it reports before the first dump exists, and the mail
clears by itself about an hour after a dump lands.

**Not caught:** a VM that is off publishes nothing (the availability alert covers
that in phase 1), and neither does a VM whose report timer is dead. A rebuilt VM
reinstalls its timers from the data disk (`backup-install.service`).

When it fires:

```bash
ssh playground@<vm> 'systemctl status backup.service backup-report.service --no-pager; journalctl -u backup.service -n 50 --no-pager'
```

Fix the cause, then run a backup and confirm the age is low:

```bash
ssh playground@<vm> 'sudo systemctl start backup.service && sudo sh /srv/playground/deploy/compose/backup.sh list'
```

## Set up, once

```bash
terraform -chdir=deploy/terraform/envs/azure plan -out tfplan
```

Show Dan, then apply. Role assignments can take a few minutes to work. Copy
`backup.sh`, `vm-env.sh`, `smoke-access.sh` and `compose.drill.yml` to
`/srv/playground/deploy/compose/` (the README's The VM has the way), then:

```bash
ssh playground@<vm> 'sudo sh /srv/playground/deploy/compose/vm-env.sh set-backup-url <backup_container_url output>'
```

```bash
ssh playground@<vm> 'sudo sh /srv/playground/deploy/compose/backup.sh install'
```

## Restore

**Which case are you in?**

- **The VM died, the data disk is fine:** no restore needed. Rebuild the VM (see
  `deploy/terraform/README.md`). The database and `.env` are on the disk.
- **The database is damaged or the disk is gone:** the steps below.

All from `/srv/playground/deploy/compose` on the VM, as root. Stop the apps first so
nothing writes during the restore.

```bash
docker compose -f compose.prod.yml stop gateway keycloak
```

`backup.sh restore` refuses a database that has tables, so a mistake cannot write
over data. Empty the target yourself first. **Dropping a database is a Stop: Dan
decides, and only after a dump of it is safe.**

```bash
sh backup.sh fetch /srv/playground/restore.dump
```

```bash
sh backup.sh restore /srv/playground/restore.dump playground-prod-postgres-1 keycloak
```

```bash
docker compose -f compose.prod.yml up -d
```

Use a Keycloak image at least as new as the one that wrote the dump. Keycloak
upgrades a schema but does not downgrade one.

### If `.env` is gone too

keycloak-config signs in with a client whose secret was only in the old `.env`, and
Keycloak creates bootstrap admins only on an empty database. So:

1. Make a new `.env` (`vm-env.sh init`), and set `KC_CONFIG_CLIENT_ID=keycloak-config-recovery`.
2. Start Postgres, and restore as above.
3. Create that client in the restored database, before Keycloak starts:

   ```bash
   docker compose -f compose.prod.yml run --rm --no-deps keycloak bootstrap-admin service --client-id:env KC_BOOTSTRAP_ADMIN_CLIENT_ID --client-secret:env KC_BOOTSTRAP_ADMIN_CLIENT_SECRET --optimized --no-prompt
   ```

4. `up -d`. keycloak-config puts the new gateway client secret and SMTP settings in
   the realm. The rehearsal below took this path.
5. Dan makes a new Resend API key (`vm-env.sh set-smtp-password`), since the old one
   left with the `.env`.

Keycloak marks that client temporary, as with the first install (see `.shipit/open.md`).

### Keep a copy of `.env`

It is only on the data disk. Dan keeps a copy in a password manager, which makes the
section above unnecessary. Refresh it when a secret changes.

### Copy a dump off Azure

The runway rule in `PRODUCT.md` needs this at $20 of credit left, and before any
planned lapse. It works from `operator_ip` with Dan's reader role. `openssl` prompts
for a passphrase; keep that in the password manager.

```bash
az storage blob download --auth-mode login --account-name stplaygroundbk9p1w -c backups -n postgres/<blob> -f keycloak.dump
```

```bash
openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -in keycloak.dump -out keycloak.dump.enc
```

Remove the plain `keycloak.dump`, and check the copy with `-d` before relying on it.

## The drill

A backup counts only after a restore into a scratch database passes `smoke.mjs`.
Once per phase, and after any change to how backups work.

`smoke.mjs` alone would pass on an empty database, because it makes its own users,
so the drill plants two markers around the dump. `node smoke.mjs restored` must show
the first signing in with its old password, and the second missing.

`compose.drill.yml` is a scratch stack with its own project, volumes and networks,
fresh secrets and placeholder mail, on loopback only. It has no Traefik labels:
the live Traefik watches every container on the host, and a second router named
`gateway` would take the public site down. Never run it without that file.

Before starting on the VM, check `free -m`. The scratch stack may use up to 2.7 GiB
by its limits, on a 4 GiB VM already running the live stack. On 2026-11-05 it took
about 1 GiB, with 1.1 GiB still available and no swap growth. If `free -m` shows much
less than 2 GiB available, run the scratch stack on a laptop instead (fetch the dump
with `az` as above). You still get the proof, but measure the restore time on the VM
separately.

On the VM (`D` is short for the compose command):

```bash
cd /srv/playground/deploy/compose
sudo sh vm-env.sh drill-env /srv/playground/drill.env
D='docker compose -p playground-drill -f compose.prod.yml -f compose.drill.yml --env-file /srv/playground/drill.env'
sudo sh smoke-access.sh marker drill-before-1@example.com     # note the password
sudo systemctl start backup.service                           # the dump; note the time
sudo sh smoke-access.sh marker drill-after-1@example.com      # note the time
sudo sh backup.sh fetch /srv/playground/drill.dump            # clock starts here
sudo $D up -d --wait postgres
sudo sh backup.sh restore /srv/playground/drill.dump playground-drill-postgres-1 keycloak
sudo $D run --rm --no-deps keycloak bootstrap-admin service --client-id:env KC_BOOTSTRAP_ADMIN_CLIENT_ID --client-secret:env KC_BOOTSTRAP_ADMIN_CLIENT_SECRET --optimized --no-prompt
sudo $D up -d --wait keycloak redis api
sudo $D up -d keycloak-config keycloak-admin-url
sudo $D up -d --wait gateway
sudo SMOKE_PROJECT=playground-drill sh smoke-access.sh open   # note the secret
```

On your machine:

```bash
ssh -N -L 28080:127.0.0.1:28080 -L 28181:127.0.0.1:28181 -L 26379:127.0.0.1:26379 playground@<vm>
```

```bash
APP_URL=http://localhost:28181 KC_URL=http://localhost:28080 REDIS_PORT=26379 REDIS_PASSWORD=<from drill.env> SMOKE_ADMIN_CLIENT_ID=smoke-runner SMOKE_ADMIN_CLIENT_SECRET=<secret> DRILL_BEFORE_USER=drill-before-1@example.com DRILL_BEFORE_PASSWORD=<password> DRILL_AFTER_USER=drill-after-1@example.com node smoke.mjs restored login anonymous roles csrf logout fixation backchannel refresh
```

The clock stops when `login` passes. Afterwards remove both markers from the live
realm (`smoke-access.sh unmark`). Stopping the scratch stack is fine. **Removing its
volumes, or `drill.dump`, is a Stop.** Dan decides. The markers stay in the dumps for
14 days; they have no roles beyond `user`, and their passwords are random.

## Drill results

Recovery time counts fetch to a passing smoke login. Data-loss window is the time
since the last good dump.

| | Azure VM, 2026-11-05 | Local rehearsal, 2026-11-05 |
| --- | --- | --- |
| Status | **passed** | passed |
| Source | a real dump from Blob, 255 KiB | local prod stack (not Blob, no azcopy) |
| Smoke | 48 of 48, including `restored` | 48 of 48, including `restored` |
| Fetch from Blob | 4 s | not part of it |
| Scratch Postgres up | 6 s | 21 s |
| Restore (`pg_restore`, 3 users) | under 1 s | 9 s |
| Recovery client | 12 s | 76 s |
| Stack healthy, realm applied | 52 s | 262 s |
| Smoke | 47 s | 79 s |
| **Recovery time, to smoke finished** | **about 2 minutes of work** (2 min 54 s by the clock, with a 53 s pause before smoke) | **about 7.5 minutes** |
| Data-loss window seen | dump at 10:50:11 UTC: the marker from 10:50:07 signed in with its old password, the one from 10:50:19 did not exist | as planted |
| Live site during the drill | 200 in 18 of 18 samples | not relevant |
| Lowest memory available | 1129 MB, swap unchanged | not relevant |

**A real recovery will take longer than these numbers.** The database is tiny, so the
restore time says little about a larger one. The images were already on the disk; a
lost disk also needs a new disk, a pull of every image and a new certificate, none of
it timed. The restore went into a scratch stack, not over the live one, and took its
image tags from the live `.env`, which a lost disk would not have.

**Data-loss window by design:** up to 24 hours (a loss just before the next nightly
run), plus 2 to 3 hours until a failed night mails, plus however long the fix takes.
Everything written since the last dump is lost: new accounts, password changes,
Keycloak's user sessions.

Identity checks from the VM, 2026-11-05. Reading the `backups` container works. Refused
with 403: listing the account's containers, another container on that account, and the
Terraform state account. The management API returns an empty list of resource groups
and 403 on the VM itself. Azure lists exactly the two roles in the table above.
**The delete permission was deliberately not tried.**

Settings read back from Azure: shared keys off, public blob access off, firewall
default Deny with only `operator_ip` listed, lifecycle delete after 14 days, soft
delete 7 days.

Also checked locally: a wrong marker password fails `restored` with exit 1; a second
restore into the same database is refused; 29 stubbed failure cases in
`backup.test.sh` pass (a failed dump, an unreadable dump, a dump with no users and a
failed upload each upload nothing and leave nothing on disk).

The alert fired for real on 2026-11-05. `backup.sh install` published 9999 at 10:49:44
UTC against the empty container, and Azure shows the rule as Fired at 11:02:24, about 13
minutes later. That delay is the first use of a new metric, plus the 15 minute rule.
Azure's alert history shows the action group ran at 11:02:25, and the receiver is enabled.
Dan found no mail from that firing, spam included. Dan then verified the receiver in
`ag-playground` at about 11:50 UTC. The rule resolved by itself at 12:32:22 UTC, and that
mail reached Dan's inbox within seconds (Gmail received it at 12:32:29). So verification
is the likely cause, on one mail before and one after.

**A new or changed receiver may need verifying before mail arrives.** Azure still shows
it as Enabled without that, and its alert history says the action group ran. The action
group test cannot check it here: this subscription refuses it with "Free subscription
not supported". After changing `alert_email`, confirm a real mail arrives.

**Not checked yet:** a mail for a firing rather than a resolve, the
19:00 UTC timer running by itself, the lifecycle rule actually
deleting (the first dump turns 14 days old on 2026-11-19), the firewall refusing a
request from a blocked address, `backup-install.service` on a real rebuild.
