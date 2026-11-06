#!/usr/bin/env bash
# Creates or updates Jenkins from the repo. Safe to rerun; every change to values.yaml
# or plugins.yaml takes effect through this and a controller restart.
#
#   JENKINS_CLIENT_SECRET=... VM_DEPLOY_KEY_FILE=... NOTIFY_SMTP_USER=... \
#   NOTIFY_SMTP_PASSWORD=... NOTIFY_RECIPIENT=... install.sh <overlay-dir> [<helm args>]
#
# JENKINS_CLIENT_SECRET is the same value Keycloak's jenkins client has (.env on the
# VM, vm-env.sh). VM_DEPLOY_KEY_FILE is the private half of the deploy key. All needed
# once: rerun without them and the Secret stays as it is. README.md, Install.
# The overlay dir says where backups go: backup-upload.yaml and backup-patch.yaml
# (overlays/azure/jenkins on the VM). Uses the current kubectl context.
set -euo pipefail

here="$(dirname "$0")"
CHART_VERSION=5.10.0

overlay="${1:-}"
[ -f "$overlay/backup-upload.yaml" ] && [ -f "$overlay/backup-patch.yaml" ]   || { echo "usage: install.sh <overlay-dir> [<helm args>]" >&2; exit 2; }
shift

kubectl apply -f "$here/base.yaml" -f "$here/backup.yaml"

if [ -n "${JENKINS_CLIENT_SECRET:-}" ]; then
  : "${VM_DEPLOY_KEY_FILE:?set VM_DEPLOY_KEY_FILE}" "${NOTIFY_SMTP_USER:?set NOTIFY_SMTP_USER}"
  : "${NOTIFY_SMTP_PASSWORD:?set NOTIFY_SMTP_PASSWORD}" "${NOTIFY_RECIPIENT:?set NOTIFY_RECIPIENT}"
  b64() { printf '%s' "$1" | base64 | tr -d '\n'; }
  # Through stdin, so no secret is ever an argument.
  kubectl apply -f - <<EOF
apiVersion: v1
kind: Secret
metadata:
  name: jenkins-secrets
  namespace: ci
data:
  oidc-client-secret: $(b64 "$JENKINS_CLIENT_SECRET")
  vm-deploy-key: $(base64 < "$VM_DEPLOY_KEY_FILE" | tr -d '\n')
  notify-smtp-user: $(b64 "$NOTIFY_SMTP_USER")
  notify-smtp-password: $(b64 "$NOTIFY_SMTP_PASSWORD")
  notify-recipient: $(b64 "$NOTIFY_RECIPIENT")
EOF
elif ! kubectl -n ci get secret jenkins-secrets >/dev/null 2>&1; then
  echo "Secret jenkins-secrets does not exist: set JENKINS_CLIENT_SECRET" >&2
  exit 1
fi

kubectl apply -f "$overlay/backup-upload.yaml"
kubectl -n ci patch cronjob jenkins-backup --patch-file "$overlay/backup-patch.yaml"

helm upgrade --install jenkins jenkins --repo https://charts.jenkins.io --version "$CHART_VERSION" \
  --namespace ci -f "$here/values.yaml" -f "$here/plugins.yaml" "$@"

kubectl -n ci rollout status statefulset/jenkins --timeout=15m
