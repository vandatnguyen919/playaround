#!/bin/sh
# Manages the root-owned .env next to compose.prod.yml on the VM. Run with sudo.
# Secrets are made here and stay here: nothing is printed or passed as an argument.
#
#   vm-env.sh init <app-host> <auth-host> <smtp-from> <acme-email> <image-sha>
#   vm-env.sh set-smtp-password      prompts for the Resend API key, hidden
#   vm-env.sh set-acme-production    switches Let's Encrypt from staging to production
#   vm-env.sh set-backup-url <url>   where backup.sh writes (Terraform: backup_container_url)
#   vm-env.sh drill-env <file>       env for the scratch stack in RESTORE.md: the live
#                                    images, fresh secrets, placeholder mail
set -eu
umask 077
ENV_FILE="$(dirname "$0")/.env"

secret() { openssl rand -hex 32; }

set_value() {
  # awk reads the value from the environment, so it never shows in ps.
  VALUE="$2" awk -v key="$1" '
    BEGIN { FS = OFS = "="; done = 0 }
    $1 == key { print key "=" ENVIRON["VALUE"]; done = 1; next }
    { print }
    END { if (!done) print key "=" ENVIRON["VALUE"] }
  ' "$ENV_FILE" > "$ENV_FILE.tmp"
  chmod 600 "$ENV_FILE.tmp"
  mv "$ENV_FILE.tmp" "$ENV_FILE"
}

case "${1:-}" in
  init)
    [ "$#" -eq 6 ] || { echo "usage: vm-env.sh init <app-host> <auth-host> <smtp-from> <acme-email> <image-sha>" >&2; exit 2; }
    # A new database password would lock Keycloak out of the existing database.
    [ ! -e "$ENV_FILE" ] || { echo "$ENV_FILE exists, not overwriting it" >&2; exit 1; }
    domain="${4#*@}"
    cat > "$ENV_FILE" <<EOF
APP_HOST=$2
AUTH_HOST=$3
ACME_EMAIL=$5
KEYCLOAK_IMAGE=ghcr.io/vandatnguyen919/playground-keycloak:sha-$6
GATEWAY_IMAGE=ghcr.io/vandatnguyen919/playground-gateway:sha-$6
API_IMAGE=ghcr.io/vandatnguyen919/playground-api:sha-$6
KC_DB_PASSWORD=$(secret)
KC_BOOTSTRAP_ADMIN_USERNAME=admin
KC_BOOTSTRAP_ADMIN_PASSWORD=$(secret)
KC_CONFIG_CLIENT_ID=keycloak-config
KC_CONFIG_CLIENT_SECRET=$(secret)
REDIS_PASSWORD=$(secret)
GATEWAY_CLIENT_SECRET=$(secret)
GOOGLE_CLIENT_ID=google-client-id-not-configured
GOOGLE_CLIENT_SECRET=google-client-secret-not-configured
GITHUB_CLIENT_ID=github-client-id-not-configured
GITHUB_CLIENT_SECRET=github-client-secret-not-configured
SMTP_HOST=smtp.resend.com
SMTP_PORT=587
SMTP_FROM=$4
SMTP_USER=resend
SMTP_PASSWORD=not-set-yet
MAIL_DKIM_SELECTOR=resend
MAIL_SPF_HOST=rsend.$domain
MAIL_SPF_INCLUDE=amazonses.com
EOF
    chown root:root "$ENV_FILE"
    chmod 600 "$ENV_FILE"
    echo "wrote $ENV_FILE"
    ;;
  set-smtp-password)
    printf 'Resend API key (hidden): ' >&2
    stty -echo
    IFS= read -r key || key=""
    stty echo
    echo >&2
    case "$key" in
      re_*) ;;
      *) echo "that does not look like a Resend key (re_...), nothing changed" >&2; exit 1 ;;
    esac
    set_value SMTP_PASSWORD "$key"
    echo "SMTP_PASSWORD updated. Claude or you can now rerun keycloak-config." >&2
    ;;
  set-acme-production)
    set_value ACME_CA_SERVER https://acme-v02.api.letsencrypt.org/directory
    ;;
  set-backup-url)
    case "${2:-}" in
      https://*.blob.core.windows.net/*) ;;
      *) echo "usage: vm-env.sh set-backup-url https://<account>.blob.core.windows.net/<container>" >&2; exit 2 ;;
    esac
    set_value BACKUP_CONTAINER_URL "$2"
    ;;
  drill-env)
    [ -n "${2:-}" ] || { echo "usage: vm-env.sh drill-env <file>" >&2; exit 2; }
    [ ! -e "$2" ] || { echo "$2 exists, not overwriting it" >&2; exit 1; }
    {
      grep -E '^(KEYCLOAK|GATEWAY|API)_IMAGE=' "$ENV_FILE"
      # Required by compose.prod.yml, unused or overridden in the drill.
      cat <<EOF
APP_HOST=drill.invalid
AUTH_HOST=drill.invalid
GOOGLE_CLIENT_ID=not-configured
GOOGLE_CLIENT_SECRET=not-configured
GITHUB_CLIENT_ID=not-configured
GITHUB_CLIENT_SECRET=not-configured
SMTP_HOST=drill.invalid
SMTP_FROM=no-reply@drill.invalid
SMTP_USER=none
SMTP_PASSWORD=none
KC_BOOTSTRAP_ADMIN_USERNAME=drill-admin
KC_CONFIG_CLIENT_ID=keycloak-config-recovery
KC_DB_PASSWORD=$(secret)
KC_BOOTSTRAP_ADMIN_PASSWORD=$(secret)
KC_CONFIG_CLIENT_SECRET=$(secret)
REDIS_PASSWORD=$(secret)
GATEWAY_CLIENT_SECRET=$(secret)
EOF
    } > "$2"
    chmod 600 "$2"
    echo "wrote $2"
    ;;
  *)
    sed -n '2,10p' "$0" >&2
    exit 2
    ;;
esac
