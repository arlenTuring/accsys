# 交接摘要：第五份計畫前置準備

> 用途：在新的 session 直接引用，快速接手第五份計畫。**第五份計畫尚未經過 brainstorming，範圍未定**——本文件只彙整目前狀態、候選任務、累積技術債，新 session 應先用 `superpowers:brainstorming` 跟使用者確認範圍，再進入 `superpowers:writing-plans`，不要直接開始實作。

## 專案

台灣智慧駕駛（Turing Drive）企業內部電子採購與簽核系統。技術棧：Next.js 15（App Router）+ Supabase（Postgres + RLS + Auth + Storage）+ TypeScript strict + Vitest。

- 專案根目錄：`/Users/davidtws/Documents/Projects/ACC`
- GitHub：https://github.com/davidtws411/ACCSYS
- README：`README.md`（2026-07-13 新增，涵蓋技術棧／功能模組／環境設定／開發指令／已知限制）

## 目前進度（截至 2026-07-13）

**第一～四份計畫、以及額外插入的「預算編號基礎資料管理」計畫，全部都已完成並合併進 `main`：**

| 計畫 | PR | 內容 |
|---|---|---|
| 第一份 | [PR #1](https://github.com/davidtws411/ACCSYS/pull/1) | 地基篇 + 請購單/簽核引擎篇 |
| 第二份 | （併入 PR #1） | 併在第一份一起做 |
| 第三份 | [PR #2](https://github.com/davidtws411/ACCSYS/pull/2) | 採購單/驗收單/費用申請單 + 附件與 Email 通知篇 |
| 第四份 | [PR #3](https://github.com/davidtws411/ACCSYS/pull/3) | 工作流程清理篇（11 項技術債/流程修正） |
| 插入計畫 | （直接 merge，無獨立 PR） | 預算編號基礎資料管理（Excel 批次匯入 + 網頁 CRUD，finance 專用） |

`main` 目前是完整可用狀態：四張表單（請購/採購/驗收/費用申請）的完整簽核流程、附件上傳、`notifyAndEmail()`（Email 邏輯就緒但尚未啟用寄送）、案件總覽頁、`/budget-codes` 財會預算維護頁、全站最小導覽列、修復後的 `npm run lint`。全套測試（55 檔案、244 測試）、lint、build 皆為乾淨狀態。

**沒有殘留的 worktree**：第四份計畫與插入計畫執行時建立的 worktree（`worktree-workflow-cleanup`、`budget-code-management`）都已在合併後清理。若要接手第五份計畫，請用 `superpowers:using-git-worktrees` 開一個全新的分支/worktree，不要延用任何舊的。

## 使用者已明確提出、尚待 brainstorming 的候選任務

使用者在收尾對話中提出以下候選任務，**細節（呈現方式、匯出格式等）都還沒討論**，新 session 接手時應該先用 `superpowers:brainstorming` 跟使用者確認清楚，不要直接假設細節開始寫 spec：

### 候選任務：財會專屬的簽核追蹤與報表匯出頁

財會人員（`role = 'finance'`）登入後，需要一個專屬頁面可以追蹤**所有**（不限自己承辦的）簽核中與已簽核完成的表單（四張表單：請購/採購/驗收/費用申請），並且能**匯出成給事務所（記帳士/會計師事務所）的報表**。

使用者原話：「詳細的呈現方式、匯出成給事務所的報表等等待討論」——也就是說，以下這些都還沒定案，需要在 brainstorming 階段問清楚：
- 「追蹤所有簽核中/簽核完的單」是指全公司所有案件，還是有部門/期間篩選？
- 頁面呈現方式：列表、依狀態分類、還是儀表板統計？
- 匯出報表的格式（Excel？PDF？）、報表內容需要包含哪些欄位（這點應該去問財會人員或事務所實際要求的格式，不要自己假設）、匯出頻率（每月/每季/隨選）
- 這跟 `/admin/master-data`（唯讀主檔總覽，限 admin）以及既有的 `/cases/[caseNumber]`（單一案件總覽）有什麼分工？是否該整合、還是刻意分開？
- 跟下面「預算管理系統」候選範圍中的「預算執行追蹤／超支警示」是否有重疊（兩者都涉及「彙整所有表單的金額/狀態」）——如果使用者兩個都要，這次 brainstorming 應該一併確認優先順序與是否合併成同一個功能。

### 候選任務：更大範圍的預算編列/管理系統（先前已提出，尚未排入計畫）

詳見 memory 中的 `project-budget-planning-deferred`（或直接問使用者，因為 memory 可能會過期）。簡述：公司實際有按月編列的部門/專案年度預算（範例檔在 `reference/2026年度部門預算表-*.xlsx`、`reference/2026年度專案預算表_空白.xlsx`），還有紙本的「預算新增/變更申請書」簽核流程、專案進度追蹤。目前系統只做了最基礎的「預算編號 + 金額 + 負責人」（`/budget-codes`），這一大塊還沒排入任何計畫，規模與請購/採購/驗收/費用申請整個系統相當，需要拆成多個獨立子計畫。

**新 session 接手時的建議做法**：先問使用者這次要優先做上面「財會簽核追蹤頁」還是「預算管理系統」的某一塊，不要想著一次全包——兩個都是需要完整 brainstorming → spec → plan 流程的獨立範圍。

## 已定案的決策（沿用前幾份計畫，仍然有效）

- **Email/SMTP 開通**：`notifyAndEmail()` 程式碼已就緒（找不到 SMTP 環境變數時靜默失敗，不影響簽核流程），但使用者尚未表示要開通。除非使用者主動提起，不要主動提議設定 SMTP。
- **UI/UX 整體設計**：使用者先前決定第四份計畫做完再考慮，目前尚未再次提起。除非使用者主動要求，不要主動提議做整體視覺改版。

## 累積技術債（依來源整理，供第五份計畫排序參考——沒有一項會擋住現有功能運作）

### 第三份計畫遺留（詳見 `docs/superpowers/TECH-DEBT-plan3.md`，以下摘要仍有效者）

- `tests/integration/expense-requests-schema.test.ts` 有敘述性註解、重複 fixture 邏輯、清理只在 happy path 執行
- 請購單重送（resubmit）僅有 server action + 整合測試，缺 in-app UI 入口（其餘三張新表單都有補上，只有最早的請購單缺）
- 新增的 SQL function（`resubmit_purchase_request()` 等）未加 `set search_path`（目前皆為 SECURITY INVOKER 且僅由 service-role 呼叫，非立即風險）
- 上線前帳號治理清單（Supabase Organization / Vercel Team 轉移）——非程式碼變更，留待正式上線前處理

### 第四份計畫最終審查發現（Minor，未修正）

- `src/lib/cases/queries.ts` 的 `FORM_DEFS` 仍重複定義了 `form-registry` 已有的 `label`/`table` 對照——當初 Task 4 抽出共用模組時範圍沒有涵蓋這個檔案，是完成度較低的一個殘留，之後若要新增第五張表單，這裡也得手動改。
- 案件總覽頁的「憑證待補」檢查有一個小 N+1（每張表單一次額外查詢），現在規模下無影響。
- `src/app/layout.tsx` 變成 async/dynamic 之後，剛好讓 `/login` 的 `useSearchParams()` 不需要額外包 `<Suspense>`——這是隱性耦合，如果之後 Task 3 的導覽列被還原，`/login` 可能需要補上明確的 Suspense 邊界。

### 預算編號管理計畫最終審查發現（Minor，未修正）

- `importBudgetCodesFromExcel` 的批次匯入迴圈裡，金額不是數字的預檢查跟 `upsertOneBudgetCode` 內部「金額必須為正數」共用同一句錯誤訊息字串，但是用兩份獨立寫死的字串，理論上未來若改其中一句用詞會不同步（目前尚未發生，只是架構上的小裂縫）。
- 編輯「預算編號」欄位本身（不是編輯其他欄位）會因為 upsert-on-code 的設計而變成新增一筆，而不是改名——建議之後把編輯模式下的預算編號欄位改成唯讀。
- 刪除預算編號沒有確認對話框（點了就刪，雖然被引用中的編號會被程式邏輯與資料庫外鍵雙重擋下）。
- 財會人員編輯/新增預算編號目前是頁面最上方的內嵌表單，點擊清單裡的「編輯」需要手動捲動回頁首才看得到——使用者已明確表示這次先不修，之後想改成彈出視窗（modal）。

### 環境相關（非程式碼缺陷）

- **`npm run lint` 已修復**（第四份計畫 Task 6），但要注意：從主目錄（`/Users/davidtws/Documents/Projects/ACC`）執行時，若有其他 worktree 巢狀在目錄底下（`.worktrees/`、`.claude/worktrees/`），`eslint.config.mjs` 已排除這兩個路徑（2026-07-13 修正），新開 worktree 不會受影響，但如果之後又出現新的巢狀目錄模式，記得檢查 ignores 清單。
- **瀏覽器預覽工具（`preview_start`）看不到用 harness 原生 worktree 工具建立的 worktree**：這是從第三份計畫就發現的已知限制，原因是新 worktree 若沒有自己的 `.claude/launch.json`，`preview_start` 會誤用上層目錄殘留的設定檔連到錯誤的程式碼。**唯一可靠的驗證方式**：請使用者自己在終端機 `cd` 進 worktree 跑 `npm run dev`，用他們自己本機的瀏覽器測試。
- **測試 fixture 的循環外鍵清理陷阱**（第五份計畫執行時發現並修正，記錄下來避免重蹈覆轍）：本專案的 `departments.manager_employee_id` 與 `employees.department_id`互相參照。任何測試如果同時建立「一個部門 + 該部門的主管員工」這類 fixture，`afterAll` 清理時必須先把 `departments.manager_employee_id` 設為 `null`，再刪除員工，最後刪除部門——先刪員工會因為部門還參照著它而失敗，若同一批員工的 `department_id` 也指向該部門，會連鎖導致部門也刪不掉，測試資料因此持續累積在正式資料庫裡。已在 `tests/integration/budget-codes-actions.test.ts`／`budget-codes-queries.test.ts` 修正，未來新增類似 fixture 的測試要留意這個模式。

## 關鍵環境細節（沿用前幾份計畫）

- `.env.local` 存在於各 worktree 根目錄，含真實 Supabase 憑證。**絕不可 commit，絕不可 print 值。**
- 跑整合測試前要先 `export $(grep -v '^#' .env.local | xargs)`，否則整合測試會 skip（不是有效的 RED）。
- Node 20 缺穩定的全域 WebSocket，`npm test` 已內建 `NODE_OPTIONS=--experimental-websocket`；手動跑 ad hoc Node 腳本操作 Supabase 也要加這個 flag。
- Migration 用 `supabase db push` 套到已連結的 hosted 專案（已有真實種子資料）。**這會實際寫入正式 Supabase 專案**，寫入型操作要謹慎——尤其是用 service-role client 繞過應用層直接寫資料庫這種操作，沙盒的安全分類器會攔截未經明確同意的直接多表寫入/刪除，遇到要停下來跟人類說清楚在做什麼、為什麼，讓人類決定；如果被攔下來，改成把腳本寫成檔案讓使用者自己在終端機執行（腳本要放在專案目錄內，不要放在 `/tmp` 或 scratchpad）。
- Supabase 多型查詢：多個 FK 指向同一表要用 `alias:table!fk_column` 消歧義。
- 這個 repo 沒有生成 Supabase `Database` 型別，PostgREST 的 embedded relationship 查詢在 strict tsc 下常需要 `as unknown as {...}` 的兩段式轉型才能過編譯。

## 執行慣例（沿用前幾份計畫）

先用 `superpowers:brainstorming` 跟使用者確認範圍與細節、寫成 spec，再用 `superpowers:writing-plans` 轉成任務拆解的實作計畫，接著才進入 `superpowers:subagent-driven-development`：task-brief → 派 implementer subagent（機械性任務用便宜模型、整合性用中階、安全邊界相關用最強模型審查）→ 產 review-package → 派 reviewer → 修 Critical/Important → 記錄到 `.superpowers/sdd/progress.md` ledger → 下一個任務 → 完成後跑最終整體審查（用最強模型）→ `superpowers:finishing-a-development-branch` 收尾。

真人瀏覽器 QA 一定要做（前幾份計畫的一致經驗：自動化測試全過，真人操作還是抓到過真實 bug，包括這次發現的測試資料清理循環外鍵 bug）。測試需要多方角色互動時，可以用 service-role client 直接造測試資料讓「目前登入的這個人」暫時變成某個角色（例如暫時把自己的 `role` 改成 `finance` 測試完再改回來），但這類直接寫資料庫的操作，記得先跟人類講清楚在做什麼、為什麼，並在驗證完後清乾淨——每一次角色切換都要重新徵求同意，不要假設前一次的同意涵蓋後續操作。
