# 設計文件：預算後台強化與工作流程彈性（第六份計畫・前段）

## 背景

`docs/superpowers/HANDOFF-plan6.md` 交接第六份計畫時列出三個候選任務（報表匯出、組織架構同步、更大範圍預算管理系統），皆需獨立 brainstorming。使用者在本次 session 實際提出的需求比交接文件涵蓋的範圍更廣，共 8 項，經過與使用者逐項確認後，決定：

- **本次（第六份計畫前段）先做**：一組風險較低、範圍明確的小修正與規則調整（本文件涵蓋，對應原始需求第 2、3、7 項）。
- **延後、歸入未來「更大範圍預算管理系統」獨立專案**：原始需求第 1、8 項（年度預算編列、請購單一對多採購/驗收/費用單），以及第 6 項（預算編號啟用/停用機制——使用者表示屆時會直接改用年度預算頁面引用預算代號，屆時一併設計）。
- **暫緩，待與財會確認做法**：原始需求第 4 項（請購單總金額由數量×單價計算）——採購單已是這種算法，請購單目前是數量+總價雙輸入，使用者希望先跟財會確認實際需求再改。
- **非開發任務，純屬運維檢查**：原始需求第 5 項（超過 10 萬需董事長簽核）——`src/lib/approval/chain.ts:21` 的 `CHAIRMAN_THRESHOLD = 100000` 邏輯本身已正確存在，真正要做的只是確認目前是否有員工被設定 `is_chairman = true`，避免案件金額超標時系統因查無董事長而報錯阻擋（`src/lib/approval/build-chain.ts` 的 `.single()` 查詢在查無資料時會拋錯）。這件事在本計畫執行前，或執行 verification 階段時，用一次唯讀查詢確認即可，不需要寫入 spec/plan 流程。

## 範圍（本文件涵蓋的三個子專案）

1. **預算後台強化**：專案實體化（新增 `projects` 表）+ 部門/專案名稱顯示 + 修正現有負數金額顯示
2. **免走採購流程的費用申請單**：金額低於 1 萬元時，費用申請單可不經請購單/採購單/驗收單，直接建立
3. **表單自行修改／撤回**：送出後、第一關審核前，申請人可自行編輯或撤回四張表單（請購單/採購單/驗收單/費用申請單）中的任何一種

三者彼此獨立，可依序個別實作與審查，但共用同一份 spec 是因為範圍都不大、且都是在既有系統上做局部擴充，不需要各自單獨走一輪 brainstorming。

---

## 子專案 1：預算後台強化

### 現況

- `budget_codes` 表（`supabase/migrations/20260710131447_budget_and_suppliers.sql`、`20260712101825_project_scoped_budget_codes.sql`）：`department_id`（FK `departments`）與 `project_code`（自由文字）互斥（CHECK 限制恰好擇一），沒有專案實體，`project_code` 只是文字欄位。
- `/budget-codes` 頁面（`src/app/budget-codes/budget-codes-manager.tsx:191`）目前直接顯示 `b.annualBudgetAmount ?? '-'`，沒有 join 部門/專案名稱，只顯示代號。
- 正式資料庫目前 293 筆 `budget_codes` 中有 **152 筆 `annual_budget_amount` 為負數**（例如 `115ADSE04 = -3600`），這是 Excel 匯入時原始資料本身就是負值造成，純屬符號問題、無業務語意（不代表「扣減科目」等特殊意義）。

### 設計

**資料庫變動：**
- 新增 `projects` 表：`id uuid pk`、`code text unique not null`、`name text not null`、`created_at timestamptz default now()`
- `budget_codes.project_code`（text）改為 `budget_codes.project_id uuid references projects(id)`，CHECK 限制維持「`department_id` 與 `project_id` 恰好擇一非空」
- 資料遷移：對現有 293 筆 `budget_codes` 中每個不重複的 `project_code` 值，各建立一筆 `projects` 列（`code = project_code`、`name = project_code` 作為初始值，之後可透過新管理介面改名），再把對應 `budget_codes` 列的 `project_code` 換成新建立的 `project_id`
- 一次性 UPDATE：現有 152 筆 `annual_budget_amount < 0` 的資料改為 `abs(annual_budget_amount)`。**這是對正式資料庫的直接資料修正，執行前需先讓使用者看過實際會被修改的筆數與 SQL 語句，取得明確同意後才執行**（沿用 `HANDOFF-plan6.md` 記載的「直接寫入型操作要先講清楚再做」原則）。

**程式邏輯變動：**
- `importBudgetCodesFromExcel`（`src/lib/budget-codes/actions.ts`）：匯入金額時改用 `Math.abs()`，避免未來匯入再產生負數
- `/budget-codes` 頁面新增「專案管理」區塊：CRUD 專案（新增/編輯/列表 `code` + `name`），供新增/編輯預算編號時從下拉選單挑選專案（取代原本的自由文字輸入）
- 主表格改為 join 顯示 `departments.name` 或 `projects.name`，而非只顯示代號

### 影響範圍

僅限 `/budget-codes` 頁面與其 server actions/queries（`src/lib/budget-codes/*`）。不影響請購/採購/驗收/費用申請表單本身的建立流程。既有引用 `budget_codes.id` 的其他表（`purchase_request_items` 等）不受影響，因為外鍵指向的是 `budget_codes.id` 本身，不是 `project_code`。

---

## 子專案 2：免走採購流程的費用申請單（低於 1 萬元）

### 現況

- `expense_requests.purchase_order_id`（`supabase/migrations/20260711164720_expense_requests.sql:4`）是 `not null` 外鍵，目前**沒有任何路徑可以建立不掛在採購單下的費用申請單**。
- `procurement_cases`（`supabase/migrations/20260711033121_procurement_cases.sql`）目前永遠由 `createPurchaseRequest`（`src/lib/purchase-requests/actions.ts:86-97`）建立新案件；`expense_requests` 建立時（`src/lib/expense-requests/actions.ts:45-68,147`）永遠是**繼承**已核准採購單的 `procurement_case_id`，從未自建新案件。
- 案件追蹤頁完成判定（`src/lib/case-tracking/determine-bucket.ts:11-14`）目前寫死要求「四張表單全部存在且 approved」才算完成。

### 設計

**資料庫變動：**
- `expense_requests.purchase_order_id`：`not null` 改為可為 `null`
- 新增 `expense_requests.budget_code_id uuid references budget_codes(id)`，僅在 `purchase_order_id is null` 時使用（一般模式下維持經由 PO→請購單鏈取得預算歸屬，不使用這個欄位）
- `procurement_cases` 新增 `case_type text not null default 'standard'`，允許值 `'standard'` / `'standalone_expense'`——讓案件追蹤頁能直接依欄位判斷完成規則，不用反推表單存在與否

**建立流程：**
- 費用申請單建立頁（`src/app/expense-requests/new/`）新增模式切換：「免走採購流程（金額低於 1 萬元）」
  - 此模式下：直接選 `budget_code_id`，自行填寫項目說明與金額（不像一般模式是勾選既有來源項目），總金額須 `< 10000`，否則擋下並提示改用一般流程重新走採購
  - Server action 呼叫 `next_case_number()` 建立新 `procurement_cases` 列（`case_type='standalone_expense'`），`expense_requests.purchase_order_id` 留 `null`
- 一般模式（經由已核准採購單）維持現況完全不變

**簽核鏈：** 沿用現有 `generateApprovalChain`（`src/lib/approval/chain.ts`）：部門主管 → 預算擁有人 → 總經理。預算擁有人在 standalone 模式下從 `expense_requests.budget_code_id` 對應的 `budget_codes.owner_employee_id` 取得（一般模式邏輯不變）。金額低於 1 萬元不會觸發 `CHAIRMAN_THRESHOLD`，不受影響。

**案件追蹤頁變動：** `determineCaseBucket` 依 `case_type` 分流——`case_type='standalone_expense'` 時只需要「費用申請單存在且 approved」即為完成；`case_type='standard'` 維持現有「四張表單皆存在且 approved」規則。

### 影響範圍

`expense_requests` 相關 schema/actions/queries、`procurement_cases` schema、`case-tracking` 的完成判定邏輯。不影響請購單/採購單/驗收單既有邏輯。

---

## 子專案 3：表單自行修改／撤回（送出後、第一關審核前）

### 現況

- 四張表單（請購單/採購單/驗收單/費用申請單）狀態機皆為 `pending_approval` / `approved` / `returned`（各自 migration 中定義），無 `withdrawn` 狀態。
- 目前**完全沒有申請人在 `pending_approval` 狀態下可編輯或撤回表單的路徑**——唯一的狀態轉換動作是當前關卡審核人的核准/退回（`loadCurrentStep` 守門，`src/lib/purchase-requests/actions.ts:187-211`）。
- 四張表單皆已有 `resubmit_*` 系列 SQL function（僅在 `status='returned'` 時可用，重建簽核鏈、`current_step_order` 重設為 1），但**目前沒有任何頁面接上這個功能**——是可參考、但不能直接沿用的既有機制（因為 resubmit 的前提是「已被退回」，跟本次「尚未有人簽核」的前提不同，但重建簽核鏈的做法可以照抄）。

### 設計

**資料庫變動：**
- 四張表單的 `status` enum 各自新增 `'withdrawn'` 值

**編輯行為（每種表單各一支新 server action，如 `updatePurchaseRequest`）：**
- 條件：呼叫者為該表單的 `applicant_employee_id` 本人、`status='pending_approval'`、`current_step_order=1`（第一關尚未有任何簽核動作）
- 允許修改項目內容，重新計算總金額
- 因總金額可能因編輯而跨越 10 萬元董事長門檻，**簽核鏈必須整套重建**：刪除既有 `approval_steps`，依新總金額重新呼叫 `generateApprovalChain` 產生新鏈，`current_step_order` 重設為 1（做法比照 `resubmit_*` function 的重建邏輯，但由 `pending_approval` 狀態直接觸發，不需要先轉成 `returned`）。`procurement_case_id`／案號不變。
- UI：複用既有建立表單頁面元件，帶入既有資料作為「編輯模式」的預填值

**撤回行為（每種表單各一支新 server action，如 `withdrawPurchaseRequest`）：**
- 條件同編輯（申請人本人、`pending_approval`、`current_step_order=1`）
- 動作：`status` 設為 `'withdrawn'`、`current_step_order=null`。**不刪除任何資料列**（表單本身、項目、案件皆保留，供日後查詢）

**UI 進入點：** 各表單詳情頁（如 `src/app/requests/[id]/page.tsx`）新增判斷：當「`status='pending_approval'` 且 `current_step_order=1` 且目前登入者為申請人本人」時，顯示「編輯」「撤回」兩個按鈕。這是全新的 UI 區塊，四張表單詳情頁皆比照辦理。

**案件追蹤頁變動：** 新增第三個分類「已撤回」，與現有「簽核中」「已完成」並列——只要案件中任一張表單狀態為 `withdrawn`，該案件歸類為「已撤回」，不再落入「簽核中」造成混淆。

### 影響範圍

四張表單各自的 `actions.ts`、狀態機、詳情頁 UI，以及案件追蹤頁的分類邏輯（`src/lib/case-tracking/`）。

---

## 測試考量

- 子專案 1：`budget_codes`/`projects` 的 CRUD 整合測試；一次性資料修正需要在測試環境先驗證 SQL 邏輯正確（例如筆數符合預期的 152 筆），正式環境執行前需使用者明確同意
- 子專案 2：需覆蓋「金額剛好等於/超過 10000」邊界情況、`case_type='standalone_expense'` 案件在案件追蹤頁的完成判定、簽核鏈正確組成（部門主管→預算擁有人→總經理）
- 子專案 3：需覆蓋「非申請人本人嘗試編輯/撤回」「`current_step_order != 1` 時嘗試編輯/撤回」「編輯後金額跨越 10 萬門檻，簽核鏈正確重建」等守門條件的負向測試
- 四張表單目前皆無 Zod schema（純手寫 TypeScript 驗證於各自 `validate.ts`），子專案 2、3 新增的驗證邏輯應沿用現有手寫驗證風格，不需引入 Zod

## 待辦提醒（非本次 spec 範圍，執行前後可順手處理）

- 執行前／verification 階段：查詢 `employees` 表確認目前是否有人被設為 `is_chairman = true`，若沒有，跟使用者確認要指派誰，避免子專案 2、3 的測試案件金額若剛好超過 10 萬時系統報錯（雖然子專案 2 的免走採購案件金額必然 < 1 萬，不會觸發，但子專案 3 的編輯功能理論上可能讓請購單金額編輯到超過 10 萬）
- `HANDOFF-plan6.md` 記載的技術債（舊 worktree、逾時測試、RLS 測試假帳號等）與本次三個子專案無直接關聯，不在本次處理範圍內
