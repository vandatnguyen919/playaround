#!/bin/sh
# Deploys and rolls back the compose stack on the VM. Run with sudo. Jenkins reaches
# it only through vm-ssh-gate.sh. Works by hand too, with "manual" as <by>.
#
#   vm-deploy.sh deploy <sha> <gateway-digest> <api-digest> <keycloak-digest> <by>
#   vm-deploy.sh rollback <by>          back to the newest good release that is not current
#   vm-deploy.sh mark-good <sha> <by>   the current release passed smoke
#   vm-deploy.sh note <sha> <word> <by> adds a line to the deploy history
#   vm-deploy.sh current                the release running now
#   vm-deploy.sh history                the good releases and the last 50 events
#   vm-deploy.sh add-deploy-key         reads a public key from stdin (install only)
#
# Keeps its state in /srv/playground/releases on the data disk: one folder per release
# (image digests and the compose files of that commit), "current", "good" (oldest
# first) and "deploys.log". Files come from GitHub at the exact commit, not from the
# caller, so whoever holds the deploy key can only run what is in the repo and on GHCR.
#
# Rollback restores images and compose files, not data. A release that changed the
# Keycloak database schema needs RESTORE.md instead.
set -eu
umask 022

COMPOSE_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$COMPOSE_DIR/../.." && pwd)"
ENV_FILE="$COMPOSE_DIR/.env"
COMPOSE_FILE="$COMPOSE_DIR/compose.prod.yml"
STATE="$ROOT/releases"
FILES="deploy/compose/compose.prod.yml deploy/compose/smoke-access.sh infra/playground-realm.json infra/redis/redis.conf infra/redis/start.sh"

IMAGE_PREFIX=ghcr.io/vandatnguyen919/playground-
RAW_BASE=https://raw.githubusercontent.com/vandatnguyen919/playaround
HEALTH_TIMEOUT=600
DEPLOY_USER=playground
# The drill's stand-in VM changes these. Nothing on the real VM needs this file.
# shellcheck disable=SC1091
[ ! -f "$COMPOSE_DIR/vm-deploy.conf" ] || . "$COMPOSE_DIR/vm-deploy.conf"

die() {
  echo "vm-deploy: $1" >&2
  exit 1
}

valid_sha() { printf '%s' "$1" | grep -Eq '^[0-9a-f]{40}$'; }
valid_release() { valid_sha "$1" || [ "$1" = initial ]; }
valid_digest() { printf '%s' "$1" | grep -Eq '^sha256:[0-9a-f]{64}$'; }
valid_word() { printf '%s' "$1" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9_./-]{0,79}$'; }

record() { # action release result by
  printf '%s\t%s\t%s\t%s\t%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" "$2" "$3" "$4" >> "$STATE/deploys.log"
}

lock() {
  mkdir -p "$STATE"
  exec 9> "$STATE/lock"
  flock -n 9 || die "another deploy or rollback is running"
}

current() { cat "$STATE/current" 2>/dev/null || true; }

good_remove() { # release
  [ -f "$STATE/good" ] || return 0
  grep -vx "$1" "$STATE/good" > "$STATE/good.tmp" || true
  mv "$STATE/good.tmp" "$STATE/good"
}

# Rewrites three lines of the secret .env. Never prints it.
env_with_images() { # images-file output-file
  (
    umask 077
    awk -F= -v images="$1" '
      BEGIN { while ((getline line < images) > 0) { split(line, part, "="); value[part[1]] = substr(line, length(part[1]) + 2) } }
      ($1 in value) { print $1 "=" value[$1]; next }
      { print }
    ' "$ENV_FILE" > "$2"
  )
}

set_images() { # images-file
  env_with_images "$1" "$ENV_FILE.tmp"
  chown root:root "$ENV_FILE.tmp" 2>/dev/null || true
  chmod 600 "$ENV_FILE.tmp"
  mv "$ENV_FILE.tmp" "$ENV_FILE"
}

compose() { docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"; }

wait_healthy() {
  deadline=$(($(date +%s) + HEALTH_TIMEOUT))
  while :; do
    waiting=""
    for service in postgres keycloak redis api gateway; do
      id="$(compose ps -q "$service")"
      status="$([ -z "$id" ] || docker inspect -f '{{.State.Health.Status}}' "$id" 2>/dev/null || true)"
      [ "$status" = healthy ] || waiting="$waiting $service"
    done
    [ -n "$waiting" ] || break
    if [ "$(date +%s)" -ge "$deadline" ]; then
      echo "vm-deploy: not healthy after $HEALTH_TIMEOUT s:$waiting" >&2
      return 1
    fi
    sleep 5
  done
  # Exits once per up. It sets the admin console's URL, and nothing depends on it.
  id="$(compose ps -a -q keycloak-admin-url)"
  deadline=$(($(date +%s) + 120))
  while [ -n "$id" ] && [ "$(docker inspect -f '{{.State.Status}}' "$id")" != exited ]; do
    if [ "$(date +%s)" -ge "$deadline" ]; then
      echo "vm-deploy: keycloak-admin-url did not finish" >&2
      return 1
    fi
    sleep 2
  done
  if [ -n "$id" ] && [ "$(docker inspect -f '{{.State.ExitCode}}' "$id")" != 0 ]; then
    echo "vm-deploy: keycloak-admin-url failed" >&2
    return 1
  fi
}

# The first deploy records what is already running, so it has something to go back to.
bootstrap() {
  [ -z "$(current)" ] || return 0
  tag="$(sed -n 's/^GATEWAY_IMAGE=.*:sha-//p' "$ENV_FILE")"
  release="$tag"
  valid_sha "$release" || release=initial
  mkdir -p "$STATE/$release"
  grep -E '^(GATEWAY|API|KEYCLOAK)_IMAGE=' "$ENV_FILE" > "$STATE/$release/images.env"
  # shellcheck disable=SC2086
  tar -C "$ROOT" -cf "$STATE/$release/files.tar" $FILES
  echo "$release" > "$STATE/good"
  echo "$release" > "$STATE/current"
  record bootstrap "$release" good bootstrap
  echo "recorded what is running as release $release"
}

cmd_deploy() {
  [ "$#" -eq 5 ] || die "usage: deploy <sha> <gateway-digest> <api-digest> <keycloak-digest> <by>"
  sha="$1" by="$5"
  valid_sha "$sha" || die "bad sha"
  for digest in "$2" "$3" "$4"; do valid_digest "$digest" || die "bad digest"; done
  valid_word "$by" || die "bad <by>"
  lock
  bootstrap

  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  for file in $FILES; do
    mkdir -p "$tmp/$(dirname "$file")"
    curl -fsS --retry 2 --max-time 30 -o "$tmp/$file" "$RAW_BASE/$sha/$file" || die "cannot fetch $file at $sha"
  done
  {
    echo "GATEWAY_IMAGE=${IMAGE_PREFIX}gateway@$2"
    echo "API_IMAGE=${IMAGE_PREFIX}api@$3"
    echo "KEYCLOAK_IMAGE=${IMAGE_PREFIX}keycloak@$4"
  } > "$tmp/images.env"

  # Nothing running has changed yet: a bad compose file, a variable missing from .env
  # or a failed pull stops here, and the caller sees current unchanged.
  env_with_images "$tmp/images.env" "$tmp/env"
  docker compose -f "$tmp/deploy/compose/compose.prod.yml" --env-file "$tmp/env" config -q || die "the compose file of $sha does not work with this .env"
  docker compose -f "$tmp/deploy/compose/compose.prod.yml" --env-file "$tmp/env" pull -q || die "cannot pull the images of $sha"

  mkdir -p "$STATE/$sha"
  cp "$tmp/images.env" "$STATE/$sha/images.env"
  # shellcheck disable=SC2086
  tar -C "$tmp" -cf "$STATE/$sha/files.tar" $FILES

  echo "$sha" > "$STATE/current"
  tar -xf "$STATE/$sha/files.tar" -C "$ROOT" --no-same-owner
  set_images "$STATE/$sha/images.env"
  record deploy "$sha" started "$by"
  compose up -d --no-build || { record deploy "$sha" failed-up "$by"; die "compose up failed"; }
  wait_healthy || { record deploy "$sha" failed-health "$by"; exit 1; }
  record deploy "$sha" healthy "$by"
  echo "$sha is running and healthy"
}

cmd_rollback() {
  [ "$#" -eq 1 ] || die "usage: rollback <by>"
  by="$1"
  valid_word "$by" || die "bad <by>"
  lock
  from="$(current)"
  [ -n "$from" ] || die "no release recorded yet, so nothing to go back to"
  # A rollback that failed part way is retried to the same place, not one further back.
  if [ -f "$STATE/rolling" ]; then
    target="$(cat "$STATE/rolling")"
  else
    target="$(grep -vx "$from" "$STATE/good" 2>/dev/null | tail -n 1 || true)"
    [ -n "$target" ] || die "no good release to go back to"
    echo "$target" > "$STATE/rolling"
  fi
  valid_release "$target" || die "bad release in the good list"
  [ -f "$STATE/$target/files.tar" ] || die "release $target has no saved files"

  tar -xf "$STATE/$target/files.tar" -C "$ROOT" --no-same-owner
  set_images "$STATE/$target/images.env"
  echo "$target" > "$STATE/current"
  # Rolled away from, so the next click goes further back instead of returning here.
  [ "$from" = "$target" ] || good_remove "$from"
  record rollback "$target" started "$by"
  compose pull -q || { record rollback "$target" failed-pull "$by"; die "cannot pull the images of $target"; }
  compose up -d --no-build || { record rollback "$target" failed-up "$by"; die "compose up failed"; }
  wait_healthy || { record rollback "$target" failed-health "$by"; exit 1; }
  rm -f "$STATE/rolling"
  record rollback "$target" healthy "$by"
  echo "rolled back from $from to $target"
}

cmd_mark_good() {
  [ "$#" -eq 2 ] || die "usage: mark-good <sha> <by>"
  valid_release "$1" || die "bad sha"
  valid_word "$2" || die "bad <by>"
  lock
  [ "$(current)" = "$1" ] || die "$1 is not the current release"
  good_remove "$1"
  echo "$1" >> "$STATE/good"
  record mark-good "$1" good "$2"
}

cmd_note() {
  [ "$#" -eq 3 ] || die "usage: note <sha> <word> <by>"
  valid_release "$1" || die "bad sha"
  valid_word "$2" || die "bad word"
  valid_word "$3" || die "bad <by>"
  mkdir -p "$STATE"
  record note "$1" "$2" "$3"
}

cmd_history() {
  echo "current: $(current)"
  echo "good, oldest first:"
  sed 's/^/  /' "$STATE/good" 2>/dev/null || true
  echo "events:"
  tail -n 50 "$STATE/deploys.log" 2>/dev/null || true
}

# The key can run this script's commands and open a tunnel to Keycloak's loopback port,
# nothing else. No shell, no other forwarding.
cmd_add_deploy_key() {
  IFS= read -r key || key=""
  printf '%s' "$key" | grep -Eq '^ssh-ed25519 [A-Za-z0-9+/=]+( [^"]*)?$' || die "expected one ssh-ed25519 public key on stdin"
  dir="$(getent passwd "$DEPLOY_USER" | cut -d: -f6)"
  file="$dir/.ssh/authorized_keys"
  body="$(printf '%s' "$key" | cut -d' ' -f2)"
  if grep -q "$body" "$file" 2>/dev/null; then
    echo "that key is already there"
    return 0
  fi
  mkdir -p "$dir/.ssh"
  printf 'restrict,port-forwarding,permitopen="127.0.0.1:8080",command="sh %s/vm-ssh-gate.sh" %s\n' "$COMPOSE_DIR" "$key" >> "$file"
  chown -R "$DEPLOY_USER" "$dir/.ssh"
  chmod 700 "$dir/.ssh"
  chmod 600 "$file"
  echo "added the deploy key, limited to vm-ssh-gate.sh"
}

command="${1:-}"
[ "$#" -eq 0 ] || shift
case "$command" in
  deploy) cmd_deploy "$@" ;;
  rollback) cmd_rollback "$@" ;;
  mark-good) cmd_mark_good "$@" ;;
  note) cmd_note "$@" ;;
  current) current ;;
  history) cmd_history ;;
  add-deploy-key) cmd_add_deploy_key ;;
  *)
    sed -n '2,10p' "$0" >&2
    exit 2
    ;;
esac
