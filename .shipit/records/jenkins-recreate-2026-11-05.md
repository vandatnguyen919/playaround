# Jenkins recreate drill, 2026-11-05

Output of `node deploy/k8s/jenkins/drill/drill.mjs`, one clean run from the final files. Local k3s
v1.36.5+k3s1 in Docker (amd64), the local prod stack Keycloak, a scratch git repo and a
stand-in app chart. Nothing on Azure or GitHub was touched.

```

== Remove the k3s container and the drill's users

All 0 checks passed.

== Cluster: k3s in Docker, Keycloak service, scratch git repo, users
PASS  k3s version is the decided one

== Install from the repo
PASS  controller is ready with no restarts  (restarts 0)

== Sign-in and exposure
PASS  anonymous gets nothing  (403)
PASS  anonymous cannot read the job  (403)
PASS  a user without the role passes Keycloak
PASS  a user without the role is refused by Jenkins  (403)
PASS  a user without the role cannot use the API  (403)
PASS  the login form is the public Keycloak host  (https://auth.localhost/realms/playground/protocol/openid-connect/auth)
PASS  the login request carries PKCE S256
PASS  the role holder signs in over OIDC  (drill-jenkins-admin@example.com)
PASS  the role arrives as a group  (authenticated,default-roles-playground,jenkins-admin,offline_access,uma_authorization,user)
PASS  the full name comes from Keycloak  (Drill Jenkins)
PASS  the controller runs no builds  (0 executors)
PASS  nothing public: only a ClusterIP service, no Ingress  (Service/jenkins)
PASS  the agent port is closed
PASS  another namespace cannot reach Jenkins
PASS  namespace ci can reach Jenkins
PASS  the deploy token can deploy in playground
PASS  the deploy token cannot touch ci
PASS  the deploy token has nothing cluster wide
PASS  the deploy token cannot grant itself rights

== Deploy: the poll finds a commit, a deploy-only agent ships it
   waiting for build #1 from the poll (up to 5 min, H/5)
   build #1: SUCCESS, 156 s after first seen waiting, cause: Started by an SCM change
PASS  the poll started a deploy  (Started by an SCM change)
PASS  the first deploy succeeded  (SUCCESS)
PASS  the fixture chart got the pinned tag  (sha-8721ca747da7fcc9a42bfa9630ae041742612a31)
PASS  it ran on the deploy agent, not the controller
PASS  it really checked GHCR
PASS  the token is masked in the log
PASS  the agent pod is gone after the build
   pushed a commit; waiting for build #2 from the poll (up to 5 min, H/5)
   build #2: SUCCESS, 55 s after first seen waiting, cause: Started by an SCM change
PASS  a new commit is deployed with no webhook  (SUCCESS, Started by an SCM change)
   memory: controller peak 623 MiB, anon 532 MiB, agent jnlp 149 MiB, helm 36 MiB
PASS  limits add up to the 1.0 GB budget  (1024 Mi)
PASS  the controller was never OOM killed  (oom 0, restarts 0)
PASS  the controller's own memory stays under its limit  (532 MiB)
PASS  no OOM events in namespace ci

== Drift: a change made in Jenkins does not survive a restart
PASS  the drift applied
PASS  the export shows the drift (so this check can fail)
PASS  after a restart: same plugins and versions  (63 plugins)
PASS  after a restart: same settings (JCasC export)  (327 lines, sha 3b4ac3ee1603e45f)
PASS  after a restart: same jobs  (deploy-playground)
PASS  after a restart: same job config  (sha 0f8860db61012970)
PASS  after a restart: same credential ids  (playground-deploy-token)

== Backup
   archived 19 entries, 23874 bytes
   kept jenkins-20261105T142517Z.tar.gz
PASS  the backup has the build history  (19 entries)
PASS  the backup has no keys or credentials
PASS  the deploy token is nowhere in it
PASS  the client secret is nowhere in it

== Delete the controller and everything around it, then recreate from the repo
PASS  JENKINS_HOME is gone  (no volumes left)
PASS  namespace ci is gone
   recreated in 98 s
PASS  the deploy token was rotated
   waiting for the poll to redeploy (up to 5 min, H/5)
   build #1: SUCCESS, 74 s after first seen waiting, cause: Started by an SCM change
PASS  the recreated controller deploys with the new token  (SUCCESS)
PASS  the recreated job really ran on an agent
PASS  the deploy landed  (sha-8721ca747da7fcc9a42bfa9630ae041742612a31)
PASS  the recreated controller stayed within limits  (own memory 521 MiB)
PASS  after a recreate: same plugins and versions  (63 plugins)
PASS  after a recreate: same settings (JCasC export)  (327 lines, sha 3b4ac3ee1603e45f)
PASS  after a recreate: same jobs  (deploy-playground)
PASS  after a recreate: same job config  (sha 0f8860db61012970)
PASS  after a recreate: same credential ids  (playground-deploy-token)

== Restore the backed-up history onto the recreated controller
PASS  the old build is back with its log  (build #2, 3122 bytes)
PASS  after a restore: same plugins and versions  (63 plugins)
PASS  after a restore: same settings (JCasC export)  (327 lines, sha 3b4ac3ee1603e45f)
PASS  after a restore: same jobs  (deploy-playground)
PASS  after a restore: same job config  (sha 0f8860db61012970)
PASS  after a restore: same credential ids  (playground-deploy-token)
PASS  build numbers continue  (next 3)

== Keycloak down: Jenkins does not fall over, and login fails closed
PASS  the controller starts without Keycloak  (restarts 0)
PASS  nobody gets in while Keycloak is down  (403)
PASS  the controller starts without Keycloak
PASS  sign-in works again once Keycloak is back, with no restart

All 67 checks passed.
exit 0
```
