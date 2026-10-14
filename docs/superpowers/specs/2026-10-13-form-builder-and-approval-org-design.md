# 設計文件：表單設計器、簽核流程設定與組織架構

日期：2026-10-13。狀態：設計稿，待確認後分階段實作。

## 背景與目標

目前 13 種表單（採購四件、費用四版＋出差、用印三類、資產異動）各自有獨立的資料表、驗證、頁面與簽核鏈程式。每多一張客製表單就要新增 migration、service、四個頁面與一組測試；舊系統截圖（用印申請單／非合約類）也顯示公司實際上有大量格式相近、但欄位與簽核關卡各異的表單。

本設計的目標：

1. **表單設計器**：超級管理員以拖拉元件的方式製作表單，發佈到系統，並指定放在哪個入口分類。
2. **簽核流程設定**：每張表單設定審核關卡（指定員工、職務類別、部門主管、表單欄位所選的人、預算負責人），支援條件關卡；送出後依設定產生簽核步驟，走現有的核准／退回／撤回／重送流程。
3. **簽核追蹤**：申請人看得到簽到哪一關、誰簽的、何時簽，呈現方式如舊系統的橫向時間軸（含「由系統代簽」）。
4. **組織架構**：從 Google Workspace（GWS）取得公司人員，綁定部門（可分層）、職務類別與代理人，形成簽核組織樹。
5. **既有表單遷移**：使用者已確認，既有 13 種寫死的表單最終都要改由設計器產生（分批遷移，見第 9 節）。

### 已確認的決策（2026-10-13）

| 項目 | 決策 |
|---|---|
| 既有表單 | 全部規劃遷移到設計器 |
| 簽核流程能力 | 依序簽核＋條件關卡；簽核人類型：特定人、職務類別、部門主管、表單欄位選的人、預算負責人。第一版不做會簽（同關多人） |
| 組織元素 | 部門階層、職務類別、代理人。不做跨部門團隊 |
| 人員來源 | GWS 介接 |
| 超級管理員 | 沿用現有 `admin` 角色 |

### 不在本次範圍

- 會簽／任一人簽（同一關多人），保留資料結構擴充空間。
- 跨部門團隊、專案小組。
- 表單間的任意資料串接腳本（只提供第 7 節的「關聯單據」元件與註冊式核准後動作）。
- 公開（未登入）表單、外部人員填寫。

---

## 1. 整體架構

```text
超級管理員
  ├─ /admin/org            組織架構：部門樹、職務類別、員工綁定、代理人、GWS 同步
  ├─ /admin/form-builder   表單設計器：欄位設計、簽核流程、發佈設定、預覽
  └─ /admin/option-sets    共用選項清單（印鑑名稱、文件類別、用印時效…）

一般使用者
  ├─ /forms 與上方選單      入口分類（由資料庫的分類＋已發佈表單產生）
  ├─ /f/[key]/new          依發佈版本的定義渲染填寫頁
  ├─ /f/[key]/[id]         詳情：表頭卡片＋欄位內容＋附件＋簽核時間軸
  ├─ /f/[key]              我的申請列表
  └─ /approvals            待簽核（既有頁面，加入動態表單）

伺服器
  form definition version（不可變 JSON）
    → 驗證器（由定義產生，伺服器端重算）
    → form_submissions（JSON 資料＋提升欄位）
    → 流程解析器（flow JSON × 組織資料 → 簽核人清單）
    → approval_steps / notifications / attachments / procurement_cases（沿用）
```

原則：

- **沿用現有簽核骨架**：`runInTransaction`、`lockForm`、`insertSteps`、`decideCurrentStep`、`withdrawForm`、idempotency、通知 event key 全部沿用，不另造工作流引擎。
- **定義與資料分離、版本不可變**：已送出的單據永遠對應送出當下的定義版本；修改表單只會產生新版本，不影響舊單據的顯示與簽核。
- **伺服器端為準**：前端渲染只為了操作體驗；必填、格式、計算欄位（如明細合計）一律由伺服器依定義重新驗證與重算。

---

## 2. 組織架構

### 2.1 現況

- `departments`：code、name、`manager_employee_id`，沒有上層部門。
- `employees`：部門、職稱、`role`（staff/finance/admin）、`is_general_manager`、`is_chairman`、`access_enabled`。
- 員工匯入只有 CLI（`scripts/import-seed-data.ts` 讀 Excel）；`/admin/master-data` 只能檢視；`/admin/accounts` 管登入綁定與角色。
- 架構計畫 P6 已定義 GWS 唯讀同步原則：Directory API、專用唯讀授權、`directory_users` 快照、「GWS OU 不等於簽核部門」。

### 2.2 資料模型

**departments（擴充）**

| 欄位 | 說明 |
|---|---|
| `parent_department_id` | 上層部門，可空（最上層）。禁止循環（寫入時檢查祖先鏈） |
| `level_label` | 顯示用層級名稱，如「處」「部」「課」，可空 |
| `sort_order` | 同層排序 |
| `active` | 停用的部門保留歷史，不可再被選取 |

`manager_employee_id` 沿用，作為「部門主管」關卡的來源。

**job_roles（新）— 職務類別**

| 欄位 | 說明 |
|---|---|
| `code` | 唯一，如 `general_manager`、`chairman`、`legal`、`admin_office` |
| `name` | 顯示名稱，如「總經理」「董事長」「法務窗口」「管理部窗口」 |
| `description` | 用途說明 |
| `is_system` | 系統內建（總經理、董事長），不可刪除 |
| `active` | |

**employee_job_roles（新）— 員工 × 職務類別**

| 欄位 | 說明 |
|---|---|
| `employee_id`、`job_role_id` | |
| `department_id` | 可空。有值代表「某部門的該職務」（例：研發部的財務窗口）；空值代表全公司 |
| `is_primary` | 同一職務（及範圍）有多人時，簽核預設取這位 |

唯一性：`(job_role_id, department_id, employee_id)`。第一版不做會簽，所以若職務類別解析到多人，取 `is_primary`；沒有 primary 時送出失敗並提示管理員設定。

`is_general_manager`／`is_chairman` 的遷移：建立內建職務並把現有旗標轉成綁定；過渡期兩邊同步寫入，舊的寫死簽核鏈（尚未遷移的表單）繼續讀旗標。全部表單遷移完成後才移除旗標。

**approval_delegations（新）— 代理人**

| 欄位 | 說明 |
|---|---|
| `delegator_employee_id` | 原簽核人 |
| `delegate_employee_id` | 代理人（不可等於本人；不可形成連鎖代理） |
| `starts_at`、`ends_at` | 期間（Asia/Taipei 日期） |
| `scope` | `all` 或指定的表單定義清單 |
| `reason`、`created_by` | 設定者可以是本人或管理員 |

代理的生效方式：

- **產生步驟時**：解析出的簽核人若在代理期間，步驟的 `approver_employee_id` 直接指定為代理人，並記錄 `delegated_from_employee_id`。
- **既有待簽步驟**：代理設定生效時，不自動改派已產生的步驟（避免無聲轉移責任）；代理頁提供「把目前 N 筆待簽一併轉給代理人」的明確按鈕，寫入 audit。
- 時間軸顯示「王主管（由 李代理 代簽）」。

**employees（擴充）**

- `phone`、`extension`：詳情頁的申請人卡片要顯示（舊系統有）。可由 GWS `phones` 帶入。
- `job_title` 沿用現有 `title`。

### 2.3 GWS 介接

依架構計畫第 4.3 節實作，重點：

1. **連線設定頁**（`/admin/org/directory`）：顯示同步模式（manual／directory）、最後成功同步時間、授權狀態；授權流程走專用 OAuth client 與唯讀 scope `admin.directory.user.readonly`（需要 OU 時才加 `orgunit.readonly`）。refresh token 存在受限密鑰檔，不進一般資料表。
2. **同步工作**：分頁讀取 users，寫入 `directory_users` 快照與 `directory_sync_runs`；全部頁成功才算本輪完成。可手動觸發，也可由排程（systemd timer）執行。
3. **差異審核畫面**：同步不直接改員工，而是列出：
   - 新人（GWS 有、ACCSYS 沒有）→ 管理員勾選「建立員工」，同時指定部門、職務。
   - 異動（姓名、信箱、電話、GWS 部門／職稱改變）→ 逐項或批次套用。
   - 停權／刪除（GWS suspended/deleted）→ 依架構計畫停用存取並撤銷 session；待簽工作列入交接清單。
4. **欄位對應**：

| GWS | ACCSYS | 權威來源 |
|---|---|---|
| `id` | `directory_users.directory_user_id` | GWS |
| `primaryEmail` | `employees.google_email` | GWS |
| `name.fullName` | `employees.name` | GWS |
| `phones[]` | `employees.phone`／`extension` | GWS |
| `externalIds[type=organization]` | `employees.employee_code`（建議值） | ACCSYS |
| `organizations[].department` | 部門（**建議值**，需管理員確認） | ACCSYS |
| `organizations[].title` | `employees.title`（建議值） | ACCSYS |
| `relations[type=manager]` | 部門主管（**建議值**） | ACCSYS |
| `suspended`／`archived`／刪除 | 存取停用 | GWS |

  GWS 的部門、職稱、主管只作為建議值，因為簽核權限必須由 ACCSYS 管理（架構計畫已明訂不自動以 OU 授權）。

5. **尚未取得 GWS 管理員授權前**：管理介面提供手動新增／編輯員工，與 Excel 匯入（沿用 `parseSeedWorkbook` 的欄位格式，搬到網頁上傳＋預覽差異）。兩種方式都產生同一份差異審核畫面，日後切換到 GWS 不需重做。

### 2.4 組織管理介面（`/admin/org`）

- **組織樹**：左側部門樹（可拖拉調整上層部門與排序），點選部門顯示主管、成員、該部門範圍的職務綁定。
- **員工**：列表＋篩選（部門、職務、未綁定、停用）；編輯部門、職稱、電話、系統角色、職務類別。
- **職務類別**：CRUD；每個職務顯示目前綁定的人與被哪些表單流程使用（刪除前檢查）。
- **代理人**：期間列表、新增／結束代理、轉移既有待簽。
- **簽核模擬器**：選一位員工＋一張表單＋輸入金額等條件，顯示會產生的簽核鏈。這是驗證組織設定是否正確最直接的工具。

所有變更寫入 `audit_events`。

---

## 3. 表單定義資料模型

### 3.1 資料表

**form_categories（新）— 入口分類**

| 欄位 | 說明 |
|---|---|
| `key` | `procurement`、`expense`、`seal`、`asset`，管理員可新增 |
| `title`、`description`、`sort_order`、`active` | |

初始資料取自 `src/lib/forms/catalog.ts` 的 `FORM_CATEGORIES`。之後上方選單、`/forms`、工作台卡片都改讀這張表加上已發佈的表單。

**form_definitions（新）— 表單**

| 欄位 | 說明 |
|---|---|
| `key` | 網址用代號，如 `general-seal`，唯一且發佈後不可改 |
| `name`、`description`、`icon` | |
| `category_id`、`sort_order` | 入口位置 |
| `visibility` | `all`，或限定部門／職務（JSON 清單） |
| `number_format` | 表單編號規則，見 3.3 |
| `status` | `draft`／`published`／`archived` |
| `published_version_id` | 目前生效版本 |
| `legacy_form_type` | 遷移自既有表單時記錄原 form type，供過渡期對照 |

**form_definition_versions（新）— 不可變版本**

| 欄位 | 說明 |
|---|---|
| `definition_id`、`version`（遞增） | |
| `schema` jsonb | 欄位與版面（3.2） |
| `flow` jsonb | 簽核流程（第 5 節） |
| `actions` jsonb | 核准後動作（第 7.3 節） |
| `published_at`、`published_by` | 發佈後此列不可修改 |

設計中的草稿存在 `form_definitions.draft_schema`／`draft_flow`（jsonb），發佈時複製成新版本。

**form_submissions（新）— 單據**

| 欄位 | 說明 |
|---|---|
| `definition_id`、`version_id` | 綁定送出時的版本 |
| `case_id` | `procurement_cases`（沿用案號） |
| `form_number` | 依定義規則產生的表單編號 |
| `applicant_employee_id`、`department_id` | 申請人與申請部門（送出時快照） |
| `status` | `pending_approval`／`approved`／`returned`／`withdrawn` |
| `data` jsonb | 欄位值 |
| `total_amount` numeric(14,2) | 提升欄位：標記為「單據金額」的欄位 |
| `budget_code_id`、`project_id` | 提升欄位：標記為「主要預算／專案」的欄位 |
| `version` | 樂觀鎖，沿用 `assertVersion` |
| `submitted_at`、`completed_at`、`created_at` | |

**為什麼用 JSON 加上「提升欄位」**：每張表單產生實體資料表會讓 migration 跟著管理員的操作跑，不可控。JSON 存欄位值，彈性夠；但財會追蹤、金額門檻、預算查詢需要能索引與加總，所以元件上可標記語意（「這是單據金額」「這是主要預算編號」），送出時寫進有型別的欄位與索引。

### 3.2 欄位定義格式（schema）

```ts
type FormSchema = {
  sections: Array<{
    id: string;
    title?: string;
    description?: string;
    fields: FieldDef[];
  }>;
};

type FieldDef = {
  id: string;            // 版本內唯一，資料以 id 為 key
  type: FieldType;       // 見第 4 節
  label: string;
  help?: string;
  required?: boolean;
  width?: 1 | 2 | 3 | 4; // 4 欄格線中佔幾欄
  visibleWhen?: Condition; // 條件顯示（與流程條件共用同一種條件格式）
  semantic?: 'amount' | 'budget_code' | 'project' | 'department';
  props: Record<string, unknown>; // 依元件類型而定
};
```

欄位一旦在已發佈版本中出現，之後的版本不能拿同一個 `id` 換成不同類型（設計器會阻擋），讓跨版本的列表與報表欄位能穩定對應。

### 3.3 表單編號

`number_format` 範例：`{prefix: 'SA', pattern: '{yyyy}{MM}{dd}{prefix}{seq:4}'}` → `20260909SA0002`（對應舊系統 `20260909A010002` 這種格式）。序號由新的 `form_number_counters(definition_id, period)` 在交易中遞增。案號（`procurement_cases.case_number`，`next_case_number()`）照舊產生，作為跨表單追蹤用；畫面上以表單編號為主。

---

## 4. 元件清單

由現有 13 張表單與舊系統截圖歸納。每個元件有：設計器屬性、填寫元件、詳情顯示、伺服器驗證四部分。

### 4.1 基本輸入

| 元件 | 主要屬性 | 來源例子 |
|---|---|---|
| 單行文字 | 字數上限、格式（一般／Email／電話／統編） | 文件說明、廠商統編 |
| 多行文字 | 字數上限、列數 | 出借印鑑說明、備註 |
| 數字 | 最小／最大、小數位 | 數量、天數 |
| 金額 | 幣別（預設 TWD）、上限、是否顯示國字大寫 | 費用、發票金額 |
| 日期 | 最早／最晚（可相對今日，如「不得早於今天」） | 期望用印完成日 |
| 日期區間 | 是否含時間、自動計算天數 | 出差期間 |
| 下拉選單 | 選項（自填或引用共用選項清單）、預設值 | 文件類別 |
| 單選 | 同上，橫排／直排 | 文件用印時效性 |
| 複選 | 同上，最少／最多選幾項 | 印鑑名稱 |
| 是／否 | 開關文字 | 出借印鑑 |

### 4.2 系統帶入（唯讀，送出時由伺服器寫入）

| 元件 | 說明 |
|---|---|
| 申請人卡片 | 姓名、信箱、電話（如截圖左上角） |
| 表單編號 | 送出後產生 |
| 申請時間 | 送出時間 |
| 申請部門 | 預設申請人部門，可設定為「允許改選」 |
| 申請日期 | 預設今天 |

### 4.3 組織與主檔

| 元件 | 說明 | 可作為簽核來源 |
|---|---|---|
| 員工選擇 | 單選／複選，可限定部門 | 是（「表單欄位選的人」） |
| 部門選擇 | 可限定層級 | 是（「該部門主管」） |
| 預算編號選擇 | 依部門／專案篩選，可標記為主要預算 | 是（預算負責人） |
| 專案選擇 | 產品／營收專案 | 是（專案負責人） |
| 供應商選擇 | | |
| 資產選擇 | 從財產保管清冊挑選，帶出名稱、保管人 | 是（目前保管人） |

### 4.4 組合與計算

| 元件 | 說明 |
|---|---|
| 明細表 | 管理員定義欄位（文字、數字、金額、日期、下拉、預算編號），可設定列數上下限；欄位可設計算式（`數量 × 單價`）；可設定合計列，合計可標記為單據金額 |
| 計算欄位 | 以其他欄位計算（加總、乘積、日期差），唯讀，伺服器重算 |
| 關聯單據 | 選擇自己的另一張已核准單據（例：費用申請單引用請購單），用於遷移採購流程 |

### 4.5 附件與說明

| 元件 | 說明 |
|---|---|
| 附件上傳 | 提示文字、必填、檔案類型、數量上限；詳情頁提供「全部下載」 |
| 說明區塊 | 粗體、清單、連結（例：用印須知、範本下載連結） |
| 區段標題／分隔線 | 版面分組 |

### 4.6 共用選項清單（option sets）

印鑑名稱、文件類別、用印時效性（一般件 2~3 天／急件）等選項會被多張表單共用，而且會變動。另設 `/admin/option-sets` 管理：清單名稱、選項（值、顯示文字、排序、停用）。選項停用後，舊單據仍顯示原文字，新單據不可選。

---

## 5. 簽核流程設定

### 5.1 流程定義格式（flow）

```ts
type FlowDef = {
  steps: StepDef[];
  skipApplicant: boolean;          // 解析到申請人本人時自動通過（預設 true）
  collapseDuplicates: boolean;     // 與前一關同一人時自動通過（預設 true）
};

type StepDef = {
  id: string;
  label: string;                   // 顯示在時間軸，如「部門主管」「法務審閱」
  approver: ApproverSource;
  when?: Condition;                // 不符合則這一關不產生
  onUnresolved: 'block' | 'skip';  // 找不到簽核人時：阻擋送出／略過這一關
};

type ApproverSource =
  | { kind: 'employee'; employeeId: string }                       // 指定員工
  | { kind: 'job_role'; jobRoleId: string;
      scope: 'company' | 'applicant_department' | 'field_department'; fieldId?: string } // 職務類別
  | { kind: 'department_manager';
      of: 'applicant' | 'field'; fieldId?: string;
      levelsUp: number }                                           // 0=直屬部門主管，1=上一層…
  | { kind: 'field_employee'; fieldId: string }                    // 表單欄位選的人
  | { kind: 'budget_owner'; fieldId: string }                      // 預算編號的負責人
  | { kind: 'asset_custodian'; fieldId: string };                  // 資產的目前保管人

type Condition =
  | { all: Condition[] } | { any: Condition[] }
  | { field: string; op: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'contains' | 'filled';
      value?: unknown };
```

例：現有的「金額超過 10 萬才加董事長」就是一個 `job_role=chairman` 的關卡加上 `when: {field: 'amount', op: 'gt', value: 100000}`。截圖中「出借印鑑＝是 才多一關管理部」也是同樣的條件格式。

### 5.2 解析規則

送出（與重送）時，在同一個交易中：

1. 依順序評估每一關的 `when`，跳過不符合的。
2. 依 `approver` 解析出員工；檢查員工在職且 `access_enabled`。
3. 套用代理（第 2.2 節）。
4. 處理自動通過：
   - 解析到申請人本人且 `skipApplicant`，或與前一關同一人且 `collapseDuplicates`：仍然寫入步驟，但狀態為 `auto_approved`，時間軸顯示「由系統代簽」（對應舊系統截圖的呈現）。保留這一關，申請人才看得懂流程為什麼少一個人簽。
   - 找不到人：`onUnresolved='block'` 時送出失敗並說明哪一關缺人；`skip` 時寫入 `skipped` 步驟。
5. 第一個 `pending` 步驟的簽核人收到通知。

流程解析是純函式（輸入：flow、表單資料、申請人、組織快照；輸出：步驟清單），可完整單元測試，也直接提供給「簽核模擬器」與設計器的預覽使用。

### 5.3 approval_steps 擴充

| 變更 | 說明 |
|---|---|
| `form_type` 檢查加入 `custom` | 動態表單統一用 `custom`，`form_id` = `form_submissions.id` |
| `approver_role` 檢查改為允許任意代號 | 動態表單寫 `step:<stepId>`；既有值不變 |
| 新增 `step_label` | 送出當下的關卡名稱快照（流程之後改名不影響舊單） |
| 新增 `source_kind` | `employee`／`job_role`／`department_manager`… 時間軸顯示「職務類別 總經理」用 |
| 新增 `delegated_from_employee_id` | 代理 |
| `status` 加入 `auto_approved`、`skipped` | 系統代簽與略過 |

`decideCurrentStep` 等既有 helper 改為「找第一個 `pending` 步驟」時略過 `auto_approved`/`skipped`；既有表單不會產生這兩種狀態，行為不變。`attachments.form_type`、`notifications.form_type`、`procurement_cases.case_type` 同樣加入 `custom`。

### 5.4 流程編輯介面

設計器的「簽核流程」分頁：

- 由上而下的關卡卡片，可拖拉排序；每張卡片設定關卡名稱、簽核人來源（依類型出現對應選單：選員工、選職務＋範圍、選部門層級、選表單中的員工／部門／預算欄位）、條件（條件建構器：欄位＋運算子＋值，可加「且／或」群組）、找不到人時的處理。
- 右側即時預覽：選一位模擬申請人並填入條件欄位，顯示會產生的關卡與簽核人；與 `/admin/org` 的簽核模擬器使用同一個解析函式。
- 發佈前檢查：引用的欄位存在且類型正確、指定的員工在職、職務類別有綁定人。

---

## 6. 簽核追蹤

### 6.1 時間軸元件 `ApprovalTimeline`

對應截圖的「簽核流程：簽核完成」：

- 標題列：整體狀態（簽核中／簽核完成／已退回／已撤回）。
- 第一個節點是「申請人」：頭像、姓名、送出時間。
- 每一關一個節點：頭像（姓名首字）、上方為關卡來源（「申請人」「指定員工」「職務類別 總經理」）、姓名、狀態圖示（✓ 已核准、↺ 已退回、● 目前關卡、○ 尚未輪到、⚙ 由系統代簽、略過）、時間。
- 點節點顯示簽核意見。
- 寬度不夠時自動換成直式（手機）。
- 退回後重送：既有流程會重建步驟，舊回合的紀錄從 audit 讀取，以「第 N 次送出」分組收合顯示。

這個元件同時套用到既有 13 種表單的詳情頁，取代現在各頁自己的步驟清單，讓所有表單的追蹤體驗一致。

### 6.2 動態表單詳情頁

版面依截圖：

1. 表頭：左側申請人卡片；右側表單編號、申請時間、部門、申請日期，以及管理員在設計器標記為「顯示在表頭」的欄位（如文件用印時效性、期望用印完成日）。
2. 內容：依定義的區段與欄位排版（唯讀）。
3. 附件：清單＋全部下載。
4. 簽核時間軸。
5. 動作：核准／退回（目前簽核人）、修改／撤回（申請人，第一關前）、列印。

---

## 7. 執行期與既有系統整合

### 7.1 路由與權限

| 路由 | 說明 | 權限 |
|---|---|---|
| `/f/[key]` | 我的申請列表 | 已登入；只列自己的 |
| `/f/[key]/new` | 填寫 | 表單 `visibility` 允許 |
| `/f/[key]/[id]` | 詳情 | 沿用 `canReadForm`：申請人、該單簽核人、finance、admin |
| `/f/[key]/[id]/edit` | 修改／重送 | 申請人＋既有狀態規則 |
| `/admin/form-builder/**`、`/admin/org/**`、`/admin/option-sets` | 管理 | `admin` |

### 7.2 與既有模組整合

- **待簽核**：`/approvals` 與 `pending-count` 加入 `custom`，連結依 `form_submissions` → 定義 `key` 組成。
- **入口**：`catalog.ts` 由靜態陣列改為「靜態（未遷移的既有表單）＋資料庫（分類與已發佈表單）」合併；全部遷移完後只剩資料庫。上方選單、`/forms`、工作台卡片不需各自修改。
- **附件**：沿用 `attachments` 與掃描流程，`form_type='custom'`。
- **案件追蹤**：財會的 `/case-tracking` 透過 `total_amount`、`budget_code_id`、`department_id` 提升欄位納入動態表單。

### 7.3 核准後動作

部分表單在最終核准後要改其他資料（資產異動要更新財產保管清冊）。這類邏輯牽涉資料一致性，不開放管理員撰寫腳本，而是由程式註冊「動作」，管理員在設計器選用並對應欄位：

| 動作 | 欄位對應 |
|---|---|
| 更新財產保管清冊 | 資產選擇欄位、新保管人欄位、異動類型欄位 |
| 預算使用登記（遷移採購／費用時加入） | 預算編號欄位、金額欄位 |

動作在最終核准的同一個交易中執行，失敗則核准一併回滾。

---

## 8. 表單設計器介面

`/admin/form-builder`：表單列表（名稱、分類、狀態、目前版本、最後修改），新增表單或「從範本複製」。

`/admin/form-builder/[id]`：四個分頁。

1. **欄位設計**
   - 左：元件面板（依第 4 節分組，可搜尋），拖到中間畫布。
   - 中：畫布，4 欄格線；區段可新增、拖拉排序、收合；欄位可在區段內與區段間拖拉，選取後可複製／刪除。
   - 右：屬性面板（標籤、說明、必填、寬度、條件顯示、元件專屬屬性、語意標記）。
2. **簽核流程**：第 5.4 節。
3. **發佈設定**：表單代號、名稱、入口分類與排序、可見範圍、表單編號規則、核准後動作。
4. **預覽**：以一般使用者的填寫頁呈現（可切換桌機／手機寬度），可試填並執行伺服器驗證，但不會寫入資料。

發佈流程：儲存草稿 → 發佈前檢查（欄位、流程引用、編號規則、入口）→ 顯示與上一版的差異摘要（新增／移除欄位、流程變更）→ 確認發佈 → 產生新版本、寫入 audit。可「下架」（不再出現在入口，既有單據照常簽核），不可刪除已有單據的表單。

拖拉實作：建議引入 `@dnd-kit/core` 與 `@dnd-kit/sortable`（支援鍵盤操作與無障礙，維護活躍）。若要維持零新增依賴，可用原生 HTML5 Drag and Drop，但鍵盤操作、觸控與巢狀排序需要自行處理，成本較高。

---

## 9. 既有表單遷移

### 9.1 策略

- **新單走新系統，舊單留在原處**：某張表單切換後，新送出的單據寫進 `form_submissions`；切換前的舊單據留在原資料表，原詳情頁保留為唯讀（含簽核中的舊單繼續簽完）。不做大量舊資料轉換，避免金額、附件與簽核紀錄搬移的風險。
- **對等檢查清單**：每張表單切換前，逐項比對欄位、驗證規則、計算、簽核鏈（用同一組測試案例跑新舊兩套解析結果）、列印格式、財會追蹤，全部通過才把入口切到新版。
- **表單範本以程式碼建立**：遷移用的表單定義寫成 seed／migration（`legacy_form_type` 標記），確保測試環境與正式環境一致；管理員之後可再修改並發佈新版。

### 9.2 順序

| 批次 | 表單 | 需要的能力 |
|---|---|---|
| 1 | 用印申請：合約類、非合約類、開立發票 | 基本欄位、共用選項清單、附件、條件關卡 |
| 2 | 出差報告暨旅費報支單 | 日期區間、明細表、計算欄位 |
| 3 | 費用申請：部門版、產品專案版、營收專案版、單筆一萬元以下 | 預算／專案選擇、金額門檻條件、預算負責人關卡 |
| 4 | 資產異動申請單 | 資產選擇、保管人關卡、核准後動作 |
| 5 | 採購流程：請購、採購、驗收、費用（採購付款） | 關聯單據、一案多單的案號串接、案件追蹤 |

採購流程放最後，因為它有跨單據的串接與財會追蹤，風險最高；前四批跑順後再處理。

---

## 10. 分階段實作

每階段都需要：migration（開發與測試 DB 都套用）、單元測試、整合測試、型別檢查、lint、瀏覽器冒煙測試。

| 階段 | 內容 | 驗收重點 |
|---|---|---|
| **A. 組織架構** | 部門階層、職務類別、員工職務綁定、代理人、員工電話；`/admin/org` 介面；手動／Excel 匯入＋差異審核；簽核模擬器（先支援既有簽核鏈） | 循環上層部門被拒絕；總經理／董事長旗標與職務綁定一致；代理期間判斷；匯入重跑不重複 |
| **B. GWS 同步** | `directory_users`、`directory_sync_runs`、授權設定、同步工作、差異審核串接 | 以 fixture 測多頁、第二頁失敗、筆數劇降、停權；真實租戶需 GWS 管理員配合，未配合前標示受阻、不影響其他階段 |
| **C. 簽核引擎泛化** | approval_steps 擴充、流程解析器、`ApprovalTimeline` 套用到既有表單 | 既有 13 種表單整合測試全部照舊通過；解析器涵蓋每種簽核人來源、條件、代理、代簽、缺人 |
| **D. 表單執行期** | 定義／版本／單據資料表、驗證器、渲染器、`/f/[key]` 路由、待簽與入口整合；先以程式寫的定義跑通 | 送出、核准、退回、修改、撤回、重送的完整流程；伺服器拒絕竄改的計算值；版本鎖定 |
| **E. 設計器介面** | 拖拉畫布、屬性面板、流程編輯、預覽、發佈與版本差異、共用選項清單 | 非 admin 無法進入；發佈前檢查擋下無效設定；發佈新版不影響舊單 |
| **F. 遷移** | 依第 9.2 節順序逐批 | 每批對等檢查清單通過後才切換入口 |

A 與 C 可並行；D 依賴 C；E 依賴 D；F 依賴 E（核准後動作與關聯單據在 F 的對應批次補上）。

---

## 11. 待確認事項

1. **職務類別初始清單**：除了總經理、董事長之外，目前已知需要哪些？（例如法務窗口、管理部窗口、財務窗口、IT 窗口）
2. **部門層級**：公司的部門大約幾層？「部門主管」關卡是否常需要「往上找一層」（例如課長之後是處長）？
3. **代理人設定者**：員工是否可以自己設定代理人，還是只有管理員可以？
4. **GWS**：是否已有可配合的 GWS 管理員與 customer ID？目前 GWS 裡是否有填員工編號（externalIds）、部門、職稱、主管？這決定差異審核能自動帶入多少建議值。
5. **表單編號**：是否每張表單都要像舊系統一樣有自己的編號規則（`20260909A010002`），還是沿用目前全系統共用的案號即可？
6. **拖拉套件**：是否同意新增 `@dnd-kit`（建議），或要求不新增依賴？
