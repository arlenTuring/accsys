# 交接摘要：第七份計畫前置準備

> 用途：在新的 session 直接引用，快速接手後續工作。**第七份計畫尚未經過 brainstorming，範圍未定**——本文件只彙整目前狀態、候選任務、累積技術債、正式環境設定細節，新 session 應先用 `superpowers:brainstorming` 跟使用者確認範圍，再進入 `superpowers:writing-plans`，不要直接開始實作。

## 專案

台灣智慧駕駛（Turing Drive）企業內部電子採購與簽核系統。技術棧：Next.js 15.5（App Router）+ Supabase（Postgres + RLS + Auth + Storage）+ TypeScript strict + Vitest。

- 專案根目錄：`/Users/davidtws/Documents/Projects/ACC`
- GitHub：https://github.com/davidtws411/ACCSYS（`main` 為唯一使用中的分支，目前 HEAD 為 `3b166b3`，已與 `origin/main` 完全同步）
- README：`README.md`（2026-07-20 已更新到第六份計畫內容）
- **正式環境**：https://accsys-davidtws411.vercel.app（Vercel 專案 `accsys`）——目前部署狀態為 `READY`，跑的正是 `origin/main` 最新 commit `3b166b3`

## 目前進度（截至 2026-07-20）

**第一～六份計畫、以及額外插入的「預算編號基礎資料管理」計畫，全部都已完成並合併進 `main`：**

| 計畫 | PR／合併方式 | 內容 |
|---|---|---|
| 第一份 | [PR #1](https://github.com/davidtws411/ACCSYS/pull/1) | 地基篇 + 請購單/簽核引擎篇 |
| 第二份 | （併入 PR #1） | 併在第一份一起做 |
| 第三份 | [PR #2](https://github.com/davidtws411/ACCSYS/pull/2) | 採購單/驗收單/費用申請單 + 附件與 Email 通知篇 |
| 第四份 | [PR #3](https://github.com/davidtws411/ACCSYS/pull/3) | 工作流程清理篇（11 項技術債/流程修正） |
| 插入計畫 | 直接 merge | 預算編號基礎資料管理（Excel 批次匯入 + 網頁 CRUD，finance 專用） |
| 第五份 | 直接 merge | 財會簽核追蹤頁（`/case-tracking`） |
| 第六份 | 直接 merge（worktree `worktree-budget-admin-workflow-flexibility`，`01b4561`） | 預算後台強化與工作流程彈性（見下方） |

### 第六份計畫內容（2026-07-19，spec: `docs/superpowers/specs/2026-07-19-budget-admin-and-workflow-flexibility-design.md`，plan: `docs/superpowers/plans/2026-07-19-budget-admin-and-workflow-flexibility-plan.md`，14 個任務、3 個子專案）

1. **子專案 1：預算後台強化** — 新增獨立 `projects` 資料表（取代 `budget_codes.project_code` 純文字欄位），`/budget-codes` 新增專案下拉選單與「專案管理」區塊，主表格改顯示部門/專案名稱而非代碼；修正既有匯入資料的負數金額（`abs()`）。
2. **子專案 2：免走採購流程的費用申請單** — 金額低於 NT$10,000 可直接建立獨立費用申請單（`createStandaloneExpenseRequest`），不需先有採購單；`procurement_cases.case_type` 新增 `standalone_expense`，`determineCaseBucket` 依此分流案件總覽的完成判定。
3. **子專案 3：表單自行修改／撤回** — 四張表單（請購/採購/驗收/費用申請）新增 `withdrawn` 狀態，申請人在**送出後、第一關審核前**可自行修改或撤回，不需要主管介入；`/case-tracking` 新增「已撤回」頁籤。

### 本 session（2026-07-20）在第六份計畫合併後，額外發現並修正的問題

第六份計畫的 worktree 合併（`01b4561`）進 `main` 後，push 到 GitHub 觸發 Vercel 部署時才第一次跑 production build，暴露出以下問題（worktree 內本地開發模式沒有跑過 production build，所以沒被抓到）：

1. **Vercel 部署失敗**（`4cdcdb8`）：`src/lib/expense-requests/actions.ts` 是 `"use server"` 檔案，卻直接 export 了一個常數 `STANDALONE_EXPENSE_REQUEST_LIMIT`（Next.js 規定這類檔案只能 export async function）。修法：把常數移到新檔案 `src/lib/expense-requests/constants.ts`。
2. **`admin` 角色進不去財會頁面**（`32afffa`）：使用者要求讓 `admin`（沈大維，`david_shen@turing-drive.com`）能看到所有頁面方便整體驗證。`/budget-codes`、`/case-tracking` 的頁面層 gate 原本寫死只允許 `role === 'finance'`，改為 `role === 'finance' || role === 'admin'`；同步更新 `/dashboard` 選單顯示邏輯。
3. **`admin` 角色進得去頁面但按鍵沒作用**（`9e0d98e`）：上一步只改了頁面層 gate，底層 server action（`upsertBudgetCode`、`deleteBudgetCode`、`importBudgetCodesFromExcel`、`upsertProject`）仍寫死只允許 `finance`，導致 admin 點編輯/儲存/刪除都被 action 內部擋下、UI 上看起來像按鍵沒反應。這是**同一個 root cause 分成兩處遺漏**，修交接的人要記住：以後開放角色存取權，頁面 gate 跟底層 action 的角色檢查要一起改，不要只改一邊。
4. **UX 改善**（`3b166b3`）：點擊「編輯」原本要手動捲動回頁首的表單區塊才看得到，改為自動平滑捲動 + 表單區塊在編輯模式下變成藍框並顯示「編輯預算編號：{code}」，讓使用者清楚知道自己在編輯哪一筆。這算是回應了插入計畫（預算編號基礎資料管理）最終審查記錄的「之後想改成彈出視窗」這個技術債——最後選擇用自動捲動+視覺提示取代 modal（改動更小、效果已足夠），不是照原本設想做成 modal。

**這四個修正皆已個別 commit、push 到 `origin/main`，並確認 Vercel 部署狀態為 `READY`。** Supabase 端這次沒有新的 migration（子專案 1/2/3 的 migration 都在第六份計畫本身就套用過了），用 `supabase migration list` 確認過 24 個 migration local/remote 完全一致。

**另外補了一個遺漏的 commit**：第六份計畫的**設計文件**（`docs/superpowers/specs/2026-07-19-...-design.md`）當時有 commit，但對應的**實作計畫文件**（`docs/superpowers/plans/2026-07-19-...-plan.md`）卻一直沒 commit，在 `main` 上放了一週的未追蹤檔案。已補 commit 推上去，跟其他計畫的 spec+plan 文件維持一致的追蹤慣例。

## 正式環境設定（沿用第五份計畫首次上線時的記錄，細節見 `docs/superpowers/HANDOFF-plan6.md` 或直接看下方摘要）

- **Vercel 專案**：`accsys`，隸屬 `davidtws411` 帳號（Hobby 方案）。Function Region `hnd1`（東京），跟 Supabase 對齊。Deployment Protection（SSO）已關閉。
- **Git commit 作者身分**：repo-local `git config user.email` 已設為 `davidtws411@gmail.com`（不是 `david_shen@turing-drive.com`），否則 Vercel 的 GitHub 整合會擋部署。換機器/新開 worktree 要記得檢查這個設定有沒有跟著帶過去。
- **操作 Vercel 沒有內建 MCP 工具**：需要使用者去 Vercel Settings → Tokens 產生短期 personal access token，再用 `curl https://api.vercel.com/...` 或 `npx vercel ...` 操作。**本 session 同一組 token 在對話裡被貼了三次**（`vcp_4l1c...`），每次用完都有提醒使用者去 Vercel Dashboard 刪除/撤銷——新 session 如果要查 Vercel 狀態，記得跟使用者確認那組 token 是否已經撤銷、需不需要重新生成，不要假設還有效。
- **Supabase 同樣沒有內建 MCP**：需要使用者去 Supabase Dashboard → Account → Access Tokens 產生 `sbp_...` 格式的 token，再用 `supabase link --project-ref <ref>` + `supabase migration list` 之類指令操作。專案 ref 前綴為 `jbqjum...`（完整值在 `.env.local` 的 `NEXT_PUBLIC_SUPABASE_URL`）。
- **實際會被 app 讀取的環境變數**：`NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_ANON_KEY`、`SUPABASE_SERVICE_ROLE_KEY`、`ALLOWED_GOOGLE_DOMAIN`。`SMTP_*` 尚未設定（Email 功能未啟用）。

**目前 `role` 名單**（2026-07-20 確認，之後可能會變，建議直接查 `employees` 表）：沈大維（0002）為 `admin`；陳維隆（0001）、許雲茹（0009）、吳旭東（0065）、卓欣葦（0074）、汪怡伶（0075）、李盈萱（0091）為 `finance`。**`admin` 現在也能存取 `/budget-codes`、`/case-tracking`**（本 session 新改動，見上方）。

## 使用者已明確提出、尚待 brainstorming 的候選任務（沿用前幾份交接文件，未有新進展）

### 候選任務：財會簽核追蹤頁的報表匯出

匯出成給事務所（記帳士/會計師事務所）的報表，格式/欄位待事務所實際需求確認後才規劃，**不要自行假設**。查詢層（`getFinanceCaseTracking`）已建好，可直接在這個基礎上加。

### 候選任務：組織架構與 Google Workspace 同步機制

部門主管（`departments.manager_employee_id`）、總經理／董事長身分（`employees.is_general_manager`／`is_chairman`）仍然**沒有網頁介面可以維護**，只能靠 `npm run seed` 或直接改 Supabase Studio。使用者的理想目標是規劃一個能同步管理 Google Workspace 帳號、人員組織架構、與簽核系統設定的機制。brainstorming 時務必先問清楚同步要做到多深（唯讀同步 vs. 有寫入身分識別提供者的權限）。詳見 memory `project-org-chart-google-workspace-sync-deferred`。

### 候選任務：更大範圍的預算編列/管理系統

公司實際有按月編列的部門/專案年度預算（範例檔在 `reference/2026年度部門預算表-*.xlsx`、`reference/2026年度專案預算表_空白.xlsx`——**這三個檔案目前仍是本機未追蹤檔案，未 commit 進 repo**，可能含真實金額資料，是否要放進版控由使用者決定），還有紙本的「預算新增/變更申請書」簽核流程、專案進度追蹤。目前系統只做了「預算編號 + 金額 + 負責人 + 專案主檔」，規模與請購/採購/驗收/費用申請整個系統相當，需要拆成多個獨立子計畫。詳見 memory `project-budget-planning-deferred`。

**新 session 接手時的建議做法**：先問使用者這次要優先做上面哪一項——三個候選都是需要完整 brainstorming → spec → plan 流程的獨立範圍，不要想著一次全包。

## 已定案的決策（沿用前幾份計畫，仍然有效）

- **Email/SMTP 開通**：`notifyAndEmail()` 程式碼已就緒，但使用者尚未表示要開通。除非使用者主動提起，不要主動提議設定 SMTP。
- **UI/UX 整體設計**：尚未再次提起。除非使用者主動要求，不要主動提議做整體視覺改版。

## 累積技術債（依來源整理，供下一份計畫排序參考——沒有一項會擋住現有功能運作）

### 第六份計畫 + 本 session 新發現

- 編輯「預算編號」欄位本身會因為 upsert-on-code 的設計而變成新增一筆而非改名——考慮把編輯模式下的預算編號欄位改成唯讀。
- 刪除預算編號沒有確認對話框。
- **開放角色存取權時的既有陷阱（本 session 親身踩過，值得記錄成通用經驗）**：只改頁面層 `redirect()` gate 不夠，底層 server action 內部通常有自己獨立的角色檢查字串，兩處都要一起改，否則會出現「進得去頁面但按鍵沒作用」這種不容易第一時間定位的症狀。

### 更早期計畫遺留（詳見 `docs/superpowers/HANDOFF-plan6.md` 完整清單，以下僅列尚未處理者）

- `tests/integration/expense-requests-schema.test.ts` 有敘述性註解、重複 fixture 邏輯、清理只在 happy path 執行。
- 請購單重送（resubmit）僅有 server action + 整合測試，缺 in-app UI 入口。
- `getFinanceCaseTracking` 對同一表單理論上出現多筆的情況沒有 dedup 警告（架構縫隙，未證實會發生）。
- 關鍵字篩選（`/case-tracking`）區分大小寫。
- 資料庫裡有一筆殘留的 RLS 整合測試假帳號（`姓名「RLS 財務人員」`），無害但會在部門篩選/finance 名單查詢中造成混淆。
- **主目錄下仍有殘留的舊 worktree（本 session 確認尚未清理）**：`.worktrees/procurement-foundation`、`.claude/worktrees/procurement-forms`、`.claude/worktrees/workflow-cleanup`、`.claude/worktrees/budget-code-management`。主目錄 `.claude/launch.json` 指向舊路徑，是 `preview_start` 抓錯程式碼的成因之一。清理前務必先確認每個都已經完全合併進 `main`，並取得使用者同意再刪除。
- `tests/integration/expense-request-queries.test.ts` 的 `getEligiblePurchaseOrdersForExpenseRequest` 測試曾記錄會逾時（開發用 Supabase 專案測試資料量大導致）——本 session 未重新驗證，沿用先前記錄，不用重複調查同一件事。

### 環境相關（非程式碼缺陷）

- **整合測試在本機直接跑 `npx vitest run` 會失敗**（`Node.js 20 detected without native WebSocket support`）——這不是新 bug，是 `package.json` 的 `npm test`／`npm run test:watch` 腳本本來就內建了 `NODE_OPTIONS=--experimental-websocket` 來繞過這個限制，直接呼叫 `vitest` CLI 略過了這個腳本才會出現。**執行整合測試務必用 `npm test`，不要直接呼叫 `npx vitest run`**。
- `.claude/` 目前是完全未追蹤的本機工具設定目錄（`launch.json`、`settings.local.json`、`worktrees/`），沒有被加進版控，這是預期行為，不用處理。

## 關鍵環境細節（沿用前幾份計畫）

- `.env.local` 存在於各 worktree 根目錄，含真實 Supabase 憑證。**絕不可 commit，絕不可 print 值。**
- 跑整合測試前要先 `export $(grep -v '^#' .env.local | xargs) && npm test`。
- Migration 用 `supabase db push` 套到已連結的 hosted 專案（已有真實種子資料）。這會實際寫入正式 Supabase 專案，寫入型操作要謹慎，遇到沙盒安全分類器攔截要停下來跟使用者說清楚，取得明確同意再重試。
- Supabase 多型查詢：多個 FK 指向同一表要用 `alias:table!fk_column` 消歧義。
- 測試 fixture 的循環外鍵陷阱：`departments.manager_employee_id` 與 `employees.department_id` 互相參照，`afterAll` 清理順序要先 null 掉 `manager_employee_id`，再刪員工，最後刪部門。

## 執行慣例（沿用前幾份計畫）

先用 `superpowers:brainstorming` 跟使用者確認範圍與細節、寫成 spec，再用 `superpowers:writing-plans` 轉成任務拆解的實作計畫，接著才進入 `superpowers:subagent-driven-development`。真人瀏覽器 QA 一定要做。**部署相關的操作（Vercel/Supabase 設定變更、token 使用）每一項都要先跟使用者說明在做什麼、為什麼，取得明確同意再執行**，不要因為前一項操作被同意了就假設後續類似操作也自動獲得授權；使用者貼的 token 用完務必提醒撤銷。

**新增經驗（本 session）**：worktree 內完成的功能開發，在合併進 `main` 並 push 之前，建議至少跑一次 `npm run build`（不只是 `npm run dev`）——本 session 的 production build 失敗（`"use server"` 檔案 export 非 async 常數）在 worktree 開發階段的 dev server 完全沒有報錯，是 push 後 Vercel 執行 production build 才第一次暴露出來。
