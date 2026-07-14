# 財會簽核追蹤頁 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓 `role = 'finance'` 的財會人員在 `/case-tracking` 頁面追蹤全公司所有案件（不限自己承辦）的簽核狀態，依「簽核中／已完成」頁籤分類，並可依部門/日期區間/關鍵字篩選。

**Architecture:** 新增 `src/lib/case-tracking/` 查詢模組（批次查詢四張表單，避免 N+1），一個純函式判定案件屬於哪個頁籤，一個 Server Component 頁面把查詢結果渲染成頁籤 + GET 篩選表單 + 表格。過程中一併整理 `src/lib/cases/queries.ts` 裡與 `form-registry.ts` 重複的表單定義。

**Tech Stack:** Next.js 15 App Router（Server Component）、Supabase（Postgres + RLS，`is_finance()` 已授權讀取）、TypeScript strict、Vitest（`tests/**/*.test.ts` 為整合測試、`src/**/*.test.ts` 為單元測試）。

## Global Constraints

- 不新增資料庫 migration——RLS 已透過 `is_finance()` 授權 `finance`/`admin` 角色讀取四張表單、其明細、附件（見 `supabase/migrations/20260711165611_new_forms_rls.sql`、`20260711034757_procurement_rls.sql`）
- 頁面權限比照 `/budget-codes` 既有慣例：`getCurrentEmployee` 查無 → `redirect('/login')`；`employee.role !== 'finance'` → `redirect('/dashboard')`
- Supabase embedded relationship 查詢因專案未產生 `Database` 型別，strict tsc 下需要 `as unknown as {...}` 兩段式轉型
- 整合測試（`tests/integration/*.test.ts`）執行前必須先 `export $(grep -v '^#' .env.local | xargs)`，否則會被 `describe.skipIf(!hasIntegrationTestCredentials())` 跳過（不是有效的 RED）
- `npm test` 已內建 `NODE_OPTIONS=--experimental-websocket`，手動跑單一測試檔也要帶這個 flag
- 測試 fixture 若同時建立部門與其主管員工，`afterAll` 必須先把 `departments.manager_employee_id` 設為 `null` 再刪員工、最後刪部門（循環外鍵）——本計畫的 fixture 刻意不設定 `manager_employee_id`，不觸發這個限制，但若後續擴充時加了主管欄位要記得處理
- 執行本計畫前應先用 `superpowers:using-git-worktrees` 建立獨立 worktree（沿用專案慣例），新 worktree 需要自己的 `.claude/launch.json` 才能被瀏覽器預覽工具正確辨識

---

### Task 1: 整理 `src/lib/cases/queries.ts` 重複的表單定義（技術債，行為不變的重構）

**Files:**
- Modify: `src/lib/cases/queries.ts`
- Test（既有，不新增）: `tests/integration/case-overview-queries.test.ts`

**Interfaces:**
- Consumes：`src/lib/procurement/form-registry.ts` 既有匯出的 `FORM_TYPES: readonly FormType[]`、`FORM_TABLE: Record<FormType, string>`、`FORM_LABELS: Record<FormType, string>`、`type FormType`
- Produces：`getCaseOverview(caseNumber: string): Promise<CaseOverview | null>` 簽章與回傳形狀不變（`CaseOverview`、`CaseFormStatus` 型別內容不變），供 Task 3、Task 4 確認「案件總覽頁」行為沒有回歸

這是一個**純重構**：把檔案內手寫的 `FORM_DEFS`（重複定義了 `form-registry.ts` 已有的 label/table 對照）改成直接複用 `form-registry.ts`，行為完全不變。用既有的整合測試驗證沒有回歸，不需要新增測試。

- [ ] **Step 1: 執行既有測試，確認重構前的基準是綠的**

Run: `export $(grep -v '^#' .env.local | xargs) && NODE_OPTIONS=--experimental-websocket npx vitest run tests/integration/case-overview-queries.test.ts`
Expected: PASS（4 個測試全過）

- [ ] **Step 2: 重構 `src/lib/cases/queries.ts`**

把整個檔案內容改成：

```typescript
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { FORM_TYPES, FORM_TABLE, FORM_LABELS, type FormType } from '@/lib/procurement/form-registry';

export type CaseFormStatus = {
  formType: FormType;
  label: string;
  itemCode: string;
  exists: boolean;
  id: string | null;
  status: string | null;
  hasAttachments: boolean;
};

export type CaseOverview = {
  caseNumber: string;
  forms: CaseFormStatus[];
};

const FORM_ITEM_CODES: Record<FormType, string> = {
  purchase_request: 'A1',
  purchase_order: 'B1',
  acceptance: 'C1',
  expense_request: 'D1',
};

export async function getCaseOverview(caseNumber: string): Promise<CaseOverview | null> {
  const supabase = await createSupabaseServerClient();
  const { data: pcase } = await supabase
    .from('procurement_cases')
    .select('id, case_number')
    .eq('case_number', caseNumber)
    .maybeSingle();
  if (!pcase) return null;

  const forms: CaseFormStatus[] = [];
  for (const formType of FORM_TYPES) {
    const { data } = await supabase
      .from(FORM_TABLE[formType])
      .select('id, status')
      .eq('procurement_case_id', pcase.id)
      .maybeSingle();
    let hasAttachments = false;
    if (data) {
      const { count } = await supabase
        .from('attachments')
        .select('id', { count: 'exact', head: true })
        .eq('form_type', formType)
        .eq('form_id', data.id);
      hasAttachments = (count ?? 0) > 0;
    }
    forms.push({
      formType,
      label: FORM_LABELS[formType],
      itemCode: FORM_ITEM_CODES[formType],
      exists: !!data,
      id: data?.id ?? null,
      status: data?.status ?? null,
      hasAttachments,
    });
  }
  return { caseNumber: pcase.case_number, forms };
}
```

- [ ] **Step 3: 重新執行既有測試，確認重構後行為不變**

Run: `export $(grep -v '^#' .env.local | xargs) && NODE_OPTIONS=--experimental-websocket npx vitest run tests/integration/case-overview-queries.test.ts`
Expected: PASS（同樣 4 個測試全過，內容不變）

- [ ] **Step 4: Commit**

```bash
git add src/lib/cases/queries.ts
git commit -m "refactor: reuse form-registry constants in cases/queries instead of duplicating FORM_DEFS"
```

---

### Task 2: 案件頁籤判定純函式 `determineCaseBucket`

**Files:**
- Create: `src/lib/case-tracking/determine-bucket.ts`
- Test: `src/lib/case-tracking/determine-bucket.test.ts`

**Interfaces:**
- Consumes：`FormType` from `src/lib/procurement/form-registry.ts`
- Produces：
  - `type CaseFormState = { formType: FormType; exists: boolean; status: string | null }`
  - `type CaseBucket = 'in_progress' | 'completed'`
  - `determineCaseBucket(forms: CaseFormState[]): CaseBucket`

  Task 3 的 `getFinanceCaseTracking` 會 import 這三者來組出每個案件的 `bucket` 欄位。

- [ ] **Step 1: 寫失敗測試**

建立 `src/lib/case-tracking/determine-bucket.test.ts`：

```typescript
import { describe, expect, it } from 'vitest';
import type { FormType } from '@/lib/procurement/form-registry';
import { determineCaseBucket, type CaseFormState } from './determine-bucket';

function approved(formType: FormType): CaseFormState {
  return { formType, exists: true, status: 'approved' };
}
function withStatus(formType: FormType, status: string): CaseFormState {
  return { formType, exists: true, status };
}
function notExists(formType: FormType): CaseFormState {
  return { formType, exists: false, status: null };
}

describe('determineCaseBucket', () => {
  it('returns completed when all four forms exist and are approved', () => {
    const forms: CaseFormState[] = [
      approved('purchase_request'),
      approved('purchase_order'),
      approved('acceptance'),
      approved('expense_request'),
    ];
    expect(determineCaseBucket(forms)).toBe('completed');
  });

  it('returns in_progress when one form is still pending_approval', () => {
    const forms: CaseFormState[] = [
      approved('purchase_request'),
      withStatus('purchase_order', 'pending_approval'),
      notExists('acceptance'),
      notExists('expense_request'),
    ];
    expect(determineCaseBucket(forms)).toBe('in_progress');
  });

  it('returns in_progress when a form was returned and nothing is pending_approval', () => {
    const forms: CaseFormState[] = [
      withStatus('purchase_request', 'returned'),
      notExists('purchase_order'),
      notExists('acceptance'),
      notExists('expense_request'),
    ];
    expect(determineCaseBucket(forms)).toBe('in_progress');
  });

  it('returns in_progress when later-stage forms have not been created yet, even if earlier ones are approved', () => {
    const forms: CaseFormState[] = [
      approved('purchase_request'),
      approved('purchase_order'),
      notExists('acceptance'),
      notExists('expense_request'),
    ];
    expect(determineCaseBucket(forms)).toBe('in_progress');
  });
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `NODE_OPTIONS=--experimental-websocket npx vitest run src/lib/case-tracking/determine-bucket.test.ts`
Expected: FAIL，錯誤訊息類似 `Cannot find module './determine-bucket'`

- [ ] **Step 3: 實作 `determineCaseBucket`**

建立 `src/lib/case-tracking/determine-bucket.ts`：

```typescript
import type { FormType } from '@/lib/procurement/form-registry';

export type CaseFormState = {
  formType: FormType;
  exists: boolean;
  status: string | null;
};

export type CaseBucket = 'in_progress' | 'completed';

export function determineCaseBucket(forms: CaseFormState[]): CaseBucket {
  const allApproved = forms.every((form) => form.exists && form.status === 'approved');
  return allApproved ? 'completed' : 'in_progress';
}
```

- [ ] **Step 4: 執行測試確認通過**

Run: `NODE_OPTIONS=--experimental-websocket npx vitest run src/lib/case-tracking/determine-bucket.test.ts`
Expected: PASS（4 個測試全過）

- [ ] **Step 5: Commit**

```bash
git add src/lib/case-tracking/determine-bucket.ts src/lib/case-tracking/determine-bucket.test.ts
git commit -m "feat: add determineCaseBucket for finance case tracking"
```

---

### Task 3: `getFinanceCaseTracking` 批次查詢與部門選項查詢

**Files:**
- Create: `src/lib/case-tracking/queries.ts`
- Test: `tests/integration/case-tracking-queries.test.ts`

**Interfaces:**
- Consumes：
  - `createSupabaseServerClient()` from `src/lib/supabase/server.ts`
  - `FORM_TYPES`, `FORM_TABLE`, `type FormType` from `src/lib/procurement/form-registry.ts`
  - `determineCaseBucket`, `type CaseBucket`, `type CaseFormState` from `./determine-bucket`（Task 2 產出）
- Produces（Task 4 的頁面會 import 這些）：
  - `type CaseTrackingFilters = { departmentCode?: string; dateFrom?: string; dateTo?: string; keyword?: string }`
  - `type CaseTrackingRow = { caseNumber: string; department: { code: string; name: string } | null; applicant: string | null; forms: CaseFormState[]; bucket: CaseBucket }`
  - `type DepartmentOption = { code: string; name: string }`
  - `getFinanceCaseTracking(filters: CaseTrackingFilters): Promise<CaseTrackingRow[]>`
  - `getDepartmentFilterOptions(): Promise<DepartmentOption[]>`

- [ ] **Step 1: 寫失敗的整合測試**

建立 `tests/integration/case-tracking-queries.test.ts`：

```typescript
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  createServiceRoleTestClient,
  hasIntegrationTestCredentials,
} from './supabase-test-client';

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => {
    const { createServiceRoleTestClient } = await import('./supabase-test-client');
    return createServiceRoleTestClient();
  },
}));

describe.skipIf(!hasIntegrationTestCredentials())('getFinanceCaseTracking', () => {
  let admin: ReturnType<typeof createServiceRoleTestClient>;

  let employeeAId: string;
  let employeeAName: string;
  let departmentAId: string;
  let departmentACode: string;
  let supplierId: string;

  let departmentBId: string;
  let departmentBCode: string;
  let employeeBId: string;

  let caseCompletedId: string;
  let caseCompletedNumber: string;
  let caseInProgressId: string;
  let caseInProgressNumber: string;
  let caseReturnedOnlyId: string;
  let caseReturnedOnlyNumber: string;

  beforeAll(async () => {
    admin = createServiceRoleTestClient();

    const { data: emp } = await admin
      .from('employees')
      .select('id, name, department_id, departments(code)')
      .not('department_id', 'is', null)
      .limit(1)
      .single();
    employeeAId = emp!.id;
    employeeAName = emp!.name;
    departmentAId = emp!.department_id;
    departmentACode = (emp!.departments as unknown as { code: string }).code;

    const { data: sup } = await admin.from('suppliers').select('id').limit(1).single();
    supplierId = sup!.id;

    departmentBCode = `CTQ-B-${Date.now()}`;
    const { data: deptB } = await admin
      .from('departments')
      .insert({ code: departmentBCode, name: '簽核追蹤測試部門B' })
      .select()
      .single();
    departmentBId = deptB!.id;

    const { data: empB } = await admin
      .from('employees')
      .insert({
        employee_code: `CTQ-EMP-B-${Date.now()}`,
        name: '簽核追蹤測試員工B',
        department_id: departmentBId,
      })
      .select()
      .single();
    employeeBId = empB!.id;

    // Case 1：四張表單全部存在且皆 approved -> completed
    const { data: cn1 } = await admin.rpc('next_case_number');
    const { data: case1 } = await admin
      .from('procurement_cases')
      .insert({ case_number: cn1!, created_by_employee_id: employeeAId })
      .select()
      .single();
    caseCompletedId = case1!.id;
    caseCompletedNumber = case1!.case_number;

    const { data: pr1 } = await admin
      .from('purchase_requests')
      .insert({
        procurement_case_id: caseCompletedId,
        applicant_employee_id: employeeAId,
        department_id: departmentAId,
        budget_owner_employee_id: employeeAId,
        status: 'approved',
      })
      .select()
      .single();

    const { data: po1 } = await admin
      .from('purchase_orders')
      .insert({
        procurement_case_id: caseCompletedId,
        purchase_request_id: pr1!.id,
        applicant_employee_id: employeeAId,
        department_id: departmentAId,
        budget_owner_employee_id: employeeAId,
        supplier_id: supplierId,
        payment_method: '匯款',
        payment_terms: '預付款',
        status: 'approved',
      })
      .select()
      .single();

    const { data: acc1 } = await admin
      .from('acceptances')
      .insert({
        procurement_case_id: caseCompletedId,
        purchase_order_id: po1!.id,
        applicant_employee_id: employeeAId,
        department_id: departmentAId,
        budget_owner_employee_id: employeeAId,
        contractor_supplier_id: supplierId,
        status: 'approved',
      })
      .select()
      .single();

    await admin.from('expense_requests').insert({
      procurement_case_id: caseCompletedId,
      purchase_order_id: po1!.id,
      acceptance_id: acc1!.id,
      applicant_employee_id: employeeAId,
      department_id: departmentAId,
      budget_owner_employee_id: employeeAId,
      payee_type: 'employee',
      payment_method: '匯款',
      status: 'approved',
    });

    // Case 2：請購已核准、採購還在 pending_approval -> in_progress，部門 B
    const { data: cn2 } = await admin.rpc('next_case_number');
    const { data: case2 } = await admin
      .from('procurement_cases')
      .insert({ case_number: cn2!, created_by_employee_id: employeeBId })
      .select()
      .single();
    caseInProgressId = case2!.id;
    caseInProgressNumber = case2!.case_number;

    const { data: pr2 } = await admin
      .from('purchase_requests')
      .insert({
        procurement_case_id: caseInProgressId,
        applicant_employee_id: employeeBId,
        department_id: departmentBId,
        budget_owner_employee_id: employeeBId,
        status: 'approved',
      })
      .select()
      .single();

    await admin.from('purchase_orders').insert({
      procurement_case_id: caseInProgressId,
      purchase_request_id: pr2!.id,
      applicant_employee_id: employeeBId,
      department_id: departmentBId,
      budget_owner_employee_id: employeeBId,
      supplier_id: supplierId,
      payment_method: '匯款',
      payment_terms: '預付款',
      status: 'pending_approval',
    });

    // Case 3：只有請購單，且被退回，沒有任何表單 pending_approval -> in_progress
    const { data: cn3 } = await admin.rpc('next_case_number');
    const { data: case3 } = await admin
      .from('procurement_cases')
      .insert({ case_number: cn3!, created_by_employee_id: employeeAId })
      .select()
      .single();
    caseReturnedOnlyId = case3!.id;
    caseReturnedOnlyNumber = case3!.case_number;

    await admin.from('purchase_requests').insert({
      procurement_case_id: caseReturnedOnlyId,
      applicant_employee_id: employeeAId,
      department_id: departmentAId,
      budget_owner_employee_id: employeeAId,
      status: 'returned',
    });
  });

  afterAll(async () => {
    await admin.from('expense_requests').delete().eq('procurement_case_id', caseCompletedId);
    await admin.from('acceptances').delete().eq('procurement_case_id', caseCompletedId);
    await admin
      .from('purchase_orders')
      .delete()
      .in('procurement_case_id', [caseCompletedId, caseInProgressId]);
    await admin
      .from('purchase_requests')
      .delete()
      .in('procurement_case_id', [caseCompletedId, caseInProgressId, caseReturnedOnlyId]);
    await admin
      .from('procurement_cases')
      .delete()
      .in('id', [caseCompletedId, caseInProgressId, caseReturnedOnlyId]);
    await admin.from('employees').delete().eq('id', employeeBId);
    await admin.from('departments').delete().eq('id', departmentBId);
  });

  it('buckets a case with all four forms approved as completed', async () => {
    const { getFinanceCaseTracking } = await import('@/lib/case-tracking/queries');
    const rows = await getFinanceCaseTracking({});
    const row = rows.find((r) => r.caseNumber === caseCompletedNumber);
    expect(row?.bucket).toBe('completed');
  });

  it('buckets a case with a pending_approval form as in_progress', async () => {
    const { getFinanceCaseTracking } = await import('@/lib/case-tracking/queries');
    const rows = await getFinanceCaseTracking({});
    const row = rows.find((r) => r.caseNumber === caseInProgressNumber);
    expect(row?.bucket).toBe('in_progress');
  });

  it('buckets a case with only a returned form (no pending_approval) as in_progress', async () => {
    const { getFinanceCaseTracking } = await import('@/lib/case-tracking/queries');
    const rows = await getFinanceCaseTracking({});
    const row = rows.find((r) => r.caseNumber === caseReturnedOnlyNumber);
    expect(row?.bucket).toBe('in_progress');
  });

  it('filters by department code to only that department’s cases', async () => {
    const { getFinanceCaseTracking } = await import('@/lib/case-tracking/queries');
    const rows = await getFinanceCaseTracking({ departmentCode: departmentBCode });
    expect(rows.some((r) => r.caseNumber === caseInProgressNumber)).toBe(true);
    expect(rows.some((r) => r.caseNumber === caseCompletedNumber)).toBe(false);
    expect(rows.some((r) => r.caseNumber === caseReturnedOnlyNumber)).toBe(false);
  });

  it('filters by keyword matching the case number', async () => {
    const { getFinanceCaseTracking } = await import('@/lib/case-tracking/queries');
    const rows = await getFinanceCaseTracking({ keyword: caseCompletedNumber });
    expect(rows).toHaveLength(1);
    expect(rows[0].caseNumber).toBe(caseCompletedNumber);
  });

  it('filters by keyword matching the applicant name', async () => {
    const { getFinanceCaseTracking } = await import('@/lib/case-tracking/queries');
    const rows = await getFinanceCaseTracking({ keyword: employeeAName });
    expect(rows.some((r) => r.caseNumber === caseCompletedNumber)).toBe(true);
    expect(rows.some((r) => r.caseNumber === caseInProgressNumber)).toBe(false);
  });

  it('excludes fixture cases when dateFrom is in the future', async () => {
    const { getFinanceCaseTracking } = await import('@/lib/case-tracking/queries');
    const rows = await getFinanceCaseTracking({ dateFrom: '9999-01-01' });
    const fixtureNumbers = [caseCompletedNumber, caseInProgressNumber, caseReturnedOnlyNumber];
    expect(rows.some((r) => fixtureNumbers.includes(r.caseNumber))).toBe(false);
  });

  it('ignores the date range filter entirely when dateFrom is after dateTo', async () => {
    const { getFinanceCaseTracking } = await import('@/lib/case-tracking/queries');
    const rows = await getFinanceCaseTracking({ dateFrom: '2030-01-01', dateTo: '2020-01-01' });
    expect(rows.some((r) => r.caseNumber === caseCompletedNumber)).toBe(true);
  });

  it('reports the department name and code for a case', async () => {
    const { getFinanceCaseTracking } = await import('@/lib/case-tracking/queries');
    const rows = await getFinanceCaseTracking({});
    const row = rows.find((r) => r.caseNumber === caseInProgressNumber);
    expect(row?.department).toEqual({ code: departmentBCode, name: '簽核追蹤測試部門B' });
  });

  it('getDepartmentFilterOptions includes the fixture departments', async () => {
    const { getDepartmentFilterOptions } = await import('@/lib/case-tracking/queries');
    const options = await getDepartmentFilterOptions();
    expect(options.some((d) => d.code === departmentACode)).toBe(true);
    expect(options.some((d) => d.code === departmentBCode)).toBe(true);
  });
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `export $(grep -v '^#' .env.local | xargs) && NODE_OPTIONS=--experimental-websocket npx vitest run tests/integration/case-tracking-queries.test.ts`
Expected: FAIL，錯誤訊息類似 `Cannot find module '@/lib/case-tracking/queries'`

- [ ] **Step 3: 實作 `src/lib/case-tracking/queries.ts`**

```typescript
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { FORM_TYPES, FORM_TABLE, type FormType } from '@/lib/procurement/form-registry';
import { determineCaseBucket, type CaseBucket, type CaseFormState } from './determine-bucket';

export type CaseTrackingFilters = {
  departmentCode?: string;
  dateFrom?: string;
  dateTo?: string;
  keyword?: string;
};

export type CaseTrackingRow = {
  caseNumber: string;
  department: { code: string; name: string } | null;
  applicant: string | null;
  forms: CaseFormState[];
  bucket: CaseBucket;
};

export type DepartmentOption = { code: string; name: string };

type FormQueryRow = {
  id: string;
  procurement_case_id: string;
  status: string;
  departments: { code: string; name: string } | null;
  applicant: { name: string } | null;
};

function isValidDate(value: string | undefined): value is string {
  return !!value && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export async function getFinanceCaseTracking(
  filters: CaseTrackingFilters
): Promise<CaseTrackingRow[]> {
  const supabase = await createSupabaseServerClient();

  const validFrom = isValidDate(filters.dateFrom) ? filters.dateFrom : undefined;
  const validTo = isValidDate(filters.dateTo) ? filters.dateTo : undefined;
  const dateRangeIsValid = !(validFrom && validTo && validFrom > validTo);

  let caseQuery = supabase
    .from('procurement_cases')
    .select('id, case_number')
    .order('created_at', { ascending: false });
  if (dateRangeIsValid && validFrom) {
    caseQuery = caseQuery.gte('created_at', validFrom);
  }
  if (dateRangeIsValid && validTo) {
    caseQuery = caseQuery.lte('created_at', `${validTo}T23:59:59`);
  }

  const { data: cases } = await caseQuery;
  if (!cases || cases.length === 0) return [];

  const caseIds = cases.map((c) => c.id);

  const formResultsByType = await Promise.all(
    FORM_TYPES.map(async (formType) => {
      const { data } = await supabase
        .from(FORM_TABLE[formType])
        .select(
          'id, procurement_case_id, status, departments(code, name), applicant:employees!applicant_employee_id(name)'
        )
        .in('procurement_case_id', caseIds);
      return { formType, rows: (data ?? []) as unknown as FormQueryRow[] };
    })
  );

  const formsByCaseId = new Map<string, Partial<Record<FormType, FormQueryRow>>>();
  for (const { formType, rows } of formResultsByType) {
    for (const row of rows) {
      const existing = formsByCaseId.get(row.procurement_case_id) ?? {};
      existing[formType] = row;
      formsByCaseId.set(row.procurement_case_id, existing);
    }
  }

  const rows: CaseTrackingRow[] = cases.map((c) => {
    const formsForCase = formsByCaseId.get(c.id) ?? {};
    const forms: CaseFormState[] = FORM_TYPES.map((formType) => {
      const row = formsForCase[formType];
      return { formType, exists: !!row, status: row?.status ?? null };
    });
    const firstExisting = FORM_TYPES.map((t) => formsForCase[t]).find(
      (row): row is FormQueryRow => row !== undefined
    );
    return {
      caseNumber: c.case_number,
      department: firstExisting?.departments ?? null,
      applicant: firstExisting?.applicant?.name ?? null,
      forms,
      bucket: determineCaseBucket(forms),
    };
  });

  const keyword = filters.keyword?.trim();

  return rows.filter((row) => {
    if (filters.departmentCode && row.department?.code !== filters.departmentCode) return false;
    if (keyword && !row.caseNumber.includes(keyword) && !(row.applicant ?? '').includes(keyword)) {
      return false;
    }
    return true;
  });
}

export async function getDepartmentFilterOptions(): Promise<DepartmentOption[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from('departments').select('code, name').order('code');
  return data ?? [];
}
```

- [ ] **Step 4: 執行測試確認通過**

Run: `export $(grep -v '^#' .env.local | xargs) && NODE_OPTIONS=--experimental-websocket npx vitest run tests/integration/case-tracking-queries.test.ts`
Expected: PASS（11 個測試全過）

- [ ] **Step 5: Commit**

```bash
git add src/lib/case-tracking/queries.ts tests/integration/case-tracking-queries.test.ts
git commit -m "feat: add getFinanceCaseTracking batch query for finance case tracking page"
```

---

### Task 4: `/case-tracking` 頁面與導覽列連結

**Files:**
- Create: `src/app/case-tracking/page.tsx`
- Modify: `src/app/dashboard/page.tsx`

**Interfaces:**
- Consumes：
  - `createSupabaseServerClient()` from `src/lib/supabase/server.ts`
  - `getCurrentEmployee(supabase)` from `src/lib/auth/current-employee.ts`
  - `getFinanceCaseTracking`, `getDepartmentFilterOptions`, `type CaseTrackingFilters` from `src/lib/case-tracking/queries.ts`（Task 3 產出）
  - `type CaseBucket` from `src/lib/case-tracking/determine-bucket.ts`（Task 2 產出）
  - `FORM_TYPES`, `FORM_LABELS` from `src/lib/procurement/form-registry.ts`
- Produces：`/case-tracking` 路由（無其他模組匯入此頁面，是本計畫的最終使用者介面）

這個頁面沒有專屬的自動化測試——專案裡所有 `page.tsx`（`/budget-codes`、`/admin/master-data`、`/cases/[caseNumber]` 等）都沒有頁面層級的單元測試，角色門檻與渲染都是透過 Task 5 的真人瀏覽器 QA 驗證，這裡延續同樣的慣例。這個 Task 用 `npm run build`（含 TypeScript 檢查）與 `npm run lint` 當作「測試」步驟。

- [ ] **Step 1: 建立 `src/app/case-tracking/page.tsx`**

```tsx
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import {
  getDepartmentFilterOptions,
  getFinanceCaseTracking,
  type CaseTrackingFilters,
} from '@/lib/case-tracking/queries';
import { FORM_TYPES, FORM_LABELS } from '@/lib/procurement/form-registry';
import type { CaseBucket } from '@/lib/case-tracking/determine-bucket';

const STATUS_LABELS: Record<string, string> = {
  pending_approval: '簽核中',
  approved: '已核准',
  returned: '已退回（待修改）',
};

function buildQuery(params: Record<string, string | undefined>): string {
  const usp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) usp.set(key, value);
  }
  const qs = usp.toString();
  return qs ? `?${qs}` : '';
}

export default async function CaseTrackingPage({
  searchParams,
}: {
  searchParams: Promise<{
    tab?: string;
    department?: string;
    dateFrom?: string;
    dateTo?: string;
    q?: string;
  }>;
}) {
  const params = await searchParams;
  const supabase = await createSupabaseServerClient();
  const employee = await getCurrentEmployee(supabase);
  if (!employee) redirect('/login');
  if (employee.role !== 'finance') redirect('/dashboard');

  const tab: CaseBucket = params.tab === 'completed' ? 'completed' : 'in_progress';
  const filters: CaseTrackingFilters = {
    departmentCode: params.department || undefined,
    dateFrom: params.dateFrom || undefined,
    dateTo: params.dateTo || undefined,
    keyword: params.q || undefined,
  };

  const [allRows, departmentOptions] = await Promise.all([
    getFinanceCaseTracking(filters),
    getDepartmentFilterOptions(),
  ]);

  const inProgressCount = allRows.filter((r) => r.bucket === 'in_progress').length;
  const completedCount = allRows.filter((r) => r.bucket === 'completed').length;
  const visibleRows = allRows.filter((r) => r.bucket === tab);

  const baseParams = {
    department: filters.departmentCode,
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
    q: filters.keyword,
  };

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-8">
      <h1 className="text-2xl font-bold">簽核追蹤</h1>

      <nav className="flex gap-4 border-b">
        <Link
          href={buildQuery({ ...baseParams, tab: 'in_progress' })}
          className={
            tab === 'in_progress'
              ? 'border-b-2 border-blue-600 pb-2 font-semibold'
              : 'pb-2 text-gray-500'
          }
        >
          簽核中（{inProgressCount}）
        </Link>
        <Link
          href={buildQuery({ ...baseParams, tab: 'completed' })}
          className={
            tab === 'completed'
              ? 'border-b-2 border-blue-600 pb-2 font-semibold'
              : 'pb-2 text-gray-500'
          }
        >
          已完成（{completedCount}）
        </Link>
      </nav>

      <form method="get" className="flex flex-wrap items-end gap-3 text-sm">
        <input type="hidden" name="tab" value={tab} />
        <label className="flex flex-col">
          部門
          <select name="department" defaultValue={filters.departmentCode ?? ''} className="border p-1">
            <option value="">全部</option>
            {departmentOptions.map((d) => (
              <option key={d.code} value={d.code}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col">
          建立日期（起）
          <input type="date" name="dateFrom" defaultValue={filters.dateFrom ?? ''} className="border p-1" />
        </label>
        <label className="flex flex-col">
          建立日期（迄）
          <input type="date" name="dateTo" defaultValue={filters.dateTo ?? ''} className="border p-1" />
        </label>
        <label className="flex flex-col">
          關鍵字（案號／申請人）
          <input type="text" name="q" defaultValue={filters.keyword ?? ''} className="border p-1" />
        </label>
        <button type="submit" className="rounded bg-blue-600 px-4 py-1 text-white">
          套用篩選
        </button>
      </form>

      {visibleRows.length === 0 ? (
        <p className="text-gray-500">目前沒有符合篩選條件的案件</p>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="p-2">案號</th>
              <th className="p-2">部門</th>
              <th className="p-2">申請人</th>
              {FORM_TYPES.map((formType) => (
                <th key={formType} className="p-2">
                  {FORM_LABELS[formType]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => (
              <tr key={row.caseNumber} className="border-b">
                <td className="p-2">
                  <Link href={`/cases/${row.caseNumber}`} className="text-blue-600 underline">
                    {row.caseNumber}
                  </Link>
                </td>
                <td className="p-2">{row.department?.name ?? '—'}</td>
                <td className="p-2">{row.applicant ?? '—'}</td>
                {row.forms.map((f) => (
                  <td key={f.formType} className="p-2">
                    {f.exists ? (STATUS_LABELS[f.status ?? ''] ?? f.status) : '尚未建立'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
```

- [ ] **Step 2: 在 `src/app/dashboard/page.tsx` 的 finance 區塊加上連結**

在 `src/app/dashboard/page.tsx` 找到：

```tsx
        {employee.role === 'finance' && (
          <Link href="/budget-codes" className="text-blue-600 underline">
            預算編號管理
          </Link>
        )}
```

改成：

```tsx
        {employee.role === 'finance' && (
          <>
            <Link href="/budget-codes" className="text-blue-600 underline">
              預算編號管理
            </Link>
            <Link href="/case-tracking" className="text-blue-600 underline">
              簽核追蹤
            </Link>
          </>
        )}
```

- [ ] **Step 3: 執行 build 與 lint 確認沒有型別或規則錯誤**

Run: `npm run build`
Expected: 成功完成（無 TypeScript 型別錯誤）

Run: `npm run lint`
Expected: 無錯誤（`.worktrees/`、`.claude/worktrees/` 已在 `eslint.config.mjs` 排除，不影響本次檢查）

- [ ] **Step 4: Commit**

```bash
git add src/app/case-tracking/page.tsx src/app/dashboard/page.tsx
git commit -m "feat: add /case-tracking page for finance-wide approval status tracking"
```

---

### Task 5: 真人瀏覽器 QA

**Files:** 無程式碼變更，純驗證步驟。

**Interfaces:** 無（消費 Task 1～4 完成後的整體行為）

比照專案慣例（交接文件記錄：自動化測試全過，真人操作還是抓到過真實 bug），這個 Task 需要在瀏覽器裡手動驗證。已知限制：若這個 worktree 沒有自己的 `.claude/launch.json`，`preview_start` 預覽工具可能連到錯誤的程式碼；最可靠的方式是在終端機自己 `cd` 進 worktree 跑 `npm run dev`，用本機瀏覽器測試。

- [ ] **Step 1: 用 service-role 建立跨部門/跨頁籤/跨狀態的手動測試資料**

跟人類確認後，用 service-role client 直接在資料庫建立（或暫時把自己的 `employees.role` 改成 `'finance'`）：
- 至少一個案件四張表單皆 approved（應該出現在「已完成」頁籤）
- 至少一個案件某張表單 pending_approval（應該出現在「簽核中」頁籤）
- 至少一個案件某張表單 returned 且無 pending_approval（應該出現在「簽核中」頁籤）
- 上述案件分屬至少兩個不同部門

- [ ] **Step 2: 啟動 dev server 並登入 finance 角色帳號**

Run: `npm run dev`

瀏覽器開啟 `http://localhost:3000/dashboard`，確認：
- finance 角色帳號的導覽列出現「簽核追蹤」連結
- 點擊連結進入 `/case-tracking`

- [ ] **Step 3: 驗證頁籤與篩選**

- 「簽核中」頁籤顯示的案件都不是四張表單皆 approved
- 「已完成」頁籤只顯示四張表單皆 approved 的案件
- 兩個頁籤右邊的筆數與清單列數一致
- 用部門篩選只留下該部門的案件、點案號能連到 `/cases/[caseNumber]`
- 用日期區間篩選（含刻意輸入 `dateFrom` 晚於 `dateTo` 的情境）確認不會噴錯誤，且行為符合「忽略該條件」的預期
- 用關鍵字（案號、申請人姓名）篩選能正確窄化清單
- 篩選到沒有符合案件時顯示「目前沒有符合篩選條件的案件」而不是空白或錯誤

- [ ] **Step 4: 驗證非 finance 角色被擋下**

用非 `finance` 角色（例如 `staff`）帳號登入，嘗試直接訪問 `/case-tracking`，確認被導向 `/dashboard`，而不是看到頁面內容或錯誤訊息

- [ ] **Step 5: 清理手動測試資料**

刪除 Step 1 建立的所有測試案件/表單/暫時角色變更，確認 `/case-tracking` 頁面清單恢復成不含測試資料的狀態

- [ ] **Step 6: 執行完整測試套件確認沒有整體回歸**

Run: `export $(grep -v '^#' .env.local | xargs) && npm test`
Expected: PASS（所有測試檔案，含既有 55+ 檔案與本計畫新增的兩個測試檔）
