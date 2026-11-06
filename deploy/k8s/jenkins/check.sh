#!/usr/bin/env bash
# Offline checks for deploy/k8s/jenkins, the same locally and in CI. Renders the chart
# and reads the result; needs Docker and network for the chart and update center, not a
# cluster. The full proof is drill/drill.mjs.
#   JENKINS_DIR=<dir> check.sh     checks a copy instead of this directory
set -euo pipefail

export MSYS_NO_PATHCONV=1
dir="${JENKINS_DIR:-$(dirname "$0")}"
src="$(cd "$dir" && (pwd -W 2>/dev/null || pwd))"

HELM=alpine/helm:3.22.1
JENKINS=jenkins/jenkins:2.580.1-lts-jdk25
CHART_VERSION=5.10.0
BUDGET_MI=1024

fail=0
check() {
  if [ "$2" = "$3" ]; then echo "PASS  $1"; else echo "FAIL  $1 (expected '$3', got '$2')"; fail=1; fi
}

rendered="$(docker run --rm -v "$src:/j:ro" "$HELM" template jenkins jenkins \
  --repo https://charts.jenkins.io --version "$CHART_VERSION" --namespace ci \
  -f /j/values.yaml -f /j/plugins.yaml)"

count() { printf '%s\n' "$rendered" | grep -cE -e "$1" || true; }
mi() { sed -nE "$1" "$dir/values.yaml" | head -n 1; }

check "no Ingress" "$(count '^kind: Ingress')" 0
check "no HTTPRoute" "$(count '^kind: HTTPRoute')" 0
check "no LoadBalancer or NodePort" "$(count 'type: (LoadBalancer|NodePort)')" 0
# The chart lists containerPort 50000 regardless; what counts is the service and the setting.
check "no inbound agent service" "$(count 'name: jenkins-agent$')" 0
check "inbound agent port is off" "$(count 'slaveAgentPort: -1')" 1
check "no auto-reload sidecar" "$(count 'k8s-sidecar')" 0
check "no local admin secret" "$(count 'jenkins-admin-password')" 0
check "dependencies stay pinned" "$(count '--latest false')" 1
check "config is rebuilt from the repo at start" "$(count 'echo "deleting all XML config files"')" 1
check "plugins are rebuilt from the repo at start" "$(count 'echo "remove all plugins from shared volume"')" 1

controller="$(mi 's/^    limits: \{ cpu: "1", memory: ([0-9]+)Mi \}$/\1/p')"
# The init containers run one after the other and before the agent, so only the agent counts.
agent="$(sed -nE '/- name: jnlp/,/volumeMounts/s/^ +limits: \{ cpu: 500m, memory: ([0-9]+)Mi \}$/\1/p' "$dir/values.yaml")"
check "controller and agent limits equal the $BUDGET_MI Mi budget" "$((controller + agent))" "$BUDGET_MI"
check "one agent pod at most" "$(grep -c 'containerCapStr: "1"' "$dir/values.yaml")" 1
check "the deploy job polls and has no webhook" "$(count "pollSCM \{ scmpoll_spec\('H/5")" 1
check "the rollback job exists" "$(count "pipelineJob\('rollback-playground'\)")" 1
check "the real install has no drill settings" "$(sed -nE '/name: (NOTIFY_PLAIN_SMTP|SSL_CERT_FILE|NODE_TLS_REJECT_UNAUTHORIZED)$/{n;p}' "$dir/values.yaml" | grep -vc 'value: ""' || true)" 0
check "the host key is pinned" "$(grep -cF 'value: 10.20.1.4 ssh-ed25519 ' "$dir/values.yaml")" 1
check "the pipeline asks before deploying" "$(grep -c "input id: 'Deploy'" "$dir/deploy.Jenkinsfile")" 1

# Provenance rules and the SSH gate, with stand-ins for the registry, GitHub and sudo.
tests="$(cd "$dir/../../.." && (pwd -W 2>/dev/null || pwd))"
if docker run --rm -v "$tests:/repo:ro" -w /repo node:22.20.0-slim sh -c \
  'node deploy/k8s/jenkins/cd-gate.test.mjs && sh deploy/compose/vm-ssh-gate.test.sh'; then
  echo "PASS  provenance rules and SSH gate"
else
  echo "FAIL  provenance rules or SSH gate"
  fail=1
fi

# The list must be exactly what these plugins resolve to, or a dependency floats.
pinned="$(sed -nE 's/^ +- ([a-z0-9-]+):(.+)$/\1 \2/p' "$dir/plugins.yaml" | sort)"
resolved="$(printf '%s\n' "$pinned" | sed 's/ /:/' | docker run --rm -i --entrypoint sh "$JENKINS" -c \
  'cat > /tmp/p.txt; jenkins-plugin-cli --plugin-file /tmp/p.txt --no-download --list -d /tmp/x 2>/dev/null' \
  | sed -n '/^Resulting plugin list:/,/^Done/p' | sed -E '/^(Resulting|Done|$)/d' | sort)"
if [ "$pinned" = "$resolved" ]; then
  echo "PASS  plugins.yaml is the full resolved set ($(printf '%s\n' "$pinned" | wc -l) plugins)"
else
  echo "FAIL  plugins.yaml differs from the resolved set:"
  diff <(printf '%s\n' "$pinned") <(printf '%s\n' "$resolved") || true
  fail=1
fi

exit "$fail"
