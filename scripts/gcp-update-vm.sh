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

ssh "${SSH_OPTS[@]}" "$GCP_HOST" "cat > /tmp/gcp-update-inner.sh && chmod +x /tmp/gcp-update-inner.sh && ADMIN_ACTOR='$ADMIN_ACTOR' bash /tmp/gcp-update-inner.sh" <<'REMOTE'
#!/usr/bin/env bash
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

echo "1b) Preparing disk space on boot disk (/) and ensuring Docker + Containerd live on 100GB /srv/accsys..."
df -h / /srv/accsys || true
sudo apt-get clean || true
sudo journalctl --vacuum-size=50M || true
sudo rm -rf /var/lib/docker.old /tmp/npm-* /tmp/v8-* /root/.npm /root/.cache 2>/dev/null || true

# Ensure both /var/lib/docker and /var/lib/containerd are backed by /srv/accsys (98GB disk)
NEEDS_DOCKER_RESTART=0
for dir in docker containerd; do
  if ! [ -L "/var/lib/$dir" ]; then
    NEEDS_DOCKER_RESTART=1
  fi
done

if [ "$NEEDS_DOCKER_RESTART" -eq 1 ]; then
  echo "Migrating /var/lib/docker and /var/lib/containerd to /srv/accsys (98GB data disk)..."
  sudo systemctl stop docker.socket docker containerd || true
  for dir in docker containerd; do
    sudo mkdir -p "/srv/accsys/$dir"
    if [ -d "/var/lib/$dir" ] && ! [ -L "/var/lib/$dir" ]; then
      sudo cp -a "/var/lib/$dir/." "/srv/accsys/$dir/" 2>/dev/null || true
      sudo rm -rf "/var/lib/$dir"
    fi
    sudo ln -sfn "/srv/accsys/$dir" "/var/lib/$dir"
  done
  sudo mkdir -p /etc/docker
  echo '{"data-root":"/srv/accsys/docker","log-driver":"json-file","log-opts":{"max-size":"10m","max-file":"3"}}' | sudo tee /etc/docker/daemon.json >/dev/null
  sudo systemctl start containerd docker
fi

sudo mkdir -p /srv/accsys/tmp /srv/accsys/root-docker
if [ ! -L /root/.docker ]; then
  sudo rm -rf /root/.docker
  sudo ln -s /srv/accsys/root-docker /root/.docker
fi
sudo docker builder prune -af >/dev/null 2>&1 || true
df -h / /srv/accsys || true

echo "2) Ensuring production Docker images (accsys-app:$COMMIT, accsys-migrate:$COMMIT)..."
if sudo docker image inspect "accsys-app:$COMMIT" >/dev/null 2>&1 && sudo docker image inspect "accsys-migrate:$COMMIT" >/dev/null 2>&1; then
  echo "Images for $COMMIT already built; skipping docker build."
else
  sudo TMPDIR=/srv/accsys/tmp DOCKER_CONFIG=/srv/accsys/root-docker docker build --target runner   -t "accsys-app:$COMMIT" .
  sudo TMPDIR=/srv/accsys/tmp DOCKER_CONFIG=/srv/accsys/root-docker docker build --target migrator -t "accsys-migrate:$COMMIT" .
fi

echo "$COMMIT" | sudo tee /srv/accsys/deployed-commit >/dev/null

echo "3) Updating /etc/accsys/accsys.env image tags to $COMMIT..."
sudo sed -i.bak \
  -e "s|^ACCSYS_APP_IMAGE=.*|ACCSYS_APP_IMAGE=accsys-app:$COMMIT|" \
  -e "s|^ACCSYS_MIGRATE_IMAGE=.*|ACCSYS_MIGRATE_IMAGE=accsys-migrate:$COMMIT|" \
  /etc/accsys/accsys.env

sudo grep -E '^(ACCSYS_APP_IMAGE|ACCSYS_MIGRATE_IMAGE|ACCSYS_FQDN|APP_ORIGIN)=' /etc/accsys/accsys.env

echo "4) Ensuring PostgreSQL container image and rootfs are intact and healthy..."
if ! $DC exec -T db psql --version >/dev/null 2>&1; then
  echo "Recreating db container with clean image layers on /srv/accsys/docker..."
  $DC rm -sf db || true
  PG_IMG="postgres:16.15-alpine3.24@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea"
  NGINX_IMG="nginxinc/nginx-unprivileged:stable-alpine@sha256:56b8272e43a0525f67aed68d1e0794a712d10e3e45a563e118e9a77c817e6f86"
  CLAM_IMG="$(sudo grep '^ACCSYS_CLAMAV_IMAGE=' /etc/accsys/accsys.env | cut -d= -f2-)"
  sudo docker rmi -f "$PG_IMG" "$NGINX_IMG" "$CLAM_IMG" 2>/dev/null || true
  sudo docker pull "$PG_IMG"
  sudo docker pull "$NGINX_IMG"
  [ -n "$CLAM_IMG" ] && sudo docker pull "$CLAM_IMG"
fi
$DC up -d db
for i in $(seq 1 30); do
  health="$(sudo docker inspect -f '{{.State.Health.Status}}' $($DC ps -q db) 2>/dev/null || echo starting)"
  [ "$health" = "healthy" ] && break
  sleep 2
done

echo "5) Refreshing db/roles.sql ownership and grants before migration..."
$DC exec -T db psql -X -U postgres -d accsys -v ON_ERROR_STOP=1 -f /accsys/roles.sql

echo "6) Running database migrations..."
if ! $DC run --rm migrate; then
  echo "Migration failed — checking recent PostgreSQL logs:"
  $DC logs db --tail 40
  exit 1
fi

echo "6b) Re-applying db/roles.sql grants for newly created tables..."
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
