# 預算編號基礎資料管理（Excel 批次匯入 + 網頁 CRUD）Design

## Context

台灣智慧駕駛（Turing Drive）電子採購與簽核系統。`budget_codes` 表（部門預算／專案預算的編號主檔）目前只有兩個進入管道：

1. `scripts/import-seed-data.ts`（CLI，`npm run seed`）讀取一份混合了部門／員工／預算／供應商資料的內部參考檔（`link` 隱藏工作表），由開發人員在終端機執行，用於初始建置或全面重新匯入。
2. Supabase Studio 手動編輯——目前唯一能修改既有預算編號、或補上 Task 10 遺留的 108 筆專案型預算編號負責人（`owner_employee_id`）的方式。

`/admin/master-data` 頁面（限 `role = 'admin'`）目前只能唯讀瀏覽預算編號清單（`code, category, fiscal_year`），無法新增/編輯/匯入。

**本次要解決的問題**：財會人員需要能自行維護預算編號（部門預算＋專案預算），不需要開發人員介入或直接動 Supabase Studio。

**範圍邊界（重要）**：使用者在討論中揭露了更大的預算管理需求——年度預算按月編列（`2026年度部門預算表`／`2026年度專案預算表` 兩份紙本範本，含「預算新增申請書」「預算變更申請書」簽核流程、專案的工作項目與進度追蹤）。這是規模與複雜度接近整個請購/採購/驗收/費用申請系統的獨立子系統，**明確不在本次設計範圍內**，留待後續獨立規劃（見「未來擴充」一節）。本次只處理「預算編號基礎資料」這一塊：編號、部門或專案歸屬、類別、年度、金額、負責人。

## Goals

- 財會人員（`role = 'finance'`）可以透過網頁：
  - 上傳 Excel 檔案批次匯入/更新預算編號
  - 在網頁上手動新增、編輯、刪除單筆預算編號
  - 瀏覽目前所有預算編號的清單，一眼看出哪些缺少負責人
- 兩種輸入方式（批次匯入／手動 CRUD）套用完全相同的驗證規則與寫入邏輯，不會有兩套規則彼此不一致的風險
- 為未來的年度預算編列／異動流程留下合理的擴充基礎，但不在本次實作

## Non-Goals

- 年度預算按月編列（`部門預算表`／`專案預算表` 的月別欄位、現金流欄位）
- 預算新增申請書／變更申請書的數位化簽核流程
- 專案工作項目清單／預算執行進度表
- 預算執行追蹤／超支警示（比對已核准請購單/採購單/費用申請單金額與預算餘額）
- 修改或取代現有 `npm run seed` CLI 匯入機制（`scripts/import-seed-data.ts`、`scripts/lib/parse-seed-workbook.ts` 維持不變，繼續作為初始建置/全面重新匯入之用，兩者並行不互相影響）

## Architecture

新增一個獨立頁面 `/budget-codes`，僅限 `role = 'finance'` 進入（比照現有頁面權限檢查模式：`getCurrentEmployee` 查無則導向 `/login`；角色不符則導向 `/dashboard`）。頁面三個區塊：

1. Excel 批次匯入表單
2. 手動新增/編輯表單（同一表單，留空即新增模式，帶入既有資料即編輯模式）
3. 現有預算編號清單（含「缺少負責人」標示、每列的編輯／刪除操作）

**核心設計原則：批次匯入與手動 CRUD 共用同一套驗證與寫入邏輯。** 這套邏輯封裝在 `src/lib/budget-codes/actions.ts` 的一個內部函式（暫名 `upsertOneBudgetCode`）裡，執行：

- 部門代碼／專案代碼互斥檢查（恰有一個非空，對應資料庫的 XOR CHECK constraint）
- 部門代碼須能對應到真實部門（`departments` 表），對不到視為錯誤（不像舊 CLI 腳本那樣把對不到的部門代碼靜默當成專案代碼）
- 專案代碼為自由文字，不驗證對應表
- 年度預算金額須為正數
- 負責人工號（若提供）須能對應到真實員工，對不到視為錯誤
- 負責人留空時：部門預算 → 自動帶入該部門的 `departments.manager_employee_id`；專案預算 → 維持 `null`（與 Task 10 現況一致）

手動新增/編輯表單（單筆）與 Excel 匯入（逐行呼叫同一函式）都只是這個核心函式外面包的不同「呼叫方式」，不是兩套平行邏輯。

## Data Model

**不需要修改資料庫 schema。** `budget_codes` 表（含 Task 10 已加入的 `project_code` 欄位與 XOR CHECK constraint）已足夠支撐本次功能：

```
budget_codes(
  id uuid primary key,
  code text unique not null,
  department_id uuid null references departments(id),
  project_code text null,
  category text not null,
  owner_employee_id uuid null references employees(id),
  fiscal_year text not null,
  annual_budget_amount numeric(14,2),
  created_at timestamptz not null
)
-- check (department_id is not null) <> (project_code is not null)
```

`annual_budget_amount` 目前資料庫層級允許 null／非正數；本次新增的「金額須為正數」規則只在應用層（`upsertOneBudgetCode`）驗證，不新增資料庫 CHECK constraint（避免影響既有可能不完美的資料列）。

## Excel Template

全新專用範本（與現有 `link` 混合工作表分開，不共用解析邏輯）。單一工作表，欄位：

| 欄位（中文表頭） | 對應欄位 | 規則 |
|---|---|---|
| 預算編號 | `code` | 必填，唯一識別；已存在則更新，不存在則新增 |
| 部門代碼 | `department_id`（查表轉換） | 與「專案代碼」恰填一欄；須對應真實部門，否則整行錯誤 |
| 專案代碼 | `project_code` | 與「部門代碼」恰填一欄；自由文字 |
| 類別 | `category` | 必填 |
| 年度 | `fiscal_year` | 必填，明確欄位（民國年，如 115），不從編號前綴推導 |
| 年度預算金額 | `annual_budget_amount` | 必填，正數 |
| 負責人工號 | `owner_employee_id`（查表轉換） | 選填；規則見上「核心設計原則」 |

解析模組：`src/lib/budget-codes/parse-budget-workbook.ts`（純函式，輸入檔案 buffer、輸出 `ParsedBudgetRow[]`），放在 `src/lib/` 而非 `scripts/lib/`，因為要被網頁的 Server Action 呼叫（`scripts/` 只給 CLI 用）。沿用專案既有的 `xlsx` 套件（`scripts/lib/parse-seed-workbook.ts` 已在用）。

## Import Behavior

Excel 上傳採**部分成功**模式：

- 逐行呼叫 `upsertOneBudgetCode`
- 驗證通過的行立即寫入（upsert，以 `code` 判斷新增或更新）
- 驗證失敗的行跳過，不影響其他行
- 上傳結束後回傳結構化結果：`{ successCount: number, errors: { row: number; reason: string }[] }`
- 頁面顯示「成功 N 筆、失敗 M 筆」，每筆失敗附上列號與具體原因（例如：「第 5 列：部門代碼與專案代碼皆為空」「第 12 列：負責人工號 0099 查無此員工」「第 8 列：年度預算金額必須為正數」)
- 匯入永遠不刪除既有預算編號——檔案裡沒列出的舊編號保持不變

## Page Interactions

- **清單**：表格列出所有 `budget_codes`（編號、部門或專案代碼、類別、年度、金額、負責人姓名或「⚠️ 缺少負責人」），依編號排序；每列有「編輯」「刪除」操作
- **新增/編輯**：同一張表單，點擊清單的「編輯」帶出既有資料；表單留空即為新增模式；送出後呼叫 `upsertOneBudgetCode`，成功後 `revalidatePath('/budget-codes')` 刷新清單
- **刪除**：刪除前檢查 `purchase_request_items.budget_code_id` 是否有任何列引用該預算編號；有引用則拒絕並顯示「此預算編號已被請購單使用，無法刪除」；無引用才真正 `delete`
- **權限**：非 `finance` 角色訪問 `/budget-codes` 一律導向 `/dashboard`

## Error Handling

- 手動新增/編輯：`upsertOneBudgetCode` 回傳 `{ ok: false; error: string }` 時，表單就地顯示錯誤訊息（繁體中文），不清空使用者已輸入的內容
- Excel 匯入：如上「Import Behavior」一節，逐行錯誤收集，不中斷整批處理
- 刪除：被引用時回傳明確錯誤訊息，不做任何刪除操作（沒有部分刪除的概念，這是單筆操作）

## Testing Strategy

- `src/lib/budget-codes/parse-budget-workbook.test.ts`：純函式單元測試（比照 `scripts/lib/parse-seed-workbook.test.ts` 風格）——正常列解析、部門/專案欄位互斥的原始資料保留（驗證留給 actions 層，parser 只負責解析與型別轉換）
- `tests/integration/budget-codes-actions.test.ts`（沿用現有慣例：涉及真實資料庫讀寫的 Server Actions 一律放 `tests/integration/`，比照 `acceptance-approve-return.test.ts`／`attachments actions` 等既有測試檔案，而非與 `src/lib/` 下的原始碼同層放 `.test.ts`）：
  - 新增（部門預算、專案預算）
  - 編輯既有預算編號
  - 刪除（含「已被請購單引用時拒絕刪除」）
  - 部門預算負責人留空時自動帶入部門主管
  - 部門/專案代碼互斥驗證（兩者皆空、兩者皆填）
  - 金額非正數時拒絕
  - 負責人工號查無員工時拒絕
  - Excel 批次匯入的部分成功情境（部分行成功、部分行報錯，且錯誤訊息可辨識是哪一行、什麼原因）
  - upsert 語意：重複匯入同一編號會更新而非產生重複列
- 權限測試：非 `finance` 角色（`staff`／`admin`）無法存取 `/budget-codes` 或呼叫其 Server Actions

## Future Extension (不在本次實作範圍，僅記錄設計意圖)

- `budget_codes` 持續作為「預算主檔」角色。未來的年度預算編列（部門預算表／專案預算表，按月）、預算新增申請書、預算變更申請書等功能，會是**額外新增、參照 `budget_codes.code`/`id` 的新表與新表單**，不會回頭改動本次建立的核心結構。
- `src/lib/budget-codes/` 目錄未來若要支援「部門預算表」「專案預算表」格式的月別匯入，會是同目錄下新增的獨立解析函式（例如 `parse-monthly-budget-workbook.ts`），不會修改或耦合本次的 `parse-budget-workbook.ts`。
- 預算執行追蹤／超支警示（比對已核准表單金額與預算餘額）是獨立子專案，需要先有本次的預算主檔資料才能進行，留待後續規劃。
