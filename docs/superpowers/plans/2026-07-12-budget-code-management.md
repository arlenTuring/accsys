# 預算編號基礎資料管理（Excel 批次匯入 + 網頁 CRUD）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let finance (`role = 'finance'`) maintain `budget_codes` (department and project budgets: code, department/project scope, category, fiscal year, amount, owner) through a dedicated web page — via a batch Excel upload and via manual create/edit/delete — instead of relying on developer-run CLI scripts or direct Supabase Studio edits.

**Architecture:** New page `/budget-codes`, finance-only. Batch import and manual create/edit both funnel through one shared, internal validation+upsert function so the two entry points can never drift into inconsistent rules. No database schema changes — `budget_codes` already has everything needed (`project_code` + nullable `department_id` + XOR check, added by an earlier plan). The existing CLI seed script (`scripts/import-seed-data.ts`, `scripts/lib/parse-seed-workbook.ts`) is untouched and keeps working independently for initial/full re-seeds.

**Tech Stack:** Same as the rest of the app — Next.js 15 (App Router, Server Actions), React 19, TypeScript 5 (strict), Tailwind CSS 3, Supabase (Postgres + RLS), Vitest, the `xlsx` npm package (already a dependency, used by the existing CLI parser).

**Full design spec:** `docs/superpowers/specs/2026-07-12-budget-code-management-design.md` — read this first for the full rationale, scope boundary (this plan is explicitly the "foundational data" slice; monthly budget planning, addition/change-request approval workflows, and overspend tracking are out of scope and deferred), and the decisions behind each rule below.

## Global Constraints

- Node.js >= 20, npm. `npm test` carries `NODE_OPTIONS=--experimental-websocket` (already in `package.json`); do not remove it.
- TypeScript `strict: true`; no `any` in new code.
- All user-facing copy is Traditional Chinese.
- No code comments except where a non-obvious business rule needs explaining.
- Writes go through a service-role client (`createSupabaseServiceRoleClient`) with in-code authorization (`role === 'finance'`, re-checked in every exported Server Action) — this matches the existing pattern for every other form's actions. Reads go through the RLS-scoped client (`createSupabaseServerClient`); `budget_codes` already has an `authenticated_read_budget_codes` RLS policy allowing any authenticated read, so no RLS changes are needed.
- Environment for integration tests: `export $(grep -v '^#' .env.local | xargs)` before `npm test`, otherwise integration suites silently skip (not a valid pass/fail signal).
- **Do not** modify `scripts/import-seed-data.ts` or `scripts/lib/parse-seed-workbook.ts` — they are a separate, unchanged mechanism.
- **Do not** implement monthly budget line items, budget addition/change-request approval workflows, project progress tracking, or overspend/budget-consumption tracking — all explicitly out of scope per the design spec's Non-Goals.
- **Do not** add a database CHECK constraint for "amount must be positive" — that rule is enforced only at the application layer (`upsertOneBudgetCode`), per the spec, to avoid touching existing data that may not satisfy it.

## Existing interfaces this plan consumes

- `getCurrentEmployee(supabase): Promise<CurrentEmployee | null>` from `src/lib/auth/current-employee.ts` — `CurrentEmployee = { id, employeeCode, name, departmentId, role: 'staff'|'finance'|'admin', isGeneralManager, isChairman }`.
- `createSupabaseServerClient()` from `src/lib/supabase/server.ts` (async, RLS-scoped), `createSupabaseServiceRoleClient()` from `src/lib/supabase/service-role.ts` (sync, bypasses RLS).
- `budget_codes(id uuid, code text unique, department_id uuid null references departments(id), project_code text null, category text, owner_employee_id uuid null references employees(id), fiscal_year text, annual_budget_amount numeric(14,2), created_at timestamptz)` with `check ((department_id is not null) <> (project_code is not null))`.
- `departments(id uuid, code text unique, name text, manager_employee_id uuid null, created_at timestamptz)`.
- `employees(id uuid, employee_code text unique, name text, department_id uuid, title text, google_email text unique, role text, is_general_manager bool, is_chairman bool, created_at timestamptz)`.
- `purchase_request_items(id uuid, purchase_request_id uuid, line_no int, budget_code_id uuid references budget_codes(id), ...)` — the only table referencing `budget_codes` today; used by the delete guard.
- `tests/integration/supabase-test-client.ts`'s `createServiceRoleTestClient()` / `hasIntegrationTestCredentials()`.
- The repo's `xlsx` package (`^0.18.5`) — `XLSX.read(buffer, { type: 'buffer' })`, `XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true })`, `XLSX.utils.aoa_to_sheet`, `XLSX.utils.book_new`, `XLSX.utils.book_append_sheet`, `XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })` (last four used only in tests, to build an in-memory fixture workbook instead of checking in a binary `.xlsx` file).

## File Structure

- `src/lib/budget-codes/parse-budget-workbook.ts` — new: pure parser, Excel buffer → `ParsedBudgetRow[]` (Task 1)
- `src/lib/budget-codes/parse-budget-workbook.test.ts` — new (Task 1)
- `src/lib/budget-codes/actions.ts` — new: `upsertBudgetCode`, `deleteBudgetCode`, `importBudgetCodesFromExcel` (Tasks 2-4)
- `tests/integration/budget-codes-actions.test.ts` — new (Tasks 2-4)
- `src/lib/budget-codes/queries.ts` — new: `getBudgetCodeList` (Task 5)
- `tests/integration/budget-codes-queries.test.ts` — new (Task 5)
- `src/app/budget-codes/page.tsx` — new: role-gated Server Component (Task 6)
- `src/app/budget-codes/budget-codes-manager.tsx` — new: client component, create/edit form + list (Task 6)
- `src/app/budget-codes/budget-code-import-form.tsx` — new: client component, Excel upload (Task 6)
- `src/app/dashboard/page.tsx` — modified: add a nav link for `role === 'finance'` (Task 6)

---

## Task 1: Excel 解析模組（parse-budget-workbook）

**Files:**
- Create: `src/lib/budget-codes/parse-budget-workbook.ts` + `.test.ts`

**Interfaces:**
- Consumes: `xlsx` package only.
- Produces: `ParsedBudgetRow = { rowNumber: number; code: string; departmentCode: string | null; projectCode: string | null; category: string; fiscalYear: string; annualBudgetAmount: number | null; ownerEmployeeCode: string | null }` and `parseBudgetWorkbook(buffer: Buffer): ParsedBudgetRow[]`. This is a pure function — no validation of business rules (department exists, XOR, positive amount) happens here; that's Task 2's job. `rowNumber` is the row's actual position in the Excel file (1-based, so the first data row — right after the header row — is `2`), used later so error messages can point finance at the exact row to fix.

**Design note — template layout:** single sheet (any name; the parser reads the first sheet in the workbook so the template doesn't need a specific sheet name), header row 1, data from row 2. Columns by position (0-indexed): 0 = 預算編號, 1 = 部門代碼, 2 = 專案代碼, 3 = 類別, 4 = 年度, 5 = 年度預算金額, 6 = 負責人工號. Rows with an empty 預算編號 are skipped entirely (not even counted as an error — they're treated as blank spacer rows, matching the existing `parse-seed-workbook.ts`'s convention of skipping on an empty key column).

- [ ] **Step 1: Write the failing tests**

`src/lib/budget-codes/parse-budget-workbook.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { parseBudgetWorkbook } from './parse-budget-workbook';

function buildWorkbookBuffer(rows: (string | number | null)[][]): Buffer {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, '預算編號');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

const HEADER = ['預算編號', '部門代碼', '專案代碼', '類別', '年度', '年度預算金額', '負責人工號'];

describe('parseBudgetWorkbook', () => {
  it('parses a department-scoped row', () => {
    const buffer = buildWorkbookBuffer([
      HEADER,
      ['115ADSE01', 'AD', null, '人事費', '115', 5000000, '0009'],
    ]);
    expect(parseBudgetWorkbook(buffer)).toEqual([
      {
        rowNumber: 2,
        code: '115ADSE01',
        departmentCode: 'AD',
        projectCode: null,
        category: '人事費',
        fiscalYear: '115',
        annualBudgetAmount: 5000000,
        ownerEmployeeCode: '0009',
      },
    ]);
  });

  it('parses a project-scoped row with no owner', () => {
    const buffer = buildWorkbookBuffer([
      HEADER,
      ['115BD001', null, '115BD001', '專案費用', '115', 300000, null],
    ]);
    expect(parseBudgetWorkbook(buffer)).toEqual([
      {
        rowNumber: 2,
        code: '115BD001',
        departmentCode: null,
        projectCode: '115BD001',
        category: '專案費用',
        fiscalYear: '115',
        annualBudgetAmount: 300000,
        ownerEmployeeCode: null,
      },
    ]);
  });

  it('sets annualBudgetAmount to null when the amount cell is not a number', () => {
    const buffer = buildWorkbookBuffer([
      HEADER,
      ['115ADSE02', 'AD', null, '租金支出', '115', 'oops', null],
    ]);
    expect(parseBudgetWorkbook(buffer)[0].annualBudgetAmount).toBeNull();
  });

  it('skips rows with an empty budget code and keeps correct row numbers for the rest', () => {
    const buffer = buildWorkbookBuffer([
      HEADER,
      ['', 'AD', null, '人事費', '115', 1000, null],
      ['115ADSE03', 'AD', null, '旅費', '115', 40000, null],
    ]);
    const rows = parseBudgetWorkbook(buffer);
    expect(rows).toHaveLength(1);
    expect(rows[0].code).toBe('115ADSE03');
    expect(rows[0].rowNumber).toBe(3);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/lib/budget-codes/parse-budget-workbook.test.ts`
Expected: FAIL — `Cannot find module './parse-budget-workbook'`.

- [ ] **Step 3: Implement the parser**

`src/lib/budget-codes/parse-budget-workbook.ts`:
```ts
import * as XLSX from 'xlsx';

export type ParsedBudgetRow = {
  rowNumber: number;
  code: string;
  departmentCode: string | null;
  projectCode: string | null;
  category: string;
  fiscalYear: string;
  annualBudgetAmount: number | null;
  ownerEmployeeCode: string | null;
};

function cell(row: unknown[], index: number): string {
  return String(row[index] ?? '').trim();
}

function cellOrNull(row: unknown[], index: number): string | null {
  const value = cell(row, index);
  return value === '' ? null : value;
}

export function parseBudgetWorkbook(buffer: Buffer): ParsedBudgetRow[] {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true });

  const result: ParsedBudgetRow[] = [];
  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i];
    const code = cell(row, 0);
    if (code === '') continue;
    const rawAmount = row[5];
    result.push({
      rowNumber: i + 1,
      code,
      departmentCode: cellOrNull(row, 1),
      projectCode: cellOrNull(row, 2),
      category: cell(row, 3),
      fiscalYear: cell(row, 4),
      annualBudgetAmount: typeof rawAmount === 'number' ? rawAmount : null,
      ownerEmployeeCode: cellOrNull(row, 6),
    });
  }
  return result;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- src/lib/budget-codes/parse-budget-workbook.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/budget-codes/parse-budget-workbook.ts src/lib/budget-codes/parse-budget-workbook.test.ts
git commit -m "feat: add pure parser for the dedicated budget-code Excel template"
```

---

## Task 2: 新增／編輯預算編號（upsertBudgetCode）

**Files:**
- Create: `src/lib/budget-codes/actions.ts`
- Create: `tests/integration/budget-codes-actions.test.ts`

**Interfaces:**
- Consumes: `getCurrentEmployee`, `createSupabaseServerClient`, `createSupabaseServiceRoleClient`.
- Produces: `BudgetCodeInput = { code: string; departmentCode: string | null; projectCode: string | null; category: string; fiscalYear: string; annualBudgetAmount: number; ownerEmployeeCode: string | null }`, `UpsertResult = { ok: true; budgetCodeId: string } | { ok: false; error: string }`, `upsertBudgetCode(input: BudgetCodeInput): Promise<UpsertResult>` (exported Server Action — used directly by both the manual create/edit form in Task 6 and, in spirit, by the import loop in Task 4, which calls the same validation through a shared non-exported helper). Also produces the module-private helper `upsertOneBudgetCode(db, input)` (not exported — takes a Supabase client, so it must never be a Server Action entry point; Task 4's `importBudgetCodesFromExcel` calls it directly within the same file).

**Design note — validation order and rules (this is the single source of truth both entry points share):**
1. `code` non-empty → else `'預算編號為必填'`
2. exactly one of `departmentCode`/`projectCode` is non-null → else `'部門代碼與專案代碼必須恰填一項'`
3. `category` non-empty → else `'類別為必填'`
4. `fiscalYear` non-empty → else `'年度為必填'`
5. `annualBudgetAmount > 0` → else `'年度預算金額必須為正數'`
6. if `departmentCode` set: look up `departments` by `code`; not found → `` `部門代碼「${departmentCode}」查無此部門` ``; found → sets `department_id` and defaults `owner_employee_id` to that department's `manager_employee_id` (which may itself be `null` — that's fine, matches existing behavior for departments with no manager set)
7. if `ownerEmployeeCode` provided (non-null): look up `employees` by `employee_code`; not found → `` `負責人工號「${ownerEmployeeCode}」查無此員工` ``; found → **overrides** whatever `owner_employee_id` step 6 set
8. upsert into `budget_codes` on `code` conflict — this means editing an existing code always overwrites every column with the new input; the Task 6 edit form is responsible for pre-filling all fields (including the current owner's employee code) from the existing row so an edit that doesn't intend to change the owner doesn't accidentally revert it to the department default.

- [ ] **Step 1: Write the failing tests**

Read `tests/integration/acceptance-approve-return.test.ts` first for the mocking/fixture style this test follows.

`tests/integration/budget-codes-actions.test.ts`:
```ts
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  createServiceRoleTestClient,
  hasIntegrationTestCredentials,
} from './supabase-test-client';

const currentEmployee = vi.hoisted(() => ({ value: null as null | { id: string; role: string } }));
vi.mock('@/lib/auth/current-employee', () => ({
  getCurrentEmployee: async () => currentEmployee.value,
}));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({}) }));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

describe.skipIf(!hasIntegrationTestCredentials())('budget-codes actions', () => {
  let admin: ReturnType<typeof createServiceRoleTestClient>;
  let departmentCode: string;
  let departmentId: string;
  let managerId: string;
  let customOwnerId: string;
  let customOwnerCode: string;
  let financeEmployeeId: string;
  let staffEmployeeId: string;
  const createdBudgetCodeIds: string[] = [];

  beforeAll(async () => {
    admin = createServiceRoleTestClient();
    departmentCode = `BCT-${Date.now()}`;

    const { data: anyDept } = await admin.from('departments').select('id').limit(1).single();

    const { data: manager } = await admin
      .from('employees')
      .insert({
        employee_code: `BCT-MGR-${Date.now()}`,
        name: '測試部門主管',
        department_id: anyDept!.id,
      })
      .select()
      .single();
    managerId = manager!.id;

    const { data: dept } = await admin
      .from('departments')
      .insert({ code: departmentCode, name: '測試預算部門', manager_employee_id: managerId })
      .select()
      .single();
    departmentId = dept!.id;

    customOwnerCode = `BCT-OWNER-${Date.now()}`;
    const { data: customOwner } = await admin
      .from('employees')
      .insert({ employee_code: customOwnerCode, name: '測試自訂負責人', department_id: departmentId })
      .select()
      .single();
    customOwnerId = customOwner!.id;

    const { data: financeEmp } = await admin
      .from('employees')
      .insert({
        employee_code: `BCT-FIN-${Date.now()}`,
        name: '測試財會人員',
        department_id: departmentId,
        role: 'finance',
      })
      .select()
      .single();
    financeEmployeeId = financeEmp!.id;

    const { data: staffEmp } = await admin
      .from('employees')
      .insert({
        employee_code: `BCT-STAFF-${Date.now()}`,
        name: '測試一般員工',
        department_id: departmentId,
        role: 'staff',
      })
      .select()
      .single();
    staffEmployeeId = staffEmp!.id;
  });

  afterAll(async () => {
    if (createdBudgetCodeIds.length > 0) {
      await admin.from('budget_codes').delete().in('id', createdBudgetCodeIds);
    }
    await admin
      .from('employees')
      .delete()
      .in('id', [managerId, customOwnerId, financeEmployeeId, staffEmployeeId]);
    await admin.from('departments').delete().eq('id', departmentId);
  });

  it('rejects a non-finance employee', async () => {
    currentEmployee.value = { id: staffEmployeeId, role: 'staff' };
    const { upsertBudgetCode } = await import('@/lib/budget-codes/actions');
    const result = await upsertBudgetCode({
      code: `BCT-CODE-${Date.now()}`,
      departmentCode,
      projectCode: null,
      category: '人事費',
      fiscalYear: '115',
      annualBudgetAmount: 1000,
      ownerEmployeeCode: null,
    });
    expect(result).toEqual({ ok: false, error: '只有財會人員可以維護預算編號' });
  });

  it('creates a department-scoped budget code, defaulting owner to the department manager when left blank', async () => {
    currentEmployee.value = { id: financeEmployeeId, role: 'finance' };
    const { upsertBudgetCode } = await import('@/lib/budget-codes/actions');
    const code = `BCT-CODE-${Date.now()}`;
    const result = await upsertBudgetCode({
      code,
      departmentCode,
      projectCode: null,
      category: '人事費',
      fiscalYear: '115',
      annualBudgetAmount: 500000,
      ownerEmployeeCode: null,
    });
    expect(result.ok).toBe(true);
    if (result.ok) createdBudgetCodeIds.push(result.budgetCodeId);

    const { data: row } = await admin
      .from('budget_codes')
      .select('department_id, project_code, owner_employee_id, annual_budget_amount')
      .eq('code', code)
      .single();
    expect(row).toEqual({
      department_id: departmentId,
      project_code: null,
      owner_employee_id: managerId,
      annual_budget_amount: 500000,
    });
  });

  it('creates a project-scoped budget code with an explicit owner', async () => {
    currentEmployee.value = { id: financeEmployeeId, role: 'finance' };
    const { upsertBudgetCode } = await import('@/lib/budget-codes/actions');
    const code = `BCT-PROJ-${Date.now()}`;
    const result = await upsertBudgetCode({
      code,
      departmentCode: null,
      projectCode: '115BD999',
      category: '專案費用',
      fiscalYear: '115',
      annualBudgetAmount: 200000,
      ownerEmployeeCode: customOwnerCode,
    });
    expect(result.ok).toBe(true);
    if (result.ok) createdBudgetCodeIds.push(result.budgetCodeId);

    const { data: row } = await admin
      .from('budget_codes')
      .select('department_id, project_code, owner_employee_id')
      .eq('code', code)
      .single();
    expect(row).toEqual({
      department_id: null,
      project_code: '115BD999',
      owner_employee_id: customOwnerId,
    });
  });

  it('rejects when both department code and project code are provided', async () => {
    currentEmployee.value = { id: financeEmployeeId, role: 'finance' };
    const { upsertBudgetCode } = await import('@/lib/budget-codes/actions');
    const result = await upsertBudgetCode({
      code: `BCT-BOTH-${Date.now()}`,
      departmentCode,
      projectCode: '115BD999',
      category: '人事費',
      fiscalYear: '115',
      annualBudgetAmount: 1000,
      ownerEmployeeCode: null,
    });
    expect(result).toEqual({ ok: false, error: '部門代碼與專案代碼必須恰填一項' });
  });

  it('rejects when neither department code nor project code are provided', async () => {
    currentEmployee.value = { id: financeEmployeeId, role: 'finance' };
    const { upsertBudgetCode } = await import('@/lib/budget-codes/actions');
    const result = await upsertBudgetCode({
      code: `BCT-NEITHER-${Date.now()}`,
      departmentCode: null,
      projectCode: null,
      category: '人事費',
      fiscalYear: '115',
      annualBudgetAmount: 1000,
      ownerEmployeeCode: null,
    });
    expect(result).toEqual({ ok: false, error: '部門代碼與專案代碼必須恰填一項' });
  });

  it('rejects a non-positive annual budget amount', async () => {
    currentEmployee.value = { id: financeEmployeeId, role: 'finance' };
    const { upsertBudgetCode } = await import('@/lib/budget-codes/actions');
    const result = await upsertBudgetCode({
      code: `BCT-NEG-${Date.now()}`,
      departmentCode,
      projectCode: null,
      category: '人事費',
      fiscalYear: '115',
      annualBudgetAmount: 0,
      ownerEmployeeCode: null,
    });
    expect(result).toEqual({ ok: false, error: '年度預算金額必須為正數' });
  });

  it('rejects an unknown department code', async () => {
    currentEmployee.value = { id: financeEmployeeId, role: 'finance' };
    const { upsertBudgetCode } = await import('@/lib/budget-codes/actions');
    const result = await upsertBudgetCode({
      code: `BCT-BADDEPT-${Date.now()}`,
      departmentCode: 'NOPE-DEPT',
      projectCode: null,
      category: '人事費',
      fiscalYear: '115',
      annualBudgetAmount: 1000,
      ownerEmployeeCode: null,
    });
    expect(result).toEqual({ ok: false, error: '部門代碼「NOPE-DEPT」查無此部門' });
  });

  it('rejects an unknown owner employee code', async () => {
    currentEmployee.value = { id: financeEmployeeId, role: 'finance' };
    const { upsertBudgetCode } = await import('@/lib/budget-codes/actions');
    const result = await upsertBudgetCode({
      code: `BCT-BADOWNER-${Date.now()}`,
      departmentCode,
      projectCode: null,
      category: '人事費',
      fiscalYear: '115',
      annualBudgetAmount: 1000,
      ownerEmployeeCode: 'NOPE-0000',
    });
    expect(result).toEqual({ ok: false, error: '負責人工號「NOPE-0000」查無此員工' });
  });

  it('updates an existing budget code on repeated upsert rather than creating a duplicate', async () => {
    currentEmployee.value = { id: financeEmployeeId, role: 'finance' };
    const { upsertBudgetCode } = await import('@/lib/budget-codes/actions');
    const code = `BCT-UPDATE-${Date.now()}`;
    const first = await upsertBudgetCode({
      code,
      departmentCode,
      projectCode: null,
      category: '人事費',
      fiscalYear: '115',
      annualBudgetAmount: 1000,
      ownerEmployeeCode: null,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    createdBudgetCodeIds.push(first.budgetCodeId);

    const second = await upsertBudgetCode({
      code,
      departmentCode,
      projectCode: null,
      category: '租金支出',
      fiscalYear: '115',
      annualBudgetAmount: 2000,
      ownerEmployeeCode: null,
    });
    expect(second).toEqual({ ok: true, budgetCodeId: first.budgetCodeId });

    const { count } = await admin
      .from('budget_codes')
      .select('id', { count: 'exact', head: true })
      .eq('code', code);
    expect(count).toBe(1);

    const { data: row } = await admin
      .from('budget_codes')
      .select('category, annual_budget_amount')
      .eq('code', code)
      .single();
    expect(row).toEqual({ category: '租金支出', annual_budget_amount: 2000 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `export $(grep -v '^#' .env.local | xargs) && npm test -- tests/integration/budget-codes-actions.test.ts`
Expected: FAIL — `Cannot find module '@/lib/budget-codes/actions'`.

- [ ] **Step 3: Implement `upsertBudgetCode`**

`src/lib/budget-codes/actions.ts`:
```ts
'use server';

import { revalidatePath } from 'next/cache';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getCurrentEmployee } from '@/lib/auth/current-employee';

export type BudgetCodeInput = {
  code: string;
  departmentCode: string | null;
  projectCode: string | null;
  category: string;
  fiscalYear: string;
  annualBudgetAmount: number;
  ownerEmployeeCode: string | null;
};

export type UpsertResult = { ok: true; budgetCodeId: string } | { ok: false; error: string };

async function upsertOneBudgetCode(
  db: ReturnType<typeof createSupabaseServiceRoleClient>,
  input: BudgetCodeInput
): Promise<UpsertResult> {
  if (!input.code.trim()) return { ok: false, error: '預算編號為必填' };
  const hasDept = !!input.departmentCode;
  const hasProject = !!input.projectCode;
  if (hasDept === hasProject) {
    return { ok: false, error: '部門代碼與專案代碼必須恰填一項' };
  }
  if (!input.category.trim()) return { ok: false, error: '類別為必填' };
  if (!input.fiscalYear.trim()) return { ok: false, error: '年度為必填' };
  if (!(input.annualBudgetAmount > 0)) {
    return { ok: false, error: '年度預算金額必須為正數' };
  }

  let departmentId: string | null = null;
  let ownerEmployeeId: string | null = null;

  if (hasDept) {
    const { data: dept } = await db
      .from('departments')
      .select('id, manager_employee_id')
      .eq('code', input.departmentCode)
      .maybeSingle();
    if (!dept) return { ok: false, error: `部門代碼「${input.departmentCode}」查無此部門` };
    departmentId = dept.id;
    ownerEmployeeId = dept.manager_employee_id;
  }

  if (input.ownerEmployeeCode) {
    const { data: owner } = await db
      .from('employees')
      .select('id')
      .eq('employee_code', input.ownerEmployeeCode)
      .maybeSingle();
    if (!owner) return { ok: false, error: `負責人工號「${input.ownerEmployeeCode}」查無此員工` };
    ownerEmployeeId = owner.id;
  }

  const { data, error } = await db
    .from('budget_codes')
    .upsert(
      {
        code: input.code,
        department_id: departmentId,
        project_code: hasProject ? input.projectCode : null,
        category: input.category,
        fiscal_year: input.fiscalYear,
        annual_budget_amount: input.annualBudgetAmount,
        owner_employee_id: ownerEmployeeId,
      },
      { onConflict: 'code' }
    )
    .select('id')
    .single();
  if (error || !data) return { ok: false, error: '寫入預算編號失敗' };
  return { ok: true, budgetCodeId: data.id };
}

export async function upsertBudgetCode(input: BudgetCodeInput): Promise<UpsertResult> {
  const employee = await getCurrentEmployee(await createSupabaseServerClient());
  if (!employee) return { ok: false, error: '找不到您的員工資料，請聯絡系統管理員' };
  if (employee.role !== 'finance') return { ok: false, error: '只有財會人員可以維護預算編號' };

  const db = createSupabaseServiceRoleClient();
  const result = await upsertOneBudgetCode(db, input);
  if (result.ok) revalidatePath('/budget-codes');
  return result;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `export $(grep -v '^#' .env.local | xargs) && npm test -- tests/integration/budget-codes-actions.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Run the full suite to confirm no regression**

Run: `export $(grep -v '^#' .env.local | xargs) && npm test`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/budget-codes/actions.ts tests/integration/budget-codes-actions.test.ts
git commit -m "feat: add upsertBudgetCode for manual create/edit of budget codes"
```

---

## Task 3: 刪除預算編號（deleteBudgetCode）

**Files:**
- Modify: `src/lib/budget-codes/actions.ts`
- Modify: `tests/integration/budget-codes-actions.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `DeleteResult = { ok: true } | { ok: false; error: string }`, `deleteBudgetCode(budgetCodeId: string): Promise<DeleteResult>`. Refuses to delete if any `purchase_request_items` row references the code (`purchase_request_items` is the only table with a FK to `budget_codes` today).

- [ ] **Step 1: Write the failing tests**

Add to `tests/integration/budget-codes-actions.test.ts`, inside the same `describe` block (after the existing tests):

```ts
  it('rejects delete from a non-finance employee', async () => {
    currentEmployee.value = { id: staffEmployeeId, role: 'staff' };
    const { deleteBudgetCode } = await import('@/lib/budget-codes/actions');
    const result = await deleteBudgetCode('00000000-0000-0000-0000-000000000000');
    expect(result).toEqual({ ok: false, error: '只有財會人員可以維護預算編號' });
  });

  it('deletes a budget code that is not referenced by any purchase request item', async () => {
    currentEmployee.value = { id: financeEmployeeId, role: 'finance' };
    const { upsertBudgetCode, deleteBudgetCode } = await import('@/lib/budget-codes/actions');
    const create = await upsertBudgetCode({
      code: `BCT-DEL-OK-${Date.now()}`,
      departmentCode,
      projectCode: null,
      category: '人事費',
      fiscalYear: '115',
      annualBudgetAmount: 1000,
      ownerEmployeeCode: null,
    });
    expect(create.ok).toBe(true);
    if (!create.ok) return;

    const result = await deleteBudgetCode(create.budgetCodeId);
    expect(result).toEqual({ ok: true });

    const { data: row } = await admin
      .from('budget_codes')
      .select('id')
      .eq('id', create.budgetCodeId)
      .maybeSingle();
    expect(row).toBeNull();
  });

  it('rejects deleting a budget code referenced by a purchase request item', async () => {
    currentEmployee.value = { id: financeEmployeeId, role: 'finance' };
    const { upsertBudgetCode, deleteBudgetCode } = await import('@/lib/budget-codes/actions');
    const create = await upsertBudgetCode({
      code: `BCT-DEL-BLOCKED-${Date.now()}`,
      departmentCode,
      projectCode: null,
      category: '人事費',
      fiscalYear: '115',
      annualBudgetAmount: 1000,
      ownerEmployeeCode: null,
    });
    expect(create.ok).toBe(true);
    if (!create.ok) return;
    createdBudgetCodeIds.push(create.budgetCodeId);

    const { data: caseNumber } = await admin.rpc('next_case_number');
    const { data: pcase } = await admin
      .from('procurement_cases')
      .insert({ case_number: caseNumber, created_by_employee_id: financeEmployeeId })
      .select()
      .single();
    const { data: pr } = await admin
      .from('purchase_requests')
      .insert({
        procurement_case_id: pcase!.id,
        applicant_employee_id: financeEmployeeId,
        department_id: departmentId,
        budget_owner_employee_id: managerId,
        total_amount: 1000,
        status: 'pending_approval',
      })
      .select()
      .single();
    await admin.from('purchase_request_items').insert({
      purchase_request_id: pr!.id,
      line_no: 1,
      budget_code_id: create.budgetCodeId,
      item_category: '人事費',
      description: '測試項目',
      quantity: 1,
      estimated_amount: 1000,
    });

    const result = await deleteBudgetCode(create.budgetCodeId);
    expect(result).toEqual({ ok: false, error: '此預算編號已被請購單使用，無法刪除' });

    await admin.from('purchase_request_items').delete().eq('purchase_request_id', pr!.id);
    await admin.from('purchase_requests').delete().eq('id', pr!.id);
    await admin.from('procurement_cases').delete().eq('id', pcase!.id);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `export $(grep -v '^#' .env.local | xargs) && npm test -- tests/integration/budget-codes-actions.test.ts`
Expected: FAIL — `deleteBudgetCode` is not exported yet.

- [ ] **Step 3: Implement `deleteBudgetCode`**

Add to `src/lib/budget-codes/actions.ts` (after `upsertBudgetCode`):
```ts
export type DeleteResult = { ok: true } | { ok: false; error: string };

export async function deleteBudgetCode(budgetCodeId: string): Promise<DeleteResult> {
  const employee = await getCurrentEmployee(await createSupabaseServerClient());
  if (!employee) return { ok: false, error: '找不到您的員工資料，請聯絡系統管理員' };
  if (employee.role !== 'finance') return { ok: false, error: '只有財會人員可以維護預算編號' };

  const db = createSupabaseServiceRoleClient();
  const { count } = await db
    .from('purchase_request_items')
    .select('id', { count: 'exact', head: true })
    .eq('budget_code_id', budgetCodeId);
  if ((count ?? 0) > 0) {
    return { ok: false, error: '此預算編號已被請購單使用，無法刪除' };
  }

  const { error } = await db.from('budget_codes').delete().eq('id', budgetCodeId);
  if (error) return { ok: false, error: '刪除預算編號失敗' };
  revalidatePath('/budget-codes');
  return { ok: true };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `export $(grep -v '^#' .env.local | xargs) && npm test -- tests/integration/budget-codes-actions.test.ts`
Expected: PASS (12 tests).

- [ ] **Step 5: Run the full suite to confirm no regression**

Run: `export $(grep -v '^#' .env.local | xargs) && npm test`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/budget-codes/actions.ts tests/integration/budget-codes-actions.test.ts
git commit -m "feat: add deleteBudgetCode, blocked when referenced by a purchase request"
```

---

## Task 4: Excel 批次匯入（importBudgetCodesFromExcel）

**Files:**
- Modify: `src/lib/budget-codes/actions.ts`
- Modify: `tests/integration/budget-codes-actions.test.ts`

**Interfaces:**
- Consumes: `parseBudgetWorkbook` from Task 1; the internal `upsertOneBudgetCode` helper from Task 2 (already in the same file — no new import needed).
- Produces: `ImportRowError = { row: number; reason: string }`, `ImportSummary = { successCount: number; errors: ImportRowError[] }`, `ImportOutcome = { ok: true; summary: ImportSummary } | { ok: false; error: string }`, `importBudgetCodesFromExcel(formData: FormData): Promise<ImportOutcome>`. `ok: false` covers auth failure and "couldn't read the file at all" (missing file, unparseable workbook); `ok: true` always carries a summary — even `successCount: 0` with a full list of `errors` is `ok: true`, since the operation itself completed.

- [ ] **Step 1: Write the failing test**

Add to `tests/integration/budget-codes-actions.test.ts`, inside the same `describe` block:

```ts
  it('imports valid rows and reports per-row errors for invalid ones in the same file', async () => {
    currentEmployee.value = { id: financeEmployeeId, role: 'finance' };
    const { importBudgetCodesFromExcel } = await import('@/lib/budget-codes/actions');
    const XLSX = await import('xlsx');

    const validCode = `BCT-IMPORT-OK-${Date.now()}`;
    const sheet = XLSX.utils.aoa_to_sheet([
      ['預算編號', '部門代碼', '專案代碼', '類別', '年度', '年度預算金額', '負責人工號'],
      [validCode, departmentCode, null, '人事費', '115', 100000, null],
      [`BCT-IMPORT-BADDEPT-${Date.now()}`, 'NOPE-DEPT', null, '人事費', '115', 100000, null],
      [`BCT-IMPORT-NEG-${Date.now()}`, departmentCode, null, '人事費', '115', -500, null],
    ]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, '預算編號');
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

    const formData = new FormData();
    formData.set('file', new File([buffer], 'test.xlsx'));

    const result = await importBudgetCodesFromExcel(formData);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary.successCount).toBe(1);
    expect(result.summary.errors).toHaveLength(2);
    expect(result.summary.errors[0].reason).toBe('部門代碼「NOPE-DEPT」查無此部門');
    expect(result.summary.errors[1].reason).toBe('年度預算金額必須為正數');

    const { data: createdRow } = await admin
      .from('budget_codes')
      .select('id')
      .eq('code', validCode)
      .single();
    createdBudgetCodeIds.push(createdRow!.id);
  });

  it('rejects import from a non-finance employee', async () => {
    currentEmployee.value = { id: staffEmployeeId, role: 'staff' };
    const { importBudgetCodesFromExcel } = await import('@/lib/budget-codes/actions');
    const formData = new FormData();
    formData.set('file', new File([new Uint8Array([1])], 'test.xlsx'));
    const result = await importBudgetCodesFromExcel(formData);
    expect(result).toEqual({ ok: false, error: '只有財會人員可以維護預算編號' });
  });

  it('rejects import when no file is provided', async () => {
    currentEmployee.value = { id: financeEmployeeId, role: 'finance' };
    const { importBudgetCodesFromExcel } = await import('@/lib/budget-codes/actions');
    const formData = new FormData();
    const result = await importBudgetCodesFromExcel(formData);
    expect(result).toEqual({ ok: false, error: '請選擇檔案' });
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `export $(grep -v '^#' .env.local | xargs) && npm test -- tests/integration/budget-codes-actions.test.ts`
Expected: FAIL — `importBudgetCodesFromExcel` is not exported yet.

- [ ] **Step 3: Implement `importBudgetCodesFromExcel`**

Add to `src/lib/budget-codes/actions.ts`:
- Add `import { parseBudgetWorkbook, type ParsedBudgetRow } from '@/lib/budget-codes/parse-budget-workbook';` at the top.
- Add after `deleteBudgetCode`:
```ts
export type ImportRowError = { row: number; reason: string };
export type ImportSummary = { successCount: number; errors: ImportRowError[] };
export type ImportOutcome = { ok: true; summary: ImportSummary } | { ok: false; error: string };

export async function importBudgetCodesFromExcel(formData: FormData): Promise<ImportOutcome> {
  const employee = await getCurrentEmployee(await createSupabaseServerClient());
  if (!employee) return { ok: false, error: '找不到您的員工資料，請聯絡系統管理員' };
  if (employee.role !== 'finance') return { ok: false, error: '只有財會人員可以維護預算編號' };

  const file = formData.get('file');
  if (!(file instanceof File)) return { ok: false, error: '請選擇檔案' };

  let rows: ParsedBudgetRow[];
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    rows = parseBudgetWorkbook(buffer);
  } catch {
    return { ok: false, error: '無法解析此 Excel 檔案，請確認格式是否正確' };
  }

  const db = createSupabaseServiceRoleClient();
  const errors: ImportRowError[] = [];
  let successCount = 0;

  for (const row of rows) {
    if (row.annualBudgetAmount === null) {
      errors.push({ row: row.rowNumber, reason: '年度預算金額必須為正數' });
      continue;
    }
    const result = await upsertOneBudgetCode(db, {
      code: row.code,
      departmentCode: row.departmentCode,
      projectCode: row.projectCode,
      category: row.category,
      fiscalYear: row.fiscalYear,
      annualBudgetAmount: row.annualBudgetAmount,
      ownerEmployeeCode: row.ownerEmployeeCode,
    });
    if (result.ok) {
      successCount += 1;
    } else {
      errors.push({ row: row.rowNumber, reason: result.error });
    }
  }

  revalidatePath('/budget-codes');
  return { ok: true, summary: { successCount, errors } };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `export $(grep -v '^#' .env.local | xargs) && npm test -- tests/integration/budget-codes-actions.test.ts`
Expected: PASS (15 tests).

- [ ] **Step 5: Run the full suite to confirm no regression**

Run: `export $(grep -v '^#' .env.local | xargs) && npm test`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/budget-codes/actions.ts tests/integration/budget-codes-actions.test.ts
git commit -m "feat: add importBudgetCodesFromExcel with partial-success row-level error reporting"
```

---

## Task 5: 預算編號清單查詢（getBudgetCodeList）

**Files:**
- Create: `src/lib/budget-codes/queries.ts`
- Create: `tests/integration/budget-codes-queries.test.ts`

**Interfaces:**
- Consumes: `createSupabaseServerClient`.
- Produces: `BudgetCodeListItem = { id: string; code: string; departmentCode: string | null; projectCode: string | null; category: string; fiscalYear: string; annualBudgetAmount: number | null; ownerEmployeeCode: string | null; ownerName: string | null }`, `getBudgetCodeList(): Promise<BudgetCodeListItem[]>` — sorted by `code`. This reads through the RLS-scoped client (any authenticated employee can already read `budget_codes` per the existing `authenticated_read_budget_codes` policy); the page in Task 6 is what restricts this to finance.

- [ ] **Step 1: Write the failing test**

Read `tests/integration/case-overview-queries.test.ts` first for the `createSupabaseServerClient` mocking style this test follows (mocked to return a service-role test client directly, since there's no real logged-in session in a test).

`tests/integration/budget-codes-queries.test.ts`:
```ts
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

describe.skipIf(!hasIntegrationTestCredentials())('getBudgetCodeList', () => {
  let admin: ReturnType<typeof createServiceRoleTestClient>;
  let departmentId: string;
  let managerId: string;
  let departmentScopedCodeId: string;
  let projectScopedCodeId: string;
  const departmentCode = `BCQ-${Date.now()}`;
  const managerEmployeeCode = `BCQ-MGR-${Date.now()}`;

  beforeAll(async () => {
    admin = createServiceRoleTestClient();
    const { data: anyDept } = await admin.from('departments').select('id').limit(1).single();
    const { data: manager } = await admin
      .from('employees')
      .insert({ employee_code: managerEmployeeCode, name: '測試查詢主管', department_id: anyDept!.id })
      .select()
      .single();
    managerId = manager!.id;
    const { data: dept } = await admin
      .from('departments')
      .insert({ code: departmentCode, name: '測試查詢部門', manager_employee_id: managerId })
      .select()
      .single();
    departmentId = dept!.id;

    const { data: deptCode } = await admin
      .from('budget_codes')
      .insert({
        code: `BCQ-DEPT-${Date.now()}`,
        department_id: departmentId,
        category: '人事費',
        fiscal_year: '115',
        annual_budget_amount: 100000,
        owner_employee_id: managerId,
      })
      .select()
      .single();
    departmentScopedCodeId = deptCode!.id;

    const { data: projCode } = await admin
      .from('budget_codes')
      .insert({
        code: `BCQ-PROJ-${Date.now()}`,
        project_code: 'BCQ-PROJECT-X',
        category: '專案費用',
        fiscal_year: '115',
        annual_budget_amount: 50000,
        owner_employee_id: null,
      })
      .select()
      .single();
    projectScopedCodeId = projCode!.id;
  });

  afterAll(async () => {
    await admin.from('budget_codes').delete().in('id', [departmentScopedCodeId, projectScopedCodeId]);
    await admin.from('employees').delete().eq('id', managerId);
    await admin.from('departments').delete().eq('id', departmentId);
  });

  it('reports the department code and owner name for a department-scoped budget code', async () => {
    const { getBudgetCodeList } = await import('@/lib/budget-codes/queries');
    const list = await getBudgetCodeList();
    const item = list.find((b) => b.id === departmentScopedCodeId);
    expect(item).toEqual({
      id: departmentScopedCodeId,
      code: item!.code,
      departmentCode,
      projectCode: null,
      category: '人事費',
      fiscalYear: '115',
      annualBudgetAmount: 100000,
      ownerEmployeeCode: managerEmployeeCode,
      ownerName: '測試查詢主管',
    });
  });

  it('reports null department code and null owner for a project-scoped budget code with no owner', async () => {
    const { getBudgetCodeList } = await import('@/lib/budget-codes/queries');
    const list = await getBudgetCodeList();
    const item = list.find((b) => b.id === projectScopedCodeId);
    expect(item).toEqual({
      id: projectScopedCodeId,
      code: item!.code,
      departmentCode: null,
      projectCode: 'BCQ-PROJECT-X',
      category: '專案費用',
      fiscalYear: '115',
      annualBudgetAmount: 50000,
      ownerEmployeeCode: null,
      ownerName: null,
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `export $(grep -v '^#' .env.local | xargs) && npm test -- tests/integration/budget-codes-queries.test.ts`
Expected: FAIL — `Cannot find module '@/lib/budget-codes/queries'`.

- [ ] **Step 3: Implement `getBudgetCodeList`**

`src/lib/budget-codes/queries.ts`:
```ts
import { createSupabaseServerClient } from '@/lib/supabase/server';

export type BudgetCodeListItem = {
  id: string;
  code: string;
  departmentCode: string | null;
  projectCode: string | null;
  category: string;
  fiscalYear: string;
  annualBudgetAmount: number | null;
  ownerEmployeeCode: string | null;
  ownerName: string | null;
};

export async function getBudgetCodeList(): Promise<BudgetCodeListItem[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from('budget_codes')
    .select(
      'id, code, project_code, category, fiscal_year, annual_budget_amount, department:departments(code), owner:employees!owner_employee_id(employee_code, name)'
    )
    .order('code');

  return (data ?? []).map((row) => ({
    id: row.id,
    code: row.code,
    departmentCode: (row.department as unknown as { code: string } | null)?.code ?? null,
    projectCode: row.project_code,
    category: row.category,
    fiscalYear: row.fiscal_year,
    annualBudgetAmount: row.annual_budget_amount,
    ownerEmployeeCode:
      (row.owner as unknown as { employee_code: string } | null)?.employee_code ?? null,
    ownerName: (row.owner as unknown as { name: string } | null)?.name ?? null,
  }));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `export $(grep -v '^#' .env.local | xargs) && npm test -- tests/integration/budget-codes-queries.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Run the full suite to confirm no regression**

Run: `export $(grep -v '^#' .env.local | xargs) && npm test`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/budget-codes/queries.ts tests/integration/budget-codes-queries.test.ts
git commit -m "feat: add getBudgetCodeList query for the budget-codes management page"
```

---

## Task 6: `/budget-codes` 頁面（清單、新增/編輯表單、Excel 上傳表單）

**Files:**
- Create: `src/app/budget-codes/page.tsx`
- Create: `src/app/budget-codes/budget-codes-manager.tsx`
- Create: `src/app/budget-codes/budget-code-import-form.tsx`
- Modify: `src/app/dashboard/page.tsx`

**Interfaces:**
- Consumes: `getBudgetCodeList` (Task 5), `upsertBudgetCode`/`deleteBudgetCode`/`importBudgetCodesFromExcel` (Tasks 2-4), `getCurrentEmployee`, `createSupabaseServerClient`.
- Produces: no new exported functions — this is the page itself. Visiting `/budget-codes` as `role !== 'finance'` redirects to `/dashboard`; as no employee, redirects to `/login`.

**Design note:** matches this codebase's established convention that page/component-level UI isn't unit tested (no test exercises `.tsx` page/client-component files directly anywhere in this repo) — this task is manual-QA-verified, per Task 7's checklist. Read `src/app/acceptances/[id]/property-tag-form.tsx` and `src/app/components/attachments-panel.tsx` first for the client-component conventions (state, `useRouter().refresh()` after a successful mutation, inline error display) this task follows.

- [ ] **Step 1: Write the Excel import form component**

`src/app/budget-codes/budget-code-import-form.tsx`:
```tsx
'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { importBudgetCodesFromExcel } from '@/lib/budget-codes/actions';

export function BudgetCodeImportForm() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<{
    successCount: number;
    errors: { row: number; reason: string }[];
  } | null>(null);
  const [uploading, setUploading] = useState(false);

  const onUpload = async () => {
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      setError('請選擇檔案');
      return;
    }
    setError(null);
    setSummary(null);
    setUploading(true);
    const formData = new FormData();
    formData.set('file', file);
    const result = await importBudgetCodesFromExcel(formData);
    setUploading(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setSummary(result.summary);
    router.refresh();
  };

  return (
    <section className="rounded border p-4">
      <h2 className="mb-3 font-semibold">批次匯入（Excel）</h2>
      {error && <p className="mb-2 text-sm text-red-700">{error}</p>}
      {summary && (
        <div className="mb-2 text-sm">
          <p>
            成功 {summary.successCount} 筆、失敗 {summary.errors.length} 筆
          </p>
          {summary.errors.length > 0 && (
            <ul className="mt-1 list-disc pl-6 text-red-700">
              {summary.errors.map((e, i) => (
                <li key={i}>
                  第 {e.row} 列：{e.reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="flex items-center gap-2">
        <input ref={fileInputRef} type="file" accept=".xlsx" className="text-sm" />
        <button
          type="button"
          onClick={onUpload}
          disabled={uploading}
          className="rounded border px-3 py-1 text-sm disabled:opacity-50"
        >
          {uploading ? '匯入中…' : '上傳並匯入'}
        </button>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Write the manager component (create/edit form + list)**

`src/app/budget-codes/budget-codes-manager.tsx`:
```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { deleteBudgetCode, upsertBudgetCode } from '@/lib/budget-codes/actions';
import type { BudgetCodeListItem } from '@/lib/budget-codes/queries';
import { BudgetCodeImportForm } from './budget-code-import-form';

type FormState = {
  code: string;
  departmentCode: string;
  projectCode: string;
  category: string;
  fiscalYear: string;
  annualBudgetAmount: string;
  ownerEmployeeCode: string;
};

const emptyForm: FormState = {
  code: '',
  departmentCode: '',
  projectCode: '',
  category: '',
  fiscalYear: '',
  annualBudgetAmount: '',
  ownerEmployeeCode: '',
};

function toFormState(item: BudgetCodeListItem): FormState {
  return {
    code: item.code,
    departmentCode: item.departmentCode ?? '',
    projectCode: item.projectCode ?? '',
    category: item.category,
    fiscalYear: item.fiscalYear,
    annualBudgetAmount: item.annualBudgetAmount != null ? String(item.annualBudgetAmount) : '',
    ownerEmployeeCode: item.ownerEmployeeCode ?? '',
  };
}

export function BudgetCodesManager({ budgetCodes }: { budgetCodes: BudgetCodeListItem[] }) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const onEdit = (item: BudgetCodeListItem) => {
    setError(null);
    setForm(toFormState(item));
  };

  const onSubmit = async () => {
    setError(null);
    setSaving(true);
    const result = await upsertBudgetCode({
      code: form.code,
      departmentCode: form.departmentCode || null,
      projectCode: form.projectCode || null,
      category: form.category,
      fiscalYear: form.fiscalYear,
      annualBudgetAmount: Number(form.annualBudgetAmount),
      ownerEmployeeCode: form.ownerEmployeeCode || null,
    });
    setSaving(false);
    if (result.ok) {
      setForm(emptyForm);
      router.refresh();
    } else {
      setError(result.error);
    }
  };

  const onDelete = async (id: string) => {
    setError(null);
    setDeletingId(id);
    const result = await deleteBudgetCode(id);
    setDeletingId(null);
    if (result.ok) router.refresh();
    else setError(result.error);
  };

  return (
    <div className="space-y-8">
      <section className="rounded border p-4">
        <h2 className="mb-3 font-semibold">新增／編輯預算編號</h2>
        {error && <p className="mb-2 text-sm text-red-700">{error}</p>}
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm">
            預算編號
            <input
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value })}
              className="mt-1 w-full rounded border px-2 py-1"
            />
          </label>
          <label className="block text-sm">
            類別
            <input
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
              className="mt-1 w-full rounded border px-2 py-1"
            />
          </label>
          <label className="block text-sm">
            部門代碼
            <input
              value={form.departmentCode}
              onChange={(e) => setForm({ ...form, departmentCode: e.target.value })}
              className="mt-1 w-full rounded border px-2 py-1"
            />
          </label>
          <label className="block text-sm">
            專案代碼
            <input
              value={form.projectCode}
              onChange={(e) => setForm({ ...form, projectCode: e.target.value })}
              className="mt-1 w-full rounded border px-2 py-1"
            />
          </label>
          <label className="block text-sm">
            年度
            <input
              value={form.fiscalYear}
              onChange={(e) => setForm({ ...form, fiscalYear: e.target.value })}
              className="mt-1 w-full rounded border px-2 py-1"
            />
          </label>
          <label className="block text-sm">
            年度預算金額
            <input
              type="number"
              value={form.annualBudgetAmount}
              onChange={(e) => setForm({ ...form, annualBudgetAmount: e.target.value })}
              className="mt-1 w-full rounded border px-2 py-1"
            />
          </label>
          <label className="block text-sm">
            負責人工號
            <input
              value={form.ownerEmployeeCode}
              onChange={(e) => setForm({ ...form, ownerEmployeeCode: e.target.value })}
              className="mt-1 w-full rounded border px-2 py-1"
            />
          </label>
        </div>
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={onSubmit}
            disabled={saving}
            className="rounded bg-blue-600 px-3 py-1 text-sm text-white disabled:opacity-50"
          >
            {saving ? '儲存中…' : '儲存'}
          </button>
          {form.code && (
            <button
              type="button"
              onClick={() => setForm(emptyForm)}
              className="rounded border px-3 py-1 text-sm"
            >
              清空（新增模式）
            </button>
          )}
        </div>
      </section>

      <BudgetCodeImportForm />

      <section>
        <h2 className="mb-3 font-semibold">現有預算編號（{budgetCodes.length}）</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="py-1 pr-2">編號</th>
              <th className="py-1 pr-2">部門／專案</th>
              <th className="py-1 pr-2">類別</th>
              <th className="py-1 pr-2">年度</th>
              <th className="py-1 pr-2">金額</th>
              <th className="py-1 pr-2">負責人</th>
              <th className="py-1 pr-2">操作</th>
            </tr>
          </thead>
          <tbody>
            {budgetCodes.map((b) => (
              <tr key={b.id} className="border-b">
                <td className="py-1 pr-2">{b.code}</td>
                <td className="py-1 pr-2">{b.departmentCode ?? b.projectCode}</td>
                <td className="py-1 pr-2">{b.category}</td>
                <td className="py-1 pr-2">{b.fiscalYear}</td>
                <td className="py-1 pr-2">{b.annualBudgetAmount ?? '-'}</td>
                <td className="py-1 pr-2">
                  {b.ownerName ?? <span className="text-amber-700">⚠️ 缺少負責人</span>}
                </td>
                <td className="py-1 pr-2">
                  <button
                    type="button"
                    onClick={() => onEdit(b)}
                    className="mr-2 text-blue-600 underline"
                  >
                    編輯
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(b.id)}
                    disabled={deletingId === b.id}
                    className="text-red-600 underline disabled:opacity-50"
                  >
                    刪除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
```

- [ ] **Step 3: Write the page**

`src/app/budget-codes/page.tsx`:
```tsx
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { getBudgetCodeList } from '@/lib/budget-codes/queries';
import { BudgetCodesManager } from './budget-codes-manager';

export default async function BudgetCodesPage() {
  const supabase = await createSupabaseServerClient();
  const employee = await getCurrentEmployee(supabase);
  if (!employee) redirect('/login');
  if (employee.role !== 'finance') redirect('/dashboard');

  const budgetCodes = await getBudgetCodeList();

  return (
    <main className="mx-auto max-w-5xl space-y-8 p-8">
      <h1 className="text-2xl font-bold">預算編號管理</h1>
      <BudgetCodesManager budgetCodes={budgetCodes} />
    </main>
  );
}
```

- [ ] **Step 4: Add a nav link for finance on the dashboard**

Read `src/app/dashboard/page.tsx` first. Find:
```tsx
        {employee.role === 'admin' && (
          <Link href="/admin/master-data" className="text-blue-600 underline">
            主檔資料總覽
          </Link>
        )}
```
Add immediately after it (still inside the `<nav>`):
```tsx
        {employee.role === 'finance' && (
          <Link href="/budget-codes" className="text-blue-600 underline">
            預算編號管理
          </Link>
        )}
```

- [ ] **Step 5: Run the full suite to confirm no regression**

Run: `export $(grep -v '^#' .env.local | xargs) && npm test`
Expected: all pass (no test exercises these new `.tsx` files directly — matches this codebase's established convention for page/client components; manual QA covers them in Task 7).

- [ ] **Step 6: Commit**

```bash
git add src/app/budget-codes src/app/dashboard/page.tsx
git commit -m "feat: add /budget-codes management page (finance-only)"
```

---

## Task 7: Final verification pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full automated test suite**

Run: `export $(grep -v '^#' .env.local | xargs) && npm test`
Expected: all pass.

- [ ] **Step 2: Run lint and the production build**

Run: `npm run lint`
Expected: clean.

Run: `npm run build`
Expected: succeeds with no type errors.

- [ ] **Step 3: Manual browser QA checklist**

Start the dev server, log in as a real seeded `finance`-role employee (or temporarily set an existing employee's `role` to `finance` in Supabase Studio for testing, then revert), then:
1. Visit `/budget-codes` as a `staff`/`admin` employee → redirected to `/dashboard` (not shown the page).
2. Visit `/budget-codes` as `finance` → page loads, shows the existing budget codes list, any project-scoped code with no owner shows "⚠️ 缺少負責人".
3. Manually create a new department-scoped budget code (real department code, leave 負責人工號 blank) → appears in the list with the department's manager as owner.
4. Manually create a new project-scoped budget code (leave 部門代碼 blank, fill 專案代碼) → appears in the list with no owner (unless one was explicitly given).
5. Click 編輯 on an existing row → form pre-fills with its current values; change 類別 and save → list reflects the change, other fields unchanged.
6. Try creating a budget code with both 部門代碼 and 專案代碼 filled → rejected with the expected error, nothing created.
7. Click 刪除 on a budget code that's not referenced by any purchase request → removed from the list.
8. Try deleting a budget code that IS referenced by an existing purchase request (if one exists in seed data) → rejected with "此預算編號已被請購單使用，無法刪除".
9. Prepare a small `.xlsx` file matching the template (預算編號／部門代碼／專案代碼／類別／年度／年度預算金額／負責人工號 columns) with at least one valid row and one intentionally-broken row (e.g. a nonexistent department code) → upload it → see "成功 N 筆、失敗 M 筆" with the broken row's reason, and confirm the valid row appears in the list while the broken one does not.
10. Confirm `/dashboard` shows "預算編號管理" link only when logged in as `finance`.

- [ ] **Step 4: Commit any final fixups discovered during manual QA, then stop**

If Step 3 surfaces a real bug, fix it as a follow-up commit in whichever task's file it belongs to, re-run that task's tests, and re-run the full suite once more before considering this plan done.

This concludes the 預算編號基礎資料管理（Excel 批次匯入 + 網頁 CRUD）plan.
