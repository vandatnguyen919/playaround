#!/bin/sh
# Installs Jenkins on the VM, beside the compose stack: k3s, helm, the Keycloak client,
# the deploy key and the chart. Run as root on the VM from its copy of the repo files.
# Safe to rerun: each step skips what is already there. README.md, Install.
#
# Mail stays off until you set NOTIFY_SMTP_USER, NOTIFY_SMTP_PASSWORD and NOTIFY_RECIPIENT
# on the first run. No secret is printed or leaves the VM.
#
# To remove what it added: /usr/local/bin/k3s-uninstall.sh, which leaves compose alone.
set -eu
umask 077

K3S_VERSION=v1.36.5+k3s1
HELM_VERSION=v3.12.3
# Below this, Jenkins would squeeze the public site. Stop rather than risk it.
MIN_AVAILABLE_MI=1500

here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../../.." && pwd)"
compose_dir="$root/deploy/compose"
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml

step() { printf '\n== %s\n' "$1"; }
env_value() { sed -n "s/^$1=//p" "$compose_dir/.env"; }

[ "$(id -u)" = 0 ] || { echo "run as root" >&2; exit 2; }
ufw status | grep -q '6443/tcp.*10.42.0.0/16' \
  || { echo "ufw has no rule for pods to reach 6443: README.md, Install" >&2; exit 1; }
ufw status | grep -q '22/tcp.*10.42.0.0/16' \
  || { echo "ufw has no rule for pods to reach 22: README.md, Install" >&2; exit 1; }

if ! command -v k3s >/dev/null; then
  available="$(awk '/^MemAvailable:/ { print int($2 / 1024) }' /proc/meminfo)"
  [ "$available" -ge "$MIN_AVAILABLE_MI" ] \
    || { echo "only $available MiB available, need $MIN_AVAILABLE_MI" >&2; exit 1; }

  step "k3s $K3S_VERSION"
  mkdir -p /etc/rancher/k3s /srv/k3s/storage
  # Compose owns 80 and 443, so no Traefik or ServiceLB here.
  cat > /etc/rancher/k3s/config.yaml <<EOF
disable: [traefik, servicelb, metrics-server]
disable-cloud-controller: true
flannel-backend: host-gw
node-ip: $(ip -4 -o addr show eth0 | awk '{ sub(/\/.*/, "", $4); print $4 }')
default-local-storage-path: /srv/k3s/storage
write-kubeconfig-mode: "0600"
EOF
  curl -sfL https://get.k3s.io -o /root/k3s-install.sh
  INSTALL_K3S_VERSION="$K3S_VERSION" sh /root/k3s-install.sh
  rm -f /root/k3s-install.sh
fi
i=0
until k3s kubectl get nodes 2>/dev/null | grep -q ' Ready'; do
  i=$((i + 1))
  [ "$i" -le 60 ] || { echo "k3s did not get ready" >&2; exit 1; }
  sleep 5
done

if ! command -v helm >/dev/null; then
  step "helm $HELM_VERSION"
  work="$(mktemp -d)"
  tarball="helm-$HELM_VERSION-linux-arm64.tar.gz"
  curl -sfL "https://get.helm.sh/$tarball" -o "$work/$tarball"
  expected="$(curl -sfL "https://get.helm.sh/$tarball.sha256sum" | awk '{ print $1 }')"
  echo "$expected  $work/$tarball" | sha256sum -c -
  tar -xzf "$work/$tarball" -C "$work" linux-arm64/helm
  install -m 0755 "$work/linux-arm64/helm" /usr/local/bin/helm
  rm -rf "$work"
fi
command -v kubectl >/dev/null || { echo "k3s did not link kubectl" >&2; exit 1; }

step "Keycloak client, without touching the running Keycloak"
sh "$compose_dir/vm-env.sh" add-jenkins-client-secret
(
  cd "$compose_dir"
  docker compose -f compose.prod.yml up --no-deps keycloak-config keycloak-admin-url
  failed="$(docker compose -f compose.prod.yml ps -a --format '{{.Service}} {{.ExitCode}}' \
    | awk '$1 ~ /^keycloak-(config|admin-url)$/ && $2 != 0')"
  [ -z "$failed" ] || { echo "failed: $failed" >&2; exit 1; }
)

kubectl apply -f "$here/base.yaml"
kubectl -n ci create configmap jenkins-backup-target \
  --from-literal=BACKUP_CONTAINER_URL="$(env_value BACKUP_CONTAINER_URL)" \
  --dry-run=client -o yaml | kubectl apply -f -

overlay="$root/deploy/k8s/overlays/azure/jenkins"
if kubectl -n ci get secret jenkins-secrets >/dev/null 2>&1; then
  step "Jenkins (Secret and deploy key already there)"
  bash "$here/install.sh" "$overlay"
else
  step "Deploy key"
  work="$(mktemp -d)"
  trap 'rm -rf "$work"' EXIT
  ssh-keygen -q -t ed25519 -N "" -C jenkins-deploy -f "$work/key"
  sh "$compose_dir/vm-deploy.sh" add-deploy-key < "$work/key.pub"

  step "Jenkins"
  JENKINS_CLIENT_SECRET="$(env_value JENKINS_CLIENT_SECRET)" \
  VM_DEPLOY_KEY_FILE="$work/key" \
  NOTIFY_SMTP_USER="${NOTIFY_SMTP_USER:-not-set}" \
  NOTIFY_SMTP_PASSWORD="${NOTIFY_SMTP_PASSWORD:-not-set}" \
  NOTIFY_RECIPIENT="${NOTIFY_RECIPIENT:-not-set}" \
    bash "$here/install.sh" "$overlay"
fi

step "State"
kubectl -n ci get pods
free -m | sed -n 1,3p
docker ps --format '{{.Names}} {{.Status}}'
curl -s -o /dev/null -w 'public site: %{http_code}\n' --max-time 15 "https://$(env_value APP_HOST)/"
