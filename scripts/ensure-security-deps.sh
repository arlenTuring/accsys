#!/usr/bin/env bash
# Bring up real ClamAV (clamd) and a LibreOffice soffice shim for local acceptance.
#
#   ./scripts/ensure-security-deps.sh
#   ./scripts/ensure-security-deps.sh --office-image   # also build runner image (slow)
#
# After this, point Next / accept scripts at:
#   ATTACHMENT_SCAN=clamav CLAMAV_HOST=127.0.0.1 CLAMAV_PORT=23310
#   PATH=/tmp/accsys-bin:$PATH   # for Office conversion
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"
CLAM_NAME="${ACCSYS_CLAMAV_CONTAINER:-accsys-verify-clamd}"
CLAM_PORT="${REAL_CLAMAV_PORT:-23310}"
CLAM_IMAGE="${ACCSYS_CLAMAV_IMAGE:-clamav/clamav-debian:1.4.6@sha256:03a2f641117f0a8c908bac65a63c5e1e4695badc52a340c9d30397d7cebb9154}"
OFFICE_IMAGE="${ACCSYS_OFFICE_IMAGE:-accsys-verify-app}"
DO_OFFICE_IMAGE=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --office-image) DO_OFFICE_IMAGE=1; shift ;;
    -h|--help) sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "未知參數: $1"; exit 1 ;;
  esac
done

if ! command -v docker >/dev/null 2>&1; then
  echo "❌ 找不到 docker"
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo "⏳ 啟動 Docker Desktop…"
  open -a Docker 2>/dev/null || true
  for _ in $(seq 1 60); do
    docker info >/dev/null 2>&1 && break
    sleep 2
  done
  if ! docker info >/dev/null 2>&1; then
    echo "❌ Docker 仍無法連線"
    exit 1
  fi
fi

if docker ps -a --format '{{.Names}}' | grep -qx "$CLAM_NAME"; then
  STATE="$(docker inspect -f '{{.State.Status}}' "$CLAM_NAME")"
  if [[ "$STATE" != "running" ]]; then
    echo "🦠 啟動既有 ClamAV 容器 $CLAM_NAME…"
    docker start "$CLAM_NAME" >/dev/null
  else
    echo "🦠 ClamAV 已在跑：$CLAM_NAME"
  fi
else
  echo "🦠 建立 ClamAV 容器 $CLAM_NAME（127.0.0.1:${CLAM_PORT}→3310）…"
  docker run -d --name "$CLAM_NAME" -p "127.0.0.1:${CLAM_PORT}:3310" "$CLAM_IMAGE" >/dev/null
fi

echo "⏳ 等待 clamd 接受連線（首次拉簽章可能數分鐘）…"
READY=0
for i in $(seq 1 120); do
  if (echo PING | nc -w 1 127.0.0.1 "$CLAM_PORT" 2>/dev/null | grep -q PONG) \
    || docker exec "$CLAM_NAME" clamdscan --ping 2>/dev/null | grep -qi pong; then
    READY=1
    break
  fi
  # Alternative: TCP connect succeeds after clamd listens (before signatures fully loaded).
  if nc -z 127.0.0.1 "$CLAM_PORT" 2>/dev/null; then
    # Prefer a real INSTREAM probe once port is open.
    if node -e "
      const net=require('net');
      const s=net.connect({host:'127.0.0.1',port:${CLAM_PORT}},()=>{s.write('zPING\0');});
      let d=''; s.on('data',c=>d+=c); s.setTimeout(1500,()=>{process.exit(2)});
      s.on('end',()=>process.exit(/PONG/i.test(d)?0:1));
      s.on('error',()=>process.exit(1));
    " 2>/dev/null; then
      READY=1
      break
    fi
  fi
  sleep 3
done
if [[ "$READY" -ne 1 ]]; then
  echo "❌ clamd 尚未就緒。請稍後重試：docker logs $CLAM_NAME"
  exit 1
fi
echo "   ClamAV OK on 127.0.0.1:${CLAM_PORT}"

mkdir -p /tmp/accsys-bin
ln -sfn "$ROOT/scripts/soffice-in-container.sh" /tmp/accsys-bin/soffice
chmod +x "$ROOT/scripts/soffice-in-container.sh"

if [[ "$DO_OFFICE_IMAGE" -eq 1 ]]; then
  if ! docker image inspect "$OFFICE_IMAGE" >/dev/null 2>&1; then
    echo "🏗️  建置 LibreOffice runner 映像 $OFFICE_IMAGE（約數分鐘）…"
    docker build --target runner -t "$OFFICE_IMAGE" .
  else
    echo "📄 Office 映像已存在：$OFFICE_IMAGE"
  fi
else
  if docker image inspect "$OFFICE_IMAGE" >/dev/null 2>&1; then
    echo "📄 Office 映像可用：$OFFICE_IMAGE（PATH 請加 /tmp/accsys-bin）"
  else
    echo "⚠️  尚未有 $OFFICE_IMAGE。跑 Office 驗收前請：./scripts/ensure-security-deps.sh --office-image"
  fi
fi

echo
echo "用法範例："
echo "  ATTACHMENT_SCAN=clamav CLAMAV_HOST=127.0.0.1 CLAMAV_PORT=${CLAM_PORT} REAL_CLAMAV_PORT=${CLAM_PORT} \\"
echo "    PATH=/tmp/accsys-bin:\$PATH npm run dev"
echo "  REAL_CLAMAV_PORT=${CLAM_PORT} npx tsx scripts/ai-accept-s4.ts --out docs/evidence/real-clamav-s4-rerun.json"
echo "  PATH=/tmp/accsys-bin:\$PATH ATTACHMENT_SCAN=clamav CLAMAV_HOST=127.0.0.1 CLAMAV_PORT=${CLAM_PORT} \\"
echo "    npx tsx scripts/ai-accept-s6.ts --out docs/evidence/real-office-s6-rerun.json"
