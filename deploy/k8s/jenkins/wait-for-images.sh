#!/bin/sh
# Waits until gateway, api and keycloak are all published on GHCR with this tag.
# The images are public, so this needs no credentials.
#
#   wait-for-images.sh sha-<git sha>     WAIT_MINUTES=45 by default
set -eu

TAG="${1:?usage: wait-for-images.sh <tag>}"
OWNER=vandatnguyen919
IMAGES="playground-gateway playground-api playground-keycloak"
WAIT_MINUTES="${WAIT_MINUTES:-45}"
ACCEPT='application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json'

published() {
  # GHCR wants an anonymous token even for public images.
  token="$(curl -fsS --max-time 20 "https://ghcr.io/token?scope=repository:$OWNER/$1:pull" \
    | sed -E 's/.*"token":"([^"]+)".*/\1/')" || return 1
  code="$(curl -sS --max-time 20 -o /dev/null -w '%{http_code}' -I -H "Accept: $ACCEPT" \
    -H "Authorization: Bearer $token" "https://ghcr.io/v2/$OWNER/$1/manifests/$TAG")" || return 1
  [ "$code" = 200 ]
}

deadline=$(($(date +%s) + WAIT_MINUTES * 60))
while :; do
  missing=""
  for image in $IMAGES; do
    published "$image" || missing="$missing $image"
  done
  if [ -z "$missing" ]; then
    echo "all images published as $TAG"
    exit 0
  fi
  if [ "$(date +%s)" -ge "$deadline" ]; then
    echo "not published after $WAIT_MINUTES minutes:$missing ($TAG). Did CI pass on this commit?" >&2
    exit 1
  fi
  echo "waiting for$missing ($TAG)"
  sleep 60
done
