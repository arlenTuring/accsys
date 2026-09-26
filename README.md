# ACCSYS — 台灣智慧駕駛電子採購與簽核系統

台灣智慧駕駛（Turing Drive）內部使用的電子採購與簽核系統，取代紙本請購／採購／驗收／費用申請流程，並提供對應的簽核、通知與預算維護功能。

## 技術棧

- **框架**：Next.js 15（App Router + Server Actions）、React 19、TypeScript 5（strict）
- **樣式**：Tailwind CSS 3
- **後端 / 資料庫**：PostgreSQL 16 + Drizzle（本機 Docker；正式環境為公司地端主機）
- **測試**：Vitest
- **登入**：Google Workspace OIDC（Authorization Code + PKCE，openid-client）＋ PostgreSQL 可撤銷 session；本機可選開發登入
- **附件**：主機持久目錄
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
| 帳號與登入綁定 `/admin/accounts`（限 `admin`） | 核准／拒絕 Google 帳號綁定、撤銷綁定、停用／啟用員工、調整角色（需 15 分鐘內登入，全部寫入稽核） |
| 預算編號管理 `/budget-codes`（限 `finance`／`admin`） | 部門／專案預算編號的手動新增/編輯/刪除、Excel 批次匯入、專案主檔管理 |
| 財會簽核追蹤頁 `/case-tracking`（限 `finance`／`admin`） | 全公司案件依「簽核中／已完成／已撤回」分類，可依部門/日期/關鍵字篩選 |

### 角色權限

員工角色分為 `staff`（一般員工）、`finance`（財會）、`admin`（系統管理員），由 `employees.role` 決定；另有 `is_general_manager`／`is_chairman` 標記用於簽核鏈判斷。`admin` 除了專屬的 `/admin/master-data`，也可存取 `finance` 專屬頁面（`/budget-codes`、`/case-tracking`），方便系統管理員做整體驗證，不需另外切換帳號角色。

授權在伺服器端集中檢查（`src/lib/authz/forms.ts`），每個 query、action、API 都會檢查，不依賴頁面或按鈕隱藏：

| 操作 | 允許 |
|---|---|
| 讀取表單、附件（含直接網址） | 申請人、該單任一關簽核人、finance、admin；其他人一律視為「找不到」 |
| 核准／退回 | 只有目前關卡指定的簽核人（admin、finance 不會自動繞過） |
| 修改／撤回／重送 | 申請人，且符合既有狀態規則 |
| 由已核准單據建立後續採購／驗收／費用單 | 來源單據的申請人 |
| 案件總覽 `/cases/…` | 至少能讀其中一張單的人；讀不到的單顯示「無檢視權限」，不給 ID 與狀態 |
| 預算編號、專案維護；財會追蹤 | finance、admin（預算金額只給 finance／admin 看） |
| 帳號綁定、停權、角色 | admin |

費用申請單的完整銀行帳號只給申請人與 finance／admin；簽核人只看到末 4 碼。

### 附件

- 以附件 ID 下載（`/api/attachments/<id>`），每次重新檢查授權；一律以下載方式回應（`Content-Disposition: attachment`、`nosniff`、`CSP sandbox`）。
- 只接受 PDF／PNG／JPEG，**以檔案內容判斷**（副檔名與瀏覽器 MIME 不採信）；單檔 10 MB、每張表單 20 個。
- 儲存路徑由伺服器產生（UUID），原檔名只作顯示；讀檔限制在儲存根目錄內且不跟隨 symlink，寫檔不覆蓋既有檔案。
- 掃描：`ATTACHMENT_SCAN=clamav` 時每個上傳檔先放隔離區，由本機 clamd 掃描（檔案不送外部），通過才搬到正式位置。掃描失敗或逾時不會標為安全，保留在隔離區，由 `npm run attachments:rescan` 重試；中毒檔直接刪除。正式環境沒有掃描器會拒絕上傳；開發環境可 `ATTACHMENT_SCAN=disabled`（標記為「未掃描」，正式環境不提供下載）。
- 儲存目錄不在 `public/`，也不應由 reverse proxy 直接對外提供。

### 瀏覽器安全標頭

每個回應都有 CSP（script 使用每次請求的 nonce，不用 `unsafe-inline`／`unsafe-eval`；style 允許 inline）、`frame-ancestors 'none'`、`X-Frame-Options: DENY`、`nosniff`、`Referrer-Policy`、`Permissions-Policy`。HSTS 需在 HTTPS 與正式網域確認後以 `ENABLE_HSTS=true` 開啟。PDF 工具完全在瀏覽器執行，限制 30 MB、100 頁，停用 eval，不抓取外部資源。預算 Excel 匯入限制 5 MB、5000 列，並先檢查壓縮檔宣告的解壓大小（防 zip bomb）。

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
drizzle/                  版控 SQL migrations（由 src/lib/db/schema.ts 產生並人工審查）
db/
  roles.sql               資料庫角色與權限（DBA 執行）
  baseline-fingerprint.json  既有資料庫接管時比對用的結構指紋
  legacy/schema-v0.sql    導入 migrations 前的建表腳本（僅歷史／演練，勿再使用）
  seed-local-dev.sql      本機 dev 登入種子（勿用於正式環境）
  README.md               角色、migration 流程、接管既有 DB、敏感資料規則
scripts/                  一次性資料匯入腳本（import-seed-data.ts 等）
tests/integration/        資料庫整合測試（只連拋棄式 TEST_DATABASE_URL，見「執行測試」）
docs/superpowers/         各階段開發計畫（specs／plans）與交接文件
```

## 環境需求

- Node.js 24 LTS（版本固定於 `.nvmrc`：`nvm install && nvm use`）；Node 20 已於 2026-04-30 停止支援
- npm（以 `package-lock.json` 為準，安裝一律 `npm ci`）
- Docker（本機 Postgres、整合測試 DB、app 容器）

### 環境變數（`.env.local`）

完整範本與說明見 `.env.local.example`。主要項目：

```bash
DATABASE_URL=postgres://accsys_app:...@127.0.0.1:15432/accsys   # 最小權限帳號
MIGRATION_DATABASE_URL=postgres://accsys_migrator:...@...        # 只給 db:migrate
SESSION_SECRET=                      # 至少 32 字元
APP_ORIGIN=http://localhost:3001     # 固定網址；正式環境必須 https
AUTH_MODE=manual
ALLOWED_GOOGLE_DOMAINS=turing-drive.com
SESSION_TTL_HOURS=8
STORAGE_LOCAL_PATH=./data/attachments
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
# 本機略過 Google：只在 `next dev` 且旗標為 true 時生效；build／容器一律 404，共享環境勿開
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
npm run dev:all        # 啟動本機 Postgres、建立角色、套用 migrations、載入 dev 種子，再啟動 Next.js
npm run seed           # 選用：匯入部門／員工／預算編號／供應商
```

既有的本機 DB（P1 前建立）第一次跑 `npm run dev:all` 時會自動建立角色、核對結構後登記 baseline，再套用新 migrations；結構不符會停下並列出差異，不會修改資料。之後請把 `.env.local` 的 `DATABASE_URL` 改為最小權限的 `accsys_app`（見 `.env.local.example`）。

開啟 http://localhost:3000，未登入會自動導向 `/login`。`npm run dev`／`npm run start` 只綁定 127.0.0.1；需讓其他電腦連線時，應經 reverse proxy 與 HTTPS，不要直接改成 0.0.0.0。本機可開開發登入；正式環境用公司 Google 帳號登入後導向 `/dashboard`。

## 開發指令

```bash
npm run db:up    # 啟動本機 Postgres
npm run db:down  # 停止本機 Postgres
npm run dev      # 啟動開發伺服器
npm run build    # 產生正式環境建置
npm run start    # 啟動已建置的正式環境伺服器
npm run lint        # ESLint 檢查
npm run typecheck   # TypeScript（應用程式 + 測試）
npm test            # 單元測試（= test:unit，不連 DB）
npm run test:watch  # 監看模式
npm run check       # lint + typecheck + 單元測試 + production build
npm run app:up      # 以 Docker 啟動 Postgres + app 容器（http://127.0.0.1:3000）
```

### 執行測試

- **單元測試**（`npm test`）：不連資料庫、不讀 `.env.local`。
- **整合測試**（`npm run test:integration`）：只允許 `TEST_DATABASE_URL`，且資料庫名稱必須以 `_test` 結尾；未設定時整批失敗，不會略過，也不會改用 `DATABASE_URL`。
  - 業務測試以最小權限的 `accsys_app` 連線，確認 app 不需要 DDL／超級使用者權限。
  - `migrations.test.ts` 以 `TEST_ADMIN_DATABASE_URL`（只允許本機、`_test`）建立暫存資料庫，演練：空庫升級、舊腳本建立的有資料副本接管升級（ID／筆數／金額／外鍵不變）、重跑 no-op、兩個 migrator 併發、已套用檔案被改、結構漂移、各角色權限。

```bash
npm run test:db:up     # 拋棄式 Postgres（tmpfs，127.0.0.1:25432）：建立角色 → 真實 migrations → 假資料
TEST_DATABASE_URL=postgres://accsys_app:accsys_app_test@127.0.0.1:25432/accsys_test \
TEST_ADMIN_DATABASE_URL=postgres://accsys_test:accsys_test@127.0.0.1:25432/accsys_test \
  npm run test:integration
npm run test:db:down   # 刪除容器與資料
```

舊 Supabase RLS 測試（`tests/integration/*-rls.test.ts`）依賴已移除的 Supabase Auth／RLS，無法執行，已列於 `vitest.integration.config.ts` 的 `LEGACY_SUPABASE_RLS_TESTS` 並排除於 typecheck。它們**不算通過**，替代測試如下：

| 舊測試 | 原本驗證 | 替代（應用層授權測試） |
|---|---|---|
| master-data-rls | 員工可讀部門；staff 不可新增部門；admin 可新增／刪除 | P3：主檔 query／action 角色正負測試 |
| procurement-rls | 申請人、指定簽核人可讀請購單，無關員工不可；簽核人可讀全部步驟；前端不可直接寫入；收件人只能讀／標記自己的通知 | P3：請購 query／action 逐案授權與通知授權測試；P4：簽核交易內 actor 檢查。「前端不可直接寫 DB」改由 DB 不對瀏覽器開放 + P1 runtime 最小權限保證 |
| new-forms-rls | 採購／驗收／費用單及附件只給申請人、簽核人、finance；明細隨表頭授權；未授權者不可下載附件 | P3：三種表單、明細與附件 ID 授權測試（含直接 URL、他人附件 ID） |
| projects-rls | 員工可讀專案；staff 不可新增；admin 可新增／刪除 | P3：projects action 角色正負測試（`projects-actions.test.ts` 已部分涵蓋） |

替代測試完成後（P5）才刪除舊檔。

## 登入與帳號

- **協定**：Google OIDC Authorization Code + PKCE（S256）。每次登入產生獨立 state／nonce／verifier，10 分鐘內有效、只能用一次（伺服器端記錄 state 雜湊）；callback 無論成功或失敗都清除登入交易 cookie。
- **驗證**：ID token 簽章（JWKS）、issuer、audience、exp、nonce；`email_verified` 必須為 `true`；`hd` 與 email 網域都必須在 `ALLOWED_GOOGLE_DOMAINS`。授權網址裡的 `hd` 只是提示。
- **身分**：以 issuer + `sub` 對應員工（`employee_identities`），email 只是屬性。同一個 Google 帳號改 email 仍是同一位員工；不同 Google 帳號使用相同 email 會被拒絕並標記衝突。
- **綁定**：未綁定的帳號登入時只會建立申請（`identity_link_requests`），由管理員在 `/admin/accounts` 核准到指定員工；**不會**依 email 自動綁定，公司網域登入也不會自動取得權限。
- **Session**：cookie 只放隨機 token（`__Host-accsys_sid`，HttpOnly、Secure、SameSite=Lax），資料庫只存 SHA-256。絕對壽命預設 8 小時、不自動續期。每個請求都重新檢查 session、員工停用狀態、綁定狀態與目前角色；登出（POST）、停用、撤銷綁定立即失效。舊版只有 email 的 `accsys_session` cookie 一律丟棄。
- **CSRF／轉址**：Server Actions 使用 Next 內建來源檢查；登出等 route handler 要求 `Origin` 等於 `APP_ORIGIN`。所有轉址都用 `APP_ORIGIN`，不信任 Host／X-Forwarded-Host；`returnTo` 只接受站內路徑。
- **限速**：登入開始與 callback 依 `TRUSTED_CLIENT_IP_HEADER` 每 10 分鐘 30 次；管理操作每人每 10 分鐘 60 次（PostgreSQL 共用計數，固定視窗到期自動解除，不會永久鎖帳號）。
- **模式**：目前只支援 `AUTH_MODE=manual`；`directory`（Workspace 目錄同步、停權 freshness）屬 P6，設定成 directory 會拒絕啟動登入，不會降級放行。

### 第一位管理員（一次性 bootstrap）

1. 確認該員工在 `employees` 的角色為 `admin`。
2. 本人用 Google 登入，畫面顯示「等待管理員核准」。
3. 在伺服器 shell（不是網頁）執行：
   ```bash
   DATABASE_URL=postgres://accsys_app:***@HOST/accsys npm run auth:bootstrap -- --list
   DATABASE_URL=postgres://accsys_app:***@HOST/accsys npm run auth:bootstrap -- --request <申請 id> --employee <員工代碼>
   ```
4. 只要已有任何啟用中的 admin 綁定，這個命令就會拒絕；之後一律在 `/admin/accounts` 核准。

### 真實 Google 登入驗收（需公司授權，尚未執行）

自動化測試使用本機假 OIDC provider；以下需公司 Google Workspace 管理者配合：

1. 公司 Google API 專案建立 OAuth Client（Web application），已授權重新導向 URI 完全等於 `https://<正式 FQDN>/auth/callback`（測試環境另一組 client）。只需 `openid email profile`。
2. 用測試帳號確認：正常登入、非公司網域帳號被拒、未綁定帳號進入待核准、核准後可登入、停用後立即登出、登出後返回上一頁不能再操作。
3. 確認 Google 回傳 ID token 的 `iss` 為 `https://accounts.google.com`（程式嚴格比對 discovery 的 issuer）。
4. 確認主機可 outbound HTTPS 到 `accounts.google.com`、`oauth2.googleapis.com`、`www.googleapis.com`（JWKS），DNS 與時間同步正常。

## 資料庫

完整說明見 **[db/README.md](db/README.md)**。

- **結構定義**：`src/lib/db/schema.ts`（Drizzle）→ `npm run db:generate` 產生 `drizzle/` SQL → 審查
- **套用**：`npm run db:migrate`（獨立命令，使用 `MIGRATION_DATABASE_URL` / `accsys_migrator`；web 啟動不會自動跑）
- **既有資料庫**：`npm run db:baseline` 核對結構後接管，再 `db:migrate`
- **角色**：`db/roles.sql`；web 只用 `accsys_app`（無 DDL、無超級使用者）
- **容器**：`npm run app:migrate`（一次性 migration job），再 `npm run app:up`
- **示範資料**：`npm run seed:demo`；正式主檔：`npm run seed`（Excel）

授權在應用層檢查，不使用 RLS；資料庫以角色權限限制 app 帳號能做的事。

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
- 正式環境部署於公司地端主機（Docker Compose）；reverse proxy、HTTPS、備份屬 P7。
