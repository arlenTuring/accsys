# ACCSYS 資料庫結構

ACCSYS 使用 **PostgreSQL 14+**（純 Postgres，無 Supabase RLS）。權限由 Next.js Server Actions 在應用層檢查，不在 DB 層做 row-level security。

## 檔案一覽

| 檔案 | 用途 |
|------|------|
| **`schema.sql`** | **DDL 唯一來源**：所有資料表、索引、check constraint、stored procedures |
| `seed-local-dev.sql` | 本機開發用最小種子（dev 登入帳號），**勿用於正式環境** |
| `init.sql` | 說明檔；Docker 實際掛載的是上面兩個 SQL |
| `../src/lib/db/schema.ts` | Drizzle ORM 型別定義（應用程式讀寫用，需與 `schema.sql` 同步） |
| `../scripts/apply-schema.ts` | 對任意 Postgres 套用 `schema.sql` |
| `../scripts/seed-demo-data.ts` | UI 示範假資料（可重複執行） |
| `../scripts/import-seed-data.ts` | 從 Excel 匯入正式主檔 |

> 舊版 `supabase/migrations/` 為歷史遺留，**不再使用**；新環境請只用 `db/schema.sql`。

## 實體關係（簡圖）

```
departments ──┬── employees (role, google_email)
              └── budget_codes (department 或 project 擇一)

procurement_cases (case_number CP{YYYMM}{####})
  ├── purchase_requests ── purchase_request_items
  ├── purchase_orders   ── purchase_order_items
  ├── acceptances       ── acceptance_items
  └── expense_requests  ── expense_request_items

approval_steps  ── 多型關聯 (form_type + form_id)
notifications     ── 依 recipient_employee_id
attachments       ── 依 form_type + form_id（檔案存 GCS / 本機目錄）
```

## 資料表（18 張）

### 主檔

| 表 | 說明 |
|----|------|
| `departments` | 部門代碼、名稱、主管 |
| `employees` | 員工、Google 登入 email、角色 (`staff`/`finance`/`admin`)、GM/董事長標記 |
| `projects` | 專案主檔（專案型預算用） |
| `budget_codes` | 預算編號（部門型或專案型二擇一） |
| `suppliers` | 供應商主檔 |

### 採購流程

| 表 | 說明 |
|----|------|
| `procurement_cases` | 案件根節點，案號唯一 |
| `case_number_counters` | 案號流水號（台灣時區民國年月） |
| `purchase_requests` / `_items` | 請購單 |
| `purchase_orders` / `_items` | 採購單（一案件一張） |
| `acceptances` / `_items` | 驗收單 |
| `expense_requests` / `_items` | 費用申請（可連 PO 或獨立 budget_code） |

### 共用

| 表 | 說明 |
|----|------|
| `approval_steps` | 簽核步驟（pending / approved / returned） |
| `notifications` | 站內通知 |
| `attachments` | 附件 metadata（`storage_path` 指向物件儲存） |

### Stored procedures

| 函式 | 說明 |
|------|------|
| `next_case_number()` | 產生 `CP115080001` 格式案號 |
| `resubmit_purchase_request()` | 退回後重送（transaction） |
| `resubmit_purchase_order()` | 同上 |
| `resubmit_acceptance()` | 同上 |
| `resubmit_expense_request()` | 同上 |

## 本機使用

```bash
# 1. 啟動 Docker Postgres（第一次會自動跑 schema + seed-local-dev）
npm run db:up

# 2. 若 DB 已存在、需手動補 schema（例如自建 Postgres）
npm run db:schema:apply

# 3. 選用：UI 示範假資料
npm run seed:demo

# 4. 選用：Excel 主檔匯入
npm run seed
```

連線字串（預設）：

```
postgres://accsys:accsys@localhost:15432/accsys
```

## 搬到 GCP（暫不使用 Cloud SQL 代管時）

你可以先在 **Compute Engine VM** 或任何能跑 Postgres 的地方自建資料庫，應用程式（Cloud Run）只改 `DATABASE_URL` 即可。

### 1. 建立空資料庫

```bash
createdb accsys
# 或在 VM 上：sudo -u postgres createdb accsys
```

### 2. 套用結構

```bash
export DATABASE_URL=postgres://USER:PASS@HOST:5432/accsys
npm run db:schema:apply
# 或
psql "$DATABASE_URL" -f db/schema.sql
```

### 3. 匯入主檔（不要用 seed-local-dev.sql）

```bash
npm run seed          # Excel 員工/預算/供應商
# 不要執行 seed-local-dev.sql
```

### 4. 設定 Cloud Run

在 Secret Manager 或環境變數設定 `DATABASE_URL`，指向你的 Postgres 實例（需開 Private IP / Cloud SQL Auth Proxy 或防火牆白名單）。

### 之後若改 Cloud SQL

流程相同：`psql` 或 `npm run db:schema:apply` 套 schema，再 `pg_dump` / `pg_restore` 遷移資料。應用程式不需改 schema 定義。

## 備份與還原

```bash
# 備份
pg_dump "$DATABASE_URL" -Fc -f accsys-backup.dump

# 還原到新 DB
pg_restore -d "$NEW_DATABASE_URL" --clean --if-exists accsys-backup.dump
```

## 與 Drizzle 的關係

- **SQL 是 source of truth**（`db/schema.sql`）
- `src/lib/db/schema.ts` 供 TypeScript 型別與 Drizzle 查詢
- 修改結構時：先改 `schema.sql` → 同步改 `schema.ts` → 套用到各環境

```bash
# 可選：比對 Drizzle 產生的 migration（目前專案以 SQL 為主）
npx drizzle-kit generate
```
