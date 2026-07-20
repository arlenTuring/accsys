# ACCSYS — 台灣智慧駕駛電子採購與簽核系統

台灣智慧駕駛（Turing Drive）內部使用的電子採購與簽核系統，取代紙本請購／採購／驗收／費用申請流程，並提供對應的簽核、通知與預算維護功能。

## 技術棧

- **框架**：Next.js 15（App Router + Server Actions）、React 19、TypeScript 5（strict）
- **樣式**：Tailwind CSS 3
- **後端 / 資料庫**：Supabase（Postgres + Row Level Security + Auth + Storage）
- **測試**：Vitest（含真實資料庫整合測試）
- **登入**：Google OAuth（限公司網域）
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
    <domain>/actions.ts   Server Actions（服務端角色驗證 + service-role client 寫入）
    <domain>/queries.ts   讀取查詢（RLS-scoped client）
    <domain>/validate.ts  純函式輸入驗證
    approval/             簽核鏈建構邏輯
    auth/                 登入狀態、角色、白名單網域
    supabase/             Supabase client 工廠（server／service-role／browser）
supabase/migrations/      資料庫 schema（依時間戳記順序套用）
scripts/                  一次性資料匯入腳本（import-seed-data.ts 等）
tests/integration/        對真實 Supabase 專案執行的整合測試
docs/superpowers/         各階段開發計畫（specs／plans）與交接文件
```

## 環境需求

- Node.js >= 20
- npm
- 一個 Supabase 專案（Postgres + Auth 已啟用）

### 環境變數（`.env.local`）

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
ALLOWED_GOOGLE_DOMAIN=          # 僅允許此網域的 Google 帳號登入
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
# 安裝依賴
npm install

# 套用資料庫 migration（需先 supabase link 到目標專案）
supabase db push

# （選用）從內部參考檔匯入部門／員工／預算編號／供應商初始資料
npm run seed

# 啟動開發伺服器
npm run dev
```

開啟 http://localhost:3000，未登入會自動導向 `/login`；使用公司 Google 帳號登入後導向 `/dashboard`。

## 開發指令

```bash
npm run dev      # 啟動開發伺服器
npm run build    # 產生正式環境建置
npm run start    # 啟動已建置的正式環境伺服器
npm run lint      # ESLint 檢查
npm test          # 執行完整測試套件
npm run test:watch  # 監看模式
```

### 執行測試

整合測試會對**真實**已連結的 Supabase 專案讀寫資料，執行前需先把 `.env.local` 匯出到 shell，否則整合測試會被靜默跳過（而非失敗）：

```bash
export $(grep -v '^#' .env.local | xargs) && npm test
```

Node 20 缺少穩定的全域 WebSocket 支援，`npm test`／`npm run test:watch` 已內建 `NODE_OPTIONS=--experimental-websocket`；若要另外手動執行腳本操作 Supabase（例如 `npm run seed`），同樣需要加上這個環境變數。

## 資料庫

- Schema 定義於 `supabase/migrations/`，依檔名時間戳記循序套用。
- 讀取一律透過 RLS-scoped client（`createSupabaseServerClient`）；寫入透過 Server Actions 內的 service-role client（`createSupabaseServiceRoleClient`）搭配程式碼內角色驗證，RLS 僅作為最後一道防線。
- 資料表主要涵蓋：`departments`、`employees`、`budget_codes`、`suppliers`、`procurement_cases`、`purchase_requests`／`purchase_orders`／`acceptances`／`expense_requests`（各含明細表）、`approval_steps`、`notifications`、`attachments`。

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
- **組織架構與簽核關係人維護**：目前部門主管（`departments.manager_employee_id`）、總經理／董事長身分（`employees.is_general_manager`／`is_chairman`）只能透過 `npm run seed` 重新匯入 Excel 或直接在 Supabase Studio 手動修改，沒有網頁介面可以維護，財會／HR 無法自行調整組織異動。理想目標是規劃一個能**同步管理 Google Workspace 帳號、人員組織架構、與簽核系統設定**的機制（例如：新進/離職員工同步建立或停用系統帳號、組織異動時同步更新部門主管與簽核鏈依據的人員資料），而不是三邊分別手動維護。

## 已知限制

- Email／SMTP 尚未正式啟用寄送（程式邏輯已完成，缺少環境變數時會靜默略過，不影響簽核流程本身）。
- 專案型預算編號（透過 `npm run seed` 補匯入或 `/budget-codes` 匯入）若未指定負責人，需要有 `admin` 權限者到 Supabase Studio 手動指定，否則無法用於建立請購單。
- 編輯「預算編號」欄位本身（不是編輯其他欄位）會因為 upsert-on-code 的設計而變成新增一筆，而不是改名——之後可考慮把編輯模式下的預算編號欄位改成唯讀。
- 刪除預算編號沒有確認對話框（點了就刪，雖然被引用中的編號會被程式邏輯與資料庫外鍵雙重擋下）。
- 上線前的帳號治理（Supabase Organization／Vercel Team 轉移）為非程式碼的帳務/帳號操作，留待正式上線前另行處理。
