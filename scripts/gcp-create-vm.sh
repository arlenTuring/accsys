#!/usr/bin/env bash
# Create an ACCSYS test VM on GCP Compute Engine (asia-east1).
# Run this in YOUR local terminal (not the agent sandbox), after:
#   gcloud auth login
#   gcloud auth application-default login
#   gcloud config set project integral-cell-498905-s0
#
# Usage:
#   ./scripts/gcp-create-vm.sh                 # create VM + static IP + firewall
#   ./scripts/gcp-create-vm.sh --dry-run       # print commands only
#   ./scripts/gcp-create-vm.sh --name accsys-test --zone asia-east1-b
#
# After the VM is up, follow docs/operations/gcp-vm.md to install Docker,
# load images, and run deploy/compose.prod.yml.

set -euo pipefail

PROJECT="${GCP_PROJECT:-integral-cell-498905-s0}"
REGION="${GCP_REGION:-asia-east1}"
ZONE="${GCP_ZONE:-asia-east1-b}"
NAME="${GCP_VM_NAME:-accsys-test}"
MACHINE="${GCP_MACHINE:-e2-standard-2}"
BOOT_DISK_GB="${GCP_BOOT_DISK_GB:-40}"
DATA_DISK_GB="${GCP_DATA_DISK_GB:-50}"
IMAGE_FAMILY="${GCP_IMAGE_FAMILY:-ubuntu-2404-lts-amd64}"
IMAGE_PROJECT="${GCP_IMAGE_PROJECT:-ubuntu-os-cloud}"
DRY_RUN=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --name) NAME="$2"; shift 2 ;;
    --zone) ZONE="$2"; REGION="${ZONE%-*}"; shift 2 ;;
    --project) PROJECT="$2"; shift 2 ;;
    -h|--help)
      sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) echo "未知參數: $1"; exit 1 ;;
  esac
done

run() {
  if [[ "$DRY_RUN" -eq 1 ]]; then
    printf '+'; printf '%q ' "$@"; echo
  else
    "$@"
  fi
}

echo "Project=$PROJECT Region=$REGION Zone=$ZONE VM=$NAME Machine=$MACHINE"

run gcloud config set project "$PROJECT"

# APIs (idempotent)
run gcloud services enable compute.googleapis.com --project="$PROJECT"

ADDRESS="${NAME}-ip"
FIREWALL_WEB="${NAME}-allow-http-https"
FIREWALL_SSH="${NAME}-allow-ssh"
DATA_DISK="${NAME}-data"

# Static IP
if ! gcloud compute addresses describe "$ADDRESS" --region="$REGION" --project="$PROJECT" >/dev/null 2>&1; then
  run gcloud compute addresses create "$ADDRESS" --region="$REGION" --project="$PROJECT"
else
  echo "地址已存在: $ADDRESS"
fi
EXTERNAL_IP="$(gcloud compute addresses describe "$ADDRESS" --region="$REGION" --project="$PROJECT" --format='get(address)' 2>/dev/null || echo '(dry-run)')"
echo "外部 IP: $EXTERNAL_IP"

# Firewall: HTTP/HTTPS open; SSH should be tightened to your IP later
if ! gcloud compute firewall-rules describe "$FIREWALL_WEB" --project="$PROJECT" >/dev/null 2>&1; then
  run gcloud compute firewall-rules create "$FIREWALL_WEB" \
    --project="$PROJECT" \
    --allow=tcp:80,tcp:443 \
    --target-tags=accsys-web \
    --description="ACCSYS HTTP/HTTPS"
else
  echo "防火牆已存在: $FIREWALL_WEB"
fi

if ! gcloud compute firewall-rules describe "$FIREWALL_SSH" --project="$PROJECT" >/dev/null 2>&1; then
  run gcloud compute firewall-rules create "$FIREWALL_SSH" \
    --project="$PROJECT" \
    --allow=tcp:22 \
    --target-tags=accsys-ssh \
    --description="ACCSYS SSH (請之後改成僅管理 IP)"
else
  echo "防火牆已存在: $FIREWALL_SSH"
fi

# Data disk
if ! gcloud compute disks describe "$DATA_DISK" --zone="$ZONE" --project="$PROJECT" >/dev/null 2>&1; then
  run gcloud compute disks create "$DATA_DISK" \
    --project="$PROJECT" \
    --zone="$ZONE" \
    --size="${DATA_DISK_GB}GB" \
    --type=pd-balanced
else
  echo "資料碟已存在: $DATA_DISK"
fi

# VM
if ! gcloud compute instances describe "$NAME" --zone="$ZONE" --project="$PROJECT" >/dev/null 2>&1; then
  run gcloud compute instances create "$NAME" \
    --project="$PROJECT" \
    --zone="$ZONE" \
    --machine-type="$MACHINE" \
    --image-family="$IMAGE_FAMILY" \
    --image-project="$IMAGE_PROJECT" \
    --boot-disk-size="${BOOT_DISK_GB}GB" \
    --boot-disk-type=pd-balanced \
    --disk="name=${DATA_DISK},device-name=accsys-data,mode=rw,boot=no" \
    --address="$ADDRESS" \
    --tags=accsys-web,accsys-ssh \
    --metadata=startup-script='#!/bin/bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y ca-certificates curl gnupg
install -m 0755 -d /etc/apt/keyrings
if [[ ! -f /etc/apt/keyrings/docker.asc ]]; then
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
fi
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo \"$VERSION_CODENAME\") stable" > /etc/apt/sources.list.d/docker.list
apt-get update -y
apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
systemctl enable --now docker
# Prepare data disk mount for /srv/accsys if not already mounted
if ! mountpoint -q /srv/accsys; then
  mkdir -p /srv/accsys
  DEV=/dev/disk/by-id/google-accsys-data
  if [[ -e "$DEV" ]]; then
    if ! blkid "$DEV" >/dev/null 2>&1; then
      mkfs.ext4 -F "$DEV"
    fi
    UUID=$(blkid -s UUID -o value "$DEV")
    grep -q "$UUID" /etc/fstab || echo "UUID=$UUID /srv/accsys ext4 defaults,nofail 0 2" >> /etc/fstab
    mount /srv/accsys || true
  fi
fi
'
else
  echo "VM 已存在: $NAME"
fi

cat <<EOF

=== 下一步（在本機執行）===
1) SSH：
   gcloud compute ssh $NAME --zone=$ZONE --project=$PROJECT

2) 在 VM 上依 docs/operations/gcp-vm.md / deployment.md：
   - 建立 uid 10001、/etc/accsys、機密檔與 TLS
   - git clone 或 scp 部署用 checkout（commit 2ffc9ed 或更新）
   - docker build／load 映像後 docker compose -f deploy/compose.prod.yml up

3) Google OAuth 正式 client：
   - origins: https://<FQDN>
   - redirect: https://<FQDN>/auth/callback
   - APP_ORIGIN 必須是 https（不要 ALLOW_HTTP_LOCALHOST）

外部 IP：$EXTERNAL_IP
EOF
