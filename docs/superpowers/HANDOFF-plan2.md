# 交接摘要：實作第二份計畫（請購單 + 簽核引擎篇）

> 用途：在新的 session 直接引用，快速接手實作第二份計畫。

## 專案
台灣智慧駕駛（Turing Drive）企業內部電子採購與簽核系統。技術棧：Next.js 15（App Router）+ Supabase（Postgres + RLS + Auth）+ TypeScript strict + Vitest。
- 專案根目錄：`/Users/davidtws/Documents/Projects/ACC`
- GitHub：https://github.com/davidtws411/ACCSYS
- 設計規格：`docs/superpowers/specs/2026-07-10-procurement-approval-system-design.md`

## 目前進度
- **地基篇（第一份計畫）已完成**：Next.js/Supabase 骨架、主檔資料表（departments/employees/budget_codes/suppliers）+ RLS、種子資料（8 部門 / 39 員工 / 185 預算編號 / 4 供應商）、Google OAuth 登入（限 turing-drive.com 網域）、儀表板 + 主檔頁。已開 PR：https://github.com/davidtws411/ACCSYS/pull/1（分支 `procurement-foundation`，worktree 在 `.worktrees/procurement-foundation`）。登入流程已實地驗證可用。
- **第二份計畫已寫好、待實作**：`docs/superpowers/plans/2026-07-11-purchase-request-approval-engine.md`（16 個任務）。

## 要做的事
用 **subagent-driven-development** 逐任務執行第二份計畫。開場請先讀計畫檔，並沿用地基篇同一個 worktree（`.worktrees/procurement-foundation`，分支 `procurement-foundation`）繼續實作，接在 PR #1 之上。

## 第二份計畫在做什麼（16 任務）
- Task 1–5：service-role client、`procurement_cases` + 原子案件單號、`purchase_requests` + 明細、多型 `approval_steps` + `notifications`、參與者範圍 RLS
- Task 6–7：`generateApprovalChain()`、`validatePurchaseRequestInput()` 純函式（單元測試）
- Task 8–10：建立 / 核准 / 退回 / 重送 server actions（service-role + 程式碼授權）
- Task 11–15：查詢 helper、建立表單、請購單列表 / 明細、待簽核佇列、通知頁 + 儀表板導覽
- Task 16：完整驗證

## 關鍵環境細節（重要）
- `.env.local` 已存在於 worktree 根目錄，含真實 Supabase 憑證（`NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_ANON_KEY`、`SUPABASE_SERVICE_ROLE_KEY`、`SUPABASE_ACCESS_TOKEN`、`SUPABASE_DB_PASSWORD`、`ALLOWED_GOOGLE_DOMAIN=turing-drive.com`）。**絕不可 commit，絕不可 print 值。**
- 跑整合測試前要先 `export $(grep -v '^#' .env.local | xargs)`，否則整合測試會 skip。
- `npm test` 已內建 `NODE_OPTIONS=--experimental-websocket`（Node 20 需要，勿移除）。
- Migration 用 `supabase db push` 套到已連結的 hosted 專案（已 link，免重連）。**這會實際寫入正式 Supabase 專案且已有真實種子資料 —— 寫入型操作要謹慎。**
- Supabase 多型查詢：多個 FK 指向同一表要用 `alias:table!fk_column` 消歧義（計畫內已寫對，實作照抄即可）。

## 尚待人工完成的項目（皆已完成，供參）
1. Supabase 後台已啟用 Google OAuth provider ✅
2. `employees` 表已設定沈大維 `google_email=david_shen@turing-drive.com`、`role=admin` ✅（可用此帳號登入測試）

## 已定案的商業規則（計畫已納入）
- 一張請購單所有預算編號必須屬同一位預算負責人（簽核鏈單一預算負責人關卡）
- 本期只做系統內通知，Email 留待後續
- 加簽門檻：該表單金額 > 10 萬加簽董事長（100,000 剛好不加簽）

## 執行慣例（沿用地基篇）
每個任務：task-brief → 派 implementer subagent（機械性任務用便宜模型、整合性用中階）→ 產 review-package → 派 reviewer → 修 Critical/Important → 記錄到 `.superpowers/sdd/progress.md` ledger → 下一個。完成後跑最終整體審查（用最強模型），再收尾分支。

## 地基篇留待後續處理的技術債（第二/三份計畫可順帶處理）
- `next_case_number()` 以外的種子腳本 skip-counter 會把「已知專案型預算」與「未來真的解析失敗」混為一談（低風險）
- `is_admin()` / `current_employee_id()` 的 `search_path` 可再收緊為 `''` + schema 限定名
- `package.json` 缺 `engines: { node: ">=20" }`
- `npm run lint` 尚無 `eslint.config.js`
- 未產生 Supabase `Database` 型別（查詢的 row 欄位存取尚未編譯期檢查）
- `/login` 尚未把 `?error=` 顯示給使用者
- 108 筆專案型預算編號尚未匯入（部門欄位填的是專案代碼）
