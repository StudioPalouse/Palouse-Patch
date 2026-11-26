#!/bin/sh
# Nightly logical backup of the Patch database. Runs on a scheduled Fly
# machine (see docs/operations.md):
#
#   1. pg_dump the database (custom format) over the private network
#   2. restore the dump into a throwaway local Postgres and check it
#   3. upload it to object storage (Tigris, S3 compatible)
#   4. prune old dumps: keep 30 days of dailies and a year of monthlies
#
# Any failure exits non-zero and, if ALERT_EMAIL and RESEND_API_KEY are set,
# emails the log tail.
#
# Environment:
#   DATABASE_URL           read-only role on the Patch database (required)
#   BUCKET_NAME            bucket to upload to (required; set by `fly storage create`)
#   AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_ENDPOINT_URL_S3, AWS_REGION
#                          object storage credentials (set by `fly storage create`)
#   BACKUP_PREFIX          key prefix, default "patch"
#   KEEP_DAILY_DAYS        default 30
#   KEEP_MONTHLY_DAYS      default 365
#   ALERT_EMAIL            where to send failure alerts (optional)
#   RESEND_API_KEY         Resend key for alerts (optional)
#   MAIL_FROM              alert sender, default "Patch backups <patch@palouse.ai>"
#   RESEND_URL             default https://api.resend.com/emails (override for testing)
set -eu
set -o pipefail

PREFIX="${BACKUP_PREFIX:-patch}"
KEEP_DAILY_DAYS="${KEEP_DAILY_DAYS:-30}"
KEEP_MONTHLY_DAYS="${KEEP_MONTHLY_DAYS:-365}"
WORK="$(mktemp -d)"
LOG="$WORK/backup.log"
export HOME="$WORK"

log() { echo "[backup] $(date -u +%FT%TZ) $*"; }

days_ago() { date -u -d "@$(($(date -u +%s) - $1 * 86400))" +%F; }

restore_check() {
  dump="$1"
  pgdata="$WORK/pgdata"
  log "restore check: starting a throwaway Postgres"
  # initdb is noisy about missing locales on Alpine; only show its output on failure.
  initdb -D "$pgdata" -U postgres --auth=trust --no-locale --encoding=UTF8 >"$WORK/initdb.log" 2>&1 || {
    cat "$WORK/initdb.log"
    return 1
  }
  pg_ctl -D "$pgdata" -o "-c listen_addresses='' -k $WORK -c fsync=off" -w -l "$WORK/pg.log" start >/dev/null
  # Stop it however this function exits.
  trap 'pg_ctl -D "$pgdata" -m immediate stop >/dev/null 2>&1 || true' EXIT
  createdb -h "$WORK" -U postgres restore_check
  pg_restore -h "$WORK" -U postgres -d restore_check --no-owner --no-privileges --exit-on-error "$dump"

  q() { psql -h "$WORK" -U postgres -d restore_check -XAtc "$1"; }
  tables=$(q "select count(*) from pg_tables where schemaname = 'public'")
  migrations=$(q "select count(*) from drizzle.__drizzle_migrations")
  [ "$tables" -gt 0 ] || { log "restore check: no tables restored"; return 1; }
  [ "$migrations" -gt 0 ] || { log "restore check: no migrations recorded"; return 1; }
  log "restore check: ok ($tables tables, $migrations migrations;" \
    "$(q "select count(*) from organization") orgs," \
    "$(q "select count(*) from \"user\"") users," \
    "$(q "select count(*) from systems") systems)"
  pg_ctl -D "$pgdata" -m fast stop >/dev/null
  trap - EXIT
}

prune() {
  daily_cutoff=$(days_ago "$KEEP_DAILY_DAYS")
  monthly_cutoff=$(days_ago "$KEEP_MONTHLY_DAYS")
  keys=$(aws s3api list-objects-v2 --bucket "$BUCKET_NAME" --prefix "$PREFIX/" --query 'Contents[].Key' --output text)
  pruned=0
  for key in $keys; do
    [ "$key" = "None" ] && continue
    # Keys look like patch/patch-2026-11-26T030000Z.dump
    day=$(basename "$key" | sed -n 's/^.*-\([0-9]\{4\}-[0-9]\{2\}-[0-9]\{2\}\)T.*\.dump$/\1/p')
    [ -n "$day" ] || continue
    [ "$day" \< "$daily_cutoff" ] || continue
    # Dumps from the 1st of the month are kept as monthlies.
    if [ "${day#*-*-}" = "01" ] && ! [ "$day" \< "$monthly_cutoff" ]; then continue; fi
    aws s3 rm --only-show-errors "s3://$BUCKET_NAME/$key"
    pruned=$((pruned + 1))
  done
  log "pruned $pruned old dump(s)"
}

main() {
  : "${DATABASE_URL:?DATABASE_URL is required}"
  : "${BUCKET_NAME:?BUCKET_NAME is required}"
  stamp=$(date -u +%FT%H%M%SZ)
  dump="$WORK/patch-$stamp.dump"

  log "dumping database"
  pg_dump --format=custom --no-owner --no-privileges --dbname="$DATABASE_URL" --file="$dump"
  [ -s "$dump" ] || { log "pg_dump produced an empty file"; return 1; }
  log "dump is $(du -h "$dump" | cut -f1)"

  restore_check "$dump"

  key="$PREFIX/patch-$stamp.dump"
  log "uploading to s3://$BUCKET_NAME/$key"
  aws s3 cp --only-show-errors "$dump" "s3://$BUCKET_NAME/$key"

  prune
  log "done"
}

alert() {
  if [ -z "${ALERT_EMAIL:-}" ] || [ -z "${RESEND_API_KEY:-}" ]; then
    log "no ALERT_EMAIL/RESEND_API_KEY set; not sending an alert"
    return
  fi
  body=$(jq -n \
    --arg from "${MAIL_FROM:-Patch backups <patch@palouse.ai>}" \
    --arg to "$ALERT_EMAIL" \
    --arg subject "Patch database backup failed" \
    --arg text "The nightly Patch database backup failed. Last lines of the log:

$(tail -n 40 "$LOG")

See docs/operations.md (Backups) and: fly logs -a palouse-patch-backup" \
    '{from: $from, to: [$to], subject: $subject, text: $text}')
  curl -fsS -X POST "${RESEND_URL:-https://api.resend.com/emails}" \
    -H "Authorization: Bearer $RESEND_API_KEY" \
    -H "Content-Type: application/json" \
    -d "$body" >/dev/null && log "alert sent to $ALERT_EMAIL" || log "could not send the alert"
}

# Run main as a plain command, not as an `if` condition: shells switch off
# `set -e` inside conditions (subshells included), which would let a failed
# dump carry on and be uploaded. pipefail makes the pipeline report main's status.
set +e
(
  set -e
  main
) 2>&1 | tee "$LOG"
status=$?
set -e
if [ "$status" -eq 0 ]; then
  rm -rf "$WORK"
  exit 0
fi
log "backup FAILED (exit $status)" | tee -a "$LOG"
alert
exit 1
