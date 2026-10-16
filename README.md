# ACCSYS — 台灣智慧駕駛電子採購與簽核系統

台灣智慧駕駛（Turing Drive）內部使用的電子表單與簽核平台。員工以公司 Google 帳號登入，填寫／簽核各類申請；系統管理員以「表單設計器」與「組織設定」維護流程，財會人員追蹤案件與維護預算／財產。

管理員操作說明見應用內 **[系統操作教學](/admin/guide)**（需具備系統管理相關權限）。

## 技術棧

- **框架**：Next.js 16（App Router + Server Actions）、React 19、TypeScript 5（strict）
- **樣式**：Tailwind CSS 3
- **資料庫**：PostgreSQL 16 + Drizzle（本機 Docker；正式環境地端或 GCP VM，同一套 Compose）
- **測試**：Vitest
- **登入**：Google Workspace OIDC（Authorization Code + PKCE）＋可撤銷 session
- **附件**：主機目錄儲存；正式環境須 ClamAV 掃描
- **Email**：Nodemailer（SMTP 程式已就緒，寄送尚未正式啟用）

## 誰在用、做什麼

| 角色概念 | 說明 |
|---|---|
| 一般員工 | Google 登入後填單、看自己的申請、簽核指派給自己的關卡 |
| 簽核人 | 在「待簽核」核准／退回；權限不足時看不到無關單據 |
| 財會 | 視權限使用簽核追蹤、預算編號、財產清冊；可讀較多單據與敏感欄位 |
| 系統管理 | 帳號綁定、權限角色、組織與簽核、表單設計器、主檔；細節以權限勾選為準 |

實際能進哪些選單，由員工身上的**權限角色**（`access_roles`）決定，不是寫死三種帳號類型而已。內建預設角色：`staff`（一般）、`finance`（財會）、`admin`（全部權限，不可刪）。可另建自訂角色並勾選權限。

兩個常被搞混的概念：

- **權限角色**：能進「系統管理／財會管理」等功能 → 在「帳號與權限」維護
- **職務類別**（如總經理、單位主管）：只影響**簽核關卡解析**與表單可填寫範圍 → 在「組織與簽核」維護

## 功能地圖

### 日常使用

| 功能 | 路徑／入口 | 說明 |
|---|---|---|
| 工作台 | `/dashboard` | 登入後總覽 |
| 待簽核 | `/approvals` | 指派給目前使用者的簽核項目 |
| 申請表單 | 導覽「申請表單」或 `/forms` | 已發佈表單（含設計器表單）；填寫多在 `/f/<代號>/…` |
| 我的申請 | 導覽「我的申請」 | 各類自己送出的單據清單 |
| 案件總覽 | `/cases/[案號]` | 同一案件下多張單據狀態串聯 |
| 通知 | `/notifications` | 簽核／退回等通知 |
| 工具區 | `/tools` | 如瀏覽器端 PDF 工具 |

多數業務表單（請購、採購、驗收、費用、差旅、用印、資產異動等）已可改由**表單設計器**發佈；發佈後選單改走新版，舊單據仍可在原路徑檢視與簽核。

### 財會管理（需對應權限）

| 功能 | 路徑 | 說明 |
|---|---|---|
| 簽核追蹤 | `/case-tracking` | 全公司案件（簽核中／已完成／已撤回） |
| 預算編號管理 | `/budget-codes` | 預算編號與專案維護、Excel 匯入 |
| 財產保管清冊 | `/assets` | 財產保管人、地點、狀態 |

### 系統管理（需對應權限）

| 功能 | 路徑 | 說明 |
|---|---|---|
| 帳號與權限 | `/admin/accounts` | Google 綁定核准、停用／啟用、指派權限角色；另有「權限角色」分頁 |
| 組織與簽核 | `/admin/org` | 部門、員工、組織層級、職務類別、群組、代理人、流程模擬、人員同步 |
| 表單設計器 | `/admin/form-builder` | 欄位、簽核流程、發佈／暫停／複製／刪除 |
| 主檔資料 | `/admin/master-data` | 部門／員工／預算／供應商等總覽 |
| 系統操作教學 | `/admin/guide` | 系統管理圖文操作說明 |

## 簽核與表單（精要）

- 簽核流程以「積木」定義：指定人員、部門主管、組織層級、職務類別、群組、表單關係人、條件分支等；送出當下解析成固定步驟，之後組織異動不影響已送出的單（重送會重算）。
- 代理人依日期與表單範圍生效；重複出現的簽核人可能由系統代簽（明確「申請人確認」除外）。
- 設計器表單以版本發布：已送出單據永遠依送出當時版本；暫停後不能新填，既有單照常簽核。
- 授權在伺服器檢查：讀單、附件、核准／退回都不依賴「按鈕有沒有顯示」。
- 敏感欄位（如帳號）對一般簽核人遮罩；具敏感權限者可見全文。

更細的設計器欄位規則、遷移批次差異、資安與部署手冊見 `docs/` 與程式註解，不在本 README 展開。

## 專案結構

```
src/
  app/                    Next.js App Router 頁面與 Server Components
  lib/
    <domain>/actions.ts   Server Actions（服務端授權後寫入）
    <domain>/queries.ts   讀取查詢
    approval/             簽核流程引擎
    auth/                 Google OAuth、session
    authz/                權限角色與授權檢查
    admin/                系統管理（帳號、組織、權限角色…）
    form-builder/         表單設計器
    custom-forms/         自訂／已遷移表單定義
    db/                   Drizzle schema 與連線
    attachments/          附件上傳、掃描、下載
drizzle/                  版控 SQL migrations
db/                       角色、baseline、本機種子（勿用於正式）
deploy/                   正式 Compose／nginx／備份
docs/operations/          部署、備份、GCP VM 檢核
scripts/                  匯入、bootstrap、目錄同步等
tests/integration/        拋棄式測試 DB 整合測試
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
# 登入：Google OAuth；員工 google_email 與 Workspace 信箱相符且尚未綁定時會自動綁定並登入，否則進待核准。
SESSION_TTL_HOURS=8
STORAGE_LOCAL_PATH=./data/attachments
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
# 示範角色登入（預設關閉）。僅 `next dev` + 旗標 true + APP_ORIGIN 為 localhost 時可用；正式環境勿開
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

最簡單的方式是在專案根目錄執行：

```bash
./start.sh             # 開 Docker Desktop → Postgres → 角色／migrations／dev 種子 → Next.js（前台與後台 API），就緒後自動開瀏覽器
./start.sh --seed      # 同上，並匯入示範假資料
./start.sh --port 3005 # 指定 port（預設 3001）
./start.sh --no-open   # 不自動開瀏覽器
./start.sh --stop      # 關閉本專案的 Next.js 與資料庫容器（資料保留在 volume）
```

重複執行會先關掉本專案先前啟動的 Next.js／啟動腳本（只認工作目錄在本專案內的程序），再重新啟動；資料庫容器若卡在 unhealthy 會自動重啟。port 被其他程式占用時不會關掉它，而是往後找空的 port，並以環境變數覆寫 `APP_ORIGIN` 讓登入可用。`.env.local` 不存在時會從範本建立（隨機 `SESSION_SECRET`、開啟 dev 登入）。

手動步驟：

```bash
cp .env.local.example .env.local
# 編輯 SESSION_SECRET（至少 32 字元）；並設定 GOOGLE_CLIENT_ID／GOOGLE_CLIENT_SECRET

npm install
npm run dev:all        # 啟動本機 Postgres、建立角色、套用 migrations、載入 dev 種子，再啟動 Next.js
npm run seed           # 選用：匯入部門／員工／預算編號／供應商
```

既有的本機 DB（P1 前建立）第一次跑 `npm run dev:all` 時會自動建立角色、核對結構後登記 baseline，再套用新 migrations；結構不符會停下並列出差異，不會修改資料。之後請把 `.env.local` 的 `DATABASE_URL` 改為最小權限的 `accsys_app`（見 `.env.local.example`）。

開啟 http://localhost:3001，未登入會自動導向 `/login`，以「使用 Google 帳號登入」進入（公司 Workspace）。`npm run dev`／`npm run start` 只綁定 127.0.0.1；需讓其他電腦連線時，應經 reverse proxy 與 HTTPS，不要直接改成 0.0.0.0。

## 開發指令

```bash
npm run db:up    # 啟動本機 Postgres
npm run db:down  # 停止本機 Postgres
npm run dev      # 啟動開發伺服器
npm run build    # 產生正式環境建置
npm run start           # 啟動已建置的正式環境伺服器（雲端須 HTTPS）
npm run start:prod-local # 本機正式建置預覽（自動 ALLOW_HTTP_LOCALHOST）
./start.sh --prod        # 建置並以正式模式啟動（同 start:prod-local，含 DB）
npm run lint        # ESLint 檢查
npm run typecheck   # TypeScript（應用程式 + 測試）
npm test            # 單元測試（= test:unit，不連 DB）
npm run test:watch  # 監看模式
npm run check       # lint + typecheck + 單元測試 + production build
npm run app:up      # 以 Docker 啟動 Postgres + app 容器（http://127.0.0.1:3000）
```

### 依賴與基底映像

- 安裝一律 `npm ci`（`scripts/start-dev.sh` 也是）。npm 11 預設不執行未核准的 install script；目前 esbuild／unrs-resolver 的 postinstall 未核准，不影響建置與測試。
- CI 對正式依賴執行 `npm audit --omit=dev --audit-level=high`，有 high／critical 即失敗。開發／建置工具的告警逐項判斷，不使用 `npm audit fix --force`。
- Next 依賴的 postcss 以 `overrides` 統一為專案版本（8.5.x）。
- 目前已判斷不影響執行環境、暫不處理的告警：Tailwind 3 與 eslint-config-next 底下的 `braces` 3.0.3（GHSA-vfj7-8cjw-p6xm，尚無修補版；只在建置／lint 時展開設定檔裡的固定 glob，不接觸使用者輸入；修正需升級 Tailwind 4）、drizzle-kit 底下的 esbuild（開發工具）、exceljs 依賴的 uuid（只用 v4，告警在 v3/v5/v6）。
- Node 基底映像與 PostgreSQL 映像以 digest 固定（`Dockerfile`、`docker-compose*.yml`、CI）。更新方式：查官方映像同 tag 的新 digest（例如 `docker buildx imagetools inspect node:24.21.0-bookworm-slim`），四處一起替換後重跑 CI 與容器冒煙測試。
- 字型（Inter、Noto Sans TC）由 `@fontsource` 套件隨 lockfile 打包，build 與執行時都不連 Google Fonts；Docker build 只需要 npm registry。
- 支援期限（2026-10 查核）：Node 24 維護到 2028-04；PostgreSQL 16 到 2028-11；Next.js 已升級 16.4（15 的維護期到 2026-10-21 結束）。Next 16 的 request 攔截檔為 `src/proxy.ts`（原 `middleware.ts`，改在 Node runtime 執行）。

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
- **綁定**：若員工主檔已登錄相同公司 Workspace 信箱（`employees.google_email`）且尚未綁定，首次 Google 登入會**自動綁定**並進入系統；否則建立待核准申請（`identity_link_requests`），由管理員在 `/admin/accounts` 核准。僅通過公司網域檢查不會自動取得管理權限。
- **Session**：cookie 只放隨機 token（`__Host-accsys_sid`，HttpOnly、Secure、SameSite=Lax），資料庫只存 SHA-256。絕對壽命預設 8 小時、不自動續期。每個請求都重新檢查 session、員工停用狀態、綁定狀態與目前角色；登出（POST）、停用、撤銷綁定立即失效。舊版只有 email 的 `accsys_session` cookie 一律丟棄。
- **CSRF／轉址**：Server Actions 使用 Next 內建來源檢查；登出等 route handler 要求 `Origin` 等於 `APP_ORIGIN`。所有轉址都用 `APP_ORIGIN`，不信任 Host／X-Forwarded-Host；`returnTo` 只接受站內路徑。
- **限速**：登入開始與 callback 依 `TRUSTED_CLIENT_IP_HEADER` 每 10 分鐘 30 次；管理操作每人每 10 分鐘 60 次（PostgreSQL 共用計數，固定視窗到期自動解除，不會永久鎖帳號）。
- **模式**：目前只支援 `AUTH_MODE=manual`；設定成 `directory` 會拒絕啟動登入，不會降級放行。
- **Workspace 目錄同步（P6）**：`src/lib/directory/` 解析 Directory `users.list`（逐頁驗證網域／customer、重複 ID、重複分頁 token、429／5xx 重試、401／403 立即停止；任何一頁失敗就整批放棄，不用部分名單）並產生同步計畫：只撤銷 suspended／archived 帳號的綁定與 session、email 跟隨目錄。名單為空、啟用人數比上次少 20% 以上、撤銷數超過 max(5, 10%) 時拒絕套用並寫 audit。同步不會建立員工、不會恢復被停權或本地停用的帳號，也不改 `employees.access_enabled`。套用時把名單寫入目錄快照（`directory_users`，含電話、職稱、部門、員工編號、主管；完整名單中不再出現的帳號標記為已移除），每次執行（成功／拒絕／失敗）記錄在 `directory_sync_runs`。
  - **授權**：專用的 Desktop OAuth client，只要求 `admin.directory.user.readonly`（多給的 scope 會被拒絕）。由公司核准的最小權限帳號在伺服器上執行一次 `npm run directory:authorize -- --out /etc/accsys/secrets/gws_directory_refresh_token`（127.0.0.1 回呼＋PKCE，token 只寫入 0600 檔案、不顯示）。同步工作需要 `GWS_DIRECTORY_CLIENT_ID`、`GWS_DIRECTORY_CLIENT_SECRET(_FILE)`、`GWS_DIRECTORY_REFRESH_TOKEN(_FILE)`、`GWS_CUSTOMER_ID`、`ALLOWED_GOOGLE_DOMAINS`；網站本身不持有這些憑證。
  - **執行**：`npm run directory:dry-run -- --fixture <users-pages.json>`（只讀、不寫入）、`directory:dry-run -- --live`（讀正式名單、不寫入）、`npm run directory:sync`（`--live --apply`）。正式環境由 `deploy/systemd/accsys-directory-sync.timer` 每 15 分鐘執行 compose 的 `directory-sync` 服務（profile `tools`）；fixture 一律不能 `--apply`，拒絕或失敗時 exit 1。
  - **審查（`/admin/org/directory`「人員同步」）**：顯示同步模式（`AUTH_MODE`）、Workspace 授權狀態（依最近一次 `source=directory` 的執行結果判斷：無紀錄＝尚未授權或未執行，失敗＝授權可能失效）、最近同步與執行紀錄，並依快照列出：新進人員（啟用但未綁定的帳號；可依目錄資料建立員工，管理員選員工編號、部門、一般員工／財會角色，並可一併指定職務與範圍（所選部門或全公司，經組織設定服務寫入、需 1 小時內登入）；與目錄部門同名的部門會預先選好、目錄主管 Email 只顯示為提示；Workspace 電話結尾的 `#123`、`ext. 123`、`分機 123`、`轉 123` 拆成分機；以 Email 或員工編號比對到的既有員工只作建議）、資料異動（已綁定員工的姓名、Email、電話、分機、職稱與目錄不同，逐欄勾選、可批次套用，值由伺服器從快照重讀，同批次任一失敗全部不套用；目錄部門只提示）、離職／停權（已停權、封存、移除或目錄中找不到綁定帳號，但仍可使用的員工，列出其待簽關卡供交接後再停用）。建立員工**不會**建立登入綁定，本人首次登入後仍需在 `/admin/accounts` 核准。若沒有任何綁定能對應到目錄帳號，頁面會警告目錄 ID 可能不等於登入 `sub`，且不列出「找不到」的離職清單。
  - **授權前的手動模式（`/admin/org/employees`「員工」）**：列表可依文字、部門、職務與狀態（啟用中／未綁定登入／已停用）篩選；新增、修改員工（編號、姓名、部門、職稱、Email、電話、分機；新增後直接開啟該員工的編輯畫面以指定職務），編輯時也可變更系統角色（與 `/admin/accounts` 同一個服務，不能改自己、設為管理員需確認）及新增／移除職務（與「職務類別」頁同一個服務，含主要人員遞補與流程使用中的保護）；停用與登入綁定仍在 `/admin/accounts`。也可匯入公司活頁簿「link」工作表（與 `seed` 相同欄位：B 編號、C 姓名、D 部門名稱、E 部門代碼、G 職稱）。匯入先在伺服器產生預覽（新增／更新／無變更／錯誤），勾選後以同一個檔案（SHA-256 比對）在單一交易內套用；部門依代碼（或唯一名稱）比對、不自動建立，空白欄位不清除資料，工作表中沒有的員工不會被停用。員工資料、系統角色與匯入需 15 分鐘內登入過、每人每 10 分鐘 60 次；職務依組織設定的規則（1 小時內登入過）；全部寫 audit。
  - **尚未驗收**：真實 tenant 需公司 Google Workspace 管理者核准唯讀同步帳號後才能授權與驗收；目錄帳號 ID 是否等於登入 ID token 的 `sub` 必須在真實 tenant 確認後才能依賴（在此之前新進／離職清單只作參考）。`AUTH_MODE=directory` 仍未開放。

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

## 地端正式部署

`docker-compose.yml`／`docker-compose.app.yml` 只供本機開發。正式環境使用 `deploy/`：

| 檔案 | 用途 |
|---|---|
| `deploy/compose.prod.yml` | nginx → app → PostgreSQL（DB 只在 internal 網路、無 published port）、ClamAV（只在獨立的 internal `scan` 網路與病毒碼更新用的對外網路，碰不到 DB）；一次性 `migrate`／`admin-cli`／`backup`。所有 ACCSYS 容器以專用 uid／gid `10001`（`ACCSYS_UID`／`ACCSYS_GID`）執行，避免與主機第一個登入帳號（常為 1000）共用檔案權限 |
| `deploy/nginx/templates/accsys.conf.template` | TLS、未知 Host／SNI 拒絕、覆寫 forwarded headers、log 不記 query string |
| `deploy/accsys.env.example` | 非機密設定；機密一律以檔案掛載（`*_FILE`，`src/lib/secret-files.ts`） |
| `deploy/backup/backup.sh`、`restore-drill.sh` | 每日 logical 備份（DB + 附件 + SHA256SUMS）與拋棄式還原演練 |
| `deploy/systemd/` | 備份 timer |

操作手冊：[部署](docs/operations/deployment.md)、[GCP VM 初期測試檢核](docs/operations/gcp-vm.md)、[備份與還原](docs/operations/backup-restore.md)、[資安事件與金鑰輪替](docs/operations/incident-response.md)。

本機用正式建置預覽（無 DevTools「N」）：`npm run build` 後設 `ALLOW_HTTP_LOCALHOST=true` 再 `npm run start`（僅 localhost；雲端必須 HTTPS，勿帶此旗標）。

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

表單設計器與內建表單遷移（批次 1–5）已實作；細部差異見 `docs/` 與應用內系統操作教學。

## 已知限制

- Email／SMTP 尚未正式啟用寄送（程式邏輯已完成，缺少環境變數時會靜默略過，不影響簽核流程本身）。
- 專案型預算編號若未指定負責人，需在資料庫手動指定 `owner_employee_id`，否則無法用於建立請購單。
- 編輯「預算編號」欄位本身（不是編輯其他欄位）會因為 upsert-on-code 的設計而變成新增一筆，而不是改名——之後可考慮把編輯模式下的預算編號欄位改成唯讀。
- 刪除預算編號沒有確認對話框（點了就刪，雖然被引用中的編號會被程式邏輯與資料庫外鍵雙重擋下）。
- 地端部署設定與手冊已備妥（`deploy/`、`docs/operations/`），尚未在公司主機實際部署；真實 HTTPS 憑證、Google 登入與異機備份需公司主機與授權。
- 目前備份為每日 logical dump（RPO 約 24 小時）；WAL／PITR（pgBackRest）需在目標主機驗證後啟用。
- 若主機上已有以 uid 1000 建立的 `ACCSYS_DATA_DIR`／`ACCSYS_BACKUP_DIR`，改用 uid 10001 前需依[部署手冊](docs/operations/deployment.md)建立系統帳號並 `chown`。
- ClamAV 容器仍需對外連線更新病毒碼；clamd 尚未設定 `AlertExceedsMax`，超過掃描上限的檔案目前依 clamd 預設處理。
- 登入／API 速率限制依 `TRUSTED_CLIENT_IP_HEADER` 取得用戶端 IP；若未設定（正式 compose 已設定），所有請求共用同一個額度。
- 核准／退回動作對不存在與無權限的表單 ID 回應略有不同，理論上可推測 UUID 是否存在（UUID 不可猜，風險低）。
- **簽核流程規則（待以表單／簽核組織機制統一處理，見 `docs/superpowers/specs/2026-10-13-form-builder-and-approval-org-design.md`）**：
  - 申請人同時是自己的部門主管、預算負責人與總經理且金額 ≤ NT$100,000 時，簽核鏈為空，表單建立即自動核准。
  - 合約用印單的金額由申請人填寫（可為 0），董事長是否簽核依此金額判斷。
  - 由採購單建立的費用申請單，付款對象不強制等於採購單廠商；簽核人只看到帳號末 4 碼。
  - 預算編號未檢查年度、所屬部門與剩餘預算；單筆上限可拆單規避；採購單金額不受請購核准金額限制；差旅與報銷沒有重複請款偵測；後續表單沿用請購時的預算負責人。
- 案件追蹤查詢沒有分頁，案件數極大時會變慢；session 沒有閒置逾時（最長 `SESSION_TTL_HOURS`），共用電腦請登出；Workspace 停權帳號由同步撤銷綁定與 session，但停用員工仍需管理員在「人員同步」頁確認（同步尚未在真實 tenant 驗收前，需手動停用）。
