#!/usr/bin/env bash
# Major update script for the ACCSYS GCP VM (accsys.turing-drive.org / 35.229.252.237).
# Pulls latest git main on the VM, builds production app + migrator images,
# applies database migrations (0000..0044), syncs form definitions (batches 1..7),
# updates /etc/accsys/accsys.env image tags, and rolls out the compose stack.
#
# Usage:
#   ./scripts/gcp-update-vm.sh

set -euo pipefail

GCP_HOST="${GCP_HOST:-arlen@35.229.252.237}"
SSH_KEY="${GCP_SSH_KEY:-$HOME/.ssh/google_compute_engine}"
ADMIN_ACTOR="${GCP_ADMIN_ACTOR:-arlen@turing-drive.com}"

SSH_OPTS=(
  -o BatchMode=yes
  -o ConnectTimeout=20
  -o ServerAliveInterval=30
  -o ServerAliveCountMax=10
  -o StrictHostKeyChecking=accept-new
  -i "$SSH_KEY"
)

echo "=== Connecting to GCP VM ($GCP_HOST) for major update ==="

ssh "${SSH_OPTS[@]}" "$GCP_HOST" "ADMIN_ACTOR='$ADMIN_ACTOR' bash -s" <<'REMOTE'
set -euo pipefail

cd /opt/accsys
DC="sudo docker compose -f deploy/compose.prod.yml --env-file /etc/accsys/accsys.env"

echo "1) Fetching and resetting /opt/accsys to latest origin/main..."
sudo rm -f deploy/nginx/templates/accsys.conf.template.bak
sudo GIT_SSH_COMMAND='ssh -i /root/.ssh/accsys_deploy -o StrictHostKeyChecking=accept-new' \
  git fetch origin main
sudo git checkout -f main
sudo git reset --hard origin/main

COMMIT="$(sudo git rev-parse --short HEAD)"
echo "Now at commit: $COMMIT"

echo "2) Building production Docker images (accsys-app:$COMMIT, accsys-migrate:$COMMIT)..."
sudo docker build --target runner   -t "accsys-app:$COMMIT" .
sudo docker build --target migrator -t "accsys-migrate:$COMMIT" .

echo "$COMMIT" | sudo tee /srv/accsys/deployed-commit >/dev/null

echo "3) Updating /etc/accsys/accsys.env image tags to $COMMIT..."
sudo sed -i.bak \
  -e "s|^ACCSYS_APP_IMAGE=.*|ACCSYS_APP_IMAGE=accsys-app:$COMMIT|" \
  -e "s|^ACCSYS_MIGRATE_IMAGE=.*|ACCSYS_MIGRATE_IMAGE=accsys-migrate:$COMMIT|" \
  /etc/accsys/accsys.env

sudo grep -E '^(ACCSYS_APP_IMAGE|ACCSYS_MIGRATE_IMAGE|ACCSYS_FQDN|APP_ORIGIN)=' /etc/accsys/accsys.env

echo "4) Ensuring PostgreSQL is up and healthy..."
$DC up -d db
for i in $(seq 1 30); do
  health="$(sudo docker inspect -f '{{.State.Health.Status}}' $($DC ps -q db) 2>/dev/null || echo starting)"
  [ "$health" = "healthy" ] && break
  sleep 2
done

echo "5) Running database migrations..."
$DC run --rm migrate

echo "6) Refreshing db/roles.sql grants for any newly created tables..."
$DC exec -T db psql -X -U postgres -d accsys -v ON_ERROR_STOP=1 -f /accsys/roles.sql

echo "7) Syncing and publishing migrated form definitions (batches 1..7)..."
for batch in 1 2 3 4 5 6 7; do
  $DC run --rm admin-cli scripts/migrate-forms.ts --batch "$batch" --publish --allow-remote --actor "$ADMIN_ACTOR"
done

echo "8) Rolling out updated app and proxy containers..."
$DC up -d --remove-orphans

echo "9) Waiting for app container healthcheck..."
for i in $(seq 1 30); do
  health="$(sudo docker inspect -f '{{.State.Health.Status}}' $($DC ps -q app) 2>/dev/null || echo starting)"
  echo "  app health ($i): $health"
  [ "$health" = "healthy" ] && break
  sleep 3
done

$DC ps
curl -sk --http1.1 --connect-timeout 5 -o /dev/null -w "Local HTTPS /login check: HTTP %{http_code}\n" https://127.0.0.1/login -H "Host: accsys.turing-drive.org"
echo "=== GCP Major Update Complete (commit $COMMIT) ==="
REMOTE
