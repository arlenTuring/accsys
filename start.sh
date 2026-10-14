#!/usr/bin/env bash
# ACCSYS 一鍵啟動（本機開發）
#
#   ./start.sh            啟動全部：Docker Desktop → Postgres → migrations → Next.js（前台 + 後台 API）
#   ./start.sh --seed     同上，並匯入示範假資料
#   ./start.sh --port N   指定 port（預設 3001；被其他程式占用時自動往後找空的 port）
#   ./start.sh --no-open  啟動後不自動開瀏覽器
#   ./start.sh --stop     關閉本專案的 Next.js 與資料庫容器
#
# 重複執行時會先關掉「本專案」殘留的 Next.js / 啟動腳本程序再重新啟動；
# 其他專案或程式的程序一律不動。

set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

DEFAULT_PORT=3001
PORT="$DEFAULT_PORT"
DO_SEED=0
DO_OPEN=1
DO_STOP=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --seed) DO_SEED=1; shift ;;
    --port) PORT="${2:?--port 需要數字}"; shift 2 ;;
    --no-open) DO_OPEN=0; shift ;;
    --stop) DO_STOP=1; shift ;;
    -h|--help) sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "未知參數: $1（用 --help 查看用法）"; exit 1 ;;
  esac
done

if ! [[ "$PORT" =~ ^[0-9]+$ ]] || (( PORT < 1024 || PORT > 65535 )); then
  echo "❌ port 必須是 1024–65535 的數字"
  exit 1
fi

export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"

proc_cwd() {
  lsof -a -p "$1" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -n1
}

# This script and its ancestors must never be killed (e.g. when launched from a wrapper inside ROOT).
SELF_CHAIN=" $$ "
p="$PPID"
while [[ -n "$p" && "$p" -gt 1 ]]; do
  SELF_CHAIN+="$p "
  p="$(ps -o ppid= -p "$p" 2>/dev/null | tr -d ' ' || true)"
done

find_project_pids() {
  local snapshot pid cwd
  snapshot="$(ps -axo pid=,ppid=,command=)"
  # Candidates by command line, minus this script, its ancestors and its own subshells.
  for pid in $(awk -v self="$$" -v chain="$SELF_CHAIN" '
    { pid = $1; ppid[pid] = $2; $1 = ""; $2 = ""; cmd[pid] = $0 }
    END {
      for (p in cmd) {
        if (index(chain, " " p " ")) continue
        if (cmd[p] !~ /(next dev|next-server|next start|next\/dist\/bin\/next|npm run dev|start-dev\.sh|(^|[ \/])start\.sh)/) continue
        q = p; mine = 0
        for (i = 0; i < 20 && q > 1; i++) { if (q == self) { mine = 1; break } q = ppid[q] }
        if (!mine) print p
      }
    }' <<<"$snapshot"); do
    cwd="$(proc_cwd "$pid")"
    [[ "$cwd" == "$ROOT" || "$cwd" == "$ROOT"/* ]] || continue
    echo "$pid"
  done
}

stop_project_processes() {
  local pids pid
  pids="$(find_project_pids | tr '\n' ' ')"
  [[ -z "${pids// /}" ]] && return 0
  echo "🧹 關閉本專案先前啟動的程序：${pids}"
  for pid in $pids; do kill -TERM "$pid" 2>/dev/null || true; done
  for _ in $(seq 1 20); do
    local alive=""
    for pid in $pids; do kill -0 "$pid" 2>/dev/null && alive+="$pid "; done
    [[ -z "$alive" ]] && return 0
    sleep 0.5
  done
  for pid in $pids; do kill -KILL "$pid" 2>/dev/null || true; done
  sleep 0.5
}

port_busy() {
  lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
}

stop_project_processes

if [[ "$DO_STOP" -eq 1 ]]; then
  if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    echo "🐘 停止資料庫容器 accsys-db（資料保留在 volume，不會刪除）…"
    docker compose stop db >/dev/null 2>&1 || true
  fi
  echo "✅ 已停止 ACCSYS"
  exit 0
fi

# Anything still listening on the port is not ours (ours were stopped above): move to a free port.
if port_busy "$PORT"; then
  echo "⚠️  Port $PORT 被其他程式占用（不是本專案，不會關閉它）："
  lsof -nP -iTCP:"$PORT" -sTCP:LISTEN | sed 's/^/   /'
  FOUND=""
  for candidate in $(seq $((PORT + 1)) $((PORT + 20))); do
    if ! port_busy "$candidate"; then FOUND="$candidate"; break; fi
  done
  if [[ -z "$FOUND" ]]; then
    echo "❌ $PORT 之後 20 個 port 都被占用，請用 --port 指定其他 port"
    exit 1
  fi
  echo "   改用 port $FOUND"
  PORT="$FOUND"
fi

# Login checks the request origin against APP_ORIGIN; process env overrides .env.local.
if [[ "$PORT" != "$DEFAULT_PORT" ]]; then
  export APP_ORIGIN="http://localhost:${PORT}"
fi

# Recover a database container stuck in an unhealthy state before start-dev.sh waits on it.
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  DB_STATE="$(docker inspect -f '{{.State.Status}}/{{.State.Health.Status}}' accsys-db 2>/dev/null || true)"
  if [[ "$DB_STATE" == "running/unhealthy" ]]; then
    echo "🩺 資料庫容器狀態異常，重新啟動 accsys-db…"
    docker restart accsys-db >/dev/null
  fi
fi

if [[ "$DO_OPEN" -eq 1 ]] && command -v open >/dev/null 2>&1; then
  (
    for _ in $(seq 1 180); do
      if curl -fsS -o /dev/null "http://localhost:${PORT}/login" 2>/dev/null; then
        open "http://localhost:${PORT}/login"
        exit 0
      fi
      sleep 1
    done
  ) &
fi

ARGS=(--port "$PORT")
[[ "$DO_SEED" -eq 1 ]] && ARGS+=(--seed)
exec "$ROOT/scripts/start-dev.sh" "${ARGS[@]}"
