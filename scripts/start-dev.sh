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
  if grep -q '^SESSION_SECRET=replace-with' .env.local; then
    # portable sed (macOS); random per checkout, never a shared well-known value
    SECRET="$(node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64url'))")"
    sed -i.bak "s|^SESSION_SECRET=.*|SESSION_SECRET=${SECRET}|" .env.local
    # Keep demo persona login off by default; use Google Workspace sign-in.
    sed -i.bak "s|^NEXT_PUBLIC_DEV_LOGIN=.*|NEXT_PUBLIC_DEV_LOGIN=false|" .env.local
    rm -f .env.local.bak
  fi
  echo "   已寫入本機開發預設（請用公司 Google 帳號登入）"
fi

# P2 login settings added after older .env.local files were created (non-secret defaults).
if ! grep -q '^APP_ORIGIN=' .env.local; then
  printf '\n# added by start-dev.sh (P2 login)\nAPP_ORIGIN=http://localhost:%s\n' "$PORT" >> .env.local
  echo "   已在 .env.local 補上 APP_ORIGIN=http://localhost:${PORT}"
fi
if ! grep -q '^AUTH_MODE=' .env.local; then
  printf 'AUTH_MODE=manual\n' >> .env.local
  echo "   已在 .env.local 補上 AUTH_MODE=manual"
fi

if [[ ! -d node_modules ]]; then
  echo "📦 依 package-lock.json 安裝 npm 依賴…"
  npm ci
fi

echo "🐘 啟動 Postgres (accsys-db, host port 15432)…"
docker compose up -d db

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

# Schema: roles (older volumes) -> adopt legacy schema if needed -> migrations -> dev seed.
PSQL=(docker exec -i accsys-db psql -U accsys -d accsys -v ON_ERROR_STOP=1 -q)
MIGRATOR_URL="postgres://accsys_migrator:${ACCSYS_MIGRATOR_PASSWORD:-accsys_migrator_dev}@127.0.0.1:15432/accsys"

if [[ -z "$("${PSQL[@]}" -Atc "select 1 from pg_roles where rolname = 'accsys_migrator'")" ]]; then
  echo "🔐 本機 DB 建立於角色模型之前，建立 accsys_* 角色…"
  "${PSQL[@]}" -f /accsys/roles.sql
  "${PSQL[@]}" -c "alter role accsys_migrator password '${ACCSYS_MIGRATOR_PASSWORD:-accsys_migrator_dev}'" \
               -c "alter role accsys_app password '${ACCSYS_APP_PASSWORD:-accsys_app_dev}'" \
               -c "alter role accsys_backup password '${ACCSYS_BACKUP_PASSWORD:-accsys_backup_dev}'"
fi

HAS_HISTORY="$("${PSQL[@]}" -Atc "select to_regclass('drizzle.__drizzle_migrations') is not null")"
TABLE_COUNT="$("${PSQL[@]}" -Atc "select count(*) from pg_tables where schemaname = 'public'")"
if [[ "$HAS_HISTORY" != "t" && "$TABLE_COUNT" -gt 0 ]]; then
  echo "🧾 既有本機 DB 尚無 migration 紀錄，核對結構後登記 baseline…"
  MIGRATION_DATABASE_URL="$MIGRATOR_URL" npm run -s db:baseline
fi

echo "🧱 套用資料庫 migrations…"
MIGRATION_DATABASE_URL="$MIGRATOR_URL" npm run -s db:migrate
"${PSQL[@]}" -f /accsys/seed-local-dev.sql
echo "🧩 發布範例表單（已存在則略過）…"
npm run -s seed:forms || echo "⚠️  範例表單未發布（不影響其他功能），可稍後執行 npm run seed:forms"
echo "🧩 建立轉換表單草稿（第 1 批用印申請、第 2 批出差報支、第 3 批費用申請、第 4 批資產異動、第 5 批採購流程；已存在則略過，發佈前不影響舊表單）…"
for batch in 1 2 3 4 5; do
  npm run -s forms:migrate -- --batch "$batch" || echo "⚠️  第 $batch 批轉換表單草稿未建立（不影響其他功能），可稍後執行 npm run forms:migrate -- --batch $batch"
done

if grep -q '^DATABASE_URL=postgres://accsys:' .env.local 2>/dev/null; then
  echo "⚠️  .env.local 的 DATABASE_URL 仍使用 DB 超級使用者 accsys。建議改為最小權限帳號："
  echo "   DATABASE_URL=postgres://accsys_app:accsys_app_dev@127.0.0.1:15432/accsys"
fi

if [[ "$DO_SEED" -eq 1 ]]; then
  echo "🌱 匯入示範假資料…"
  npm run seed:demo
fi

# Free the port if a stale Next process from this repo still holds it.
# Processes from other projects / apps are never killed.
free_stale_next() {
  local pids pid cwd cmd killed=""
  pids="$(lsof -nP -t -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true)"
  [[ -z "$pids" ]] && return 0
  for pid in $pids; do
    cwd="$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -n1)"
    cmd="$(ps -o command= -p "$pid" 2>/dev/null || true)"
    if [[ "$cwd" == "$ROOT"* && "$cmd" == *next* ]]; then
      echo "🧹 關閉本專案殘留的 Next 程序 (PID $pid)…"
      kill "$pid" 2>/dev/null || true
      killed="$killed $pid"
    fi
  done
  [[ -z "$killed" ]] && return 0
  for i in $(seq 1 10); do
    lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1 || return 0
    sleep 0.5
  done
  for pid in $killed; do
    kill -9 "$pid" 2>/dev/null || true
  done
  sleep 0.5
}

free_stale_next
if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "⚠️  Port $PORT 被其他程式占用（不是本專案的 Next，未自動關閉）。"
  lsof -nP -iTCP:"$PORT" -sTCP:LISTEN | sed 's/^/   /'
  echo "   請關掉該程式，或改用: $0 --port 3002"
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
