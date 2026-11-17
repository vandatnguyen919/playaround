#!/bin/sh
# Nightly backup to Azure Blob: the Keycloak database, and once KeyLab runs, the KeyLab
# database and its uploaded files. Run with sudo on the VM.
# Runbook, decisions and measured numbers: RESTORE.md.
#
#   backup.sh install              installs azcopy on the data disk and the timers
#   backup.sh run                  dumps, checks and uploads; the nightly timer calls this
#   backup.sh report               publishes the oldest "newest backup" age; the hourly timer calls this
#   backup.sh list                 lists the backups in Blob
#   backup.sh fetch <file> [keycloak|keylab|files|<blob>]
#                                  downloads the newest of that kind (default keycloak), or the named blob
#   backup.sh restore <file> <container> <db>
#                                  pg_restore into an EMPTY database, never over data
#   backup.sh restore-files <file> [volume]
#                                  unpacks a files archive into an EMPTY KeyLab files volume
#
# KeyLab counts as running when .env has KEYLAB_DB_PASSWORD. From then on a night
# without its dump or its files is a failed night.
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
KEYLAB_API="${BACKUP_KEYLAB_API:-playground-prod-keylab-api-1}"
FILES_VOLUME="${BACKUP_FILES_VOLUME:-playground-prod_keylab-files}"
# Has busybox tar and is always on the VM. Used to read and fill the files volume.
TOOL_IMAGE=postgres:18.6-alpine
# On the data disk, so a rebuilt VM keeps it and the dump never lands on the OS disk.
ROOT="${BACKUP_ROOT:-/srv/playground}"
AZCOPY="$ROOT/bin/azcopy"
AZCOPY_VERSION=10.34.1
AZCOPY_SHA256=2a91849116c7c2b7497fbed2c6af63d625119110bc758a8798310f5fc7176cea
PREFIX=postgres
FILES_PREFIX=keylab-files
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

keylab_running() { grep -q '^KEYLAB_DB_PASSWORD=.' "$ENV_FILE"; }

# What a night must leave in Blob.
kinds() {
  echo keycloak
  ! keylab_running || printf '%s\n' keylab files
}

# keycloak-<stamp>.dump, keylab-<stamp>.dump, keylab-files-<stamp>.tar.gz
blob_name() { # kind stamp
  case "$1" in
    files) echo "keylab-files-$2.tar.gz" ;;
    *) echo "$1-$2.dump" ;;
  esac
}

folder_of() { # blob name
  case "$1" in
    keylab-files-*) echo "$FILES_PREFIX" ;;
    *) echo "$PREFIX" ;;
  esac
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

# Newest blob of one kind by the UTC stamp in the name. Empty if there are none.
newest() { # kind
  name="$(blob_name "$1" STAMP)"
  pattern="$(printf '%s' "$name" | sed 's/\./\\./g; s/STAMP/[0-9]{8}T[0-9]{6}Z/')"
  listing="$(azcopy list "$(container_url)/$(folder_of "$name")/")" || return 1
  printf '%s\n' "$listing" | grep -Eo "$pattern" | sort | tail -n 1 || true
}

age_hours() {
  # keycloak-20261105T190000Z.dump -> 2026-11-05 19:00:00 UTC
  stamp="$(printf '%s' "$1" | sed -E 's/^.*-([0-9]{4})([0-9]{2})([0-9]{2})T([0-9]{2})([0-9]{2})([0-9]{2})Z\..*$/\1-\2-\3 \4:\5:\6/')"
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

# The oldest of the newest backup of each kind, so one alert catches any kind missing.
oldest_newest_age() {
  worst=0
  for kind in $(kinds); do
    if name="$(newest "$kind")" && [ -n "$name" ]; then
      age="$(age_hours "$name")"
      log "newest $kind is $name, $age hours old" >&2
    else
      # A lost role, a firewall change or an empty container: all count as failed.
      age="$AGE_UNKNOWN"
      log "no readable $kind backup in Blob" >&2
    fi
    worst="$(awk -v a="$age" -v w="$worst" 'BEGIN { print (a + 0 > w + 0) ? a : w }')"
  done
  echo "$worst"
}

cmd_report() {
  make_work
  age="$(oldest_newest_age)"
  log "reporting age $age"
  publish_age "$age"
}

upload() { # local-file blob-name
  azcopy copy "$1" "$(container_url)/$(folder_of "$2")/$2" --overwrite=false --put-md5 --output-level=essential \
    || die "upload of $2 failed"
  log "uploaded $2, $(wc -c < "$1") bytes"
}

# One snapshot of a live database, so the apps stay up. A dump that pg_restore cannot
# read, or one without the table that matters, is no backup and is not uploaded.
dump_db() { # db must-have-line blob-name
  dump="$WORK/$3"
  docker exec "$POSTGRES" pg_dump -U keycloak -d "$1" -Fc > "$dump" || die "pg_dump of $1 failed"
  contents="$(docker exec -i "$POSTGRES" pg_restore --list < "$dump")" || die "pg_restore cannot read the $1 dump"
  printf '%s\n' "$contents" | grep -q "$2" || die "the $1 dump lacks '$2'"
}

# Uploads, recordings and photos, read from inside keylab-api (it owns them), as one
# archive. An archive tar cannot list is not uploaded.
archive_files() { # blob-name
  archive="$WORK/$1"
  docker exec "$KEYLAB_API" tar -czf - -C /data/keylab-storage . > "$archive" || die "archiving the KeyLab files failed"
  gzip -t "$archive" 2>/dev/null && tar -tzf "$archive" > /dev/null 2>&1 || die "the KeyLab files archive is unreadable"
}

cmd_run() {
  make_work
  container_url > /dev/null
  start="$(date -u +%s)"
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  # Each part is made and checked before anything is uploaded. The KeyLab dump and its
  # files go up together or not at all, since a restore needs both from the same night.
  # A KeyLab failure does not hold back the Keycloak dump: the run still fails, and the
  # KeyLab age keeps growing, which the alert watches.
  dump_db keycloak 'TABLE DATA public user_entity ' "$(blob_name keycloak "$stamp")"
  keylab_ok=yes
  if keylab_running; then
    (dump_db keylab 'TABLE DATA catalog switches ' "$(blob_name keylab "$stamp")") &&
      (archive_files "$(blob_name files "$stamp")") || keylab_ok=""
  fi
  for kind in $(kinds); do
    [ "$kind" = keycloak ] || [ -n "$keylab_ok" ] || continue
    name="$(blob_name "$kind" "$stamp")"
    upload "$WORK/$name" "$name"
  done
  log "done in $(($(date -u +%s) - start)) s"
  if [ -z "$keylab_ok" ]; then
    publish_age "$(oldest_newest_age)" || log "WARNING the age metric was not published"
    die "the KeyLab backup failed; only the Keycloak dump was uploaded"
  fi
  # The age metric is secondary: the backup is safe even if this call fails.
  publish_age "$(age_hours "$(blob_name keycloak "$stamp")")" || log "WARNING the age metric was not published"
}

cmd_list() {
  make_work
  azcopy list "$(container_url)/$PREFIX/"
  ! keylab_running || azcopy list "$(container_url)/$FILES_PREFIX/"
}

cmd_fetch() {
  [ "$#" -ge 1 ] || die "usage: backup.sh fetch <file> [keycloak|keylab|files|<blob>]"
  make_work
  case "${2:-keycloak}" in
    keycloak | keylab | files) name="$(newest "${2:-keycloak}")" ;;
    *) name="$2" ;;
  esac
  [ -n "$name" ] || die "no such backup in Blob"
  log "fetching $name"
  azcopy copy "$(container_url)/$(folder_of "$name")/$name" "$1" --check-md5=FailIfDifferent --output-level=essential \
    || die "download failed"
  log "age at fetch: $(age_hours "$name") hours"
}

cmd_restore() {
  [ "$#" -eq 3 ] || die "usage: backup.sh restore <file> <container> <db>"
  file="$1"; target="$2"; db="$3"
  tables="$(docker exec "$target" psql -U keycloak -d "$db" -Atc \
    "select count(*) from information_schema.tables where table_schema not in ('pg_catalog', 'information_schema')")" \
    || die "cannot read $db in $target"
  [ "$tables" = 0 ] || die "$db in $target already has $tables tables; restore only goes into an empty database"
  # keylab-api signs in as keylab, so its objects must belong to that role.
  role=""
  [ "$db" != keylab ] || role="--role=keylab"
  # shellcheck disable=SC2086
  docker exec -i "$target" pg_restore -U keycloak -d "$db" --no-owner --no-privileges $role \
    --exit-on-error --single-transaction < "$file" || die "pg_restore failed; the transaction rolled back"
  case "$db" in
    keylab) what="switches"; query="select count(*) from catalog.switches" ;;
    *) what="users"; query="select count(*) from user_entity" ;;
  esac
  log "restored into $db in $target: $(docker exec "$target" psql -U keycloak -d "$db" -Atc "$query") $what"
}

cmd_restore_files() {
  [ "$#" -ge 1 ] || die "usage: backup.sh restore-files <file> [volume]"
  file="$1"; volume="${2:-$FILES_VOLUME}"
  gzip -t "$file" 2>/dev/null || die "$file is not a gzip archive"
  # Owned by keylab-api's user afterwards, whoever created the volume.
  docker run --rm -i --network none -v "$volume:/data" --entrypoint sh "$TOOL_IMAGE" -c \
    '[ -z "$(ls -A /data)" ] || { echo "the volume is not empty; restore-files only fills an empty one" >&2; exit 1; }; tar -xzf - -C /data && chown -R 10001:10001 /data' \
    < "$file" || die "restore-files into $volume failed"
  log "restored $(tar -tzf "$file" | grep -vc '/$') files into $volume"
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
Description=Back up the Keycloak and KeyLab databases and KeyLab files to Azure Blob
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
ExecStart=/bin/sh $HERE/backup.sh run
EOF
  cat > /etc/systemd/system/backup.timer <<EOF
[Unit]
Description=Nightly backup to Azure Blob

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
  restore-files) cmd_restore_files "$@" ;;
  *) sed -n '2,18p' "$0" >&2; exit 2 ;;
esac
