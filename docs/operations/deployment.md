# ACCSYS 地端部署手冊

適用：公司地端 Linux 主機（或測試 VM），Docker Engine + Compose v2。不使用任何雲端專屬服務。設定檔：`deploy/compose.prod.yml`、`deploy/nginx/templates/accsys.conf.template`、`deploy/accsys.env.example`。

## 架構

```
使用者 ──HTTPS 443──▶ proxy (nginx, 非 root) ──▶ app (Next.js, uid 10001) ──▶ db (PostgreSQL 16)
                         edge 網路                 edge + backend + scan    backend（internal，無對外、無 published port）
                                                     │
                                                     └──▶ clamav（scan + clamav_egress；碰不到 db，egress 僅供病毒碼更新）
一次性工作（profile tools）：migrate、admin-cli、backup
```

- 只有 proxy 對主機開 port（預設 80／443）。80 只做轉址到 HTTPS。
- 未知 Host、以 IP 直連、SNI 不符的連線一律不回應（HTTP 444／TLS 拒絕握手）。
- proxy 以 TCP 來源位址**覆寫** `X-Real-IP`／`X-Forwarded-For`，清除 `Forwarded`；`X-Forwarded-Host` 固定為正式 FQDN。app 的登入限速只信任 `X-Real-IP`（`TRUSTED_CLIENT_IP_HEADER`）。
- 存取 log 不記 query string（OAuth callback 的 `code`／`state`）。`/auth/` 另有每 IP 每分鐘 30 次的粗略限速（app 內另有精確限速）。
- 附件只由 app 授權後串流；proxy **沒有**任何指向附件目錄的 `alias`／`root`。
- db 只在 `backend`（`internal: true`）網路，沒有對外連線，也沒有 published port。需要從主機管理時用 `docker compose exec db psql`。

## 主機需求與網路

- CPU 架構需與映像相同（在建置機以相同架構 build，或 `docker buildx build --platform`）。記錄 `docker version`、`docker compose version`。
- 防火牆：只開 80／443（給使用者網段）與 SSH（只給管理網段）。
- 對外連線（outbound HTTPS）：`accounts.google.com`、`oauth2.googleapis.com`、`www.googleapis.com`（登入）、`database.clamav.net`（病毒碼，或公司鏡像）。其餘不需要。
- NTP 必須正常（OIDC token 時效、session 到期、audit 時間）。
- 公司 DNS 的正式 FQDN 指向本機；TLS 憑證由公司 CA 或既有憑證流程簽發，並排定續期。

## 目錄、擁有者與權限

Compose 的 bind mount 與 file secret **不會**改變主機檔案的擁有者或權限，必須事先建好。`create_host_path: false`：目錄不存在時拒絕啟動，不會自動以 root 建立。

app、migrate、admin-cli、backup 以專用 uid 執行（`ACCSYS_UID`／`ACCSYS_GID`，預設 10001）。這個 uid **不可**是主機上任何登入帳號（Ubuntu 第一個帳號通常是 1000，若沿用 1000，該使用者就能讀附件、備份與機密檔）。先確認並建立對應的系統帳號：

```bash
getent passwd 10001 || true                      # 應無輸出；若已被占用，改選其他 uid 並寫入 accsys.env
getent group 10001 || true
groupadd --system --gid 10001 accsys
useradd --system --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin accsys
```

| 主機路徑（預設） | 擁有者 uid:gid | 權限 | 用途 |
|---|---|---|---|
| `/srv/accsys/pgdata` | 70:70 | 0700 | PostgreSQL 資料（獨立本機磁碟，不放 SMB/NFS 分享） |
| `/srv/accsys/attachments` | 10001:10001 | 0700 | 附件 |
| `/srv/accsys/backup` | 10001:10001 | 0700 | 備份暫存（需另外複製到異機，見 backup-restore.md） |
| `/etc/accsys/accsys.env` | root:root | 0640 | 非機密設定 |
| `/etc/accsys/secrets/` | root:root | 0711 | 機密檔目錄 |
| `/etc/accsys/tls/fullchain.pem` | root:root | 0444 | 憑證鏈 |
| `/etc/accsys/tls/privkey.pem` | 101:101 | 0400 | 私鑰（nginx uid 101） |

機密檔（每個檔案一個值，結尾換行可有可無）：

| 檔名 | 讀取者 uid | 內容 |
|---|---|---|
| `postgres_superuser_password` | 70 | DB 超級使用者（只在 `docker compose exec db` 管理時使用） |
| `app_database_url` | 10001 | `postgres://accsys_app:<密碼>@db:5432/accsys` |
| `session_secret` | 10001 | 至少 32 字元隨機值 |
| `google_client_secret` | 10001 | 正式 OAuth client secret |
| `migrator_database_url` | 10001 | `postgres://accsys_migrator:<密碼>@db:5432/accsys` |
| `backup_db_password` | 10001 | `accsys_backup` 的密碼 |

```bash
install -d -m 0711 /etc/accsys/secrets
# 例：產生並寫入（值不經過終端畫面或 shell history）
openssl rand -base64 48 | tr -d '\n' | install -m 0400 -o 10001 -g 10001 /dev/stdin /etc/accsys/secrets/session_secret
```

app 以 `*_FILE` 環境變數讀取這些檔案（`src/lib/secret-files.ts`），`docker inspect` 與容器環境變數中看不到機密值。同時設定 `X` 與 `X_FILE` 會拒絕啟動。

主機磁碟與備份媒體應加密；還原金鑰與備份分開保管，至少兩位管理員知道取得方式。

## 映像

正式主機**不 build、不 npm install**。在建置機：

```bash
git rev-parse --short HEAD                       # 記錄部署版本
docker build --target runner   -t accsys-app:<commit> .
docker build --target migrator -t accsys-migrate:<commit> .
```

- 有公司 registry：push 後以 `accsys-app@sha256:<digest>` 填入 `accsys.env`。
- 沒有 registry：`docker save accsys-app:<commit> accsys-migrate:<commit> | gzip > accsys-<commit>.tar.gz`，記錄 `sha256sum`，傳到主機後核對再 `docker load`；`accsys.env` 填 `accsys-app:<commit>`，並以 `docker image inspect --format '{{.Id}}'` 確認與建置機相同。
- ClamAV、nginx、PostgreSQL 映像也以 digest 固定（ClamAV 在 `accsys.env` 的 `ACCSYS_CLAMAV_IMAGE` 指定；用 `clamav/clamav-debian`，它有 amd64 與 arm64，`clamav/clamav` 只有 amd64）。ClamAV 載入病毒碼約需 1.5–3 GB 記憶體。

## 首次安裝

```bash
cd /opt/accsys                                   # 部署用的 repo checkout（與映像同一 commit）
DC="docker compose -f deploy/compose.prod.yml --env-file /etc/accsys/accsys.env"

$DC up -d db
$DC exec -T db psql -X -U postgres -d accsys -v ON_ERROR_STOP=1 -f /accsys/roles.sql
$DC exec db psql -X -U postgres -d accsys        # \password accsys_app / accsys_migrator / accsys_backup（與機密檔一致）
$DC run --rm migrate                             # 套用 migrations；重跑為 no-op
$DC up -d                                        # proxy、app、clamav（ClamAV 首次下載病毒碼需數分鐘，期間上傳會被拒絕）
```

主檔匯入與第一位管理員：

```bash
$DC run --rm admin-cli scripts/auth-bootstrap.ts --list
$DC run --rm admin-cli scripts/auth-bootstrap.ts --request <申請 id> --employee <員工代碼>
```

`db/seed-local-dev.sql` 與 `scripts/seed-demo-data.ts` **不可**用於正式環境。

## 驗收（每次部署後）

```bash
curl -sI https://<FQDN>/login                    # 200，含 CSP、HSTS；無 x-powered-by
curl -sI http://<FQDN>/                          # 301 到 https
curl -s -o /dev/null -w '%{http_code}\n' https://<FQDN>/auth/dev   # 404
curl -sk https://<主機 IP>/                       # TLS 握手被拒
$DC ps                                           # app／db healthy
$DC port db 5432                                 # 無輸出（未公開）
```

再以測試帳號完成：Google 登入、開一張測試單、上傳附件（確認掃描通過可下載）、簽核一關、登出。

## 升級

1. 先備份：`systemctl start accsys-backup.service`，確認成功。
2. 載入新映像，更新 `accsys.env` 的映像版本。
3. `$DC run --rm migrate`（migration 採 expand → contract，新結構與上一版程式相容）。
4. `$DC up -d app`（proxy 會自動解析新的 app 容器）。
5. 執行上方驗收。

回復：若 migration 只有 expand，改回上一版映像 `$DC up -d app` 即可；若已執行 contract 或資料已被新版本寫入，不能只換回舊映像，依 backup-restore.md 評估還原並保留新資料對帳。

## 排程工作

`deploy/systemd/` 提供 systemd unit：

| Unit | 內容 |
|---|---|
| `accsys-backup.service` + `.timer` | 每日 02:30 `run --rm backup`；執行中不會重複啟動 |

目錄同步（P6）目前只有 dry-run，尚無正式資料來源；公司核准唯讀同步帳號後才會加入 timer。

## 監控規格

沒有公司既有監控時，至少每日檢查；有監控時接以下訊號：

| 項目 | 來源 | 警示條件 |
|---|---|---|
| app／db 健康 | `docker inspect -f '{{.State.Health.Status}}'` | 非 healthy 超過 5 分鐘 |
| 備份 | `systemctl status accsys-backup.service`、`/srv/accsys/backup` 最新目錄時間 | 失敗或超過 26 小時沒有新備份 |
| 異機備份 | 異機上的最新檔案時間 | 超過 26 小時 |
| 磁碟 | pgdata、attachments、backup 所在磁碟 | 使用率 > 80% |
| 憑證 | `openssl x509 -enddate` | 30 天內到期 |
| ClamAV 病毒碼 | `docker logs accsys-prod-clamav-1` | 超過 3 天未更新 |
| app 錯誤 | `docker logs accsys-prod-app-1` 的 `database_error (ref ...)` | 持續出現 |
| 時間同步 | `timedatectl` | 未同步 |

log 使用 Docker `local` driver，每個容器保留 5 × 20 MB。

## 定期維運

| 週期 | 工作 |
|---|---|
| 每月 | OS／Docker 安全更新；檢查基底映像新 digest 與 `npm audit --omit=dev`，需要時重建映像走升級流程 |
| 每季 | 還原演練（backup-restore.md）；盤點 admin／finance 角色與帳號綁定；確認兩位以上管理員可接手 |
| 每年 | 檢查 Node、Next.js、PostgreSQL、nginx 支援期限；輪替 `session_secret` 與 DB 密碼（incident-response.md） |
