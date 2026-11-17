#!/bin/sh
# Offline checks for backup.sh: every way it can fail must upload nothing and
# leave the age growing. Stubs docker, azcopy and curl, so it needs no Azure.
# Real Postgres and the real restore are covered by the drill in RESTORE.md.
#
#   docker run --rm -v "$PWD/deploy/compose:/c:ro" ubuntu:24.04 sh /c/backup.test.sh
#
# (ubuntu:24.04 for the VM's GNU date and sed; Git Bash needs MSYS_NO_PATHCONV=1.)
set -u

T="$(mktemp -d)"
export BACKUP_ROOT="$T/root" BACKUP_ENV_FILE="$T/env" STUB_LOG="$T/calls" STUB_BLOBS="$T/blobs" STUB_FILES="$T/files"
mkdir -p "$BACKUP_ROOT/bin" "$T/stubs" "$STUB_BLOBS" "$STUB_FILES/recordings"
echo "RIFF" > "$STUB_FILES/recordings/take-1.wav"
echo "BACKUP_CONTAINER_URL=https://acct.blob.core.windows.net/backups" > "$BACKUP_ENV_FILE"
# The same .env once KeyLab runs.
KEYLAB_ENV="$T/env-keylab"
printf 'BACKUP_CONTAINER_URL=https://acct.blob.core.windows.net/backups\nKEYLAB_DB_PASSWORD=x\n' > "$KEYLAB_ENV"

cat > "$BACKUP_ROOT/bin/azcopy" <<'EOF'
#!/bin/sh
echo "azcopy $*" >> "$STUB_LOG"
case "$1" in
  list)
    [ -z "${FAIL_LIST:-}" ] || exit 1
    ls "$STUB_BLOBS" | sed 's/$/; Content Length: 1 MiB/' ;;
  copy)
    [ -z "${FAIL_UPLOAD:-}" ] || exit 1
    case "$3" in
      https://*) cp "$2" "$STUB_BLOBS/$(basename "$3")" ;;
      *) cp "$STUB_BLOBS/$(basename "$2")" "$3" ;;
    esac ;;
esac
EOF

cat > "$T/stubs/docker" <<'EOF'
#!/bin/sh
echo "docker $*" >> "$STUB_LOG"
for a in "$@"; do
  case "$a" in
    pg_dump)
      [ -z "${FAIL_DUMP:-}" ] || exit 1
      case " $* " in *" -d keylab "*) [ -z "${FAIL_KEYLAB_DUMP:-}" ] || exit 1; echo "keylab-dump-bytes" ;; *) echo "dump-bytes" ;; esac
      exit 0 ;;
    pg_restore)
      case " $* " in
        *" --list "*)
          dump="$(cat)"
          [ -z "${FAIL_LIST_DUMP:-}" ] || exit 1
          case "$dump" in
            keylab-*) [ -n "${NO_SWITCHES:-}" ] || echo "1; 0 0 TABLE DATA catalog switches keylab" ;;
            *) [ -n "${NO_USERS:-}" ] || echo "1; 0 0 TABLE DATA public user_entity keycloak" ;;
          esac
          exit 0 ;;
        *) cat >/dev/null; echo "RESTORED" >> "$STUB_LOG"; exit 0 ;;
      esac ;;
    psql) case "$*" in *information_schema*) echo "${TABLES:-0}" ;; *) echo 7 ;; esac; exit 0 ;;
    # docker exec <keylab-api> tar -czf - -C /data/keylab-storage .  (a real archive)
    tar)
      [ -z "${FAIL_FILES:-}" ] || exit 1
      [ -z "${BAD_ARCHIVE:-}" ] || { echo "not an archive"; exit 0; }
      exec tar -czf - -C "$STUB_FILES" . ;;
    # docker run ... restore-files: reads the archive, refuses a full volume.
    run) cat >/dev/null; [ -z "${VOLUME_FULL:-}" ] || exit 1; echo "FILES_RESTORED" >> "$STUB_LOG"; exit 0 ;;
  esac
done
EOF

cat > "$T/stubs/curl" <<'EOF'
#!/bin/sh
stdin_token=""
case " $* " in *" -K - "*) stdin_token="$(cat)" ;; esac
case "$*" in
  *identity/oauth2/token*) echo '{"access_token":"tok123","expires_in":"3600"}' ;;
  *resourceId*) echo "/subscriptions/s/resourceGroups/r/providers/Microsoft.Compute/virtualMachines/v" ;;
  *compute/location*) echo southeastasia ;;
  *monitoring.azure.com*)
    [ -z "${FAIL_METRIC:-}" ] || exit 22
    echo "curl $*" >> "$STUB_LOG"
    echo "stdin $stdin_token" >> "$STUB_LOG" ;;
esac
EOF
chmod +x "$BACKUP_ROOT/bin/azcopy" "$T/stubs/docker" "$T/stubs/curl"
export PATH="$T/stubs:$PATH"

SCRIPT="$(dirname "$0")/backup.sh"
pass=0; fail=0
ok() { pass=$((pass + 1)); echo "PASS  $1"; }
no() { fail=$((fail + 1)); echo "FAIL  $1"; }
check() { if eval "$2"; then ok "$1"; else no "$1"; fi; }
reset() { rm -f "$STUB_BLOBS"/* ; : > "$STUB_LOG"; }
uploads() { grep -c '^azcopy copy .*https://' "$STUB_LOG"; }
blobs() { ls "$STUB_BLOBS" | wc -l; }
leftovers() { find "$BACKUP_ROOT/backup-work" -mindepth 1 | wc -l; }
metric() { grep -Eo '"max":[0-9.]+' "$STUB_LOG" | tail -n 1 | cut -d: -f2; }

# The good night.
reset; sh "$SCRIPT" run >/dev/null 2>&1; rc=$?
check "run: exits 0" "[ $rc = 0 ]"
check "run: one blob under postgres/" "grep -q 'https://acct.blob.core.windows.net/backups/postgres/keycloak-.*dump' '$STUB_LOG' && [ $(blobs) = 1 ]"
check "run: never overwrites a blob" "grep -q -- '--overwrite=false' '$STUB_LOG'"
check "run: stores an MD5 for the restore to check" "grep -q -- '--put-md5' '$STUB_LOG'"
check "run: asks for the custom format" "grep -q 'pg_dump -U keycloak -d keycloak -Fc' '$STUB_LOG'"
check "run: leaves no dump behind" "[ $(leftovers) = 0 ]"
check "run: publishes a fresh age" "awk 'BEGIN { exit !(\"$(metric)\" + 0 < 0.1) }'"
check "run: the token is not in the arguments" "! grep -q '^curl .*tok123' '$STUB_LOG' && grep -q 'stdin header = \"Authorization: Bearer tok123\"' '$STUB_LOG'"
check "run: posts to the VM's regional metrics endpoint" "grep -q 'https://southeastasia.monitoring.azure.com/subscriptions/s/.*/virtualMachines/v/metrics' '$STUB_LOG'"

# Every failure uploads nothing and exits nonzero, so systemd shows it failed.
for case_ in FAIL_DUMP FAIL_LIST_DUMP NO_USERS; do
  reset; env "$case_=1" sh "$SCRIPT" run >/dev/null 2>&1; rc=$?
  check "$case_: exits nonzero" "[ $rc != 0 ]"
  check "$case_: uploads nothing" "[ $(uploads) = 0 ] && [ $(blobs) = 0 ]"
  check "$case_: leaves no dump behind" "[ $(leftovers) = 0 ]"
done
reset; FAIL_UPLOAD=1 sh "$SCRIPT" run >/dev/null 2>&1; rc=$?
check "FAIL_UPLOAD: exits nonzero" "[ $rc != 0 ]"
check "FAIL_UPLOAD: leaves no dump behind" "[ $(leftovers) = 0 ]"

# The backup is what matters: a metrics outage must not fail a good upload.
reset; FAIL_METRIC=1 sh "$SCRIPT" run >/dev/null 2>&1; rc=$?
check "FAIL_METRIC: the backup still succeeds" "[ $rc = 0 ] && [ $(blobs) = 1 ]"

# Age.
reset; touch "$STUB_BLOBS/keycloak-$(date -u -d '30 hours ago' +%Y%m%dT%H%M%SZ).dump"
touch "$STUB_BLOBS/keycloak-$(date -u -d '3 hours ago' +%Y%m%dT%H%M%SZ).dump"
sh "$SCRIPT" report >/dev/null 2>&1
check "report: the newest dump decides the age" "awk 'BEGIN { a = \"$(metric)\" + 0; exit !(a > 2.9 && a < 3.1) }'"
reset; touch "$STUB_BLOBS/keycloak-$(date -u -d '30 hours ago' +%Y%m%dT%H%M%SZ).dump"
sh "$SCRIPT" report >/dev/null 2>&1
check "report: a stale dump is over the alert's 26 h" "awk 'BEGIN { exit !(\"$(metric)\" + 0 > 26) }'"
reset; sh "$SCRIPT" report >/dev/null 2>&1
check "report: an empty container is over the threshold" "[ '$(metric)' = 9999 ]"
reset; touch "$STUB_BLOBS/keycloak-20260101T000000Z.dump"; FAIL_LIST=1 sh "$SCRIPT" report >/dev/null 2>&1
check "report: an unreadable container is over the threshold" "[ '$(metric)' = 9999 ]"

# KeyLab: once .env has its password, a night is both databases and the files.
reset; BACKUP_ENV_FILE="$KEYLAB_ENV" sh "$SCRIPT" run >/dev/null 2>&1; rc=$?
check "keylab run: exits 0" "[ $rc = 0 ]"
check "keylab run: three blobs" "[ $(blobs) = 3 ]"
check "keylab run: keylab dump under postgres/" "grep -q 'backups/postgres/keylab-[0-9]\{8\}T[0-9]\{6\}Z\.dump' '$STUB_LOG'"
check "keylab run: files archive under keylab-files/" "grep -q 'backups/keylab-files/keylab-files-[0-9]\{8\}T[0-9]\{6\}Z\.tar\.gz' '$STUB_LOG'"
check "keylab run: dumps database keylab" "grep -q 'pg_dump -U keycloak -d keylab -Fc' '$STUB_LOG'"
check "keylab run: the archive holds the files" "tar -tzf \"$STUB_BLOBS\"/keylab-files-*.tar.gz | grep -q 'recordings/take-1.wav'"
check "keylab run: leaves nothing behind" "[ $(leftovers) = 0 ]"
# Any KeyLab part failing uploads no KeyLab part, still uploads the Keycloak dump, fails
# the run, and publishes the stale KeyLab age (no KeyLab blobs here: over the threshold).
for case_ in FAIL_KEYLAB_DUMP NO_SWITCHES FAIL_FILES BAD_ARCHIVE; do
  reset; env "$case_=1" BACKUP_ENV_FILE="$KEYLAB_ENV" sh "$SCRIPT" run >/dev/null 2>&1; rc=$?
  check "$case_: exits nonzero" "[ $rc != 0 ]"
  check "$case_: uploads only the keycloak dump" "[ $(uploads) = 1 ] && [ $(blobs) = 1 ] && ls '$STUB_BLOBS' | grep -q '^keycloak-'"
  check "$case_: publishes the stale KeyLab age" "[ '$(metric)' = 9999 ]"
  check "$case_: leaves nothing behind" "[ $(leftovers) = 0 ]"
done
# Before KeyLab runs, no KeyLab part is looked for.
reset; sh "$SCRIPT" run >/dev/null 2>&1
check "no keylab yet: only the keycloak dump" "[ $(blobs) = 1 ] && ! grep -q 'd keylab' '$STUB_LOG'"

# KeyLab age: the oldest of the three newest decides.
fresh="$(date -u -d '3 hours ago' +%Y%m%dT%H%M%SZ)"
reset; touch "$STUB_BLOBS/keycloak-$fresh.dump" "$STUB_BLOBS/keylab-$fresh.dump" "$STUB_BLOBS/keylab-files-$fresh.tar.gz"
BACKUP_ENV_FILE="$KEYLAB_ENV" sh "$SCRIPT" report >/dev/null 2>&1
check "keylab report: all fresh, about 3 h" "awk 'BEGIN { a = \"$(metric)\" + 0; exit !(a > 2.9 && a < 3.1) }'"
reset; touch "$STUB_BLOBS/keycloak-$fresh.dump" "$STUB_BLOBS/keylab-files-$fresh.tar.gz"
BACKUP_ENV_FILE="$KEYLAB_ENV" sh "$SCRIPT" report >/dev/null 2>&1
check "keylab report: no keylab dump is over the threshold" "[ '$(metric)' = 9999 ]"
reset; touch "$STUB_BLOBS/keycloak-$fresh.dump" "$STUB_BLOBS/keylab-$fresh.dump"
touch "$STUB_BLOBS/keylab-files-$(date -u -d '30 hours ago' +%Y%m%dT%H%M%SZ).tar.gz"
BACKUP_ENV_FILE="$KEYLAB_ENV" sh "$SCRIPT" report >/dev/null 2>&1
check "keylab report: stale files are over 26 h" "awk 'BEGIN { exit !(\"$(metric)\" + 0 > 26) }'"
reset; touch "$STUB_BLOBS/keycloak-$fresh.dump"
sh "$SCRIPT" report >/dev/null 2>&1
check "report before keylab: keycloak alone decides" "awk 'BEGIN { a = \"$(metric)\" + 0; exit !(a > 2.9 && a < 3.1) }'"

# fetch picks the newest of the kind asked for, from its own folder.
reset; touch "$STUB_BLOBS/keylab-20261101T190000Z.dump" "$STUB_BLOBS/keylab-20261102T190000Z.dump" "$STUB_BLOBS/keycloak-20261103T190000Z.dump"
BACKUP_ENV_FILE="$KEYLAB_ENV" sh "$SCRIPT" fetch "$T/f.dump" keylab >/dev/null 2>&1
check "fetch keylab: the newest keylab dump" "grep -q 'azcopy copy https://.*/postgres/keylab-20261102T190000Z.dump' '$STUB_LOG'"
reset; touch "$STUB_BLOBS/keylab-files-20261102T190000Z.tar.gz"
BACKUP_ENV_FILE="$KEYLAB_ENV" sh "$SCRIPT" fetch "$T/f.tgz" files >/dev/null 2>&1
check "fetch files: from keylab-files/" "grep -q 'azcopy copy https://.*/keylab-files/keylab-files-20261102T190000Z.tar.gz' '$STUB_LOG'"

# Restore refuses a database with data in it.
reset; touch "$T/d.dump"; TABLES=92 sh "$SCRIPT" restore "$T/d.dump" pg keycloak >/dev/null 2>&1; rc=$?
check "restore: refuses a database that has tables" "[ $rc != 0 ] && ! grep -q RESTORED '$STUB_LOG'"
reset; TABLES=0 sh "$SCRIPT" restore "$T/d.dump" pg keycloak >/dev/null 2>&1; rc=$?
check "restore: goes into an empty database" "[ $rc = 0 ] && grep -q RESTORED '$STUB_LOG'"
check "restore: all or nothing" "grep -q -- '--single-transaction' '$STUB_LOG' && grep -q -- '--exit-on-error' '$STUB_LOG'"
check "restore keycloak: keeps its owner" "! grep -q -- '--role=' '$STUB_LOG'"
reset; TABLES=0 sh "$SCRIPT" restore "$T/d.dump" pg keylab >/dev/null 2>&1; rc=$?
check "restore keylab: objects belong to role keylab" "[ $rc = 0 ] && grep -q 'pg_restore -U keycloak -d keylab .*--role=keylab' '$STUB_LOG'"
reset; TABLES=40 sh "$SCRIPT" restore "$T/d.dump" pg keylab >/dev/null 2>&1; rc=$?
check "restore keylab: refuses a database with tables in any schema" "[ $rc != 0 ] && grep -q \"table_schema not in\" '$STUB_LOG' && ! grep -q RESTORED '$STUB_LOG'"

# restore-files fills an empty volume only, from a real archive.
tar -czf "$T/files.tgz" -C "$STUB_FILES" .
reset; sh "$SCRIPT" restore-files "$T/files.tgz" >/dev/null 2>&1; rc=$?
check "restore-files: fills an empty volume" "[ $rc = 0 ] && grep -q FILES_RESTORED '$STUB_LOG' && grep -q 'playground-prod_keylab-files:/data' '$STUB_LOG'"
reset; VOLUME_FULL=1 sh "$SCRIPT" restore-files "$T/files.tgz" >/dev/null 2>&1; rc=$?
check "restore-files: refuses a volume with files" "[ $rc != 0 ]"
reset; sh "$SCRIPT" restore-files "$T/d.dump" >/dev/null 2>&1; rc=$?
check "restore-files: refuses what is not an archive" "[ $rc != 0 ] && ! grep -q '^docker run' '$STUB_LOG'"

# The script holds no way to remove a blob.
check "no delete: backup.sh never calls azcopy remove" "! grep -Eq 'azcopy\" *(rm|remove)|\\\$AZCOPY\" +(rm|remove)' '$SCRIPT'"

rm -rf "$T"
echo
echo "$pass passed, $fail failed"
[ "$fail" = 0 ]
