# 交接摘要：第六份計畫前置準備

> 用途：在新的 session 直接引用，快速接手第六份計畫。**第六份計畫尚未經過 brainstorming，範圍未定**——本文件只彙整目前狀態、候選任務、累積技術債、正式環境設定細節，新 session 應先用 `superpowers:brainstorming` 跟使用者確認範圍，再進入 `superpowers:writing-plans`，不要直接開始實作。

## 專案

台灣智慧駕駛（Turing Drive）企業內部電子採購與簽核系統。技術棧：Next.js 15.5（App Router）+ Supabase（Postgres + RLS + Auth + Storage）+ TypeScript strict + Vitest。

- 專案根目錄：`/Users/davidtws/Documents/Projects/ACC`
- GitHub：https://github.com/davidtws411/ACCSYS
- README：`README.md`（涵蓋技術棧／功能模組／環境設定／開發指令／開發歷程／已知限制，2026-07-14 已更新到第五份計畫）
- **正式環境（2026-07-14 起首次上線）**：https://accsys-davidtws411.vercel.app（Vercel 專案 `accsys`，見下方「正式環境設定」一節）

## 目前進度（截至 2026-07-14）

**第一～五份計畫、以及額外插入的「預算編號基礎資料管理」計畫，全部都已完成並合併進 `main`：**

| 計畫 | PR | 內容 |
|---|---|---|
| 第一份 | [PR #1](https://github.com/davidtws411/ACCSYS/pull/1) | 地基篇 + 請購單/簽核引擎篇 |
| 第二份 | （併入 PR #1） | 併在第一份一起做 |
| 第三份 | [PR #2](https://github.com/davidtws411/ACCSYS/pull/2) | 採購單/驗收單/費用申請單 + 附件與 Email 通知篇 |
| 第四份 | [PR #3](https://github.com/davidtws411/ACCSYS/pull/3) | 工作流程清理篇（11 項技術債/流程修正） |
| 插入計畫 | （直接 merge，無獨立 PR） | 預算編號基礎資料管理（Excel 批次匯入 + 網頁 CRUD，finance 專用） |
| 第五份 | （直接 merge，無獨立 PR） | 財會簽核追蹤頁（`/case-tracking`），詳見下方 |

`main` 目前是完整可用狀態：四張表單（請購/採購/驗收/費用申請）的完整簽核流程、附件上傳、`notifyAndEmail()`（Email 邏輯就緒但尚未啟用寄送）、案件總覽頁、`/budget-codes` 財會預算維護頁、`/case-tracking` 財會簽核追蹤頁、全站最小導覽列。全套測試（57 檔案、258 測試，其中 1 個既有無關的逾時失敗見下方技術債）、lint、build 皆為乾淨狀態。

**第五份計畫內容**：`/case-tracking` 讓 `role = 'finance'` 的財會人員追蹤全公司（不限自己承辦）所有案件的簽核狀態，依「簽核中／已完成」頁籤分類（判定規則：四張表單全部存在且皆 approved 才算完成），可依部門/建立日期區間/關鍵字（案號或申請人）篩選。查詢固定 5 次（不隨案件數線性增加，避免 N+1）。設計文件：`docs/superpowers/specs/2026-07-14-finance-case-tracking-design.md`，實作計畫：`docs/superpowers/plans/2026-07-14-finance-case-tracking-plan.md`。

同一個 session 裡還順便處理了兩個緊急但未規劃的修正（都已合併）：
- Next.js `15.1.0` → `15.5.20`：Vercel 部署前的安全掃描擋下了舊版本的已知漏洞，不修就無法部署。
- `src/middleware.ts` 對公開路徑（`/login`、`/auth/callback`）不再呼叫 Supabase `getUser()`，純效能優化，行為不變。

**沒有殘留本次計畫用的 worktree**：第五份計畫執行時建立的 `worktree-case-tracking` 已在合併後用 `ExitWorktree` 清理。若要接手第六份計畫，請用 `superpowers:using-git-worktrees` 開一個全新的分支/worktree，不要延用任何舊的。

**⚠️ 但主目錄下仍有其他計畫殘留的舊 worktree 尚未清理**（見下方技術債一節），跟第六份計畫無關，不要誤刪。

## 正式環境設定（2026-07-14 首次上線，非常重要，之後動到部署一定要先看這節）

第一次把這個專案部署上 Vercel，過程中踩了幾個非顯而易見的坑，記錄下來避免重蹈覆轍：

- **Vercel 專案**：`accsys`，隸屬 `davidtws411` 帳號（Hobby 免費方案）。正式網址：`https://accsys-davidtws411.vercel.app`。
- **Function Region 設在 `hnd1`（東京）**，跟 Supabase 專案的 `ap-northeast-1`（東京）對齊——預設是 `iad1`（美東），對台灣使用者等於繞了一大圈（台灣→美東→東京→美東→台灣）。Hobby 方案理論上不能選 region（官方說是 Pro 限定），但使用者實際在 Vercel 專案設定裡改成功了，不要沒查證就假設被鎖住。
- **Deployment Protection（Vercel 自己的 SSO）已關閉**（`ssoProtection: null`）：預設值 `all_except_custom_domains` 會擋住所有沒有 Vercel 帳號權限的訪客，連我們自己的登入頁都進不去。財務部門這種外部測試者要能連進來，這個必須關閉。如果之後綁自訂網域，Vercel 會自動放行自訂網域（不受這個設定影響），屆時可以重新評估要不要把 `*.vercel.app` 這個備援網址的保護打開。
- **Supabase `uri_allow_list`**（Authentication → URL Configuration）要包含正式網址（`https://accsys-davidtws411.vercel.app/**`），不然 Google OAuth 的 `redirectTo` 會被拒絕，登入按鈕點了沒反應。`site_url` 目前仍是 `http://localhost:3000`（本機開發用），沒有動。
- **Git commit 作者身分陷阱（浪費最多時間，務必記住）**：這個 repo 的 commit 作者原本是 `david_shen@turing-drive.com`（公司帳號）。Vercel 的 GitHub 整合會檢查 commit 作者的 GitHub 身分是不是專案協作者，不是就直接擋部署（`readyState: BLOCKED`、`seatBlock.blockCode: TEAM_ACCESS_REQUIRED`），而且 Hobby 方案**沒辦法邀請 team member**來解決（Members 邀請是 Pro 限定），把該 email 加成 GitHub 帳號的第二驗證 email 也失敗（已經被別的 GitHub 帳號註冊走了）。**解法**：把這個 repo 本地（非全域）的 `git config user.email` 改成 `davidtws411@gmail.com`（真正擁有這個 GitHub repo / Vercel 專案 / Supabase 專案的帳號），之後的 commit 就會被正確辨識，**不需要改寫歷史或 force-push**——現在的 repo-local git config 已經是這個設定了，正常使用不會再踩到，但如果換一台機器或新開 worktree，`git config user.email` 可能會落回全域設定，記得檢查。
- **怎麼在沒有 Vercel MCP 的情況下操作 Vercel**：這個環境沒有內建 Vercel 工具，是請使用者去 Vercel Settings → Tokens 產生一組短期效期的 personal access token，再用 `npx vercel ...`（`vercel inspect --logs`、`vercel ls`）跟直接 `curl https://api.vercel.com/...`（例如 `PATCH /v9/projects/accsys` 改 `ssoProtection`／`serverlessFunctionRegion`）操作。上次用完有提醒使用者去刪掉那組 token，**新 session 如果又要動 Vercel 設定，要重新請使用者生一組新的**，不要假設舊的還有效。
- **實際會被 app 讀取的環境變數**（已用 grep 逐一確認過，不是憑印象）：`NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_ANON_KEY`、`SUPABASE_SERVICE_ROLE_KEY`、`ALLOWED_GOOGLE_DOMAIN`。`SUPABASE_ACCESS_TOKEN`／`SUPABASE_PROJECT_REF`／`SUPABASE_DB_PASSWORD` 只有本機 CLI 操作 migration 才用得到，**不需要**設到 Vercel。`SMTP_*` 在 Email 功能開通前也不需要設。

**目前 `role = 'finance'` 的名單**（2026-07-14 設定，之後可能會變，接手時建議直接查 `employees` 表而不是相信這份記錄）：陳維隆（0001）、許雲茹（0009）、吳旭東（0065）、卓欣葦（0074）、汪怡伶（0075）、李盈萱（0091），皆已補上對應 `google_email` 可直接登入。沈大維（0002）維持 `admin`（沒有改成 finance，才能保留 `/admin/master-data` 的存取權）。Nikki Lo 依使用者指示不開通帳號。

## 使用者已明確提出、尚待 brainstorming 的候選任務

### 候選任務：財會簽核追蹤頁的報表匯出（第五份計畫明確排除的範圍）

匯出成給事務所（記帳士/會計師事務所）的報表，格式/欄位待事務所實際需求確認後才規劃，**不要自行假設**。第五份計畫已經把查詢層（`getFinanceCaseTracking`）建好，之後做匯出功能可以直接在這個基礎上加，不用重新設計查詢邏輯。

### 候選任務：組織架構與 Google Workspace 同步機制（2026-07-14 新提出）

目前部門主管（`departments.manager_employee_id`）、總經理／董事長身分（`employees.is_general_manager`／`is_chairman`）**沒有網頁介面可以維護**，只能靠 `npm run seed` 重新匯入 Excel（需要 repo/CLI 存取權限）或直接改 Supabase Studio。這些資料直接決定 `src/lib/approval/chain.ts` 的簽核鏈組成，財會/HR 沒辦法自己調整組織異動。

使用者的理想目標：規劃一個能**同步管理 Google Workspace 帳號、人員組織架構、與簽核系統設定**的機制（例如新進/離職員工同步建立或停用系統帳號、組織異動同步更新簽核鏈依據的人員資料），而不是三邊分別手動維護。

**brainstorming 時務必先問清楚**：這個同步要做到多深——只是唯讀同步 Google Workspace 通訊錄資料來預填員工資料，還是要進一步能實際去 Workspace 那邊建立/停用帳號（唯讀 vs. 有寫入身分識別提供者的權限，範圍差異很大，不能自己假設）。這很可能是規模不小的獨立範圍（Google Workspace Admin SDK 串接，或至少一個完整的員工/組織架構 CRUD 頁面），建議當成獨立專案規劃，不要跟預算或案件追蹤功能混在一起。

### 候選任務：更大範圍的預算編列/管理系統（先前已提出，尚未排入計畫）

詳見 memory 中的 `project-budget-planning-deferred`（或直接問使用者，因為 memory 可能會過期）。簡述：公司實際有按月編列的部門/專案年度預算（範例檔在 `reference/2026年度部門預算表-*.xlsx`、`reference/2026年度專案預算表_空白.xlsx`），還有紙本的「預算新增/變更申請書」簽核流程、專案進度追蹤。目前系統只做了最基礎的「預算編號 + 金額 + 負責人」（`/budget-codes`），這一大塊還沒排入任何計畫，規模與請購/採購/驗收/費用申請整個系統相當，需要拆成多個獨立子計畫。跟「簽核追蹤頁」候選範圍裡的「預算執行追蹤／超支警示」可能有重疊，若使用者兩個都要，brainstorming 時應一併確認優先順序。

**新 session 接手時的建議做法**：先問使用者這次要優先做上面哪一項——三個候選（報表匯出、組織架構同步、預算管理系統）都是需要完整 brainstorming → spec → plan 流程的獨立範圍，不要想著一次全包。

## 已定案的決策（沿用前幾份計畫，仍然有效）

- **Email/SMTP 開通**：`notifyAndEmail()` 程式碼已就緒（找不到 SMTP 環境變數時靜默失敗，不影響簽核流程），但使用者尚未表示要開通。除非使用者主動提起，不要主動提議設定 SMTP。
- **UI/UX 整體設計**：使用者先前決定第四份計畫做完再考慮，目前尚未再次提起。除非使用者主動要求，不要主動提議做整體視覺改版。第五份計畫的 `/case-tracking` UI 也是刻意做「先夠用、之後再跟會計人員討論工作流程」的簡單版本，不是最終定案的樣式。

## 累積技術債（依來源整理，供第六份計畫排序參考——沒有一項會擋住現有功能運作）

### 第三份計畫遺留（詳見 `docs/superpowers/TECH-DEBT-plan3.md`，以下摘要仍有效者）

- `tests/integration/expense-requests-schema.test.ts` 有敘述性註解、重複 fixture 邏輯、清理只在 happy path 執行
- 請購單重送（resubmit）僅有 server action + 整合測試，缺 in-app UI 入口（其餘三張新表單都有補上，只有最早的請購單缺）
- 新增的 SQL function（`resubmit_purchase_request()` 等）未加 `set search_path`（目前皆為 SECURITY INVOKER 且僅由 service-role 呼叫，非立即風險）

### 第四份計畫最終審查發現

- ~~`src/lib/cases/queries.ts` 的 `FORM_DEFS` 重複定義~~ **已在第五份計畫 Task 1 解決**，改為複用 `form-registry.ts`。
- 案件總覽頁的「憑證待補」檢查有一個小 N+1（每張表單一次額外查詢），現在規模下無影響。
- `src/app/layout.tsx` 變成 async/dynamic 之後，剛好讓 `/login` 的 `useSearchParams()` 不需要額外包 `<Suspense>`——這是隱性耦合，如果之後 Task 3 的導覽列被還原，`/login` 可能需要補上明確的 Suspense 邊界。

### 預算編號管理計畫最終審查發現（Minor，未修正）

- `importBudgetCodesFromExcel` 的批次匯入迴圈裡，金額不是數字的預檢查跟 `upsertOneBudgetCode` 內部「金額必須為正數」共用同一句錯誤訊息字串，但是用兩份獨立寫死的字串，理論上未來若改其中一句用詞會不同步（目前尚未發生，只是架構上的小裂縫）。
- 編輯「預算編號」欄位本身（不是編輯其他欄位）會因為 upsert-on-code 的設計而變成新增一筆，而不是改名——建議之後把編輯模式下的預算編號欄位改成唯讀。
- 刪除預算編號沒有確認對話框（點了就刪，雖然被引用中的編號會被程式邏輯與資料庫外鍵雙重擋下）。
- 財會人員編輯/新增預算編號目前是頁面最上方的內嵌表單，點擊清單裡的「編輯」需要手動捲動回頁首才看得到——使用者已明確表示這次先不修，之後想改成彈出視窗（modal）。

### 第五份計畫最終審查發現（Minor，未修正）

- `getFinanceCaseTracking`（`src/lib/case-tracking/queries.ts`）在案件同一張表單理論上出現多筆（目前資料庫沒有唯一約束擋住這件事）時，會靜默讓最後查到的那筆蓋掉前一筆，沒有 dedup 警告——目前沒有測試證實會發生，只是架構上的小縫隙。
- 關鍵字篩選是區分大小寫的 `.includes()`，如果財會人員預期不分大小寫搜尋會不符合直覺。

### 環境相關（非程式碼缺陷，持續累積、尚未清理）

- **主目錄下有殘留的舊 worktree，與交接文件先前「已清理」的說法不符**：`.worktrees/procurement-foundation`（舊式 git worktree）、`.claude/worktrees/procurement-forms`、`.claude/worktrees/workflow-cleanup`（皆為 locked 狀態）。主目錄的 `.claude/launch.json` 目前指向 `.worktrees/procurement-foundation` 這個舊路徑，這正是下面「`preview_start` 看不到 harness 原生 worktree」這個已知限制的成因之一。**已經 spawn 一個背景任務去確認這些分支是否已合併、徵求使用者同意後清理**，如果還沒處理，第六份計畫開始前可以先問使用者要不要順手解決。
- **`tests/integration/expense-request-queries.test.ts` 裡 `getEligiblePurchaseOrdersForExpenseRequest` 測試會逾時（5000ms timeout）**：第五份計畫執行期間發現，這個測試檔案跟它測試的程式碼完全沒有被第五份計畫的任何 commit 改動過，懷疑是開發用 Supabase 專案長期累積測試資料（`/case-tracking` 實測看到「簽核中」頁籤有 100+ 筆案件）拖慢了查詢。已 spawn 背景任務調查是否要優化查詢或清理資料庫，如果還沒處理，第六份計畫的測試套件會持續看到這 1 個逾時失敗（257/258），這是已知、非本次計畫造成的，不用重新調查同一件事。
- **資料庫裡有一筆殘留的 RLS 整合測試假帳號**：`employee_code = RLS-PO-F-...`、姓名「RLS 財務人員」、`role = finance`、email 是假的（沒有對應真實 Google 帳號，登不進去，無害但會在 `/case-tracking` 的部門篩選選項或未來的「finance 名單」查詢裡造成混淆）。之後有機會可以順手清掉。
- **`npm run lint` 已修復**，但要注意：從主目錄執行時，若有其他 worktree 巢狀在目錄底下（`.worktrees/`、`.claude/worktrees/`），`eslint.config.mjs` 已排除這兩個路徑，新開 worktree 不會受影響，但如果之後又出現新的巢狀目錄模式，記得檢查 ignores 清單。`next-env.d.ts` 也已加入 ignores（Next.js 15.5 開始會在這個自動生成的檔案裡加一行 typed-routes 的 triple-slash reference，會觸發 lint 規則，這個檔案本來就不該手動編輯）。
- **瀏覽器預覽工具（`preview_start`）看不到用 harness 原生 worktree 工具建立的 worktree**：新 worktree 若沒有自己的 `.claude/launch.json`，`preview_start` 會誤用上層目錄殘留的設定檔連到錯誤的程式碼。**唯一可靠的驗證方式**：自己在 worktree 裡手動 `npm run dev -- -p <一個沒人用的 port>`，然後用 Browser 工具的 `navigate`（不是 `preview_start` 的 `name` 模式）直接指到那個 port，繞過 launch.json 解析。
- **測試 fixture 的循環外鍵清理陷阱**：`departments.manager_employee_id` 與 `employees.department_id` 互相參照。任何測試如果同時建立「一個部門 + 該部門的主管員工」這類 fixture，`afterAll` 清理時必須先把 `departments.manager_employee_id` 設為 `null`，再刪除員工，最後刪除部門——先刪員工會因為部門還參照著它而失敗。已在 `tests/integration/budget-codes-actions.test.ts`／`budget-codes-queries.test.ts`／`case-tracking-queries.test.ts`（第五份計畫刻意不設定 `manager_employee_id` 避開這個問題）處理過，未來新增類似 fixture 的測試要留意這個模式。

## 關鍵環境細節（沿用前幾份計畫）

- `.env.local` 存在於各 worktree 根目錄，含真實 Supabase 憑證。**絕不可 commit，絕不可 print 值。**新開的 harness 原生 worktree（`.claude/worktrees/*`）**不會自動帶入** `.env.local`（它是 gitignored），要手動從主目錄 `cp` 一份過去才能跑整合測試。
- 跑整合測試前要先 `export $(grep -v '^#' .env.local | xargs)`，否則整合測試會 skip（不是有效的 RED）。
- Node 20 缺穩定的全域 WebSocket，`npm test` 已內建 `NODE_OPTIONS=--experimental-websocket`；手動跑 ad hoc Node 腳本操作 Supabase 也要加這個 flag。
- Migration 用 `supabase db push` 套到已連結的 hosted 專案（已有真實種子資料）。**這會實際寫入正式 Supabase 專案**，寫入型操作要謹慎——尤其是用 service-role client 繞過應用層直接寫資料庫這種操作，沙盒的安全分類器會攔截未經明確同意的直接多表寫入/刪除或安全性設定變更（第五份計畫親身遇到：改 Supabase Auth 的 `uri_allow_list` 被攔下來過一次），遇到要停下來跟人類說清楚在做什麼、為什麼，讓人類決定；如果被攔下來，改成把腳本寫成檔案讓使用者自己在終端機執行（腳本要放在專案目錄內，不要放在 `/tmp` 或 scratchpad），或是取得使用者明確同意後重試（分類器有時是暫時性錯誤，重試會過）。
- Supabase 多型查詢：多個 FK 指向同一表要用 `alias:table!fk_column` 消歧義（`employees` ↔ `departments` 之間就有兩條路徑：`employees.department_id` 與 `departments.manager_employee_id`，寫測試 fixture 查詢時很容易忘記加 alias 而撞到 PGRST201）。
- 這個 repo 沒有生成 Supabase `Database` 型別，PostgREST 的 embedded relationship 查詢在 strict tsc 下常需要 `as unknown as {...}` 的兩段式轉型才能過編譯。
- **正式環境相關的環境細節見上方「正式環境設定」一節**，不要跟本機開發的 `.env.local` 混為一談。

## 執行慣例（沿用前幾份計畫）

先用 `superpowers:brainstorming` 跟使用者確認範圍與細節、寫成 spec，再用 `superpowers:writing-plans` 轉成任務拆解的實作計畫，接著才進入 `superpowers:subagent-driven-development`：task-brief → 派 implementer subagent（機械性任務用便宜模型、整合性用中階、安全邊界相關用最強模型審查）→ 產 review-package → 派 reviewer → 修 Critical/Important（若 reviewer 標記 plan-mandated，先跟使用者確認要不要照 plan 執行還是修正，不要自己決定）→ 記錄到 `.superpowers/sdd/progress.md` ledger → 下一個任務 → 完成後跑最終整體審查（用最強模型）→ `superpowers:finishing-a-development-branch` 收尾。

真人瀏覽器 QA 一定要做（前幾份計畫的一致經驗：自動化測試全過，真人操作還是抓到過真實 bug）。測試需要多方角色互動時，可以用 service-role client 直接造測試資料讓「目前登入的這個人」暫時變成某個角色（例如暫時把自己的 `role` 改成 `finance` 測試完再改回來），但這類直接寫資料庫的操作，記得先跟人類講清楚在做什麼、為什麼，並在驗證完後清乾淨——每一次角色切換都要重新徵求同意，不要假設前一次的同意涵蓋後續操作。

**部署相關的操作（Vercel/Supabase 設定變更）也適用同樣的原則**：這類操作可能會被沙盒的安全分類器攔下（見上方「關鍵環境細節」），也可能牽涉會影響所有使用者的正式環境設定（SSO 保護、OAuth 白名單、環境變數），每一項都要先跟使用者說明在做什麼、為什麼，取得明確同意再執行，不要因為前一項操作被同意了就假設後續類似操作也自動獲得授權。
