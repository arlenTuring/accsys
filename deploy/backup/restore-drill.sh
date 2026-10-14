#!/bin/sh
# Restore drill: proves one backup set restores cleanly, in a throwaway
# PostgreSQL container with no network. Never touches a live database.
#
#   deploy/backup/restore-drill.sh /srv/accsys/backup/20261013T020000Z
#
# Checks: SHA256SUMS, pg_restore without errors, role grants and the
# append-only audit trigger after restore, and that every downloadable
# attachment row has its file in attachments.tar with a matching sha256.
set -eu

set_dir=$(cd "${1:?usage: restore-drill.sh <backup set directory>}" && pwd)
repo=$(cd "$(dirname "$0")/../.." && pwd)
image="${POSTGRES_IMAGE:-postgres:16.15-alpine3.24@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea}"
name="accsys-restore-drill-$$"

docker run -d --name "$name" --network none \
  -e POSTGRES_PASSWORD="$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')" \
  -e POSTGRES_DB=accsys \
  -v "$set_dir:/backup:ro" \
  -v "$repo/db/roles.sql:/accsys/roles.sql:ro" \
  "$image" > /dev/null
trap 'docker rm -f -v "$name" > /dev/null 2>&1 || true' EXIT

# The image runs a temporary server during initdb; wait for the real one.
i=0
until docker logs "$name" 2>&1 | grep -q 'init process complete' &&
  docker exec "$name" pg_isready -U postgres -d accsys > /dev/null 2>&1; do
  i=$((i + 1))
  if [ "$i" -gt 120 ]; then
    echo "restore drill: database did not start; container log:" >&2
    docker logs --tail 20 "$name" >&2
    exit 1
  fi
  sleep 1
done

docker exec -i "$name" sh -s << 'DRILL'
set -eu
cd /backup
sha256sum -c SHA256SUMS

q() { psql -X -v ON_ERROR_STOP=1 -q -U postgres -d accsys "$@"; }
q -c "create role accsys_owner nologin; create role accsys_migrator login;
      create role accsys_app login; create role accsys_backup login;"
pg_restore --exit-on-error -U postgres -d accsys /backup/accsys.dump
PGOPTIONS='-c client_min_messages=warning' q -f /accsys/roles.sql > /dev/null

psql -X -q -U accsys_app -d accsys -c 'select count(*) from employees' > /dev/null
if psql -X -q -U accsys_app -d accsys -c 'delete from audit_events where false' > /dev/null 2>&1; then
  echo "FAIL: accsys_app may delete audit_events after restore" >&2; exit 1
fi

mkdir -p /tmp/files
tar -xf /backup/attachments.tar -C /tmp/files
q -At -F ' ' -c "select storage_path, coalesce(sha256, '-') from attachments
                 where scan_status in ('clean', 'unscanned') order by storage_path" > /tmp/expected
total=0; missing=0; mismatch=0
while read -r key sum; do
  total=$((total + 1))
  if [ ! -f "/tmp/files/$key" ]; then echo "MISSING  $key"; missing=$((missing + 1)); continue; fi
  if [ "$sum" != "-" ] && [ "$(sha256sum "/tmp/files/$key" | cut -d' ' -f1)" != "$sum" ]; then
    echo "MISMATCH $key"; mismatch=$((mismatch + 1))
  fi
done < /tmp/expected

q -At -F ': ' -c "
  select 'migrations applied', count(*)::text from drizzle.__drizzle_migrations
  union all select 'employees', count(*)::text from employees
  union all select 'attachments (downloadable)', count(*)::text from attachments where scan_status in ('clean', 'unscanned')
  union all select 'audit events', count(*)::text from audit_events
  union all select 'latest audit event', coalesce(max(occurred_at)::text, '-') from audit_events"
echo "attachment files checked: $total, missing: $missing, checksum mismatch: $mismatch"
[ "$missing" -eq 0 ] && [ "$mismatch" -eq 0 ]
DRILL
echo "restore drill ok: $set_dir"
