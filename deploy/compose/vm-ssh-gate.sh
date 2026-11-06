#!/bin/sh
# The only thing the Jenkins deploy key can run (vm-deploy.sh add-deploy-key sets this
# as its forced command). sshd passes what the caller asked for in SSH_ORIGINAL_COMMAND.
# Allows the deploy commands and the calls smoke-public.mjs makes; nothing else, and
# no shell. The deploy key therefore cannot read .env or start an arbitrary container.
set -eu
set -f

here="$(cd "$(dirname "$0")" && pwd)"
request="${SSH_ORIGINAL_COMMAND:-}"

refuse() {
  echo "vm-ssh-gate: refused" >&2
  exit 126
}

# Before any splitting: no quotes, semicolons, pipes, substitutions or globs.
[ -n "$request" ] || refuse
case "$request" in
  *[!A-Za-z0-9:_./\ -]*) refuse ;;
esac

# shellcheck disable=SC2086
set -- $request

case "${1:-}" in
  deploy | rollback | mark-good | note | current | history)
    exec sudo -n sh "$here/vm-deploy.sh" "$@"
    ;;
  sudo)
    # smoke-public.mjs: sudo sh <path>/smoke-access.sh <command> [key]
    [ "${2:-}" = sh ] && [ "${3:-}" = "$here/smoke-access.sh" ] || refuse
    case "${4:-}" in
      hosts | open | close)
        [ "$#" -eq 4 ] || refuse
        ;;
      redis-exists)
        [ "$#" -eq 5 ] || refuse
        ;;
      *) refuse ;;
    esac
    shift 3
    exec sudo -n sh "$here/smoke-access.sh" "$@"
    ;;
  *) refuse ;;
esac
