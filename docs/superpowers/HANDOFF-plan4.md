# 交接摘要：實作第四份計畫（網頁內運作流程清理篇）

> 用途：在新的 session 直接引用，快速接手執行第四份計畫。

## 專案
台灣智慧駕駛（Turing Drive）企業內部電子採購與簽核系統。技術棧：Next.js 15（App Router）+ Supabase（Postgres + RLS + Auth + Storage）+ TypeScript strict + Vitest。
- 專案根目錄：`/Users/davidtws/Documents/Projects/ACC`
- GitHub：https://github.com/davidtws411/ACCSYS
- 第四份計畫文件（**已經寫好，還沒開始執行**）：`docs/superpowers/plans/2026-07-12-workflow-process-cleanup.md`

## 目前進度
- **地基篇（第一份）+ 請購單/簽核引擎篇（第二份）+ 採購單/驗收單/費用申請單+附件+Email 篇（第三份）都已完成並合併進 `main`**：PR #1（2026-07-11 合併，commit `9584748`）、PR #2（2026-07-12 合併，commit `4601756`）。`main` 分支現在有完整的四表單流程（請購→採購→驗收→費用申請）、附件上傳、`notifyAndEmail()`（email 寄送邏輯已寫好但**尚未真的開通**，見下方「已定案的決策」）、案件總覽頁 `/cases/[caseNumber]`。
- 第三份計畫執行時用的舊 worktree `.claude/worktrees/procurement-forms`（分支 `worktree-procurement-forms`，已合併）**可能還留在磁碟上**——合併後嘗試用 `ExitWorktree` 清理，但那次 session 的 harness 已經不認得這是它建立的 worktree（回報 no-op），所以沒清乾淨。新 session 不用理它，**直接開一個全新的分支/worktree 做第四份計畫，不要延用**；如果想順手清掉舊的，確認裡面沒有未合併的東西後用 `git worktree remove` 或請使用者手動刪除即可。
- **第四份計畫已經用 superpowers:writing-plans 寫好了**，共 11 個任務，還沒開始執行（沒有任何 Task 1 的 commit）。

## 要做的事
1. 從最新的 `main` 開一個新分支（例如 `workflow-cleanup`）與對應 worktree（優先用 harness 原生的 worktree 工具，例如 `EnterWorktree`；只有在沒有原生工具時才退回手動 `git worktree add`，細節見 `superpowers:using-git-worktrees`）。
2. 用 **subagent-driven-development** 依 `docs/superpowers/plans/2026-07-12-workflow-process-cleanup.md` 逐任務執行（11 個任務都已經寫好完整程式碼、測試、驗收條件，直接照著跑即可，不用重新設計）。
3. 新 worktree 裡建立全新的 `.superpowers/sdd/progress.md` ledger，不用延續舊的。

## 第四份計畫在做什麼（11 個任務摘要，細節都在計畫文件裡）
1. 根目錄 `/` 改為依登入狀態導向 `/dashboard` 或 `/login`（現在是死路徑，只顯示標題）
2. `/login` 顯示 `?error=` 對應的中文錯誤訊息（現在登入失敗會被靜默彈回、看不出原因）
3. 全站最小導覽列（root layout 加一個登入後可見的頂部橫條：「← 上一頁」「🏠 儀表板」）——**刻意做到最小，不是完整 UI/UX 改版**
4. 抽出共用的表單型別對照表模組 `src/lib/procurement/form-registry.ts`，取代 4 個檔案裡重複定義的 `FORM_TABLE`/`FORM_ROUTE_PREFIX`/`FORM_LABELS`
5. `updateAcceptanceItemPropertyTag` 加上狀態限制（只能在驗收單已核准後填寫財產編號）
6. 修復 `npm run lint`（缺 ESLint 9 flat config，補 `eslint.config.mjs` + `@eslint/eslintrc`，並修掉跑出來的既有 lint 問題）
7. 案件單號／請購單申請日期／驗收日期改用台灣時區（Asia/Taipei）計算，修正月份交界 UTC off-by-one
8. 全部 8 個 approve/return server actions（四張表單各 2 個）加上 CAS（compare-and-swap）保護，防止連點兩下產生重複通知
9. 案件總覽頁加「憑證待補」提醒（表單已建立但沒有任何附件時顯示提示，不擋單）
10. 專案型預算編號改用 nullable `department_id` + 新增 `project_code` 欄位，補匯入原本被跳過的 108 筆——**但這批補匯入的預算編號沒有預算負責人（`owner_employee_id` 是 null），還不能拿來建請購單，需要另外請有 admin 權限的人到 Supabase Studio 手動指定每一筆的負責人，計畫裡有明講這個限制**
11. 最終驗證（測試+lint+build+真人瀏覽器 QA checklist）

## 已定案的決策（2026-07-12 跟使用者確認過，用 memory 記著，這裡再摘要一次）
- **Email／SMTP 開通暫緩**：`notifyAndEmail()` 的程式碼已經寫好且運作正常（找不到 SMTP 環境變數時會靜默失敗、不影響簽核流程本身），但使用者明確要求先把「網頁內運作的程序問題」（也就是這第四份計畫）全部做完，才要開始申請 Google Workspace SMTP relay 憑證。**第四份計畫執行期間不要主動提議或設定 SMTP。**
- **UI/UX 整體設計暫緩**：使用者原本想在第三份計畫合併後接著做整體 UI/UX 設計，但決定先把第四份計畫（流程/技術債清理）做完再說。**第四份計畫的 Task 3（導覽列）刻意做到最小，不要在第四份計畫裡順便做完整的 UI/UX 改版**——那是之後獨立的另一個階段。

## 關鍵環境細節（重要，沿用前三份計畫）
- `.env.local` 存在於實作用的 worktree 根目錄，含真實 Supabase 憑證。**絕不可 commit，絕不可 print 值。**
- 跑整合測試前要先 `export $(grep -v '^#' .env.local | xargs)`，否則整合測試會 skip（這不是有效的 RED，會誤判）。
- Node 20 缺穩定的全域 WebSocket，`npm test` 已內建 `NODE_OPTIONS=--experimental-websocket`；手動跑 ad hoc Node 腳本操作 Supabase 也要加這個 flag。
- Migration 用 `supabase db push` 套到已連結的 hosted 專案（已有真實種子資料）。**這會實際寫入正式 Supabase 專案，寫入型操作要謹慎**，尤其是用 service-role client 繞過應用層直接寫資料庫這種操作——沙盒的安全分類器會攔截未經明確同意的直接多表寫入（親身經歷：即使使用者已經在對話裡口頭同意，Bash 工具層級的分類器還是可能單獨擋下來），遇到要停下來跟人類說清楚在做什麼、為什麼，讓人類決定；如果被攔下來，改成把腳本寫成檔案讓使用者自己在終端機執行（腳本要放在專案目錄內，不要放在 `/tmp` 或 scratchpad——那些路徑沒有 `node_modules`，`require('@supabase/supabase-js')` 會找不到模組）。
- Supabase 多型查詢：多個 FK 指向同一表要用 `alias:table!fk_column` 消歧義。
- 這個 repo 沒有生成 Supabase `Database` 型別，PostgREST 的 embedded relationship 查詢在 strict tsc 下常需要 `as unknown as {...}` 的兩段式轉型才能過編譯。
- **瀏覽器預覽工具（`preview_start`）看不到用 harness 原生 worktree 工具建立的 worktree**：這是第三份計畫執行完之後才發現的坑——如果新 worktree 底下沒有自己的 `.claude/launch.json`，`preview_start` 會往上層目錄找到主目錄的 `.claude/launch.json`，而那份設定檔可能殘留舊 worktree 的路徑（`cd` 到一個已經不存在或已合併的舊分支），導致預覽起的 dev server 服務的是錯誤的程式碼、所有新路由回應 404，而且改 worktree 裡的 `.claude/launch.json`（不管是預設值還是明確 `cd` 到正確的絕對路徑）都無法解決——瀏覽器工具的 sandbox 環境似乎看不到 harness worktree 的檔案系統。**目前唯一可靠的驗證方式：請使用者自己在終端機 `cd` 進 worktree 跑 `npm run dev`，用他們自己本機的瀏覽器登入測試**（不受此限制，因為那是真實的本機瀏覽器連真實的 localhost，不經過這個工具的 sandbox）。第四份計畫的 Task 11 manual QA 一律用這個方式做，不要浪費時間跟 `preview_start` 工具搏鬥。

## 前三份計畫留待後續處理、第四份計畫範圍外的技術債
- 上線前帳號治理清單（Supabase Organization / Vercel Team 轉移）——非程式碼變更，帳務/帳號操作，留待正式上線前處理
- 請購單重送（resubmit）僅有 server action + 整合測試，尚無 in-app UI 入口（三張新表單都有補上了，只有最早的請購單缺，若要修可以另開任務，不在第四份計畫的 11 個任務範圍內）
- 新增的 SQL function（`resubmit_purchase_request()` 等）未加 `set search_path`（目前皆為 SECURITY INVOKER 且僅由 service-role 呼叫，非立即風險）
- `tests/integration/expense-requests-schema.test.ts` 裡有敘述性註解／重複 fixture 邏輯／清理只在 happy path 執行——完整清單見 `docs/superpowers/TECH-DEBT-plan3.md`
- 完整版 UI/UX 設計（持久側欄、麵包屑、視覺風格）——刻意留到第四份計畫之後的獨立階段

## 執行慣例（沿用前三份計畫）
每個任務：task-brief → 派 implementer subagent（機械性任務用便宜模型、整合性用中階、安全邊界相關用最強模型審查）→ 產 review-package → 派 reviewer → 修 Critical/Important → 記錄到 `.superpowers/sdd/progress.md` ledger → 下一個任務。完成後跑最終整體審查（用最強模型），再收尾分支、開 PR。

真人瀏覽器 QA 一定要做（前三份計畫的一致經驗：自動化測試全過，真人操作還是抓到過真實 bug）。測試需要多方角色互動時，可以用 service-role client 直接造測試資料讓「目前登入的這個人」變成某張測試單的目前簽核人，不用真的多開一個 Google 帳號——但這類直接寫資料庫的操作，記得先跟人類講清楚在做什麼、為什麼，並在驗證完後清乾淨（若被沙盒分類器擋下 Bash 直接寫入，改用「寫腳本檔案到專案目錄、請人類自己在終端機執行」的方式，見上方「關鍵環境細節」）。
