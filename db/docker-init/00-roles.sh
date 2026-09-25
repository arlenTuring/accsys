#!/bin/sh
# postgres image init hook (runs once, on an empty data directory).
# Creates the ACCSYS role model and sets passwords from the environment.
# Local development / test containers only; production passwords are set by
# the DBA with \password, never through compose files.
set -eu
: "${ACCSYS_MIGRATOR_PASSWORD:?}" "${ACCSYS_APP_PASSWORD:?}" "${ACCSYS_BACKUP_PASSWORD:?}"

psql -v ON_ERROR_STOP=1 -q --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -f /accsys/roles.sql

psql -v ON_ERROR_STOP=1 -q --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v migrator_pw="$ACCSYS_MIGRATOR_PASSWORD" \
  -v app_pw="$ACCSYS_APP_PASSWORD" \
  -v backup_pw="$ACCSYS_BACKUP_PASSWORD" <<'SQL'
alter role accsys_migrator password :'migrator_pw';
alter role accsys_app password :'app_pw';
alter role accsys_backup password :'backup_pw';
SQL
