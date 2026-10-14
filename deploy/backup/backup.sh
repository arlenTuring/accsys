#!/bin/sh
# One logical backup set: /backup/<UTC stamp>/{accsys.dump, attachments.tar, SHA256SUMS}.
# Runs inside the one-off `backup` service of deploy/compose.prod.yml
# (see docs/operations/backup-restore.md). Exits non-zero on any failure and
# leaves no half-written set behind.
set -eu
umask 077

keep_days="${BACKUP_KEEP_DAYS:-14}"
case "$keep_days" in '' | *[!0-9]* | 0*) echo "BACKUP_KEEP_DAYS must be a whole number of at least 1" >&2; exit 2 ;; esac

stamp=$(date -u +%Y%m%dT%H%M%SZ)
work="/backup/.partial-$stamp"
dest="/backup/$stamp"
mkdir "$work"
trap 'rm -rf "$work"' EXIT

PGPASSWORD=$(cat /run/secrets/backup_db_password)
export PGPASSWORD

# Database first, attachments second: every file a dumped row points to was
# written before the dump started (stored files are never rewritten).
pg_dump -h db -U accsys_backup -d accsys --format=custom --file="$work/accsys.dump"
pg_restore --list "$work/accsys.dump" > /dev/null
tar -C /data/attachments -cf "$work/attachments.tar" .
(cd "$work" && sha256sum accsys.dump attachments.tar > SHA256SUMS)

mv "$work" "$dest"
trap - EXIT

# Local retention only; the off-host copy is a separate step.
find /backup -mindepth 1 -maxdepth 1 -type d -name '20*Z' -mtime +"$keep_days" -exec rm -rf {} +
# Sets left behind by a killed run (SIGKILL skips the EXIT trap) hold full data.
find /backup -mindepth 1 -maxdepth 1 -type d -name '.partial-*' -mmin +1440 -exec rm -rf {} +
echo "backup ok: $dest"
