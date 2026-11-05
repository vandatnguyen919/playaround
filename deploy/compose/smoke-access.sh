#!/bin/sh
# The VM side of smoke-public.mjs. Run with sudo. Gives one run of the checks
# what they need without publishing anything or taking a secret off the VM,
# apart from the throwaway client secret below.
#
#   smoke-access.sh hosts              prints APP_HOST and AUTH_HOST
#   smoke-access.sh open               creates client smoke-runner, prints its secret
#   smoke-access.sh close              deletes it
#   smoke-access.sh redis-exists KEY   EXISTS on one key, the only Redis call allowed
#   smoke-access.sh address SERVICE    the private IP of gateway, for a health tunnel
#   smoke-access.sh marker EMAIL       restore drill: creates a throwaway user, prints its password
#   smoke-access.sh unmark EMAIL       deletes it
#
# SMOKE_PROJECT picks another compose project, for the drill's scratch stack.
#
# smoke-runner is limited to the playground realm: no master realm, no other
# realm. Its secret lives only in the memory of the run. If a run dies before
# close, the client stays, with a secret nobody holds; the next open replaces it.
set -eu
PROJECT="${SMOKE_PROJECT:-playground-prod}"
CLIENT=smoke-runner
KEYCLOAK="$PROJECT-keycloak-1"
REDIS="$PROJECT-redis-1"
ENV_FILE="$(dirname "$0")/.env"

kcadm() {
  docker exec "$KEYCLOAK" /opt/keycloak/bin/kcadm.sh "$@" --config /tmp/kcadm-smoke.config
}

login() {
  # shellcheck disable=SC2016
  docker exec "$KEYCLOAK" sh -c '/opt/keycloak/bin/kcadm.sh config credentials --config /tmp/kcadm-smoke.config \
    --server http://localhost:8080 --realm master \
    --client "$KC_BOOTSTRAP_ADMIN_CLIENT_ID" --secret "$KC_BOOTSTRAP_ADMIN_CLIENT_SECRET"' >/dev/null 2>&1
}

client_id() {
  kcadm get clients -r playground -q "clientId=$CLIENT" --fields id --format csv --noquotes 2>/dev/null | head -n 1
}

delete_client() {
  id="$(client_id)"
  [ -z "$id" ] || kcadm delete "clients/$id" -r playground >/dev/null 2>&1
}

case "${1:-}" in
  hosts)
    grep -E '^(APP_HOST|AUTH_HOST)=' "$ENV_FILE"
    ;;
  open)
    login
    delete_client
    id="$(kcadm create clients -r playground -s "clientId=$CLIENT" -s enabled=true -s publicClient=false \
      -s serviceAccountsEnabled=true -s standardFlowEnabled=false -s directAccessGrantsEnabled=false -i 2>/dev/null)"
    kcadm add-roles -r playground --uusername "service-account-$CLIENT" --cclientid realm-management \
      --rolename manage-users --rolename view-users --rolename query-users \
      --rolename view-realm --rolename manage-realm >/dev/null 2>&1
    kcadm get "clients/$id/client-secret" -r playground --fields value --format csv --noquotes 2>/dev/null
    ;;
  close)
    login
    delete_client
    docker exec "$KEYCLOAK" rm -f /tmp/kcadm-smoke.config
    ;;
  redis-exists)
    key="${2:-}"
    case "$key" in
      spring:session:sessions:* | playground:oidc:session:*) ;;
      *) echo "only session keys" >&2; exit 2 ;;
    esac
    printf '%s' "$key" | grep -Eq '^[A-Za-z0-9:_-]+$' || { echo "bad key" >&2; exit 2; }
    # shellcheck disable=SC2016
    docker exec "$REDIS" sh -c 'REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli --user gateway EXISTS "$0"' "$key"
    ;;
  address)
    [ "${2:-}" = gateway ] || { echo "only gateway" >&2; exit 2; }
    docker inspect -f "{{with index .NetworkSettings.Networks \"${PROJECT}_backend\"}}{{.IPAddress}}{{end}}" "$PROJECT-gateway-1"
    ;;
  marker)
    email="${2:-}"
    case "$email" in
      drill-*@example.com) ;;
      *) echo "only drill-*@example.com" >&2; exit 2 ;;
    esac
    login
    password="Drill-$(openssl rand -hex 16)"
    kcadm create users -r playground -s "username=$email" -s "email=$email" -s enabled=true \
      -s emailVerified=true -s 'attributes.fullName=["Restore Drill"]' >/dev/null 2>&1
    kcadm set-password -r playground --username "$email" --new-password "$password" >/dev/null 2>&1
    echo "$password"
    ;;
  unmark)
    email="${2:-}"
    case "$email" in
      drill-*@example.com) ;;
      *) echo "only drill-*@example.com" >&2; exit 2 ;;
    esac
    login
    id="$(kcadm get users -r playground -q "username=$email" -q exact=true --fields id --format csv --noquotes 2>/dev/null | head -n 1)"
    [ -z "$id" ] || kcadm delete "users/$id" -r playground >/dev/null 2>&1
    ;;
  *)
    sed -n '2,14p' "$0" >&2
    exit 2
    ;;
esac
