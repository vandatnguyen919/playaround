#!/bin/sh
# Points ssh at the deploy key and pins the VM's host key, so plain "ssh $VM_TARGET" and
# smoke-public.mjs work in the rest of the build. Lasts as long as the agent pod. A host
# key that does not match stops the deploy; after a VM rebuild, update VM_KNOWN_HOSTS.
set -eu
: "${VM_KEY:?}" "${VM_KNOWN_HOSTS:?}"

# ssh reads the home directory from passwd, not $HOME.
home="$(getent passwd "$(id -u)" | cut -d: -f6)"

umask 077
mkdir -p "$home/.ssh"
printf '%s\n' "$VM_KNOWN_HOSTS" > "$home/.ssh/known_hosts"
cat > "$home/.ssh/config" <<EOF
Host *
  IdentityFile $VM_KEY
  IdentitiesOnly yes
  StrictHostKeyChecking yes
  UserKnownHostsFile $home/.ssh/known_hosts
  ServerAliveInterval 30
  ServerAliveCountMax 6
EOF
