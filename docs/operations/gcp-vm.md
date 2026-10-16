# ACCSYS — GCP VM 部署檢核（初期測試）

正式長期環境以公司地端為準；GCP 只做初期上雲測試。**同一套** `deploy/compose.prod.yml`，不使用 Cloud SQL、Cloud Run、Secret Manager、Cloud Load Balancing 等 GCP 專屬服務。完整步驟見 [deployment.md](./deployment.md)。

## 建議規格（約 43 名在職員工）

| 項目 | 建議 |
|---|---|
| 區域 | `asia-east1`（台灣） |
| 機型 | `e2-standard-2`（2 vCPU / 8 GB） |
| 開機碟 | 平衡持久碟 ≥ 40 GB（系統 + Docker + 映像 + 病毒碼） |
| 資料碟（建議另掛） | 40–100 GB，掛到 `/srv/accsys`（pgdata、attachments、backup） |
| OS | Ubuntu 24.04 LTS |
| 對外 | 靜態外部 IP；防火牆只開 22（管理網段）、80、443 |

ClamAV 載入病毒碼約需 1.5–3 GB RAM，與 app／nginx／Postgres 同機時勿選 e2-micro／e2-small。

## 部署前準備清單

在開 VM 與改 Google Console 之前先備齊：

1. **程式版本**：要部署的 git commit（建議先 merge／tag，再依該 commit build 映像）。
2. **域名**：正式 FQDN（例：`accsys.company.com`）與 DNS A 紀錄指向靜態 IP。
3. **TLS**：公司憑證或 Let's Encrypt 的 `fullchain.pem`／`privkey.pem`（路徑見 deployment.md）。
4. **Google OAuth（正式 client，勿用本機 client）**：
   - Authorized JavaScript origins：`https://<FQDN>`
   - Authorized redirect URIs：`https://<FQDN>/auth/callback`
   - `ALLOWED_GOOGLE_DOMAINS`＝公司 Workspace 網域
5. **機密檔**（寫入 VM 的 `/etc/accsys/secrets/`，不要進 git）：
   - `session_secret`、`google_client_secret`
   - `app_database_url`、`migrator_database_url`、`backup_db_password`、`postgres_superuser_password`
6. **非機密** `/etc/accsys/accsys.env`：自 `deploy/accsys.env.example` 複製，填 FQDN、`APP_ORIGIN=https://<FQDN>`、映像 digest、`GOOGLE_CLIENT_ID`。

## 建置機 → VM（精簡流程）

在本機或 CI（與 VM 相同 CPU 架構，GCP 預設 amd64）：

```bash
COMMIT=$(git rev-parse --short HEAD)
docker build --target runner   -t accsys-app:$COMMIT .
docker build --target migrator -t accsys-migrate:$COMMIT .
# 有 registry：push 後用 digest；沒有：docker save | gzip 傳到 VM 再 docker load
```

在 VM（已安裝 Docker Engine + Compose v2，目錄／uid 依 deployment.md 建好）：

```bash
cd /opt/accsys   # 與映像同一 commit 的 checkout
DC="docker compose -f deploy/compose.prod.yml --env-file /etc/accsys/accsys.env"
$DC up -d db
$DC exec -T db psql -X -U postgres -d accsys -v ON_ERROR_STOP=1 -f /accsys/roles.sql
# 設定 DB 角色密碼與機密檔一致後：
$DC run --rm migrate
$DC up -d
```

驗收指令與升級／備份同 [deployment.md](./deployment.md)。

## GCP 主機側注意

- **不要**把 DB port 或 Compose 的 published port 開到 0.0.0.0 以外；正式 stack 的 DB 本來就沒有 published port。
- 防火牆／安全群組：使用者只到 443；SSH 限管理 IP。
- 出站 HTTPS：Google OAuth、`database.clamav.net`（病毒碼）。
- 快照：至少對資料碟排程每日快照；邏輯備份仍走 `accsys-backup.timer`（見 backup-restore.md）。
- 本機 `.env.local`、demo seed、`NEXT_PUBLIC_DEV_LOGIN`、`ALLOW_HTTP_LOCALHOST` **一律不要**帶到 GCP。

## 本機正式建置預覽（部署前）

```bash
npm run build
ALLOW_HTTP_LOCALHOST=true npm run start
# 開啟 http://localhost:3001 — 無 DevTools「N」；登入用既有本機 OAuth
```

`ALLOW_HTTP_LOCALHOST` 只給筆電預覽用，**不可**寫進 GCP／地端的 `accsys.env`。上傳在 production 必須有 ClamAV（`ATTACHMENT_SCAN=clamav`）；本機預覽若沒跑 ClamAV，上傳會被拒，不影響登入與瀏覽。
