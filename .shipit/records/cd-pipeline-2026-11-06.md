# CD pipeline drill, 2026-11-06

Output of `node deploy/k8s/jenkins/drill/drill.mjs`, one clean run from the final files, from
an empty environment. Local k3s in Docker (amd64), the local prod stack Keycloak, a stand-in
VM (Docker-in-Docker with sshd and the real `compose.prod.yml`), a TLS registry, a fake GitHub
and Mailpit. Nothing on Azure, GitHub or GHCR was changed.

Separately, `cd-gate.mjs` ran against real GHCR and the real GitHub API: it passes `13163e5`
(CI run 41958356499, all three images, both platforms) and refuses `a77320a` (no push run on
`main`).

Not run: a deploy on the real VM, real polling of GitHub and raw fetch from the VM, mail
through Resend, arm64, a real Blob upload, the instance metadata block. Worst memory was in
this run: controller 627 of 640 MiB, about 530 in earlier ones. See `.shipit/open.md`.

```

== Cluster: k3s, stand-in VM, registry, fake GitHub, Mailpit, users
PASS  k3s version is the decided one
   publishing v1 (79506c60341d): builds both platforms, slow the first time
   starting the stack on the stand-in VM: a few minutes
PASS  the stand-in VM runs the first version  (registry.drill.test:5000/playground-gateway:sha-79506c60341d8cb36041081a61ea7c31ac137070)

== Install from the repo
PASS  controller is ready with no restarts  (restarts 0)
   deploy-playground #1: ABORTED, 5 s, cause: Started by an SCM change,Rejected by Drill Jenkins, description: 79506c60341d

== Sign-in and exposure
PASS  anonymous gets nothing  (403)
PASS  anonymous cannot read the job  (403)
PASS  a user without the role passes Keycloak
PASS  a user without the role is refused by Jenkins  (403)
PASS  a user without the role cannot use the API  (403)
PASS  a user without the role cannot start a rollback  (403)
PASS  the login form is the public Keycloak host  (https://auth.localhost/realms/playground/protocol/openid-connect/auth)
PASS  the login request carries PKCE S256
PASS  the role holder signs in over OIDC  (drill-jenkins-admin@example.com)
PASS  the role arrives as a group  (authenticated,default-roles-playground,jenkins-admin,offline_access,uma_authorization,user)
PASS  the controller runs no builds  (0 executors)
PASS  nothing public: only a ClusterIP service, no Ingress  (Service/jenkins)
PASS  the agent port is closed
PASS  another namespace cannot reach Jenkins
PASS  deploy credentials are in the credential store  (notify-recipient,notify-smtp,vm-deploy-key)

== The deploy key on the VM: what it can and cannot do, over real ssh
PASS  the key can ask what is running
PASS  the key cannot run: id  (exit 126)
PASS  the key cannot run: cat /srv/playground/deploy/compose/.env  (exit 126)
PASS  the key cannot run: sudo id  (exit 126)
PASS  the key cannot run: sudo sh /srv/playground/deploy/compose/vm-deploy.sh add-deploy-key  (exit 126)
PASS  the key cannot run: current; id  (exit 126)
PASS  the key cannot run: sh -c id  (exit 126)
PASS  the key gets no shell  (exit 126)
PASS  the key gets no terminal  (exit 255)
PASS  the key's allowed output has no secrets
PASS  .env stays 0600  (600)
PASS  the key can tunnel to Keycloak's loopback port  (302)
PASS  port 80 answers directly, so the next check can fail  (301)
PASS  the key cannot tunnel anywhere else  (000)

== Ship a good version: the poll finds it, CI and provenance pass, approval, deploy, smoke
   waiting for the timer poll (up to 5 min, H/5)
   v2, good: a248597a5ea7, build #2
PASS  the poll started it, on its timer
PASS  it waited for CI
PASS  it checked provenance for all three images
PASS  it ran on the deploy agent
PASS  nothing is deployed before approval
PASS  no agent pod is held while waiting for approval
PASS  a mail asks for approval
   deploy-playground #2: SUCCESS, 356 s, cause: Started by an SCM change, description: a248597a5ea7
PASS  the deploy succeeded  (SUCCESS)
PASS  the VM runs exactly the digests that were checked  (sha256:3f56d75cf315)
PASS  the images are pinned by digest, not tag  (registry.drill.test:5000/playground-gateway@sha256:3f56d75cf315650e1559b11e6f72ece2db9074dc97731266caa92370116aa649)
PASS  the VM records it as current
PASS  smoke really ran and passed
PASS  the deploy key is not in the log
PASS  a mail says it deployed
PASS  .env is still 0600 after a deploy  (600)
PASS  the previous release was recorded, for rollback
PASS  the agent pod is gone after the build

== Ship a version that is healthy but fails smoke: it must roll back by itself
   v3, passes health, fails smoke: 81aebed65579, build #3
PASS  the good version runs until approval
   deploy-playground #3: FAILURE, 581 s, cause: Started by an SCM change, description: 81aebed65579 rolled back to a248597a5ea7
PASS  the build fails  (FAILURE)
PASS  it really deployed the bad version first
PASS  smoke caught it  (FAIL  SESSION is HttpOnly)
PASS  it rolled back by itself
PASS  the VM runs the last good digests again  (registry.drill.test:5000/playground-gateway@sha256:3f56d75cf315650e1559b11e6f72ece2db9074dc97731266caa92370116aa649)
PASS  the VM records the good version as current
PASS  smoke passed on the rolled back version
PASS  the bad version never counted as good
PASS  a mail says it rolled back

== Manual rollback: ship another good version, then one click
   v4, good: 28b7830b7d26, build #4
   deploy-playground #4: SUCCESS, 320 s, cause: Started by an SCM change, description: 28b7830b7d26
PASS  v4 deployed  (SUCCESS)
PASS  one POST starts the rollback, with no parameters  (201)
   rollback-playground #1: SUCCESS, 288 s, cause: Started by user Drill Jenkins, description: to a248597a5ea7
PASS  the rollback job succeeded  (SUCCESS)
PASS  v4 is no longer running
PASS  the VM runs the last good version  (registry.drill.test:5000/playground-gateway@sha256:3f56d75cf315650e1559b11e6f72ece2db9074dc97731266caa92370116aa649)
PASS  it ran smoke afterwards
PASS  the deploy key is not in the log
PASS  a mail says so
PASS  v4 no longer counts as good, so another click goes further back

== Commits that must never reach approval, and a refused approval
   CI failed: 9b898761d173, build #5
   deploy-playground #5: FAILURE, 17 s, cause: Started by an SCM change, description: 9b898761d173
PASS  CI failed: the build fails  (FAILURE)
PASS  CI failed: for the right reason  (STOP  CI concluded failure for 9b898761d173290682ff0d324f64e4f959a2e367: 822564)
PASS  CI failed: nobody is asked to approve
PASS  CI failed: nothing changed on the VM
PASS  CI failed: a mail says it stopped
   images claim another commit: 79c8e8198a53, build #6
   deploy-playground #6: FAILURE, 20 s, cause: Started by an SCM change, description: 79c8e8198a53
PASS  images claim another commit: the build fails  (FAILURE)
PASS  images claim another commit: for the right reason  (STOP  gateway linux/amd64: built from commit ffffffffffffffffffffffffffffffffffffffff, expected 79c8e8198a5350f110c54f5b0eb796129965d6e0)
PASS  images claim another commit: nobody is asked to approve
PASS  images claim another commit: nothing changed on the VM
PASS  images claim another commit: a mail says it stopped
   images claim another repo: 539c95e1d872, build #7
   deploy-playground #7: FAILURE, 17 s, cause: Started by an SCM change, description: 539c95e1d872
PASS  images claim another repo: the build fails  (FAILURE)
PASS  images claim another repo: for the right reason  (STOP  gateway linux/amd64: built from repo https://github.com/someone/playaround, expected https://github.com/vandatnguyen919/playaround)
PASS  images claim another repo: nobody is asked to approve
PASS  images claim another repo: nothing changed on the VM
PASS  images claim another repo: a mail says it stopped
   v5, approval refused: 719974fe2f54, build #9
   deploy-playground #9: ABORTED, 5 s, cause: Started by an SCM change,Rejected by Drill Jenkins, description: 719974fe2f54
PASS  a refused approval deploys nothing  (ABORTED)
   v5b, VM unreachable: decb69b193b4, build #10
   deploy-playground #10: FAILURE, 63 s, cause: Started by an SCM change, description: decb69b193b4
PASS  an unreachable VM fails the build  (FAILURE)
PASS  an unreachable VM still gets a mail
PASS  an unreachable VM changes nothing
   v5c, compose file needs a variable .env lacks: 602b5559153e, build #11
   deploy-playground #11: FAILURE, 70 s, cause: Started by an SCM change, description: 602b5559153e
PASS  a compose file that does not fit .env fails the build  (FAILURE)
PASS  it fails before anything changes
PASS  a mail says nothing changed

== Ship a version that never gets healthy: it must roll back too
   v6, gateway crashes on start: ac6d5490d07b, build #13
   deploy-playground #13: FAILURE, 868 s, cause: Started by an SCM change, description: ac6d5490d07b rolled back to a248597a5ea7
PASS  the build fails  (FAILURE)
PASS  the health wait caught it  (vm-deploy: not healthy after 240 s: gateway)
PASS  it rolled back by itself
PASS  the VM runs the last good digests again

== A good version after all of that, so the recreate has a good commit at the head
   v7, good: 9c5410e05a60, build #15
   deploy-playground #15: SUCCESS, 554 s, cause: Started by an SCM change, description: 9c5410e05a60
PASS  v7 deployed  (SUCCESS)

== Deploy history
   current: 9c5410e05a606c060d2baba3cc3cb4bf0a79a957
   good, oldest first:
     79506c60341d8cb36041081a61ea7c31ac137070
     a248597a5ea717519a6eae4c840148e579f57381
     9c5410e05a606c060d2baba3cc3cb4bf0a79a957
   events:
   2026-11-05T20:45:44Z	bootstrap	79506c60341d8cb36041081a61ea7c31ac137070	good	bootstrap
   2026-11-05T20:46:20Z	deploy	a248597a5ea717519a6eae4c840148e579f57381	started	deploy-playground/2
   2026-11-05T20:48:52Z	deploy	a248597a5ea717519a6eae4c840148e579f57381	healthy	deploy-playground/2
   2026-11-05T20:50:36Z	mark-good	a248597a5ea717519a6eae4c840148e579f57381	good	deploy-playground/2
   2026-11-05T20:54:40Z	deploy	81aebed655797553e933d2601bef5efee1a34247	started	deploy-playground/3
   2026-11-05T20:56:38Z	deploy	81aebed655797553e933d2601bef5efee1a34247	healthy	deploy-playground/3
   2026-11-05T20:58:13Z	note	81aebed655797553e933d2601bef5efee1a34247	deploy-or-smoke-failed	deploy-playground/3
   2026-11-05T20:58:14Z	rollback	a248597a5ea717519a6eae4c840148e579f57381	started	deploy-playground/3
   2026-11-05T21:00:23Z	rollback	a248597a5ea717519a6eae4c840148e579f57381	healthy	deploy-playground/3
   2026-11-05T21:02:54Z	note	a248597a5ea717519a6eae4c840148e579f57381	rollback-verified	deploy-playground/3
   2026-11-05T21:07:14Z	deploy	28b7830b7d265eaa4fc4f9cfdda553938ec0c9d6	started	deploy-playground/4
   2026-11-05T21:09:20Z	deploy	28b7830b7d265eaa4fc4f9cfdda553938ec0c9d6	healthy	deploy-playground/4
   2026-11-05T21:10:51Z	mark-good	28b7830b7d265eaa4fc4f9cfdda553938ec0c9d6	good	deploy-playground/4
   2026-11-05T21:13:21Z	rollback	a248597a5ea717519a6eae4c840148e579f57381	started	rollback-playground/1
   2026-11-05T21:15:29Z	rollback	a248597a5ea717519a6eae4c840148e579f57381	healthy	rollback-playground/1
   2026-11-05T21:16:58Z	note	a248597a5ea717519a6eae4c840148e579f57381	rollback-verified	rollback-playground/1
   2026-11-05T21:42:45Z	deploy	ac6d5490d07be5076eb09b248efce486488543db	started	deploy-playground/13
   2026-11-05T21:48:59Z	deploy	ac6d5490d07be5076eb09b248efce486488543db	failed-health	deploy-playground/13
   2026-11-05T21:49:15Z	note	ac6d5490d07be5076eb09b248efce486488543db	deploy-or-smoke-failed	deploy-playground/13
   2026-11-05T21:49:20Z	rollback	a248597a5ea717519a6eae4c840148e579f57381	started	deploy-playground/13
   2026-11-05T21:51:40Z	rollback	a248597a5ea717519a6eae4c840148e579f57381	healthy	deploy-playground/13
   2026-11-05T21:54:26Z	note	a248597a5ea717519a6eae4c840148e579f57381	rollback-verified	deploy-playground/13
   2026-11-05T22:08:04Z	deploy	9c5410e05a606c060d2baba3cc3cb4bf0a79a957	started	deploy-playground/15
   2026-11-05T22:10:28Z	deploy	9c5410e05a606c060d2baba3cc3cb4bf0a79a957	healthy	deploy-playground/15
   2026-11-05T22:12:38Z	mark-good	9c5410e05a606c060d2baba3cc3cb4bf0a79a957	good	deploy-playground/15
PASS  the VM's log has the auto rollback
PASS  the VM's log has the manual rollback
PASS  the VM's log has good deploys with who did it
PASS  Jenkins keeps the builds, with what each shipped  (15 builds)
   memory: controller peak 640 MiB, anon 627 MiB, agent peak 253 MiB
PASS  the controller was never OOM killed  (oom 0, restarts 0)
PASS  the controller's own memory stays under its limit  (627 MiB)
PASS  the agent stays under its limit  (253 MiB)
PASS  no OOM events in namespace ci
PASS  no mail carries a secret

== Drift: a change made in Jenkins does not survive a restart
PASS  the drift applied
PASS  the export shows the drift (so this check can fail)
PASS  after a restart: same plugins and versions  (64 plugins)
PASS  after a restart: same settings (JCasC export)  (383 lines, sha d9f30ecc6f1aefb7)
PASS  after a restart: same jobs  (deploy-playground,rollback-playground)
PASS  after a restart: same job config  (sha 6f7c58f7ff7195a5)
PASS  after a restart: same credential ids  (notify-recipient,notify-smtp,vm-deploy-key)

== Backup
   archived 133 entries, 300604 bytes
   kept jenkins-20261105T221842Z.tar.gz
PASS  the backup has the build history  (133 entries)
PASS  the backup has no keys or credentials
PASS  the deploy key is nowhere in it
PASS  the SMTP password is nowhere in it
PASS  the client secret is nowhere in it

== Delete the controller and everything around it, then recreate from the repo
PASS  JENKINS_HOME is gone  (no volumes left)
PASS  namespace ci is gone
   recreated in 132 s
   waiting for the poll to find the head commit (up to 5 min, H/5)
   deploy-playground #1: SUCCESS, 276 s, cause: Started by an SCM change, description: 9c5410e05a60
PASS  the recreated controller deploys with the key from its store  (SUCCESS)
PASS  the recreated job really ran on an agent
PASS  the VM's history outlived the controller
PASS  the recreated controller stayed within limits  (own memory 532 MiB)
PASS  after a recreate: same plugins and versions  (64 plugins)
PASS  after a recreate: same settings (JCasC export)  (383 lines, sha d9f30ecc6f1aefb7)
PASS  after a recreate: same jobs  (deploy-playground,rollback-playground)
PASS  after a recreate: same job config  (sha 6f7c58f7ff7195a5)
PASS  after a recreate: same credential ids  (notify-recipient,notify-smtp,vm-deploy-key)

== Restore the backed-up history onto the recreated controller
PASS  the old build is back with its log  (build #15, 12783 bytes)
PASS  after a restore: same plugins and versions  (64 plugins)
PASS  after a restore: same settings (JCasC export)  (383 lines, sha d9f30ecc6f1aefb7)
PASS  after a restore: same jobs  (deploy-playground,rollback-playground)
PASS  after a restore: same job config  (sha 6f7c58f7ff7195a5)
PASS  after a restore: same credential ids  (notify-recipient,notify-smtp,vm-deploy-key)
PASS  build numbers continue  (next 16)

== Keycloak down: Jenkins does not fall over, and login fails closed
PASS  the controller starts without Keycloak  (restarts 0)
PASS  nobody gets in while Keycloak is down  (403)
PASS  the controller starts without Keycloak
PASS  sign-in works again once Keycloak is back, with no restart

All 138 checks passed.
```
