# 財會簽核追蹤頁 Design

## Context

台灣智慧駕駛（Turing Drive）電子採購與簽核系統。目前財會人員（`role = 'finance'`）沒有任何頁面可以一次看到**全公司**所有案件（不限自己承辦）的簽核進度：

- `/cases/[caseNumber]` 只能查「單一案件」，需要事先知道案號
- `/admin/master-data` 是主檔資料（部門/員工/預算編號/供應商）的唯讀總覽，不含案件/表單資料，而且限 `role = 'admin'`
- RLS 已經開放 `is_finance()`（`finance`、`admin` 角色）讀取全部四張表單（`purchase_requests`／`purchase_orders`／`acceptances`／`expense_requests`）、其明細、與附件，**沒有資料庫權限異動需要做**

**本次要解決的問題**：財會人員需要一個專屬頁面，能依部門/日期/關鍵字篩選，並用「簽核中」「已完成」兩個頁籤分類瀏覽全公司所有案件的簽核狀態。

**範圍邊界（重要）**：使用者在交接文件中還提出了「匯出成給事務所的報表」與「更大範圍的預算編列/管理系統」兩項候選需求。本次 brainstorming 已與使用者確認，**匯出功能明確不在這次範圍內**（格式/欄位要事務所實際需求出來後才做，避免自行假設），**預算管理系統也不在這次範圍內**（見 [`2026-07-12-budget-code-management-design.md`](2026-07-12-budget-code-management-design.md) 的 Future Extension 一節）。本次只做「簽核狀態追蹤清單」這一塊，UI 也刻意留有未來擴充空間——使用者已表示之後會再跟會計人員討論最符合工作流程的呈現方式，這次先做一版夠用、簡單、之後容易調整的版本。

## Goals

- 財會人員登入後，可以在 `/case-tracking` 頁面看到全公司所有案件（不限自己承辦）的簽核進度
- 用「簽核中」「已完成」兩個頁籤分類（判定規則見 Architecture 一節）
- 可依部門、建立日期區間、關鍵字（案號或申請人姓名）篩選
- 點擊案號可直接連到既有的 `/cases/[caseNumber]` 案件總覽頁
- 查詢效能不隨案件數量線性增加查詢次數（避免 N+1）

## Non-Goals

- 匯出成給事務所的報表（Excel/PDF）——留待事務所實際格式需求確認後再規劃
- 儀表板統計卡片（總金額、各狀態件數等）——這次先做清單，之後跟會計人員討論 UI 時再評估是否需要
- 合併顯示案件的「代表金額」——同一案件在請購/採購/驗收/費用申請四階段金額可能不同，顯示哪一個屬於呈現細節，這次不做假設
- 資料庫層級的 view/RPC 或分頁機制——這次以應用層批次查詢因應目前資料量，未來真的有效能問題再升級（見 Architecture 的取捨說明）
- 更大範圍的年度預算編列/管理系統（部門預算表/專案預算表按月編列、預算新增/變更申請書簽核流程）——規模與請購/採購/驗收/費用申請系統相當，是獨立子專案

## Architecture

新增頁面 `/case-tracking`（Server Component），權限比照 `/budget-codes` 既有慣例：`getCurrentEmployee` 查無則導向 `/login`；`employee.role !== 'finance'` 則導向 `/dashboard`（這次先只開放 `finance`，不含 `admin`，對應交接文件「財會人員登入後」的描述；之後如需開放 admin 再調整這一行判斷式即可）。

**資料查詢**：新增 `src/lib/case-tracking/queries.ts`，核心函式 `getFinanceCaseTracking(filters: CaseTrackingFilters)`：

1. 查 `procurement_cases`（`select id, case_number, created_at, created_by:employees!created_by_employee_id(name)`），套用日期區間篩選（`created_at`）
2. 用第 1 步查到的 case ids，對四張表單各發**一次**批次查詢（`.in('procurement_case_id', caseIds)`），欄位含 `id, status, department_id, applicant:employees!applicant_employee_id(name), departments(name)`——四張表單型別、路由前綴、資料表名稱一律沿用 `src/lib/procurement/form-registry.ts` 既有的 `FORM_TYPES`／`FORM_TABLE`／`FORM_LABELS`，不再新增第三份重複定義（`src/lib/cases/queries.ts` 現有的 `FORM_DEFS` 是先前計畫審查時就記錄的技術債，這次一併整理）
3. 在應用層以 `procurement_case_id` 為 key，把四張表單的查詢結果 join 回每個案件，組成 `CaseTrackingRow`：

   ```
   CaseTrackingRow = {
     caseNumber: string
     department: string | null       // 取四張表單中最早建立（依 FORM_TYPES 順序）那張的 department
     applicant: string | null        // 同上，取申請人姓名
     forms: { formType: FormType; exists: boolean; status: string | null }[]
     bucket: 'in_progress' | 'completed'
   }
   ```

4. 頁籤判定規則（bucket）：**四張表單全部存在且皆為 `approved`** → `completed`；**其餘所有情況**（含任一表單 `pending_approval`、任一表單 `returned`、或後續表單尚未建立）→ `in_progress`。這條規則抽成獨立的純函式 `determineCaseBucket(forms)`，方便單元測試涵蓋邊界情況
5. 套用部門篩選（比對第 3 步算出的 `department`）與關鍵字篩選（`caseNumber` 或 `applicant` 包含關鍵字）

**為什麼不比照 `getCaseOverview` 逐案查詢**：`getCaseOverview`（`src/lib/cases/queries.ts`）是「查單一案件」用的，每個案件要發 4～8 次查詢（4 張表單 + 各自的附件計數）。在「列出全公司案件」的情境下逐案查會是嚴重的 N+1；改成「案件查詢 + 四張表單各批次查一次」，總查詢次數固定為 5 次，不隨案件數量線性增加。

**與資料庫 view/RPC 方案的取捨**：曾考慮寫 SQL view 在資料庫層做 join 與篩選，長期擴充性更好，但需要新增 migration、處理 RLS 在 view 上的 `security_invoker` 設定，複雜度明顯提高，且目前系統沒有其他頁面用這種模式。以公司內部採購系統的資料量，應用層批次查詢在可預見的未來不會是效能瓶頸，之後真的需要再升級不遲。

## UI / Page Interactions

- **頁籤**：「簽核中」「已完成」兩個頁籤，用 `<Link href="?tab=completed&...">` 實作並保留其他篩選參數（不需要用戶端 JS），各自標示筆數（例如「簽核中（12）」）
- **篩選表單**：純 `<form method="get">`，部門用 `<select>`（選項來自 `departments` 表）、日期區間用兩個 `<input type="date">`、關鍵字用一個 `<input type="text">`，送出後整頁依新的 `searchParams` 重新渲染
- **清單表格**：一列一案，欄位為「案號（連結到 `/cases/[caseNumber]`）｜部門｜申請人｜請購狀態｜採購狀態｜驗收狀態｜費用申請狀態」，狀態文字沿用 `/cases/[caseNumber]` 既有的 `STATUS_LABELS`（簽核中/已核准/已退回（待修改）），表單不存在時顯示「尚未建立」
- **空清單狀態**：無符合篩選條件的案件時，顯示「目前沒有符合篩選條件的案件」文字，不視為錯誤

## Error Handling

- 未登入或非 `finance` 角色 → 沿用既有 redirect 慣例，不顯示錯誤頁
- 篩選條件格式無效（日期格式錯誤、`dateFrom` 晚於 `dateTo`）→ 該條件直接忽略、不套用篩選，不中斷頁面渲染
- 篩選後無符合案件 → 正常空清單狀態
- 查詢層失敗（Supabase 連線異常等）→ 不特別處理，交由 Next.js 既有的 error boundary，與其他頁面一致

## Testing Strategy

- `src/lib/case-tracking/determine-bucket.test.ts`：純函式單元測試，涵蓋 `determineCaseBucket` 的所有邊界情況——四表皆 approved（completed）、任一 pending_approval（in_progress）、任一 returned 且無 pending_approval（in_progress）、後續表單尚未建立（in_progress）
- `tests/integration/case-tracking-queries.test.ts`：真實 Supabase 驗證 `getFinanceCaseTracking`：
  - 部門篩選、日期區間篩選、關鍵字篩選（案號／申請人）各自正確
  - 頁籤分類結果正確（結合真實跨表單資料）
  - 查詢次數固定（不隨案件數增加而增加，可用查詢計數或 mock 驗證）
  - 建立測試 fixture 涉及部門/員工時，比照交接文件記錄的「循環外鍵清理」注意事項處理 `afterAll` 清理順序（先清 `departments.manager_employee_id`，再刪員工，最後刪部門）
- 權限測試：非 `finance` 角色（`staff`／`admin`）無法存取 `/case-tracking`
- 真人瀏覽器 QA：比照專案慣例，自動化測試通過後仍需手動瀏覽器驗證。用 service-role 建立跨部門、跨頁籤、跨狀態（含 returned、含表單尚未建立）的測試案件，驗證篩選/頁籤/案號連結皆正確，測試完畢清乾淨測試資料

## Future Extension（不在本次實作範圍，僅記錄設計意圖）

- 匯出報表：待事務所實際格式/欄位需求確認後，於本次建立的 `getFinanceCaseTracking` 查詢基礎上新增匯出功能，不需要重新設計查詢層
- 儀表板統計、更豐富的呈現方式：待與會計人員進一步討論工作流程後，作為本次清單頁的擴充或替代方案
- 若案件量成長到應用層批次查詢出現效能瓶頸，可將 `getFinanceCaseTracking` 的邏輯升級為資料庫 view/RPC，查詢介面（filters 參數、回傳的 `CaseTrackingRow[]`）不必變動
