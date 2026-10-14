# ACCSYS 資安事件處理與金鑰輪替

`$DC` 指 `docker compose -f deploy/compose.prod.yml --env-file /etc/accsys/accsys.env`（在 `/opt/accsys` 執行）。

## 聯絡與責任（由公司填寫）

| 角色 | 負責人 | 備援 |
|---|---|---|
| 主機／Docker 管理員 | | |
| ACCSYS 系統管理員（app admin） | | |
| Google Workspace 管理員 | | |
| 決策者（是否停機、對外通報） | | |

## 通用原則

1. **先保全證據，再修復**。不要先重開機、刪容器或還原資料庫。
2. 證據：
   - `docker logs` 各容器輸出（`$DC logs --no-color > /root/incident-<日期>/compose.log`）；
   - `audit_events` 匯出（`accsys_backup` 唯讀）；
   - 主機 auth log 與 `docker events`；
   - 必要時加上 pgdata／attachments 的檔案系統快照。
3. 所有手動操作記錄時間、執行者、命令與結果。
4. 不在聊天或工單貼出密碼、token、私鑰。
5. `audit_events` 是 append-only（任何角色都不能 UPDATE／DELETE），可作為事後比對依據。

```bash
mkdir -m 0700 /root/incident-$(date +%Y%m%d)
$DC exec -T db psql -X -U postgres -d accsys -c "\copy (select * from audit_events where occurred_at > now() - interval '30 days' order by id) to stdout with csv header" > /root/incident-$(date +%Y%m%d)/audit.csv
```

## 情境處理

### 單一員工帳號疑似被盜用

1. 到 `/admin/accounts`：停用該員工（立即失效所有 session）並撤銷 Google 綁定。這兩個動作都會寫入 audit。
2. 請 Google Workspace 管理員重設該帳號密碼、撤銷其 OAuth token 與登入 session，並檢查 2SV。
3. 從 `audit_events` 查該員工期間的操作（`actor_employee_id`），逐筆確認單據與簽核。
4. 確認後再重新啟用並核准綁定。

### 需要讓所有人登出

```bash
$DC exec -T db psql -X -U postgres -d accsys -c \
  "update app_sessions set revoked_at = now(), revoked_reason = 'incident_logout_all' where revoked_at is null"
```

每個請求都會重新檢查 session，執行後立即生效。

### 資料庫密碼外洩（任一角色）

1. 產生新值並更新對應的機密檔（例如 `app_database_url`）。
2. 在 DB 設定新密碼：`$DC exec db psql -X -U postgres -d accsys` → `\password accsys_app`。
3. 重新啟動使用該機密的服務：`$DC up -d --force-recreate app`。
4. 檢查期間是否有來自非 app 容器的連線（PostgreSQL log）。由於 db 沒有 published port，外洩密碼必須搭配主機或容器網路存取才能使用；若懷疑如此，視為主機入侵處理。

### Google OAuth client secret 外洩

1. Workspace 管理員在 Google Cloud 主控台為該 OAuth client 新增 secret、停用舊 secret。
2. 更新 `google_client_secret` 機密檔，`$DC up -d --force-recreate app`。
3. 用測試帳號確認登入正常，再刪除舊 secret。

### `session_secret` 外洩

`session_secret` 只用來保護登入過程中的暫時 cookie；session 本身是資料庫中的隨機 token（只存雜湊）。輪替：

1. 更新 `session_secret` 機密檔（至少 32 字元）。
2. `$DC up -d --force-recreate app`。正在登入中的使用者需重新按登入，既有 session 不受影響。

### 主機疑似遭入侵

1. 隔離網路（保留電源與磁碟，不要直接重灌）。
2. 保全證據（上方通用原則），並從異機備份確認最後一個可信備份組。
3. 在乾淨主機依 deployment.md 重建：使用建置機上原始的映像（核對 digest），**全部機密重新產生**（DB 三個角色、`session_secret`、Google client secret、TLS 私鑰），從可信備份還原（backup-restore.md）。
4. 執行「讓所有人登出」，並請 Workspace 管理員檢查所有 admin／finance 帳號。

### 掃描發現惡意附件

ClamAV 判定為 `infected` 或 `scan_failed` 的檔案不會提供下載（`attachments.scan_status`）。

1. 查上傳者與表單：`select id, form_type, form_id, uploaded_by_employee_id, created_at from attachments where scan_status = 'infected'`。
2. 確認上傳者帳號是否遭盜用（見上方情境）。
3. 檔案保留在隔離區作為證據，不要自行開啟。

## 定期輪替

| 機密 | 週期 | 影響 |
|---|---|---|
| `session_secret` | 每年或人員異動 | 登入中的使用者需重新登入 |
| DB 角色密碼（app／migrator／backup） | 每年或人員異動 | 依序更新機密檔與 DB，重新建立對應容器 |
| Google OAuth client secret | 每年或管理員異動 | 先新增再停用舊的，可無停機 |
| TLS 憑證 | 依憑證效期（到期前 30 天） | 更新檔案後 `$DC exec proxy nginx -s reload` |
| 異機備份 SSH key | 每年或人員異動 | 更新對端 authorized_keys |

管理員離職時，當天輪替他知道的所有機密，並移除主機帳號與 Docker 權限（加入 `docker` 群組等同 root）。
