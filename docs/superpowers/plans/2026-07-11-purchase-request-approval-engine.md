# 請購單 + 簽核引擎篇 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A purchase request (請購單) can be created and driven through a complete approval chain (申請人送出 → 申請單位主管 → 預算負責人 → 總經理 → 董事長 if 金額 > 10 萬), with approve / return / resubmit actions and in-app notifications — one full signing round, end to end.

**Architecture:** Builds on the Foundation branch's master data (`departments`, `employees`, `budget_codes`, `suppliers`), `getCurrentEmployee`, and Supabase client helpers. Adds five tables (`procurement_cases`, `purchase_requests`, `purchase_request_items`, `approval_steps`, `notifications`), a race-safe case-number generator, two unit-tested pure functions (approval-chain generation, request validation), four server actions that mutate via a service-role client with in-code authorization, RLS that makes all reads visibility-scoped while all engine writes go exclusively through the vetted server actions, and Next.js pages for creating a request, listing/viewing requests, an approval queue, and notifications.

**Tech Stack:** Next.js 15 (App Router, Server Actions), React 19, TypeScript 5 (strict), Tailwind CSS 3, Supabase (Postgres + RLS), Vitest, Supabase CLI for migrations. Same stack as the Foundation branch — no new dependencies.

## Global Constraints

- Node.js >= 20, npm as the package manager. `npm test` already carries `NODE_OPTIONS=--experimental-websocket` (Node 20 lacks a stable global WebSocket that `@supabase/supabase-js` needs); do not remove it.
- TypeScript `strict: true`; no `any` in new code.
- All user-facing copy is Traditional Chinese, matching the source-form terminology (請購申請單, 預算來源, 預算編號, 說明, 數量, 預估費用, 申請單位主管, 預算負責人, 核准, 退回, 待修改).
- No code comments except where a non-obvious business rule needs explaining.
- Secrets only ever live in `.env.local` / CI secrets, never committed. `SUPABASE_SERVICE_ROLE_KEY` is server-only — never referenced from a `'use client'` module or a `NEXT_PUBLIC_*` var.
- Every new table's row-level security is default-deny; access is granted explicitly per policy. Reads are RLS-scoped to participants; all approval-engine writes (create/approve/return/resubmit) go through server actions using the service-role client (which bypasses RLS) with authorization enforced in code — there are deliberately NO insert/update/delete RLS policies for the engine tables (the one exception: users may mark their own notifications read).
- Case-number format: `CP` + 民國年月 (ROC year 3 digits + month 2 digits, e.g. `11507`) + 4-digit serial, e.g. `CP115070001`. Serial resets per ROC-year-month. Generated atomically server-side.
- 加簽門檻: a purchase request whose **total amount** (this form's own sum, not any case-level running total) is **> NT$100,000** adds the 董事長 (chairman) as a final approval step. Exactly 100,000 does NOT add it.
- A single purchase request's line items must all reference budget codes owned by the **same** 預算負責人 (`budget_codes.owner_employee_id`); the request is rejected at creation otherwise. This yields exactly one 預算負責人 approval step.
- Environment for integration tests: export `.env.local` into the shell first — `export $(grep -v '^#' .env.local | xargs)` — so `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` are set; otherwise the integration suites skip. Migrations apply to the linked hosted project via `supabase db push` (already linked in the Foundation branch — no re-link needed).

## Existing interfaces this plan consumes (from the Foundation branch)

- Tables: `departments(id, code, name, manager_employee_id, …)`, `employees(id, employee_code, name, department_id, title, google_email, role, is_general_manager, is_chairman, …)`, `budget_codes(id, code, department_id, category, owner_employee_id, fiscal_year, annual_budget_amount, …)`.
- `getCurrentEmployee(supabase): Promise<CurrentEmployee | null>` from `src/lib/auth/current-employee.ts`, where `CurrentEmployee = { id, employeeCode, name, departmentId, role: 'staff'|'finance'|'admin', isGeneralManager, isChairman }`.
- `createSupabaseServerClient()` (async, user-session, RLS-enforced) from `src/lib/supabase/server.ts`; `createSupabaseBrowserClient()` from `src/lib/supabase/client.ts`.
- SQL function `is_admin()` (SECURITY DEFINER) from migration `20260710132432_is_admin_security_definer.sql`.
- Route protection middleware (`src/middleware.ts`) redirects unauthenticated users to `/login` for any non-public path; new pages under `/requests`, `/approvals`, `/notifications` are automatically protected.
- Seed data present in the linked project: 8 departments, 39 employees, 185 department-scoped budget codes, 4 suppliers. 沈大維 has `is_general_manager = true`; 陳維隆 has `is_chairman = true`.

## File Structure

**Migrations (apply in timestamp order after the Foundation branch's four):**
- `supabase/migrations/<ts>_procurement_cases.sql` — `procurement_cases`, `case_number_counters`, `next_case_number()`
- `supabase/migrations/<ts>_purchase_requests.sql` — `purchase_requests`, `purchase_request_items`
- `supabase/migrations/<ts>_approval_and_notifications.sql` — `approval_steps`, `notifications`
- `supabase/migrations/<ts>_procurement_rls.sql` — `current_employee_id()`, `is_finance()`, RLS on all five new tables

**Lib (one responsibility per file):**
- `src/lib/supabase/service-role.ts` — `createSupabaseServiceRoleClient()` (server-only)
- `src/lib/approval/chain.ts` + `.test.ts` — `generateApprovalChain()` pure logic
- `src/lib/purchase-requests/validate.ts` + `.test.ts` — `validatePurchaseRequestInput()` pure logic
- `src/lib/purchase-requests/actions.ts` — `'use server'` actions: create / approve / return / resubmit
- `src/lib/purchase-requests/queries.ts` — read helpers for the pages
- `src/lib/notifications/queries.ts` — `getMyNotifications`, `getUnreadNotificationCount`
- `src/lib/notifications/actions.ts` — `markNotificationRead`

**Integration tests:**
- `tests/integration/purchase-request-create.test.ts`
- `tests/integration/purchase-request-approve-return.test.ts`
- `tests/integration/purchase-request-resubmit.test.ts`
- `tests/integration/purchase-request-queries.test.ts`

**Pages / components:**
- `src/app/requests/page.tsx` — my requests list
- `src/app/requests/new/page.tsx` + `src/app/requests/new/purchase-request-form.tsx` (client)
- `src/app/requests/[id]/page.tsx` + `src/app/requests/[id]/approval-actions.tsx` (client)
- `src/app/approvals/page.tsx` — approval queue
- `src/app/notifications/page.tsx` + `src/app/notifications/notification-actions.tsx` (client)
- `src/app/dashboard/page.tsx` — modified to add navigation + pending count

---

## Task 1: Service-role Supabase client helper

**Files:**
- Create: `src/lib/supabase/service-role.ts`
- Test: `src/lib/supabase/service-role.test.ts`

**Interfaces:**
- Consumes: `getRequiredEnv` from `src/lib/env.ts`.
- Produces: `createSupabaseServiceRoleClient(): SupabaseClient` — a server-only client authenticated with the service-role key (bypasses RLS). Every mutating server action in later tasks uses this.

- [ ] **Step 1: Write the failing test**

`src/lib/supabase/service-role.test.ts`:
```ts
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('createSupabaseServiceRoleClient', () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it('throws when SUPABASE_SERVICE_ROLE_KEY is missing', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
    const { createSupabaseServiceRoleClient } = await import('./service-role');
    expect(() => createSupabaseServiceRoleClient()).toThrow(
      'Missing required environment variable: SUPABASE_SERVICE_ROLE_KEY'
    );
  });

  it('returns a client when both env vars are set', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-key');
    const { createSupabaseServiceRoleClient } = await import('./service-role');
    const client = createSupabaseServiceRoleClient();
    expect(client).toBeDefined();
    expect(typeof client.from).toBe('function');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/lib/supabase/service-role.test.ts`
Expected: FAIL — `Cannot find module './service-role'`.

- [ ] **Step 3: Implement the helper**

`src/lib/supabase/service-role.ts`:
```ts
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getRequiredEnv } from '@/lib/env';

// Server-only. Uses the service-role key, which bypasses RLS — never import this
// from a 'use client' module. All approval-engine writes go through this client
// with authorization enforced in the calling server action.
export function createSupabaseServiceRoleClient(): SupabaseClient {
  return createClient(
    getRequiredEnv('NEXT_PUBLIC_SUPABASE_URL'),
    getRequiredEnv('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/lib/supabase/service-role.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/supabase/service-role.ts src/lib/supabase/service-role.test.ts
git commit -m "feat: add server-only service-role Supabase client helper"
```

---

## Task 2: Migration — `procurement_cases` + atomic case number generator

**Files:**
- Create: `supabase/migrations/<timestamp>_procurement_cases.sql`
- Test: `tests/integration/procurement-cases-schema.test.ts`

**Interfaces:**
- Consumes: `employees(id)`.
- Produces: table `procurement_cases(id, case_number, created_by_employee_id, created_at)`; table `case_number_counters(year_month, last_serial)`; SQL function `next_case_number() returns text` producing `CP` + ROC-year-month + 4-digit serial, atomically incrementing per year-month.

- [ ] **Step 1: Write the failing integration test**

`tests/integration/procurement-cases-schema.test.ts`:
```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createServiceRoleTestClient,
  hasIntegrationTestCredentials,
} from './supabase-test-client';

describe.skipIf(!hasIntegrationTestCredentials())('procurement_cases + next_case_number', () => {
  let supabase: ReturnType<typeof createServiceRoleTestClient>;
  const createdCaseIds: string[] = [];
  let employeeId: string;

  beforeAll(async () => {
    supabase = createServiceRoleTestClient();
    const { data } = await supabase.from('employees').select('id').limit(1).single();
    employeeId = data!.id;
  });

  afterAll(async () => {
    if (createdCaseIds.length > 0) {
      await supabase.from('procurement_cases').delete().in('id', createdCaseIds);
    }
  });

  it('generates a case number matching CP + 5-digit year-month + 4-digit serial', async () => {
    const { data, error } = await supabase.rpc('next_case_number');
    expect(error).toBeNull();
    expect(data).toMatch(/^CP\d{5}\d{4}$/);
  });

  it('generates strictly increasing serials within the same year-month', async () => {
    const { data: first } = await supabase.rpc('next_case_number');
    const { data: second } = await supabase.rpc('next_case_number');
    const prefix = (n: string) => n.slice(0, 7);
    const serial = (n: string) => parseInt(n.slice(7), 10);
    expect(prefix(second)).toBe(prefix(first));
    expect(serial(second)).toBe(serial(first) + 1);
  });

  it('inserts a procurement_case with a unique case_number', async () => {
    const { data: caseNumber } = await supabase.rpc('next_case_number');
    const { data, error } = await supabase
      .from('procurement_cases')
      .insert({ case_number: caseNumber, created_by_employee_id: employeeId })
      .select()
      .single();
    expect(error).toBeNull();
    expect(data!.case_number).toBe(caseNumber);
    createdCaseIds.push(data!.id);

    const { error: dupError } = await supabase
      .from('procurement_cases')
      .insert({ case_number: caseNumber, created_by_employee_id: employeeId });
    expect(dupError).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `export $(grep -v '^#' .env.local | xargs) && npm test -- tests/integration/procurement-cases-schema.test.ts`
Expected: FAIL — `could not find the function public.next_case_number` / `relation "procurement_cases" does not exist`.

- [ ] **Step 3: Create and write the migration**

Run: `supabase migration new procurement_cases`. Open the generated file and write:
```sql
create table procurement_cases (
  id uuid primary key default gen_random_uuid(),
  case_number text not null unique,
  created_by_employee_id uuid not null references employees(id),
  created_at timestamptz not null default now()
);

create table case_number_counters (
  year_month text primary key,
  last_serial integer not null default 0
);

-- ROC year-month is Gregorian year minus 1911 (3 digits) plus month (2 digits).
-- The upsert row-locks the counter, so concurrent callers get distinct serials.
create or replace function next_case_number() returns text
language plpgsql
as $$
declare
  v_year_month text;
  v_serial integer;
begin
  v_year_month := lpad((extract(year from now())::int - 1911)::text, 3, '0')
                  || lpad(extract(month from now())::int::text, 2, '0');
  insert into case_number_counters (year_month, last_serial)
  values (v_year_month, 1)
  on conflict (year_month)
  do update set last_serial = case_number_counters.last_serial + 1
  returning last_serial into v_serial;
  return 'CP' || v_year_month || lpad(v_serial::text, 4, '0');
end;
$$;
```

- [ ] **Step 4: Apply the migration**

Run: `export $(grep -v '^#' .env.local | xargs) && supabase db push`
Expected: CLI reports the migration applied.

- [ ] **Step 5: Run the test to verify it passes**

Run: `export $(grep -v '^#' .env.local | xargs) && npm test -- tests/integration/procurement-cases-schema.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations tests/integration/procurement-cases-schema.test.ts
git commit -m "feat: add procurement_cases table and atomic case number generator"
```

---

## Task 3: Migration — `purchase_requests` + `purchase_request_items`

**Files:**
- Create: `supabase/migrations/<timestamp>_purchase_requests.sql`
- Test: `tests/integration/purchase-requests-schema.test.ts`

**Interfaces:**
- Consumes: `procurement_cases(id)`, `employees(id)`, `departments(id)`, `budget_codes(id)`.
- Produces: `purchase_requests(id, procurement_case_id, applicant_employee_id, department_id, budget_owner_employee_id, request_date, needed_within_days, total_amount, status, current_step_order, created_at, updated_at)` where `status in ('pending_approval','approved','returned')`; `purchase_request_items(id, purchase_request_id, line_no, budget_code_id, item_category, description, quantity, estimated_amount, created_at)`.

- [ ] **Step 1: Write the failing integration test**

`tests/integration/purchase-requests-schema.test.ts`:
```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createServiceRoleTestClient,
  hasIntegrationTestCredentials,
} from './supabase-test-client';

describe.skipIf(!hasIntegrationTestCredentials())('purchase_requests + items schema', () => {
  let supabase: ReturnType<typeof createServiceRoleTestClient>;
  let caseId: string;
  let employeeId: string;
  let departmentId: string;
  let budgetCodeId: string;
  let requestId: string;

  beforeAll(async () => {
    supabase = createServiceRoleTestClient();
    const { data: emp } = await supabase
      .from('employees')
      .select('id, department_id')
      .limit(1)
      .single();
    employeeId = emp!.id;
    departmentId = emp!.department_id;
    const { data: bc } = await supabase.from('budget_codes').select('id').limit(1).single();
    budgetCodeId = bc!.id;
    const { data: caseNumber } = await supabase.rpc('next_case_number');
    const { data: pcase } = await supabase
      .from('procurement_cases')
      .insert({ case_number: caseNumber, created_by_employee_id: employeeId })
      .select()
      .single();
    caseId = pcase!.id;
  });

  afterAll(async () => {
    if (requestId) await supabase.from('purchase_requests').delete().eq('id', requestId);
    if (caseId) await supabase.from('procurement_cases').delete().eq('id', caseId);
  });

  it('inserts a purchase request with default status pending_approval', async () => {
    const { data, error } = await supabase
      .from('purchase_requests')
      .insert({
        procurement_case_id: caseId,
        applicant_employee_id: employeeId,
        department_id: departmentId,
        budget_owner_employee_id: employeeId,
        needed_within_days: 30,
        total_amount: 65000,
        current_step_order: 1,
      })
      .select()
      .single();
    expect(error).toBeNull();
    expect(data!.status).toBe('pending_approval');
    requestId = data!.id;
  });

  it('rejects an invalid status', async () => {
    const { error } = await supabase.from('purchase_requests').insert({
      procurement_case_id: caseId,
      applicant_employee_id: employeeId,
      department_id: departmentId,
      budget_owner_employee_id: employeeId,
      status: 'not_a_status',
    });
    expect(error).not.toBeNull();
  });

  it('inserts a line item and rejects quantity <= 0', async () => {
    const { data, error } = await supabase
      .from('purchase_request_items')
      .insert({
        purchase_request_id: requestId,
        line_no: 1,
        budget_code_id: budgetCodeId,
        item_category: '材料',
        description: '材料A',
        quantity: 1,
        estimated_amount: 65000,
      })
      .select()
      .single();
    expect(error).toBeNull();
    expect(data!.description).toBe('材料A');

    const { error: badQty } = await supabase.from('purchase_request_items').insert({
      purchase_request_id: requestId,
      line_no: 2,
      budget_code_id: budgetCodeId,
      item_category: '材料',
      description: '壞數量',
      quantity: 0,
      estimated_amount: 100,
    });
    expect(badQty).not.toBeNull();
  });

  it('cascades item deletion when the request is deleted', async () => {
    const { data: caseNumber } = await supabase.rpc('next_case_number');
    const { data: pcase } = await supabase
      .from('procurement_cases')
      .insert({ case_number: caseNumber, created_by_employee_id: employeeId })
      .select()
      .single();
    const { data: pr } = await supabase
      .from('purchase_requests')
      .insert({
        procurement_case_id: pcase!.id,
        applicant_employee_id: employeeId,
        department_id: departmentId,
        budget_owner_employee_id: employeeId,
      })
      .select()
      .single();
    await supabase.from('purchase_request_items').insert({
      purchase_request_id: pr!.id,
      line_no: 1,
      budget_code_id: budgetCodeId,
      item_category: '材料',
      description: 'cascade 測試',
      quantity: 1,
      estimated_amount: 1,
    });
    await supabase.from('purchase_requests').delete().eq('id', pr!.id);
    const { data: leftover } = await supabase
      .from('purchase_request_items')
      .select('id')
      .eq('purchase_request_id', pr!.id);
    expect(leftover).toEqual([]);
    await supabase.from('procurement_cases').delete().eq('id', pcase!.id);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `export $(grep -v '^#' .env.local | xargs) && npm test -- tests/integration/purchase-requests-schema.test.ts`
Expected: FAIL — `relation "purchase_requests" does not exist`.

- [ ] **Step 3: Create and write the migration**

Run: `supabase migration new purchase_requests`. Write:
```sql
create table purchase_requests (
  id uuid primary key default gen_random_uuid(),
  procurement_case_id uuid not null references procurement_cases(id),
  applicant_employee_id uuid not null references employees(id),
  department_id uuid not null references departments(id),
  budget_owner_employee_id uuid not null references employees(id),
  request_date date not null default current_date,
  needed_within_days integer,
  total_amount numeric(14, 2) not null default 0,
  status text not null default 'pending_approval'
    check (status in ('pending_approval', 'approved', 'returned')),
  current_step_order integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index on purchase_requests (applicant_employee_id);
create index on purchase_requests (status);

create table purchase_request_items (
  id uuid primary key default gen_random_uuid(),
  purchase_request_id uuid not null references purchase_requests(id) on delete cascade,
  line_no integer not null,
  budget_code_id uuid not null references budget_codes(id),
  item_category text not null,
  description text not null,
  quantity integer not null check (quantity > 0),
  estimated_amount numeric(14, 2) not null check (estimated_amount > 0),
  created_at timestamptz not null default now(),
  unique (purchase_request_id, line_no)
);
```

- [ ] **Step 4: Apply the migration**

Run: `export $(grep -v '^#' .env.local | xargs) && supabase db push`

- [ ] **Step 5: Run the test to verify it passes**

Run: `export $(grep -v '^#' .env.local | xargs) && npm test -- tests/integration/purchase-requests-schema.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations tests/integration/purchase-requests-schema.test.ts
git commit -m "feat: add purchase_requests and purchase_request_items tables"
```

---

## Task 4: Migration — `approval_steps` + `notifications`

**Files:**
- Create: `supabase/migrations/<timestamp>_approval_and_notifications.sql`
- Test: `tests/integration/approval-notifications-schema.test.ts`

**Interfaces:**
- Consumes: `employees(id)`.
- Produces: `approval_steps(id, form_type, form_id, step_order, approver_employee_id, approver_role, status, comment, acted_at, created_at)` — polymorphic (`form_type in ('purchase_request','purchase_order','acceptance','expense_request')`, `status in ('pending','approved','returned')`, `unique (form_type, form_id, step_order)`) so the three forms in the next plan reuse it; `notifications(id, recipient_employee_id, type, form_type, form_id, case_number, message, is_read, created_at)`.

- [ ] **Step 1: Write the failing integration test**

`tests/integration/approval-notifications-schema.test.ts`:
```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createServiceRoleTestClient,
  hasIntegrationTestCredentials,
} from './supabase-test-client';

describe.skipIf(!hasIntegrationTestCredentials())('approval_steps + notifications schema', () => {
  let supabase: ReturnType<typeof createServiceRoleTestClient>;
  let employeeId: string;
  const formId = crypto.randomUUID();

  beforeAll(async () => {
    supabase = createServiceRoleTestClient();
    const { data } = await supabase.from('employees').select('id').limit(1).single();
    employeeId = data!.id;
  });

  afterAll(async () => {
    await supabase.from('approval_steps').delete().eq('form_id', formId);
    await supabase.from('notifications').delete().eq('form_id', formId);
  });

  it('inserts an approval step with default status pending', async () => {
    const { data, error } = await supabase
      .from('approval_steps')
      .insert({
        form_type: 'purchase_request',
        form_id: formId,
        step_order: 1,
        approver_employee_id: employeeId,
        approver_role: 'department_manager',
      })
      .select()
      .single();
    expect(error).toBeNull();
    expect(data!.status).toBe('pending');
  });

  it('enforces unique (form_type, form_id, step_order)', async () => {
    const { error } = await supabase.from('approval_steps').insert({
      form_type: 'purchase_request',
      form_id: formId,
      step_order: 1,
      approver_employee_id: employeeId,
      approver_role: 'budget_owner',
    });
    expect(error).not.toBeNull();
  });

  it('rejects an invalid form_type', async () => {
    const { error } = await supabase.from('approval_steps').insert({
      form_type: 'not_a_form',
      form_id: formId,
      step_order: 9,
      approver_employee_id: employeeId,
      approver_role: 'budget_owner',
    });
    expect(error).not.toBeNull();
  });

  it('inserts a notification with default is_read false', async () => {
    const { data, error } = await supabase
      .from('notifications')
      .insert({
        recipient_employee_id: employeeId,
        type: 'approval_requested',
        form_type: 'purchase_request',
        form_id: formId,
        case_number: 'CP115070001',
        message: '有一張請購單待您簽核',
      })
      .select()
      .single();
    expect(error).toBeNull();
    expect(data!.is_read).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `export $(grep -v '^#' .env.local | xargs) && npm test -- tests/integration/approval-notifications-schema.test.ts`
Expected: FAIL — `relation "approval_steps" does not exist`.

- [ ] **Step 3: Create and write the migration**

Run: `supabase migration new approval_and_notifications`. Write:
```sql
create table approval_steps (
  id uuid primary key default gen_random_uuid(),
  form_type text not null
    check (form_type in ('purchase_request', 'purchase_order', 'acceptance', 'expense_request')),
  form_id uuid not null,
  step_order integer not null,
  approver_employee_id uuid not null references employees(id),
  approver_role text not null
    check (approver_role in ('department_manager', 'budget_owner', 'general_manager', 'chairman')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'returned')),
  comment text,
  acted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (form_type, form_id, step_order)
);

create index on approval_steps (form_type, form_id);
create index on approval_steps (approver_employee_id, status);

create table notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_employee_id uuid not null references employees(id),
  type text not null
    check (type in ('approval_requested', 'request_returned', 'request_approved')),
  form_type text not null,
  form_id uuid not null,
  case_number text not null,
  message text not null,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create index on notifications (recipient_employee_id, is_read);
```

- [ ] **Step 4: Apply the migration**

Run: `export $(grep -v '^#' .env.local | xargs) && supabase db push`

- [ ] **Step 5: Run the test to verify it passes**

Run: `export $(grep -v '^#' .env.local | xargs) && npm test -- tests/integration/approval-notifications-schema.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations tests/integration/approval-notifications-schema.test.ts
git commit -m "feat: add polymorphic approval_steps and notifications tables"
```

---

## Task 5: Migration — RLS helpers + visibility policies

**Files:**
- Create: `supabase/migrations/<timestamp>_procurement_rls.sql`
- Test: `tests/integration/procurement-rls.test.ts`

**Interfaces:**
- Consumes: `is_admin()` (Foundation), `employees`, all five new tables.
- Produces: SQL functions `current_employee_id() returns uuid` and `is_finance() returns boolean` (both SECURITY DEFINER, pinned `search_path`); RLS enabled on all five new tables with SELECT policies scoped to participants, plus one narrow notifications UPDATE policy (recipient may mark their own read). NO insert/update/delete policies on the engine tables — those writes flow only through service-role server actions.

- [ ] **Step 1: Write the failing RLS test**

`tests/integration/procurement-rls.test.ts`:
```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createAnonTestClient,
  createServiceRoleTestClient,
  hasIntegrationTestCredentials,
} from './supabase-test-client';

describe.skipIf(!hasIntegrationTestCredentials())('procurement RLS', () => {
  let admin: ReturnType<typeof createServiceRoleTestClient>;
  const password = 'Test-password-123!';
  const applicantEmail = `rls-pr-applicant-${Date.now()}@turing-drive.com`;
  const outsiderEmail = `rls-pr-outsider-${Date.now()}@turing-drive.com`;
  let deptId: string;
  let applicantEmpId: string;
  let outsiderEmpId: string;
  let applicantAuthId: string;
  let outsiderAuthId: string;
  let caseId: string;
  let requestId: string;

  beforeAll(async () => {
    admin = createServiceRoleTestClient();
    const { data: dept } = await admin
      .from('departments')
      .insert({ code: `RLS-PR-${Date.now()}`, name: 'RLS 請購測試部門' })
      .select()
      .single();
    deptId = dept!.id;

    const { data: a } = await admin.auth.admin.createUser({
      email: applicantEmail,
      password,
      email_confirm: true,
    });
    applicantAuthId = a!.user.id;
    const { data: o } = await admin.auth.admin.createUser({
      email: outsiderEmail,
      password,
      email_confirm: true,
    });
    outsiderAuthId = o!.user.id;

    const { data: emps } = await admin
      .from('employees')
      .insert([
        {
          employee_code: `RLS-PR-A-${Date.now()}`,
          name: 'RLS 申請人',
          department_id: deptId,
          google_email: applicantEmail,
          role: 'staff',
        },
        {
          employee_code: `RLS-PR-O-${Date.now()}`,
          name: 'RLS 外人',
          department_id: deptId,
          google_email: outsiderEmail,
          role: 'staff',
        },
      ])
      .select();
    applicantEmpId = emps!.find((e) => e.google_email === applicantEmail)!.id;
    outsiderEmpId = emps!.find((e) => e.google_email === outsiderEmail)!.id;

    const { data: caseNumber } = await admin.rpc('next_case_number');
    const { data: pcase } = await admin
      .from('procurement_cases')
      .insert({ case_number: caseNumber, created_by_employee_id: applicantEmpId })
      .select()
      .single();
    caseId = pcase!.id;
    const { data: pr } = await admin
      .from('purchase_requests')
      .insert({
        procurement_case_id: caseId,
        applicant_employee_id: applicantEmpId,
        department_id: deptId,
        budget_owner_employee_id: applicantEmpId,
        total_amount: 1000,
        current_step_order: 1,
      })
      .select()
      .single();
    requestId = pr!.id;
  });

  afterAll(async () => {
    await admin.from('purchase_requests').delete().eq('id', requestId);
    await admin.from('procurement_cases').delete().eq('id', caseId);
    await admin.from('employees').delete().eq('department_id', deptId);
    await admin.from('departments').delete().eq('id', deptId);
    await admin.auth.admin.deleteUser(applicantAuthId);
    await admin.auth.admin.deleteUser(outsiderAuthId);
  });

  it('lets the applicant read their own request', async () => {
    const client = createAnonTestClient();
    await client.auth.signInWithPassword({ email: applicantEmail, password });
    const { data } = await client.from('purchase_requests').select('id').eq('id', requestId);
    expect(data).toHaveLength(1);
  });

  it('hides the request from an unrelated employee', async () => {
    const client = createAnonTestClient();
    await client.auth.signInWithPassword({ email: outsiderEmail, password });
    const { data } = await client.from('purchase_requests').select('id').eq('id', requestId);
    expect(data).toEqual([]);
  });

  it('blocks a direct client insert into purchase_requests (writes are service-role only)', async () => {
    const client = createAnonTestClient();
    await client.auth.signInWithPassword({ email: applicantEmail, password });
    const { error } = await client.from('purchase_requests').insert({
      procurement_case_id: caseId,
      applicant_employee_id: applicantEmpId,
      department_id: deptId,
      budget_owner_employee_id: applicantEmpId,
    });
    expect(error).not.toBeNull();
  });

  it('lets a recipient read and mark their own notification read', async () => {
    const { data: notif } = await admin
      .from('notifications')
      .insert({
        recipient_employee_id: applicantEmpId,
        type: 'approval_requested',
        form_type: 'purchase_request',
        form_id: requestId,
        case_number: 'CP115070001',
        message: '待簽核',
      })
      .select()
      .single();
    const client = createAnonTestClient();
    await client.auth.signInWithPassword({ email: applicantEmail, password });
    const { data: read } = await client.from('notifications').select('id').eq('id', notif!.id);
    expect(read).toHaveLength(1);
    const { error: updErr } = await client
      .from('notifications')
      .update({ is_read: true })
      .eq('id', notif!.id);
    expect(updErr).toBeNull();
    await admin.from('notifications').delete().eq('id', notif!.id);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `export $(grep -v '^#' .env.local | xargs) && npm test -- tests/integration/procurement-rls.test.ts`
Expected: FAIL — the "hides the request" and "blocks a direct client insert" assertions fail because RLS is not enabled yet (reads return the row; insert succeeds).

- [ ] **Step 3: Create and write the RLS migration**

Run: `supabase migration new procurement_rls`. Write:
```sql
create or replace function current_employee_id() returns uuid
language sql stable security definer set search_path = public
as $$
  select id from employees where google_email = auth.jwt() ->> 'email';
$$;

create or replace function is_finance() returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from employees
    where google_email = auth.jwt() ->> 'email' and role in ('finance', 'admin')
  );
$$;

alter table procurement_cases enable row level security;
alter table case_number_counters enable row level security;
alter table purchase_requests enable row level security;
alter table purchase_request_items enable row level security;
alter table approval_steps enable row level security;
alter table notifications enable row level security;

-- case_number_counters: no policies at all → only service role can touch it.

-- procurement_cases carry only a number + creator; any authenticated user may read.
create policy "auth_read_cases" on procurement_cases
  for select using (auth.role() = 'authenticated');

-- A purchase request is visible to its applicant, any of its approvers, and finance/admin.
create policy "participant_read_requests" on purchase_requests
  for select using (
    applicant_employee_id = current_employee_id()
    or is_finance()
    or is_admin()
    or exists (
      select 1 from approval_steps a
      where a.form_type = 'purchase_request'
        and a.form_id = purchase_requests.id
        and a.approver_employee_id = current_employee_id()
    )
  );

create policy "participant_read_request_items" on purchase_request_items
  for select using (
    exists (
      select 1 from purchase_requests pr
      where pr.id = purchase_request_items.purchase_request_id
        and (
          pr.applicant_employee_id = current_employee_id()
          or is_finance()
          or is_admin()
          or exists (
            select 1 from approval_steps a
            where a.form_type = 'purchase_request'
              and a.form_id = pr.id
              and a.approver_employee_id = current_employee_id()
          )
        )
    )
  );

create policy "participant_read_approval_steps" on approval_steps
  for select using (
    approver_employee_id = current_employee_id()
    or is_finance()
    or is_admin()
    or exists (
      select 1 from purchase_requests pr
      where pr.id = approval_steps.form_id
        and approval_steps.form_type = 'purchase_request'
        and pr.applicant_employee_id = current_employee_id()
    )
  );

create policy "recipient_read_notifications" on notifications
  for select using (recipient_employee_id = current_employee_id() or is_admin());

create policy "recipient_update_notifications" on notifications
  for update using (recipient_employee_id = current_employee_id())
  with check (recipient_employee_id = current_employee_id());
```

- [ ] **Step 4: Apply the migration**

Run: `export $(grep -v '^#' .env.local | xargs) && supabase db push`

- [ ] **Step 5: Run the test to verify it passes**

Run: `export $(grep -v '^#' .env.local | xargs) && npm test -- tests/integration/procurement-rls.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Run the full suite to confirm no regressions**

Run: `export $(grep -v '^#' .env.local | xargs) && npm test`
Expected: all pass (Foundation's 30 + this plan's new schema/RLS tests).

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations tests/integration/procurement-rls.test.ts
git commit -m "feat: add current_employee_id/is_finance helpers and procurement RLS"
```

---

## Task 6: `generateApprovalChain()` pure logic

**Files:**
- Create: `src/lib/approval/chain.ts`
- Test: `src/lib/approval/chain.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: types `ApprovalRole = 'department_manager' | 'budget_owner' | 'general_manager' | 'chairman'`, `ApprovalChainStep = { approverEmployeeId: string; approverRole: ApprovalRole }`, and `generateApprovalChain(input): ApprovalChainStep[]`. The create/resubmit actions consume this. Rules: order is [department_manager, budget_owner, general_manager], append chairman when `totalAmount > 100000`; drop any step whose approver is the applicant; dedupe by approver id keeping the first occurrence; empty result means auto-approve.

- [ ] **Step 1: Write the failing test**

`src/lib/approval/chain.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { generateApprovalChain } from './chain';

const base = {
  applicantEmployeeId: 'E1',
  departmentManagerEmployeeId: 'E2',
  budgetOwnerEmployeeId: 'E3',
  generalManagerEmployeeId: 'E4',
  chairmanEmployeeId: 'E5',
};

describe('generateApprovalChain', () => {
  it('builds manager → budget owner → GM for a normal request under 100k', () => {
    expect(generateApprovalChain({ ...base, totalAmount: 65000 })).toEqual([
      { approverEmployeeId: 'E2', approverRole: 'department_manager' },
      { approverEmployeeId: 'E3', approverRole: 'budget_owner' },
      { approverEmployeeId: 'E4', approverRole: 'general_manager' },
    ]);
  });

  it('appends the chairman when the total exceeds 100k', () => {
    const chain = generateApprovalChain({ ...base, totalAmount: 100001 });
    expect(chain[chain.length - 1]).toEqual({
      approverEmployeeId: 'E5',
      approverRole: 'chairman',
    });
  });

  it('does not append the chairman at exactly 100k', () => {
    const chain = generateApprovalChain({ ...base, totalAmount: 100000 });
    expect(chain.map((s) => s.approverRole)).not.toContain('chairman');
  });

  it('dedupes when the manager is also the budget owner, keeping the first role', () => {
    expect(
      generateApprovalChain({ ...base, budgetOwnerEmployeeId: 'E2', totalAmount: 50000 })
    ).toEqual([
      { approverEmployeeId: 'E2', approverRole: 'department_manager' },
      { approverEmployeeId: 'E4', approverRole: 'general_manager' },
    ]);
  });

  it('drops the applicant when they would otherwise appear as an approver', () => {
    expect(
      generateApprovalChain({ ...base, applicantEmployeeId: 'E2', totalAmount: 50000 })
    ).toEqual([
      { approverEmployeeId: 'E3', approverRole: 'budget_owner' },
      { approverEmployeeId: 'E4', approverRole: 'general_manager' },
    ]);
  });

  it('returns an empty chain (auto-approve) when the applicant is the only would-be approver', () => {
    expect(
      generateApprovalChain({
        applicantEmployeeId: 'E4',
        departmentManagerEmployeeId: 'E4',
        budgetOwnerEmployeeId: 'E4',
        generalManagerEmployeeId: 'E4',
        chairmanEmployeeId: 'E5',
        totalAmount: 50000,
      })
    ).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/lib/approval/chain.test.ts`
Expected: FAIL — `Cannot find module './chain'`.

- [ ] **Step 3: Implement the function**

`src/lib/approval/chain.ts`:
```ts
export type ApprovalRole =
  | 'department_manager'
  | 'budget_owner'
  | 'general_manager'
  | 'chairman';

export type ApprovalChainStep = {
  approverEmployeeId: string;
  approverRole: ApprovalRole;
};

export type ApprovalChainInput = {
  applicantEmployeeId: string;
  departmentManagerEmployeeId: string;
  budgetOwnerEmployeeId: string;
  generalManagerEmployeeId: string;
  chairmanEmployeeId: string;
  totalAmount: number;
};

const CHAIRMAN_THRESHOLD = 100000;

export function generateApprovalChain(input: ApprovalChainInput): ApprovalChainStep[] {
  const candidates: ApprovalChainStep[] = [
    { approverEmployeeId: input.departmentManagerEmployeeId, approverRole: 'department_manager' },
    { approverEmployeeId: input.budgetOwnerEmployeeId, approverRole: 'budget_owner' },
    { approverEmployeeId: input.generalManagerEmployeeId, approverRole: 'general_manager' },
  ];
  if (input.totalAmount > CHAIRMAN_THRESHOLD) {
    candidates.push({ approverEmployeeId: input.chairmanEmployeeId, approverRole: 'chairman' });
  }

  const seen = new Set<string>();
  const chain: ApprovalChainStep[] = [];
  for (const step of candidates) {
    if (step.approverEmployeeId === input.applicantEmployeeId) continue;
    if (seen.has(step.approverEmployeeId)) continue;
    seen.add(step.approverEmployeeId);
    chain.push(step);
  }
  return chain;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/lib/approval/chain.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/approval/chain.ts src/lib/approval/chain.test.ts
git commit -m "feat: add approval chain generation logic"
```

---

## Task 7: `validatePurchaseRequestInput()` pure logic

**Files:**
- Create: `src/lib/purchase-requests/validate.ts`
- Test: `src/lib/purchase-requests/validate.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: types `PurchaseRequestItemInput = { budgetCodeId: string; budgetOwnerEmployeeId: string; itemCategory: string; description: string; quantity: number; estimatedAmount: number }`, `ValidationResult = { ok: true } | { ok: false; error: string }`, and `validatePurchaseRequestInput(items): ValidationResult`. The create/resubmit actions call this before writing. Rules: at least one item; each item needs a non-empty trimmed description, `quantity > 0`, `estimatedAmount > 0`; all items must share one `budgetOwnerEmployeeId`.

- [ ] **Step 1: Write the failing test**

`src/lib/purchase-requests/validate.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { validatePurchaseRequestInput } from './validate';

const item = {
  budgetCodeId: 'B1',
  budgetOwnerEmployeeId: 'O1',
  itemCategory: '材料',
  description: '材料A',
  quantity: 1,
  estimatedAmount: 65000,
};

describe('validatePurchaseRequestInput', () => {
  it('accepts a single valid item', () => {
    expect(validatePurchaseRequestInput([item])).toEqual({ ok: true });
  });

  it('accepts multiple items sharing one budget owner', () => {
    expect(
      validatePurchaseRequestInput([item, { ...item, budgetCodeId: 'B2', description: '材料B' }])
    ).toEqual({ ok: true });
  });

  it('rejects an empty item list', () => {
    const result = validatePurchaseRequestInput([]);
    expect(result).toEqual({ ok: false, error: '請購單至少需要一個明細項次' });
  });

  it('rejects an item with a blank description', () => {
    const result = validatePurchaseRequestInput([{ ...item, description: '   ' }]);
    expect(result).toEqual({ ok: false, error: '第 1 項的說明不可空白' });
  });

  it('rejects an item with non-positive quantity', () => {
    const result = validatePurchaseRequestInput([{ ...item, quantity: 0 }]);
    expect(result).toEqual({ ok: false, error: '第 1 項的數量必須大於 0' });
  });

  it('rejects an item with non-positive estimated amount', () => {
    const result = validatePurchaseRequestInput([{ ...item, estimatedAmount: 0 }]);
    expect(result).toEqual({ ok: false, error: '第 1 項的預估費用必須大於 0' });
  });

  it('rejects items spanning more than one budget owner', () => {
    const result = validatePurchaseRequestInput([
      item,
      { ...item, budgetCodeId: 'B2', budgetOwnerEmployeeId: 'O2', description: '材料B' },
    ]);
    expect(result).toEqual({
      ok: false,
      error: '一張請購單的所有預算編號必須屬於同一位預算負責人',
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/lib/purchase-requests/validate.test.ts`
Expected: FAIL — `Cannot find module './validate'`.

- [ ] **Step 3: Implement the function**

`src/lib/purchase-requests/validate.ts`:
```ts
export type PurchaseRequestItemInput = {
  budgetCodeId: string;
  budgetOwnerEmployeeId: string;
  itemCategory: string;
  description: string;
  quantity: number;
  estimatedAmount: number;
};

export type ValidationResult = { ok: true } | { ok: false; error: string };

export function validatePurchaseRequestInput(
  items: PurchaseRequestItemInput[]
): ValidationResult {
  if (items.length === 0) {
    return { ok: false, error: '請購單至少需要一個明細項次' };
  }
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    const lineNo = i + 1;
    if (item.description.trim() === '') {
      return { ok: false, error: `第 ${lineNo} 項的說明不可空白` };
    }
    if (item.quantity <= 0) {
      return { ok: false, error: `第 ${lineNo} 項的數量必須大於 0` };
    }
    if (item.estimatedAmount <= 0) {
      return { ok: false, error: `第 ${lineNo} 項的預估費用必須大於 0` };
    }
  }
  const owners = new Set(items.map((item) => item.budgetOwnerEmployeeId));
  if (owners.size > 1) {
    return { ok: false, error: '一張請購單的所有預算編號必須屬於同一位預算負責人' };
  }
  return { ok: true };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/lib/purchase-requests/validate.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/purchase-requests/validate.ts src/lib/purchase-requests/validate.test.ts
git commit -m "feat: add purchase request input validation"
```

---

## Task 8: `createPurchaseRequest` server action

**Files:**
- Create: `src/lib/purchase-requests/actions.ts`
- Test: `tests/integration/purchase-request-create.test.ts`

**Interfaces:**
- Consumes: `createSupabaseServiceRoleClient` (Task 1), `getCurrentEmployee` + `createSupabaseServerClient`, `generateApprovalChain` (Task 6), `validatePurchaseRequestInput` (Task 7), `next_case_number` RPC (Task 2).
- Produces: types `NewPurchaseRequestItem = { budgetCodeId: string; description: string; quantity: number; estimatedAmount: number }`, `NewPurchaseRequest = { neededWithinDays: number | null; items: NewPurchaseRequestItem[] }`, `CreateResult = { ok: true; requestId: string; caseNumber: string } | { ok: false; error: string }`, and `async createPurchaseRequest(input: NewPurchaseRequest): Promise<CreateResult>`. On success it has inserted a case, request, items, and approval steps, set `current_step_order` to the first pending step (or marked the request approved when the chain is empty), and created an `approval_requested` notification for the first approver. Later tasks (approve/return/resubmit) live in the same file.

**Design notes for the implementer:**
- `item_category` is derived from the selected budget code's `category`.
- `budget_owner_employee_id` is the shared owner of every selected budget code; the action resolves each budget code's `owner_employee_id`, feeds them to `validatePurchaseRequestInput`, and rejects mixed owners.
- Department manager = the applicant's department's `manager_employee_id`. General manager = the single employee with `is_general_manager = true`; chairman = the single employee with `is_chairman = true`.
- Writes use the service-role client; authorization is trivial here (applicant is always the caller), but the caller must be a registered employee.
- The action is not transactional across tables. Insert in dependency order (case → request → items → steps → notification); if any step after the case insert fails, delete what was created so far (the case cascade does not cover the request, so delete request then case explicitly) and return an error. Document this compensating-cleanup approach in a comment.
- After success, call `revalidatePath('/requests')` and `revalidatePath('/approvals')`.

- [ ] **Step 1: Write the failing integration test**

`tests/integration/purchase-request-create.test.ts`:
```ts
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  createServiceRoleTestClient,
  hasIntegrationTestCredentials,
} from './supabase-test-client';

// The action reads the caller via getCurrentEmployee(createSupabaseServerClient()).
// Stub that seam so the integration test can act as a chosen seed employee while
// every write still goes through the real service-role path against the live DB.
const currentEmployee = vi.hoisted(() => ({ value: null as null | { id: string } }));
vi.mock('@/lib/auth/current-employee', () => ({
  getCurrentEmployee: async () => currentEmployee.value,
}));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({}) }));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

describe.skipIf(!hasIntegrationTestCredentials())('createPurchaseRequest', () => {
  let admin: ReturnType<typeof createServiceRoleTestClient>;
  let applicantId: string;
  let budgetCodeId: string;
  const createdRequestIds: string[] = [];

  beforeAll(async () => {
    admin = createServiceRoleTestClient();
    // Pick a staff applicant whose department has a manager, and a budget code.
    const { data: emp } = await admin
      .from('employees')
      .select('id, department_id')
      .not('department_id', 'is', null)
      .limit(1)
      .single();
    applicantId = emp!.id;
    const { data: bc } = await admin
      .from('budget_codes')
      .select('id')
      .not('owner_employee_id', 'is', null)
      .limit(1)
      .single();
    budgetCodeId = bc!.id;
  });

  afterEach(async () => {
    currentEmployee.value = null;
    for (const id of createdRequestIds.splice(0)) {
      const { data: pr } = await admin
        .from('purchase_requests')
        .select('procurement_case_id')
        .eq('id', id)
        .maybeSingle();
      await admin.from('approval_steps').delete().eq('form_type', 'purchase_request').eq('form_id', id);
      await admin.from('notifications').delete().eq('form_type', 'purchase_request').eq('form_id', id);
      await admin.from('purchase_requests').delete().eq('id', id);
      if (pr?.procurement_case_id) {
        await admin.from('procurement_cases').delete().eq('id', pr.procurement_case_id);
      }
    }
  });

  it('rejects an empty item list', async () => {
    currentEmployee.value = { id: applicantId };
    const { createPurchaseRequest } = await import('@/lib/purchase-requests/actions');
    const result = await createPurchaseRequest({ neededWithinDays: 30, items: [] });
    expect(result).toEqual({ ok: false, error: '請購單至少需要一個明細項次' });
  });

  it('creates a case, request, items, and an approval chain', async () => {
    currentEmployee.value = { id: applicantId };
    const { createPurchaseRequest } = await import('@/lib/purchase-requests/actions');
    const result = await createPurchaseRequest({
      neededWithinDays: 30,
      items: [
        { budgetCodeId, description: '材料A', quantity: 1, estimatedAmount: 65000 },
        { budgetCodeId, description: '材料B', quantity: 2, estimatedAmount: 20000 },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    createdRequestIds.push(result.requestId);
    expect(result.caseNumber).toMatch(/^CP\d{9}$/);

    const { data: pr } = await admin
      .from('purchase_requests')
      .select('total_amount, status, current_step_order')
      .eq('id', result.requestId)
      .single();
    expect(Number(pr!.total_amount)).toBe(85000);

    const { data: steps } = await admin
      .from('approval_steps')
      .select('step_order, approver_role, status, approver_employee_id')
      .eq('form_type', 'purchase_request')
      .eq('form_id', result.requestId)
      .order('step_order');
    expect(steps!.length).toBeGreaterThanOrEqual(1);
    expect(steps![0].status).toBe('pending');
    expect(pr!.current_step_order).toBe(steps![0].step_order);

    const { data: notifs } = await admin
      .from('notifications')
      .select('recipient_employee_id, type')
      .eq('form_type', 'purchase_request')
      .eq('form_id', result.requestId);
    expect(notifs!.length).toBe(1);
    expect(notifs![0].type).toBe('approval_requested');
    expect(notifs![0].recipient_employee_id).toBe(steps![0].approver_employee_id);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `export $(grep -v '^#' .env.local | xargs) && npm test -- tests/integration/purchase-request-create.test.ts`
Expected: FAIL — `Cannot find module '@/lib/purchase-requests/actions'`.

- [ ] **Step 3: Implement the action**

`src/lib/purchase-requests/actions.ts`:
```ts
'use server';

import { revalidatePath } from 'next/cache';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { generateApprovalChain, type ApprovalChainStep } from '@/lib/approval/chain';
import {
  validatePurchaseRequestInput,
  type PurchaseRequestItemInput,
} from '@/lib/purchase-requests/validate';

export type NewPurchaseRequestItem = {
  budgetCodeId: string;
  description: string;
  quantity: number;
  estimatedAmount: number;
};

export type NewPurchaseRequest = {
  neededWithinDays: number | null;
  items: NewPurchaseRequestItem[];
};

export type CreateResult =
  | { ok: true; requestId: string; caseNumber: string }
  | { ok: false; error: string };

export async function createPurchaseRequest(input: NewPurchaseRequest): Promise<CreateResult> {
  const employee = await getCurrentEmployee(await createSupabaseServerClient());
  if (!employee) {
    return { ok: false, error: '找不到您的員工資料，請聯絡系統管理員' };
  }

  const db = createSupabaseServiceRoleClient();

  if (input.items.length === 0) {
    return { ok: false, error: '請購單至少需要一個明細項次' };
  }

  const budgetCodeIds = Array.from(new Set(input.items.map((i) => i.budgetCodeId)));
  const { data: budgetCodes, error: bcError } = await db
    .from('budget_codes')
    .select('id, category, owner_employee_id')
    .in('id', budgetCodeIds);
  if (bcError || !budgetCodes || budgetCodes.length !== budgetCodeIds.length) {
    return { ok: false, error: '選取的預算編號無效' };
  }
  const byId = new Map(budgetCodes.map((b) => [b.id, b]));

  const validationItems: PurchaseRequestItemInput[] = input.items.map((i) => {
    const bc = byId.get(i.budgetCodeId)!;
    return {
      budgetCodeId: i.budgetCodeId,
      budgetOwnerEmployeeId: bc.owner_employee_id ?? '',
      itemCategory: bc.category,
      description: i.description,
      quantity: i.quantity,
      estimatedAmount: i.estimatedAmount,
    };
  });
  const validation = validatePurchaseRequestInput(validationItems);
  if (!validation.ok) {
    return { ok: false, error: validation.error };
  }
  const budgetOwnerId = validationItems[0].budgetOwnerEmployeeId;
  if (!budgetOwnerId) {
    return { ok: false, error: '選取的預算編號沒有指定預算負責人' };
  }

  const totalAmount = input.items.reduce((sum, i) => sum + i.estimatedAmount, 0);

  const { data: dept } = await db
    .from('departments')
    .select('manager_employee_id')
    .eq('id', employee.departmentId)
    .single();
  const { data: gm } = await db
    .from('employees')
    .select('id')
    .eq('is_general_manager', true)
    .limit(1)
    .single();
  const { data: chairman } = await db
    .from('employees')
    .select('id')
    .eq('is_chairman', true)
    .limit(1)
    .single();

  const chain = generateApprovalChain({
    applicantEmployeeId: employee.id,
    departmentManagerEmployeeId: dept?.manager_employee_id ?? employee.id,
    budgetOwnerEmployeeId: budgetOwnerId,
    generalManagerEmployeeId: gm?.id ?? employee.id,
    chairmanEmployeeId: chairman?.id ?? employee.id,
    totalAmount,
  });

  const { data: caseNumber, error: numError } = await db.rpc('next_case_number');
  if (numError || !caseNumber) {
    return { ok: false, error: '產生案件單號失敗' };
  }
  const { data: pcase, error: caseError } = await db
    .from('procurement_cases')
    .insert({ case_number: caseNumber, created_by_employee_id: employee.id })
    .select()
    .single();
  if (caseError || !pcase) {
    return { ok: false, error: '建立採購案失敗' };
  }

  // Not transactional across tables; on any later failure we delete what we made.
  const cleanup = async (requestId?: string) => {
    if (requestId) {
      await db.from('approval_steps').delete().eq('form_type', 'purchase_request').eq('form_id', requestId);
      await db.from('notifications').delete().eq('form_type', 'purchase_request').eq('form_id', requestId);
      await db.from('purchase_requests').delete().eq('id', requestId);
    }
    await db.from('procurement_cases').delete().eq('id', pcase.id);
  };

  const isAutoApproved = chain.length === 0;
  const { data: pr, error: prError } = await db
    .from('purchase_requests')
    .insert({
      procurement_case_id: pcase.id,
      applicant_employee_id: employee.id,
      department_id: employee.departmentId,
      budget_owner_employee_id: budgetOwnerId,
      needed_within_days: input.neededWithinDays,
      total_amount: totalAmount,
      status: isAutoApproved ? 'approved' : 'pending_approval',
      current_step_order: isAutoApproved ? null : 1,
    })
    .select()
    .single();
  if (prError || !pr) {
    await cleanup();
    return { ok: false, error: '建立請購單失敗' };
  }

  const itemRows = input.items.map((i, idx) => ({
    purchase_request_id: pr.id,
    line_no: idx + 1,
    budget_code_id: i.budgetCodeId,
    item_category: byId.get(i.budgetCodeId)!.category,
    description: i.description,
    quantity: i.quantity,
    estimated_amount: i.estimatedAmount,
  }));
  const { error: itemsError } = await db.from('purchase_request_items').insert(itemRows);
  if (itemsError) {
    await cleanup(pr.id);
    return { ok: false, error: '建立請購明細失敗' };
  }

  if (!isAutoApproved) {
    const stepRows = chain.map((step: ApprovalChainStep, idx) => ({
      form_type: 'purchase_request',
      form_id: pr.id,
      step_order: idx + 1,
      approver_employee_id: step.approverEmployeeId,
      approver_role: step.approverRole,
    }));
    const { error: stepsError } = await db.from('approval_steps').insert(stepRows);
    if (stepsError) {
      await cleanup(pr.id);
      return { ok: false, error: '建立簽核流程失敗' };
    }

    const first = chain[0];
    const { error: notifError } = await db.from('notifications').insert({
      recipient_employee_id: first.approverEmployeeId,
      type: 'approval_requested',
      form_type: 'purchase_request',
      form_id: pr.id,
      case_number: caseNumber,
      message: `請購單 ${caseNumber} 待您簽核`,
    });
    if (notifError) {
      await cleanup(pr.id);
      return { ok: false, error: '建立通知失敗' };
    }
  }

  revalidatePath('/requests');
  revalidatePath('/approvals');
  return { ok: true, requestId: pr.id, caseNumber };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `export $(grep -v '^#' .env.local | xargs) && npm test -- tests/integration/purchase-request-create.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/purchase-requests/actions.ts tests/integration/purchase-request-create.test.ts
git commit -m "feat: add createPurchaseRequest server action"
```

---

## Task 9: `approvePurchaseRequestStep` + `returnPurchaseRequestStep` actions

**Files:**
- Modify: `src/lib/purchase-requests/actions.ts`
- Test: `tests/integration/purchase-request-approve-return.test.ts`

**Interfaces:**
- Consumes: everything Task 8's file already imports.
- Produces: `async approvePurchaseRequestStep(requestId: string): Promise<ActionResult>` and `async returnPurchaseRequestStep(requestId: string, reason: string): Promise<ActionResult>` where `ActionResult = { ok: true } | { ok: false; error: string }`. Approve marks the caller's current pending step approved and either advances to the next step (notifying that approver) or finalizes the request as `approved` (clearing `current_step_order`, notifying the applicant). Return marks the current pending step returned with a reason, sets the request `returned`, clears `current_step_order`, and notifies the applicant.

**Design notes:** authorization is the security boundary here (service role bypasses RLS). Both actions must confirm the request is `pending_approval`, load the step where `step_order = current_step_order`, and verify `approver_employee_id === caller.id` before mutating. Reject otherwise with `{ ok: false, error: '您不是這張請購單目前的簽核人' }`.

- [ ] **Step 1: Write the failing integration test**

`tests/integration/purchase-request-approve-return.test.ts`:
```ts
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  createServiceRoleTestClient,
  hasIntegrationTestCredentials,
} from './supabase-test-client';

const currentEmployee = vi.hoisted(() => ({ value: null as null | { id: string } }));
vi.mock('@/lib/auth/current-employee', () => ({
  getCurrentEmployee: async () => currentEmployee.value,
}));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({}) }));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

describe.skipIf(!hasIntegrationTestCredentials())('approve/return purchase request', () => {
  let admin: ReturnType<typeof createServiceRoleTestClient>;
  let applicantId: string;
  let budgetCodeId: string;
  const createdRequestIds: string[] = [];

  async function seedRequest(): Promise<{ requestId: string; firstApproverId: string }> {
    currentEmployee.value = { id: applicantId };
    const { createPurchaseRequest } = await import('@/lib/purchase-requests/actions');
    const result = await createPurchaseRequest({
      neededWithinDays: 30,
      items: [{ budgetCodeId, description: '簽核測試', quantity: 1, estimatedAmount: 5000 }],
    });
    if (!result.ok) throw new Error(result.error);
    createdRequestIds.push(result.requestId);
    const { data: step } = await admin
      .from('approval_steps')
      .select('approver_employee_id')
      .eq('form_type', 'purchase_request')
      .eq('form_id', result.requestId)
      .eq('step_order', 1)
      .single();
    return { requestId: result.requestId, firstApproverId: step!.approver_employee_id };
  }

  beforeAll(async () => {
    admin = createServiceRoleTestClient();
    const { data: emp } = await admin
      .from('employees')
      .select('id, department_id')
      .not('department_id', 'is', null)
      .limit(1)
      .single();
    applicantId = emp!.id;
    const { data: bc } = await admin
      .from('budget_codes')
      .select('id')
      .not('owner_employee_id', 'is', null)
      .limit(1)
      .single();
    budgetCodeId = bc!.id;
  });

  afterEach(async () => {
    currentEmployee.value = null;
    for (const id of createdRequestIds.splice(0)) {
      const { data: pr } = await admin
        .from('purchase_requests')
        .select('procurement_case_id')
        .eq('id', id)
        .maybeSingle();
      await admin.from('approval_steps').delete().eq('form_type', 'purchase_request').eq('form_id', id);
      await admin.from('notifications').delete().eq('form_type', 'purchase_request').eq('form_id', id);
      await admin.from('purchase_requests').delete().eq('id', id);
      if (pr?.procurement_case_id) await admin.from('procurement_cases').delete().eq('id', pr.procurement_case_id);
    }
  });

  it('rejects approval from someone who is not the current approver', async () => {
    const { requestId } = await seedRequest();
    currentEmployee.value = { id: '00000000-0000-0000-0000-000000000000' };
    const { approvePurchaseRequestStep } = await import('@/lib/purchase-requests/actions');
    const result = await approvePurchaseRequestStep(requestId);
    expect(result).toEqual({ ok: false, error: '您不是這張請購單目前的簽核人' });
  });

  it('advances the chain and finally approves the request', async () => {
    const { requestId } = await seedRequest();
    const { approvePurchaseRequestStep } = await import('@/lib/purchase-requests/actions');
    // Walk every step as its approver.
    for (let guard = 0; guard < 5; guard += 1) {
      const { data: pr } = await admin
        .from('purchase_requests')
        .select('status, current_step_order')
        .eq('id', requestId)
        .single();
      if (pr!.status === 'approved') break;
      const { data: step } = await admin
        .from('approval_steps')
        .select('approver_employee_id')
        .eq('form_type', 'purchase_request')
        .eq('form_id', requestId)
        .eq('step_order', pr!.current_step_order)
        .single();
      currentEmployee.value = { id: step!.approver_employee_id };
      const result = await approvePurchaseRequestStep(requestId);
      expect(result.ok).toBe(true);
    }
    const { data: final } = await admin
      .from('purchase_requests')
      .select('status, current_step_order')
      .eq('id', requestId)
      .single();
    expect(final!.status).toBe('approved');
    expect(final!.current_step_order).toBeNull();
    const { data: applicantNotif } = await admin
      .from('notifications')
      .select('type')
      .eq('form_id', requestId)
      .eq('recipient_employee_id', applicantId)
      .eq('type', 'request_approved');
    expect(applicantNotif!.length).toBeGreaterThanOrEqual(1);
  });

  it('returns the request to the applicant with a reason', async () => {
    const { requestId } = await seedRequest();
    const { data: step } = await admin
      .from('approval_steps')
      .select('approver_employee_id')
      .eq('form_type', 'purchase_request')
      .eq('form_id', requestId)
      .eq('step_order', 1)
      .single();
    currentEmployee.value = { id: step!.approver_employee_id };
    const { returnPurchaseRequestStep } = await import('@/lib/purchase-requests/actions');
    const result = await returnPurchaseRequestStep(requestId, '預算不足，請修改');
    expect(result.ok).toBe(true);
    const { data: pr } = await admin
      .from('purchase_requests')
      .select('status, current_step_order')
      .eq('id', requestId)
      .single();
    expect(pr!.status).toBe('returned');
    expect(pr!.current_step_order).toBeNull();
    const { data: returnedStep } = await admin
      .from('approval_steps')
      .select('status, comment')
      .eq('form_id', requestId)
      .eq('step_order', 1)
      .single();
    expect(returnedStep!.status).toBe('returned');
    expect(returnedStep!.comment).toBe('預算不足，請修改');
    const { data: notif } = await admin
      .from('notifications')
      .select('type')
      .eq('form_id', requestId)
      .eq('recipient_employee_id', applicantId)
      .eq('type', 'request_returned');
    expect(notif!.length).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `export $(grep -v '^#' .env.local | xargs) && npm test -- tests/integration/purchase-request-approve-return.test.ts`
Expected: FAIL — `approvePurchaseRequestStep is not a function` (not exported yet).

- [ ] **Step 3: Append the two actions to `src/lib/purchase-requests/actions.ts`**

```ts
export type ActionResult = { ok: true } | { ok: false; error: string };

async function loadCurrentStep(
  db: ReturnType<typeof createSupabaseServiceRoleClient>,
  requestId: string,
  callerId: string
) {
  const { data: pr } = await db
    .from('purchase_requests')
    .select('id, applicant_employee_id, status, current_step_order, procurement_case_id')
    .eq('id', requestId)
    .maybeSingle();
  if (!pr || pr.status !== 'pending_approval' || pr.current_step_order === null) {
    return { error: '這張請購單目前不在簽核中' as const };
  }
  const { data: step } = await db
    .from('approval_steps')
    .select('id, step_order, approver_employee_id')
    .eq('form_type', 'purchase_request')
    .eq('form_id', requestId)
    .eq('step_order', pr.current_step_order)
    .maybeSingle();
  if (!step || step.approver_employee_id !== callerId) {
    return { error: '您不是這張請購單目前的簽核人' as const };
  }
  return { pr, step };
}

export async function approvePurchaseRequestStep(requestId: string): Promise<ActionResult> {
  const employee = await getCurrentEmployee(await createSupabaseServerClient());
  if (!employee) return { ok: false, error: '找不到您的員工資料' };
  const db = createSupabaseServiceRoleClient();

  const loaded = await loadCurrentStep(db, requestId, employee.id);
  if ('error' in loaded) return { ok: false, error: loaded.error };
  const { pr, step } = loaded;

  await db
    .from('approval_steps')
    .update({ status: 'approved', acted_at: new Date().toISOString() })
    .eq('id', step.id);

  const { data: caseRow } = await db
    .from('procurement_cases')
    .select('case_number')
    .eq('id', pr.procurement_case_id)
    .single();
  const caseNumber = caseRow!.case_number;

  const { data: nextStep } = await db
    .from('approval_steps')
    .select('step_order, approver_employee_id')
    .eq('form_type', 'purchase_request')
    .eq('form_id', requestId)
    .eq('step_order', step.step_order + 1)
    .maybeSingle();

  if (nextStep) {
    await db
      .from('purchase_requests')
      .update({ current_step_order: nextStep.step_order, updated_at: new Date().toISOString() })
      .eq('id', requestId);
    await db.from('notifications').insert({
      recipient_employee_id: nextStep.approver_employee_id,
      type: 'approval_requested',
      form_type: 'purchase_request',
      form_id: requestId,
      case_number: caseNumber,
      message: `請購單 ${caseNumber} 待您簽核`,
    });
  } else {
    await db
      .from('purchase_requests')
      .update({ status: 'approved', current_step_order: null, updated_at: new Date().toISOString() })
      .eq('id', requestId);
    await db.from('notifications').insert({
      recipient_employee_id: pr.applicant_employee_id,
      type: 'request_approved',
      form_type: 'purchase_request',
      form_id: requestId,
      case_number: caseNumber,
      message: `請購單 ${caseNumber} 已完成簽核`,
    });
  }

  revalidatePath('/approvals');
  revalidatePath(`/requests/${requestId}`);
  return { ok: true };
}

export async function returnPurchaseRequestStep(
  requestId: string,
  reason: string
): Promise<ActionResult> {
  const employee = await getCurrentEmployee(await createSupabaseServerClient());
  if (!employee) return { ok: false, error: '找不到您的員工資料' };
  if (reason.trim() === '') return { ok: false, error: '請填寫退回原因' };
  const db = createSupabaseServiceRoleClient();

  const loaded = await loadCurrentStep(db, requestId, employee.id);
  if ('error' in loaded) return { ok: false, error: loaded.error };
  const { pr, step } = loaded;

  await db
    .from('approval_steps')
    .update({ status: 'returned', comment: reason, acted_at: new Date().toISOString() })
    .eq('id', step.id);
  await db
    .from('purchase_requests')
    .update({ status: 'returned', current_step_order: null, updated_at: new Date().toISOString() })
    .eq('id', requestId);

  const { data: caseRow } = await db
    .from('procurement_cases')
    .select('case_number')
    .eq('id', pr.procurement_case_id)
    .single();
  await db.from('notifications').insert({
    recipient_employee_id: pr.applicant_employee_id,
    type: 'request_returned',
    form_type: 'purchase_request',
    form_id: requestId,
    case_number: caseRow!.case_number,
    message: `請購單 ${caseRow!.case_number} 已被退回：${reason}`,
  });

  revalidatePath('/approvals');
  revalidatePath(`/requests/${requestId}`);
  return { ok: true };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `export $(grep -v '^#' .env.local | xargs) && npm test -- tests/integration/purchase-request-approve-return.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/purchase-requests/actions.ts tests/integration/purchase-request-approve-return.test.ts
git commit -m "feat: add approve and return purchase request actions"
```

---

## Task 10: `resubmitPurchaseRequest` action

**Files:**
- Modify: `src/lib/purchase-requests/actions.ts`
- Test: `tests/integration/purchase-request-resubmit.test.ts`

**Interfaces:**
- Consumes: the same imports.
- Produces: `async resubmitPurchaseRequest(requestId: string, input: NewPurchaseRequest): Promise<ActionResult>`. Only the applicant may call it, and only while the request is `returned`. It re-validates the new items, recomputes the total and the approval chain (amount/budget owner may have changed), replaces the request's items and approval steps, resets the request to `pending_approval` with `current_step_order = 1`, and notifies the first approver again.

- [ ] **Step 1: Write the failing integration test**

`tests/integration/purchase-request-resubmit.test.ts`:
```ts
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  createServiceRoleTestClient,
  hasIntegrationTestCredentials,
} from './supabase-test-client';

const currentEmployee = vi.hoisted(() => ({ value: null as null | { id: string } }));
vi.mock('@/lib/auth/current-employee', () => ({
  getCurrentEmployee: async () => currentEmployee.value,
}));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({}) }));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

describe.skipIf(!hasIntegrationTestCredentials())('resubmitPurchaseRequest', () => {
  let admin: ReturnType<typeof createServiceRoleTestClient>;
  let applicantId: string;
  let budgetCodeId: string;
  const createdRequestIds: string[] = [];

  beforeAll(async () => {
    admin = createServiceRoleTestClient();
    const { data: emp } = await admin
      .from('employees')
      .select('id, department_id')
      .not('department_id', 'is', null)
      .limit(1)
      .single();
    applicantId = emp!.id;
    const { data: bc } = await admin
      .from('budget_codes')
      .select('id')
      .not('owner_employee_id', 'is', null)
      .limit(1)
      .single();
    budgetCodeId = bc!.id;
  });

  afterEach(async () => {
    currentEmployee.value = null;
    for (const id of createdRequestIds.splice(0)) {
      const { data: pr } = await admin
        .from('purchase_requests')
        .select('procurement_case_id')
        .eq('id', id)
        .maybeSingle();
      await admin.from('approval_steps').delete().eq('form_type', 'purchase_request').eq('form_id', id);
      await admin.from('notifications').delete().eq('form_type', 'purchase_request').eq('form_id', id);
      await admin.from('purchase_requests').delete().eq('id', id);
      if (pr?.procurement_case_id) await admin.from('procurement_cases').delete().eq('id', pr.procurement_case_id);
    }
  });

  it('re-validates, resets the chain, and returns the request to pending', async () => {
    currentEmployee.value = { id: applicantId };
    const actions = await import('@/lib/purchase-requests/actions');
    const created = await actions.createPurchaseRequest({
      neededWithinDays: 30,
      items: [{ budgetCodeId, description: '原始', quantity: 1, estimatedAmount: 5000 }],
    });
    if (!created.ok) throw new Error(created.error);
    createdRequestIds.push(created.requestId);

    // Return it first.
    const { data: step } = await admin
      .from('approval_steps')
      .select('approver_employee_id')
      .eq('form_id', created.requestId)
      .eq('step_order', 1)
      .single();
    currentEmployee.value = { id: step!.approver_employee_id };
    await actions.returnPurchaseRequestStep(created.requestId, '請修改');

    // Applicant resubmits with a changed amount.
    currentEmployee.value = { id: applicantId };
    const result = await actions.resubmitPurchaseRequest(created.requestId, {
      neededWithinDays: 15,
      items: [{ budgetCodeId, description: '修改後', quantity: 2, estimatedAmount: 9000 }],
    });
    expect(result.ok).toBe(true);

    const { data: pr } = await admin
      .from('purchase_requests')
      .select('status, current_step_order, total_amount')
      .eq('id', created.requestId)
      .single();
    expect(pr!.status).toBe('pending_approval');
    expect(pr!.current_step_order).toBe(1);
    expect(Number(pr!.total_amount)).toBe(9000);

    const { data: items } = await admin
      .from('purchase_request_items')
      .select('description')
      .eq('purchase_request_id', created.requestId);
    expect(items!.map((i) => i.description)).toEqual(['修改後']);

    const { data: steps } = await admin
      .from('approval_steps')
      .select('status')
      .eq('form_id', created.requestId)
      .order('step_order');
    expect(steps!.every((s) => s.status === 'pending')).toBe(true);
  });

  it('rejects resubmit by a non-applicant', async () => {
    currentEmployee.value = { id: applicantId };
    const actions = await import('@/lib/purchase-requests/actions');
    const created = await actions.createPurchaseRequest({
      neededWithinDays: 30,
      items: [{ budgetCodeId, description: '原始', quantity: 1, estimatedAmount: 5000 }],
    });
    if (!created.ok) throw new Error(created.error);
    createdRequestIds.push(created.requestId);
    const { data: step } = await admin
      .from('approval_steps')
      .select('approver_employee_id')
      .eq('form_id', created.requestId)
      .eq('step_order', 1)
      .single();
    currentEmployee.value = { id: step!.approver_employee_id };
    await actions.returnPurchaseRequestStep(created.requestId, '請修改');

    currentEmployee.value = { id: '00000000-0000-0000-0000-000000000000' };
    const result = await actions.resubmitPurchaseRequest(created.requestId, {
      neededWithinDays: 15,
      items: [{ budgetCodeId, description: 'x', quantity: 1, estimatedAmount: 100 }],
    });
    expect(result).toEqual({ ok: false, error: '只有申請人可以重新送出這張請購單' });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `export $(grep -v '^#' .env.local | xargs) && npm test -- tests/integration/purchase-request-resubmit.test.ts`
Expected: FAIL — `resubmitPurchaseRequest is not a function`.

- [ ] **Step 3: Append the action to `src/lib/purchase-requests/actions.ts`**

```ts
export async function resubmitPurchaseRequest(
  requestId: string,
  input: NewPurchaseRequest
): Promise<ActionResult> {
  const employee = await getCurrentEmployee(await createSupabaseServerClient());
  if (!employee) return { ok: false, error: '找不到您的員工資料' };
  const db = createSupabaseServiceRoleClient();

  const { data: pr } = await db
    .from('purchase_requests')
    .select('id, applicant_employee_id, status, department_id, procurement_case_id')
    .eq('id', requestId)
    .maybeSingle();
  if (!pr) return { ok: false, error: '找不到這張請購單' };
  if (pr.applicant_employee_id !== employee.id) {
    return { ok: false, error: '只有申請人可以重新送出這張請購單' };
  }
  if (pr.status !== 'returned') {
    return { ok: false, error: '只有被退回的請購單可以重新送出' };
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

  const { data: dept } = await db
    .from('departments')
    .select('manager_employee_id')
    .eq('id', pr.department_id)
    .single();
  const { data: gm } = await db.from('employees').select('id').eq('is_general_manager', true).limit(1).single();
  const { data: chairman } = await db.from('employees').select('id').eq('is_chairman', true).limit(1).single();
  const chain = generateApprovalChain({
    applicantEmployeeId: employee.id,
    departmentManagerEmployeeId: dept?.manager_employee_id ?? employee.id,
    budgetOwnerEmployeeId: budgetOwnerId,
    generalManagerEmployeeId: gm?.id ?? employee.id,
    chairmanEmployeeId: chairman?.id ?? employee.id,
    totalAmount,
  });
  if (chain.length === 0) {
    return { ok: false, error: '重新送出後找不到適用的簽核人，請聯絡系統管理員' };
  }

  await db.from('purchase_request_items').delete().eq('purchase_request_id', requestId);
  await db.from('approval_steps').delete().eq('form_type', 'purchase_request').eq('form_id', requestId);

  await db.from('purchase_request_items').insert(
    input.items.map((i, idx) => ({
      purchase_request_id: requestId,
      line_no: idx + 1,
      budget_code_id: i.budgetCodeId,
      item_category: byId.get(i.budgetCodeId)!.category,
      description: i.description,
      quantity: i.quantity,
      estimated_amount: i.estimatedAmount,
    }))
  );
  await db.from('approval_steps').insert(
    chain.map((step, idx) => ({
      form_type: 'purchase_request',
      form_id: requestId,
      step_order: idx + 1,
      approver_employee_id: step.approverEmployeeId,
      approver_role: step.approverRole,
    }))
  );
  await db
    .from('purchase_requests')
    .update({
      budget_owner_employee_id: budgetOwnerId,
      needed_within_days: input.neededWithinDays,
      total_amount: totalAmount,
      status: 'pending_approval',
      current_step_order: 1,
      updated_at: new Date().toISOString(),
    })
    .eq('id', requestId);

  const { data: caseRow } = await db
    .from('procurement_cases')
    .select('case_number')
    .eq('id', pr.procurement_case_id)
    .single();
  await db.from('notifications').insert({
    recipient_employee_id: chain[0].approverEmployeeId,
    type: 'approval_requested',
    form_type: 'purchase_request',
    form_id: requestId,
    case_number: caseRow!.case_number,
    message: `請購單 ${caseRow!.case_number} 已重新送出，待您簽核`,
  });

  revalidatePath('/approvals');
  revalidatePath(`/requests/${requestId}`);
  return { ok: true };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `export $(grep -v '^#' .env.local | xargs) && npm test -- tests/integration/purchase-request-resubmit.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/purchase-requests/actions.ts tests/integration/purchase-request-resubmit.test.ts
git commit -m "feat: add resubmitPurchaseRequest action"
```

---

## Task 11: Read query helpers for pages

**Files:**
- Create: `src/lib/purchase-requests/queries.ts`
- Create: `src/lib/notifications/queries.ts`
- Test: `tests/integration/purchase-request-queries.test.ts`

**Interfaces:**
- Consumes: `createSupabaseServerClient` (user-session, RLS-enforced), `getCurrentEmployee`.
- Produces:
  - `getMyRequests(): Promise<RequestSummary[]>` — requests where the caller is the applicant, newest first. `RequestSummary = { id: string; caseNumber: string; status: string; totalAmount: number; requestDate: string }`.
  - `getPurchaseRequestDetail(requestId: string): Promise<RequestDetail | null>` — the request plus items plus ordered approval steps (with approver names), or null if not visible. `RequestDetail = { id; caseNumber; status; totalAmount; neededWithinDays; applicantName; departmentName; currentStepOrder: number | null; items: DetailItem[]; steps: DetailStep[] }`; `DetailItem = { lineNo; budgetCode; itemCategory; description; quantity; estimatedAmount }`; `DetailStep = { stepOrder; approverEmployeeId; approverName; approverRole; status; comment: string | null }`.
  - `getMyApprovalQueue(): Promise<QueueItem[]>` — requests currently pending the caller's signature (they are the approver of the step whose `step_order = current_step_order`). `QueueItem = { id; caseNumber; applicantName; totalAmount; requestDate }`.
  - `getMyNotifications(): Promise<NotificationRow[]>` and `getUnreadNotificationCount(): Promise<number>` from `src/lib/notifications/queries.ts`. `NotificationRow = { id; type; caseNumber; message; isRead; formId; createdAt }`.

**Design notes:** all reads use the user-session client so RLS scopes visibility. The approval queue is computed by reading the caller's pending approval steps joined to requests where `current_step_order === step_order` and `status = 'pending_approval'`. Because RLS already restricts what the caller can see, these helpers do not re-check authorization.

- [ ] **Step 1: Write the failing integration test**

`tests/integration/purchase-request-queries.test.ts`:
```ts
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  createServiceRoleTestClient,
  hasIntegrationTestCredentials,
} from './supabase-test-client';

const currentEmployee = vi.hoisted(() => ({ value: null as null | { id: string; departmentId: string } }));
vi.mock('@/lib/auth/current-employee', () => ({
  getCurrentEmployee: async () => currentEmployee.value,
}));
// Route the user-session client used by the queries to the service-role client for
// the test (RLS scoping itself is covered by procurement-rls.test.ts).
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => {
    const { createServiceRoleTestClient } = await import('./supabase-test-client');
    return createServiceRoleTestClient();
  },
}));

describe.skipIf(!hasIntegrationTestCredentials())('purchase request queries', () => {
  let admin: ReturnType<typeof createServiceRoleTestClient>;
  let applicantId: string;
  let applicantDept: string;
  let budgetCodeId: string;
  let requestId: string;

  beforeAll(async () => {
    admin = createServiceRoleTestClient();
    const { data: emp } = await admin
      .from('employees')
      .select('id, department_id')
      .not('department_id', 'is', null)
      .limit(1)
      .single();
    applicantId = emp!.id;
    applicantDept = emp!.department_id;
    const { data: bc } = await admin
      .from('budget_codes')
      .select('id')
      .not('owner_employee_id', 'is', null)
      .limit(1)
      .single();
    budgetCodeId = bc!.id;
    currentEmployee.value = { id: applicantId, departmentId: applicantDept };
    const actions = await import('@/lib/purchase-requests/actions');
    vi.doMock('next/cache', () => ({ revalidatePath: () => {} }));
    const created = await actions.createPurchaseRequest({
      neededWithinDays: 30,
      items: [{ budgetCodeId, description: '查詢測試', quantity: 1, estimatedAmount: 5000 }],
    });
    if (!created.ok) throw new Error(created.error);
    requestId = created.requestId;
  });

  afterAll(async () => {
    const { data: pr } = await admin
      .from('purchase_requests')
      .select('procurement_case_id')
      .eq('id', requestId)
      .maybeSingle();
    await admin.from('approval_steps').delete().eq('form_id', requestId);
    await admin.from('notifications').delete().eq('form_id', requestId);
    await admin.from('purchase_requests').delete().eq('id', requestId);
    if (pr?.procurement_case_id) await admin.from('procurement_cases').delete().eq('id', pr.procurement_case_id);
    currentEmployee.value = null;
  });

  it('getMyRequests returns the applicant’s request', async () => {
    currentEmployee.value = { id: applicantId, departmentId: applicantDept };
    const { getMyRequests } = await import('@/lib/purchase-requests/queries');
    const rows = await getMyRequests();
    expect(rows.some((r) => r.id === requestId)).toBe(true);
  });

  it('getPurchaseRequestDetail returns items and steps', async () => {
    const { getPurchaseRequestDetail } = await import('@/lib/purchase-requests/queries');
    const detail = await getPurchaseRequestDetail(requestId);
    expect(detail).not.toBeNull();
    expect(detail!.items).toHaveLength(1);
    expect(detail!.steps.length).toBeGreaterThanOrEqual(1);
    expect(detail!.items[0].description).toBe('查詢測試');
  });

  it('getMyApprovalQueue returns requests pending the caller', async () => {
    const { data: step } = await admin
      .from('approval_steps')
      .select('approver_employee_id')
      .eq('form_id', requestId)
      .eq('step_order', 1)
      .single();
    currentEmployee.value = { id: step!.approver_employee_id, departmentId: applicantDept };
    const { getMyApprovalQueue } = await import('@/lib/purchase-requests/queries');
    const queue = await getMyApprovalQueue();
    expect(queue.some((q) => q.id === requestId)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `export $(grep -v '^#' .env.local | xargs) && npm test -- tests/integration/purchase-request-queries.test.ts`
Expected: FAIL — `Cannot find module '@/lib/purchase-requests/queries'`.

- [ ] **Step 3: Implement `src/lib/purchase-requests/queries.ts`**

```ts
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getCurrentEmployee } from '@/lib/auth/current-employee';

export type RequestSummary = {
  id: string;
  caseNumber: string;
  status: string;
  totalAmount: number;
  requestDate: string;
};

export type DetailItem = {
  lineNo: number;
  budgetCode: string;
  itemCategory: string;
  description: string;
  quantity: number;
  estimatedAmount: number;
};

export type DetailStep = {
  stepOrder: number;
  approverEmployeeId: string;
  approverName: string;
  approverRole: string;
  status: string;
  comment: string | null;
};

export type RequestDetail = {
  id: string;
  caseNumber: string;
  status: string;
  totalAmount: number;
  neededWithinDays: number | null;
  applicantName: string;
  departmentName: string;
  currentStepOrder: number | null;
  items: DetailItem[];
  steps: DetailStep[];
};

export type QueueItem = {
  id: string;
  caseNumber: string;
  applicantName: string;
  totalAmount: number;
  requestDate: string;
};

export async function getMyRequests(): Promise<RequestSummary[]> {
  const supabase = await createSupabaseServerClient();
  const employee = await getCurrentEmployee(supabase);
  if (!employee) return [];
  const { data } = await supabase
    .from('purchase_requests')
    .select('id, total_amount, status, request_date, procurement_cases(case_number)')
    .eq('applicant_employee_id', employee.id)
    .order('created_at', { ascending: false });
  return (data ?? []).map((r) => ({
    id: r.id,
    caseNumber: (r.procurement_cases as { case_number: string }).case_number,
    status: r.status,
    totalAmount: Number(r.total_amount),
    requestDate: r.request_date,
  }));
}

export async function getPurchaseRequestDetail(requestId: string): Promise<RequestDetail | null> {
  const supabase = await createSupabaseServerClient();
  const { data: pr } = await supabase
    .from('purchase_requests')
    .select(
      'id, total_amount, status, needed_within_days, current_step_order, ' +
        'procurement_cases(case_number), applicant:employees!applicant_employee_id(name), departments(name)'
    )
    .eq('id', requestId)
    .maybeSingle();
  if (!pr) return null;

  const { data: items } = await supabase
    .from('purchase_request_items')
    .select('line_no, item_category, description, quantity, estimated_amount, budget_codes(code)')
    .eq('purchase_request_id', requestId)
    .order('line_no');

  const { data: steps } = await supabase
    .from('approval_steps')
    .select(
      'step_order, approver_role, status, comment, approver_employee_id, ' +
        'approver:employees!approver_employee_id(name)'
    )
    .eq('form_type', 'purchase_request')
    .eq('form_id', requestId)
    .order('step_order');

  return {
    id: pr.id,
    caseNumber: (pr.procurement_cases as { case_number: string }).case_number,
    status: pr.status,
    totalAmount: Number(pr.total_amount),
    neededWithinDays: pr.needed_within_days,
    applicantName: (pr.applicant as { name: string }).name,
    departmentName: (pr.departments as { name: string }).name,
    currentStepOrder: pr.current_step_order,
    items: (items ?? []).map((i) => ({
      lineNo: i.line_no,
      budgetCode: (i.budget_codes as { code: string }).code,
      itemCategory: i.item_category,
      description: i.description,
      quantity: i.quantity,
      estimatedAmount: Number(i.estimated_amount),
    })),
    steps: (steps ?? []).map((s) => ({
      stepOrder: s.step_order,
      approverEmployeeId: s.approver_employee_id,
      approverName: (s.approver as { name: string }).name,
      approverRole: s.approver_role,
      status: s.status,
      comment: s.comment,
    })),
  };
}

export async function getMyApprovalQueue(): Promise<QueueItem[]> {
  const supabase = await createSupabaseServerClient();
  const employee = await getCurrentEmployee(supabase);
  if (!employee) return [];
  const { data: steps } = await supabase
    .from('approval_steps')
    .select('form_id, step_order')
    .eq('form_type', 'purchase_request')
    .eq('approver_employee_id', employee.id)
    .eq('status', 'pending');
  const formIds = (steps ?? []).map((s) => s.form_id);
  if (formIds.length === 0) return [];
  const { data: requests } = await supabase
    .from('purchase_requests')
    .select(
      'id, total_amount, request_date, current_step_order, status, ' +
        'procurement_cases(case_number), applicant:employees!applicant_employee_id(name)'
    )
    .in('id', formIds)
    .eq('status', 'pending_approval');
  const stepOrderByForm = new Map((steps ?? []).map((s) => [s.form_id, s.step_order]));
  return (requests ?? [])
    .filter((r) => r.current_step_order === stepOrderByForm.get(r.id))
    .map((r) => ({
      id: r.id,
      caseNumber: (r.procurement_cases as { case_number: string }).case_number,
      applicantName: (r.applicant as { name: string }).name,
      totalAmount: Number(r.total_amount),
      requestDate: r.request_date,
    }));
}
```

- [ ] **Step 4: Implement `src/lib/notifications/queries.ts`**

```ts
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getCurrentEmployee } from '@/lib/auth/current-employee';

export type NotificationRow = {
  id: string;
  type: string;
  caseNumber: string;
  message: string;
  isRead: boolean;
  formId: string;
  createdAt: string;
};

export async function getMyNotifications(): Promise<NotificationRow[]> {
  const supabase = await createSupabaseServerClient();
  const employee = await getCurrentEmployee(supabase);
  if (!employee) return [];
  const { data } = await supabase
    .from('notifications')
    .select('id, type, case_number, message, is_read, form_id, created_at')
    .eq('recipient_employee_id', employee.id)
    .order('created_at', { ascending: false });
  return (data ?? []).map((n) => ({
    id: n.id,
    type: n.type,
    caseNumber: n.case_number,
    message: n.message,
    isRead: n.is_read,
    formId: n.form_id,
    createdAt: n.created_at,
  }));
}

export async function getUnreadNotificationCount(): Promise<number> {
  const supabase = await createSupabaseServerClient();
  const employee = await getCurrentEmployee(supabase);
  if (!employee) return 0;
  const { count } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('recipient_employee_id', employee.id)
    .eq('is_read', false);
  return count ?? 0;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `export $(grep -v '^#' .env.local | xargs) && npm test -- tests/integration/purchase-request-queries.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Run the full suite**

Run: `export $(grep -v '^#' .env.local | xargs) && npm test`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/lib/purchase-requests/queries.ts src/lib/notifications/queries.ts tests/integration/purchase-request-queries.test.ts
git commit -m "feat: add read query helpers for requests, approvals, notifications"
```

---

## Task 12: `/requests/new` create form page

**Files:**
- Create: `src/app/requests/new/page.tsx` (server component)
- Create: `src/app/requests/new/purchase-request-form.tsx` (client component)

**Interfaces:**
- Consumes: `createSupabaseServerClient`, `getCurrentEmployee`, `createPurchaseRequest` (Task 8).
- Produces: the create page at `/requests/new`. No later task consumes it.

**Design notes:** the server page loads the caller's employee record and the list of budget codes (id, code, category, department name, owner id, owner name) for the dropdowns, and renders the client form. The client form manages dynamic line items (add/remove), each row picking a budget code (which fixes `itemCategory` from the code's category, editable) plus description, quantity, estimated amount. On submit it calls `createPurchaseRequest`; on `{ ok: true }` it navigates to `/requests/[id]`; on `{ ok: false }` it shows the error. Show a soft, non-blocking warning under a row when `itemCategory === '材料'` but `estimatedAmount >= 80000` (spec's 設備/材料 rule).

- [ ] **Step 1: Write the server page**

`src/app/requests/new/page.tsx`:
```tsx
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { PurchaseRequestForm, type BudgetCodeOption } from './purchase-request-form';

export default async function NewRequestPage() {
  const supabase = await createSupabaseServerClient();
  const employee = await getCurrentEmployee(supabase);
  if (!employee) redirect('/login');

  const { data } = await supabase
    .from('budget_codes')
    .select('id, code, category, departments(name), owner:employees!owner_employee_id(id, name)')
    .order('code');

  const budgetCodes: BudgetCodeOption[] = (data ?? []).map((b) => ({
    id: b.id,
    code: b.code,
    category: b.category,
    departmentName: (b.departments as { name: string } | null)?.name ?? '',
    ownerId: (b.owner as { id: string } | null)?.id ?? '',
    ownerName: (b.owner as { name: string } | null)?.name ?? '（未指定）',
  }));

  return (
    <main className="mx-auto max-w-4xl p-8">
      <h1 className="mb-6 text-2xl font-bold">新增請購申請單</h1>
      <p className="mb-4 text-sm text-gray-600">
        申請單位：{employee.name}｜提醒：一張請購單的所有預算編號必須屬於同一位預算負責人。
      </p>
      <PurchaseRequestForm budgetCodes={budgetCodes} />
    </main>
  );
}
```

- [ ] **Step 2: Write the client form**

`src/app/requests/new/purchase-request-form.tsx`:
```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createPurchaseRequest } from '@/lib/purchase-requests/actions';

export type BudgetCodeOption = {
  id: string;
  code: string;
  category: string;
  departmentName: string;
  ownerId: string;
  ownerName: string;
};

type Row = {
  budgetCodeId: string;
  itemCategory: string;
  description: string;
  quantity: string;
  estimatedAmount: string;
};

const emptyRow: Row = {
  budgetCodeId: '',
  itemCategory: '',
  description: '',
  quantity: '1',
  estimatedAmount: '',
};

export function PurchaseRequestForm({ budgetCodes }: { budgetCodes: BudgetCodeOption[] }) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([{ ...emptyRow }]);
  const [neededWithinDays, setNeededWithinDays] = useState('30');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const byId = new Map(budgetCodes.map((b) => [b.id, b]));

  const setRow = (index: number, patch: Partial<Row>) => {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };

  const onPickBudget = (index: number, budgetCodeId: string) => {
    const bc = byId.get(budgetCodeId);
    setRow(index, { budgetCodeId, itemCategory: bc?.category ?? '' });
  };

  const onSubmit = async () => {
    setError(null);
    setSubmitting(true);
    const result = await createPurchaseRequest({
      neededWithinDays: neededWithinDays === '' ? null : Number(neededWithinDays),
      items: rows.map((r) => ({
        budgetCodeId: r.budgetCodeId,
        description: r.description,
        quantity: Number(r.quantity),
        estimatedAmount: Number(r.estimatedAmount),
      })),
    });
    setSubmitting(false);
    if (result.ok) {
      router.push(`/requests/${result.requestId}`);
    } else {
      setError(result.error);
    }
  };

  const total = rows.reduce((sum, r) => sum + (Number(r.estimatedAmount) || 0), 0);

  return (
    <div className="space-y-4">
      <label className="block text-sm">
        預計需求天數：
        <input
          type="number"
          value={neededWithinDays}
          onChange={(e) => setNeededWithinDays(e.target.value)}
          className="ml-2 w-24 rounded border px-2 py-1"
        />
      </label>

      {rows.map((row, i) => {
        const bc = byId.get(row.budgetCodeId);
        const amount = Number(row.estimatedAmount) || 0;
        const materialWarning = row.itemCategory === '材料' && amount >= 80000;
        return (
          <div key={i} className="space-y-2 rounded border p-3">
            <div className="flex items-center gap-2">
              <span className="w-8 text-sm text-gray-500">第 {i + 1} 項</span>
              <select
                value={row.budgetCodeId}
                onChange={(e) => onPickBudget(i, e.target.value)}
                className="flex-1 rounded border px-2 py-1"
              >
                <option value="">選擇預算編號</option>
                {budgetCodes.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.code}｜{b.category}｜{b.departmentName}｜負責人：{b.ownerName}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex gap-2">
              <span className="flex w-24 items-center rounded border bg-gray-50 px-2 py-1 text-sm text-gray-600">
                {row.itemCategory || '項目'}
              </span>
              <input
                value={row.description}
                onChange={(e) => setRow(i, { description: e.target.value })}
                placeholder="說明"
                className="flex-1 rounded border px-2 py-1"
              />
              <input
                type="number"
                value={row.quantity}
                onChange={(e) => setRow(i, { quantity: e.target.value })}
                placeholder="數量"
                className="w-20 rounded border px-2 py-1"
              />
              <input
                type="number"
                value={row.estimatedAmount}
                onChange={(e) => setRow(i, { estimatedAmount: e.target.value })}
                placeholder="預估費用"
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
            {bc && <p className="text-xs text-gray-500">預算負責人：{bc.ownerName}</p>}
            {materialWarning && (
              <p className="text-xs text-amber-600">
                提醒：未稅金額達 80,000 以上、且非隨車出售者，項目應選「設備」。
              </p>
            )}
          </div>
        );
      })}

      <button
        type="button"
        onClick={() => setRows((prev) => [...prev, { ...emptyRow }])}
        className="rounded border px-3 py-1 text-sm"
      >
        + 新增一項
      </button>

      <p className="text-right font-semibold">總計：NT$ {total.toLocaleString()}</p>

      {error && <p className="rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}

      <button
        type="button"
        onClick={onSubmit}
        disabled={submitting}
        className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {submitting ? '送出中…' : '送出簽核'}
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Verify the build compiles**

Run: `npm run build`
Expected: build succeeds; `/requests/new` appears in the route list.

- [ ] **Step 4: Commit**

```bash
git add src/app/requests/new
git commit -m "feat: add purchase request create form page"
```

---

## Task 13: `/requests` list + `/requests/[id]` detail with approval actions

**Files:**
- Create: `src/app/requests/page.tsx`
- Create: `src/app/requests/[id]/page.tsx`
- Create: `src/app/requests/[id]/approval-actions.tsx` (client)

**Interfaces:**
- Consumes: `getMyRequests`, `getPurchaseRequestDetail` (Task 11), `createSupabaseServerClient` + `getCurrentEmployee`, `approvePurchaseRequestStep` + `returnPurchaseRequestStep` (Task 9).
- Produces: `/requests` (applicant's own list) and `/requests/[id]` (detail). No later task consumes them.

**Design notes:** the detail page loads the request, resolves whether the current viewer is the current pending approver (their id equals the approver of the step whose `step_order === currentStepOrder` and status is `pending_approval`), and if so renders the client approval-actions component (approve / return-with-reason). Status labels in Traditional Chinese: `pending_approval → 簽核中`, `approved → 已核准`, `returned → 已退回（待修改）`. Approver role labels: `department_manager → 申請單位主管`, `budget_owner → 預算負責人`, `general_manager → 總經理`, `chairman → 董事長`.

- [ ] **Step 1: Write the requests list page**

`src/app/requests/page.tsx`:
```tsx
import Link from 'next/link';
import { getMyRequests } from '@/lib/purchase-requests/queries';

const STATUS_LABELS: Record<string, string> = {
  pending_approval: '簽核中',
  approved: '已核准',
  returned: '已退回（待修改）',
};

export default async function RequestsPage() {
  const requests = await getMyRequests();
  return (
    <main className="mx-auto max-w-4xl p-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">我的請購單</h1>
        <Link href="/requests/new" className="rounded bg-blue-600 px-4 py-2 text-white">
          新增請購單
        </Link>
      </div>
      {requests.length === 0 ? (
        <p className="text-gray-500">目前沒有請購單。</p>
      ) : (
        <ul className="divide-y rounded border">
          {requests.map((r) => (
            <li key={r.id}>
              <Link href={`/requests/${r.id}`} className="flex justify-between p-4 hover:bg-gray-50">
                <span className="font-mono">{r.caseNumber}</span>
                <span>NT$ {r.totalAmount.toLocaleString()}</span>
                <span>{STATUS_LABELS[r.status] ?? r.status}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
```

- [ ] **Step 2: Write the detail page**

`src/app/requests/[id]/page.tsx`:
```tsx
import { notFound } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { getPurchaseRequestDetail } from '@/lib/purchase-requests/queries';
import { ApprovalActions } from './approval-actions';

const STATUS_LABELS: Record<string, string> = {
  pending_approval: '簽核中',
  approved: '已核准',
  returned: '已退回（待修改）',
};
const ROLE_LABELS: Record<string, string> = {
  department_manager: '申請單位主管',
  budget_owner: '預算負責人',
  general_manager: '總經理',
  chairman: '董事長',
};
const STEP_STATUS_LABELS: Record<string, string> = {
  pending: '待簽核',
  approved: '已核准',
  returned: '已退回',
};

export default async function RequestDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const detail = await getPurchaseRequestDetail(id);
  if (!detail) notFound();

  const supabase = await createSupabaseServerClient();
  const employee = await getCurrentEmployee(supabase);

  const currentStep =
    detail.status === 'pending_approval' && detail.currentStepOrder !== null
      ? detail.steps.find((s) => s.stepOrder === detail.currentStepOrder)
      : undefined;
  const isCurrentApprover =
    !!employee && !!currentStep && currentStep.approverEmployeeId === employee.id;

  return (
    <main className="mx-auto max-w-4xl p-8">
      <h1 className="mb-1 text-2xl font-bold">請購申請單</h1>
      <p className="mb-4 font-mono text-gray-600">{detail.caseNumber}</p>

      <section className="mb-4 rounded border p-4 text-sm">
        <p>申請單位：{detail.departmentName}</p>
        <p>申請人：{detail.applicantName}</p>
        <p>預計需求天數：{detail.neededWithinDays ?? '—'}</p>
        <p>狀態：{STATUS_LABELS[detail.status] ?? detail.status}</p>
        <p>總計：NT$ {detail.totalAmount.toLocaleString()}</p>
      </section>

      <table className="mb-4 w-full border text-sm">
        <thead>
          <tr className="bg-gray-100">
            <th className="border p-2">項次</th>
            <th className="border p-2">預算編號</th>
            <th className="border p-2">項目</th>
            <th className="border p-2">說明</th>
            <th className="border p-2">數量</th>
            <th className="border p-2">預估費用</th>
          </tr>
        </thead>
        <tbody>
          {detail.items.map((i) => (
            <tr key={i.lineNo}>
              <td className="border p-2 text-center">{i.lineNo}</td>
              <td className="border p-2 font-mono">{i.budgetCode}</td>
              <td className="border p-2">{i.itemCategory}</td>
              <td className="border p-2">{i.description}</td>
              <td className="border p-2 text-right">{i.quantity}</td>
              <td className="border p-2 text-right">{i.estimatedAmount.toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <section className="mb-4">
        <h2 className="mb-2 font-semibold">簽核流程</h2>
        <ol className="space-y-1 text-sm">
          {detail.steps.map((s) => (
            <li key={s.stepOrder} className="flex gap-2">
              <span className="text-gray-500">{s.stepOrder}.</span>
              <span>{ROLE_LABELS[s.approverRole] ?? s.approverRole}</span>
              <span>{s.approverName}</span>
              <span
                className={
                  s.status === 'approved'
                    ? 'text-green-600'
                    : s.status === 'returned'
                      ? 'text-red-600'
                      : 'text-gray-500'
                }
              >
                {STEP_STATUS_LABELS[s.status] ?? s.status}
              </span>
              {s.comment && <span className="text-gray-500">— {s.comment}</span>}
            </li>
          ))}
        </ol>
      </section>

      {isCurrentApprover && <ApprovalActions requestId={detail.id} />}
    </main>
  );
}
```

- [ ] **Step 3: Write the approval-actions client component**

`src/app/requests/[id]/approval-actions.tsx`:
```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  approvePurchaseRequestStep,
  returnPurchaseRequestStep,
} from '@/lib/purchase-requests/actions';

export function ApprovalActions({ requestId }: { requestId: string }) {
  const router = useRouter();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onApprove = async () => {
    setBusy(true);
    setError(null);
    const result = await approvePurchaseRequestStep(requestId);
    setBusy(false);
    if (result.ok) router.refresh();
    else setError(result.error);
  };

  const onReturn = async () => {
    if (reason.trim() === '') {
      setError('請填寫退回原因');
      return;
    }
    setBusy(true);
    setError(null);
    const result = await returnPurchaseRequestStep(requestId, reason);
    setBusy(false);
    if (result.ok) router.refresh();
    else setError(result.error);
  };

  return (
    <section className="rounded border border-blue-200 bg-blue-50 p-4">
      <h2 className="mb-2 font-semibold">您是目前的簽核人</h2>
      {error && <p className="mb-2 text-sm text-red-700">{error}</p>}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onApprove}
          disabled={busy}
          className="rounded bg-green-600 px-4 py-2 text-white disabled:opacity-50"
        >
          核准
        </button>
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="退回原因"
          className="flex-1 rounded border px-2 py-1"
        />
        <button
          type="button"
          onClick={onReturn}
          disabled={busy}
          className="rounded bg-red-600 px-4 py-2 text-white disabled:opacity-50"
        >
          退回
        </button>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Verify the build compiles**

Run: `npm run build`
Expected: build succeeds; `/requests` and `/requests/[id]` in the route list.

- [ ] **Step 5: Commit**

```bash
git add src/app/requests/page.tsx src/app/requests/[id]
git commit -m "feat: add requests list and detail page with approval actions"
```

---

## Task 14: `/approvals` queue page

**Files:**
- Create: `src/app/approvals/page.tsx`

**Interfaces:**
- Consumes: `getMyApprovalQueue` (Task 11).
- Produces: `/approvals`.

- [ ] **Step 1: Write the page**

`src/app/approvals/page.tsx`:
```tsx
import Link from 'next/link';
import { getMyApprovalQueue } from '@/lib/purchase-requests/queries';

export default async function ApprovalsPage() {
  const queue = await getMyApprovalQueue();
  return (
    <main className="mx-auto max-w-4xl p-8">
      <h1 className="mb-6 text-2xl font-bold">待我簽核</h1>
      {queue.length === 0 ? (
        <p className="text-gray-500">目前沒有待簽核的請購單。</p>
      ) : (
        <ul className="divide-y rounded border">
          {queue.map((q) => (
            <li key={q.id}>
              <Link href={`/requests/${q.id}`} className="flex justify-between p-4 hover:bg-gray-50">
                <span className="font-mono">{q.caseNumber}</span>
                <span>{q.applicantName}</span>
                <span>NT$ {q.totalAmount.toLocaleString()}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
```

- [ ] **Step 2: Verify the build compiles**

Run: `npm run build`
Expected: build succeeds; `/approvals` in the route list.

- [ ] **Step 3: Commit**

```bash
git add src/app/approvals
git commit -m "feat: add approval queue page"
```

---

## Task 15: `/notifications` page, mark-read action, dashboard navigation

**Files:**
- Create: `src/app/notifications/page.tsx`
- Create: `src/app/notifications/notification-actions.tsx` (client)
- Create: `src/lib/notifications/actions.ts`
- Modify: `src/app/dashboard/page.tsx`

**Interfaces:**
- Consumes: `getMyNotifications`, `getUnreadNotificationCount` (Task 11), `getMyApprovalQueue`.
- Produces: `markNotificationRead(notificationId: string): Promise<void>` in `src/lib/notifications/actions.ts` (uses the user-session client — the notifications UPDATE RLS policy from Task 5 allows a recipient to mark their own read); `/notifications` page; dashboard links to 我的請購單 / 待我簽核 / 通知 with a pending-approval count.

- [ ] **Step 1: Write the mark-read action**

`src/lib/notifications/actions.ts`:
```ts
'use server';

import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getCurrentEmployee } from '@/lib/auth/current-employee';

export async function markNotificationRead(notificationId: string): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const employee = await getCurrentEmployee(supabase);
  if (!employee) return;
  await supabase
    .from('notifications')
    .update({ is_read: true })
    .eq('id', notificationId)
    .eq('recipient_employee_id', employee.id);
  revalidatePath('/notifications');
}
```

- [ ] **Step 2: Write the notifications page**

`src/app/notifications/page.tsx`:
```tsx
import Link from 'next/link';
import { getMyNotifications } from '@/lib/notifications/queries';
import { MarkReadButton } from './notification-actions';

export default async function NotificationsPage() {
  const notifications = await getMyNotifications();
  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="mb-6 text-2xl font-bold">通知</h1>
      {notifications.length === 0 ? (
        <p className="text-gray-500">目前沒有通知。</p>
      ) : (
        <ul className="divide-y rounded border">
          {notifications.map((n) => (
            <li key={n.id} className={`flex items-center justify-between p-4 ${n.isRead ? '' : 'bg-blue-50'}`}>
              <Link href={`/requests/${n.formId}`} className="flex-1 hover:underline">
                <span className="font-mono text-sm text-gray-500">{n.caseNumber}</span>
                <span className="ml-2">{n.message}</span>
              </Link>
              {!n.isRead && <MarkReadButton notificationId={n.id} />}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
```

- [ ] **Step 3: Write the mark-read client button**

`src/app/notifications/notification-actions.tsx`:
```tsx
'use client';

import { useRouter } from 'next/navigation';
import { markNotificationRead } from '@/lib/notifications/actions';

export function MarkReadButton({ notificationId }: { notificationId: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={async () => {
        await markNotificationRead(notificationId);
        router.refresh();
      }}
      className="ml-2 rounded border px-2 py-1 text-xs"
    >
      標示為已讀
    </button>
  );
}
```

- [ ] **Step 4: Update the dashboard with navigation and a pending count**

Replace `src/app/dashboard/page.tsx` with:
```tsx
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { getMyApprovalQueue } from '@/lib/purchase-requests/queries';
import { getUnreadNotificationCount } from '@/lib/notifications/queries';

export default async function DashboardPage() {
  const supabase = await createSupabaseServerClient();
  const employee = await getCurrentEmployee(supabase);

  if (!employee) {
    redirect('/login?error=not_registered');
  }

  const [queue, unread] = await Promise.all([
    getMyApprovalQueue(),
    getUnreadNotificationCount(),
  ]);

  return (
    <main className="p-8">
      <h1 className="text-2xl font-bold">歡迎，{employee.name}</h1>
      <p className="mt-2 text-gray-600">
        工號：{employee.employeeCode}｜角色：{employee.role}
      </p>

      <nav className="mt-6 flex flex-col gap-2">
        <Link href="/requests/new" className="text-blue-600 underline">
          新增請購單
        </Link>
        <Link href="/requests" className="text-blue-600 underline">
          我的請購單
        </Link>
        <Link href="/approvals" className="text-blue-600 underline">
          待我簽核（{queue.length}）
        </Link>
        <Link href="/notifications" className="text-blue-600 underline">
          通知（未讀 {unread}）
        </Link>
        {employee.role === 'admin' && (
          <Link href="/admin/master-data" className="text-blue-600 underline">
            主檔資料總覽
          </Link>
        )}
      </nav>
    </main>
  );
}
```

- [ ] **Step 5: Verify the build compiles**

Run: `npm run build`
Expected: build succeeds; `/notifications` in the route list.

- [ ] **Step 6: Commit**

```bash
git add src/app/notifications src/lib/notifications/actions.ts src/app/dashboard/page.tsx
git commit -m "feat: add notifications page, mark-read action, dashboard navigation"
```

---

## Task 16: Final verification pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full automated test suite**

Run: `export $(grep -v '^#' .env.local | xargs) && npm test`
Expected: all pass — Foundation's 30 plus this plan's unit tests (service-role, chain, validate) and integration tests (schemas, RLS, create, approve/return, resubmit, queries). Confirm none of the integration suites are silently skipped (they run because `.env.local` is exported).

- [ ] **Step 2: Run a production build**

Run: `npm run build`
Expected: succeeds with no type errors; routes `/requests`, `/requests/new`, `/requests/[id]`, `/approvals`, `/notifications` all present.

- [ ] **Step 3: Walk the manual browser QA checklist**

Start the dev server (`.claude/launch.json`'s `nextjs-dev` config), log in as a real seeded employee (the one whose `google_email` is set), then:
1. `/requests/new` — add two line items sharing one budget owner, submit → redirected to the new `/requests/[id]`, status 簽核中, case number shown.
2. Try adding two line items with different budget owners → submit shows the single-owner error.
3. Log in as the first approver (or set your own employee row as the dept manager for testing) → `/approvals` lists the request → open it → 核准 → step marks 已核准, advances or finalizes.
4. On another request, 退回 with a reason → status 已退回（待修改）, applicant gets a notification.
5. `/notifications` — unread notification shows highlighted; 標示為已讀 clears it; dashboard 未讀 count drops.

- [ ] **Step 4: Confirm no secrets are tracked and service-role stays server-side**

Run: `git status` — `.env.local` not tracked.
Run: `grep -rn "SUPABASE_SERVICE_ROLE_KEY" src/` — appears only in `src/lib/supabase/service-role.ts` (no `'use client'` module references it).
Run: `grep -rln "use client" src/ | xargs grep -l "service-role" || echo "clean: no client module imports the service-role client"`
Expected: prints the "clean" message.

This concludes the Purchase Request + Approval Engine plan. Plan 3 ("採購單／驗收單／費用申請單 + 附件篇") reuses the polymorphic `approval_steps`/`notifications` tables, the `generateApprovalChain` logic, and the case-number/RLS patterns established here to add the remaining three forms, their sequential unlock (請購核准 → 採購 → 驗收 → 費用申請), the pre-payment exception path, attachment upload, and payment-batch-date computation.
