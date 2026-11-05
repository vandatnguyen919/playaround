#!/usr/bin/env bash
# Offline checks for deploy/terraform, the same locally and in CI: fmt, init
# against the lock files, validate, terraform test (mocked provider), tflint,
# trivy config. Needs Docker, not Azure, and never reads credentials. The repo
# is mounted read-only; caches live in a Docker volume.
set -euo pipefail

cd "$(dirname "$0")"
# Git Bash on Windows would rewrite the container paths below.
export MSYS_NO_PATHCONV=1
src="$(pwd -W 2>/dev/null || pwd)"

TERRAFORM=hashicorp/terraform:1.17.1@sha256:a5d5a5a892c98f60fcbfa81eac2a40fc19e7b3fa7719bccae10ff6111d22524a
TFLINT=ghcr.io/terraform-linters/tflint:v0.65.0@sha256:2788f4d4fc663c0e953b011b01bf443fe5bfce7587ee916e588e6057b85d6359
TRIVY=aquasec/trivy:0.76.0@sha256:2416d1f74045b57274df1a340eee6b510cacd73c66a6ccb8da092b117eb7d222

CACHE=playground-tf-check
ROOTS="bootstrap envs/azure envs/dns"
TESTED_ROOTS="bootstrap envs/azure"

terraform() {
  local root="$1"; shift
  docker run --rm -v "$src:/tf:ro" -v "$CACHE:/cache" -w "/tf/$root" \
    -e TF_IN_AUTOMATION=1 -e TF_PLUGIN_CACHE_DIR=/cache/plugins \
    -e "TF_DATA_DIR=/cache/data/$root" \
    "$TERRAFORM" "$@"
}

docker run --rm -v "$CACHE:/cache" --entrypoint mkdir "$TERRAFORM" -p /cache/plugins /cache/tflint

echo "== fmt"
terraform . fmt -recursive -check -diff

for root in $ROOTS; do
  echo "== init and validate: $root"
  terraform "$root" init -backend=false -input=false -lockfile=readonly >/dev/null
  terraform "$root" validate
done

for root in $TESTED_ROOTS; do
  echo "== test: $root"
  terraform "$root" test
done

echo "== tflint"
tflint() {
  docker run --rm -v "$src:/tf:ro" -v "$CACHE:/cache" -w /tf \
    -e TFLINT_PLUGIN_DIR=/cache/tflint -e GITHUB_TOKEN="${GITHUB_TOKEN:-}" \
    "$TFLINT" --config /tf/.tflint.hcl "$@"
}
tflint --init
tflint --recursive

echo "== trivy config"
docker run --rm -v "$src:/tf:ro" -v "$CACHE:/cache" -w /tf "$TRIVY" config \
  --cache-dir /cache/trivy --severity MEDIUM,HIGH,CRITICAL \
  --ignorefile /tf/.trivyignore.yaml --exit-code 1 .

echo "All Terraform checks passed."
