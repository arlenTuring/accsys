# ACCSYS — 台灣智慧駕駛電子採購與簽核系統

台灣智慧駕駛（Turing Drive）內部使用的電子採購與簽核系統，取代紙本請購／採購／驗收／費用申請流程，並提供對應的簽核、通知與預算維護功能。

## 技術棧

- **框架**：Next.js 15（App Router + Server Actions）、React 19、TypeScript 5（strict）
- **樣式**：Tailwind CSS 3
- **後端 / 資料庫**：PostgreSQL（本機 Docker；正式環境 Cloud SQL）+ Drizzle
- **測試**：Vitest
- **登入**：Google OAuth（限公司網域；本機可選開發登入）
- **附件**：本機檔案目錄（正式環境改 Cloud Storage）
- **Email 通知**：Nodemailer（SMTP，目前程式已就緒但尚未啟用寄送）

## 功能總覽

| 模組 | 說明 |
|---|---|
| 請購單 `/requests` | 建立請購申請、多層簽核、退回重送、送出後第一關審核前可自行修改／撤回 |
| 採購單 `/purchase-orders` | 由已核准請購單衍生，供應商比價、簽核、送出後第一關審核前可自行修改／撤回 |
| 驗收單 `/acceptances` | 採購單驗收、財產編號登錄（限已核准後填寫）、送出後第一關審核前可自行修改／撤回 |
| 費用申請單 `/expense-requests` | 費用申報與核銷簽核、送出後第一關審核前可自行修改／撤回；金額低於 NT$10,000 可免走採購流程直接建立獨立費用申請單 |
| 附件上傳 | 四張表單皆可上傳附件（PDF／圖片） |
| 案件總覽 `/cases/[caseNumber]` | 依案號串聯四張表單狀態，顯示「憑證待補」提醒 |
| 待簽核清單 `/approvals` | 目前登入者所有待簽核項目彙總 |
| 通知中心 `/notifications` | 簽核／退回等系統通知 |
| 主檔資料總覽 `/admin/master-data`（限 `admin`） | 部門、員工、預算編號、供應商唯讀總覽 |
| 預算編號管理 `/budget-codes`（限 `finance`／`admin`） | 部門／專案預算編號的手動新增/編輯/刪除、Excel 批次匯入、專案主檔管理 |
| 財會簽核追蹤頁 `/case-tracking`（限 `finance`／`admin`） | 全公司案件依「簽核中／已完成／已撤回」分類，可依部門/日期/關鍵字篩選 |

### 角色權限

員工角色分為 `staff`（一般員工）、`finance`（財會）、`admin`（系統管理員），由 `employees.role` 決定；另有 `is_general_manager`／`is_chairman` 標記用於簽核鏈判斷。`admin` 除了專屬的 `/admin/master-data`，也可存取 `finance` 專屬頁面（`/budget-codes`、`/case-tracking`），方便系統管理員做整體驗證，不需另外切換帳號角色。

## 專案結構

```
src/
  app/                    Next.js App Router 頁面與 Server Components
  lib/
    <domain>/actions.ts   Server Actions（服務端角色驗證後寫入 Postgres）
    <domain>/queries.ts   讀取查詢
    <domain>/validate.ts  純函式輸入驗證
    approval/             簽核鏈建構邏輯
    auth/                 Google OAuth、session、角色、白名單網域
    db/                   Postgres client（Drizzle schema + 查詢層）
    storage/              本機附件儲存（之後換 GCS）
db/
  schema.sql              Postgres DDL（唯一結構來源，可套用到任意 Postgres）
  seed-local-dev.sql      本機 dev 登入種子（勿用於正式環境）
  README.md               資料庫結構說明、ER 圖、GCP 搬遷步驟
  init.sql                Docker 掛載說明（實際用 schema + seed 兩檔）
scripts/                  一次性資料匯入腳本（import-seed-data.ts 等）
tests/integration/        資料庫整合測試（需 DATABASE_URL 且 RUN_DB_INTEGRATION=1）
docs/superpowers/         各階段開發計畫（specs／plans）與交接文件
```

## 環境需求

- Node.js >= 20
- npm
- Docker Desktop（本機 Postgres）

### 環境變數（`.env.local`）

```bash
DATABASE_URL=postgres://accsys:accsys@localhost:15432/accsys
SESSION_SECRET=                      # 至少 32 字元
ALLOWED_GOOGLE_DOMAIN=turing-drive.com
STORAGE_LOCAL_PATH=./data/attachments
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
# 本機略過 Google（正式環境勿開）
DEV_LOGIN_EMAIL=
NEXT_PUBLIC_DEV_LOGIN=false
# Email 通知（目前程式碼已支援，尚未正式啟用寄送）
SMTP_HOST=
SMTP_PORT=
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=
```

`.env.local` 內含真實憑證，**絕不可提交到版本控制**。

## 開始使用

```bash
cp .env.local.example .env.local
# 編輯 SESSION_SECRET（至少 32 字元）；本機可設 NEXT_PUBLIC_DEV_LOGIN=true 與 DEV_LOGIN_EMAIL

npm install
npm run db:up          # 啟動本機 Postgres（需 Docker）
npm run seed           # 選用：匯入部門／員工／預算編號／供應商
npm run dev
```

開啟 http://localhost:3000，未登入會自動導向 `/login`。本機可開開發登入；正式環境用公司 Google 帳號登入後導向 `/dashboard`。

## 開發指令

```bash
npm run db:up    # 啟動本機 Postgres
npm run db:down  # 停止本機 Postgres
npm run dev      # 啟動開發伺服器
npm run build    # 產生正式環境建置
npm run start    # 啟動已建置的正式環境伺服器
npm run lint      # ESLint 檢查
npm test          # 執行測試套件
npm run test:watch  # 監看模式
```

### 執行測試

預設只跑單元測試。資料庫整合測試需本機 Postgres，並加上 `RUN_DB_INTEGRATION=1`：

```bash
export $(grep -v '^#' .env.local | xargs) && RUN_DB_INTEGRATION=1 npm test
```

## 資料庫

完整說明見 **[db/README.md](db/README.md)**。

- **結構定義**：`db/schema.sql`（18 張表 + 5 個 stored procedures）
- **ORM 對應**：`src/lib/db/schema.ts`（Drizzle，需與 SQL 同步）
- **本機**：`npm run db:up`（Docker 第一次啟動自動套用 schema）
- **任意 Postgres**：`npm run db:schema:apply`（GCP VM、自建 DB 等）
- **示範資料**：`npm run seed:demo`；正式主檔：`npm run seed`（Excel）

權限在應用層（Server Actions）檢查，不使用 Supabase RLS。之後搬 GCP 只需改 `DATABASE_URL`，不必先上 Cloud SQL 代管。

## 開發歷程

本專案採用分階段規劃與 AI 輔助的 subagent-driven 開發流程實作，各階段的設計文件與實作計畫收錄於 `docs/superpowers/`：

1. **地基篇 + 請購單／簽核引擎篇** — 專案骨架、Google OAuth 登入、主檔資料、請購單與簽核鏈
2. **採購單／驗收單／費用申請單 + 附件與 Email 通知篇** — 其餘三張表單、附件上傳、案件總覽頁、Email 通知（程式就緒未啟用）
3. **工作流程清理篇** — 死路徑修正、登入錯誤訊息、共用表單型別模組、ESLint 修復、台灣時區案號、CAS 併發保護、憑證待補提醒、專案型預算編號支援
4. **預算編號基礎資料管理** — 財會可透過網頁手動維護或 Excel 批次匯入預算編號
5. **財會簽核追蹤頁** — `/case-tracking`，財會人員可依部門／日期／關鍵字篩選，追蹤全公司所有案件的簽核狀態（簽核中／已完成兩個頁籤）
6. **預算後台強化與工作流程彈性** — 新增獨立 `projects` 主檔（取代原本 `budget_codes.project_code` 純文字欄位）、`/budget-codes` 支援專案下拉選單與專案管理區塊；新增金額低於 NT$10,000 可免走採購流程的獨立費用申請單；四張表單新增「送出後、第一關審核前可自行修改或撤回」能力；`/case-tracking` 新增「已撤回」頁籤；`admin` 角色開放存取 `/budget-codes`、`/case-tracking`

尚未規劃的較大範圍功能，留待後續獨立規劃，不在目前範圍內：

- 年度預算按月編列、預算新增／變更申請書、預算執行追蹤與超支警示
- 簽核追蹤頁的報表匯出（給記帳士/會計師事務所）
- **組織架構與簽核關係人維護**：目前部門主管（`departments.manager_employee_id`）、總經理／董事長身分（`employees.is_general_manager`／`is_chairman`）只能透過 `npm run seed` 重新匯入 Excel 或直接改資料庫，沒有網頁介面可以維護。

## 已知限制

- Email／SMTP 尚未正式啟用寄送（程式邏輯已完成，缺少環境變數時會靜默略過，不影響簽核流程本身）。
- 專案型預算編號若未指定負責人，需在資料庫手動指定 `owner_employee_id`，否則無法用於建立請購單。
- 編輯「預算編號」欄位本身（不是編輯其他欄位）會因為 upsert-on-code 的設計而變成新增一筆，而不是改名——之後可考慮把編輯模式下的預算編號欄位改成唯讀。
- 刪除預算編號沒有確認對話框（點了就刪，雖然被引用中的編號會被程式邏輯與資料庫外鍵雙重擋下）。
- 正式環境將部署於 GCP：Cloud Run + Cloud SQL + Cloud Storage（尚未接上專案）。
