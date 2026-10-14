# ACCSYS 資料庫

PostgreSQL 16（本機、測試與地端正式環境同一 major）。不使用 RLS；授權在應用層檢查，資料庫以角色權限限制「能做什麼」。

## 檔案

| 路徑 | 用途 |
|---|---|
| `src/lib/db/schema.ts` | **結構的唯一來源**（Drizzle）。約束／索引名稱與舊 SQL 腳本的 PostgreSQL 預設名稱一致 |
| `drizzle/` | 版控的 SQL migrations 與 drizzle-kit snapshot。已套用的檔案**不可修改** |
| `db/roles.sql` | 角色與權限（DBA 以超級使用者執行，可重複執行） |
| `db/baseline-fingerprint.json` | baseline（0000+0001）的結構指紋，供既有資料庫接管時比對 |
| `db/legacy/schema-v0.sql` | 導入 migrations 前的建表腳本，只保留作歷史與接管演練，**不可再用來建立或更新資料庫** |
| `db/seed-local-dev.sql` | 本機開發 admin 種子，**禁止用於任何共享環境** |
| `db/docker-init/00-roles.sh` | 本機／測試容器第一次啟動時建立角色與開發用密碼 |
| `scripts/db-migrate.ts` | `npm run db:migrate` |
| `scripts/db-baseline.ts` | `npm run db:baseline` |
| `scripts/db-fingerprint.ts` | 輸出任一資料庫的結構指紋（唯讀） |

## 角色

| 角色 | 登入 | 權限 | 用途 |
|---|---|---|---|
| `accsys_owner` | 否 | 擁有所有 schema 物件 | 只能經 `SET ROLE` 使用 |
| `accsys_migrator` | 是 | `accsys_owner` 成員 | 只給 migration 工作使用（`MIGRATION_DATABASE_URL`） |
| `accsys_app` | 是 | 業務表 SELECT/INSERT/UPDATE/DELETE、執行函式；無 DDL、無 TRUNCATE、看不到 `drizzle` schema；`audit_events` 只能 INSERT/SELECT | web 執行期（`DATABASE_URL`） |
| `accsys_backup` | 是 | `pg_read_all_data`，交易預設唯讀 | `pg_dump` |

`accsys_app` 在伺服器端被設定 `statement_timeout=30s`、`lock_timeout=10s`、`idle_in_transaction_session_timeout=60s`。

`audit_events` 另有 trigger：任何角色（含 owner）的 UPDATE／DELETE／TRUNCATE 都會失敗。

## 流程

migration 一律由獨立命令執行，web 啟動時**不會**自動跑。

```bash
# 空資料庫（新環境）
psql "postgres://DBA@HOST/accsys" -v ON_ERROR_STOP=1 -f db/roles.sql   # DBA，一次
#   接著由 DBA 以 \password 設定 accsys_migrator / accsys_app / accsys_backup 密碼
MIGRATION_DATABASE_URL=postgres://accsys_migrator:***@HOST/accsys npm run db:migrate

# 修改結構
#   1. 改 src/lib/db/schema.ts
#   2. npm run db:generate   → 產生 drizzle/NNNN_*.sql，人工審查
#      （函式、trigger 等 Drizzle 無法描述者：npx drizzle-kit generate --custom --name xxx）
#   3. 在拋棄式 DB 跑 npm run test:integration（含 migration 演練）
#   4. 部署時先跑 db:migrate，再更新 app
```

`db:migrate` 的保護：

- `pg_advisory_lock`：同時執行多個 migrator 時依序進行，每個 migration 只套用一次。
- 已套用 migration 的 checksum 與 `drizzle/` 檔案不符、或有比已套用者更舊卻未套用的 migration → 拒絕執行。
- 資料庫已有資料表但沒有 migration 紀錄 → 拒絕執行（避免重跑 CREATE TABLE），改走 `db:baseline`。
- 以 `accsys_owner` 身分建立物件，`accsys_app` 由 default privileges 自動取得 DML。

變更採 expand → backfill → validate → contract：先加新結構、補資料、驗證，舊結構等新程式穩定且回復窗口結束後才移除。禁止 drop-and-recreate。

## 接管既有資料庫（以舊 `db/schema.sql` 建立者）

```bash
pg_dump -Fc ... > before.dump                      # 先備份
psql "postgres://DBA@HOST/accsys" -v ON_ERROR_STOP=1 -f db/roles.sql
#   設定三個 LOGIN 角色密碼（\password）
MIGRATION_DATABASE_URL=... npm run db:baseline     # 比對結構指紋；不符則列出差異、不寫入任何東西
MIGRATION_DATABASE_URL=... npm run db:migrate      # 套用 0002 以後
#   app 的 DATABASE_URL 改用 accsys_app
```

`db:baseline` 只寫 migration metadata（`drizzle.__drizzle_migrations`），不改資料或結構；已接管的資料庫重跑為 no-op。`db/roles.sql` 會把舊物件的擁有者改為 `accsys_owner`（需要超級使用者）。

正式資料庫接管前，應先以 `pg_dump --schema-only` 或 `scripts/db-fingerprint.ts` 取得結構快照，在拋棄式環境演練整個流程。

## 敏感資料規則

| 類別 | 欄位 | 規則 |
|---|---|---|
| 金融 | `suppliers.bank_account`、`expense_requests.bank_account`（及 `bank_name`、`account_name`） | 不寫入 log、錯誤訊息或 `audit_events.details`；需要時只記遮罩後末 4 碼。列表／案件總覽不回傳，依職責顯示（P3） |
| 個資 | `employees.google_email`、`employee_identities.email`、供應商聯絡人電話／email、`tax_id` | 不寫入 log；audit 只記 ID |
| 憑證 | `app_sessions.token_hash` | 只存 SHA-256；原始 token 只在 cookie，不寫入 DB、log、audit |
| 時間 | 事件時間 `timestamptz`；業務日期 `date` | 程式收到的是 PostgreSQL 字串（不轉成 JS `Date`），避免時區位移 |
| 金額 | `numeric(14,2)` | 以字串進出資料庫；計算不可用浮點累加（P4 統一為整數分／decimal） |

資料庫錯誤訊息（可能含 SQL、約束名稱、參數值）不回傳給呼叫端：`src/lib/db/app-client.ts` 只回 `database_error (ref xxxxxxxx)`，完整內容以同一個 ref 記在伺服器 log。

## 備份與還原

正式環境以 `deploy/compose.prod.yml` 的 `backup` 工作（`accsys_backup` 唯讀帳號）每日產生 DB dump + 附件 tar + SHA256SUMS，`deploy/backup/restore-drill.sh` 在無網路的拋棄式容器還原並核對權限、audit trigger 與附件 checksum。流程、異機保存與災難還原見 [docs/operations/backup-restore.md](../docs/operations/backup-restore.md)。

還原順序：先建立四個角色 → `pg_restore --exit-on-error`（保留擁有者與權限）→ 重新套用 `db/roles.sql`（資料庫層級權限與角色設定不在 dump 裡）。

WAL／PITR 尚未啟用（目前 RPO 約 24 小時）。
