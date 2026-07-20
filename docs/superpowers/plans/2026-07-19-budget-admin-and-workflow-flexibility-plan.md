# 預算後台強化與工作流程彈性 實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在既有請購/採購/驗收/費用申請系統上，新增專案實體化的預算後台顯示、免走採購流程的小額費用申請單，以及送出後第一關審核前的自行修改/撤回能力。

**Architecture:** 三個獨立子專案依序實作，各自新增一支 migration + 修改對應的 `actions.ts`/`queries.ts` + 對應頁面元件。子專案 3（表單修改/撤回）刻意重用既有的 `resubmit_*` Postgres RPC function 做「重建簽核鏈」，只是新增不同的守門條件與一支新的「撤回」action，不新增 SQL function。

**Tech Stack:** Next.js 15.5 App Router、Supabase（Postgres + RLS + Auth）、TypeScript strict、Vitest 整合測試（`tests/integration/*.test.ts`，`describe.skipIf(!hasIntegrationTestCredentials())`）。

## Global Constraints

- 所有 server action 必須沿用既有慣例：先 `getCurrentEmployee`，找不到回傳 `{ ok: false, error: '找不到您的員工資料，請聯絡系統管理員' }` 或類似訊息
- 所有新的 DB 寫入邏輯使用 `createSupabaseServiceRoleClient()`，讀取用 `createSupabaseServerClient()`
- 金額欄位一律 `numeric(14, 2)`，TypeScript 端一律 `number`
- 中文錯誤訊息維持現有風格（簡短、直述問題）
- 整合測試檔案放在 `tests/integration/`，沿用 `vi.mock('@/lib/auth/current-employee', ...)`、`vi.mock('@/lib/supabase/server', ...)`、`vi.mock('next/cache', ...)` 三段固定 mock，搭配 `createServiceRoleTestClient()`／`hasIntegrationTestCredentials()`（`tests/integration/supabase-test-client.ts`）
- **任何會員寫入正式 Supabase 資料庫的 migration（尤其是子專案 1 的一次性負數金額修正），執行 `supabase db push` 前必須先讓使用者看過確切會被影響的資料筆數與 SQL 語句，取得明確同意**
- Migration 檔名格式：`supabase/migrations/<14位數字時間戳>_<描述>.sql`，時間戳需比現有最新的 migration 更晚

---

## 子專案 1：預算後台強化（專案實體化 + 顯示修正）

### Task 1: Migration — 新增 `projects` 表、資料遷移、修正現有負數金額

**Files:**
- Create: `supabase/migrations/20260719100000_projects_and_budget_fixes.sql`
- Test: `tests/integration/projects-migration.test.ts`

**Interfaces:**
- Produces: `projects` 表（`id`, `code` unique, `name`, `created_at`）；`budget_codes.project_id`（取代 `budget_codes.project_code`）；`budget_codes_department_or_project_check` 約束改用 `project_id`

- [ ] **Step 1: 寫 migration SQL**

```sql
-- supabase/migrations/20260719100000_projects_and_budget_fixes.sql

create table projects (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  created_at timestamptz not null default now()
);

alter table budget_codes add column project_id uuid references projects(id);

-- 為現有每個不重複的 project_code 建立一筆 projects 列，name 初始值等於 code
insert into projects (code, name)
select distinct project_code, project_code
from budget_codes
where project_code is not null;

update budget_codes bc
set project_id = p.id
from projects p
where bc.project_code = p.code;

alter table budget_codes drop constraint budget_codes_department_or_project_check;
alter table budget_codes drop column project_code;
alter table budget_codes add constraint budget_codes_department_or_project_check
  check ((department_id is not null) <> (project_id is not null));

-- 一次性修正現有匯入資料中的負數金額（純符號問題，非業務語意）
update budget_codes set annual_budget_amount = abs(annual_budget_amount) where annual_budget_amount < 0;
```

- [ ] **Step 2: 執行前跟使用者確認影響筆數**

在本機開發資料庫先跑一次確認會被 `abs()` 修正的筆數：

```bash
export $(grep -v '^#' .env.local | xargs)
node -e "
const { createClient } = require('@supabase/supabase-js');
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
db.from('budget_codes').select('id', { count: 'exact', head: true }).lt('annual_budget_amount', 0)
  .then(({ count }) => console.log('will be corrected:', count));
"
```

把這個筆數（正式環境預期是 152 筆）呈現給使用者，取得明確同意後才對正式資料庫執行 `supabase db push`。

- [ ] **Step 3: 套用 migration（本機開發資料庫）並確認**

```bash
supabase db push
```

Expected: migration 套用成功，`projects` 表存在，`budget_codes.project_code` 欄位已移除，`budget_codes.project_id` 已填值。

- [ ] **Step 4: 寫整合測試驗證 migration 結果**

```ts
// tests/integration/projects-migration.test.ts
import { describe, expect, it } from 'vitest';
import { createServiceRoleTestClient, hasIntegrationTestCredentials } from './supabase-test-client';

describe.skipIf(!hasIntegrationTestCredentials())('projects migration', () => {
  it('has no remaining negative annual_budget_amount rows', async () => {
    const admin = createServiceRoleTestClient();
    const { count } = await admin
      .from('budget_codes')
      .select('id', { count: 'exact', head: true })
      .lt('annual_budget_amount', 0);
    expect(count).toBe(0);
  });

  it('every project-scoped budget code resolves to a projects row with a matching code', async () => {
    const admin = createServiceRoleTestClient();
    const { data: rows } = await admin
      .from('budget_codes')
      .select('project_id, project:projects(code)')
      .not('project_id', 'is', null);
    for (const row of rows ?? []) {
      expect(row.project).not.toBeNull();
    }
  });

  it('rejects a budget_codes row with both department_id and project_id set', async () => {
    const admin = createServiceRoleTestClient();
    const { data: anyDept } = await admin.from('departments').select('id').limit(1).single();
    const { data: anyProject } = await admin.from('projects').select('id').limit(1).maybeSingle();
    if (!anyProject) return;
    const { error } = await admin.from('budget_codes').insert({
      code: `MIGTEST-${Date.now()}`,
      department_id: anyDept!.id,
      project_id: anyProject.id,
      category: '測試',
      fiscal_year: '115',
      annual_budget_amount: 1000,
    });
    expect(error).not.toBeNull();
  });
});
```

- [ ] **Step 5: 執行測試**

```bash
export $(grep -v '^#' .env.local | xargs)
npx vitest run tests/integration/projects-migration.test.ts
```

Expected: PASS（3 個測試皆通過）

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260719100000_projects_and_budget_fixes.sql tests/integration/projects-migration.test.ts
git commit -m "feat: add projects table, migrate project_code, fix negative budget amounts"
```

---

### Task 2: 新增 `projects` 模組，更新 `budget-codes` 的 queries/actions 使用 `project_id`

**Files:**
- Create: `src/lib/projects/queries.ts`
- Create: `src/lib/projects/actions.ts`
- Modify: `src/lib/budget-codes/queries.ts`
- Modify: `src/lib/budget-codes/actions.ts:9-79` (`BudgetCodeInput`, `upsertOneBudgetCode`)
- Test: `tests/integration/projects-actions.test.ts`
- Test: Modify `tests/integration/budget-codes-actions.test.ts` (project-scoped 測試案例需改用真實存在的 project code)

**Interfaces:**
- Produces: `getProjectList(): Promise<ProjectListItem[]>`（`ProjectListItem = { id: string; code: string; name: string }`）；`upsertProject(input: ProjectInput): Promise<UpsertProjectResult>`（`ProjectInput = { code: string; name: string }`，`UpsertProjectResult = { ok: true; projectId: string } | { ok: false; error: string }`）
- Consumes（Task 3 會用到）：以上兩個函式，以及 `BudgetCodeListItem` 新增的 `departmentName`/`projectName` 欄位

- [ ] **Step 1: 寫 `src/lib/projects/queries.ts`**

```ts
import { createSupabaseServerClient } from '@/lib/supabase/server';

export type ProjectListItem = {
  id: string;
  code: string;
  name: string;
};

export async function getProjectList(): Promise<ProjectListItem[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from('projects').select('id, code, name').order('code');
  return data ?? [];
}
```

- [ ] **Step 2: 寫 `src/lib/projects/actions.ts`**

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getCurrentEmployee } from '@/lib/auth/current-employee';

export type ProjectInput = {
  code: string;
  name: string;
};

export type UpsertProjectResult = { ok: true; projectId: string } | { ok: false; error: string };

export async function upsertProject(input: ProjectInput): Promise<UpsertProjectResult> {
  const employee = await getCurrentEmployee(await createSupabaseServerClient());
  if (!employee) return { ok: false, error: '找不到您的員工資料，請聯絡系統管理員' };
  if (employee.role !== 'finance') return { ok: false, error: '只有財會人員可以維護專案' };

  if (!input.code.trim()) return { ok: false, error: '專案代碼為必填' };
  if (!input.name.trim()) return { ok: false, error: '專案名稱為必填' };

  const db = createSupabaseServiceRoleClient();
  const { data, error } = await db
    .from('projects')
    .upsert({ code: input.code, name: input.name }, { onConflict: 'code' })
    .select('id')
    .single();
  if (error || !data) return { ok: false, error: '寫入專案失敗' };

  revalidatePath('/budget-codes');
  return { ok: true, projectId: data.id };
}
```

- [ ] **Step 3: 寫整合測試**

```ts
// tests/integration/projects-actions.test.ts
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createServiceRoleTestClient, hasIntegrationTestCredentials } from './supabase-test-client';

const currentEmployee = vi.hoisted(() => ({ value: null as null | { id: string; role: string } }));
vi.mock('@/lib/auth/current-employee', () => ({
  getCurrentEmployee: async () => currentEmployee.value,
}));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({}) }));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

describe.skipIf(!hasIntegrationTestCredentials())('projects actions', () => {
  let admin: ReturnType<typeof createServiceRoleTestClient>;
  let financeEmployeeId: string;
  let staffEmployeeId: string;
  const createdProjectIds: string[] = [];

  beforeAll(async () => {
    admin = createServiceRoleTestClient();
    const { data: anyDept } = await admin.from('departments').select('id').limit(1).single();
    const { data: financeEmp } = await admin
      .from('employees')
      .insert({ employee_code: `PJT-FIN-${Date.now()}`, name: '測試財會人員', department_id: anyDept!.id, role: 'finance' })
      .select()
      .single();
    financeEmployeeId = financeEmp!.id;
    const { data: staffEmp } = await admin
      .from('employees')
      .insert({ employee_code: `PJT-STAFF-${Date.now()}`, name: '測試一般員工', department_id: anyDept!.id, role: 'staff' })
      .select()
      .single();
    staffEmployeeId = staffEmp!.id;
  });

  afterAll(async () => {
    if (createdProjectIds.length > 0) {
      await admin.from('projects').delete().in('id', createdProjectIds);
    }
    await admin.from('employees').delete().in('id', [financeEmployeeId, staffEmployeeId]);
  });

  it('rejects a non-finance employee', async () => {
    currentEmployee.value = { id: staffEmployeeId, role: 'staff' };
    const { upsertProject } = await import('@/lib/projects/actions');
    const result = await upsertProject({ code: `PJT-CODE-${Date.now()}`, name: '測試專案' });
    expect(result).toEqual({ ok: false, error: '只有財會人員可以維護專案' });
  });

  it('creates a project', async () => {
    currentEmployee.value = { id: financeEmployeeId, role: 'finance' };
    const { upsertProject } = await import('@/lib/projects/actions');
    const code = `PJT-CODE-${Date.now()}`;
    const result = await upsertProject({ code, name: '測試專案 A' });
    expect(result.ok).toBe(true);
    if (result.ok) createdProjectIds.push(result.projectId);

    const { data: row } = await admin.from('projects').select('name').eq('code', code).single();
    expect(row).toEqual({ name: '測試專案 A' });
  });

  it('updates an existing project on repeated upsert rather than creating a duplicate', async () => {
    currentEmployee.value = { id: financeEmployeeId, role: 'finance' };
    const { upsertProject } = await import('@/lib/projects/actions');
    const code = `PJT-UPDATE-${Date.now()}`;
    const first = await upsertProject({ code, name: '舊名稱' });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    createdProjectIds.push(first.projectId);

    const second = await upsertProject({ code, name: '新名稱' });
    expect(second).toEqual({ ok: true, projectId: first.projectId });

    const { count } = await admin.from('projects').select('id', { count: 'exact', head: true }).eq('code', code);
    expect(count).toBe(1);
  });
});
```

- [ ] **Step 4: 執行測試確認新測試通過**

```bash
export $(grep -v '^#' .env.local | xargs)
npx vitest run tests/integration/projects-actions.test.ts
```

Expected: PASS

- [ ] **Step 5: 更新 `src/lib/budget-codes/queries.ts`**

```ts
import { createSupabaseServerClient } from '@/lib/supabase/server';

export type BudgetCodeListItem = {
  id: string;
  code: string;
  departmentCode: string | null;
  departmentName: string | null;
  projectCode: string | null;
  projectName: string | null;
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
      'id, code, category, fiscal_year, annual_budget_amount, department:departments(code, name), project:projects(code, name), owner:employees!owner_employee_id(employee_code, name)'
    )
    .order('code');

  return (data ?? []).map((row) => ({
    id: row.id,
    code: row.code,
    departmentCode: (row.department as unknown as { code: string; name: string } | null)?.code ?? null,
    departmentName: (row.department as unknown as { code: string; name: string } | null)?.name ?? null,
    projectCode: (row.project as unknown as { code: string; name: string } | null)?.code ?? null,
    projectName: (row.project as unknown as { code: string; name: string } | null)?.name ?? null,
    category: row.category,
    fiscalYear: row.fiscal_year,
    annualBudgetAmount: row.annual_budget_amount,
    ownerEmployeeCode:
      (row.owner as unknown as { employee_code: string } | null)?.employee_code ?? null,
    ownerName: (row.owner as unknown as { name: string } | null)?.name ?? null,
  }));
}
```

- [ ] **Step 6: 更新 `src/lib/budget-codes/actions.ts` 的 `upsertOneBudgetCode`（`project_code` 改為查找既有 `projects` 並使用 `project_id`）**

把 `src/lib/budget-codes/actions.ts` 第 21-79 行整段換成：

```ts
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
  let projectId: string | null = null;
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
  } else {
    const { data: project } = await db
      .from('projects')
      .select('id')
      .eq('code', input.projectCode)
      .maybeSingle();
    if (!project) {
      return { ok: false, error: `專案代碼「${input.projectCode}」查無此專案，請先在專案管理新增` };
    }
    projectId = project.id;
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
        project_id: projectId,
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
```

（`BudgetCodeInput` 型別本身不變，仍以 `projectCode: string | null` 作為外部輸入介面，函式內部改為查找 `projects.id`。）

- [ ] **Step 7: 更新既有測試 `tests/integration/budget-codes-actions.test.ts`，讓「project-scoped budget code」案例改用真實存在的 project**

把第 17-19 行的變數宣告區塊新增 `projectCode`/`projectId`，並在 `beforeAll`（第 25-80 行結尾前）新增建立一筆 project：

```ts
    projectCode = `BCT-PROJ-${Date.now()}`;
    const { data: project } = await admin
      .from('projects')
      .insert({ code: projectCode, name: '測試專案' })
      .select()
      .single();
    projectId = project!.id;
```

在 `afterAll`（第 82-92 行）新增清理：

```ts
    await admin.from('projects').delete().eq('id', projectId);
```

把第 138-164 行「creates a project-scoped budget code」測試中的 `projectCode: '115BD999'` 改成 `projectCode`（沿用上面建立的變數），並把第 154-163 行的驗證改為查 `project_id`：

```ts
    const { data: row } = await admin
      .from('budget_codes')
      .select('department_id, project_id, owner_employee_id')
      .eq('code', code)
      .single();
    expect(row).toEqual({
      department_id: null,
      project_id: projectId,
      owner_employee_id: customOwnerId,
    });
```

把第 166-179 行「rejects when both」測試中的 `projectCode: '115BD999'` 同樣改成 `projectCode`。

- [ ] **Step 8: 執行完整 budget-codes 測試**

```bash
export $(grep -v '^#' .env.local | xargs)
npx vitest run tests/integration/budget-codes-actions.test.ts
```

Expected: PASS（全部測試通過，無因 schema 變更產生的失敗）

- [ ] **Step 9: Commit**

```bash
git add src/lib/projects/ src/lib/budget-codes/queries.ts src/lib/budget-codes/actions.ts tests/integration/projects-actions.test.ts tests/integration/budget-codes-actions.test.ts
git commit -m "feat: add projects module, switch budget_codes to project_id lookup"
```

---

### Task 3: `budget-codes-manager` UI — 專案下拉選單、專案管理區塊、部門/專案名稱顯示

**Files:**
- Create: `src/app/budget-codes/project-manager.tsx`
- Modify: `src/app/budget-codes/budget-codes-manager.tsx`
- Modify: `src/app/budget-codes/page.tsx`

**Interfaces:**
- Consumes: `getProjectList()`（Task 2）、`upsertProject()`（Task 2）、`BudgetCodeListItem`（Task 2，含 `departmentName`/`projectName`）
- Produces: `ProjectManager` 元件（`{ projects: ProjectListItem[] }` props）

- [ ] **Step 1: 寫 `src/app/budget-codes/project-manager.tsx`**

```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { upsertProject } from '@/lib/projects/actions';
import type { ProjectListItem } from '@/lib/projects/queries';

export function ProjectManager({ projects }: { projects: ProjectListItem[] }) {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const onSubmit = async () => {
    setError(null);
    setSaving(true);
    const result = await upsertProject({ code, name });
    setSaving(false);
    if (result.ok) {
      setCode('');
      setName('');
      router.refresh();
    } else {
      setError(result.error);
    }
  };

  return (
    <section className="rounded border p-4">
      <h2 className="mb-3 font-semibold">專案管理</h2>
      {error && <p className="mb-2 text-sm text-red-700">{error}</p>}
      <div className="flex gap-2">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="專案代碼"
          className="rounded border px-2 py-1"
        />
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="專案名稱"
          className="flex-1 rounded border px-2 py-1"
        />
        <button
          type="button"
          onClick={onSubmit}
          disabled={saving}
          className="rounded bg-blue-600 px-3 py-1 text-sm text-white disabled:opacity-50"
        >
          {saving ? '儲存中…' : '新增／更新專案'}
        </button>
      </div>
      <ul className="mt-3 space-y-1 text-sm text-gray-600">
        {projects.map((p) => (
          <li key={p.id}>
            {p.code}｜{p.name}
          </li>
        ))}
      </ul>
    </section>
  );
}
```

- [ ] **Step 2: 更新 `src/app/budget-codes/budget-codes-manager.tsx`**

把檔案開頭的 import 區塊（第 1-7 行）換成：

```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { deleteBudgetCode, upsertBudgetCode } from '@/lib/budget-codes/actions';
import type { BudgetCodeListItem } from '@/lib/budget-codes/queries';
import type { ProjectListItem } from '@/lib/projects/queries';
import { BudgetCodeImportForm } from './budget-code-import-form';
import { ProjectManager } from './project-manager';
```

把元件簽名（原第 41 行）改為接收 `projects` prop：

```tsx
export function BudgetCodesManager({
  budgetCodes,
  projects,
}: {
  budgetCodes: BudgetCodeListItem[];
  projects: ProjectListItem[];
}) {
```

把「專案代碼」欄位（原第 113-120 行的 `<input>`）換成下拉選單：

```tsx
          <label className="block text-sm">
            專案代碼
            <select
              value={form.projectCode}
              onChange={(e) => setForm({ ...form, projectCode: e.target.value })}
              className="mt-1 w-full rounded border px-2 py-1"
            >
              <option value="">（不指定專案）</option>
              {projects.map((p) => (
                <option key={p.id} value={p.code}>
                  {p.code}｜{p.name}
                </option>
              ))}
            </select>
          </label>
```

在 `<BudgetCodeImportForm />`（原第 168 行）後面加上 `<ProjectManager projects={projects} />`：

```tsx
      <BudgetCodeImportForm />

      <ProjectManager projects={projects} />
```

把表格內顯示部門/專案的儲存格（原第 188 行 `<td className="py-1 pr-2">{b.departmentCode ?? b.projectCode}</td>`）改為顯示名稱：

```tsx
                <td className="py-1 pr-2">{b.departmentName ?? b.projectName ?? '-'}</td>
```

- [ ] **Step 3: 更新 `src/app/budget-codes/page.tsx` 帶入 `projects`**

```tsx
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { getBudgetCodeList } from '@/lib/budget-codes/queries';
import { getProjectList } from '@/lib/projects/queries';
import { BudgetCodesManager } from './budget-codes-manager';

export default async function BudgetCodesPage() {
  const supabase = await createSupabaseServerClient();
  const employee = await getCurrentEmployee(supabase);
  if (!employee) redirect('/login');
  if (employee.role !== 'finance') redirect('/dashboard');

  const [budgetCodes, projects] = await Promise.all([getBudgetCodeList(), getProjectList()]);

  return (
    <main className="mx-auto max-w-5xl space-y-8 p-8">
      <h1 className="text-2xl font-bold">預算編號管理</h1>
      <BudgetCodesManager budgetCodes={budgetCodes} projects={projects} />
    </main>
  );
}
```

- [ ] **Step 4: 執行 typecheck 與 lint**

```bash
npm run typecheck
npm run lint
```

Expected: 皆為乾淨（0 錯誤）

- [ ] **Step 5: 手動瀏覽器 QA（真人 QA，自動化測試無法涵蓋 UI 顯示正確性）**

用 Browser 工具開發模式登入一位 `role='finance'` 的帳號，前往 `/budget-codes`：
- 確認「專案管理」區塊可以新增一筆專案（代碼+名稱）
- 確認新增/編輯預算編號時，「專案代碼」變成下拉選單，可選到剛新增的專案
- 確認主表格「部門／專案」欄位顯示的是名稱而非代碼

- [ ] **Step 6: Commit**

```bash
git add src/app/budget-codes/
git commit -m "feat: add project dropdown and management UI to budget-codes page"
```

---

### Task 4: 修正 `importBudgetCodesFromExcel` 匯入邏輯，避免再存入負數金額

**Files:**
- Modify: `src/lib/budget-codes/actions.ts:138-157`
- Test: Modify `tests/integration/budget-codes-actions.test.ts`（新增一筆負數匯入案例）

**Interfaces:**
- Consumes: 無新增介面，僅修改既有函式內部邏輯

- [ ] **Step 1: 修改 `importBudgetCodesFromExcel` 的迴圈，對金額取絕對值**

把 `src/lib/budget-codes/actions.ts` 第 138-157 行的迴圈內容換成：

```ts
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
      annualBudgetAmount: Math.abs(row.annualBudgetAmount),
      ownerEmployeeCode: row.ownerEmployeeCode,
    });
    if (result.ok) {
      successCount += 1;
    } else {
      errors.push({ row: row.rowNumber, reason: result.error });
    }
  }
```

- [ ] **Step 2: 在既有匯入測試中新增一筆負數金額案例**

在 `tests/integration/budget-codes-actions.test.ts` 第 368-401 行「imports valid rows and reports per-row errors」測試裡，把 `aoa_to_sheet` 的資料陣列（第 374-379 行）新增一列負數金額且應成功匯入的案例：

```ts
    const negativeAmountCode = `BCT-IMPORT-NEG2POS-${Date.now()}`;
    const sheet = XLSX.utils.aoa_to_sheet([
      ['預算編號', '部門代碼', '專案代碼', '類別', '年度', '年度預算金額', '負責人工號'],
      [validCode, departmentCode, null, '人事費', '115', 100000, null],
      [`BCT-IMPORT-BADDEPT-${Date.now()}`, 'NOPE-DEPT', null, '人事費', '115', 100000, null],
      [`BCT-IMPORT-NEG-${Date.now()}`, departmentCode, null, '人事費', '115', -500, null],
      [negativeAmountCode, departmentCode, null, '人事費', '115', -8000, null],
    ]);
```

在同一測試最後（第 388-400 行之後）新增驗證負數金額被轉成正數存入：

```ts
    expect(result.summary.successCount).toBe(2);
    expect(result.summary.errors).toHaveLength(2);

    const { data: negRow } = await admin
      .from('budget_codes')
      .select('id, annual_budget_amount')
      .eq('code', negativeAmountCode)
      .single();
    createdBudgetCodeIds.push(negRow!.id);
    expect(Number(negRow!.annual_budget_amount)).toBe(8000);
```

（`successCount` 從原本的 `1` 改為 `2`，因為新增的這筆是「值為 -8000 但仍是有效數字」的合法列，跟 `row.annualBudgetAmount === null` 那種「非數字」的無效列不同——原本第 378 行的 `-500` 案例維持原樣繼續被解析為合法負數並成功匯入，不再算是錯誤列。因此需要同步修正第 391-393 行原本預期 `errors` 為 2 筆、其中第二筆是「年度預算金額必須為正數」的斷言：把原本斷言 `-500` 那一列會產生 `'年度預算金額必須為正數'` 錯誤的期待整段移除，因為 `Math.abs()` 修正後 `-500` 也會成功匯入為正數 500，不再是錯誤列。)

把第 388-393 行原本的斷言整段換成：

```ts
    const result = await importBudgetCodesFromExcel(formData);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary.successCount).toBe(3);
    expect(result.summary.errors).toHaveLength(1);
    expect(result.summary.errors[0].reason).toBe('部門代碼「NOPE-DEPT」查無此部門');

    const { data: negOriginalRow } = await admin
      .from('budget_codes')
      .select('id, annual_budget_amount')
      .eq('code', `BCT-IMPORT-NEG-${Date.now()}`)
      .maybeSingle();
```

注意：上面 `BCT-IMPORT-NEG-${Date.now()}` 這個查詢寫法有時間戳不一致的風險（`Date.now()` 在建立資料跟查詢時算出來的值不同），改為在建立資料前先把每個 code 存成變數，避免這個問題。把整個測試改寫為：

```ts
  it('imports valid rows and reports per-row errors for invalid ones in the same file', async () => {
    currentEmployee.value = { id: financeEmployeeId, role: 'finance' };
    const { importBudgetCodesFromExcel } = await import('@/lib/budget-codes/actions');
    const XLSX = await import('xlsx');

    const validCode = `BCT-IMPORT-OK-${Date.now()}`;
    const badDeptCode = `BCT-IMPORT-BADDEPT-${Date.now()}`;
    const negativeCode = `BCT-IMPORT-NEG-${Date.now()}`;
    const sheet = XLSX.utils.aoa_to_sheet([
      ['預算編號', '部門代碼', '專案代碼', '類別', '年度', '年度預算金額', '負責人工號'],
      [validCode, departmentCode, null, '人事費', '115', 100000, null],
      [badDeptCode, 'NOPE-DEPT', null, '人事費', '115', 100000, null],
      [negativeCode, departmentCode, null, '人事費', '115', -8000, null],
    ]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, '預算編號');
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

    const formData = new FormData();
    formData.set('file', new File([new Uint8Array(buffer)], 'test.xlsx'));

    const result = await importBudgetCodesFromExcel(formData);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary.successCount).toBe(2);
    expect(result.summary.errors).toHaveLength(1);
    expect(result.summary.errors[0].reason).toBe('部門代碼「NOPE-DEPT」查無此部門');

    const { data: createdRow } = await admin
      .from('budget_codes')
      .select('id')
      .eq('code', validCode)
      .single();
    createdBudgetCodeIds.push(createdRow!.id);

    const { data: negRow } = await admin
      .from('budget_codes')
      .select('id, annual_budget_amount')
      .eq('code', negativeCode)
      .single();
    createdBudgetCodeIds.push(negRow!.id);
    expect(Number(negRow!.annual_budget_amount)).toBe(8000);
  });
```

- [ ] **Step 3: 執行測試**

```bash
export $(grep -v '^#' .env.local | xargs)
npx vitest run tests/integration/budget-codes-actions.test.ts
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/lib/budget-codes/actions.ts tests/integration/budget-codes-actions.test.ts
git commit -m "fix: take absolute value of amounts on budget code Excel import"
```

---

## 子專案 2：免走採購流程的費用申請單（低於 1 萬元）

### Task 5: Migration — `expense_requests` 可脫離採購單、`procurement_cases` 新增案件類型

**Files:**
- Create: `supabase/migrations/20260719110000_standalone_expense_requests.sql`
- Test: `tests/integration/standalone-expense-migration.test.ts`

**Interfaces:**
- Produces: `expense_requests.purchase_order_id`（nullable）、`expense_requests.budget_code_id`（nullable，standalone 專用）、`expense_request_items.purchase_order_item_id`（nullable，standalone 專用）、`procurement_cases.case_type`（`'standard' | 'standalone_expense'`，預設 `'standard'`）

- [ ] **Step 1: 寫 migration SQL**

```sql
-- supabase/migrations/20260719110000_standalone_expense_requests.sql

alter table expense_requests alter column purchase_order_id drop not null;
alter table expense_requests add column budget_code_id uuid references budget_codes(id);
alter table expense_requests add constraint expense_requests_po_xor_budget_code_check
  check ((purchase_order_id is not null) or (budget_code_id is not null));

alter table expense_request_items alter column purchase_order_item_id drop not null;

alter table procurement_cases add column case_type text not null default 'standard'
  check (case_type in ('standard', 'standalone_expense'));
```

- [ ] **Step 2: 套用 migration（本機開發資料庫）**

```bash
supabase db push
```

Expected: migration 套用成功

- [ ] **Step 3: 寫整合測試驗證約束行為**

```ts
// tests/integration/standalone-expense-migration.test.ts
import { afterEach, describe, expect, it } from 'vitest';
import { createServiceRoleTestClient, hasIntegrationTestCredentials } from './supabase-test-client';

describe.skipIf(!hasIntegrationTestCredentials())('standalone expense requests migration', () => {
  const admin = createServiceRoleTestClient();
  const createdCaseIds: string[] = [];

  afterEach(async () => {
    if (createdCaseIds.length > 0) {
      await admin.from('procurement_cases').delete().in('id', createdCaseIds);
      createdCaseIds.length = 0;
    }
  });

  it('defaults case_type to standard on existing insert path', async () => {
    const { data: caseNumber } = await admin.rpc('next_case_number');
    const { data: pcase } = await admin
      .from('procurement_cases')
      .insert({ case_number: caseNumber, created_by_employee_id: (await admin.from('employees').select('id').limit(1).single()).data!.id })
      .select()
      .single();
    createdCaseIds.push(pcase!.id);
    expect(pcase!.case_type).toBe('standard');
  });

  it('rejects an expense_requests row with neither purchase_order_id nor budget_code_id', async () => {
    const { data: caseNumber } = await admin.rpc('next_case_number');
    const { data: anyEmployee } = await admin.from('employees').select('id, department_id').limit(1).single();
    const { data: pcase } = await admin
      .from('procurement_cases')
      .insert({ case_number: caseNumber, created_by_employee_id: anyEmployee!.id, case_type: 'standalone_expense' })
      .select()
      .single();
    createdCaseIds.push(pcase!.id);

    const { error } = await admin.from('expense_requests').insert({
      procurement_case_id: pcase!.id,
      applicant_employee_id: anyEmployee!.id,
      department_id: anyEmployee!.department_id,
      budget_owner_employee_id: anyEmployee!.id,
      payee_type: 'employee',
      payment_method: '匯款',
      total_amount: 1000,
    });
    expect(error).not.toBeNull();
  });
});
```

- [ ] **Step 4: 執行測試**

```bash
export $(grep -v '^#' .env.local | xargs)
npx vitest run tests/integration/standalone-expense-migration.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260719110000_standalone_expense_requests.sql tests/integration/standalone-expense-migration.test.ts
git commit -m "feat: allow expense_requests to stand alone without a purchase order"
```

---

### Task 6: `createStandaloneExpenseRequest` server action

**Files:**
- Modify: `src/lib/expense-requests/actions.ts`
- Test: `tests/integration/standalone-expense-actions.test.ts`

**Interfaces:**
- Consumes: `buildApprovalChainForForm`（`src/lib/approval/build-chain.ts`）、`validateExpenseRequestInput`（`src/lib/expense-requests/validate.ts`）、`computeDefaultExpectedPaymentDate`/`computePaymentBatchDate`（`src/lib/procurement/payment-batch.ts`）、`notifyAndEmail`（`src/lib/notifications/notify.ts`）
- Produces: `STANDALONE_EXPENSE_REQUEST_LIMIT = 10000`（exported const）；`NewStandaloneExpenseRequest`（型別）；`createStandaloneExpenseRequest(input: NewStandaloneExpenseRequest): Promise<CreateResult>`（沿用既有 `CreateResult` 型別）

- [ ] **Step 1: 在 `src/lib/expense-requests/actions.ts` 新增型別與常數**

在既有 `NewExpenseRequest` 型別（第 15-26 行）之後新增：

```ts
export const STANDALONE_EXPENSE_REQUEST_LIMIT = 10000;

export type NewStandaloneExpenseRequestItem = {
  description: string;
  amount: number;
};

export type NewStandaloneExpenseRequest = {
  budgetCodeId: string;
  payeeType: 'employee' | 'supplier';
  payeeSupplierId: string | null;
  paymentMethod: string;
  bankName: string | null;
  bankAccount: string | null;
  accountName: string | null;
  invoiceMonth: string | null;
  expectedPaymentDate: string | null;
  items: NewStandaloneExpenseRequestItem[];
};
```

- [ ] **Step 2: 新增 `createStandaloneExpenseRequest` 函式**

在既有 `createExpenseRequest` 函式（結束於第 235 行）之後新增：

```ts
export async function createStandaloneExpenseRequest(
  input: NewStandaloneExpenseRequest
): Promise<CreateResult> {
  const employee = await getCurrentEmployee(await createSupabaseServerClient());
  if (!employee) return { ok: false, error: '找不到您的員工資料，請聯絡系統管理員' };

  const db = createSupabaseServiceRoleClient();

  if (input.items.length === 0) {
    return { ok: false, error: '費用申請單至少需要一個明細項次' };
  }
  const totalAmount = input.items.reduce((sum, i) => sum + i.amount, 0);
  if (totalAmount >= STANDALONE_EXPENSE_REQUEST_LIMIT) {
    return {
      ok: false,
      error: `免走採購流程的費用申請單總金額須低於 NT$ ${STANDALONE_EXPENSE_REQUEST_LIMIT.toLocaleString()}，請改用一般採購流程建立`,
    };
  }

  const { data: budgetCode } = await db
    .from('budget_codes')
    .select('id, owner_employee_id')
    .eq('id', input.budgetCodeId)
    .maybeSingle();
  if (!budgetCode) return { ok: false, error: '選取的預算編號無效' };
  if (!budgetCode.owner_employee_id) {
    return { ok: false, error: '選取的預算編號沒有指定預算負責人' };
  }

  const validation = validateExpenseRequestInput({
    payeeType: input.payeeType,
    payeeSupplierId: input.payeeSupplierId,
    bankAccount: input.bankAccount,
    includedItemCount: input.items.length,
  });
  if (!validation.ok) return { ok: false, error: validation.error };

  const referenceDate = new Date().toISOString().slice(0, 10);
  const expectedPaymentDate =
    input.expectedPaymentDate ??
    (input.invoiceMonth ? computeDefaultExpectedPaymentDate(input.invoiceMonth) : null);
  const batch = computePaymentBatchDate({
    payeeType: input.payeeType,
    referenceDate,
    expectedPaymentDate,
    invoiceMonth: input.invoiceMonth,
  });

  const chainResult = await buildApprovalChainForForm(db, {
    applicantEmployeeId: employee.id,
    departmentId: employee.departmentId,
    budgetOwnerEmployeeId: budgetCode.owner_employee_id,
    totalAmount,
  });
  if (!chainResult.ok) return { ok: false, error: chainResult.error };
  const chain = chainResult.chain;

  const { data: caseNumber, error: numError } = await db.rpc('next_case_number');
  if (numError || !caseNumber) return { ok: false, error: '產生案件單號失敗' };
  const { data: pcase, error: caseError } = await db
    .from('procurement_cases')
    .insert({
      case_number: caseNumber,
      created_by_employee_id: employee.id,
      case_type: 'standalone_expense',
    })
    .select()
    .single();
  if (caseError || !pcase) return { ok: false, error: '建立案件失敗' };

  const cleanup = async (expenseRequestId?: string) => {
    if (expenseRequestId) {
      await db
        .from('approval_steps')
        .delete()
        .eq('form_type', 'expense_request')
        .eq('form_id', expenseRequestId);
      await db
        .from('notifications')
        .delete()
        .eq('form_type', 'expense_request')
        .eq('form_id', expenseRequestId);
      await db.from('expense_requests').delete().eq('id', expenseRequestId);
    }
    await db.from('procurement_cases').delete().eq('id', pcase.id);
  };

  const isAutoApproved = chain.length === 0;
  const { data: expenseRequest, error: expenseError } = await db
    .from('expense_requests')
    .insert({
      procurement_case_id: pcase.id,
      purchase_order_id: null,
      budget_code_id: input.budgetCodeId,
      applicant_employee_id: employee.id,
      department_id: employee.departmentId,
      budget_owner_employee_id: budgetCode.owner_employee_id,
      payee_type: input.payeeType,
      payee_supplier_id: input.payeeType === 'supplier' ? input.payeeSupplierId : null,
      payment_method: input.paymentMethod,
      bank_name: input.payeeType === 'employee' ? input.bankName : null,
      bank_account: input.payeeType === 'employee' ? input.bankAccount : null,
      account_name: input.payeeType === 'employee' ? input.accountName : null,
      invoice_month: input.invoiceMonth,
      expected_payment_date: expectedPaymentDate,
      payment_batch_date: batch.batchDate,
      total_amount: totalAmount,
      status: isAutoApproved ? 'approved' : 'pending_approval',
      current_step_order: isAutoApproved ? null : 1,
    })
    .select()
    .single();
  if (expenseError || !expenseRequest) {
    await cleanup();
    return { ok: false, error: '建立費用申請單失敗' };
  }

  const { error: itemsError } = await db.from('expense_request_items').insert(
    input.items.map((i, idx) => ({
      expense_request_id: expenseRequest.id,
      line_no: idx + 1,
      purchase_order_item_id: null,
      description: i.description,
      amount: i.amount,
    }))
  );
  if (itemsError) {
    await cleanup(expenseRequest.id);
    return { ok: false, error: '建立費用明細失敗' };
  }

  if (!isAutoApproved) {
    const { error: stepsError } = await db.from('approval_steps').insert(
      chain.map((step, idx) => ({
        form_type: 'expense_request',
        form_id: expenseRequest.id,
        step_order: idx + 1,
        approver_employee_id: step.approverEmployeeId,
        approver_role: step.approverRole,
      }))
    );
    if (stepsError) {
      await cleanup(expenseRequest.id);
      return { ok: false, error: '建立簽核流程失敗' };
    }

    const notifyResult = await notifyAndEmail(db, {
      recipientEmployeeId: chain[0].approverEmployeeId,
      type: 'approval_requested',
      formType: 'expense_request',
      formId: expenseRequest.id,
      caseNumber,
      message: `費用申請單 ${caseNumber} 待您簽核`,
    });
    if (!notifyResult.ok) {
      await cleanup(expenseRequest.id);
      return { ok: false, error: '建立通知失敗' };
    }
  }

  revalidatePath('/expense-requests');
  revalidatePath('/approvals');
  return {
    ok: true,
    expenseRequestId: expenseRequest.id,
    caseNumber,
    paymentBatchDate: batch.batchDate,
  };
}
```

- [ ] **Step 3: 寫整合測試**

```ts
// tests/integration/standalone-expense-actions.test.ts
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createServiceRoleTestClient, hasIntegrationTestCredentials } from './supabase-test-client';

const currentEmployee = vi.hoisted(() => ({ value: null as null | { id: string; role: string; departmentId: string } }));
vi.mock('@/lib/auth/current-employee', () => ({
  getCurrentEmployee: async () => currentEmployee.value,
}));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({}) }));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
vi.mock('@/lib/notifications/notify', () => ({ notifyAndEmail: async () => ({ ok: true }) }));

describe.skipIf(!hasIntegrationTestCredentials())('createStandaloneExpenseRequest', () => {
  let admin: ReturnType<typeof createServiceRoleTestClient>;
  let departmentId: string;
  let managerId: string;
  let generalManagerId: string;
  let applicantId: string;
  let budgetCodeId: string;
  const createdCaseIds: string[] = [];

  beforeAll(async () => {
    admin = createServiceRoleTestClient();
    const code = `SAE-DEPT-${Date.now()}`;

    const { data: manager } = await admin
      .from('employees')
      .insert({ employee_code: `SAE-MGR-${Date.now()}`, name: '測試主管' })
      .select()
      .single();
    managerId = manager!.id;

    const { data: dept } = await admin
      .from('departments')
      .insert({ code, name: '測試部門', manager_employee_id: managerId })
      .select()
      .single();
    departmentId = dept!.id;
    await admin.from('employees').update({ department_id: departmentId }).eq('id', managerId);

    const { data: gm } = await admin
      .from('employees')
      .insert({
        employee_code: `SAE-GM-${Date.now()}`,
        name: '測試總經理',
        department_id: departmentId,
        is_general_manager: true,
      })
      .select()
      .single();
    generalManagerId = gm!.id;

    const { data: applicant } = await admin
      .from('employees')
      .insert({ employee_code: `SAE-APP-${Date.now()}`, name: '測試申請人', department_id: departmentId })
      .select()
      .single();
    applicantId = applicant!.id;

    const { data: budgetCode } = await admin
      .from('budget_codes')
      .insert({
        code: `SAE-BC-${Date.now()}`,
        department_id: departmentId,
        category: '雜項購置',
        fiscal_year: '115',
        annual_budget_amount: 100000,
        owner_employee_id: managerId,
      })
      .select()
      .single();
    budgetCodeId = budgetCode!.id;
  });

  afterAll(async () => {
    if (createdCaseIds.length > 0) {
      for (const caseId of createdCaseIds) {
        await admin.from('expense_request_items').delete().in(
          'expense_request_id',
          (await admin.from('expense_requests').select('id').eq('procurement_case_id', caseId)).data?.map((r) => r.id) ?? []
        );
        await admin.from('approval_steps').delete().eq('form_id', caseId);
        await admin.from('expense_requests').delete().eq('procurement_case_id', caseId);
        await admin.from('procurement_cases').delete().eq('id', caseId);
      }
    }
    await admin.from('budget_codes').delete().eq('id', budgetCodeId);
    await admin.from('departments').update({ manager_employee_id: null }).eq('id', departmentId);
    await admin.from('employees').delete().in('id', [applicantId, generalManagerId, managerId]);
    await admin.from('departments').delete().eq('id', departmentId);
  });

  it('rejects a total amount at or above the 10000 threshold', async () => {
    currentEmployee.value = { id: applicantId, role: 'staff', departmentId };
    const { createStandaloneExpenseRequest } = await import('@/lib/expense-requests/actions');
    const result = await createStandaloneExpenseRequest({
      budgetCodeId,
      payeeType: 'employee',
      payeeSupplierId: null,
      paymentMethod: '匯款',
      bankName: '測試銀行',
      bankAccount: '1234567',
      accountName: '測試申請人',
      invoiceMonth: null,
      expectedPaymentDate: '2026-08-01',
      items: [{ description: '測試項目', amount: 10000 }],
    });
    expect(result).toEqual({
      ok: false,
      error: '免走採購流程的費用申請單總金額須低於 NT$ 10,000，請改用一般採購流程建立',
    });
  });

  it('creates a standalone expense request under the threshold with its own new case', async () => {
    currentEmployee.value = { id: applicantId, role: 'staff', departmentId };
    const { createStandaloneExpenseRequest } = await import('@/lib/expense-requests/actions');
    const result = await createStandaloneExpenseRequest({
      budgetCodeId,
      payeeType: 'employee',
      payeeSupplierId: null,
      paymentMethod: '匯款',
      bankName: '測試銀行',
      bankAccount: '1234567',
      accountName: '測試申請人',
      invoiceMonth: null,
      expectedPaymentDate: '2026-08-01',
      items: [{ description: '計程車資', amount: 500 }, { description: '文具用品', amount: 300 }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { data: expenseRequest } = await admin
      .from('expense_requests')
      .select('purchase_order_id, budget_code_id, total_amount, procurement_case_id')
      .eq('id', result.expenseRequestId)
      .single();
    createdCaseIds.push(expenseRequest!.procurement_case_id);
    expect(expenseRequest!.purchase_order_id).toBeNull();
    expect(expenseRequest!.budget_code_id).toBe(budgetCodeId);
    expect(Number(expenseRequest!.total_amount)).toBe(800);

    const { data: pcase } = await admin
      .from('procurement_cases')
      .select('case_type')
      .eq('id', expenseRequest!.procurement_case_id)
      .single();
    expect(pcase!.case_type).toBe('standalone_expense');
  });
});
```

- [ ] **Step 4: 執行測試**

```bash
export $(grep -v '^#' .env.local | xargs)
npx vitest run tests/integration/standalone-expense-actions.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/expense-requests/actions.ts tests/integration/standalone-expense-actions.test.ts
git commit -m "feat: add createStandaloneExpenseRequest for sub-10k expenses without a PO"
```

---

### Task 7: 免走採購流程費用申請單 UI

**Files:**
- Create: `src/app/expense-requests/new/standalone-expense-request-form.tsx`
- Modify: `src/app/expense-requests/new/page.tsx`

**Interfaces:**
- Consumes: `createStandaloneExpenseRequest`/`STANDALONE_EXPENSE_REQUEST_LIMIT`（Task 6）、`getBudgetCodeList`（`src/lib/budget-codes/queries.ts`，Task 2 已含 `departmentName`/`projectName`）

- [ ] **Step 1: 寫 `src/app/expense-requests/new/standalone-expense-request-form.tsx`**

```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  createStandaloneExpenseRequest,
  STANDALONE_EXPENSE_REQUEST_LIMIT,
} from '@/lib/expense-requests/actions';
import type { BudgetCodeListItem } from '@/lib/budget-codes/queries';

type Row = { description: string; amount: string };
const emptyRow: Row = { description: '', amount: '' };

export function StandaloneExpenseRequestForm({
  budgetCodes,
  suppliers,
}: {
  budgetCodes: BudgetCodeListItem[];
  suppliers: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [budgetCodeId, setBudgetCodeId] = useState(budgetCodes[0]?.id ?? '');
  const [payeeType, setPayeeType] = useState<'employee' | 'supplier'>('supplier');
  const [payeeSupplierId, setPayeeSupplierId] = useState(suppliers[0]?.id ?? '');
  const [paymentMethod, setPaymentMethod] = useState('匯款');
  const [bankName, setBankName] = useState('');
  const [bankAccount, setBankAccount] = useState('');
  const [accountName, setAccountName] = useState('');
  const [invoiceMonth, setInvoiceMonth] = useState('');
  const [expectedPaymentDate, setExpectedPaymentDate] = useState('');
  const [rows, setRows] = useState<Row[]>([{ ...emptyRow }]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const total = rows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
  const overLimit = total >= STANDALONE_EXPENSE_REQUEST_LIMIT;

  const setRow = (index: number, patch: Partial<Row>) => {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };

  const onSubmit = async () => {
    setError(null);
    setSubmitting(true);
    const result = await createStandaloneExpenseRequest({
      budgetCodeId,
      payeeType,
      payeeSupplierId: payeeType === 'supplier' ? payeeSupplierId : null,
      paymentMethod,
      bankName: payeeType === 'employee' ? bankName : null,
      bankAccount: payeeType === 'employee' ? bankAccount : null,
      accountName: payeeType === 'employee' ? accountName : null,
      invoiceMonth: invoiceMonth.trim() === '' ? null : invoiceMonth,
      expectedPaymentDate: expectedPaymentDate.trim() === '' ? null : expectedPaymentDate,
      items: rows.map((r) => ({ description: r.description, amount: Number(r.amount) })),
    });
    setSubmitting(false);
    if (result.ok) {
      router.push(`/expense-requests/${result.expenseRequestId}`);
    } else {
      setError(result.error);
    }
  };

  return (
    <div className="space-y-4">
      <p className="rounded border border-blue-200 bg-blue-50 p-2 text-sm text-blue-700">
        免走採購流程：總金額須低於 NT$ {STANDALONE_EXPENSE_REQUEST_LIMIT.toLocaleString()}。
      </p>

      <label className="block text-sm">
        預算編號：
        <select
          value={budgetCodeId}
          onChange={(e) => setBudgetCodeId(e.target.value)}
          className="ml-2 rounded border px-2 py-1"
        >
          {budgetCodes.map((b) => (
            <option key={b.id} value={b.id}>
              {b.code}｜{b.departmentName ?? b.projectName}｜{b.category}
            </option>
          ))}
        </select>
      </label>

      <label className="block text-sm">
        付款對象：
        <select
          value={payeeType}
          onChange={(e) => setPayeeType(e.target.value as 'employee' | 'supplier')}
          className="ml-2 rounded border px-2 py-1"
        >
          <option value="supplier">廠商</option>
          <option value="employee">員工代墊（本人）</option>
        </select>
      </label>

      {payeeType === 'supplier' ? (
        <label className="block text-sm">
          廠商：
          <select
            value={payeeSupplierId}
            onChange={(e) => setPayeeSupplierId(e.target.value)}
            className="ml-2 rounded border px-2 py-1"
          >
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <>
          <label className="block text-sm">
            銀行名稱：
            <input
              value={bankName}
              onChange={(e) => setBankName(e.target.value)}
              className="ml-2 rounded border px-2 py-1"
            />
          </label>
          <label className="block text-sm">
            銀行帳號：
            <input
              value={bankAccount}
              onChange={(e) => setBankAccount(e.target.value)}
              className="ml-2 rounded border px-2 py-1"
            />
          </label>
          <label className="block text-sm">
            戶名：
            <input
              value={accountName}
              onChange={(e) => setAccountName(e.target.value)}
              className="ml-2 rounded border px-2 py-1"
            />
          </label>
        </>
      )}

      <label className="block text-sm">
        付款方式：
        <input
          value={paymentMethod}
          onChange={(e) => setPaymentMethod(e.target.value)}
          className="ml-2 rounded border px-2 py-1"
        />
      </label>
      <label className="block text-sm">
        發票月份（YYYY-MM）：
        <input
          value={invoiceMonth}
          onChange={(e) => setInvoiceMonth(e.target.value)}
          placeholder="2026-07"
          className="ml-2 rounded border px-2 py-1"
        />
      </label>
      <label className="block text-sm">
        期望付款日：
        <input
          type="date"
          value={expectedPaymentDate}
          onChange={(e) => setExpectedPaymentDate(e.target.value)}
          className="ml-2 rounded border px-2 py-1"
        />
      </label>

      {rows.map((row, i) => (
        <div key={i} className="flex gap-2 rounded border p-3">
          <input
            value={row.description}
            onChange={(e) => setRow(i, { description: e.target.value })}
            placeholder="說明"
            className="flex-1 rounded border px-2 py-1"
          />
          <input
            type="number"
            value={row.amount}
            onChange={(e) => setRow(i, { amount: e.target.value })}
            placeholder="金額"
            className="w-32 rounded border px-2 py-1"
          />
          {rows.length > 1 && (
            <button
              type="button"
              onClick={() => setRows((prev) => prev.filter((_, idx) => idx !== i))}
              className="rounded border px-2 text-sm"
            >
              移除
            </button>
          )}
        </div>
      ))}

      <button
        type="button"
        onClick={() => setRows((prev) => [...prev, { ...emptyRow }])}
        className="rounded border px-3 py-1 text-sm"
      >
        + 新增一項
      </button>

      <p className={`text-right font-semibold ${overLimit ? 'text-red-600' : ''}`}>
        總計：NT$ {total.toLocaleString()}
        {overLimit && '（已達門檻，請改用一般採購流程）'}
      </p>

      {error && <p className="rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}

      <button
        type="button"
        onClick={onSubmit}
        disabled={submitting || overLimit}
        className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {submitting ? '送出中…' : '送出簽核'}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: 更新 `src/app/expense-requests/new/page.tsx` 支援 `mode=standalone`**

把整個檔案換成：

```tsx
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { getEligiblePurchaseOrdersForExpenseRequest } from '@/lib/expense-requests/queries';
import { getBudgetCodeList } from '@/lib/budget-codes/queries';
import { ExpenseRequestForm } from './expense-request-form';
import { StandaloneExpenseRequestForm } from './standalone-expense-request-form';

export default async function NewExpenseRequestPage({
  searchParams,
}: {
  searchParams: Promise<{ orderId?: string; mode?: string }>;
}) {
  const { orderId, mode } = await searchParams;
  const supabase = await createSupabaseServerClient();
  const employee = await getCurrentEmployee(supabase);
  if (!employee) redirect('/login');

  if (mode === 'standalone') {
    const [budgetCodes, suppliersResult] = await Promise.all([
      getBudgetCodeList(),
      supabase.from('suppliers').select('id, name').order('name'),
    ]);
    return (
      <main className="mx-auto max-w-4xl p-8">
        <h1 className="mb-6 text-2xl font-bold">新增費用申請單（免走採購流程）</h1>
        <StandaloneExpenseRequestForm
          budgetCodes={budgetCodes}
          suppliers={(suppliersResult.data ?? []).map((s) => ({ id: s.id, name: s.name }))}
        />
      </main>
    );
  }

  const eligible = await getEligiblePurchaseOrdersForExpenseRequest();

  if (!orderId) {
    return (
      <main className="mx-auto max-w-2xl p-8">
        <h1 className="mb-6 text-2xl font-bold">新增費用申請單</h1>
        <p className="mb-4">
          <a href="/expense-requests/new?mode=standalone" className="text-blue-600 underline">
            免走採購流程建立費用申請單（金額低於 1 萬元）
          </a>
        </p>
        {eligible.length === 0 ? (
          <p className="text-gray-500">
            目前沒有已核准、尚未建立費用申請單的採購單（需已完成驗收，或付款條件為預付款）。
          </p>
        ) : (
          <ul className="space-y-2">
            {eligible.map((o) => (
              <li key={o.id}>
                <a href={`/expense-requests/new?orderId=${o.id}`} className="text-blue-600 underline">
                  {o.caseNumber}（{o.paymentTerms}）
                </a>
              </li>
            ))}
          </ul>
        )}
      </main>
    );
  }

  const selected = eligible.find((o) => o.id === orderId);
  if (!selected) redirect('/expense-requests/new');

  const { data: suppliers } = await supabase.from('suppliers').select('id, name').order('name');

  return (
    <main className="mx-auto max-w-4xl p-8">
      <h1 className="mb-2 text-2xl font-bold">新增費用申請單</h1>
      <p className="mb-6 font-mono text-gray-600">{selected.caseNumber}</p>
      <ExpenseRequestForm
        purchaseOrderId={selected.id}
        sourceItems={selected.sourceItems}
        suppliers={(suppliers ?? []).map((s) => ({ id: s.id, name: s.name }))}
      />
    </main>
  );
}
```

- [ ] **Step 3: 執行 typecheck 與 lint**

```bash
npm run typecheck
npm run lint
```

Expected: 皆為乾淨

- [ ] **Step 4: 手動瀏覽器 QA**

用 Browser 工具登入一般員工帳號，前往 `/expense-requests/new`，點擊「免走採購流程建立費用申請單」連結：
- 確認可以選擇預算編號、填寫項目說明與金額
- 確認總金額達 10,000 時送出按鈕會被禁用並顯示提示
- 確認送出低於門檻的費用申請單後，能正確導向該筆費用申請單詳情頁

- [ ] **Step 5: Commit**

```bash
git add src/app/expense-requests/new/
git commit -m "feat: add standalone expense request UI for sub-10k expenses"
```

---

### Task 8: `determineCaseBucket` 依 `case_type` 分流

**Files:**
- Modify: `src/lib/case-tracking/determine-bucket.ts`
- Modify: `src/lib/case-tracking/queries.ts`
- Test: `tests/integration/case-tracking-queries.test.ts`（新增 standalone 案例）

**Interfaces:**
- Produces: `determineCaseBucket(forms: CaseFormState[], caseType: 'standard' | 'standalone_expense'): CaseBucket`（新增第二個參數，非 breaking change 需同步更新唯一呼叫端）

- [ ] **Step 1: 修改 `src/lib/case-tracking/determine-bucket.ts`**

```ts
import type { FormType } from '@/lib/procurement/form-registry';

export type CaseFormState = {
  formType: FormType;
  exists: boolean;
  status: string | null;
};

export type CaseType = 'standard' | 'standalone_expense';
export type CaseBucket = 'in_progress' | 'completed';

export function determineCaseBucket(forms: CaseFormState[], caseType: CaseType): CaseBucket {
  if (caseType === 'standalone_expense') {
    const expenseForm = forms.find((f) => f.formType === 'expense_request');
    const complete = !!expenseForm && expenseForm.exists && expenseForm.status === 'approved';
    return complete ? 'completed' : 'in_progress';
  }
  const allApproved = forms.every((form) => form.exists && form.status === 'approved');
  return allApproved ? 'completed' : 'in_progress';
}
```

- [ ] **Step 2: 修改 `src/lib/case-tracking/queries.ts`**

把 `procurement_cases` 查詢（第 43-46 行）的 `select` 加上 `case_type`：

```ts
  let caseQuery = supabase
    .from('procurement_cases')
    .select('id, case_number, case_type')
    .order('created_at', { ascending: false });
```

把 `cases.map` 內建構 `CaseTrackingRow` 的區塊（第 82-98 行）改為傳入 `case_type` 並在型別中新增欄位：

```ts
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
      bucket: determineCaseBucket(forms, c.case_type as 'standard' | 'standalone_expense'),
    };
  });
```

- [ ] **Step 3: 新增整合測試案例，驗證 standalone 案件只需一張表單即完成**

在 `tests/integration/case-tracking-queries.test.ts` 既有的 `describe('getFinanceCaseTracking', ...)` 區塊內（該檔案既有 fixture 用 `employeeAId`／`departmentAId` 命名，見第 17-19 行），在最後一個 `it`（`getDepartmentFilterOptions includes the fixture departments`，第 269-274 行）之後新增：

```ts
  it('marks a standalone_expense case as completed once its sole expense_request is approved', async () => {
    const { data: budgetCode } = await admin
      .from('budget_codes')
      .insert({
        code: `CTQ-SAE-BC-${Date.now()}`,
        department_id: departmentAId,
        category: '雜項購置',
        fiscal_year: '115',
        annual_budget_amount: 50000,
        owner_employee_id: employeeAId,
      })
      .select()
      .single();

    const { data: caseNumber } = await admin.rpc('next_case_number');
    const { data: pcase } = await admin
      .from('procurement_cases')
      .insert({ case_number: caseNumber, created_by_employee_id: employeeAId, case_type: 'standalone_expense' })
      .select()
      .single();

    const { data: expenseRequest } = await admin
      .from('expense_requests')
      .insert({
        procurement_case_id: pcase!.id,
        budget_code_id: budgetCode!.id,
        applicant_employee_id: employeeAId,
        department_id: departmentAId,
        budget_owner_employee_id: employeeAId,
        payee_type: 'employee',
        payment_method: '匯款',
        total_amount: 500,
        status: 'approved',
      })
      .select()
      .single();

    const { getFinanceCaseTracking } = await import('@/lib/case-tracking/queries');
    const rows = await getFinanceCaseTracking({});
    const row = rows.find((r) => r.caseNumber === caseNumber);
    expect(row?.bucket).toBe('completed');

    await admin.from('expense_requests').delete().eq('id', expenseRequest!.id);
    await admin.from('procurement_cases').delete().eq('id', pcase!.id);
    await admin.from('budget_codes').delete().eq('id', budgetCode!.id);
  });
```

- [ ] **Step 4: 執行測試**

```bash
export $(grep -v '^#' .env.local | xargs)
npx vitest run tests/integration/case-tracking-queries.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/case-tracking/ tests/integration/case-tracking-queries.test.ts
git commit -m "feat: bucket standalone expense cases as complete without PR/PO/acceptance"
```

---

## 子專案 3：表單自行修改／撤回（送出後、第一關審核前）

**設計要點（適用以下所有任務）：** 「修改」重用既有的 `resubmit_*` Postgres RPC function（它們的資料庫操作——刪明細、刪簽核步驟、重建、重設 `current_step_order=1`——跟本次需求完全一致），只是新增一支 TS wrapper 用不同的守門條件呼叫同一個 RPC。「撤回」是全新能力，新增 `withdrawn` 狀態值 + 一支新的 update 陳述句，不刪除任何資料列。

### Task 9: Migration — 四張表單新增 `withdrawn` 狀態

**Files:**
- Create: `supabase/migrations/20260719120000_withdrawn_status.sql`
- Test: `tests/integration/withdrawn-status-migration.test.ts`

**Interfaces:**
- Produces: `purchase_requests.status`／`purchase_orders.status`／`acceptances.status`／`expense_requests.status` 的 CHECK 約束新增 `'withdrawn'` 為合法值

- [ ] **Step 1: 寫 migration SQL**

四張表在建表時都用欄位層級（column-level）匿名 CHECK 約束（`status text ... check (status in (...))`），Postgres 對這種寫法會自動產生 `<table>_<column>_check` 這個名稱的約束。先在本機開發資料庫確認實際約束名稱：

```bash
export $(grep -v '^#' .env.local | xargs)
node -e "
const { createClient } = require('@supabase/supabase-js');
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
db.rpc('exec', {}).catch(() => {});
" 2>/dev/null || true
```

（上面這段 RPC 呼叫僅為佔位提示；實際請直接用 `supabase db diff` 或 Supabase Studio 的 Table Editor → 對應表 → Constraints 分頁，逐一確認四張表 `status` 欄位的約束名稱是否確實為 `purchase_requests_status_check`／`purchase_orders_status_check`／`acceptances_status_check`／`expense_requests_status_check`。若名稱不同，以實際查到的名稱為準調整下面的 migration。）

```sql
-- supabase/migrations/20260719120000_withdrawn_status.sql

alter table purchase_requests drop constraint purchase_requests_status_check;
alter table purchase_requests add constraint purchase_requests_status_check
  check (status in ('pending_approval', 'approved', 'returned', 'withdrawn'));

alter table purchase_orders drop constraint purchase_orders_status_check;
alter table purchase_orders add constraint purchase_orders_status_check
  check (status in ('pending_approval', 'approved', 'returned', 'withdrawn'));

alter table acceptances drop constraint acceptances_status_check;
alter table acceptances add constraint acceptances_status_check
  check (status in ('pending_approval', 'approved', 'returned', 'withdrawn'));

alter table expense_requests drop constraint expense_requests_status_check;
alter table expense_requests add constraint expense_requests_status_check
  check (status in ('pending_approval', 'approved', 'returned', 'withdrawn'));
```

- [ ] **Step 2: 套用 migration（本機開發資料庫）**

```bash
supabase db push
```

Expected: migration 套用成功

- [ ] **Step 3: 寫整合測試驗證四張表都接受 `withdrawn` 但拒絕其他非法值**

```ts
// tests/integration/withdrawn-status-migration.test.ts
import { describe, expect, it } from 'vitest';
import { createServiceRoleTestClient, hasIntegrationTestCredentials } from './supabase-test-client';

describe.skipIf(!hasIntegrationTestCredentials())('withdrawn status migration', () => {
  const admin = createServiceRoleTestClient();
  const tables = ['purchase_requests', 'purchase_orders', 'acceptances', 'expense_requests'] as const;

  it.each(tables)('%s accepts withdrawn as a valid status via update', async (table) => {
    const { data: anyRow } = await admin.from(table).select('id, status').limit(1).maybeSingle();
    if (!anyRow) return;
    const originalStatus = anyRow.status;
    const { error } = await admin.from(table).update({ status: 'withdrawn' }).eq('id', anyRow.id);
    expect(error).toBeNull();
    await admin.from(table).update({ status: originalStatus }).eq('id', anyRow.id);
  });

  it.each(tables)('%s rejects an invalid status value', async (table) => {
    const { data: anyRow } = await admin.from(table).select('id').limit(1).maybeSingle();
    if (!anyRow) return;
    const { error } = await admin.from(table).update({ status: 'not_a_real_status' }).eq('id', anyRow.id);
    expect(error).not.toBeNull();
  });
});
```

- [ ] **Step 4: 執行測試**

```bash
export $(grep -v '^#' .env.local | xargs)
npx vitest run tests/integration/withdrawn-status-migration.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260719120000_withdrawn_status.sql tests/integration/withdrawn-status-migration.test.ts
git commit -m "feat: add withdrawn as a valid status for all four form types"
```

---

### Task 10: 請購單 — 自行修改／撤回 actions + UI

**Files:**
- Modify: `src/lib/purchase-requests/actions.ts`
- Modify: `src/lib/purchase-requests/queries.ts`
- Modify: `src/app/requests/new/purchase-request-form.tsx`
- Modify: `src/app/requests/[id]/page.tsx`
- Create: `src/app/requests/[id]/edit/page.tsx`
- Test: `tests/integration/purchase-request-edit-withdraw.test.ts`

**Interfaces:**
- Produces: `updatePurchaseRequest(requestId: string, input: NewPurchaseRequest): Promise<ActionResult>`；`withdrawPurchaseRequest(requestId: string): Promise<ActionResult>`；`RequestDetail.applicantEmployeeId: string`（新增欄位）

- [ ] **Step 1: 在 `src/lib/purchase-requests/actions.ts` 新增 `updatePurchaseRequest`**

在既有 `resubmitPurchaseRequest` 函式（結束於第 392 行）之後新增：

```ts
export async function updatePurchaseRequest(
  requestId: string,
  input: NewPurchaseRequest
): Promise<ActionResult> {
  const employee = await getCurrentEmployee(await createSupabaseServerClient());
  if (!employee) return { ok: false, error: '找不到您的員工資料' };
  const db = createSupabaseServiceRoleClient();

  const { data: pr } = await db
    .from('purchase_requests')
    .select('id, applicant_employee_id, status, current_step_order, department_id')
    .eq('id', requestId)
    .maybeSingle();
  if (!pr) return { ok: false, error: '找不到這張請購單' };
  if (pr.applicant_employee_id !== employee.id) {
    return { ok: false, error: '只有申請人可以修改這張請購單' };
  }
  if (pr.status !== 'pending_approval' || pr.current_step_order !== 1) {
    return { ok: false, error: '只有尚未有人簽核的請購單可以修改' };
  }
  if (input.items.length === 0) {
    return { ok: false, error: '請購單至少需要一個明細項次' };
  }

  const budgetCodeIds = Array.from(new Set(input.items.map((i) => i.budgetCodeId)));
  const { data: budgetCodes } = await db
    .from('budget_codes')
    .select('id, category, owner_employee_id')
    .in('id', budgetCodeIds);
  if (!budgetCodes || budgetCodes.length !== budgetCodeIds.length) {
    return { ok: false, error: '選取的預算編號無效' };
  }
  const byId = new Map(budgetCodes.map((b) => [b.id, b]));
  const validation = validatePurchaseRequestInput(
    input.items.map((i) => ({
      budgetCodeId: i.budgetCodeId,
      budgetOwnerEmployeeId: byId.get(i.budgetCodeId)!.owner_employee_id ?? '',
      itemCategory: byId.get(i.budgetCodeId)!.category,
      description: i.description,
      quantity: i.quantity,
      estimatedAmount: i.estimatedAmount,
    }))
  );
  if (!validation.ok) return { ok: false, error: validation.error };
  const budgetOwnerId = byId.get(input.items[0].budgetCodeId)!.owner_employee_id;
  if (!budgetOwnerId) return { ok: false, error: '選取的預算編號沒有指定預算負責人' };

  const totalAmount = input.items.reduce((sum, i) => sum + i.estimatedAmount, 0);

  const chainResult = await buildApprovalChainForForm(db, {
    applicantEmployeeId: employee.id,
    departmentId: pr.department_id,
    budgetOwnerEmployeeId: budgetOwnerId,
    totalAmount,
  });
  if (!chainResult.ok) return { ok: false, error: chainResult.error };
  const chain = chainResult.chain;
  if (chain.length === 0) {
    return { ok: false, error: '修改後找不到適用的簽核人，請聯絡系統管理員' };
  }

  const { error: txError } = await db.rpc('resubmit_purchase_request', {
    p_request_id: requestId,
    p_budget_owner: budgetOwnerId,
    p_needed_days: input.neededWithinDays,
    p_total: totalAmount,
    p_items: input.items.map((i, idx) => ({
      line_no: idx + 1,
      budget_code_id: i.budgetCodeId,
      item_category: byId.get(i.budgetCodeId)!.category,
      description: i.description,
      quantity: i.quantity,
      estimated_amount: i.estimatedAmount,
    })),
    p_steps: chain.map((step, idx) => ({
      step_order: idx + 1,
      approver_employee_id: step.approverEmployeeId,
      approver_role: step.approverRole,
    })),
  });
  if (txError) return { ok: false, error: '修改失敗，請稍後再試' };

  revalidatePath('/requests');
  revalidatePath(`/requests/${requestId}`);
  return { ok: true };
}

export async function withdrawPurchaseRequest(requestId: string): Promise<ActionResult> {
  const employee = await getCurrentEmployee(await createSupabaseServerClient());
  if (!employee) return { ok: false, error: '找不到您的員工資料' };
  const db = createSupabaseServiceRoleClient();

  const { data: pr } = await db
    .from('purchase_requests')
    .select('id, applicant_employee_id, status, current_step_order')
    .eq('id', requestId)
    .maybeSingle();
  if (!pr) return { ok: false, error: '找不到這張請購單' };
  if (pr.applicant_employee_id !== employee.id) {
    return { ok: false, error: '只有申請人可以撤回這張請購單' };
  }
  if (pr.status !== 'pending_approval' || pr.current_step_order !== 1) {
    return { ok: false, error: '只有尚未有人簽核的請購單可以撤回' };
  }

  const { error } = await db
    .from('purchase_requests')
    .update({ status: 'withdrawn', current_step_order: null, updated_at: new Date().toISOString() })
    .eq('id', requestId);
  if (error) return { ok: false, error: '撤回失敗，請稍後再試' };

  revalidatePath('/requests');
  revalidatePath(`/requests/${requestId}`);
  return { ok: true };
}
```

- [ ] **Step 2: 在 `src/lib/purchase-requests/queries.ts` 的 `RequestDetail` 新增 `applicantEmployeeId`**

把 `RequestDetail` 型別（第 30-41 行）新增一個欄位：

```ts
export type RequestDetail = {
  id: string;
  caseNumber: string;
  status: string;
  totalAmount: number;
  neededWithinDays: number | null;
  applicantEmployeeId: string;
  applicantName: string;
  departmentName: string;
  currentStepOrder: number | null;
  items: DetailItem[];
  steps: DetailStep[];
};
```

把 `getPurchaseRequestDetail` 的 select 字串（第 73-75 行）新增 `applicant_employee_id`：

```ts
    .select(
      'id, total_amount, status, needed_within_days, current_step_order, applicant_employee_id, procurement_cases(case_number), applicant:employees!applicant_employee_id(name), departments(name)'
    )
```

把回傳物件（第 95-120 行）新增對應欄位：

```ts
  return {
    id: pr.id,
    caseNumber: (pr.procurement_cases as unknown as { case_number: string }).case_number,
    status: pr.status,
    totalAmount: Number(pr.total_amount),
    neededWithinDays: pr.needed_within_days,
    applicantEmployeeId: pr.applicant_employee_id,
    applicantName: (pr.applicant as unknown as { name: string }).name,
    departmentName: (pr.departments as unknown as { name: string }).name,
    currentStepOrder: pr.current_step_order,
    items: (items ?? []).map((i) => ({
      lineNo: i.line_no,
      budgetCode: (i.budget_codes as unknown as { code: string }).code,
      itemCategory: i.item_category,
      description: i.description,
      quantity: i.quantity,
      estimatedAmount: Number(i.estimated_amount),
    })),
    steps: (steps ?? []).map((s) => ({
      stepOrder: s.step_order,
      approverEmployeeId: s.approver_employee_id,
      approverName: (s.approver as unknown as { name: string }).name,
      approverRole: s.approver_role,
      status: s.status,
      comment: s.comment,
    })),
  };
```

- [ ] **Step 3: 擴充 `src/app/requests/new/purchase-request-form.tsx` 支援 edit 模式**

把元件簽名與 state 初始化（第 32-38 行）換成：

```tsx
export function PurchaseRequestForm({
  budgetCodes,
  mode = 'create',
  requestId,
  initialNeededWithinDays,
  initialRows,
}: {
  budgetCodes: BudgetCodeOption[];
  mode?: 'create' | 'edit';
  requestId?: string;
  initialNeededWithinDays?: number | null;
  initialRows?: Row[];
}) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>(initialRows ?? [{ ...emptyRow }]);
  const [neededWithinDays, setNeededWithinDays] = useState(
    initialNeededWithinDays != null ? String(initialNeededWithinDays) : '30'
  );
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
```

在檔案開頭 import 區塊新增 `updatePurchaseRequest`：

```tsx
import { createPurchaseRequest, updatePurchaseRequest } from '@/lib/purchase-requests/actions';
```

把 `onSubmit`（原第 50-68 行）換成：

```tsx
  const onSubmit = async () => {
    setError(null);
    setSubmitting(true);
    const payload = {
      neededWithinDays: neededWithinDays === '' ? null : Number(neededWithinDays),
      items: rows.map((r) => ({
        budgetCodeId: r.budgetCodeId,
        description: r.description,
        quantity: Number(r.quantity),
        estimatedAmount: Number(r.estimatedAmount),
      })),
    };
    const result =
      mode === 'edit' && requestId
        ? await updatePurchaseRequest(requestId, payload)
        : await createPurchaseRequest(payload);
    setSubmitting(false);
    if (result.ok) {
      router.push(mode === 'edit' && requestId ? `/requests/${requestId}` : `/requests/${(result as { requestId: string }).requestId}`);
    } else {
      setError(result.error);
    }
  };
```

把送出按鈕文字（原第 167 行 `{submitting ? '送出中…' : '送出簽核'}`）改為依模式顯示：

```tsx
        {submitting ? '送出中…' : mode === 'edit' ? '儲存修改' : '送出簽核'}
```

- [ ] **Step 4: 建立 `src/app/requests/[id]/edit/page.tsx`**

```tsx
import { redirect, notFound } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { getPurchaseRequestDetail } from '@/lib/purchase-requests/queries';
import { PurchaseRequestForm, type BudgetCodeOption } from '../../new/purchase-request-form';

export default async function EditRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const employee = await getCurrentEmployee(supabase);
  if (!employee) redirect('/login');

  const detail = await getPurchaseRequestDetail(id);
  if (!detail) notFound();
  if (detail.applicantEmployeeId !== employee.id) redirect(`/requests/${id}`);
  if (detail.status !== 'pending_approval' || detail.currentStepOrder !== 1) redirect(`/requests/${id}`);

  const { data } = await supabase
    .from('budget_codes')
    .select('id, code, category, departments(name), owner:employees!owner_employee_id(id, name)')
    .order('code');
  const budgetCodes: BudgetCodeOption[] = (data ?? []).map((b) => ({
    id: b.id,
    code: b.code,
    category: b.category,
    departmentName: (b.departments as unknown as { name: string } | null)?.name ?? '',
    ownerId: (b.owner as unknown as { id: string } | null)?.id ?? '',
    ownerName: (b.owner as unknown as { name: string } | null)?.name ?? '（未指定）',
  }));

  return (
    <main className="mx-auto max-w-4xl p-8">
      <h1 className="mb-6 text-2xl font-bold">修改請購申請單</h1>
      <PurchaseRequestForm
        budgetCodes={budgetCodes}
        mode="edit"
        requestId={id}
        initialNeededWithinDays={detail.neededWithinDays}
        initialRows={detail.items.map((i) => ({
          budgetCodeId: budgetCodes.find((b) => b.code === i.budgetCode)?.id ?? '',
          itemCategory: i.itemCategory,
          description: i.description,
          quantity: String(i.quantity),
          estimatedAmount: String(i.estimatedAmount),
        }))}
      />
    </main>
  );
}
```

- [ ] **Step 5: 在 `src/app/requests/[id]/page.tsx` 新增編輯／撤回進入點**

在檔案開頭 import 區塊新增：

```tsx
import { withdrawPurchaseRequest } from '@/lib/purchase-requests/actions';
import { WithdrawButton } from './withdraw-button';
```

在既有 `isCurrentApprover` 判斷（第 41-42 行）之後新增：

```tsx
  const isApplicant = !!employee && employee.id === detail.applicantEmployeeId;
  const canSelfEdit =
    isApplicant && detail.status === 'pending_approval' && detail.currentStepOrder === 1;
```

在 `{isCurrentApprover && <ApprovalActions requestId={detail.id} />}`（第 119 行）之前新增：

```tsx
      {canSelfEdit && (
        <section className="mb-4 flex gap-3">
          <Link href={`/requests/${detail.id}/edit`} className="rounded border px-4 py-2 text-sm">
            編輯
          </Link>
          <WithdrawButton requestId={detail.id} onWithdraw={withdrawPurchaseRequest} redirectTo="/requests" />
        </section>
      )}
```

- [ ] **Step 6: 新增共用的 `WithdrawButton` 元件**

```tsx
// src/app/requests/[id]/withdraw-button.tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type ActionResult = { ok: true } | { ok: false; error: string };

export function WithdrawButton({
  requestId,
  onWithdraw,
  redirectTo,
}: {
  requestId: string;
  onWithdraw: (id: string) => Promise<ActionResult>;
  redirectTo: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onClick = async () => {
    if (!window.confirm('確定要撤回這張表單嗎？撤回後需重新填寫送出。')) return;
    setBusy(true);
    setError(null);
    const result = await onWithdraw(requestId);
    setBusy(false);
    if (result.ok) {
      router.push(redirectTo);
    } else {
      setError(result.error);
    }
  };

  return (
    <div>
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        className="rounded border border-red-300 px-4 py-2 text-sm text-red-700 disabled:opacity-50"
      >
        {busy ? '撤回中…' : '撤回'}
      </button>
      {error && <p className="mt-1 text-sm text-red-700">{error}</p>}
    </div>
  );
}
```

這個元件在 Task 11-13 會被 purchase-orders/acceptances/expense-requests 的詳情頁重複使用（傳入各自的 `withdraw*` action）。

- [ ] **Step 7: 寫整合測試**

```ts
// tests/integration/purchase-request-edit-withdraw.test.ts
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createServiceRoleTestClient, hasIntegrationTestCredentials } from './supabase-test-client';

const currentEmployee = vi.hoisted(() => ({ value: null as null | { id: string; role: string; departmentId: string } }));
vi.mock('@/lib/auth/current-employee', () => ({
  getCurrentEmployee: async () => currentEmployee.value,
}));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({}) }));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
vi.mock('@/lib/notifications/notify', () => ({ notifyAndEmail: async () => ({ ok: true }) }));

describe.skipIf(!hasIntegrationTestCredentials())('purchase request edit/withdraw', () => {
  let admin: ReturnType<typeof createServiceRoleTestClient>;
  let departmentId: string;
  let managerId: string;
  let generalManagerId: string;
  let applicantId: string;
  let otherEmployeeId: string;
  let budgetCodeId: string;
  const createdCaseIds: string[] = [];

  beforeAll(async () => {
    admin = createServiceRoleTestClient();
    const code = `PRW-DEPT-${Date.now()}`;
    const { data: manager } = await admin
      .from('employees')
      .insert({ employee_code: `PRW-MGR-${Date.now()}`, name: '測試主管' })
      .select()
      .single();
    managerId = manager!.id;
    const { data: dept } = await admin
      .from('departments')
      .insert({ code, name: '測試部門', manager_employee_id: managerId })
      .select()
      .single();
    departmentId = dept!.id;
    await admin.from('employees').update({ department_id: departmentId }).eq('id', managerId);
    const { data: gm } = await admin
      .from('employees')
      .insert({ employee_code: `PRW-GM-${Date.now()}`, name: '測試總經理', department_id: departmentId, is_general_manager: true })
      .select()
      .single();
    generalManagerId = gm!.id;
    const { data: applicant } = await admin
      .from('employees')
      .insert({ employee_code: `PRW-APP-${Date.now()}`, name: '測試申請人', department_id: departmentId })
      .select()
      .single();
    applicantId = applicant!.id;
    const { data: other } = await admin
      .from('employees')
      .insert({ employee_code: `PRW-OTHER-${Date.now()}`, name: '測試其他人', department_id: departmentId })
      .select()
      .single();
    otherEmployeeId = other!.id;
    const { data: budgetCode } = await admin
      .from('budget_codes')
      .insert({
        code: `PRW-BC-${Date.now()}`,
        department_id: departmentId,
        category: '雜項購置',
        fiscal_year: '115',
        annual_budget_amount: 1000000,
        owner_employee_id: managerId,
      })
      .select()
      .single();
    budgetCodeId = budgetCode!.id;
  });

  afterAll(async () => {
    for (const caseId of createdCaseIds) {
      const { data: prs } = await admin.from('purchase_requests').select('id').eq('procurement_case_id', caseId);
      for (const pr of prs ?? []) {
        await admin.from('purchase_request_items').delete().eq('purchase_request_id', pr.id);
        await admin.from('approval_steps').delete().eq('form_type', 'purchase_request').eq('form_id', pr.id);
      }
      await admin.from('purchase_requests').delete().eq('procurement_case_id', caseId);
      await admin.from('procurement_cases').delete().eq('id', caseId);
    }
    await admin.from('budget_codes').delete().eq('id', budgetCodeId);
    await admin.from('departments').update({ manager_employee_id: null }).eq('id', departmentId);
    await admin.from('employees').delete().in('id', [applicantId, otherEmployeeId, generalManagerId, managerId]);
    await admin.from('departments').delete().eq('id', departmentId);
  });

  async function createTestRequest() {
    currentEmployee.value = { id: applicantId, role: 'staff', departmentId };
    const { createPurchaseRequest } = await import('@/lib/purchase-requests/actions');
    const result = await createPurchaseRequest({
      neededWithinDays: 30,
      items: [{ budgetCodeId, description: '測試項目', quantity: 1, estimatedAmount: 5000 }],
    });
    if (!result.ok) throw new Error(result.error);
    const { data: pr } = await admin
      .from('purchase_requests')
      .select('procurement_case_id')
      .eq('id', result.requestId)
      .single();
    createdCaseIds.push(pr!.procurement_case_id);
    return result.requestId;
  }

  it('rejects update from a non-applicant', async () => {
    const requestId = await createTestRequest();
    currentEmployee.value = { id: otherEmployeeId, role: 'staff', departmentId };
    const { updatePurchaseRequest } = await import('@/lib/purchase-requests/actions');
    const result = await updatePurchaseRequest(requestId, {
      neededWithinDays: 30,
      items: [{ budgetCodeId, description: '改過的項目', quantity: 1, estimatedAmount: 6000 }],
    });
    expect(result).toEqual({ ok: false, error: '只有申請人可以修改這張請購單' });
  });

  it('allows the applicant to edit before any approval, rebuilding the chain', async () => {
    const requestId = await createTestRequest();
    currentEmployee.value = { id: applicantId, role: 'staff', departmentId };
    const { updatePurchaseRequest } = await import('@/lib/purchase-requests/actions');
    const result = await updatePurchaseRequest(requestId, {
      neededWithinDays: 45,
      items: [{ budgetCodeId, description: '改過的項目', quantity: 2, estimatedAmount: 200000 }],
    });
    expect(result).toEqual({ ok: true });

    const { data: pr } = await admin
      .from('purchase_requests')
      .select('total_amount, needed_within_days, current_step_order, status')
      .eq('id', requestId)
      .single();
    expect(Number(pr!.total_amount)).toBe(200000);
    expect(pr!.needed_within_days).toBe(45);
    expect(pr!.current_step_order).toBe(1);
    expect(pr!.status).toBe('pending_approval');
  });

  it('rejects edit once the first step has already been approved', async () => {
    const requestId = await createTestRequest();
    currentEmployee.value = { id: managerId, role: 'staff', departmentId };
    const { approvePurchaseRequestStep } = await import('@/lib/purchase-requests/actions');
    await approvePurchaseRequestStep(requestId);

    currentEmployee.value = { id: applicantId, role: 'staff', departmentId };
    const { updatePurchaseRequest } = await import('@/lib/purchase-requests/actions');
    const result = await updatePurchaseRequest(requestId, {
      neededWithinDays: 30,
      items: [{ budgetCodeId, description: '不該被接受', quantity: 1, estimatedAmount: 1000 }],
    });
    expect(result).toEqual({ ok: false, error: '只有尚未有人簽核的請購單可以修改' });
  });

  it('rejects withdraw from a non-applicant', async () => {
    const requestId = await createTestRequest();
    currentEmployee.value = { id: otherEmployeeId, role: 'staff', departmentId };
    const { withdrawPurchaseRequest } = await import('@/lib/purchase-requests/actions');
    const result = await withdrawPurchaseRequest(requestId);
    expect(result).toEqual({ ok: false, error: '只有申請人可以撤回這張請購單' });
  });

  it('allows the applicant to withdraw before any approval, without deleting the row', async () => {
    const requestId = await createTestRequest();
    currentEmployee.value = { id: applicantId, role: 'staff', departmentId };
    const { withdrawPurchaseRequest } = await import('@/lib/purchase-requests/actions');
    const result = await withdrawPurchaseRequest(requestId);
    expect(result).toEqual({ ok: true });

    const { data: pr } = await admin
      .from('purchase_requests')
      .select('status, current_step_order')
      .eq('id', requestId)
      .single();
    expect(pr).toEqual({ status: 'withdrawn', current_step_order: null });
  });
});
```

- [ ] **Step 8: 執行測試**

```bash
export $(grep -v '^#' .env.local | xargs)
npx vitest run tests/integration/purchase-request-edit-withdraw.test.ts
```

Expected: PASS

- [ ] **Step 9: 執行 typecheck、lint**

```bash
npm run typecheck
npm run lint
```

Expected: 皆為乾淨

- [ ] **Step 10: Commit**

```bash
git add src/lib/purchase-requests/ src/app/requests/ tests/integration/purchase-request-edit-withdraw.test.ts
git commit -m "feat: allow applicants to self-edit or withdraw purchase requests before first approval"
```

---

### Task 11: 採購單 — 自行修改／撤回 actions + UI

**Files:**
- Modify: `src/lib/purchase-orders/actions.ts`
- Modify: `src/lib/purchase-orders/queries.ts`
- Modify: `src/app/purchase-orders/new/purchase-order-form.tsx`
- Modify: `src/app/purchase-orders/[id]/page.tsx`
- Create: `src/app/purchase-orders/[id]/edit/page.tsx`
- Test: `tests/integration/purchase-order-edit-withdraw.test.ts`

**Interfaces:**
- Produces: `updatePurchaseOrder(orderId: string, input: ResubmitPurchaseOrderInput): Promise<ActionResult>`；`withdrawPurchaseOrder(orderId: string): Promise<ActionResult>`；`PurchaseOrderDetail.applicantEmployeeId: string`（新增欄位，型別名稱以 `src/lib/purchase-orders/queries.ts` 中實際的 detail 型別名稱為準——比照 Task 10 的 `RequestDetail` 模式）

- [ ] **Step 1: 在 `src/lib/purchase-orders/actions.ts` 新增 `updatePurchaseOrder` 與 `withdrawPurchaseOrder`**

在既有 `resubmitPurchaseOrder` 函式（結束於第 405 行）之後新增：

```ts
export async function updatePurchaseOrder(
  orderId: string,
  input: ResubmitPurchaseOrderInput
): Promise<ActionResult> {
  const employee = await getCurrentEmployee(await createSupabaseServerClient());
  if (!employee) return { ok: false, error: '找不到您的員工資料' };
  const db = createSupabaseServiceRoleClient();

  const { data: order } = await db
    .from('purchase_orders')
    .select(
      'id, applicant_employee_id, status, current_step_order, department_id, budget_owner_employee_id'
    )
    .eq('id', orderId)
    .maybeSingle();
  if (!order) return { ok: false, error: '找不到這張採購單' };
  if (order.applicant_employee_id !== employee.id) {
    return { ok: false, error: '只有申請人可以修改這張採購單' };
  }
  if (order.status !== 'pending_approval' || order.current_step_order !== 1) {
    return { ok: false, error: '只有尚未有人簽核的採購單可以修改' };
  }

  const { data: existingItems } = await db
    .from('purchase_order_items')
    .select('id, line_no, budget_code_id, item_category, description, quantity')
    .eq('purchase_order_id', orderId)
    .order('line_no');
  if (!existingItems || existingItems.length === 0) {
    return { ok: false, error: '找不到採購明細' };
  }

  const priceByItemId = new Map(input.items.map((i) => [i.purchaseOrderItemId, i.unitPrice]));
  if (priceByItemId.size !== existingItems.length || existingItems.some((i) => !priceByItemId.has(i.id))) {
    return { ok: false, error: '請為每一項明細填寫單價' };
  }

  const orderItems = existingItems.map((i) => {
    const unitPrice = priceByItemId.get(i.id)!;
    return {
      line_no: i.line_no,
      budget_code_id: i.budget_code_id,
      item_category: i.item_category,
      description: i.description,
      quantity: i.quantity,
      unit_price: unitPrice,
      total_price: unitPrice * i.quantity,
    };
  });
  const totalAmount = orderItems.reduce((sum, i) => sum + i.total_price, 0);

  const validation = validatePurchaseOrderInput({
    items: orderItems.map((i) => ({ unitPrice: i.unit_price })),
    totalAmount,
    quoteCount: input.quoteCount,
    quoteCountReason: input.quoteCountReason,
  });
  if (!validation.ok) return { ok: false, error: validation.error };

  const chainResult = await buildApprovalChainForForm(db, {
    applicantEmployeeId: employee.id,
    departmentId: order.department_id,
    budgetOwnerEmployeeId: order.budget_owner_employee_id,
    totalAmount,
  });
  if (!chainResult.ok) return { ok: false, error: chainResult.error };
  const chain = chainResult.chain;
  if (chain.length === 0) {
    return { ok: false, error: '修改後找不到適用的簽核人，請聯絡系統管理員' };
  }

  const { error: txError } = await db.rpc('resubmit_purchase_order', {
    p_order_id: orderId,
    p_supplier: input.supplierId,
    p_payment_method: input.paymentMethod,
    p_payment_terms: input.paymentTerms,
    p_expected_delivery_days: input.expectedDeliveryDays,
    p_quote_count: input.quoteCount,
    p_quote_count_reason: input.quoteCountReason,
    p_total: totalAmount,
    p_items: orderItems,
    p_steps: chain.map((step, idx) => ({
      step_order: idx + 1,
      approver_employee_id: step.approverEmployeeId,
      approver_role: step.approverRole,
    })),
  });
  if (txError) return { ok: false, error: '修改失敗，請稍後再試' };

  revalidatePath('/purchase-orders');
  revalidatePath(`/purchase-orders/${orderId}`);
  return { ok: true };
}

export async function withdrawPurchaseOrder(orderId: string): Promise<ActionResult> {
  const employee = await getCurrentEmployee(await createSupabaseServerClient());
  if (!employee) return { ok: false, error: '找不到您的員工資料' };
  const db = createSupabaseServiceRoleClient();

  const { data: order } = await db
    .from('purchase_orders')
    .select('id, applicant_employee_id, status, current_step_order')
    .eq('id', orderId)
    .maybeSingle();
  if (!order) return { ok: false, error: '找不到這張採購單' };
  if (order.applicant_employee_id !== employee.id) {
    return { ok: false, error: '只有申請人可以撤回這張採購單' };
  }
  if (order.status !== 'pending_approval' || order.current_step_order !== 1) {
    return { ok: false, error: '只有尚未有人簽核的採購單可以撤回' };
  }

  const { error } = await db
    .from('purchase_orders')
    .update({ status: 'withdrawn', current_step_order: null, updated_at: new Date().toISOString() })
    .eq('id', orderId);
  if (error) return { ok: false, error: '撤回失敗，請稍後再試' };

  revalidatePath('/purchase-orders');
  revalidatePath(`/purchase-orders/${orderId}`);
  return { ok: true };
}
```

- [ ] **Step 2: 在 `src/lib/purchase-orders/queries.ts` 的 `OrderDetail` 新增 `applicantEmployeeId`、`supplierId`，`OrderDetailItem` 新增 `itemId`**

把 `OrderDetailItem` 型別（第 11-19 行）新增 `itemId`：

```ts
export type OrderDetailItem = {
  lineNo: number;
  itemId: string;
  budgetCode: string;
  itemCategory: string;
  description: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
};
```

把 `OrderDetail` 型別（第 30-47 行）新增 `applicantEmployeeId`、`supplierId`：

```ts
export type OrderDetail = {
  id: string;
  caseNumber: string;
  status: string;
  totalAmount: number;
  supplierId: string;
  supplierName: string;
  paymentMethod: string;
  paymentTerms: string;
  expectedDeliveryDays: number | null;
  quoteCount: number;
  quoteCountReason: string | null;
  applicantEmployeeId: string;
  applicantName: string;
  departmentName: string;
  currentStepOrder: number | null;
  purchaseRequestId: string;
  items: OrderDetailItem[];
  steps: OrderDetailStep[];
};
```

把 `getPurchaseOrderDetail` 的 order select 字串（第 90-92 行）新增 `applicant_employee_id`、`supplier_id`：

```ts
    .select(
      'id, purchase_request_id, applicant_employee_id, supplier_id, total_amount, status, payment_method, payment_terms, expected_delivery_days, quote_count, quote_count_reason, current_step_order, procurement_cases(case_number), applicant:employees!applicant_employee_id(name), departments(name), suppliers(name)'
    )
```

把 items select（第 98-101 行）新增 `id`：

```ts
  const { data: items } = await supabase
    .from('purchase_order_items')
    .select('id, line_no, item_category, description, quantity, unit_price, total_price, budget_codes(code)')
    .eq('purchase_order_id', orderId)
    .order('line_no');
```

把回傳物件（第 112-144 行）新增對應欄位：

```ts
  return {
    id: order.id,
    caseNumber: (order.procurement_cases as unknown as { case_number: string }).case_number,
    status: order.status,
    totalAmount: Number(order.total_amount),
    supplierId: order.supplier_id,
    supplierName: (order.suppliers as unknown as { name: string }).name,
    paymentMethod: order.payment_method,
    paymentTerms: order.payment_terms,
    expectedDeliveryDays: order.expected_delivery_days,
    quoteCount: order.quote_count,
    quoteCountReason: order.quote_count_reason,
    applicantEmployeeId: order.applicant_employee_id,
    applicantName: (order.applicant as unknown as { name: string }).name,
    departmentName: (order.departments as unknown as { name: string }).name,
    currentStepOrder: order.current_step_order,
    purchaseRequestId: order.purchase_request_id,
    items: (items ?? []).map((i) => ({
      lineNo: i.line_no,
      itemId: i.id,
      budgetCode: (i.budget_codes as unknown as { code: string }).code,
      itemCategory: i.item_category,
      description: i.description,
      quantity: i.quantity,
      unitPrice: Number(i.unit_price),
      totalPrice: Number(i.total_price),
    })),
    steps: (steps ?? []).map((s) => ({
      stepOrder: s.step_order,
      approverEmployeeId: s.approver_employee_id,
      approverName: (s.approver as unknown as { name: string }).name,
      approverRole: s.approver_role,
      status: s.status,
      comment: s.comment,
    })),
  };
```

- [ ] **Step 3: 擴充 `src/app/purchase-orders/new/purchase-order-form.tsx` 支援 edit 模式**

把元件簽名（第 11-19 行）與 state 初始化換成：

```tsx
export function PurchaseOrderForm({
  purchaseRequestId,
  items,
  suppliers,
  mode = 'create',
  orderId,
  initialValues,
}: {
  purchaseRequestId: string;
  items: { id: string; description: string; quantity: number; budgetCode: string }[];
  suppliers: { id: string; name: string }[];
  mode?: 'create' | 'edit';
  orderId?: string;
  initialValues?: {
    prices: Record<string, string>;
    supplierId: string;
    paymentMethod: string;
    paymentTerms: string;
    expectedDeliveryDays: string;
    quoteCount: string;
    quoteCountReason: string;
  };
}) {
  const router = useRouter();
  const [prices, setPrices] = useState<Record<string, string>>(initialValues?.prices ?? {});
  const [supplierId, setSupplierId] = useState(initialValues?.supplierId ?? suppliers[0]?.id ?? '');
  const [paymentMethod, setPaymentMethod] = useState(initialValues?.paymentMethod ?? '匯款');
  const [paymentTerms, setPaymentTerms] = useState(initialValues?.paymentTerms ?? '貨到付款');
  const [expectedDeliveryDays, setExpectedDeliveryDays] = useState(initialValues?.expectedDeliveryDays ?? '14');
  const [quoteCount, setQuoteCount] = useState(initialValues?.quoteCount ?? '1');
  const [quoteCountReason, setQuoteCountReason] = useState(initialValues?.quoteCountReason ?? '');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
```

在檔案開頭 import 區塊新增 `updatePurchaseOrder`：

```tsx
import { createPurchaseOrder, updatePurchaseOrder } from '@/lib/purchase-orders/actions';
```

把 `onSubmit`（原第 34-56 行）換成：

```tsx
  const onSubmit = async () => {
    setError(null);
    setSubmitting(true);
    const itemsPayload = items.map((i) => ({
      purchaseOrderItemId: i.id,
      purchaseRequestItemId: i.id,
      unitPrice: Number(prices[i.id] ?? 0),
    }));
    const result =
      mode === 'edit' && orderId
        ? await updatePurchaseOrder(orderId, {
            supplierId,
            paymentMethod,
            paymentTerms,
            expectedDeliveryDays: expectedDeliveryDays === '' ? null : Number(expectedDeliveryDays),
            quoteCount: Number(quoteCount),
            quoteCountReason: quoteCountReason.trim() === '' ? null : quoteCountReason,
            items: itemsPayload.map((i) => ({ purchaseOrderItemId: i.purchaseOrderItemId, unitPrice: i.unitPrice })),
          })
        : await createPurchaseOrder({
            purchaseRequestId,
            supplierId,
            paymentMethod,
            paymentTerms,
            expectedDeliveryDays: expectedDeliveryDays === '' ? null : Number(expectedDeliveryDays),
            quoteCount: Number(quoteCount),
            quoteCountReason: quoteCountReason.trim() === '' ? null : quoteCountReason,
            items: itemsPayload.map((i) => ({ purchaseRequestItemId: i.purchaseRequestItemId, unitPrice: i.unitPrice })),
          });
    setSubmitting(false);
    if (result.ok) {
      router.push(mode === 'edit' && orderId ? `/purchase-orders/${orderId}` : `/purchase-orders/${(result as { orderId: string }).orderId}`);
    } else {
      setError(result.error);
    }
  };
```

**重要**：在 edit 模式下，`items` prop 傳入的 `id` 必須是既有 `purchase_order_items` 的 id（不是 `purchase_request_items` 的 id），因為 `updatePurchaseOrder`／`resubmit_purchase_order` 是用 `purchaseOrderItemId` 對應既有明細列，跟 create 模式用 `purchaseRequestItemId` 對應來源請購明細是兩個不同的 id 空間——這是 Task 12 Explore 報告中特別點出的鍵值不一致問題，edit 頁面（下一步）負責提供正確的 id 空間，元件本身不需要判斷。

把送出按鈕文字（原第 163 行）改為：

```tsx
        {submitting ? '送出中…' : mode === 'edit' ? '儲存修改' : '送出簽核'}
```

- [ ] **Step 4: 建立 `src/app/purchase-orders/[id]/edit/page.tsx`**

```tsx
import { redirect, notFound } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { getPurchaseOrderDetail } from '@/lib/purchase-orders/queries';
import { PurchaseOrderForm } from '../../new/purchase-order-form';

export default async function EditPurchaseOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const employee = await getCurrentEmployee(supabase);
  if (!employee) redirect('/login');

  const detail = await getPurchaseOrderDetail(id);
  if (!detail) notFound();
  if (detail.applicantEmployeeId !== employee.id) redirect(`/purchase-orders/${id}`);
  if (detail.status !== 'pending_approval' || detail.currentStepOrder !== 1) redirect(`/purchase-orders/${id}`);

  const { data: suppliers } = await supabase.from('suppliers').select('id, name').order('name');

  return (
    <main className="mx-auto max-w-4xl p-8">
      <h1 className="mb-6 text-2xl font-bold">修改採購單</h1>
      <PurchaseOrderForm
        purchaseRequestId=""
        items={detail.items.map((i) => ({
          id: i.itemId,
          description: i.description,
          quantity: i.quantity,
          budgetCode: i.budgetCode,
        }))}
        suppliers={(suppliers ?? []).map((s) => ({ id: s.id, name: s.name }))}
        mode="edit"
        orderId={id}
        initialValues={{
          prices: Object.fromEntries(detail.items.map((i) => [i.itemId, String(i.unitPrice)])),
          supplierId: detail.supplierId,
          paymentMethod: detail.paymentMethod,
          paymentTerms: detail.paymentTerms,
          expectedDeliveryDays: detail.expectedDeliveryDays != null ? String(detail.expectedDeliveryDays) : '',
          quoteCount: String(detail.quoteCount),
          quoteCountReason: detail.quoteCountReason ?? '',
        }}
      />
    </main>
  );
}
```

（`items` 用 `i.itemId`——即 Step 2 新增的 `purchase_order_items.id`——而不是 `lineNo`，因為 `updatePurchaseOrder`／`resubmit_purchase_order` 是用 `purchaseOrderItemId` 對應既有明細列的真正主鍵，不是行號。）

- [ ] **Step 5: 在 `src/app/purchase-orders/[id]/page.tsx` 新增編輯／撤回進入點**

在檔案開頭 import 區塊新增：

```tsx
import { withdrawPurchaseOrder } from '@/lib/purchase-orders/actions';
import { WithdrawButton } from '@/app/requests/[id]/withdraw-button';
```

在既有 `isCurrentApprover` 判斷（第 44-45 行）之後新增：

```tsx
  const isApplicant = !!employee && employee.id === detail.applicantEmployeeId;
  const canSelfEdit =
    isApplicant && detail.status === 'pending_approval' && detail.currentStepOrder === 1;
```

在 `{isCurrentApprover && <ApprovalActions orderId={detail.id} />}`（第 145 行）之前新增：

```tsx
      {canSelfEdit && (
        <section className="flex gap-3">
          <Link href={`/purchase-orders/${detail.id}/edit`} className="rounded border px-4 py-2 text-sm">
            編輯
          </Link>
          <WithdrawButton requestId={detail.id} onWithdraw={withdrawPurchaseOrder} redirectTo="/purchase-orders" />
        </section>
      )}
```

（`WithdrawButton` 是 Task 10 Step 6 建立的共用元件，這裡跨目錄 import 重用，不重複建立。）

- [ ] **Step 6: 寫整合測試**

比照 Task 10 Step 7 的 `tests/integration/purchase-request-edit-withdraw.test.ts` 結構，新增 `tests/integration/purchase-order-edit-withdraw.test.ts`，測試案例對稱：
- rejects update from a non-applicant
- allows the applicant to edit before any approval, rebuilding the chain（用 `createPurchaseOrder` 建立測試資料，來源請購單需先走完 `createPurchaseRequest` + `approvePurchaseRequestStep` 到 `approved`）
- rejects edit once the first step has already been approved
- rejects withdraw from a non-applicant
- allows the applicant to withdraw before any approval, without deleting the row

fixture 需求比請購單多一層（採購單需要一張已核准的來源請購單），需在 `beforeAll` 內先建立部門/主管/總經理/申請人/預算編號，並在每個測試前用 helper function 建立「已核准的請購單→新採購單」再測試 edit/withdraw，清理順序需注意外鍵（先刪 `purchase_order_items`／`approval_steps`，再刪 `purchase_orders`，再刪對應 `purchase_requests`／`purchase_request_items`，最後刪 `procurement_cases`）。

- [ ] **Step 7: 執行測試**

```bash
export $(grep -v '^#' .env.local | xargs)
npx vitest run tests/integration/purchase-order-edit-withdraw.test.ts
```

Expected: PASS

- [ ] **Step 8: 執行 typecheck、lint**

```bash
npm run typecheck
npm run lint
```

Expected: 皆為乾淨

- [ ] **Step 9: Commit**

```bash
git add src/lib/purchase-orders/ src/app/purchase-orders/ tests/integration/purchase-order-edit-withdraw.test.ts
git commit -m "feat: allow applicants to self-edit or withdraw purchase orders before first approval"
```

---

### Task 12: 驗收單 — 自行修改／撤回 actions + UI

**Files:**
- Modify: `src/lib/acceptances/actions.ts`
- Modify: `src/lib/acceptances/queries.ts`
- Modify: `src/app/acceptances/new/acceptance-form.tsx`
- Modify: `src/app/acceptances/[id]/page.tsx`
- Create: `src/app/acceptances/[id]/edit/page.tsx`
- Test: `tests/integration/acceptance-edit-withdraw.test.ts`

**Interfaces:**
- Produces: `updateAcceptance(acceptanceId: string, input: ResubmitAcceptanceInput): Promise<ActionResult>`；`withdrawAcceptance(acceptanceId: string): Promise<ActionResult>`；`AcceptanceDetail.applicantEmployeeId: string`（新增欄位）

- [ ] **Step 1: 在 `src/lib/acceptances/actions.ts` 新增 `updateAcceptance` 與 `withdrawAcceptance`**

在既有 `resubmitAcceptance` 函式（結束於第 477 行）之後新增：

```ts
export async function updateAcceptance(
  acceptanceId: string,
  input: ResubmitAcceptanceInput
): Promise<ActionResult> {
  const employee = await getCurrentEmployee(await createSupabaseServerClient());
  if (!employee) return { ok: false, error: '找不到您的員工資料' };
  const db = createSupabaseServiceRoleClient();

  const { data: acceptance } = await db
    .from('acceptances')
    .select(
      'id, applicant_employee_id, status, current_step_order, department_id, budget_owner_employee_id, total_amount'
    )
    .eq('id', acceptanceId)
    .maybeSingle();
  if (!acceptance) return { ok: false, error: '找不到這張驗收單' };
  if (acceptance.applicant_employee_id !== employee.id) {
    return { ok: false, error: '只有申請人可以修改這張驗收單' };
  }
  if (acceptance.status !== 'pending_approval' || acceptance.current_step_order !== 1) {
    return { ok: false, error: '只有尚未有人簽核的驗收單可以修改' };
  }

  const { data: existingItems } = await db
    .from('acceptance_items')
    .select('id, line_no, purchase_order_item_id, description, quantity, amount')
    .eq('acceptance_id', acceptanceId)
    .order('line_no');
  if (!existingItems || existingItems.length === 0) {
    return { ok: false, error: '找不到驗收明細' };
  }

  const passFailByItemId = new Map(input.items.map((i) => [i.acceptanceItemId, i.passFail]));
  if (
    passFailByItemId.size !== existingItems.length ||
    existingItems.some((i) => !passFailByItemId.has(i.id))
  ) {
    return { ok: false, error: '請為每一項明細填寫驗收結果' };
  }

  const validation = validateAcceptanceInput({
    items: existingItems.map((i) => ({ passFail: passFailByItemId.get(i.id)! })),
  });
  if (!validation.ok) return { ok: false, error: validation.error };

  const chainResult = await buildApprovalChainForForm(db, {
    applicantEmployeeId: employee.id,
    departmentId: acceptance.department_id,
    budgetOwnerEmployeeId: acceptance.budget_owner_employee_id,
    totalAmount: Number(acceptance.total_amount),
  });
  if (!chainResult.ok) return { ok: false, error: chainResult.error };
  const chain = chainResult.chain;
  if (chain.length === 0) {
    return { ok: false, error: '修改後找不到適用的簽核人，請聯絡系統管理員' };
  }

  const items = existingItems.map((i) => ({
    line_no: i.line_no,
    purchase_order_item_id: i.purchase_order_item_id,
    description: i.description,
    quantity: i.quantity,
    amount: Number(i.amount),
    pass_fail: passFailByItemId.get(i.id)!,
  }));

  const { error: txError } = await db.rpc('resubmit_acceptance', {
    p_acceptance_id: acceptanceId,
    p_contractor_supplier: input.contractorSupplierId,
    p_acceptance_date: input.acceptanceDate,
    p_items: items,
    p_steps: chain.map((step, idx) => ({
      step_order: idx + 1,
      approver_employee_id: step.approverEmployeeId,
      approver_role: step.approverRole,
    })),
  });
  if (txError) return { ok: false, error: '修改失敗，請稍後再試' };

  revalidatePath('/acceptances');
  revalidatePath(`/acceptances/${acceptanceId}`);
  return { ok: true };
}

export async function withdrawAcceptance(acceptanceId: string): Promise<ActionResult> {
  const employee = await getCurrentEmployee(await createSupabaseServerClient());
  if (!employee) return { ok: false, error: '找不到您的員工資料' };
  const db = createSupabaseServiceRoleClient();

  const { data: acceptance } = await db
    .from('acceptances')
    .select('id, applicant_employee_id, status, current_step_order')
    .eq('id', acceptanceId)
    .maybeSingle();
  if (!acceptance) return { ok: false, error: '找不到這張驗收單' };
  if (acceptance.applicant_employee_id !== employee.id) {
    return { ok: false, error: '只有申請人可以撤回這張驗收單' };
  }
  if (acceptance.status !== 'pending_approval' || acceptance.current_step_order !== 1) {
    return { ok: false, error: '只有尚未有人簽核的驗收單可以撤回' };
  }

  const { error } = await db
    .from('acceptances')
    .update({ status: 'withdrawn', current_step_order: null, updated_at: new Date().toISOString() })
    .eq('id', acceptanceId);
  if (error) return { ok: false, error: '撤回失敗，請稍後再試' };

  revalidatePath('/acceptances');
  revalidatePath(`/acceptances/${acceptanceId}`);
  return { ok: true };
}
```

- [ ] **Step 2: 在 `src/lib/acceptances/queries.ts` 的 `AcceptanceDetail` 新增 `applicantEmployeeId`、`contractorSupplierId`**

（`AcceptanceDetailItem` 已經有 `itemId` 欄位，不需要修改。）

把 `AcceptanceDetail` 型別（第 30-42 行）新增欄位：

```ts
export type AcceptanceDetail = {
  id: string;
  caseNumber: string;
  status: string;
  totalAmount: number;
  contractorSupplierId: string;
  contractorSupplierName: string;
  acceptanceDate: string;
  applicantEmployeeId: string;
  applicantName: string;
  departmentName: string;
  currentStepOrder: number | null;
  items: AcceptanceDetailItem[];
  steps: AcceptanceDetailStep[];
};
```

把 `getAcceptanceDetail` 的 select 字串（第 80-82 行）新增 `applicant_employee_id`、`contractor_supplier_id`：

```ts
    .select(
      'id, total_amount, status, acceptance_date, current_step_order, applicant_employee_id, contractor_supplier_id, procurement_cases(case_number), applicant:employees!applicant_employee_id(name), departments(name), suppliers:suppliers!contractor_supplier_id(name)'
    )
```

把回傳物件（第 102-129 行）新增對應欄位：

```ts
  return {
    id: acceptance.id,
    caseNumber: (acceptance.procurement_cases as unknown as { case_number: string }).case_number,
    status: acceptance.status,
    totalAmount: Number(acceptance.total_amount),
    contractorSupplierId: acceptance.contractor_supplier_id,
    contractorSupplierName: (acceptance.suppliers as unknown as { name: string }).name,
    acceptanceDate: acceptance.acceptance_date,
    applicantEmployeeId: acceptance.applicant_employee_id,
    applicantName: (acceptance.applicant as unknown as { name: string }).name,
    departmentName: (acceptance.departments as unknown as { name: string }).name,
    currentStepOrder: acceptance.current_step_order,
    items: (items ?? []).map((i) => ({
      lineNo: i.line_no,
      itemId: i.id,
      description: i.description,
      quantity: i.quantity,
      amount: Number(i.amount),
      passFail: i.pass_fail as 'pass' | 'fail',
      propertyTag: i.property_tag,
    })),
    steps: (steps ?? []).map((s) => ({
      stepOrder: s.step_order,
      approverEmployeeId: s.approver_employee_id,
      approverName: (s.approver as unknown as { name: string }).name,
      approverRole: s.approver_role,
      status: s.status,
      comment: s.comment,
    })),
  };
```

- [ ] **Step 3: 擴充 `src/app/acceptances/new/acceptance-form.tsx` 支援 edit 模式**

把元件簽名與 state 初始化（第 7-23 行）換成：

```tsx
export function AcceptanceForm({
  purchaseOrderId,
  items,
  suppliers,
  mode = 'create',
  acceptanceId,
  initialValues,
}: {
  purchaseOrderId: string;
  items: { id: string; description: string; quantity: number }[];
  suppliers: { id: string; name: string }[];
  mode?: 'create' | 'edit';
  acceptanceId?: string;
  initialValues?: {
    contractorSupplierId: string;
    acceptanceDate: string;
    passFail: Record<string, 'pass' | 'fail'>;
  };
}) {
  const router = useRouter();
  const [contractorSupplierId, setContractorSupplierId] = useState(
    initialValues?.contractorSupplierId ?? suppliers[0]?.id ?? ''
  );
  const [acceptanceDate, setAcceptanceDate] = useState(
    initialValues?.acceptanceDate ?? new Date().toISOString().slice(0, 10)
  );
  const [passFail, setPassFail] = useState<Record<string, 'pass' | 'fail'>>(
    initialValues?.passFail ?? Object.fromEntries(items.map((i) => [i.id, 'pass' as const]))
  );
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
```

在檔案開頭 import 區塊新增 `updateAcceptance`：

```tsx
import { createAcceptance, updateAcceptance } from '@/lib/acceptances/actions';
```

把 `onSubmit`（原第 25-40 行）換成：

```tsx
  const onSubmit = async () => {
    setError(null);
    setSubmitting(true);
    const result =
      mode === 'edit' && acceptanceId
        ? await updateAcceptance(acceptanceId, {
            contractorSupplierId,
            acceptanceDate,
            items: items.map((i) => ({ acceptanceItemId: i.id, passFail: passFail[i.id] ?? 'pass' })),
          })
        : await createAcceptance({
            purchaseOrderId,
            contractorSupplierId,
            acceptanceDate,
            items: items.map((i) => ({ purchaseOrderItemId: i.id, passFail: passFail[i.id] ?? 'pass' })),
          });
    setSubmitting(false);
    if (result.ok) {
      router.push(
        mode === 'edit' && acceptanceId
          ? `/acceptances/${acceptanceId}`
          : `/acceptances/${(result as { acceptanceId: string }).acceptanceId}`
      );
    } else {
      setError(result.error);
    }
  };
```

**重要**：跟 Task 11 的採購單一樣，edit 模式下傳入的 `items` 的 `id` 必須是既有 `acceptance_items` 的 id（不是 `purchase_order_items` 的 id），因為 `updateAcceptance`／`resubmitAcceptance` 用 `acceptanceItemId` 對應既有明細列。

把送出按鈕文字（原第 102 行）改為：

```tsx
        {submitting ? '送出中…' : mode === 'edit' ? '儲存修改' : '送出簽核'}
```

- [ ] **Step 4: 建立 `src/app/acceptances/[id]/edit/page.tsx`**

```tsx
import { redirect, notFound } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { getAcceptanceDetail } from '@/lib/acceptances/queries';
import { AcceptanceForm } from '../../new/acceptance-form';

export default async function EditAcceptancePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const employee = await getCurrentEmployee(supabase);
  if (!employee) redirect('/login');

  const detail = await getAcceptanceDetail(id);
  if (!detail) notFound();
  if (detail.applicantEmployeeId !== employee.id) redirect(`/acceptances/${id}`);
  if (detail.status !== 'pending_approval' || detail.currentStepOrder !== 1) redirect(`/acceptances/${id}`);

  const { data: suppliers } = await supabase.from('suppliers').select('id, name').order('name');

  return (
    <main className="mx-auto max-w-4xl p-8">
      <h1 className="mb-6 text-2xl font-bold">修改驗收單</h1>
      <AcceptanceForm
        purchaseOrderId=""
        items={detail.items.map((i) => ({
          id: i.itemId,
          description: i.description,
          quantity: i.quantity,
        }))}
        suppliers={(suppliers ?? []).map((s) => ({ id: s.id, name: s.name }))}
        mode="edit"
        acceptanceId={id}
        initialValues={{
          contractorSupplierId: detail.contractorSupplierId,
          acceptanceDate: detail.acceptanceDate,
          passFail: Object.fromEntries(detail.items.map((i) => [i.itemId, i.passFail])),
        }}
      />
    </main>
  );
}
```

（`i.itemId` 是既有 `AcceptanceDetailItem` 欄位（`acceptance_items.id`），`detail.contractorSupplierId` 是 Step 2 新增的欄位，兩者都已在上面 Step 2 就緒，不需要額外調整。）

- [ ] **Step 5: 在 `src/app/acceptances/[id]/page.tsx` 新增編輯／撤回進入點**

在檔案開頭 import 區塊新增：

```tsx
import { withdrawAcceptance } from '@/lib/acceptances/actions';
import { WithdrawButton } from '@/app/requests/[id]/withdraw-button';
```

在既有 `isCurrentApprover` 判斷（第 46-47 行）之後新增：

```tsx
  const isApplicant = !!employee && employee.id === detail.applicantEmployeeId;
  const canSelfEdit =
    isApplicant && detail.status === 'pending_approval' && detail.currentStepOrder === 1;
```

在 `{isCurrentApprover && <ApprovalActions acceptanceId={detail.id} />}`（第 130 行）之前新增：

```tsx
      {canSelfEdit && (
        <section className="flex gap-3">
          <Link href={`/acceptances/${detail.id}/edit`} className="rounded border px-4 py-2 text-sm">
            編輯
          </Link>
          <WithdrawButton requestId={detail.id} onWithdraw={withdrawAcceptance} redirectTo="/acceptances" />
        </section>
      )}
```

- [ ] **Step 6: 寫整合測試**

比照 Task 11 Step 6，新增 `tests/integration/acceptance-edit-withdraw.test.ts`，測試案例對稱（rejects update/withdraw from non-applicant、allows edit before approval with chain rebuild、rejects edit after first step approved、allows withdraw before approval）。fixture 需要一路建立「已核准請購單 → 已核准採購單 → 新驗收單」。

- [ ] **Step 7: 執行測試**

```bash
export $(grep -v '^#' .env.local | xargs)
npx vitest run tests/integration/acceptance-edit-withdraw.test.ts
```

Expected: PASS

- [ ] **Step 8: 執行 typecheck、lint**

```bash
npm run typecheck
npm run lint
```

Expected: 皆為乾淨

- [ ] **Step 9: Commit**

```bash
git add src/lib/acceptances/ src/app/acceptances/ tests/integration/acceptance-edit-withdraw.test.ts
git commit -m "feat: allow applicants to self-edit or withdraw acceptances before first approval"
```

---

### Task 13: 費用申請單 — 自行修改／撤回 actions + UI

**Files:**
- Modify: `src/lib/expense-requests/actions.ts`
- Modify: `src/lib/expense-requests/queries.ts`
- Modify: `src/app/expense-requests/new/expense-request-form.tsx`
- Modify: `src/app/expense-requests/[id]/page.tsx`
- Create: `src/app/expense-requests/[id]/edit/page.tsx`
- Test: `tests/integration/expense-request-edit-withdraw.test.ts`

**Interfaces:**
- Produces: `updateExpenseRequest(expenseRequestId: string, input: ResubmitExpenseRequestInput): Promise<ActionResult>`；`withdrawExpenseRequest(expenseRequestId: string): Promise<ActionResult>`；`ExpenseRequestDetail.applicantEmployeeId: string`（新增欄位，`ExpenseRequestDetail` 已在 Task 6 之前的既有程式碼中定義於 `src/lib/expense-requests/queries.ts`）

- [ ] **Step 1: 在 `src/lib/expense-requests/actions.ts` 新增 `updateExpenseRequest` 與 `withdrawExpenseRequest`**

在既有 `resubmitExpenseRequest` 函式（結束於第 548 行，Task 6 新增的 `createStandaloneExpenseRequest` 之後）新增：

```ts
export async function updateExpenseRequest(
  expenseRequestId: string,
  input: ResubmitExpenseRequestInput
): Promise<ActionResult> {
  const employee = await getCurrentEmployee(await createSupabaseServerClient());
  if (!employee) return { ok: false, error: '找不到您的員工資料' };
  const db = createSupabaseServiceRoleClient();

  const { data: expenseRequest } = await db
    .from('expense_requests')
    .select(
      'id, applicant_employee_id, status, current_step_order, department_id, budget_owner_employee_id, purchase_order_id, acceptance_id'
    )
    .eq('id', expenseRequestId)
    .maybeSingle();
  if (!expenseRequest) return { ok: false, error: '找不到這張費用申請單' };
  if (expenseRequest.applicant_employee_id !== employee.id) {
    return { ok: false, error: '只有申請人可以修改這張費用申請單' };
  }
  if (expenseRequest.status !== 'pending_approval' || expenseRequest.current_step_order !== 1) {
    return { ok: false, error: '只有尚未有人簽核的費用申請單可以修改' };
  }

  let sourceItems: SourceItem[] = [];
  if (expenseRequest.acceptance_id) {
    const { data: items } = await db
      .from('acceptance_items')
      .select('id, purchase_order_item_id, description, amount')
      .eq('acceptance_id', expenseRequest.acceptance_id);
    sourceItems = (items ?? []).map((i) => ({
      id: i.id,
      purchase_order_item_id: i.purchase_order_item_id,
      description: i.description,
      amount: Number(i.amount),
    }));
  } else if (expenseRequest.purchase_order_id) {
    const { data: items } = await db
      .from('purchase_order_items')
      .select('id, description, total_price')
      .eq('purchase_order_id', expenseRequest.purchase_order_id);
    sourceItems = (items ?? []).map((i) => ({
      id: i.id,
      purchase_order_item_id: i.id,
      description: i.description,
      amount: Number(i.total_price),
    }));
  } else {
    return { ok: false, error: '免走採購流程的費用申請單目前不支援編輯，請改用撤回後重新建立' };
  }

  const includedSet = new Set(input.includedSourceItemIds);
  const includedItems = sourceItems.filter((i) => includedSet.has(i.id));

  const validation = validateExpenseRequestInput({
    payeeType: input.payeeType,
    payeeSupplierId: input.payeeSupplierId,
    bankAccount: input.bankAccount,
    includedItemCount: includedItems.length,
  });
  if (!validation.ok) return { ok: false, error: validation.error };

  const totalAmount = includedItems.reduce((sum, i) => sum + i.amount, 0);

  const referenceDate = new Date().toISOString().slice(0, 10);
  const expectedPaymentDate =
    input.expectedPaymentDate ??
    (input.invoiceMonth ? computeDefaultExpectedPaymentDate(input.invoiceMonth) : null);
  const batch = computePaymentBatchDate({
    payeeType: input.payeeType,
    referenceDate,
    expectedPaymentDate,
    invoiceMonth: input.invoiceMonth,
  });

  const chainResult = await buildApprovalChainForForm(db, {
    applicantEmployeeId: employee.id,
    departmentId: expenseRequest.department_id,
    budgetOwnerEmployeeId: expenseRequest.budget_owner_employee_id,
    totalAmount,
  });
  if (!chainResult.ok) return { ok: false, error: chainResult.error };
  const chain = chainResult.chain;
  if (chain.length === 0) {
    return { ok: false, error: '修改後找不到適用的簽核人，請聯絡系統管理員' };
  }

  const { error: txError } = await db.rpc('resubmit_expense_request', {
    p_expense_request_id: expenseRequestId,
    p_payee_type: input.payeeType,
    p_payee_supplier: input.payeeType === 'supplier' ? input.payeeSupplierId : null,
    p_payment_method: input.paymentMethod,
    p_bank_name: input.payeeType === 'employee' ? input.bankName : null,
    p_bank_account: input.payeeType === 'employee' ? input.bankAccount : null,
    p_account_name: input.payeeType === 'employee' ? input.accountName : null,
    p_invoice_month: input.invoiceMonth,
    p_expected_payment_date: expectedPaymentDate,
    p_payment_batch_date: batch.batchDate,
    p_total: totalAmount,
    p_items: includedItems.map((i, idx) => ({
      line_no: idx + 1,
      purchase_order_item_id: i.purchase_order_item_id,
      description: i.description,
      amount: i.amount,
    })),
    p_steps: chain.map((step, idx) => ({
      step_order: idx + 1,
      approver_employee_id: step.approverEmployeeId,
      approver_role: step.approverRole,
    })),
  });
  if (txError) return { ok: false, error: '修改失敗，請稍後再試' };

  revalidatePath('/approvals');
  revalidatePath(`/expense-requests/${expenseRequestId}`);
  return { ok: true };
}

export async function withdrawExpenseRequest(expenseRequestId: string): Promise<ActionResult> {
  const employee = await getCurrentEmployee(await createSupabaseServerClient());
  if (!employee) return { ok: false, error: '找不到您的員工資料' };
  const db = createSupabaseServiceRoleClient();

  const { data: expenseRequest } = await db
    .from('expense_requests')
    .select('id, applicant_employee_id, status, current_step_order')
    .eq('id', expenseRequestId)
    .maybeSingle();
  if (!expenseRequest) return { ok: false, error: '找不到這張費用申請單' };
  if (expenseRequest.applicant_employee_id !== employee.id) {
    return { ok: false, error: '只有申請人可以撤回這張費用申請單' };
  }
  if (expenseRequest.status !== 'pending_approval' || expenseRequest.current_step_order !== 1) {
    return { ok: false, error: '只有尚未有人簽核的費用申請單可以撤回' };
  }

  const { error } = await db
    .from('expense_requests')
    .update({ status: 'withdrawn', current_step_order: null, updated_at: new Date().toISOString() })
    .eq('id', expenseRequestId);
  if (error) return { ok: false, error: '撤回失敗，請稍後再試' };

  revalidatePath('/approvals');
  revalidatePath(`/expense-requests/${expenseRequestId}`);
  return { ok: true };
}
```

（`updateExpenseRequest` 刻意排除免走採購流程的費用申請單——因為那種案件沒有 `acceptance_items`／`purchase_order_items` 可以重新拉明細，`resubmit_expense_request` RPC 也是設計成從既有來源重抓明細，不是接受任意自訂明細。標準流程的費用申請單可以正常編輯；standalone 類型的編輯留待日後有需求時再設計，目前先讓使用者改用撤回＋重新建立。）

- [ ] **Step 2: 在 `src/lib/expense-requests/queries.ts` 新增 `applicantEmployeeId`、`sourceItemId`，並新增 `getExpenseRequestSourceItems` 供編輯頁重建完整來源明細清單**

`ExpenseRequestDetailItem`（第 12-16 行）目前只有 `lineNo`/`description`/`amount`，沒有底層來源明細（`acceptance_items`／`purchase_order_items`）的 id，也沒有 `expense_request_items` 自己的 id。編輯頁需要知道「這張費用申請單的來源（採購單或驗收單）底下完整的明細清單」才能讓使用者重新勾選/取消勾選（`detail.items` 只包含已勾選的項次）。新增 `sourceItemId` 欄位並新增一支查詢函式解決這個問題。

把 `ExpenseRequestDetailItem` 型別換成：

```ts
export type ExpenseRequestDetailItem = {
  lineNo: number;
  sourceItemId: string;
  description: string;
  amount: number;
};
```

把 `ExpenseRequestDetail` 型別（第 27-48 行）新增欄位：

```ts
export type ExpenseRequestDetail = {
  id: string;
  caseNumber: string;
  status: string;
  totalAmount: number;
  payeeType: 'employee' | 'supplier';
  payeeName: string;
  paymentMethod: string;
  bankName: string | null;
  bankAccount: string | null;
  accountName: string | null;
  invoiceMonth: string | null;
  expectedPaymentDate: string | null;
  paymentBatchDate: string | null;
  applicantEmployeeId: string;
  applicantName: string;
  departmentName: string;
  currentStepOrder: number | null;
  purchaseOrderPaymentTerms: string;
  paymentTermsConsistent: boolean;
  items: ExpenseRequestDetailItem[];
  steps: ExpenseRequestDetailStep[];
};
```

把 `getExpenseRequestDetail` 的 select 字串（第 89-90 行）新增 `applicant_employee_id`：

```ts
      'id, total_amount, status, payee_type, payment_method, bank_name, bank_account, account_name, invoice_month, expected_payment_date, payment_batch_date, current_step_order, applicant_employee_id, procurement_cases(case_number), applicant:employees!applicant_employee_id(name), departments(name), payee_supplier:suppliers!payee_supplier_id(name), purchase_orders(payment_terms, updated_at)'
```

把回傳物件（第 123-156 行）新增對應欄位：

```ts
    applicantEmployeeId: expenseRequest.applicant_employee_id,
    applicantName,
```

（插入在既有 `applicantName,` 那一行之前即可，其餘欄位不變。）

**注意：** 這個 select 目前假設 `expense_requests.purchase_orders(payment_terms, updated_at)` 一定存在（因為既有 `checkPaymentTermsConsistency` 呼叫依賴這個關聯）。Task 6/7 新增的 standalone 費用申請單 `purchase_order_id` 為 `null`，這個查詢在 standalone 案件上會讓 `expenseRequest.purchase_orders` 變成 `null`，導致第 112-115 行 `(expenseRequest.purchase_orders as unknown as {...}).payment_terms` 對 `null` 取屬性而丟出執行期錯誤。**這是 Task 7 引入的既有缺陷，必須在本 Task 一併修正**（因為兩者都會修改 `getExpenseRequestDetail`，此時是最自然的修正時機）：把第 111-121 行改成：

```ts
  const applicantName = (expenseRequest.applicant as unknown as { name: string }).name;
  const payeeSupplier = expenseRequest.payee_supplier as unknown as { name: string } | null;
  const order = expenseRequest.purchase_orders as unknown as {
    payment_terms: string;
    updated_at: string;
  } | null;

  const consistency = order
    ? checkPaymentTermsConsistency({
        paymentTerms: order.payment_terms,
        orderApprovedDate: order.updated_at.slice(0, 10),
        expectedPaymentDate: expenseRequest.expected_payment_date,
      })
    : { consistent: true };
```

並把回傳物件中 `purchaseOrderPaymentTerms: order.payment_terms,`（第 141 行）改為：

```ts
    purchaseOrderPaymentTerms: order?.payment_terms ?? '（免走採購流程）',
```

把 items select（第 95-99 行）新增 `purchase_order_item_id`：

```ts
  const { data: items } = await supabase
    .from('expense_request_items')
    .select('line_no, purchase_order_item_id, description, amount')
    .eq('expense_request_id', expenseRequestId)
    .order('line_no');
```

把回傳物件裡 `items` 的映射（第 143-147 行）改為：

```ts
    items: (items ?? []).map((i) => ({
      lineNo: i.line_no,
      sourceItemId: i.purchase_order_item_id,
      description: i.description,
      amount: Number(i.amount),
    })),
```

最後，在檔案末尾（`getMyExpenseRequestApprovalQueue` 之後）新增一支查詢函式，供編輯頁重建「這張費用申請單來源底下完整的明細清單」（含未勾選的項次）：

```ts
export type ExpenseRequestSourceItem = { id: string; description: string; amount: number };

export async function getExpenseRequestSourceItems(
  expenseRequestId: string
): Promise<ExpenseRequestSourceItem[]> {
  const supabase = await createSupabaseServerClient();
  const { data: expenseRequest } = await supabase
    .from('expense_requests')
    .select('acceptance_id, purchase_order_id')
    .eq('id', expenseRequestId)
    .maybeSingle();
  if (!expenseRequest) return [];

  if (expenseRequest.acceptance_id) {
    const { data: items } = await supabase
      .from('acceptance_items')
      .select('id, description, amount')
      .eq('acceptance_id', expenseRequest.acceptance_id);
    return (items ?? []).map((i) => ({ id: i.id, description: i.description, amount: Number(i.amount) }));
  }
  if (expenseRequest.purchase_order_id) {
    const { data: items } = await supabase
      .from('purchase_order_items')
      .select('id, description, total_price')
      .eq('purchase_order_id', expenseRequest.purchase_order_id);
    return (items ?? []).map((i) => ({ id: i.id, description: i.description, amount: Number(i.total_price) }));
  }
  return [];
}
```

- [ ] **Step 3: 擴充 `src/app/expense-requests/new/expense-request-form.tsx` 支援 edit 模式**

把元件簽名與 state 初始化（第 7-29 行）換成：

```tsx
export function ExpenseRequestForm({
  purchaseOrderId,
  sourceItems,
  suppliers,
  mode = 'create',
  expenseRequestId,
  initialValues,
}: {
  purchaseOrderId: string;
  sourceItems: { id: string; description: string; amount: number }[];
  suppliers: { id: string; name: string }[];
  mode?: 'create' | 'edit';
  expenseRequestId?: string;
  initialValues?: {
    payeeType: 'employee' | 'supplier';
    payeeSupplierId: string;
    paymentMethod: string;
    bankName: string;
    bankAccount: string;
    accountName: string;
    invoiceMonth: string;
    expectedPaymentDate: string;
    included: Record<string, boolean>;
  };
}) {
  const router = useRouter();
  const [payeeType, setPayeeType] = useState<'employee' | 'supplier'>(initialValues?.payeeType ?? 'supplier');
  const [payeeSupplierId, setPayeeSupplierId] = useState(initialValues?.payeeSupplierId ?? suppliers[0]?.id ?? '');
  const [paymentMethod, setPaymentMethod] = useState(initialValues?.paymentMethod ?? '匯款');
  const [bankName, setBankName] = useState(initialValues?.bankName ?? '');
  const [bankAccount, setBankAccount] = useState(initialValues?.bankAccount ?? '');
  const [accountName, setAccountName] = useState(initialValues?.accountName ?? '');
  const [invoiceMonth, setInvoiceMonth] = useState(initialValues?.invoiceMonth ?? '');
  const [expectedPaymentDate, setExpectedPaymentDate] = useState(initialValues?.expectedPaymentDate ?? '');
  const [included, setIncluded] = useState<Record<string, boolean>>(
    initialValues?.included ?? Object.fromEntries(sourceItems.map((i) => [i.id, true]))
  );
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
```

在檔案開頭 import 區塊新增 `updateExpenseRequest`：

```tsx
import { createExpenseRequest, updateExpenseRequest } from '@/lib/expense-requests/actions';
```

把 `onSubmit`（原第 33-54 行）換成：

```tsx
  const onSubmit = async () => {
    setError(null);
    setSubmitting(true);
    const payload = {
      payeeType,
      payeeSupplierId: payeeType === 'supplier' ? payeeSupplierId : null,
      paymentMethod,
      bankName: payeeType === 'employee' ? bankName : null,
      bankAccount: payeeType === 'employee' ? bankAccount : null,
      accountName: payeeType === 'employee' ? accountName : null,
      invoiceMonth: invoiceMonth.trim() === '' ? null : invoiceMonth,
      expectedPaymentDate: expectedPaymentDate.trim() === '' ? null : expectedPaymentDate,
      includedSourceItemIds: sourceItems.filter((i) => included[i.id]).map((i) => i.id),
    };
    const result =
      mode === 'edit' && expenseRequestId
        ? await updateExpenseRequest(expenseRequestId, payload)
        : await createExpenseRequest({ purchaseOrderId, ...payload });
    setSubmitting(false);
    if (result.ok) {
      router.push(
        mode === 'edit' && expenseRequestId
          ? `/expense-requests/${expenseRequestId}`
          : `/expense-requests/${(result as { expenseRequestId: string }).expenseRequestId}`
      );
    } else {
      setError(result.error);
    }
  };
```

把送出按鈕文字（原第 170 行）改為：

```tsx
        {submitting ? '送出中…' : mode === 'edit' ? '儲存修改' : '送出簽核'}
```

- [ ] **Step 4: 建立 `src/app/expense-requests/[id]/edit/page.tsx`**

```tsx
import { redirect, notFound } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { getExpenseRequestDetail, getExpenseRequestSourceItems } from '@/lib/expense-requests/queries';
import { ExpenseRequestForm } from '../../new/expense-request-form';

export default async function EditExpenseRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const employee = await getCurrentEmployee(supabase);
  if (!employee) redirect('/login');

  const detail = await getExpenseRequestDetail(id);
  if (!detail) notFound();
  if (detail.applicantEmployeeId !== employee.id) redirect(`/expense-requests/${id}`);
  if (detail.status !== 'pending_approval' || detail.currentStepOrder !== 1) redirect(`/expense-requests/${id}`);

  const [sourceItems, suppliersResult] = await Promise.all([
    getExpenseRequestSourceItems(id),
    supabase.from('suppliers').select('id, name').order('name'),
  ]);
  const includedSourceItemIds = new Set(detail.items.map((i) => i.sourceItemId));

  return (
    <main className="mx-auto max-w-4xl p-8">
      <h1 className="mb-6 text-2xl font-bold">修改費用申請單</h1>
      <ExpenseRequestForm
        purchaseOrderId=""
        sourceItems={sourceItems}
        suppliers={(suppliersResult.data ?? []).map((s) => ({ id: s.id, name: s.name }))}
        mode="edit"
        expenseRequestId={id}
        initialValues={{
          payeeType: detail.payeeType,
          payeeSupplierId: '',
          paymentMethod: detail.paymentMethod,
          bankName: detail.bankName ?? '',
          bankAccount: detail.bankAccount ?? '',
          accountName: detail.accountName ?? '',
          invoiceMonth: detail.invoiceMonth ?? '',
          expectedPaymentDate: detail.expectedPaymentDate ?? '',
          included: Object.fromEntries(
            sourceItems.map((si) => [si.id, includedSourceItemIds.has(si.id)])
          ),
        }}
      />
    </main>
  );
}
```

（`sourceItems` 來自 Step 2 新增的 `getExpenseRequestSourceItems`——回傳這張費用申請單來源底下「完整」的明細清單，而不是只有已勾選的項次；`included` 依 `detail.items`（已勾選項次的 `sourceItemId`）標記哪些預設打勾，讓使用者可以在編輯頁重新勾選/取消勾選未包含的來源明細。）

- [ ] **Step 5: 在 `src/app/expense-requests/[id]/page.tsx` 新增編輯／撤回進入點**

在檔案開頭 import 區塊新增：

```tsx
import { withdrawExpenseRequest } from '@/lib/expense-requests/actions';
import { WithdrawButton } from '@/app/requests/[id]/withdraw-button';
```

在既有 `isCurrentApprover` 判斷（第 44-45 行）之後新增：

```tsx
  const isApplicant = !!employee && employee.id === detail.applicantEmployeeId;
  const canSelfEdit =
    isApplicant && detail.status === 'pending_approval' && detail.currentStepOrder === 1;
```

在 `{isCurrentApprover && <ApprovalActions expenseRequestId={detail.id} />}`（第 131 行）之前新增：

```tsx
      {canSelfEdit && (
        <section className="flex gap-3">
          {detail.purchaseOrderPaymentTerms !== '（免走採購流程）' && (
            <Link href={`/expense-requests/${detail.id}/edit`} className="rounded border px-4 py-2 text-sm">
              編輯
            </Link>
          )}
          <WithdrawButton requestId={detail.id} onWithdraw={withdrawExpenseRequest} redirectTo="/expense-requests" />
        </section>
      )}
```

（撤回對 standalone 與一般費用申請單都適用；編輯連結依 Step 1 的設計排除 standalone 案件，用 `purchaseOrderPaymentTerms === '（免走採購流程）'` 這個 Step 2 剛新增的哨兵值判斷是否為 standalone——這是重用既有欄位的取巧做法，若日後覺得不夠明確，可以在 `ExpenseRequestDetail` 另外新增一個明確的 `isStandalone: boolean` 欄位取代。）

- [ ] **Step 6: 寫整合測試**

比照 Task 10/11/12，新增 `tests/integration/expense-request-edit-withdraw.test.ts`，涵蓋標準流程費用申請單的 edit/withdraw（fixture 需要一路建立到「已核准請購單 → 已核准採購單 → 已核准驗收單 → 費用申請單」），以及額外一個案例：對 standalone 費用申請單呼叫 `updateExpenseRequest` 應回傳 `{ ok: false, error: '免走採購流程的費用申請單目前不支援編輯，請改用撤回後重新建立' }`；對 standalone 費用申請單呼叫 `withdrawExpenseRequest` 應正常成功。

- [ ] **Step 7: 執行測試**

```bash
export $(grep -v '^#' .env.local | xargs)
npx vitest run tests/integration/expense-request-edit-withdraw.test.ts
```

Expected: PASS

- [ ] **Step 8: 執行 typecheck、lint**

```bash
npm run typecheck
npm run lint
```

Expected: 皆為乾淨

- [ ] **Step 9: Commit**

```bash
git add src/lib/expense-requests/ src/app/expense-requests/ tests/integration/expense-request-edit-withdraw.test.ts
git commit -m "feat: allow applicants to self-edit or withdraw expense requests before first approval"
```

---

### Task 14: 案件追蹤頁新增「已撤回」分類

**Files:**
- Modify: `src/lib/case-tracking/determine-bucket.ts`
- Modify: `src/lib/case-tracking/queries.ts`
- Modify: `src/app/case-tracking/page.tsx`（分頁籤與表格皆內嵌在這單一檔案裡，沒有獨立的 tabs 元件）
- Test: Modify `tests/integration/case-tracking-queries.test.ts`

**Interfaces:**
- Produces: `CaseBucket = 'in_progress' | 'completed' | 'withdrawn'`（在 Task 8 的基礎上再新增一個值）

- [ ] **Step 1: 修改 `src/lib/case-tracking/determine-bucket.ts` 新增 `withdrawn` 分類，優先於既有的完成/進行中判定**

```ts
import type { FormType } from '@/lib/procurement/form-registry';

export type CaseFormState = {
  formType: FormType;
  exists: boolean;
  status: string | null;
};

export type CaseType = 'standard' | 'standalone_expense';
export type CaseBucket = 'in_progress' | 'completed' | 'withdrawn';

export function determineCaseBucket(forms: CaseFormState[], caseType: CaseType): CaseBucket {
  const anyWithdrawn = forms.some((form) => form.exists && form.status === 'withdrawn');
  if (anyWithdrawn) return 'withdrawn';

  if (caseType === 'standalone_expense') {
    const expenseForm = forms.find((f) => f.formType === 'expense_request');
    const complete = !!expenseForm && expenseForm.exists && expenseForm.status === 'approved';
    return complete ? 'completed' : 'in_progress';
  }
  const allApproved = forms.every((form) => form.exists && form.status === 'approved');
  return allApproved ? 'completed' : 'in_progress';
}
```

- [ ] **Step 2: 確認 `src/lib/case-tracking/queries.ts` 不需要額外修改**

`getFinanceCaseTracking`（Task 8 已改為傳入 `c.case_type`）呼叫 `determineCaseBucket(forms, c.case_type as CaseType)` 的方式不變，因為 `determineCaseBucket` 的回傳型別只是多了一個新的合法值，呼叫端不需要跟著改。這一步只是確認、不需要動程式碼。

- [ ] **Step 3: 更新 `src/app/case-tracking/page.tsx`，新增「已撤回」頁籤**

把 `STATUS_LABELS`（第 13-17 行）新增 `withdrawn` 標籤，讓撤回案件的表單狀態顯示為中文而非原始字串：

```tsx
const STATUS_LABELS: Record<string, string> = {
  pending_approval: '簽核中',
  approved: '已核准',
  returned: '已退回（待修改）',
  withdrawn: '已撤回',
};
```

把 `tab` 的解析（第 45 行）改為支援第三個值：

```tsx
  const tab: CaseBucket = params.tab === 'completed' ? 'completed' : params.tab === 'withdrawn' ? 'withdrawn' : 'in_progress';
```

把統計計數（第 58-59 行）新增撤回案件計數：

```tsx
  const inProgressCount = allRows.filter((r) => r.bucket === 'in_progress').length;
  const completedCount = allRows.filter((r) => r.bucket === 'completed').length;
  const withdrawnCount = allRows.filter((r) => r.bucket === 'withdrawn').length;
  const visibleRows = allRows.filter((r) => r.bucket === tab);
```

在 `<nav>`（第 73-94 行）的「已完成」頁籤之後新增第三個頁籤連結：

```tsx
        <Link
          href={buildQuery({ ...baseParams, tab: 'withdrawn' })}
          className={
            tab === 'withdrawn'
              ? 'border-b-2 border-blue-600 pb-2 font-semibold'
              : 'pb-2 text-gray-500'
          }
        >
          已撤回（{withdrawnCount}）
        </Link>
```

- [ ] **Step 4: 在既有 `tests/integration/case-tracking-queries.test.ts` 新增一筆撤回案例測試**

接在 Task 8 Step 3 新增的 `standalone_expense` 測試（同一個 `describe` 區塊）之後：

```ts
  it('marks a case as withdrawn when any of its forms has been withdrawn, taking priority over completion status', async () => {
    const { data: caseNumber } = await admin.rpc('next_case_number');
    const { data: pcase } = await admin
      .from('procurement_cases')
      .insert({ case_number: caseNumber, created_by_employee_id: employeeAId })
      .select()
      .single();

    const { data: pr } = await admin
      .from('purchase_requests')
      .insert({
        procurement_case_id: pcase!.id,
        applicant_employee_id: employeeAId,
        department_id: departmentAId,
        budget_owner_employee_id: employeeAId,
        total_amount: 1000,
        status: 'withdrawn',
      })
      .select()
      .single();

    const { getFinanceCaseTracking } = await import('@/lib/case-tracking/queries');
    const rows = await getFinanceCaseTracking({});
    const row = rows.find((r) => r.caseNumber === caseNumber);
    expect(row?.bucket).toBe('withdrawn');

    await admin.from('purchase_requests').delete().eq('id', pr!.id);
    await admin.from('procurement_cases').delete().eq('id', pcase!.id);
  });
```

- [ ] **Step 5: 執行測試**

```bash
export $(grep -v '^#' .env.local | xargs)
npx vitest run tests/integration/case-tracking-queries.test.ts
```

Expected: PASS

- [ ] **Step 6: 執行 typecheck、lint、完整測試套件**

```bash
npm run typecheck
npm run lint
export $(grep -v '^#' .env.local | xargs)
npm test
```

Expected: typecheck/lint 皆為乾淨；測試套件除既有已知的 1 個逾時失敗（`expense-request-queries.test.ts` 的 `getEligiblePurchaseOrdersForExpenseRequest`，見 `docs/superpowers/HANDOFF-plan6.md` 記載，非本計畫造成）外全數通過

- [ ] **Step 7: 手動瀏覽器 QA**

用 Browser 工具登入一位 `role='finance'` 的帳號，前往 `/case-tracking`：
- 確認新增的「已撤回」頁籤存在且能正確篩選出剛才測試建立、或手動操作撤回的案件
- 確認原本「簽核中」「已完成」兩個頁籤的既有案件分類沒有被本次改動誤判

- [ ] **Step 8: Commit**

```bash
git add src/lib/case-tracking/ src/app/case-tracking/ tests/integration/case-tracking-queries.test.ts
git commit -m "feat: add withdrawn bucket to finance case tracking page"
```

---

## 執行完成後的最終審查

依 `docs/superpowers/HANDOFF-plan6.md` 記載的執行慣例，14 個任務全部完成、逐一 commit 後：

1. 用最強模型跑一次整體 review（`superpowers:requesting-code-review` 或 `/code-review high`），重點檢查：
   - 三個子專案彼此是否有非預期的耦合（例如子專案 3 的 `withdrawn` 狀態是否被子專案 2 的 `standalone_expense` 案件類型正確處理）
   - 子專案 3 中「id 空間不一致」的三個已知風險點（Task 11 採購單、Task 12 驗收單、Task 13 費用申請單的編輯頁）是否都已在實作時正確處理，而不是照抄計畫裡的佔位邏輯
2. 執行 `npm run build` 確認 production build 乾淨
3. 跑一次真人瀏覽器 QA 涵蓋三個子專案的主要操作路徑（不只是各任務內建議的局部 QA，而是串起完整流程：例如建立一張請購單、在第一關審核前自行修改、送出後審核到底，並確認案件追蹤頁三個分頁籤都正確反映）
4. 依 `superpowers:finishing-a-development-branch` 決定 merge/PR 方式


