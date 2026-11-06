#!/bin/sh
# Nightly Keycloak database backup to Azure Blob. Run with sudo on the VM.
# Runbook, decisions and measured numbers: RESTORE.md.
#
#   backup.sh install              installs azcopy on the data disk and the timers
#   backup.sh run                  dumps, checks and uploads; the nightly timer calls this
#   backup.sh report               publishes the newest dump's age; the hourly timer calls this
#   backup.sh list                 lists the dumps in Blob
#   backup.sh fetch <file> [blob]  downloads the newest dump, or the named one, to <file>
#   backup.sh restore <file> <container> <db>
#                                  pg_restore into an EMPTY database, never over data
#
# Credentials: only the VM's managed identity. azcopy and the metrics call each
# ask the metadata service for a token, so nothing is stored and no token is
# passed as an argument. This script never deletes a blob: the lifecycle rule
# in Terraform does that.
set -eu
umask 077

HERE="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="${BACKUP_ENV_FILE:-$HERE/.env}"
POSTGRES="${BACKUP_POSTGRES:-playground-prod-postgres-1}"
# On the data disk, so a rebuilt VM keeps it and the dump never lands on the OS disk.
ROOT="${BACKUP_ROOT:-/srv/playground}"
AZCOPY="$ROOT/bin/azcopy"
AZCOPY_VERSION=10.34.1
AZCOPY_SHA256=2a91849116c7c2b7497fbed2c6af63d625119110bc758a8798310f5fc7176cea
PREFIX=postgres
IMDS=http://169.254.169.254/metadata
# Anything above the alert's threshold. Reported when the age cannot be known.
AGE_UNKNOWN=9999

log() { echo "backup: $*"; }
die() { echo "backup: ERROR $*" >&2; exit 1; }

container_url() {
  url="$(awk -F= '$1 == "BACKUP_CONTAINER_URL" { print substr($0, index($0, "=") + 1) }' "$ENV_FILE")"
  [ -n "$url" ] || die "BACKUP_CONTAINER_URL is not set in $ENV_FILE"
  echo "${url%/}"
}

# Logs and job plans go to the run's own work directory, so they cannot pile up.
azcopy() {
  AZCOPY_AUTO_LOGIN_TYPE=MSI AZCOPY_LOG_LOCATION="$WORK" AZCOPY_JOB_PLAN_LOCATION="$WORK" \
    "$AZCOPY" "$@" --log-level=ERROR
}

make_work() {
  mkdir -p "$ROOT/backup-work"
  WORK="$(mktemp -d "$ROOT/backup-work/run.XXXXXX")"
  trap 'rm -rf "$WORK"' EXIT
  trap 'exit 1' HUP INT TERM
}

# Newest blob name by the UTC stamp in the name. Empty if there are none.
newest() {
  listing="$(azcopy list "$(container_url)/$PREFIX/")" || return 1
  printf '%s\n' "$listing" | grep -Eo 'keycloak-[0-9]{8}T[0-9]{6}Z\.dump' | sort | tail -n 1 || true
}

age_hours() {
  # keycloak-20261105T190000Z.dump -> 2026-11-05 19:00:00 UTC
  stamp="$(printf '%s' "$1" | sed -E 's/^keycloak-([0-9]{4})([0-9]{2})([0-9]{2})T([0-9]{2})([0-9]{2})([0-9]{2})Z\.dump$/\1-\2-\3 \4:\5:\6/')"
  then_s="$(date -u -d "$stamp" +%s)"
  now_s="$(date -u +%s)"
  awk -v d="$((now_s - then_s))" 'BEGIN { printf "%.2f", d / 3600 }'
}

imds() { curl -fsS --max-time 10 -H Metadata:true "$IMDS/$1"; }

publish_age() {
  age="$1"
  token="$(imds 'identity/oauth2/token?api-version=2018-02-01&resource=https%3A%2F%2Fmonitoring.azure.com%2F' \
    | sed -E 's/.*"access_token":"([^"]+)".*/\1/')"
  resource="$(imds 'instance/compute/resourceId?api-version=2021-02-01&format=text')"
  location="$(imds 'instance/compute/location?api-version=2021-02-01&format=text')"
  now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  body="$(printf '{"time":"%s","data":{"baseData":{"metric":"BackupAgeHours","namespace":"playground/backups","dimNames":[],"series":[{"dimValues":[],"min":%s,"max":%s,"sum":%s,"count":1}]}}}' \
    "$now" "$age" "$age" "$age")"
  # The token goes through stdin, not the argument list.
  printf 'header = "Authorization: Bearer %s"\n' "$token" | curl -fsS --max-time 20 -K - \
    -H 'Content-Type: application/json' -d "$body" \
    "https://$location.monitoring.azure.com$resource/metrics" >/dev/null
}

cmd_report() {
  make_work
  if name="$(newest)" && [ -n "$name" ]; then
    age="$(age_hours "$name")"
    log "newest is $name, $age hours old"
  else
    # A lost role, a firewall change or an empty container: all count as failed.
    age="$AGE_UNKNOWN"
    log "no readable backup in Blob, reporting age $age"
  fi
  publish_age "$age"
}

cmd_run() {
  make_work
  url="$(container_url)"
  start="$(date -u +%s)"
  blob="keycloak-$(date -u +%Y%m%dT%H%M%SZ).dump"
  dump="$WORK/$blob"
  # One snapshot of a live database, so Keycloak stays up.
  docker exec "$POSTGRES" pg_dump -U keycloak -d keycloak -Fc > "$dump" || die "pg_dump failed"
  # A dump that pg_restore cannot read, or one without the users table, is no
  # backup. Nothing is uploaded, so the age keeps growing and the alert fires.
  contents="$(docker exec -i "$POSTGRES" pg_restore --list < "$dump")" || die "pg_restore cannot read the dump"
  printf '%s\n' "$contents" | grep -q 'TABLE DATA public user_entity ' || die "the dump has no user_entity data"
  azcopy copy "$dump" "$url/$PREFIX/$blob" --overwrite=false --put-md5 --output-level=essential \
    || die "upload failed"
  log "uploaded $blob, $(wc -c < "$dump") bytes in $(($(date -u +%s) - start)) s"
  # The age metric is secondary: the backup is safe even if this call fails.
  publish_age "$(age_hours "$blob")" || log "WARNING the age metric was not published"
}

cmd_list() {
  make_work
  azcopy list "$(container_url)/$PREFIX/"
}

cmd_fetch() {
  [ "$#" -ge 1 ] || die "usage: backup.sh fetch <file> [blob]"
  make_work
  name="${2:-$(newest)}"
  [ -n "$name" ] || die "no backups in Blob"
  log "fetching $name"
  azcopy copy "$(container_url)/$PREFIX/$name" "$1" --check-md5=FailIfDifferent --output-level=essential \
    || die "download failed"
  log "age at fetch: $(age_hours "$name") hours"
}

cmd_restore() {
  [ "$#" -eq 3 ] || die "usage: backup.sh restore <file> <container> <db>"
  file="$1"; target="$2"; db="$3"
  tables="$(docker exec "$target" psql -U keycloak -d "$db" -Atc \
    "select count(*) from information_schema.tables where table_schema = 'public'")" \
    || die "cannot read $db in $target"
  [ "$tables" = 0 ] || die "$db in $target already has $tables tables; restore only goes into an empty database"
  docker exec -i "$target" pg_restore -U keycloak -d "$db" --no-owner --no-privileges \
    --exit-on-error --single-transaction < "$file" || die "pg_restore failed; the transaction rolled back"
  log "restored into $db in $target: $(docker exec "$target" psql -U keycloak -d "$db" -Atc 'select count(*) from user_entity') users"
}

cmd_install() {
  [ -n "$(container_url)" ]
  if [ ! -x "$AZCOPY" ] || ! "$AZCOPY" --version | grep -q "$AZCOPY_VERSION"; then
    make_work
    archive="azcopy_linux_arm64_$AZCOPY_VERSION.tar.gz"
    curl -fsSL --max-time 300 -o "$WORK/$archive" \
      "https://github.com/Azure/azure-storage-azcopy/releases/download/v$AZCOPY_VERSION/$archive"
    echo "$AZCOPY_SHA256  $WORK/$archive" | sha256sum -c - >/dev/null || die "azcopy checksum mismatch"
    tar -xzf "$WORK/$archive" -C "$WORK" --strip-components=1
    install -D -m 0755 "$WORK/azcopy" "$AZCOPY"
  fi
  # 19:00 UTC is 02:00 in Vietnam, before the 20:00 reboot window. Persistent
  # runs a missed night as soon as the VM is back.
  cat > /etc/systemd/system/backup.service <<EOF
[Unit]
Description=Back up the Keycloak database to Azure Blob
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
ExecStart=/bin/sh $HERE/backup.sh run
EOF
  cat > /etc/systemd/system/backup.timer <<EOF
[Unit]
Description=Nightly Keycloak database backup

[Timer]
OnCalendar=*-*-* 19:00:00 UTC
Persistent=true

[Install]
WantedBy=timers.target
EOF
  cat > /etc/systemd/system/backup-report.service <<EOF
[Unit]
Description=Publish the age of the newest backup to Azure Monitor

[Service]
Type=oneshot
ExecStart=/bin/sh $HERE/backup.sh report
EOF
  cat > /etc/systemd/system/backup-report.timer <<EOF
[Unit]
Description=Hourly backup age metric

[Timer]
OnBootSec=5min
OnUnitActiveSec=1h

[Install]
WantedBy=timers.target
EOF
  systemctl daemon-reload
  systemctl enable --now backup.timer backup-report.timer
  log "installed; next run: $(systemctl show backup.timer -p NextElapseUSecRealtime --value)"
}

command="${1:-}"
[ "$#" -eq 0 ] || shift
case "$command" in
  install) cmd_install ;;
  run) cmd_run ;;
  report) cmd_report ;;
  list) cmd_list ;;
  fetch) cmd_fetch "$@" ;;
  restore) cmd_restore "$@" ;;
  *) sed -n '2,11p' "$0" >&2; exit 2 ;;
esac
