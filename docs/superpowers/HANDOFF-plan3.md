# 交接摘要：撰寫並實作第三份計畫（採購單／驗收單／費用申請單 + 附件篇）

> 用途：在新的 session 直接引用，快速接手撰寫並實作第三份計畫。

## 專案
台灣智慧駕駛（Turing Drive）企業內部電子採購與簽核系統。技術棧：Next.js 15（App Router）+ Supabase（Postgres + RLS + Auth + Storage）+ TypeScript strict + Vitest。
- 專案根目錄：`/Users/davidtws/Documents/Projects/ACC`
- GitHub：https://github.com/davidtws411/ACCSYS
- 設計規格：`docs/superpowers/specs/2026-07-10-procurement-approval-system-design.md`（第三份計畫要看的是「簽核流程引擎」「表單欄位與附件」「通知與付款週期整合」段落）

## 目前進度
- **地基篇（第一份計畫）+ 請購單/簽核引擎篇（第二份計畫）已完成並合併進 main**：PR #1 已於 2026-07-11 合併（squash/merge commit `9584748`）。`main` 分支已包含完整地基（主檔資料、Google OAuth 登入）與請購單/簽核引擎（`procurement_cases`、`purchase_requests`、多型 `approval_steps`/`notifications`、`generateApprovalChain()`、四個 server actions、`/requests` `/approvals` `/notifications` 頁面）。
- 舊的實作 worktree `.worktrees/procurement-foundation`（分支 `procurement-foundation`）已完成階段性任務，PR 已合併——**第三份計畫應該從最新的 `main` 開一個新分支/新 worktree，不要延用舊分支**。
- **第三份計畫尚未撰寫**：目前只有設計規格書裡對應的段落和本文件的摘要，還沒有像 `docs/superpowers/plans/2026-07-11-purchase-request-approval-engine.md` 那樣的逐任務實作計畫文件。

## 要做的事
1. 先用 **superpowers:writing-plans** 把設計規格書對應段落轉成逐任務實作計畫（`docs/superpowers/plans/<日期>-purchase-order-acceptance-expense-forms.md` 之類的檔名），計畫要交代清楚每個任務的介面、驗收條件、遷移 SQL、測試碼（比照前兩份計畫的寫法）。
2. 從 `main` 開一個新分支（例如 `procurement-forms`）與對應 worktree，用 **subagent-driven-development** 逐任務執行。
3. 沿用地基篇/簽核引擎篇同一套 SDD ledger 慣例：`.superpowers/sdd/progress.md`（新 worktree 裡是全新檔案，不用延續舊的）。

## 第三份計畫在做什麼（規格書原文重點）

### 核心目標
把剩下三張表單（採購單、驗收單、費用申請單）搬上線，跟已完成的請購單串成完整四表單流程。

### 1. 三張新表單 + 循序解鎖
- `purchase_orders`（採購單）、`acceptances`（驗收單）、`expense_requests`（費用申請單），各自表頭 + 明細，結構比照 `purchase_requests`
- **循序解鎖**：請購單核准通過 → 才能建立採購單；採購單核准通過 → 才能建立驗收單；以此類推
- 每張表單各自跑一輪完整簽核鏈（最多 4 關：申請人建立 → 申請單位主管 → 預算負責人 → 總經理，金額 >10 萬再加簽董事長），**不是整案只簽一次**
- **例外路徑**：付款條件為「預付款」時可跳過驗收單，直接進費用申請單，待貨到後再補驗收

### 2. 直接沿用第一/二份計畫已建好的基礎設施（不用重做）
- `procurement_cases` 案件容器 + `next_case_number()` 單號產生器 — 四張表單共用同一案件單號（如 `CP11507xxxx`，項次分 A1 請購 / B1 採購 / C1 驗收 / D1 費用申請，項次編碼規則第三份計畫要另外設計）
- `approval_steps` 表**已經是多型設計**（`form_type` 的 CHECK 約束已包含 `'purchase_order'`、`'acceptance'`、`'expense_request'`），第三份計畫直接複用同一張表，不需要改 schema
- `notifications` 表 + `generateApprovalChain()` 純函式 — 簽核鏈規則相同，四張表單共用同一套邏輯（`src/lib/approval/chain.ts`，Task 6 產出，已含最終審查加固）
- service-role server actions 的寫入模式（`createSupabaseServiceRoleClient`）、RLS 參與者範圍讀取的既有模式（`current_employee_id()`、`is_finance()`）
- `resubmit_purchase_request()` 交易化 Postgres function 的寫法可以參考，用在其他表單的重送邏輯上

### 3. 第三份計畫真正的新東西
- **`attachments` 表 + Supabase Storage**：每張表單可上傳多個檔案（PDF/圖片），存 Supabase Storage，簽核畫面要能直接預覽、不需下載
- **Email 通知**：前兩份計畫明確把 Email 留到後續（只做站內通知），第三份計畫要補上「表單進入簽核佇列時 email 提醒」，以及退回/核准完成的 email 通知
- **欄位驗證規則**（規格書明列，系統要自動檢查）：
  - 設備 vs 材料判斷：未稅金額 ≥ NT$80,000 且非隨車出售 → 設備，否則材料（Task 12 的建單頁已有這條的軟性 UI 提示，可參考延伸到採購單）
  - 報價單家數對應採購金額門檻：<3萬 需1家、3萬~9.9萬 需2家、≥10萬 需3家；未達門檻家數需填寫「未檢附其他報價單原因」
  - 廠商報價單付款條件需與費用申請單期望付款日一致，不一致時系統提示但不強制擋單
  - 發票/收據買受人抬頭正確性（台灣智慧駕駛股份有限公司/統編 50773141，或國外 TURING DRIVE INC.）系統無法自動判讀，僅列檢查清單提醒申請人自行核對
- **驗收單特有邏輯**：各項次 Pass/Fail、財產編號（財會填）；Fail 的項次仍可送出驗收單，但費用申請單對應項次需人工排除或另行處理（第一期不做自動退款/折讓單模組）
- **財會撥款週期提示**（非強制卡關，僅提示）：
  - 員工代墊：每月 15 號、30 號兩批，收件截止為付款前 5 個工作天
  - 外部廠商：每月 25 號一批，收件截止為付款前 5 個工作天；急件（付款前 2 個工作天內送件）需先經部門主管 Email 同意才能送件
  - 若「期望付款日」未填，系統自動以「發票月份次月 25 號」計算
  - 費用申請單核准後，系統顯示「預計撥款批次日」給申請人與財會參考；實際入帳仍由財會人工執行，**第一期不做自動轉帳/自動產生傳票**

### 4. 明確排除範圍（Non-goals，第三份計畫不用做）
- 同廠商同品項第二次採購委由管理部代辦的分流邏輯（簡化為每次走完整四表單流程）
- 主檔資料的自助維護介面／與外部人事系統同步
- 財會自動產生傳票、自動轉帳、與 104企業大師或既有 ERP 對接
- 發票/收據 OCR 自動比對買受人抬頭、統編等內容正確性
- 固定資產/庫存自動造冊（驗收單財產編號欄位第一期仍為人工填寫）

## 已定案的商業規則（第一二份計畫已納入，第三份計畫沿用）
- 一張表單所有預算編號必須屬同一位預算負責人（簽核鏈單一預算負責人關卡）
- 加簽門檻：**該表單本身金額**（非整案累計金額）> 10 萬加簽董事長（100,000 剛好不加簽）
- 簽核鏈自核去重：申請人若同時身兼部門主管/預算負責人/總經理，該關自動跳過（已在真人瀏覽器 QA 驗證過這個行為）

## 關鍵環境細節（重要，沿用前兩份計畫）
- `.env.local` 存在於實作用的 worktree 根目錄，含真實 Supabase 憑證。**絕不可 commit，絕不可 print 值。**
- 跑整合測試前要先 `export $(grep -v '^#' .env.local | xargs)`，否則整合測試會 skip（這不是有效的 RED，會誤判）。
- Node 20 缺穩定的全域 WebSocket，`npm test` 已內建 `NODE_OPTIONS=--experimental-websocket`；手動跑 ad hoc Node 腳本操作 Supabase 也要加這個 flag，否則會噴 `Node.js 20 detected without native WebSocket support`。
- Migration 用 `supabase db push` 套到已連結的 hosted 專案（已有真實種子資料：8 部門、39 員工、185 預算編號、4 供應商）。**這會實際寫入正式 Supabase 專案，寫入型操作要謹慎**，尤其是用 service-role client 繞過應用層直接寫資料庫這種操作——沙盒的安全分類器會攔截未經明確同意的直接多表寫入，遇到要停下來跟人類說清楚在做什麼、為什麼，讓人類決定。
- Supabase 多型查詢：多個 FK 指向同一表要用 `alias:table!fk_column` 消歧義。
- 這個 repo 沒有生成 Supabase `Database` 型別，PostgREST 的 embedded relationship 查詢在 strict tsc 下常需要 `as unknown as {...}` 的兩段式轉型才能過編譯（`.select()` 字串必須是單一字面量，不能用字串相加組出來，否則 postgrest-js 的型別解析會失效）。

## 前兩份計畫留待後續處理的技術債（第三份計畫可視情況一併處理，不強制）
- 108 筆專案型預算編號尚未匯入（部門欄位填的是專案代碼）
- `npm run lint` 目前無法執行（缺 `eslint.config.js`）
- `/login` 尚未把 `?error=` 顯示給使用者
- 請購單重送（resubmit）目前僅有 server action + 整合測試，尚無 in-app UI 入口
- 核准／退回操作無同一簽核人重複送出的併發保護（同一人連點兩次可能產生重複通知）——第三份計畫若新增類似 server actions，建議一開始就設計成有 CAS（compare-and-swap）保護
- 案件單號／申請日期以 DB session 時區（UTC）計算，月份交界的台灣本地時間 00:00–08:00 可能有 off-by-one
- 新增的 SQL function（如 `resubmit_purchase_request()`）未加 `set search_path`（目前皆為 SECURITY INVOKER 且僅由 service-role 呼叫，非立即風險，但新函式建議一開始就補上）

## 執行慣例（沿用前兩份計畫）
每個任務：task-brief → 派 implementer subagent（機械性任務用便宜模型、整合性用中階、安全邊界/RLS 用最強模型審查）→ 產 review-package → 派 reviewer → 修 Critical/Important → 記錄到 `.superpowers/sdd/progress.md` ledger → 下一個任務。完成後跑最終整體審查（用最強模型），再收尾分支、開 PR。

真人瀏覽器 QA 建議一定要做（前兩份計畫的經驗：自動化測試 73/73 全過，但真人操作時還是抓到一個真實 bug——核准/退回後觸發動作的通知沒有自動標記已讀）。測試需要多方角色互動（例如驗收單可能需要不同角色的人簽核）時，可以用 service-role client 直接造測試資料讓「目前登入的這個人」變成某張測試單的目前簽核人，這樣不用真的多開一個 Google 帳號就能人工驗證核准/退回流程——但這類直接寫資料庫的操作，記得先跟人類講清楚在做什麼、為什麼，並在驗證完後清乾淨。
