#!/bin/sh
# Mails one line about a deploy. A mail problem is printed and never fails the build:
# it must not turn a good deploy into a rollback. Credentials arrive from the Jenkins
# store as environment variables, and go to curl through stdin, not its arguments.
set -u
: "${NOTIFY_SUBJECT:?}" "${NOTIFY_USER:?}" "${NOTIFY_PASSWORD:?}" "${NOTIFY_TO:?}" "${NOTIFY_SMTP_URL:?}" "${NOTIFY_FROM:?}"

message="$(mktemp)"
trap 'rm -f "$message"' EXIT
{
  printf 'From: %s\r\n' "$NOTIFY_FROM"
  printf 'To: %s\r\n' "$NOTIFY_TO"
  printf 'Subject: [playground] %s\r\n' "$NOTIFY_SUBJECT"
  printf 'Date: %s\r\n' "$(date -R)"
  printf 'Content-Type: text/plain; charset=utf-8\r\n\r\n'
  printf '%s\r\n\r\nBuild: %s\r\nThe Jenkins URL works through the SSH tunnel only.\r\n' "$NOTIFY_SUBJECT" "${BUILD_URL:-unknown}"
} > "$message"

# TLS is required unless the drill's Mailpit says otherwise.
tls="--ssl-reqd"
[ "${NOTIFY_PLAIN_SMTP:-}" != 1 ] || tls=""

# shellcheck disable=SC2086
if printf 'user = "%s:%s"\n' "$NOTIFY_USER" "$NOTIFY_PASSWORD" | curl -fsS --max-time 30 --config - $tls \
  --url "$NOTIFY_SMTP_URL" --mail-from "$NOTIFY_FROM" --mail-rcpt "$NOTIFY_TO" --upload-file "$message"; then
  echo "notified: $NOTIFY_SUBJECT"
else
  echo "WARNING: could not send the notification: $NOTIFY_SUBJECT" >&2
fi
exit 0
