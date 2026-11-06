#!/usr/bin/env bash
# Puts a backup's build history back into a running install. Stops the controller,
# unpacks over JENKINS_HOME and starts it again. Config comes from the repo as always.
#
#   restore.sh <jenkins-<stamp>.tar.gz>
set -euo pipefail

file="${1:?usage: restore.sh <backup.tar.gz>}"
[ -f "$file" ] || { echo "$file not found" >&2; exit 1; }
tar -tzf - < "$file" >/dev/null ||{ echo "$file is not a readable archive" >&2; exit 1; }

kubectl -n ci scale statefulset/jenkins --replicas=0
kubectl -n ci wait pod/jenkins-0 --for=delete --timeout=5m 2>/dev/null || true

trap 'kubectl -n ci delete pod jenkins-restore --ignore-not-found --wait=false >/dev/null' EXIT
kubectl -n ci apply -f - <<'EOF'
apiVersion: v1
kind: Pod
metadata:
  name: jenkins-restore
  namespace: ci
spec:
  restartPolicy: Never
  automountServiceAccountToken: false
  securityContext:
    runAsNonRoot: true
    runAsUser: 1000
    runAsGroup: 1000
    fsGroup: 1000
    seccompProfile:
      type: RuntimeDefault
  containers:
    - name: restore
      image: jenkins/jenkins:2.580.1-lts-jdk25
      command: [sleep, "1800"]
      resources:
        limits: { cpu: 500m, memory: 128Mi }
      securityContext:
        allowPrivilegeEscalation: false
        capabilities: { drop: [ALL] }
      volumeMounts:
        - { name: jenkins-home, mountPath: /jenkins-home }
  volumes:
    - name: jenkins-home
      persistentVolumeClaim:
        claimName: jenkins
EOF
kubectl -n ci wait pod/jenkins-restore --for=condition=Ready --timeout=5m
kubectl -n ci exec -i jenkins-restore -- tar -xzf - -C /jenkins-home < "$file"
kubectl -n ci delete pod jenkins-restore --wait=true
trap - EXIT

kubectl -n ci scale statefulset/jenkins --replicas=1
kubectl -n ci rollout status statefulset/jenkins --timeout=15m
echo "restored $file"
