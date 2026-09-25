#!/usr/bin/env bash
# ACCSYS local start script
# Usage:
#   ./scripts/start-dev.sh           # start DB + Next.js on :3001
#   ./scripts/start-dev.sh --seed    # also load demo UI data
#   ./scripts/start-dev.sh --port 3002

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PORT=3001
DO_SEED=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --seed) DO_SEED=1; shift ;;
    --port) PORT="${2:?}"; shift 2 ;;
    -h|--help)
      echo "Usage: $0 [--seed] [--port N]"
      exit 0
      ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# Docker Desktop CLI on macOS often isn't on PATH in non-login shells
export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"

if ! command -v docker >/dev/null 2>&1; then
  echo "❌ 找不到 docker。請先開啟 Docker Desktop，再重跑此腳本。"
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "⏳ Docker 尚未就緒，正在嘗試啟動 Docker Desktop…"
  open -a Docker 2>/dev/null || true
  for i in $(seq 1 60); do
    if docker info >/dev/null 2>&1; then
      break
    fi
    sleep 2
  done
  if ! docker info >/dev/null 2>&1; then
    echo "❌ Docker 仍無法連線。請手動開啟 Docker Desktop 後再試。"
    exit 1
  fi
fi

if [[ ! -f .env.local ]]; then
  echo "📝 尚未有 .env.local，從範本建立…"
  cp .env.local.example .env.local
  # Sensible local defaults for demo login
  if grep -q '^SESSION_SECRET=replace-with' .env.local; then
    # portable sed (macOS)
    SECRET="local-dev-session-secret-key-32chars"
    sed -i.bak "s|^SESSION_SECRET=.*|SESSION_SECRET=${SECRET}|" .env.local
    sed -i.bak "s|^DEV_LOGIN_EMAIL=.*|DEV_LOGIN_EMAIL=dev@turing-drive.com|" .env.local
    sed -i.bak "s|^NEXT_PUBLIC_DEV_LOGIN=.*|NEXT_PUBLIC_DEV_LOGIN=true|" .env.local
    rm -f .env.local.bak
  fi
  echo "   已寫入本機開發預設（DEV 登入已開啟）"
fi

if [[ ! -d node_modules ]]; then
  echo "📦 安裝 npm 依賴…"
  npm install
fi

echo "🐘 啟動 Postgres (accsys-db, host port 15432)…"
docker compose up -d

echo "⏳ 等待資料庫 healthy…"
for i in $(seq 1 40); do
  STATUS="$(docker inspect -f '{{.State.Health.Status}}' accsys-db 2>/dev/null || echo starting)"
  if [[ "$STATUS" == "healthy" ]]; then
    break
  fi
  sleep 1
done
STATUS="$(docker inspect -f '{{.State.Health.Status}}' accsys-db 2>/dev/null || echo unknown)"
if [[ "$STATUS" != "healthy" ]]; then
  echo "❌ 資料庫未就緒（狀態: $STATUS）。請檢查: docker logs accsys-db"
  exit 1
fi
echo "   DB OK"

if [[ "$DO_SEED" -eq 1 ]]; then
  echo "🌱 匯入示範假資料…"
  npm run seed:demo
fi

# Free port if a stale Next process is stuck (optional soft check)
if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "⚠️  Port $PORT 已被占用。請先關掉舊的 Next，或改用: $0 --port 3002"
  echo "   查占用: lsof -nP -iTCP:$PORT -sTCP:LISTEN"
  exit 1
fi

echo ""
echo "✅ 啟動 Next.js → http://localhost:${PORT}"
echo "   登入頁:     http://localhost:${PORT}/login"
echo "   工具區:     http://localhost:${PORT}/tools"
echo "   PDF 編輯:   http://localhost:${PORT}/tools/pdf-editor"
echo "   停止 DB:    npm run db:down"
echo ""

exec npm run dev -- -p "$PORT"
