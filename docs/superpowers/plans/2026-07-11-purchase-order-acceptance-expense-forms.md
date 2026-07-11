# 採購單／驗收單／費用申請單 + 附件與 Email 通知篇 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The three remaining forms — 採購單 (`purchase_orders`)、驗收單 (`acceptances`)、費用申請單 (`expense_requests`) — can each be created, driven through their own full approval chain, returned/resubmitted, and viewed, sequentially unlocked from an approved 請購單 (with the 預付款 exception that skips 驗收單). Every form supports multi-file attachments previewable in-browser, and every approval-queue/return/final-approval notification also sends an email via the company's Google Workspace SMTP relay.

**Architecture:** Extends the Foundation + 請購單/簽核引擎 branches already on `main`. Reuses `procurement_cases`, the polymorphic `approval_steps`/`notifications` tables, `generateApprovalChain()`, `createSupabaseServiceRoleClient()`, and the RLS pattern (reads participant-scoped, all engine writes via service-role server actions with in-code authorization). Adds three new form table pairs (header + items, one row per `procurement_case_id` — resubmit updates in place, matching how `purchase_requests` already works), a polymorphic `attachments` table backed by a private Supabase Storage bucket accessed exclusively through service-role signed URLs, a `buildApprovalChainForForm()` helper that factors out the department-manager/budget-owner/general-manager/chairman lookup+chain-build sequence duplicated across all four forms' create/resubmit actions, a `notifyAndEmail()` helper that pairs every `notifications` insert with a best-effort SMTP email, and four pure business-rule functions (設備/材料 classification, 報價單家數門檻, 付款條件一致性提示, 財會撥款批次日計算).

Each new form's items are **copied from the prior form's approved items** at creation time (採購單項次抄自對應請購單項次、驗收單項次抄自對應採購單項次、費用申請單項次抄自對應採購單或驗收單項次), so `department_id`/`budget_owner_employee_id` are inherited from the originating `purchase_request` rather than re-derived — this is why validation in the three new forms is much thinner than `purchase_requests`' (which had to derive the budget owner from user-chosen budget codes).

**Tech Stack:** Same as the previous two plans — Next.js 15 (App Router, Server Actions), React 19, TypeScript 5 (strict), Tailwind CSS 3, Supabase (Postgres + RLS + Storage), Vitest, Supabase CLI for migrations. New dependency: `nodemailer` (SMTP client) for email.

## Global Constraints

- Node.js >= 20, npm as the package manager. `npm test` carries `NODE_OPTIONS=--experimental-websocket`; do not remove it.
- TypeScript `strict: true`; no `any` in new code.
- All user-facing copy is Traditional Chinese, matching source-form terminology (採購單、驗收單、費用申請單、付款方式、付款條件、驗收日期、Pass/Fail、財產編號、期望付款日、預計撥款批次日).
- No code comments except where a non-obvious business rule needs explaining.
- Secrets only ever live in `.env.local` / CI secrets, never committed. `SUPABASE_SERVICE_ROLE_KEY` and the new `SMTP_*` vars are server-only — never referenced from a `'use client'` module or a `NEXT_PUBLIC_*` var.
- Every new table's row-level security is default-deny; access is granted explicitly per policy. All writes to the four form tables + `attachments` go through server actions using the service-role client — there are deliberately NO insert/update/delete RLS policies on any of them (the Storage bucket gets zero `storage.objects` policies too, for the same reason: only the service-role key, used inside vetted server actions, can read/write file bytes).
- Case-number / item-code convention: this plan does **not** add a new numbering table. Because every form is unique per `procurement_case_id` in the first release (`unique (procurement_case_id)` on each new header table; a return+resubmit updates the same row rather than creating a new one), each form's on-screen 項次代號 is a fixed constant derived from its type, not a stored counter: 請購單 = `A1`、採購單 = `B1`、驗收單 = `C1`、費用申請單 = `D1`.
- 加簽門檻 applies per form exactly as in the previous plan: **this form's own `total_amount`** (not any case-level running total) **> NT$100,000** adds 董事長 as a final approval step; exactly 100,000 does not.
- Sequential unlock: 採購單 requires an `approved` `purchase_requests` row in the same case with no existing `purchase_orders` row yet. 驗收單 requires an `approved` `purchase_orders` row in the same case with no existing `acceptances` row yet. 費用申請單 requires an `approved` `purchase_orders` row in the same case, **and** either an `approved` `acceptances` row for that purchase order **or** `purchase_orders.payment_terms = '預付款'` (the 例外路徑 that skips 驗收單).
- Business-day helpers (used only for the 財會撥款週期 UI hint) treat Saturday/Sunday as non-business days and do **not** account for Taiwan public holidays — this is a known, documented simplification for the first release, not a bug.
- Environment for integration tests: export `.env.local` into the shell first — `export $(grep -v '^#' .env.local | xargs)` — so `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` are set; otherwise the integration suites skip. Migrations apply to the linked hosted project via `supabase db push` (already linked — no re-link needed).
- Email is sent via `nodemailer` against the company's **Google Workspace SMTP relay** — new required env vars `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`. These are **not** present in the existing `.env.local`; a human with Google Workspace admin access must provision an SMTP relay service / app password and add the values before real email can be sent. Every integration test that exercises a code path calling `sendEmail` mocks `@/lib/email/send` (or the underlying `nodemailer` transport) — none of them require real SMTP credentials, so this plan is fully executable before those credentials exist. Every call site wraps `sendEmail` in try/catch so an SMTP failure never blocks or rolls back the underlying approval-engine write (mirrors how notifications already can't fail the write path).
- File uploads: a private Supabase Storage bucket named `attachments` (created via SQL migration, `public = false`, zero `storage.objects` policies). All upload/download traffic goes through server actions using the service-role client; authorization is enforced in code by first re-checking the caller can read the parent form via the normal RLS-scoped read (same participant rule as the form itself). Accepted types for the first release: PDF, PNG, JPEG; max size 10 MB — enforced client-side (UI hint) and server-side (a pure validation function) but not by a Storage-level policy.

## Existing interfaces this plan consumes (from the Foundation + 請購單/簽核引擎 branches)

- Tables: `departments(id, code, name, manager_employee_id)`, `employees(id, employee_code, name, department_id, title, google_email, role, is_general_manager, is_chairman)`, `budget_codes(id, code, department_id, category, owner_employee_id, fiscal_year, annual_budget_amount)`, `suppliers(id, name, short_name, tax_id, country, phone, contact_name, email, bank_name, bank_branch, bank_account, account_name, currency, …)`.
- `procurement_cases(id, case_number, created_by_employee_id, created_at)` + SQL function `next_case_number()`.
- `purchase_requests(id, procurement_case_id, applicant_employee_id, department_id, budget_owner_employee_id, request_date, needed_within_days, total_amount, status, current_step_order, created_at, updated_at)`, `purchase_request_items(id, purchase_request_id, line_no, budget_code_id, item_category, description, quantity, estimated_amount)`.
- `approval_steps(id, form_type, form_id, step_order, approver_employee_id, approver_role, status, comment, acted_at, created_at)` — polymorphic, `form_type in ('purchase_request','purchase_order','acceptance','expense_request')` already, `approver_role in ('department_manager','budget_owner','general_manager','chairman')`, `status in ('pending','approved','returned')`, `unique (form_type, form_id, step_order)`.
- `notifications(id, recipient_employee_id, type, form_type, form_id, case_number, message, is_read, created_at)`, `type in ('approval_requested','request_returned','request_approved')`.
- SQL functions: `is_admin()`, `is_finance()`, `current_employee_id()` (all SECURITY DEFINER, `search_path` pinned), `is_approver_of_request(p_request_id uuid)` (purchase-request-specific — this plan generalizes the concept with a new `is_participant_of_form(p_form_type text, p_form_id uuid)` function rather than extending this one, to avoid a Postgres RLS-recursion trap across five polymorphic tables).
- `createSupabaseServiceRoleClient(): SupabaseClient` from `src/lib/supabase/service-role.ts`.
- `getCurrentEmployee(supabase): Promise<CurrentEmployee | null>` from `src/lib/auth/current-employee.ts`, where `CurrentEmployee = { id, employeeCode, name, departmentId, role: 'staff'|'finance'|'admin', isGeneralManager, isChairman }`.
- `createSupabaseServerClient()` (async, user-session, RLS-enforced) from `src/lib/supabase/server.ts`.
- `generateApprovalChain(input: ApprovalChainInput): ApprovalChainStep[]` and `CHAIRMAN_THRESHOLD = 100000` from `src/lib/approval/chain.ts`.
- `validatePurchaseRequestInput` pattern (`src/lib/purchase-requests/validate.ts`) — new forms follow the same `{ ok: true } | { ok: false; error: string }` `ValidationResult` shape.
- `src/lib/purchase-requests/actions.ts` exports `createPurchaseRequest`, `approvePurchaseRequestStep`, `returnPurchaseRequestStep`, `resubmitPurchaseRequest` — Task 10 and Task 12 of this plan refactor this file in place (extracting shared chain-building and notify+email logic) and must keep its existing exported function signatures unchanged so `src/app/requests/**` keeps compiling.
- Seed data present in the linked project: 8 departments, 39 employees, 185 department-scoped budget codes, 4 suppliers. 沈大維 has `is_general_manager = true`; 陳維隆 has `is_chairman = true`.
- Pages: `/requests`, `/requests/new`, `/requests/[id]`, `/approvals`, `/notifications`, `/dashboard`, `/admin/master-data`. `src/middleware.ts` protects all non-public paths automatically — new routes under `/purchase-orders`, `/acceptances`, `/expense-requests`, `/cases` need no middleware changes.

## File Structure

**Migrations (apply in timestamp order after the six already on `main`):**
- `supabase/migrations/<ts>_purchase_orders.sql` — `purchase_orders`, `purchase_order_items`
- `supabase/migrations/<ts>_acceptances.sql` — `acceptances`, `acceptance_items`
- `supabase/migrations/<ts>_expense_requests.sql` — `expense_requests`, `expense_request_items`
- `supabase/migrations/<ts>_attachments.sql` — `attachments`, Storage bucket `attachments`
- `supabase/migrations/<ts>_new_forms_rls.sql` — `is_participant_of_form()`, RLS policies for all four new tables + their item tables + `attachments`
- `supabase/migrations/<ts>_resubmit_purchase_order_tx.sql`, `<ts>_resubmit_acceptance_tx.sql`, `<ts>_resubmit_expense_request_tx.sql` — one transactional resubmit function per form (Tasks 17, 21, 25)

**Lib (one responsibility per file):**
- `src/lib/procurement/item-category.ts` + `.test.ts` — `classifyItemCategory()`
- `src/lib/procurement/quote-requirement.ts` + `.test.ts` — `requiredQuoteCount()`, `validateQuoteCount()`
- `src/lib/procurement/payment-terms.ts` + `.test.ts` — `checkPaymentTermsConsistency()`
- `src/lib/procurement/payment-batch.ts` + `.test.ts` — `computePaymentBatchDate()`
- `src/lib/approval/build-chain.ts` + `.test.ts` — `buildApprovalChainForForm()`
- `src/lib/email/send.ts` + `.test.ts` — `sendEmail()`
- `src/lib/notifications/notify.ts` + `.test.ts` — `notifyAndEmail()`
- `src/lib/attachments/storage.ts`, `src/lib/attachments/validate.ts` + `.test.ts`, `src/lib/attachments/actions.ts`, `src/lib/attachments/queries.ts`
- `src/lib/purchase-orders/validate.ts` + `.test.ts`, `src/lib/purchase-orders/actions.ts`, `src/lib/purchase-orders/queries.ts`
- `src/lib/acceptances/validate.ts` + `.test.ts`, `src/lib/acceptances/actions.ts`, `src/lib/acceptances/queries.ts`
- `src/lib/expense-requests/validate.ts` + `.test.ts`, `src/lib/expense-requests/actions.ts`, `src/lib/expense-requests/queries.ts`
- `src/lib/cases/queries.ts` — `getCaseOverview()`

**Integration tests (`tests/integration/`):**
- `purchase-orders-schema.test.ts`, `acceptances-schema.test.ts`, `expense-requests-schema.test.ts`, `attachments-schema.test.ts`
- `new-forms-rls.test.ts`
- `purchase-order-create.test.ts`, `purchase-order-approve-return.test.ts`, `purchase-order-resubmit.test.ts`, `purchase-order-queries.test.ts`
- `acceptance-create.test.ts`, `acceptance-approve-return.test.ts`, `acceptance-resubmit.test.ts`, `acceptance-queries.test.ts`
- `expense-request-create.test.ts`, `expense-request-approve-return.test.ts`, `expense-request-resubmit.test.ts`, `expense-request-queries.test.ts`
- `attachments-actions.test.ts`
- `case-overview-queries.test.ts`

**Pages / components:**
- `src/app/components/attachments-panel.tsx` (client) — reused by all four form detail pages
- `src/app/purchase-orders/page.tsx`, `src/app/purchase-orders/new/page.tsx` + `purchase-order-form.tsx` (client), `src/app/purchase-orders/[id]/page.tsx` + `approval-actions.tsx` (client)
- `src/app/acceptances/page.tsx`, `src/app/acceptances/new/page.tsx` + `acceptance-form.tsx` (client), `src/app/acceptances/[id]/page.tsx` + `approval-actions.tsx` (client) + `property-tag-form.tsx` (client, finance-only)
- `src/app/expense-requests/page.tsx`, `src/app/expense-requests/new/page.tsx` + `expense-request-form.tsx` (client), `src/app/expense-requests/[id]/page.tsx` + `approval-actions.tsx` (client)
- `src/app/cases/[caseNumber]/page.tsx` — case overview linking all four forms
- Modified: `src/app/approvals/page.tsx`, `src/app/notifications/page.tsx`, `src/app/dashboard/page.tsx`, `src/lib/notifications/queries.ts`, `src/lib/purchase-requests/queries.ts`, `src/lib/purchase-requests/actions.ts`

---

## Task 1: Migration — `purchase_orders` + `purchase_order_items`

**Files:**
- Create: `supabase/migrations/<timestamp>_purchase_orders.sql`
- Test: `tests/integration/purchase-orders-schema.test.ts`

**Interfaces:**
- Consumes: `procurement_cases(id)`, `purchase_requests(id)`, `employees(id)`, `departments(id)`, `suppliers(id)`, `budget_codes(id)`.
- Produces: `purchase_orders(id, procurement_case_id, purchase_request_id, applicant_employee_id, department_id, budget_owner_employee_id, supplier_id, payment_method, payment_terms, expected_delivery_days, quote_count, quote_count_reason, total_amount, status, current_step_order, created_at, updated_at)` where `status in ('pending_approval','approved','returned')`, `payment_terms in ('預付款','貨到付款','月結30天','月結45天','月結60天','其他')`, `unique (procurement_case_id)`; `purchase_order_items(id, purchase_order_id, line_no, budget_code_id, item_category, description, quantity, unit_price, total_price, created_at)`.

- [ ] **Step 1: Write the failing integration test**

`tests/integration/purchase-orders-schema.test.ts`:
```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createServiceRoleTestClient,
  hasIntegrationTestCredentials,
} from './supabase-test-client';

describe.skipIf(!hasIntegrationTestCredentials())('purchase_orders + items schema', () => {
  let supabase: ReturnType<typeof createServiceRoleTestClient>;
  let caseId: string;
  let requestId: string;
  let employeeId: string;
  let departmentId: string;
  let budgetCodeId: string;
  let supplierId: string;
  let orderId: string;

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
    const { data: sup } = await supabase.from('suppliers').select('id').limit(1).single();
    supplierId = sup!.id;
    const { data: caseNumber } = await supabase.rpc('next_case_number');
    const { data: pcase } = await supabase
      .from('procurement_cases')
      .insert({ case_number: caseNumber, created_by_employee_id: employeeId })
      .select()
      .single();
    caseId = pcase!.id;
    const { data: pr } = await supabase
      .from('purchase_requests')
      .insert({
        procurement_case_id: caseId,
        applicant_employee_id: employeeId,
        department_id: departmentId,
        budget_owner_employee_id: employeeId,
        status: 'approved',
      })
      .select()
      .single();
    requestId = pr!.id;
  });

  afterAll(async () => {
    if (orderId) await supabase.from('purchase_orders').delete().eq('id', orderId);
    if (requestId) await supabase.from('purchase_requests').delete().eq('id', requestId);
    if (caseId) await supabase.from('procurement_cases').delete().eq('id', caseId);
  });

  it('inserts a purchase order with default status pending_approval', async () => {
    const { data, error } = await supabase
      .from('purchase_orders')
      .insert({
        procurement_case_id: caseId,
        purchase_request_id: requestId,
        applicant_employee_id: employeeId,
        department_id: departmentId,
        budget_owner_employee_id: employeeId,
        supplier_id: supplierId,
        payment_method: '匯款',
        payment_terms: '月結30天',
        total_amount: 65000,
        current_step_order: 1,
      })
      .select()
      .single();
    expect(error).toBeNull();
    expect(data!.status).toBe('pending_approval');
    orderId = data!.id;
  });

  it('rejects a second purchase order for the same case', async () => {
    const { error } = await supabase.from('purchase_orders').insert({
      procurement_case_id: caseId,
      purchase_request_id: requestId,
      applicant_employee_id: employeeId,
      department_id: departmentId,
      budget_owner_employee_id: employeeId,
      supplier_id: supplierId,
      payment_method: '匯款',
      payment_terms: '月結30天',
    });
    expect(error).not.toBeNull();
  });

  it('rejects an invalid payment_terms value', async () => {
    const { data: caseNumber } = await supabase.rpc('next_case_number');
    const { data: pcase2 } = await supabase
      .from('procurement_cases')
      .insert({ case_number: caseNumber, created_by_employee_id: employeeId })
      .select()
      .single();
    const { error } = await supabase.from('purchase_orders').insert({
      procurement_case_id: pcase2!.id,
      purchase_request_id: requestId,
      applicant_employee_id: employeeId,
      department_id: departmentId,
      budget_owner_employee_id: employeeId,
      supplier_id: supplierId,
      payment_method: '匯款',
      payment_terms: '不是合法值',
    });
    expect(error).not.toBeNull();
    await supabase.from('procurement_cases').delete().eq('id', pcase2!.id);
  });

  it('inserts a line item and rejects unit_price <= 0', async () => {
    const { data, error } = await supabase
      .from('purchase_order_items')
      .insert({
        purchase_order_id: orderId,
        line_no: 1,
        budget_code_id: budgetCodeId,
        item_category: '材料',
        description: '材料A',
        quantity: 2,
        unit_price: 32500,
        total_price: 65000,
      })
      .select()
      .single();
    expect(error).toBeNull();
    expect(data!.description).toBe('材料A');

    const { error: badPrice } = await supabase.from('purchase_order_items').insert({
      purchase_order_id: orderId,
      line_no: 2,
      budget_code_id: budgetCodeId,
      item_category: '材料',
      description: '壞單價',
      quantity: 1,
      unit_price: 0,
      total_price: 0,
    });
    expect(badPrice).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `export $(grep -v '^#' .env.local | xargs) && npm test -- tests/integration/purchase-orders-schema.test.ts`
Expected: FAIL — `relation "purchase_orders" does not exist`.

- [ ] **Step 3: Create and write the migration**

Run: `supabase migration new purchase_orders`. Write:
```sql
create table purchase_orders (
  id uuid primary key default gen_random_uuid(),
  procurement_case_id uuid not null references procurement_cases(id),
  purchase_request_id uuid not null references purchase_requests(id),
  applicant_employee_id uuid not null references employees(id),
  department_id uuid not null references departments(id),
  budget_owner_employee_id uuid not null references employees(id),
  supplier_id uuid not null references suppliers(id),
  payment_method text not null,
  payment_terms text not null
    check (payment_terms in ('預付款', '貨到付款', '月結30天', '月結45天', '月結60天', '其他')),
  expected_delivery_days integer,
  quote_count integer not null default 1 check (quote_count >= 0),
  quote_count_reason text,
  total_amount numeric(14, 2) not null default 0,
  status text not null default 'pending_approval'
    check (status in ('pending_approval', 'approved', 'returned')),
  current_step_order integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (procurement_case_id)
);

create index on purchase_orders (applicant_employee_id);
create index on purchase_orders (status);

create table purchase_order_items (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references purchase_orders(id) on delete cascade,
  line_no integer not null,
  budget_code_id uuid not null references budget_codes(id),
  item_category text not null,
  description text not null,
  quantity integer not null check (quantity > 0),
  unit_price numeric(14, 2) not null check (unit_price > 0),
  total_price numeric(14, 2) not null check (total_price > 0),
  created_at timestamptz not null default now(),
  unique (purchase_order_id, line_no)
);
```

- [ ] **Step 4: Apply the migration**

Run: `export $(grep -v '^#' .env.local | xargs) && supabase db push`

- [ ] **Step 5: Run the test to verify it passes**

Run: `export $(grep -v '^#' .env.local | xargs) && npm test -- tests/integration/purchase-orders-schema.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations tests/integration/purchase-orders-schema.test.ts
git commit -m "feat: add purchase_orders and purchase_order_items tables"
```

---

## Task 2: Migration — `acceptances` + `acceptance_items`

**Files:**
- Create: `supabase/migrations/<timestamp>_acceptances.sql`
- Test: `tests/integration/acceptances-schema.test.ts`

**Interfaces:**
- Consumes: `procurement_cases(id)`, `purchase_orders(id)`, `purchase_order_items(id)`, `employees(id)`, `departments(id)`, `suppliers(id)`.
- Produces: `acceptances(id, procurement_case_id, purchase_order_id, applicant_employee_id, department_id, budget_owner_employee_id, contractor_supplier_id, acceptance_date, total_amount, status, current_step_order, created_at, updated_at)`, `status in ('pending_approval','approved','returned')`, `unique (procurement_case_id)`; `acceptance_items(id, acceptance_id, line_no, purchase_order_item_id, description, quantity, amount, pass_fail, property_tag, created_at)`, `pass_fail in ('pass','fail')` default `'pass'`.

- [ ] **Step 1: Write the failing integration test**

`tests/integration/acceptances-schema.test.ts`:
```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createServiceRoleTestClient,
  hasIntegrationTestCredentials,
} from './supabase-test-client';

describe.skipIf(!hasIntegrationTestCredentials())('acceptances + items schema', () => {
  let supabase: ReturnType<typeof createServiceRoleTestClient>;
  let caseId: string;
  let orderId: string;
  let orderItemId: string;
  let employeeId: string;
  let departmentId: string;
  let supplierId: string;
  let acceptanceId: string;

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
    const { data: sup } = await supabase.from('suppliers').select('id').limit(1).single();
    supplierId = sup!.id;
    const { data: caseNumber } = await supabase.rpc('next_case_number');
    const { data: pcase } = await supabase
      .from('procurement_cases')
      .insert({ case_number: caseNumber, created_by_employee_id: employeeId })
      .select()
      .single();
    caseId = pcase!.id;
    const { data: po } = await supabase
      .from('purchase_orders')
      .insert({
        procurement_case_id: caseId,
        purchase_request_id: null,
        applicant_employee_id: employeeId,
        department_id: departmentId,
        budget_owner_employee_id: employeeId,
        supplier_id: supplierId,
        payment_method: '匯款',
        payment_terms: '貨到付款',
        status: 'approved',
      })
      .select()
      .single();
    orderId = po!.id;
    const { data: item } = await supabase
      .from('purchase_order_items')
      .insert({
        purchase_order_id: orderId,
        line_no: 1,
        budget_code_id: bc!.id,
        item_category: '材料',
        description: '材料A',
        quantity: 1,
        unit_price: 65000,
        total_price: 65000,
      })
      .select()
      .single();
    orderItemId = item!.id;
  });

  afterAll(async () => {
    if (acceptanceId) await supabase.from('acceptances').delete().eq('id', acceptanceId);
    if (orderId) await supabase.from('purchase_orders').delete().eq('id', orderId);
    if (caseId) await supabase.from('procurement_cases').delete().eq('id', caseId);
  });

  it('inserts an acceptance with default status pending_approval', async () => {
    const { data, error } = await supabase
      .from('acceptances')
      .insert({
        procurement_case_id: caseId,
        purchase_order_id: orderId,
        applicant_employee_id: employeeId,
        department_id: departmentId,
        budget_owner_employee_id: employeeId,
        contractor_supplier_id: supplierId,
        total_amount: 65000,
        current_step_order: 1,
      })
      .select()
      .single();
    expect(error).toBeNull();
    expect(data!.status).toBe('pending_approval');
    acceptanceId = data!.id;
  });

  it('rejects a second acceptance for the same case', async () => {
    const { error } = await supabase.from('acceptances').insert({
      procurement_case_id: caseId,
      purchase_order_id: orderId,
      applicant_employee_id: employeeId,
      department_id: departmentId,
      budget_owner_employee_id: employeeId,
      contractor_supplier_id: supplierId,
    });
    expect(error).not.toBeNull();
  });

  it('inserts an item defaulting pass_fail to pass and rejects an invalid pass_fail', async () => {
    const { data, error } = await supabase
      .from('acceptance_items')
      .insert({
        acceptance_id: acceptanceId,
        line_no: 1,
        purchase_order_item_id: orderItemId,
        description: '材料A',
        quantity: 1,
        amount: 65000,
      })
      .select()
      .single();
    expect(error).toBeNull();
    expect(data!.pass_fail).toBe('pass');

    const { error: badPassFail } = await supabase.from('acceptance_items').insert({
      acceptance_id: acceptanceId,
      line_no: 2,
      purchase_order_item_id: orderItemId,
      description: '壞值',
      quantity: 1,
      amount: 1,
      pass_fail: 'maybe',
    });
    expect(badPassFail).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `export $(grep -v '^#' .env.local | xargs) && npm test -- tests/integration/acceptances-schema.test.ts`
Expected: FAIL — `relation "acceptances" does not exist`.

- [ ] **Step 3: Create and write the migration**

Run: `supabase migration new acceptances`. Write:
```sql
create table acceptances (
  id uuid primary key default gen_random_uuid(),
  procurement_case_id uuid not null references procurement_cases(id),
  purchase_order_id uuid not null references purchase_orders(id),
  applicant_employee_id uuid not null references employees(id),
  department_id uuid not null references departments(id),
  budget_owner_employee_id uuid not null references employees(id),
  contractor_supplier_id uuid not null references suppliers(id),
  acceptance_date date not null default current_date,
  total_amount numeric(14, 2) not null default 0,
  status text not null default 'pending_approval'
    check (status in ('pending_approval', 'approved', 'returned')),
  current_step_order integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (procurement_case_id)
);

create index on acceptances (applicant_employee_id);
create index on acceptances (status);

create table acceptance_items (
  id uuid primary key default gen_random_uuid(),
  acceptance_id uuid not null references acceptances(id) on delete cascade,
  line_no integer not null,
  purchase_order_item_id uuid not null references purchase_order_items(id),
  description text not null,
  quantity integer not null check (quantity > 0),
  amount numeric(14, 2) not null check (amount > 0),
  pass_fail text not null default 'pass' check (pass_fail in ('pass', 'fail')),
  property_tag text,
  created_at timestamptz not null default now(),
  unique (acceptance_id, line_no)
);
```

- [ ] **Step 4: Apply the migration**

Run: `export $(grep -v '^#' .env.local | xargs) && supabase db push`

- [ ] **Step 5: Run the test to verify it passes**

Run: `export $(grep -v '^#' .env.local | xargs) && npm test -- tests/integration/acceptances-schema.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations tests/integration/acceptances-schema.test.ts
git commit -m "feat: add acceptances and acceptance_items tables"
```

---

## Task 3: Migration — `expense_requests` + `expense_request_items`

**Files:**
- Create: `supabase/migrations/<timestamp>_expense_requests.sql`
- Test: `tests/integration/expense-requests-schema.test.ts`

**Interfaces:**
- Consumes: `procurement_cases(id)`, `purchase_orders(id)`, `acceptances(id)`, `purchase_order_items(id)`, `employees(id)`, `departments(id)`, `suppliers(id)`.
- Produces: `expense_requests(id, procurement_case_id, purchase_order_id, acceptance_id, applicant_employee_id, department_id, budget_owner_employee_id, payee_type, payee_supplier_id, payment_method, bank_name, bank_account, account_name, invoice_month, expected_payment_date, payment_batch_date, total_amount, status, current_step_order, created_at, updated_at)`, `status in ('pending_approval','approved','returned')`, `payee_type in ('employee','supplier')`, `acceptance_id` nullable (null = 預付款例外路徑), `check ((payee_type = 'supplier') = (payee_supplier_id is not null))`, `unique (procurement_case_id)`; `expense_request_items(id, expense_request_id, line_no, purchase_order_item_id, description, amount, created_at)`.

- [ ] **Step 1: Write the failing integration test**

`tests/integration/expense-requests-schema.test.ts`:
```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createServiceRoleTestClient,
  hasIntegrationTestCredentials,
} from './supabase-test-client';

describe.skipIf(!hasIntegrationTestCredentials())('expense_requests + items schema', () => {
  let supabase: ReturnType<typeof createServiceRoleTestClient>;
  let caseId: string;
  let orderId: string;
  let orderItemId: string;
  let employeeId: string;
  let departmentId: string;
  let supplierId: string;
  let expenseId: string;

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
    const { data: sup } = await supabase.from('suppliers').select('id').limit(1).single();
    supplierId = sup!.id;
    const { data: caseNumber } = await supabase.rpc('next_case_number');
    const { data: pcase } = await supabase
      .from('procurement_cases')
      .insert({ case_number: caseNumber, created_by_employee_id: employeeId })
      .select()
      .single();
    caseId = pcase!.id;
    const { data: po } = await supabase
      .from('purchase_orders')
      .insert({
        procurement_case_id: caseId,
        purchase_request_id: null,
        applicant_employee_id: employeeId,
        department_id: departmentId,
        budget_owner_employee_id: employeeId,
        supplier_id: supplierId,
        payment_method: '匯款',
        payment_terms: '預付款',
        status: 'approved',
      })
      .select()
      .single();
    orderId = po!.id;
    const { data: item } = await supabase
      .from('purchase_order_items')
      .insert({
        purchase_order_id: orderId,
        line_no: 1,
        budget_code_id: bc!.id,
        item_category: '材料',
        description: '材料A',
        quantity: 1,
        unit_price: 65000,
        total_price: 65000,
      })
      .select()
      .single();
    orderItemId = item!.id;
  });

  afterAll(async () => {
    if (expenseId) await supabase.from('expense_requests').delete().eq('id', expenseId);
    if (orderId) await supabase.from('purchase_orders').delete().eq('id', orderId);
    if (caseId) await supabase.from('procurement_cases').delete().eq('id', caseId);
  });

  it('inserts a prepayment-path expense request with a null acceptance_id', async () => {
    const { data, error } = await supabase
      .from('expense_requests')
      .insert({
        procurement_case_id: caseId,
        purchase_order_id: orderId,
        acceptance_id: null,
        applicant_employee_id: employeeId,
        department_id: departmentId,
        budget_owner_employee_id: employeeId,
        payee_type: 'supplier',
        payee_supplier_id: supplierId,
        payment_method: '匯款',
        total_amount: 65000,
        current_step_order: 1,
      })
      .select()
      .single();
    expect(error).toBeNull();
    expect(data!.status).toBe('pending_approval');
    expenseId = data!.id;
  });

  it('rejects payee_type supplier without payee_supplier_id', async () => {
    const { data: caseNumber } = await supabase.rpc('next_case_number');
    const { data: pcase2 } = await supabase
      .from('procurement_cases')
      .insert({ case_number: caseNumber, created_by_employee_id: employeeId })
      .select()
      .single();
    const { error } = await supabase.from('expense_requests').insert({
      procurement_case_id: pcase2!.id,
      purchase_order_id: orderId,
      applicant_employee_id: employeeId,
      department_id: departmentId,
      budget_owner_employee_id: employeeId,
      payee_type: 'supplier',
      payee_supplier_id: null,
      payment_method: '匯款',
    });
    expect(error).not.toBeNull();
    await supabase.from('procurement_cases').delete().eq('id', pcase2!.id);
  });

  it('inserts a line item and rejects amount <= 0', async () => {
    const { data, error } = await supabase
      .from('expense_request_items')
      .insert({
        expense_request_id: expenseId,
        line_no: 1,
        purchase_order_item_id: orderItemId,
        description: '材料A',
        amount: 65000,
      })
      .select()
      .single();
    expect(error).toBeNull();
    expect(data!.description).toBe('材料A');

    const { error: badAmount } = await supabase.from('expense_request_items').insert({
      expense_request_id: expenseId,
      line_no: 2,
      purchase_order_item_id: orderItemId,
      description: '壞金額',
      amount: 0,
    });
    expect(badAmount).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `export $(grep -v '^#' .env.local | xargs) && npm test -- tests/integration/expense-requests-schema.test.ts`
Expected: FAIL — `relation "expense_requests" does not exist`.

- [ ] **Step 3: Create and write the migration**

Run: `supabase migration new expense_requests`. Write:
```sql
create table expense_requests (
  id uuid primary key default gen_random_uuid(),
  procurement_case_id uuid not null references procurement_cases(id),
  purchase_order_id uuid not null references purchase_orders(id),
  acceptance_id uuid references acceptances(id),
  applicant_employee_id uuid not null references employees(id),
  department_id uuid not null references departments(id),
  budget_owner_employee_id uuid not null references employees(id),
  payee_type text not null check (payee_type in ('employee', 'supplier')),
  payee_supplier_id uuid references suppliers(id),
  payment_method text not null,
  bank_name text,
  bank_account text,
  account_name text,
  invoice_month text,
  expected_payment_date date,
  payment_batch_date date,
  total_amount numeric(14, 2) not null default 0,
  status text not null default 'pending_approval'
    check (status in ('pending_approval', 'approved', 'returned')),
  current_step_order integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (procurement_case_id),
  check ((payee_type = 'supplier') = (payee_supplier_id is not null))
);

create index on expense_requests (applicant_employee_id);
create index on expense_requests (status);

create table expense_request_items (
  id uuid primary key default gen_random_uuid(),
  expense_request_id uuid not null references expense_requests(id) on delete cascade,
  line_no integer not null,
  purchase_order_item_id uuid not null references purchase_order_items(id),
  description text not null,
  amount numeric(14, 2) not null check (amount > 0),
  created_at timestamptz not null default now(),
  unique (expense_request_id, line_no)
);
```

- [ ] **Step 4: Apply the migration**

Run: `export $(grep -v '^#' .env.local | xargs) && supabase db push`

- [ ] **Step 5: Run the test to verify it passes**

Run: `export $(grep -v '^#' .env.local | xargs) && npm test -- tests/integration/expense-requests-schema.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations tests/integration/expense-requests-schema.test.ts
git commit -m "feat: add expense_requests and expense_request_items tables"
```

---

## Task 4: Migration — `attachments` table + private Storage bucket

**Files:**
- Create: `supabase/migrations/<timestamp>_attachments.sql`
- Test: `tests/integration/attachments-schema.test.ts`

**Interfaces:**
- Consumes: `employees(id)`.
- Produces: `attachments(id, form_type, form_id, uploaded_by_employee_id, storage_path, file_name, mime_type, file_size_bytes, created_at)`, `form_type in ('purchase_request','purchase_order','acceptance','expense_request')`, `storage_path` unique; a Storage bucket row `id = 'attachments'`, `public = false`.

- [ ] **Step 1: Write the failing integration test**

`tests/integration/attachments-schema.test.ts`:
```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createServiceRoleTestClient,
  hasIntegrationTestCredentials,
} from './supabase-test-client';

describe.skipIf(!hasIntegrationTestCredentials())('attachments schema + storage bucket', () => {
  let supabase: ReturnType<typeof createServiceRoleTestClient>;
  let employeeId: string;
  const formId = crypto.randomUUID();

  beforeAll(async () => {
    supabase = createServiceRoleTestClient();
    const { data } = await supabase.from('employees').select('id').limit(1).single();
    employeeId = data!.id;
  });

  afterAll(async () => {
    await supabase.from('attachments').delete().eq('form_id', formId);
  });

  it('has a private attachments Storage bucket', async () => {
    const { data, error } = await supabase.storage.getBucket('attachments');
    expect(error).toBeNull();
    expect(data!.public).toBe(false);
  });

  it('inserts an attachment row', async () => {
    const { data, error } = await supabase
      .from('attachments')
      .insert({
        form_type: 'purchase_order',
        form_id: formId,
        uploaded_by_employee_id: employeeId,
        storage_path: `purchase_order/${formId}/quote.pdf`,
        file_name: 'quote.pdf',
        mime_type: 'application/pdf',
        file_size_bytes: 1024,
      })
      .select()
      .single();
    expect(error).toBeNull();
    expect(data!.file_name).toBe('quote.pdf');
  });

  it('rejects an invalid form_type', async () => {
    const { error } = await supabase.from('attachments').insert({
      form_type: 'not_a_form',
      form_id: formId,
      uploaded_by_employee_id: employeeId,
      storage_path: `not_a_form/${formId}/x.pdf`,
      file_name: 'x.pdf',
      mime_type: 'application/pdf',
      file_size_bytes: 1,
    });
    expect(error).not.toBeNull();
  });

  it('rejects a duplicate storage_path', async () => {
    const { error } = await supabase.from('attachments').insert({
      form_type: 'purchase_order',
      form_id: formId,
      uploaded_by_employee_id: employeeId,
      storage_path: `purchase_order/${formId}/quote.pdf`,
      file_name: 'quote-again.pdf',
      mime_type: 'application/pdf',
      file_size_bytes: 1,
    });
    expect(error).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `export $(grep -v '^#' .env.local | xargs) && npm test -- tests/integration/attachments-schema.test.ts`
Expected: FAIL — `relation "attachments" does not exist`.

- [ ] **Step 3: Create and write the migration**

Run: `supabase migration new attachments`. Write:
```sql
create table attachments (
  id uuid primary key default gen_random_uuid(),
  form_type text not null
    check (form_type in ('purchase_request', 'purchase_order', 'acceptance', 'expense_request')),
  form_id uuid not null,
  uploaded_by_employee_id uuid not null references employees(id),
  storage_path text not null unique,
  file_name text not null,
  mime_type text not null,
  file_size_bytes bigint not null check (file_size_bytes > 0),
  created_at timestamptz not null default now()
);

create index on attachments (form_type, form_id);

insert into storage.buckets (id, name, public)
values ('attachments', 'attachments', false)
on conflict (id) do nothing;
```

- [ ] **Step 4: Apply the migration**

Run: `export $(grep -v '^#' .env.local | xargs) && supabase db push`

- [ ] **Step 5: Run the test to verify it passes**

Run: `export $(grep -v '^#' .env.local | xargs) && npm test -- tests/integration/attachments-schema.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations tests/integration/attachments-schema.test.ts
git commit -m "feat: add attachments table and private Storage bucket"
```

---

## Task 5: Migration — RLS for the four new form tables + `attachments`

**Files:**
- Create: `supabase/migrations/<timestamp>_new_forms_rls.sql`
- Test: `tests/integration/new-forms-rls.test.ts`

**Interfaces:**
- Consumes: `current_employee_id()`, `is_finance()`, `is_admin()` (existing), `purchase_orders`, `acceptances`, `expense_requests`, their item tables, `attachments`.
- Produces: SQL function `is_participant_of_form(p_form_type text, p_form_id uuid) returns boolean` (SECURITY DEFINER, `search_path` pinned) — true if the caller is an `approval_steps` approver of that form, or the form's `applicant_employee_id`. RLS enabled on all four new header tables, their item tables, and `attachments`, each with a SELECT policy built on `is_participant_of_form()` / `is_finance()` / `is_admin()`. No insert/update/delete policies anywhere (all writes are service-role only); `storage.objects` gets zero policies (already RLS-enabled by default in Supabase, so zero policies means only the service-role key can touch bucket contents).

**Design note for the implementer:** `is_participant_of_form` is written as one `plpgsql` function with a `case` over `p_form_type` rather than four separate near-identical SQL functions, and it does **not** try to reuse `is_approver_of_request` (that function is purchase-request-specific and pre-dates this plan) — it duplicates the tiny `approval_steps` existence check inline instead, to keep the four `case` branches symmetric and avoid one form type having a different code path than the other three.

- [ ] **Step 1: Write the failing RLS test**

`tests/integration/new-forms-rls.test.ts`:
```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createAnonTestClient,
  createServiceRoleTestClient,
  hasIntegrationTestCredentials,
} from './supabase-test-client';

describe.skipIf(!hasIntegrationTestCredentials())('new forms RLS', () => {
  let admin: ReturnType<typeof createServiceRoleTestClient>;
  const password = 'Test-password-123!';
  const applicantEmail = `rls-po-applicant-${Date.now()}@turing-drive.com`;
  const outsiderEmail = `rls-po-outsider-${Date.now()}@turing-drive.com`;
  let deptId: string;
  let applicantEmpId: string;
  let outsiderEmpId: string;
  let applicantAuthId: string;
  let outsiderAuthId: string;
  let supplierId: string;
  let caseId: string;
  let orderId: string;
  let attachmentId: string;

  beforeAll(async () => {
    admin = createServiceRoleTestClient();
    const { data: dept } = await admin
      .from('departments')
      .insert({ code: `RLS-PO-${Date.now()}`, name: 'RLS 採購測試部門' })
      .select()
      .single();
    deptId = dept!.id;
    const { data: sup } = await admin.from('suppliers').select('id').limit(1).single();
    supplierId = sup!.id;

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
          employee_code: `RLS-PO-A-${Date.now()}`,
          name: 'RLS 採購申請人',
          department_id: deptId,
          google_email: applicantEmail,
          role: 'staff',
        },
        {
          employee_code: `RLS-PO-O-${Date.now()}`,
          name: 'RLS 採購外人',
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
    const { data: po } = await admin
      .from('purchase_orders')
      .insert({
        procurement_case_id: caseId,
        purchase_request_id: null,
        applicant_employee_id: applicantEmpId,
        department_id: deptId,
        budget_owner_employee_id: applicantEmpId,
        supplier_id: supplierId,
        payment_method: '匯款',
        payment_terms: '貨到付款',
        total_amount: 1000,
        current_step_order: 1,
      })
      .select()
      .single();
    orderId = po!.id;
    const { data: att } = await admin
      .from('attachments')
      .insert({
        form_type: 'purchase_order',
        form_id: orderId,
        uploaded_by_employee_id: applicantEmpId,
        storage_path: `purchase_order/${orderId}/quote.pdf`,
        file_name: 'quote.pdf',
        mime_type: 'application/pdf',
        file_size_bytes: 10,
      })
      .select()
      .single();
    attachmentId = att!.id;
  });

  afterAll(async () => {
    await admin.from('attachments').delete().eq('id', attachmentId);
    await admin.from('purchase_orders').delete().eq('id', orderId);
    await admin.from('procurement_cases').delete().eq('id', caseId);
    await admin.from('employees').delete().eq('department_id', deptId);
    await admin.from('departments').delete().eq('id', deptId);
    await admin.auth.admin.deleteUser(applicantAuthId);
    await admin.auth.admin.deleteUser(outsiderAuthId);
  });

  it('lets the applicant read their own purchase order and its attachment', async () => {
    const client = createAnonTestClient();
    await client.auth.signInWithPassword({ email: applicantEmail, password });
    const { data: po } = await client.from('purchase_orders').select('id').eq('id', orderId);
    expect(po).toHaveLength(1);
    const { data: att } = await client
      .from('attachments')
      .select('id')
      .eq('id', attachmentId);
    expect(att).toHaveLength(1);
  });

  it('hides the purchase order and attachment from an unrelated employee', async () => {
    const client = createAnonTestClient();
    await client.auth.signInWithPassword({ email: outsiderEmail, password });
    const { data: po } = await client.from('purchase_orders').select('id').eq('id', orderId);
    expect(po).toEqual([]);
    const { data: att } = await client
      .from('attachments')
      .select('id')
      .eq('id', attachmentId);
    expect(att).toEqual([]);
  });

  it('blocks a direct client insert into purchase_orders (writes are service-role only)', async () => {
    const client = createAnonTestClient();
    await client.auth.signInWithPassword({ email: applicantEmail, password });
    const { error } = await client.from('purchase_orders').insert({
      procurement_case_id: caseId,
      applicant_employee_id: applicantEmpId,
      department_id: deptId,
      budget_owner_employee_id: applicantEmpId,
      supplier_id: supplierId,
      payment_method: '匯款',
      payment_terms: '貨到付款',
    });
    expect(error).not.toBeNull();
  });

  it('blocks anonymous Storage download of the attachment bytes (service-role only)', async () => {
    const client = createAnonTestClient();
    await client.auth.signInWithPassword({ email: applicantEmail, password });
    const { data, error } = await client.storage
      .from('attachments')
      .download(`purchase_order/${orderId}/quote.pdf`);
    expect(data).toBeNull();
    expect(error).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `export $(grep -v '^#' .env.local | xargs) && npm test -- tests/integration/new-forms-rls.test.ts`
Expected: FAIL — the "hides" and "blocks" assertions fail because RLS is not enabled yet on the new tables.

- [ ] **Step 3: Create and write the RLS migration**

Run: `supabase migration new new_forms_rls`. Write:
```sql
create or replace function is_participant_of_form(p_form_type text, p_form_id uuid) returns boolean
language plpgsql stable security definer set search_path = public
as $$
begin
  if exists (
    select 1 from approval_steps
    where form_type = p_form_type
      and form_id = p_form_id
      and approver_employee_id = current_employee_id()
  ) then
    return true;
  end if;

  case p_form_type
    when 'purchase_request' then
      return exists (
        select 1 from purchase_requests
        where id = p_form_id and applicant_employee_id = current_employee_id()
      );
    when 'purchase_order' then
      return exists (
        select 1 from purchase_orders
        where id = p_form_id and applicant_employee_id = current_employee_id()
      );
    when 'acceptance' then
      return exists (
        select 1 from acceptances
        where id = p_form_id and applicant_employee_id = current_employee_id()
      );
    when 'expense_request' then
      return exists (
        select 1 from expense_requests
        where id = p_form_id and applicant_employee_id = current_employee_id()
      );
    else
      return false;
  end case;
end;
$$;

alter table purchase_orders enable row level security;
alter table purchase_order_items enable row level security;
alter table acceptances enable row level security;
alter table acceptance_items enable row level security;
alter table expense_requests enable row level security;
alter table expense_request_items enable row level security;
alter table attachments enable row level security;

create policy "participant_read_purchase_orders" on purchase_orders
  for select using (
    is_finance() or is_admin() or is_participant_of_form('purchase_order', id)
  );

create policy "participant_read_purchase_order_items" on purchase_order_items
  for select using (
    is_finance() or is_admin()
    or exists (
      select 1 from purchase_orders po
      where po.id = purchase_order_items.purchase_order_id
        and is_participant_of_form('purchase_order', po.id)
    )
  );

create policy "participant_read_acceptances" on acceptances
  for select using (
    is_finance() or is_admin() or is_participant_of_form('acceptance', id)
  );

create policy "participant_read_acceptance_items" on acceptance_items
  for select using (
    is_finance() or is_admin()
    or exists (
      select 1 from acceptances a
      where a.id = acceptance_items.acceptance_id
        and is_participant_of_form('acceptance', a.id)
    )
  );

create policy "participant_read_expense_requests" on expense_requests
  for select using (
    is_finance() or is_admin() or is_participant_of_form('expense_request', id)
  );

create policy "participant_read_expense_request_items" on expense_request_items
  for select using (
    is_finance() or is_admin()
    or exists (
      select 1 from expense_requests er
      where er.id = expense_request_items.expense_request_id
        and is_participant_of_form('expense_request', er.id)
    )
  );

create policy "participant_read_attachments" on attachments
  for select using (
    is_finance() or is_admin() or is_participant_of_form(form_type, form_id)
  );

-- storage.objects: zero policies on the 'attachments' bucket → only the
-- service-role key (used inside vetted server actions) can read/write bytes.
```

- [ ] **Step 4: Apply the migration**

Run: `export $(grep -v '^#' .env.local | xargs) && supabase db push`

- [ ] **Step 5: Run the test to verify it passes**

Run: `export $(grep -v '^#' .env.local | xargs) && npm test -- tests/integration/new-forms-rls.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Run the full suite to confirm no regressions**

Run: `export $(grep -v '^#' .env.local | xargs) && npm test`
Expected: all pass (everything from the previous two plans + this plan's new schema/RLS tests).

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations tests/integration/new-forms-rls.test.ts
git commit -m "feat: add is_participant_of_form and RLS for new forms + attachments"
```

---

## Task 6: `classifyItemCategory()` pure logic

**Files:**
- Create: `src/lib/procurement/item-category.ts`
- Test: `src/lib/procurement/item-category.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `classifyItemCategory(input: { untaxedAmount: number; soldWithVehicle: boolean }): '設備' | '材料'`. Used by the 請購單 create form (retrofitted in Task 10) and the 採購單 create form (Task 18) to show a soft warning when the user-selected budget-code category disagrees with this classification. Rule: 未稅金額 ≥ NT$80,000 且非隨車出售 → `'設備'`；否則 `'材料'`.

- [ ] **Step 1: Write the failing test**

`src/lib/procurement/item-category.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { classifyItemCategory } from './item-category';

describe('classifyItemCategory', () => {
  it('classifies as 設備 when untaxed amount >= 80000 and not sold with vehicle', () => {
    expect(classifyItemCategory({ untaxedAmount: 80000, soldWithVehicle: false })).toBe('設備');
    expect(classifyItemCategory({ untaxedAmount: 200000, soldWithVehicle: false })).toBe('設備');
  });

  it('classifies as 材料 when untaxed amount is below 80000', () => {
    expect(classifyItemCategory({ untaxedAmount: 79999, soldWithVehicle: false })).toBe('材料');
  });

  it('classifies as 材料 when sold with vehicle regardless of amount', () => {
    expect(classifyItemCategory({ untaxedAmount: 200000, soldWithVehicle: true })).toBe('材料');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/lib/procurement/item-category.test.ts`
Expected: FAIL — `Cannot find module './item-category'`.

- [ ] **Step 3: Implement the function**

`src/lib/procurement/item-category.ts`:
```ts
const EQUIPMENT_THRESHOLD = 80000;

export function classifyItemCategory(input: {
  untaxedAmount: number;
  soldWithVehicle: boolean;
}): '設備' | '材料' {
  if (input.untaxedAmount >= EQUIPMENT_THRESHOLD && !input.soldWithVehicle) {
    return '設備';
  }
  return '材料';
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/lib/procurement/item-category.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/procurement/item-category.ts src/lib/procurement/item-category.test.ts
git commit -m "feat: add 設備/材料 classification logic"
```

---

## Task 7: `requiredQuoteCount()` + `validateQuoteCount()` pure logic

**Files:**
- Create: `src/lib/procurement/quote-requirement.ts`
- Test: `src/lib/procurement/quote-requirement.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `requiredQuoteCount(totalAmount: number): number` (<NT$30,000 → 1, NT$30,000~99,999 → 2, ≥NT$100,000 → 3); `validateQuoteCount(input: { totalAmount: number; quoteCount: number; reason: string | null }): ValidationResult` where `ValidationResult = { ok: true } | { ok: false; error: string }` — passes when `quoteCount >= requiredQuoteCount(totalAmount)`, or when short of the requirement but `reason` is a non-empty trimmed string ("未檢附其他報價單原因"). Consumed by `src/lib/purchase-orders/validate.ts` (Task 15).

- [ ] **Step 1: Write the failing test**

`src/lib/procurement/quote-requirement.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { requiredQuoteCount, validateQuoteCount } from './quote-requirement';

describe('requiredQuoteCount', () => {
  it('requires 1 quote under 30000', () => {
    expect(requiredQuoteCount(29999)).toBe(1);
  });

  it('requires 2 quotes from 30000 to 99999', () => {
    expect(requiredQuoteCount(30000)).toBe(2);
    expect(requiredQuoteCount(99999)).toBe(2);
  });

  it('requires 3 quotes at 100000 and above', () => {
    expect(requiredQuoteCount(100000)).toBe(3);
    expect(requiredQuoteCount(500000)).toBe(3);
  });
});

describe('validateQuoteCount', () => {
  it('passes when quoteCount meets the requirement', () => {
    expect(validateQuoteCount({ totalAmount: 50000, quoteCount: 2, reason: null })).toEqual({
      ok: true,
    });
  });

  it('passes when short of the requirement but a reason is given', () => {
    expect(
      validateQuoteCount({ totalAmount: 50000, quoteCount: 1, reason: '僅一家廠商承作此類材料' })
    ).toEqual({ ok: true });
  });

  it('rejects when short of the requirement and no reason is given', () => {
    expect(validateQuoteCount({ totalAmount: 50000, quoteCount: 1, reason: null })).toEqual({
      ok: false,
      error: '報價單家數未達門檻，需填寫「未檢附其他報價單原因」',
    });
  });

  it('rejects when the reason is blank', () => {
    expect(validateQuoteCount({ totalAmount: 50000, quoteCount: 1, reason: '   ' })).toEqual({
      ok: false,
      error: '報價單家數未達門檻，需填寫「未檢附其他報價單原因」',
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/lib/procurement/quote-requirement.test.ts`
Expected: FAIL — `Cannot find module './quote-requirement'`.

- [ ] **Step 3: Implement the function**

`src/lib/procurement/quote-requirement.ts`:
```ts
export type ValidationResult = { ok: true } | { ok: false; error: string };

export function requiredQuoteCount(totalAmount: number): number {
  if (totalAmount >= 100000) return 3;
  if (totalAmount >= 30000) return 2;
  return 1;
}

export function validateQuoteCount(input: {
  totalAmount: number;
  quoteCount: number;
  reason: string | null;
}): ValidationResult {
  const required = requiredQuoteCount(input.totalAmount);
  if (input.quoteCount >= required) {
    return { ok: true };
  }
  if (input.reason && input.reason.trim() !== '') {
    return { ok: true };
  }
  return { ok: false, error: '報價單家數未達門檻，需填寫「未檢附其他報價單原因」' };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/lib/procurement/quote-requirement.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/procurement/quote-requirement.ts src/lib/procurement/quote-requirement.test.ts
git commit -m "feat: add quote-count threshold validation logic"
```

---

## Task 8: `checkPaymentTermsConsistency()` pure logic

**Files:**
- Create: `src/lib/procurement/payment-terms.ts`
- Test: `src/lib/procurement/payment-terms.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `PAYMENT_TERMS_DAYS: Record<string, number | null>` mapping (`'預付款': 0`, `'貨到付款': 0`, `'月結30天': 30`, `'月結45天': 45`, `'月結60天': 60`, `'其他': null`); `checkPaymentTermsConsistency(input: { paymentTerms: string; orderApprovedDate: string; expectedPaymentDate: string | null }): { consistent: boolean; suggestedDate: string | null }`. When `paymentTerms` maps to a known day count, the suggested date is `orderApprovedDate + days`; `consistent` is `true` when `expectedPaymentDate` is null (nothing to compare yet) or matches the suggested date within 3 days, and always `true` when `paymentTerms` maps to `null` (`'其他'` — nothing to check). Used by the 費用申請單 create form (Task 22) as a **non-blocking** UI hint only.

- [ ] **Step 1: Write the failing test**

`src/lib/procurement/payment-terms.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { checkPaymentTermsConsistency, PAYMENT_TERMS_DAYS } from './payment-terms';

describe('PAYMENT_TERMS_DAYS', () => {
  it('maps known payment terms to day counts and 其他 to null', () => {
    expect(PAYMENT_TERMS_DAYS['月結30天']).toBe(30);
    expect(PAYMENT_TERMS_DAYS['貨到付款']).toBe(0);
    expect(PAYMENT_TERMS_DAYS['其他']).toBeNull();
  });
});

describe('checkPaymentTermsConsistency', () => {
  it('is consistent when no expected payment date is given yet', () => {
    expect(
      checkPaymentTermsConsistency({
        paymentTerms: '月結30天',
        orderApprovedDate: '2026-07-01',
        expectedPaymentDate: null,
      })
    ).toEqual({ consistent: true, suggestedDate: '2026-07-31' });
  });

  it('is consistent when the expected date matches the suggested date', () => {
    expect(
      checkPaymentTermsConsistency({
        paymentTerms: '月結30天',
        orderApprovedDate: '2026-07-01',
        expectedPaymentDate: '2026-07-31',
      }).consistent
    ).toBe(true);
  });

  it('is inconsistent when the expected date is far from the suggested date', () => {
    expect(
      checkPaymentTermsConsistency({
        paymentTerms: '月結30天',
        orderApprovedDate: '2026-07-01',
        expectedPaymentDate: '2026-09-01',
      }).consistent
    ).toBe(false);
  });

  it('is always consistent for 其他 (no known day count to compare)', () => {
    expect(
      checkPaymentTermsConsistency({
        paymentTerms: '其他',
        orderApprovedDate: '2026-07-01',
        expectedPaymentDate: '2026-09-01',
      })
    ).toEqual({ consistent: true, suggestedDate: null });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/lib/procurement/payment-terms.test.ts`
Expected: FAIL — `Cannot find module './payment-terms'`.

- [ ] **Step 3: Implement the function**

`src/lib/procurement/payment-terms.ts`:
```ts
export const PAYMENT_TERMS_DAYS: Record<string, number | null> = {
  預付款: 0,
  貨到付款: 0,
  月結30天: 30,
  月結45天: 45,
  月結60天: 60,
  其他: null,
};

const CONSISTENCY_TOLERANCE_DAYS = 3;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function diffInDays(a: string, b: string): number {
  const da = new Date(`${a}T00:00:00Z`).getTime();
  const db = new Date(`${b}T00:00:00Z`).getTime();
  return Math.abs(da - db) / MS_PER_DAY;
}

export function checkPaymentTermsConsistency(input: {
  paymentTerms: string;
  orderApprovedDate: string;
  expectedPaymentDate: string | null;
}): { consistent: boolean; suggestedDate: string | null } {
  const days = PAYMENT_TERMS_DAYS[input.paymentTerms];
  if (days === null || days === undefined) {
    return { consistent: true, suggestedDate: null };
  }
  const suggestedDate = addDays(input.orderApprovedDate, days);
  if (input.expectedPaymentDate === null) {
    return { consistent: true, suggestedDate };
  }
  const consistent = diffInDays(suggestedDate, input.expectedPaymentDate) <= CONSISTENCY_TOLERANCE_DAYS;
  return { consistent, suggestedDate };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/lib/procurement/payment-terms.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/procurement/payment-terms.ts src/lib/procurement/payment-terms.test.ts
git commit -m "feat: add payment-terms consistency hint logic"
```

---

## Task 9: `computePaymentBatchDate()` pure logic

**Files:**
- Create: `src/lib/procurement/payment-batch.ts`
- Test: `src/lib/procurement/payment-batch.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `computeDefaultExpectedPaymentDate(invoiceMonth: string): string` (`invoiceMonth` is `'YYYY-MM'`; returns 次月25號 as `'YYYY-MM-DD'`); `computePaymentBatchDate(input: { payeeType: 'employee' | 'supplier'; referenceDate: string; expectedPaymentDate: string | null; invoiceMonth: string | null }): { batchDate: string; isPastNormalDeadline: boolean; isUrgent: boolean }`. Employee batches land on the 15th and 30th (or the month's last day, if shorter) of each month; supplier batches land on the 25th. The chosen `batchDate` is the earliest matching batch date on or after the desired date (`expectedPaymentDate`, or the computed default when blank). `isPastNormalDeadline` is true when fewer than 5 business days remain between `referenceDate` and `batchDate`; `isUrgent` is true when fewer than 2 business days remain. Both are **hints only** — used by the 費用申請單 create form (Task 22) and detail page (Task 26), never block submission.

- [ ] **Step 1: Write the failing test**

`src/lib/procurement/payment-batch.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { computeDefaultExpectedPaymentDate, computePaymentBatchDate } from './payment-batch';

describe('computeDefaultExpectedPaymentDate', () => {
  it('returns the 25th of the month after the invoice month', () => {
    expect(computeDefaultExpectedPaymentDate('2026-07')).toBe('2026-08-25');
  });

  it('rolls over the year at December', () => {
    expect(computeDefaultExpectedPaymentDate('2026-12')).toBe('2027-01-25');
  });
});

describe('computePaymentBatchDate', () => {
  it('picks the 25th for a supplier payee when the desired date is before the 25th', () => {
    const result = computePaymentBatchDate({
      payeeType: 'supplier',
      referenceDate: '2026-07-01',
      expectedPaymentDate: '2026-07-10',
      invoiceMonth: null,
    });
    expect(result.batchDate).toBe('2026-07-25');
  });

  it('rolls a supplier payee to next month when the desired date is after the 25th', () => {
    const result = computePaymentBatchDate({
      payeeType: 'supplier',
      referenceDate: '2026-07-01',
      expectedPaymentDate: '2026-07-26',
      invoiceMonth: null,
    });
    expect(result.batchDate).toBe('2026-08-25');
  });

  it('picks the 15th for an employee payee when the desired date is on or before the 15th', () => {
    const result = computePaymentBatchDate({
      payeeType: 'employee',
      referenceDate: '2026-07-01',
      expectedPaymentDate: '2026-07-05',
      invoiceMonth: null,
    });
    expect(result.batchDate).toBe('2026-07-15');
  });

  it('picks the 30th for an employee payee when the desired date is between the 16th and 30th', () => {
    const result = computePaymentBatchDate({
      payeeType: 'employee',
      referenceDate: '2026-07-01',
      expectedPaymentDate: '2026-07-20',
      invoiceMonth: null,
    });
    expect(result.batchDate).toBe('2026-07-30');
  });

  it('rolls an employee payee to next month\'s 15th when past the second batch day', () => {
    const result = computePaymentBatchDate({
      payeeType: 'employee',
      referenceDate: '2026-07-01',
      expectedPaymentDate: '2026-07-31',
      invoiceMonth: null,
    });
    expect(result.batchDate).toBe('2026-08-15');
  });

  it('falls back to invoiceMonth-based default when expectedPaymentDate is blank', () => {
    const result = computePaymentBatchDate({
      payeeType: 'supplier',
      referenceDate: '2026-07-01',
      expectedPaymentDate: null,
      invoiceMonth: '2026-07',
    });
    expect(result.batchDate).toBe('2026-08-25');
  });

  it('flags isPastNormalDeadline when fewer than 5 business days remain', () => {
    const result = computePaymentBatchDate({
      payeeType: 'supplier',
      referenceDate: '2026-07-22',
      expectedPaymentDate: '2026-07-24',
      invoiceMonth: null,
    });
    expect(result.batchDate).toBe('2026-07-25');
    expect(result.isPastNormalDeadline).toBe(true);
  });

  it('flags isUrgent when fewer than 2 business days remain', () => {
    const result = computePaymentBatchDate({
      payeeType: 'supplier',
      referenceDate: '2026-07-24',
      expectedPaymentDate: '2026-07-24',
      invoiceMonth: null,
    });
    expect(result.batchDate).toBe('2026-07-25');
    expect(result.isUrgent).toBe(true);
  });

  it('does not flag anything when submitted comfortably ahead', () => {
    const result = computePaymentBatchDate({
      payeeType: 'supplier',
      referenceDate: '2026-07-01',
      expectedPaymentDate: '2026-07-10',
      invoiceMonth: null,
    });
    expect(result.isPastNormalDeadline).toBe(false);
    expect(result.isUrgent).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/lib/procurement/payment-batch.test.ts`
Expected: FAIL — `Cannot find module './payment-batch'`.

- [ ] **Step 3: Implement the function**

`src/lib/procurement/payment-batch.ts`:
```ts
function parseISO(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00Z`);
}

function toISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function lastDayOfMonth(year: number, monthIndex0: number): number {
  return new Date(Date.UTC(year, monthIndex0 + 1, 0)).getUTCDate();
}

function isWeekend(d: Date): boolean {
  const day = d.getUTCDay();
  return day === 0 || day === 6;
}

function countBusinessDaysBetween(startIso: string, endIso: string): number {
  const start = parseISO(startIso);
  const end = parseISO(endIso);
  if (end.getTime() <= start.getTime()) return 0;
  let count = 0;
  const cursor = new Date(start.getTime());
  cursor.setUTCDate(cursor.getUTCDate() + 1);
  while (cursor.getTime() <= end.getTime()) {
    if (!isWeekend(cursor)) count += 1;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return count;
}

export function computeDefaultExpectedPaymentDate(invoiceMonth: string): string {
  const [year, month] = invoiceMonth.split('-').map(Number);
  return toISO(new Date(Date.UTC(year, month, 25)));
}

function nextSupplierBatchDate(desired: Date): Date {
  const day = desired.getUTCDate();
  const year = desired.getUTCFullYear();
  const month = desired.getUTCMonth();
  if (day <= 25) return new Date(Date.UTC(year, month, 25));
  return new Date(Date.UTC(year, month + 1, 25));
}

function nextEmployeeBatchDate(desired: Date): Date {
  const day = desired.getUTCDate();
  const year = desired.getUTCFullYear();
  const month = desired.getUTCMonth();
  const secondBatchDay = Math.min(30, lastDayOfMonth(year, month));
  if (day <= 15) return new Date(Date.UTC(year, month, 15));
  if (day <= secondBatchDay) return new Date(Date.UTC(year, month, secondBatchDay));
  return new Date(Date.UTC(year, month + 1, 15));
}

export function computePaymentBatchDate(input: {
  payeeType: 'employee' | 'supplier';
  referenceDate: string;
  expectedPaymentDate: string | null;
  invoiceMonth: string | null;
}): { batchDate: string; isPastNormalDeadline: boolean; isUrgent: boolean } {
  const desiredIso =
    input.expectedPaymentDate ??
    (input.invoiceMonth ? computeDefaultExpectedPaymentDate(input.invoiceMonth) : input.referenceDate);
  const desired = parseISO(desiredIso);
  const batch =
    input.payeeType === 'supplier' ? nextSupplierBatchDate(desired) : nextEmployeeBatchDate(desired);
  const batchDate = toISO(batch);
  const businessDaysRemaining = countBusinessDaysBetween(input.referenceDate, batchDate);
  return {
    batchDate,
    isPastNormalDeadline: businessDaysRemaining < 5,
    isUrgent: businessDaysRemaining < 2,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/lib/procurement/payment-batch.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/procurement/payment-batch.ts src/lib/procurement/payment-batch.test.ts
git commit -m "feat: add 財會撥款批次日 calculation logic"
```

---

## Task 10: `buildApprovalChainForForm()` shared helper + retrofit `purchase-requests/actions.ts`

**Files:**
- Create: `src/lib/approval/build-chain.ts`
- Test: `src/lib/approval/build-chain.test.ts`
- Modify: `src/lib/purchase-requests/actions.ts`

**Interfaces:**
- Consumes: `generateApprovalChain`, `CHAIRMAN_THRESHOLD` from `src/lib/approval/chain.ts`.
- Produces: `BuildChainResult = { ok: true; chain: ApprovalChainStep[] } | { ok: false; error: string }` and `async buildApprovalChainForForm(db, input: { applicantEmployeeId: string; departmentId: string; budgetOwnerEmployeeId: string; totalAmount: number }): Promise<BuildChainResult>` — looks up the department's manager, the single `is_general_manager` employee, and (only when `totalAmount > CHAIRMAN_THRESHOLD`) the single `is_chairman` employee, then calls `generateApprovalChain`. This factors out the block duplicated in `createPurchaseRequest` and `resubmitPurchaseRequest` today, and is reused by all three new forms' create/resubmit actions (Tasks 15, 17, 19, 21, 23, 25).

- [ ] **Step 1: Write the failing test**

`src/lib/approval/build-chain.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { buildApprovalChainForForm } from './build-chain';

function makeFakeDb(overrides: {
  departments?: Record<string, { manager_employee_id: string | null } | undefined>;
  generalManager?: { id: string } | null;
  chairman?: { id: string } | null;
}) {
  return {
    from(table: string) {
      const eqFilters: Record<string, unknown> = {};
      const builder = {
        select() {
          return builder;
        },
        eq(column: string, value: unknown) {
          eqFilters[column] = value;
          return builder;
        },
        limit() {
          return builder;
        },
        async single() {
          if (table === 'departments') {
            const dept = overrides.departments?.[eqFilters.id as string];
            return dept ? { data: dept, error: null } : { data: null, error: new Error('not found') };
          }
          if (table === 'employees' && eqFilters.is_general_manager === true) {
            return overrides.generalManager
              ? { data: overrides.generalManager, error: null }
              : { data: null, error: new Error('not found') };
          }
          if (table === 'employees' && eqFilters.is_chairman === true) {
            return overrides.chairman
              ? { data: overrides.chairman, error: null }
              : { data: null, error: new Error('not found') };
          }
          return { data: null, error: new Error('unexpected query') };
        },
      };
      return builder;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe('buildApprovalChainForForm', () => {
  it('builds manager → budget owner → GM for a normal amount', async () => {
    const db = makeFakeDb({
      departments: { D1: { manager_employee_id: 'MGR' } },
      generalManager: { id: 'GM' },
    });
    const result = await buildApprovalChainForForm(db, {
      applicantEmployeeId: 'APP',
      departmentId: 'D1',
      budgetOwnerEmployeeId: 'OWNER',
      totalAmount: 65000,
    });
    expect(result).toEqual({
      ok: true,
      chain: [
        { approverEmployeeId: 'MGR', approverRole: 'department_manager' },
        { approverEmployeeId: 'OWNER', approverRole: 'budget_owner' },
        { approverEmployeeId: 'GM', approverRole: 'general_manager' },
      ],
    });
  });

  it('adds the chairman when total exceeds the threshold', async () => {
    const db = makeFakeDb({
      departments: { D1: { manager_employee_id: 'MGR' } },
      generalManager: { id: 'GM' },
      chairman: { id: 'CHAIR' },
    });
    const result = await buildApprovalChainForForm(db, {
      applicantEmployeeId: 'APP',
      departmentId: 'D1',
      budgetOwnerEmployeeId: 'OWNER',
      totalAmount: 100001,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.chain[result.chain.length - 1]).toEqual({
      approverEmployeeId: 'CHAIR',
      approverRole: 'chairman',
    });
  });

  it('errors when the department has no manager', async () => {
    const db = makeFakeDb({ departments: { D1: { manager_employee_id: null } }, generalManager: { id: 'GM' } });
    const result = await buildApprovalChainForForm(db, {
      applicantEmployeeId: 'APP',
      departmentId: 'D1',
      budgetOwnerEmployeeId: 'OWNER',
      totalAmount: 1000,
    });
    expect(result).toEqual({ ok: false, error: '申請單位尚未設定主管，無法送出簽核，請聯絡系統管理員' });
  });

  it('errors when no general manager is configured', async () => {
    const db = makeFakeDb({ departments: { D1: { manager_employee_id: 'MGR' } }, generalManager: null });
    const result = await buildApprovalChainForForm(db, {
      applicantEmployeeId: 'APP',
      departmentId: 'D1',
      budgetOwnerEmployeeId: 'OWNER',
      totalAmount: 1000,
    });
    expect(result).toEqual({ ok: false, error: '系統尚未設定總經理，請聯絡系統管理員' });
  });

  it('errors when total exceeds the threshold but no chairman is configured', async () => {
    const db = makeFakeDb({
      departments: { D1: { manager_employee_id: 'MGR' } },
      generalManager: { id: 'GM' },
      chairman: null,
    });
    const result = await buildApprovalChainForForm(db, {
      applicantEmployeeId: 'APP',
      departmentId: 'D1',
      budgetOwnerEmployeeId: 'OWNER',
      totalAmount: 100001,
    });
    expect(result).toEqual({
      ok: false,
      error: '系統尚未設定董事長，無法送出逾 10 萬元的表單，請聯絡系統管理員',
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/lib/approval/build-chain.test.ts`
Expected: FAIL — `Cannot find module './build-chain'`.

- [ ] **Step 3: Implement the helper**

`src/lib/approval/build-chain.ts`:
```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import { CHAIRMAN_THRESHOLD, generateApprovalChain, type ApprovalChainStep } from './chain';

export type BuildChainResult =
  | { ok: true; chain: ApprovalChainStep[] }
  | { ok: false; error: string };

export async function buildApprovalChainForForm(
  db: SupabaseClient,
  input: {
    applicantEmployeeId: string;
    departmentId: string;
    budgetOwnerEmployeeId: string;
    totalAmount: number;
  }
): Promise<BuildChainResult> {
  const { data: dept, error: deptError } = await db
    .from('departments')
    .select('manager_employee_id')
    .eq('id', input.departmentId)
    .single();
  if (deptError || !dept) {
    return { ok: false, error: '找不到申請單位資料，請聯絡系統管理員' };
  }
  if (!dept.manager_employee_id) {
    return { ok: false, error: '申請單位尚未設定主管，無法送出簽核，請聯絡系統管理員' };
  }

  const { data: gm, error: gmError } = await db
    .from('employees')
    .select('id')
    .eq('is_general_manager', true)
    .limit(1)
    .single();
  if (gmError || !gm) {
    return { ok: false, error: '系統尚未設定總經理，請聯絡系統管理員' };
  }

  let chairmanId = input.applicantEmployeeId;
  if (input.totalAmount > CHAIRMAN_THRESHOLD) {
    const { data: chairman, error: chairmanError } = await db
      .from('employees')
      .select('id')
      .eq('is_chairman', true)
      .limit(1)
      .single();
    if (chairmanError || !chairman) {
      return { ok: false, error: '系統尚未設定董事長，無法送出逾 10 萬元的表單，請聯絡系統管理員' };
    }
    chairmanId = chairman.id;
  }

  const chain = generateApprovalChain({
    applicantEmployeeId: input.applicantEmployeeId,
    departmentManagerEmployeeId: dept.manager_employee_id,
    budgetOwnerEmployeeId: input.budgetOwnerEmployeeId,
    generalManagerEmployeeId: gm.id,
    chairmanEmployeeId: chairmanId,
    totalAmount: input.totalAmount,
  });
  return { ok: true, chain };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/lib/approval/build-chain.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Retrofit `createPurchaseRequest` to use the helper**

In `src/lib/purchase-requests/actions.ts`, add the import:
```ts
import { buildApprovalChainForForm } from '@/lib/approval/build-chain';
```

Replace this block inside `createPurchaseRequest` (currently the department/GM/chairman lookups followed by the direct `generateApprovalChain` call):
```ts
  const { data: dept, error: deptError } = await db
    .from('departments')
    .select('manager_employee_id')
    .eq('id', employee.departmentId)
    .single();
  if (deptError || !dept) {
    return { ok: false, error: '找不到申請單位資料，請聯絡系統管理員' };
  }
  if (!dept.manager_employee_id) {
    return { ok: false, error: '申請單位尚未設定主管，無法送出簽核，請聯絡系統管理員' };
  }

  const { data: gm, error: gmError } = await db
    .from('employees')
    .select('id')
    .eq('is_general_manager', true)
    .limit(1)
    .single();
  if (gmError || !gm) {
    return { ok: false, error: '系統尚未設定總經理，請聯絡系統管理員' };
  }

  let chairmanId = employee.id;
  if (totalAmount > CHAIRMAN_THRESHOLD) {
    const { data: chairman, error: chairmanError } = await db
      .from('employees')
      .select('id')
      .eq('is_chairman', true)
      .limit(1)
      .single();
    if (chairmanError || !chairman) {
      return { ok: false, error: '系統尚未設定董事長，無法送出逾 10 萬元的請購單，請聯絡系統管理員' };
    }
    chairmanId = chairman.id;
  }

  const chain = generateApprovalChain({
    applicantEmployeeId: employee.id,
    departmentManagerEmployeeId: dept.manager_employee_id,
    budgetOwnerEmployeeId: budgetOwnerId,
    generalManagerEmployeeId: gm.id,
    chairmanEmployeeId: chairmanId,
    totalAmount,
  });
```

with:
```ts
  const chainResult = await buildApprovalChainForForm(db, {
    applicantEmployeeId: employee.id,
    departmentId: employee.departmentId,
    budgetOwnerEmployeeId: budgetOwnerId,
    totalAmount,
  });
  if (!chainResult.ok) {
    return { ok: false, error: chainResult.error };
  }
  const chain = chainResult.chain;
```

Apply the same replacement inside `resubmitPurchaseRequest` (same block shape, using `pr.department_id` instead of `employee.departmentId`):
```ts
  const chainResult = await buildApprovalChainForForm(db, {
    applicantEmployeeId: employee.id,
    departmentId: pr.department_id,
    budgetOwnerEmployeeId: budgetOwnerId,
    totalAmount,
  });
  if (!chainResult.ok) {
    return { ok: false, error: chainResult.error };
  }
  const chain = chainResult.chain;
```

The `generateApprovalChain` and `CHAIRMAN_THRESHOLD` imports from `@/lib/approval/chain` are no longer used directly in this file after both replacements — remove them from the import statement (keep only `type ApprovalChainStep` if still referenced elsewhere in the file; it is, in the `stepRows` mapping, so keep that named type import).

- [ ] **Step 6: Run the existing purchase-request test suite to confirm no regression**

Run: `export $(grep -v '^#' .env.local | xargs) && npm test -- tests/integration/purchase-request-create.test.ts tests/integration/purchase-request-approve-return.test.ts tests/integration/purchase-request-resubmit.test.ts`
Expected: PASS, same counts as before the refactor.

- [ ] **Step 7: Commit**

```bash
git add src/lib/approval/build-chain.ts src/lib/approval/build-chain.test.ts src/lib/purchase-requests/actions.ts
git commit -m "refactor: extract buildApprovalChainForForm and reuse it in purchase-requests/actions.ts"
```

---

## Task 11: `sendEmail()` — Google Workspace SMTP wrapper

**Files:**
- Create: `src/lib/email/send.ts`
- Test: `src/lib/email/send.test.ts`
- Modify: `package.json` (add `nodemailer` + `@types/nodemailer`)

**Interfaces:**
- Consumes: `getRequiredEnv` from `src/lib/env.ts`; env vars `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`.
- Produces: `EmailMessage = { to: string; subject: string; text: string }` and `async sendEmail(message: EmailMessage): Promise<void>`. Throws if any SMTP env var is missing or if the SMTP send fails. `src/lib/notifications/notify.ts` (Task 12) is the only caller, and it always wraps this in try/catch.

- [ ] **Step 1: Install the dependency**

Run: `npm install nodemailer && npm install -D @types/nodemailer`

- [ ] **Step 2: Write the failing test**

`src/lib/email/send.test.ts`:
```ts
import { afterEach, describe, expect, it, vi } from 'vitest';

const sendMailMock = vi.hoisted(() => vi.fn().mockResolvedValue({ messageId: 'test' }));
const createTransportMock = vi.hoisted(() => vi.fn(() => ({ sendMail: sendMailMock })));
vi.mock('nodemailer', () => ({ default: { createTransport: createTransportMock } }));

describe('sendEmail', () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    sendMailMock.mockClear();
    createTransportMock.mockClear();
  });

  it('throws when SMTP_HOST is missing', async () => {
    vi.stubEnv('SMTP_PORT', '587');
    vi.stubEnv('SMTP_USER', 'user@turing-drive.com');
    vi.stubEnv('SMTP_PASSWORD', 'app-password');
    vi.stubEnv('SMTP_FROM', 'noreply@turing-drive.com');
    const { sendEmail } = await import('./send');
    await expect(
      sendEmail({ to: 'a@turing-drive.com', subject: '主旨', text: '內容' })
    ).rejects.toThrow('Missing required environment variable: SMTP_HOST');
  });

  it('builds an SMTP transport from env vars and sends the message', async () => {
    vi.stubEnv('SMTP_HOST', 'smtp-relay.gmail.com');
    vi.stubEnv('SMTP_PORT', '587');
    vi.stubEnv('SMTP_USER', 'user@turing-drive.com');
    vi.stubEnv('SMTP_PASSWORD', 'app-password');
    vi.stubEnv('SMTP_FROM', 'noreply@turing-drive.com');
    const { sendEmail } = await import('./send');
    await sendEmail({ to: 'a@turing-drive.com', subject: '主旨', text: '內容' });
    expect(createTransportMock).toHaveBeenCalledWith({
      host: 'smtp-relay.gmail.com',
      port: 587,
      secure: false,
      auth: { user: 'user@turing-drive.com', pass: 'app-password' },
    });
    expect(sendMailMock).toHaveBeenCalledWith({
      from: 'noreply@turing-drive.com',
      to: 'a@turing-drive.com',
      subject: '主旨',
      text: '內容',
    });
  });

  it('marks the connection secure when the port is 465', async () => {
    vi.stubEnv('SMTP_HOST', 'smtp-relay.gmail.com');
    vi.stubEnv('SMTP_PORT', '465');
    vi.stubEnv('SMTP_USER', 'user@turing-drive.com');
    vi.stubEnv('SMTP_PASSWORD', 'app-password');
    vi.stubEnv('SMTP_FROM', 'noreply@turing-drive.com');
    const { sendEmail } = await import('./send');
    await sendEmail({ to: 'a@turing-drive.com', subject: '主旨', text: '內容' });
    expect(createTransportMock).toHaveBeenCalledWith(
      expect.objectContaining({ port: 465, secure: true })
    );
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test -- src/lib/email/send.test.ts`
Expected: FAIL — `Cannot find module './send'`.

- [ ] **Step 4: Implement the wrapper**

`src/lib/email/send.ts`:
```ts
import nodemailer from 'nodemailer';
import { getRequiredEnv } from '@/lib/env';

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
};

export async function sendEmail(message: EmailMessage): Promise<void> {
  const host = getRequiredEnv('SMTP_HOST');
  const port = Number(getRequiredEnv('SMTP_PORT'));
  const user = getRequiredEnv('SMTP_USER');
  const pass = getRequiredEnv('SMTP_PASSWORD');
  const from = getRequiredEnv('SMTP_FROM');

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });

  await transporter.sendMail({
    from,
    to: message.to,
    subject: message.subject,
    text: message.text,
  });
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- src/lib/email/send.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/lib/email/send.ts src/lib/email/send.test.ts
git commit -m "feat: add nodemailer-based sendEmail against Google Workspace SMTP"
```

---

## Task 12: `notifyAndEmail()` helper + retrofit `purchase-requests/actions.ts`

**Files:**
- Create: `src/lib/notifications/notify.ts`
- Test: `src/lib/notifications/notify.test.ts`
- Modify: `src/lib/purchase-requests/actions.ts`

**Interfaces:**
- Consumes: `sendEmail` (Task 11).
- Produces: `NotifyInput = { recipientEmployeeId: string; type: 'approval_requested' | 'request_returned' | 'request_approved'; formType: string; formId: string; caseNumber: string; message: string }`, `NotifyResult = { ok: true } | { ok: false; error: string }`, and `async notifyAndEmail(db, input: NotifyInput): Promise<NotifyResult>` — inserts the `notifications` row (returning `{ ok: false, error }` if that insert fails, so callers that must react to it still can, exactly like `createPurchaseRequest` does today), then looks up the recipient's `google_email` and best-effort emails them (any lookup/send failure is swallowed — it never turns a successful notification insert into an `{ ok: false }` result). This becomes the single place every one of the four forms' create/approve/return/resubmit actions calls instead of a raw `db.from('notifications').insert(...)`.

- [ ] **Step 1: Write the failing test**

`src/lib/notifications/notify.test.ts`:
```ts
import { afterEach, describe, expect, it, vi } from 'vitest';

const sendEmailMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('@/lib/email/send', () => ({ sendEmail: sendEmailMock }));

function makeFakeDb(options: { recipientEmail: string | null; notifyInsertError?: string }) {
  const insertedRows: unknown[] = [];
  return {
    insertedRows,
    from(table: string) {
      if (table === 'notifications') {
        return {
          insert: (row: unknown) => {
            insertedRows.push(row);
            return Promise.resolve({
              error: options.notifyInsertError ? new Error(options.notifyInsertError) : null,
            });
          },
        };
      }
      if (table === 'employees') {
        const empBuilder = {
          select() {
            return empBuilder;
          },
          eq() {
            return empBuilder;
          },
          maybeSingle: async () => ({
            data: options.recipientEmail ? { google_email: options.recipientEmail } : null,
            error: null,
          }),
        };
        return empBuilder;
      }
      throw new Error(`unexpected table ${table}`);
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe('notifyAndEmail', () => {
  afterEach(() => {
    sendEmailMock.mockClear();
  });

  it('inserts a notification row and emails the recipient', async () => {
    const db = makeFakeDb({ recipientEmail: 'approver@turing-drive.com' });
    const { notifyAndEmail } = await import('./notify');
    const result = await notifyAndEmail(db, {
      recipientEmployeeId: 'E1',
      type: 'approval_requested',
      formType: 'purchase_order',
      formId: 'PO1',
      caseNumber: 'CP1150700001',
      message: '採購單 CP1150700001 待您簽核',
    });
    expect(result).toEqual({ ok: true });
    expect(db.insertedRows).toEqual([
      {
        recipient_employee_id: 'E1',
        type: 'approval_requested',
        form_type: 'purchase_order',
        form_id: 'PO1',
        case_number: 'CP1150700001',
        message: '採購單 CP1150700001 待您簽核',
      },
    ]);
    expect(sendEmailMock).toHaveBeenCalledWith({
      to: 'approver@turing-drive.com',
      subject: '【待簽核】CP1150700001',
      text: '採購單 CP1150700001 待您簽核',
    });
  });

  it('returns ok:false and skips the email when the notification insert fails', async () => {
    const db = makeFakeDb({ recipientEmail: 'approver@turing-drive.com', notifyInsertError: 'boom' });
    const { notifyAndEmail } = await import('./notify');
    const result = await notifyAndEmail(db, {
      recipientEmployeeId: 'E1',
      type: 'approval_requested',
      formType: 'purchase_order',
      formId: 'PO1',
      caseNumber: 'CP1150700001',
      message: '待簽核',
    });
    expect(result).toEqual({ ok: false, error: 'boom' });
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it('still returns ok:true when the recipient has no google_email (email skipped)', async () => {
    const db = makeFakeDb({ recipientEmail: null });
    const { notifyAndEmail } = await import('./notify');
    const result = await notifyAndEmail(db, {
      recipientEmployeeId: 'E1',
      type: 'request_returned',
      formType: 'purchase_order',
      formId: 'PO1',
      caseNumber: 'CP1150700001',
      message: '已退回',
    });
    expect(result).toEqual({ ok: true });
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it('still returns ok:true when sendEmail rejects (email is best-effort)', async () => {
    sendEmailMock.mockRejectedValueOnce(new Error('smtp down'));
    const db = makeFakeDb({ recipientEmail: 'approver@turing-drive.com' });
    const { notifyAndEmail } = await import('./notify');
    const result = await notifyAndEmail(db, {
      recipientEmployeeId: 'E1',
      type: 'request_approved',
      formType: 'purchase_order',
      formId: 'PO1',
      caseNumber: 'CP1150700001',
      message: '已核准',
    });
    expect(result).toEqual({ ok: true });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/lib/notifications/notify.test.ts`
Expected: FAIL — `Cannot find module './notify'`.

- [ ] **Step 3: Implement the helper**

`src/lib/notifications/notify.ts`:
```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import { sendEmail } from '@/lib/email/send';

export type NotifyInput = {
  recipientEmployeeId: string;
  type: 'approval_requested' | 'request_returned' | 'request_approved';
  formType: string;
  formId: string;
  caseNumber: string;
  message: string;
};

export type NotifyResult = { ok: true } | { ok: false; error: string };

const EMAIL_SUBJECT_PREFIX: Record<NotifyInput['type'], string> = {
  approval_requested: '【待簽核】',
  request_returned: '【已退回】',
  request_approved: '【已核准】',
};

export async function notifyAndEmail(db: SupabaseClient, input: NotifyInput): Promise<NotifyResult> {
  const { error } = await db.from('notifications').insert({
    recipient_employee_id: input.recipientEmployeeId,
    type: input.type,
    form_type: input.formType,
    form_id: input.formId,
    case_number: input.caseNumber,
    message: input.message,
  });
  if (error) {
    return { ok: false, error: error.message };
  }

  const { data: recipient } = await db
    .from('employees')
    .select('google_email')
    .eq('id', input.recipientEmployeeId)
    .maybeSingle();
  if (!recipient?.google_email) {
    return { ok: true };
  }

  try {
    await sendEmail({
      to: recipient.google_email,
      subject: `${EMAIL_SUBJECT_PREFIX[input.type]}${input.caseNumber}`,
      text: input.message,
    });
  } catch {
    // Email is best-effort — the in-app notification row above is the source of truth.
  }
  return { ok: true };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/lib/notifications/notify.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Retrofit the four notification insert sites in `purchase-requests/actions.ts`**

Add the import:
```ts
import { notifyAndEmail } from '@/lib/notifications/notify';
```

In `createPurchaseRequest`, replace:
```ts
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
```
with:
```ts
    const first = chain[0];
    const notifyResult = await notifyAndEmail(db, {
      recipientEmployeeId: first.approverEmployeeId,
      type: 'approval_requested',
      formType: 'purchase_request',
      formId: pr.id,
      caseNumber,
      message: `請購單 ${caseNumber} 待您簽核`,
    });
    if (!notifyResult.ok) {
      await cleanup(pr.id);
      return { ok: false, error: '建立通知失敗' };
    }
```

In `approvePurchaseRequestStep`, replace the two notification inserts:
```ts
    await db.from('notifications').insert({
      recipient_employee_id: nextStep.approver_employee_id,
      type: 'approval_requested',
      form_type: 'purchase_request',
      form_id: requestId,
      case_number: caseNumber,
      message: `請購單 ${caseNumber} 待您簽核`,
    });
```
with:
```ts
    await notifyAndEmail(db, {
      recipientEmployeeId: nextStep.approver_employee_id,
      type: 'approval_requested',
      formType: 'purchase_request',
      formId: requestId,
      caseNumber,
      message: `請購單 ${caseNumber} 待您簽核`,
    });
```
and:
```ts
    await db.from('notifications').insert({
      recipient_employee_id: pr.applicant_employee_id,
      type: 'request_approved',
      form_type: 'purchase_request',
      form_id: requestId,
      case_number: caseNumber,
      message: `請購單 ${caseNumber} 已完成簽核`,
    });
```
with:
```ts
    await notifyAndEmail(db, {
      recipientEmployeeId: pr.applicant_employee_id,
      type: 'request_approved',
      formType: 'purchase_request',
      formId: requestId,
      caseNumber,
      message: `請購單 ${caseNumber} 已完成簽核`,
    });
```

In `resubmitPurchaseRequest`, replace:
```ts
  await db.from('notifications').insert({
    recipient_employee_id: chain[0].approverEmployeeId,
    type: 'approval_requested',
    form_type: 'purchase_request',
    form_id: requestId,
    case_number: caseRow!.case_number,
    message: `請購單 ${caseRow!.case_number} 已重新送出，待您簽核`,
  });
```
with:
```ts
  await notifyAndEmail(db, {
    recipientEmployeeId: chain[0].approverEmployeeId,
    type: 'approval_requested',
    formType: 'purchase_request',
    formId: requestId,
    caseNumber: caseRow!.case_number,
    message: `請購單 ${caseRow!.case_number} 已重新送出，待您簽核`,
  });
```

In `returnPurchaseRequestStep`, replace:
```ts
  await db.from('notifications').insert({
    recipient_employee_id: pr.applicant_employee_id,
    type: 'request_returned',
    form_type: 'purchase_request',
    form_id: requestId,
    case_number: caseRow!.case_number,
    message: `請購單 ${caseRow!.case_number} 已被退回：${reason}`,
  });
```
with:
```ts
  await notifyAndEmail(db, {
    recipientEmployeeId: pr.applicant_employee_id,
    type: 'request_returned',
    formType: 'purchase_request',
    formId: requestId,
    caseNumber: caseRow!.case_number,
    message: `請購單 ${caseRow!.case_number} 已被退回：${reason}`,
  });
```

- [ ] **Step 6: Run the existing purchase-request test suite to confirm no regression**

Run: `export $(grep -v '^#' .env.local | xargs) && npm test -- tests/integration/purchase-request-create.test.ts tests/integration/purchase-request-approve-return.test.ts tests/integration/purchase-request-resubmit.test.ts`
Expected: PASS, same counts as before (these tests mock `next/cache` and the auth seam but not `@/lib/email/send` — since `notifyAndEmail` swallows email errors and there are no real `SMTP_*` env vars in `.env.local` yet, `sendEmail` will throw inside the try/catch and be silently swallowed; the notification row still gets inserted and the test assertions on `notifications` rows still pass).

- [ ] **Step 7: Commit**

```bash
git add src/lib/notifications/notify.ts src/lib/notifications/notify.test.ts src/lib/purchase-requests/actions.ts
git commit -m "feat: add notifyAndEmail and retrofit purchase-requests/actions.ts to use it"
```

---

## Task 13: Attachments backend — validation, Storage helper, server actions, queries

**Files:**
- Create: `src/lib/attachments/validate.ts` + `.test.ts`
- Create: `src/lib/attachments/storage.ts`
- Create: `src/lib/attachments/actions.ts`
- Create: `src/lib/attachments/queries.ts`
- Test: `tests/integration/attachments-actions.test.ts`

**Interfaces:**
- Consumes: `createSupabaseServiceRoleClient`, `getCurrentEmployee`, `createSupabaseServerClient`.
- Produces: `validateAttachmentFile(input: { mimeType: string; sizeBytes: number }): ValidationResult`; `uploadAttachmentFile(storagePath: string, file: File): Promise<{ ok: true } | { ok: false; error: string }>`, `createSignedAttachmentUrl(storagePath: string): Promise<string | null>`; `async uploadAttachment(formType: string, formId: string, formData: FormData): Promise<{ ok: true; attachmentId: string } | { ok: false; error: string }>`, `async getAttachmentDownloadUrl(attachmentId: string): Promise<string | null>`; `AttachmentRow = { id, fileName, mimeType, fileSizeBytes, uploadedByName, createdAt }` and `async getAttachments(formType: string, formId: string): Promise<AttachmentRow[]>`. Task 14's `AttachmentsPanel` component and every form's detail page (Tasks 18, 22, 26) consume `uploadAttachment`, `getAttachmentDownloadUrl`, and `getAttachments`.

**Design note for the implementer:** authorization for both `uploadAttachment` and `getAttachmentDownloadUrl` is enforced in code against the service-role client — mirroring `loadCurrentStep` in `purchase-requests/actions.ts` — rather than by relying on an RLS-scoped read, because a server action's `createSupabaseServerClient()` is a plain cookie-bound client with no seam to swap in a test session. A caller is a "participant" of a form if they are its `applicant_employee_id`, an `approval_steps` approver of it, or `finance`/`admin`.

- [ ] **Step 1: Write the failing test for `validateAttachmentFile`**

`src/lib/attachments/validate.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { validateAttachmentFile } from './validate';

describe('validateAttachmentFile', () => {
  it('accepts a PDF within the size limit', () => {
    expect(validateAttachmentFile({ mimeType: 'application/pdf', sizeBytes: 1024 })).toEqual({
      ok: true,
    });
  });

  it('accepts PNG and JPEG', () => {
    expect(validateAttachmentFile({ mimeType: 'image/png', sizeBytes: 1024 })).toEqual({ ok: true });
    expect(validateAttachmentFile({ mimeType: 'image/jpeg', sizeBytes: 1024 })).toEqual({ ok: true });
  });

  it('rejects an unsupported mime type', () => {
    expect(
      validateAttachmentFile({ mimeType: 'application/x-msdownload', sizeBytes: 1024 })
    ).toEqual({ ok: false, error: '僅接受 PDF、PNG、JPEG 檔案' });
  });

  it('rejects a zero-byte file', () => {
    expect(validateAttachmentFile({ mimeType: 'application/pdf', sizeBytes: 0 })).toEqual({
      ok: false,
      error: '檔案內容為空',
    });
  });

  it('rejects a file over 10 MB', () => {
    expect(
      validateAttachmentFile({ mimeType: 'application/pdf', sizeBytes: 10 * 1024 * 1024 + 1 })
    ).toEqual({ ok: false, error: '檔案大小不可超過 10 MB' });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/lib/attachments/validate.test.ts`
Expected: FAIL — `Cannot find module './validate'`.

- [ ] **Step 3: Implement `validateAttachmentFile`**

`src/lib/attachments/validate.ts`:
```ts
export type ValidationResult = { ok: true } | { ok: false; error: string };

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME_TYPES = ['application/pdf', 'image/png', 'image/jpeg'];

export function validateAttachmentFile(input: {
  mimeType: string;
  sizeBytes: number;
}): ValidationResult {
  if (!ALLOWED_MIME_TYPES.includes(input.mimeType)) {
    return { ok: false, error: '僅接受 PDF、PNG、JPEG 檔案' };
  }
  if (input.sizeBytes <= 0) {
    return { ok: false, error: '檔案內容為空' };
  }
  if (input.sizeBytes > MAX_FILE_SIZE_BYTES) {
    return { ok: false, error: '檔案大小不可超過 10 MB' };
  }
  return { ok: true };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/lib/attachments/validate.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Write the Storage helper**

`src/lib/attachments/storage.ts`:
```ts
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';

const BUCKET = 'attachments';
const SIGNED_URL_EXPIRY_SECONDS = 300;

export async function uploadAttachmentFile(
  storagePath: string,
  file: File
): Promise<{ ok: true } | { ok: false; error: string }> {
  const db = createSupabaseServiceRoleClient();
  const { error } = await db.storage.from(BUCKET).upload(storagePath, file, {
    contentType: file.type,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function createSignedAttachmentUrl(storagePath: string): Promise<string | null> {
  const db = createSupabaseServiceRoleClient();
  const { data, error } = await db.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_EXPIRY_SECONDS);
  if (error || !data) return null;
  return data.signedUrl;
}
```

- [ ] **Step 6: Write the failing integration test for the server actions**

`tests/integration/attachments-actions.test.ts`:
```ts
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  createServiceRoleTestClient,
  hasIntegrationTestCredentials,
} from './supabase-test-client';

const currentEmployee = vi.hoisted(() => ({
  value: null as null | { id: string; role: string },
}));
vi.mock('@/lib/auth/current-employee', () => ({
  getCurrentEmployee: async () => currentEmployee.value,
}));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({}) }));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

describe.skipIf(!hasIntegrationTestCredentials())('attachments actions', () => {
  let admin: ReturnType<typeof createServiceRoleTestClient>;
  let applicantId: string;
  let outsiderId: string;
  let caseId: string;
  let orderId: string;
  const createdStoragePaths: string[] = [];

  beforeAll(async () => {
    admin = createServiceRoleTestClient();
    const { data: emps } = await admin
      .from('employees')
      .select('id, department_id')
      .not('department_id', 'is', null)
      .limit(2);
    applicantId = emps![0].id;
    outsiderId = emps![1].id;
    const { data: sup } = await admin.from('suppliers').select('id').limit(1).single();
    const { data: caseNumber } = await admin.rpc('next_case_number');
    const { data: pcase } = await admin
      .from('procurement_cases')
      .insert({ case_number: caseNumber, created_by_employee_id: applicantId })
      .select()
      .single();
    caseId = pcase!.id;
    const { data: po } = await admin
      .from('purchase_orders')
      .insert({
        procurement_case_id: caseId,
        purchase_request_id: null,
        applicant_employee_id: applicantId,
        department_id: emps![0].department_id,
        budget_owner_employee_id: applicantId,
        supplier_id: sup!.id,
        payment_method: '匯款',
        payment_terms: '貨到付款',
      })
      .select()
      .single();
    orderId = po!.id;
  });

  afterEach(() => {
    currentEmployee.value = null;
  });

  afterAll(async () => {
    if (createdStoragePaths.length > 0) {
      await admin.storage.from('attachments').remove(createdStoragePaths);
    }
    await admin.from('attachments').delete().eq('form_id', orderId);
    await admin.from('purchase_orders').delete().eq('id', orderId);
    await admin.from('procurement_cases').delete().eq('id', caseId);
  });

  it('rejects an upload from a non-participant employee', async () => {
    currentEmployee.value = { id: outsiderId, role: 'staff' };
    const { uploadAttachment } = await import('@/lib/attachments/actions');
    const formData = new FormData();
    formData.set(
      'file',
      new File([new Uint8Array([1, 2, 3])], 'quote.pdf', { type: 'application/pdf' })
    );
    const result = await uploadAttachment('purchase_order', orderId, formData);
    expect(result).toEqual({ ok: false, error: '您沒有權限為此表單上傳附件' });
  });

  it('rejects an unsupported file type', async () => {
    currentEmployee.value = { id: applicantId, role: 'staff' };
    const { uploadAttachment } = await import('@/lib/attachments/actions');
    const formData = new FormData();
    formData.set(
      'file',
      new File([new Uint8Array([1])], 'malware.exe', { type: 'application/x-msdownload' })
    );
    const result = await uploadAttachment('purchase_order', orderId, formData);
    expect(result).toEqual({ ok: false, error: '僅接受 PDF、PNG、JPEG 檔案' });
  });

  it('uploads a file, records it, and returns a signed URL to a participant', async () => {
    currentEmployee.value = { id: applicantId, role: 'staff' };
    const { uploadAttachment, getAttachmentDownloadUrl } = await import(
      '@/lib/attachments/actions'
    );
    const formData = new FormData();
    formData.set(
      'file',
      new File([new Uint8Array([1, 2, 3])], 'quote.pdf', { type: 'application/pdf' })
    );
    const result = await uploadAttachment('purchase_order', orderId, formData);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { data: row } = await admin
      .from('attachments')
      .select('storage_path')
      .eq('id', result.attachmentId)
      .single();
    createdStoragePaths.push(row!.storage_path);

    const url = await getAttachmentDownloadUrl(result.attachmentId);
    expect(url).toMatch(/^https?:\/\//);
  });

  it('rejects a download for a non-participant employee', async () => {
    currentEmployee.value = { id: applicantId, role: 'staff' };
    const { uploadAttachment } = await import('@/lib/attachments/actions');
    const formData = new FormData();
    formData.set('file', new File([new Uint8Array([1])], 'x.png', { type: 'image/png' }));
    const uploadResult = await uploadAttachment('purchase_order', orderId, formData);
    if (!uploadResult.ok) throw new Error('setup failed');
    const { data: row } = await admin
      .from('attachments')
      .select('storage_path')
      .eq('id', uploadResult.attachmentId)
      .single();
    createdStoragePaths.push(row!.storage_path);

    currentEmployee.value = { id: outsiderId, role: 'staff' };
    const { getAttachmentDownloadUrl } = await import('@/lib/attachments/actions');
    const url = await getAttachmentDownloadUrl(uploadResult.attachmentId);
    expect(url).toBeNull();
  });
});
```

- [ ] **Step 7: Run the test to verify it fails**

Run: `export $(grep -v '^#' .env.local | xargs) && npm test -- tests/integration/attachments-actions.test.ts`
Expected: FAIL — `Cannot find module '@/lib/attachments/actions'`.

- [ ] **Step 8: Implement the server actions**

`src/lib/attachments/actions.ts`:
```ts
'use server';

import { revalidatePath } from 'next/cache';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { validateAttachmentFile } from '@/lib/attachments/validate';
import { createSignedAttachmentUrl, uploadAttachmentFile } from '@/lib/attachments/storage';

export type UploadResult = { ok: true; attachmentId: string } | { ok: false; error: string };

const FORM_TABLE: Record<string, string> = {
  purchase_request: 'purchase_requests',
  purchase_order: 'purchase_orders',
  acceptance: 'acceptances',
  expense_request: 'expense_requests',
};

const FORM_ROUTE_PREFIX: Record<string, string> = {
  purchase_request: '/requests',
  purchase_order: '/purchase-orders',
  acceptance: '/acceptances',
  expense_request: '/expense-requests',
};

async function isFormParticipant(
  db: ReturnType<typeof createSupabaseServiceRoleClient>,
  formType: string,
  formId: string,
  employee: { id: string; role: string }
): Promise<boolean> {
  if (employee.role === 'finance' || employee.role === 'admin') return true;
  const table = FORM_TABLE[formType];
  if (!table) return false;
  const { data: form } = await db
    .from(table)
    .select('applicant_employee_id')
    .eq('id', formId)
    .maybeSingle();
  if (form?.applicant_employee_id === employee.id) return true;
  const { data: step } = await db
    .from('approval_steps')
    .select('id')
    .eq('form_type', formType)
    .eq('form_id', formId)
    .eq('approver_employee_id', employee.id)
    .limit(1)
    .maybeSingle();
  return !!step;
}

export async function uploadAttachment(
  formType: string,
  formId: string,
  formData: FormData
): Promise<UploadResult> {
  const employee = await getCurrentEmployee(await createSupabaseServerClient());
  if (!employee) return { ok: false, error: '找不到您的員工資料' };

  const db = createSupabaseServiceRoleClient();
  if (!(await isFormParticipant(db, formType, formId, employee))) {
    return { ok: false, error: '您沒有權限為此表單上傳附件' };
  }

  const file = formData.get('file');
  if (!(file instanceof File)) {
    return { ok: false, error: '請選擇檔案' };
  }
  const validation = validateAttachmentFile({ mimeType: file.type, sizeBytes: file.size });
  if (!validation.ok) {
    return { ok: false, error: validation.error };
  }

  const storagePath = `${formType}/${formId}/${Date.now()}-${file.name}`;
  const uploadResult = await uploadAttachmentFile(storagePath, file);
  if (!uploadResult.ok) {
    return { ok: false, error: uploadResult.error };
  }

  const { data, error } = await db
    .from('attachments')
    .insert({
      form_type: formType,
      form_id: formId,
      uploaded_by_employee_id: employee.id,
      storage_path: storagePath,
      file_name: file.name,
      mime_type: file.type,
      file_size_bytes: file.size,
    })
    .select()
    .single();
  if (error || !data) {
    return { ok: false, error: '建立附件記錄失敗' };
  }

  revalidatePath(`${FORM_ROUTE_PREFIX[formType]}/${formId}`);
  return { ok: true, attachmentId: data.id };
}

export async function getAttachmentDownloadUrl(attachmentId: string): Promise<string | null> {
  const employee = await getCurrentEmployee(await createSupabaseServerClient());
  if (!employee) return null;

  const db = createSupabaseServiceRoleClient();
  const { data: attachment } = await db
    .from('attachments')
    .select('storage_path, form_type, form_id')
    .eq('id', attachmentId)
    .maybeSingle();
  if (!attachment) return null;
  if (!(await isFormParticipant(db, attachment.form_type, attachment.form_id, employee))) {
    return null;
  }
  return createSignedAttachmentUrl(attachment.storage_path);
}
```

- [ ] **Step 9: Run the test to verify it passes**

Run: `export $(grep -v '^#' .env.local | xargs) && npm test -- tests/integration/attachments-actions.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 10: Write the query helper (no test — read-only, exercised via page rendering + final browser QA)**

`src/lib/attachments/queries.ts`:
```ts
import { createSupabaseServerClient } from '@/lib/supabase/server';

export type AttachmentRow = {
  id: string;
  fileName: string;
  mimeType: string;
  fileSizeBytes: number;
  uploadedByName: string;
  createdAt: string;
};

export async function getAttachments(formType: string, formId: string): Promise<AttachmentRow[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from('attachments')
    .select(
      'id, file_name, mime_type, file_size_bytes, created_at, uploader:employees!uploaded_by_employee_id(name)'
    )
    .eq('form_type', formType)
    .eq('form_id', formId)
    .order('created_at', { ascending: false });
  return (data ?? []).map((a) => ({
    id: a.id,
    fileName: a.file_name,
    mimeType: a.mime_type,
    fileSizeBytes: a.file_size_bytes,
    uploadedByName: (a.uploader as unknown as { name: string }).name,
    createdAt: a.created_at,
  }));
}
```

- [ ] **Step 11: Commit**

```bash
git add src/lib/attachments tests/integration/attachments-actions.test.ts
git commit -m "feat: add attachments upload/download server actions and Storage helper"
```

---

## Task 14: `AttachmentsPanel` shared UI component

**Files:**
- Create: `src/app/components/attachments-panel.tsx` (client)

**Interfaces:**
- Consumes: `uploadAttachment`, `getAttachmentDownloadUrl` (Task 13), `AttachmentRow` (Task 13).
- Produces: `<AttachmentsPanel formType={string} formId={string} attachments={AttachmentRow[]} />` — reused unmodified by the four form detail pages (Tasks 17, 21, 25, and `/requests/[id]` — 請購單通常無附件 per spec but the panel works the same for it if ever needed). No later task in this plan modifies it; page tasks only import and render it.

**Design notes:** file input + upload button; clicking an attachment name fetches a signed URL via `getAttachmentDownloadUrl` and opens it in a new tab (browser renders PDF/PNG/JPEG inline). On successful upload, reloads the page (`window.location.reload()`) so the server-rendered attachment list picks up the new row — mirrors the rest of this codebase's client components, which call `router.refresh()`/reload rather than holding local list state.

- [ ] **Step 1: Write the component**

`src/app/components/attachments-panel.tsx`:
```tsx
'use client';

import { useRef, useState } from 'react';
import { getAttachmentDownloadUrl, uploadAttachment } from '@/lib/attachments/actions';
import type { AttachmentRow } from '@/lib/attachments/queries';

export function AttachmentsPanel({
  formType,
  formId,
  attachments,
}: {
  formType: string;
  formId: string;
  attachments: AttachmentRow[];
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [previewBusyId, setPreviewBusyId] = useState<string | null>(null);

  const onUpload = async () => {
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      setError('請選擇檔案');
      return;
    }
    setError(null);
    setUploading(true);
    const formData = new FormData();
    formData.set('file', file);
    const result = await uploadAttachment(formType, formId, formData);
    setUploading(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    window.location.reload();
  };

  const onPreview = async (attachmentId: string) => {
    setError(null);
    setPreviewBusyId(attachmentId);
    const url = await getAttachmentDownloadUrl(attachmentId);
    setPreviewBusyId(null);
    if (!url) {
      setError('無法取得檔案預覽連結');
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <section className="rounded border p-4">
      <h2 className="mb-2 font-semibold">附件</h2>
      {error && <p className="mb-2 text-sm text-red-700">{error}</p>}
      {attachments.length === 0 ? (
        <p className="mb-2 text-sm text-gray-500">尚無附件。</p>
      ) : (
        <ul className="mb-2 space-y-1 text-sm">
          {attachments.map((a) => (
            <li key={a.id} className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onPreview(a.id)}
                disabled={previewBusyId === a.id}
                className="text-blue-600 underline disabled:opacity-50"
              >
                {a.fileName}
              </button>
              <span className="text-gray-400">
                {(a.fileSizeBytes / 1024).toFixed(0)} KB｜{a.uploadedByName}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center gap-2">
        <input ref={fileInputRef} type="file" accept=".pdf,.png,.jpg,.jpeg" className="text-sm" />
        <button
          type="button"
          onClick={onUpload}
          disabled={uploading}
          className="rounded border px-3 py-1 text-sm disabled:opacity-50"
        >
          {uploading ? '上傳中…' : '上傳附件'}
        </button>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/components/attachments-panel.tsx
git commit -m "feat: add shared AttachmentsPanel component"
```

---

## Task 15: 採購單 — `validatePurchaseOrderInput()` + `createPurchaseOrder` action

**Files:**
- Create: `src/lib/purchase-orders/validate.ts` + `.test.ts`
- Create: `src/lib/purchase-orders/actions.ts`
- Test: `tests/integration/purchase-order-create.test.ts`

**Interfaces:**
- Consumes: `validateQuoteCount` (Task 7), `buildApprovalChainForForm` (Task 10), `notifyAndEmail` (Task 12), `createSupabaseServiceRoleClient`, `getCurrentEmployee`, `createSupabaseServerClient`.
- Produces: `validatePurchaseOrderInput(input: { items: { unitPrice: number }[]; totalAmount: number; quoteCount: number; quoteCountReason: string | null }): ValidationResult`; `NewPurchaseOrderItem = { purchaseRequestItemId: string; unitPrice: number }`, `NewPurchaseOrder = { purchaseRequestId: string; supplierId: string; paymentMethod: string; paymentTerms: string; expectedDeliveryDays: number | null; quoteCount: number; quoteCountReason: string | null; items: NewPurchaseOrderItem[] }`, `CreateResult = { ok: true; orderId: string; caseNumber: string } | { ok: false; error: string }`, and `async createPurchaseOrder(input: NewPurchaseOrder): Promise<CreateResult>`. Task 16 (approve/return) and Task 17 (resubmit) live in the same `actions.ts` file.

**Design notes:** items are **copied from the source `purchase_request_items`** (one `purchase_order_items` row per source item, same `line_no`/`budget_code_id`/`item_category`/`description`/`quantity`), with the caller supplying only `unitPrice` per source item id — `total_price = unitPrice * quantity`. `department_id` and `budget_owner_employee_id` are inherited from the source `purchase_requests` row, not re-derived. Creation is gated: the source request must be `status = 'approved'`, and its `procurement_case_id` must not already have a `purchase_orders` row.

- [ ] **Step 1: Write the failing test for `validatePurchaseOrderInput`**

`src/lib/purchase-orders/validate.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { validatePurchaseOrderInput } from './validate';

describe('validatePurchaseOrderInput', () => {
  it('accepts valid items meeting the quote-count requirement', () => {
    expect(
      validatePurchaseOrderInput({
        items: [{ unitPrice: 32500 }, { unitPrice: 32500 }],
        totalAmount: 65000,
        quoteCount: 2,
        quoteCountReason: null,
      })
    ).toEqual({ ok: true });
  });

  it('rejects an empty item list', () => {
    expect(
      validatePurchaseOrderInput({ items: [], totalAmount: 0, quoteCount: 1, quoteCountReason: null })
    ).toEqual({ ok: false, error: '採購單至少需要一個明細項次' });
  });

  it('rejects a non-positive unit price', () => {
    expect(
      validatePurchaseOrderInput({
        items: [{ unitPrice: 0 }],
        totalAmount: 0,
        quoteCount: 1,
        quoteCountReason: null,
      })
    ).toEqual({ ok: false, error: '第 1 項的單價必須大於 0' });
  });

  it('rejects short quote count without a reason', () => {
    expect(
      validatePurchaseOrderInput({
        items: [{ unitPrice: 65000 }],
        totalAmount: 65000,
        quoteCount: 1,
        quoteCountReason: null,
      })
    ).toEqual({ ok: false, error: '報價單家數未達門檻，需填寫「未檢附其他報價單原因」' });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/lib/purchase-orders/validate.test.ts`
Expected: FAIL — `Cannot find module './validate'`.

- [ ] **Step 3: Implement `validatePurchaseOrderInput`**

`src/lib/purchase-orders/validate.ts`:
```ts
import { validateQuoteCount, type ValidationResult } from '@/lib/procurement/quote-requirement';

export type { ValidationResult };

export function validatePurchaseOrderInput(input: {
  items: { unitPrice: number }[];
  totalAmount: number;
  quoteCount: number;
  quoteCountReason: string | null;
}): ValidationResult {
  if (input.items.length === 0) {
    return { ok: false, error: '採購單至少需要一個明細項次' };
  }
  for (let i = 0; i < input.items.length; i += 1) {
    if (input.items[i].unitPrice <= 0) {
      return { ok: false, error: `第 ${i + 1} 項的單價必須大於 0` };
    }
  }
  return validateQuoteCount({
    totalAmount: input.totalAmount,
    quoteCount: input.quoteCount,
    reason: input.quoteCountReason,
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/lib/purchase-orders/validate.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Write the failing integration test for `createPurchaseOrder`**

`tests/integration/purchase-order-create.test.ts`:
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

describe.skipIf(!hasIntegrationTestCredentials())('createPurchaseOrder', () => {
  let admin: ReturnType<typeof createServiceRoleTestClient>;
  let applicantId: string;
  let departmentId: string;
  let budgetCodeId: string;
  let supplierId: string;
  const createdOrderIds: string[] = [];
  const createdCaseIds: string[] = [];
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
    departmentId = emp!.department_id;
    const { data: bc } = await admin
      .from('budget_codes')
      .select('id')
      .eq('owner_employee_id', applicantId)
      .limit(1)
      .maybeSingle();
    budgetCodeId = bc?.id ?? (await admin.from('budget_codes').select('id').limit(1).single()).data!.id;
    const { data: sup } = await admin.from('suppliers').select('id').limit(1).single();
    supplierId = sup!.id;
  });

  async function makeApprovedRequest() {
    const { data: caseNumber } = await admin.rpc('next_case_number');
    const { data: pcase } = await admin
      .from('procurement_cases')
      .insert({ case_number: caseNumber, created_by_employee_id: applicantId })
      .select()
      .single();
    createdCaseIds.push(pcase!.id);
    const { data: pr } = await admin
      .from('purchase_requests')
      .insert({
        procurement_case_id: pcase!.id,
        applicant_employee_id: applicantId,
        department_id: departmentId,
        budget_owner_employee_id: applicantId,
        status: 'approved',
      })
      .select()
      .single();
    createdRequestIds.push(pr!.id);
    await admin.from('purchase_request_items').insert({
      purchase_request_id: pr!.id,
      line_no: 1,
      budget_code_id: budgetCodeId,
      item_category: '材料',
      description: '材料A',
      quantity: 2,
    });
    return { caseId: pcase!.id, requestId: pr!.id };
  }

  afterEach(async () => {
    currentEmployee.value = null;
    for (const id of createdOrderIds.splice(0)) {
      await admin.from('approval_steps').delete().eq('form_type', 'purchase_order').eq('form_id', id);
      await admin.from('notifications').delete().eq('form_type', 'purchase_order').eq('form_id', id);
      await admin.from('purchase_orders').delete().eq('id', id);
    }
    for (const id of createdRequestIds.splice(0)) {
      await admin.from('purchase_requests').delete().eq('id', id);
    }
    for (const id of createdCaseIds.splice(0)) {
      await admin.from('procurement_cases').delete().eq('id', id);
    }
  });

  it('rejects when the source purchase request is not approved', async () => {
    const { data: caseNumber } = await admin.rpc('next_case_number');
    const { data: pcase } = await admin
      .from('procurement_cases')
      .insert({ case_number: caseNumber, created_by_employee_id: applicantId })
      .select()
      .single();
    createdCaseIds.push(pcase!.id);
    const { data: pr } = await admin
      .from('purchase_requests')
      .insert({
        procurement_case_id: pcase!.id,
        applicant_employee_id: applicantId,
        department_id: departmentId,
        budget_owner_employee_id: applicantId,
        status: 'pending_approval',
      })
      .select()
      .single();
    createdRequestIds.push(pr!.id);

    currentEmployee.value = { id: applicantId };
    const { createPurchaseOrder } = await import('@/lib/purchase-orders/actions');
    const result = await createPurchaseOrder({
      purchaseRequestId: pr!.id,
      supplierId,
      paymentMethod: '匯款',
      paymentTerms: '貨到付款',
      expectedDeliveryDays: 14,
      quoteCount: 1,
      quoteCountReason: null,
      items: [],
    });
    expect(result).toEqual({ ok: false, error: '來源請購單尚未核准，無法建立採購單' });
  });

  it('creates a purchase order copying items from the source request', async () => {
    const { requestId } = await makeApprovedRequest();
    const { data: prItem } = await admin
      .from('purchase_request_items')
      .select('id')
      .eq('purchase_request_id', requestId)
      .single();

    currentEmployee.value = { id: applicantId };
    const { createPurchaseOrder } = await import('@/lib/purchase-orders/actions');
    const result = await createPurchaseOrder({
      purchaseRequestId: requestId,
      supplierId,
      paymentMethod: '匯款',
      paymentTerms: '貨到付款',
      expectedDeliveryDays: 14,
      quoteCount: 2,
      quoteCountReason: null,
      items: [{ purchaseRequestItemId: prItem!.id, unitPrice: 32500 }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    createdOrderIds.push(result.orderId);

    const { data: order } = await admin
      .from('purchase_orders')
      .select('total_amount, status, current_step_order')
      .eq('id', result.orderId)
      .single();
    expect(Number(order!.total_amount)).toBe(65000);

    const { data: items } = await admin
      .from('purchase_order_items')
      .select('description, quantity, unit_price, total_price')
      .eq('purchase_order_id', result.orderId);
    expect(items).toHaveLength(1);
    expect(items![0].description).toBe('材料A');
    expect(items![0].quantity).toBe(2);
    expect(Number(items![0].unit_price)).toBe(32500);
    expect(Number(items![0].total_price)).toBe(65000);
  });

  it('rejects a second purchase order for the same case', async () => {
    const { requestId } = await makeApprovedRequest();
    const { data: prItem } = await admin
      .from('purchase_request_items')
      .select('id')
      .eq('purchase_request_id', requestId)
      .single();

    currentEmployee.value = { id: applicantId };
    const { createPurchaseOrder } = await import('@/lib/purchase-orders/actions');
    const first = await createPurchaseOrder({
      purchaseRequestId: requestId,
      supplierId,
      paymentMethod: '匯款',
      paymentTerms: '貨到付款',
      expectedDeliveryDays: 14,
      quoteCount: 2,
      quoteCountReason: null,
      items: [{ purchaseRequestItemId: prItem!.id, unitPrice: 32500 }],
    });
    expect(first.ok).toBe(true);
    if (first.ok) createdOrderIds.push(first.orderId);

    const second = await createPurchaseOrder({
      purchaseRequestId: requestId,
      supplierId,
      paymentMethod: '匯款',
      paymentTerms: '貨到付款',
      expectedDeliveryDays: 14,
      quoteCount: 2,
      quoteCountReason: null,
      items: [{ purchaseRequestItemId: prItem!.id, unitPrice: 32500 }],
    });
    expect(second).toEqual({ ok: false, error: '此案件已建立過採購單' });
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `export $(grep -v '^#' .env.local | xargs) && npm test -- tests/integration/purchase-order-create.test.ts`
Expected: FAIL — `Cannot find module '@/lib/purchase-orders/actions'`.

- [ ] **Step 7: Implement `createPurchaseOrder`**

`src/lib/purchase-orders/actions.ts`:
```ts
'use server';

import { revalidatePath } from 'next/cache';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { buildApprovalChainForForm } from '@/lib/approval/build-chain';
import { notifyAndEmail } from '@/lib/notifications/notify';
import { validatePurchaseOrderInput } from '@/lib/purchase-orders/validate';

export type NewPurchaseOrderItem = {
  purchaseRequestItemId: string;
  unitPrice: number;
};

export type NewPurchaseOrder = {
  purchaseRequestId: string;
  supplierId: string;
  paymentMethod: string;
  paymentTerms: string;
  expectedDeliveryDays: number | null;
  quoteCount: number;
  quoteCountReason: string | null;
  items: NewPurchaseOrderItem[];
};

export type CreateResult =
  | { ok: true; orderId: string; caseNumber: string }
  | { ok: false; error: string };

export async function createPurchaseOrder(input: NewPurchaseOrder): Promise<CreateResult> {
  const employee = await getCurrentEmployee(await createSupabaseServerClient());
  if (!employee) return { ok: false, error: '找不到您的員工資料，請聯絡系統管理員' };

  const db = createSupabaseServiceRoleClient();

  const { data: pr } = await db
    .from('purchase_requests')
    .select('id, procurement_case_id, department_id, budget_owner_employee_id, status')
    .eq('id', input.purchaseRequestId)
    .maybeSingle();
  if (!pr) return { ok: false, error: '找不到來源請購單' };
  if (pr.status !== 'approved') {
    return { ok: false, error: '來源請購單尚未核准，無法建立採購單' };
  }

  const { data: existing } = await db
    .from('purchase_orders')
    .select('id')
    .eq('procurement_case_id', pr.procurement_case_id)
    .maybeSingle();
  if (existing) return { ok: false, error: '此案件已建立過採購單' };

  const { data: caseRow } = await db
    .from('procurement_cases')
    .select('case_number')
    .eq('id', pr.procurement_case_id)
    .single();
  if (!caseRow) return { ok: false, error: '找不到案件資料' };
  const caseNumber = caseRow.case_number;

  const { data: prItems } = await db
    .from('purchase_request_items')
    .select('id, line_no, budget_code_id, item_category, description, quantity')
    .eq('purchase_request_id', pr.id)
    .order('line_no');
  if (!prItems || prItems.length === 0) {
    return { ok: false, error: '來源請購單沒有明細項次' };
  }

  const priceByItemId = new Map(input.items.map((i) => [i.purchaseRequestItemId, i.unitPrice]));
  if (priceByItemId.size !== prItems.length || prItems.some((i) => !priceByItemId.has(i.id))) {
    return { ok: false, error: '請為每一項請購明細填寫單價' };
  }

  const orderItems = prItems.map((i) => {
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
    departmentId: pr.department_id,
    budgetOwnerEmployeeId: pr.budget_owner_employee_id,
    totalAmount,
  });
  if (!chainResult.ok) return { ok: false, error: chainResult.error };
  const chain = chainResult.chain;

  const isAutoApproved = chain.length === 0;
  const { data: order, error: orderError } = await db
    .from('purchase_orders')
    .insert({
      procurement_case_id: pr.procurement_case_id,
      purchase_request_id: pr.id,
      applicant_employee_id: employee.id,
      department_id: pr.department_id,
      budget_owner_employee_id: pr.budget_owner_employee_id,
      supplier_id: input.supplierId,
      payment_method: input.paymentMethod,
      payment_terms: input.paymentTerms,
      expected_delivery_days: input.expectedDeliveryDays,
      quote_count: input.quoteCount,
      quote_count_reason: input.quoteCountReason,
      total_amount: totalAmount,
      status: isAutoApproved ? 'approved' : 'pending_approval',
      current_step_order: isAutoApproved ? null : 1,
    })
    .select()
    .single();
  if (orderError || !order) return { ok: false, error: '建立採購單失敗' };

  const cleanup = async () => {
    await db.from('approval_steps').delete().eq('form_type', 'purchase_order').eq('form_id', order.id);
    await db.from('notifications').delete().eq('form_type', 'purchase_order').eq('form_id', order.id);
    await db.from('purchase_orders').delete().eq('id', order.id);
  };

  const { error: itemsError } = await db
    .from('purchase_order_items')
    .insert(orderItems.map((i) => ({ ...i, purchase_order_id: order.id })));
  if (itemsError) {
    await cleanup();
    return { ok: false, error: '建立採購明細失敗' };
  }

  if (!isAutoApproved) {
    const { error: stepsError } = await db.from('approval_steps').insert(
      chain.map((step, idx) => ({
        form_type: 'purchase_order',
        form_id: order.id,
        step_order: idx + 1,
        approver_employee_id: step.approverEmployeeId,
        approver_role: step.approverRole,
      }))
    );
    if (stepsError) {
      await cleanup();
      return { ok: false, error: '建立簽核流程失敗' };
    }

    const notifyResult = await notifyAndEmail(db, {
      recipientEmployeeId: chain[0].approverEmployeeId,
      type: 'approval_requested',
      formType: 'purchase_order',
      formId: order.id,
      caseNumber,
      message: `採購單 ${caseNumber} 待您簽核`,
    });
    if (!notifyResult.ok) {
      await cleanup();
      return { ok: false, error: '建立通知失敗' };
    }
  }

  revalidatePath('/purchase-orders');
  revalidatePath('/approvals');
  return { ok: true, orderId: order.id, caseNumber };
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `export $(grep -v '^#' .env.local | xargs) && npm test -- tests/integration/purchase-order-create.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 9: Commit**

```bash
git add src/lib/purchase-orders tests/integration/purchase-order-create.test.ts
git commit -m "feat: add validatePurchaseOrderInput and createPurchaseOrder"
```

---

## Task 16: 採購單 — `approvePurchaseOrderStep` + `returnPurchaseOrderStep` actions

**Files:**
- Modify: `src/lib/purchase-orders/actions.ts`
- Test: `tests/integration/purchase-order-approve-return.test.ts`

**Interfaces:**
- Consumes: `notifyAndEmail` (Task 12).
- Produces: `ActionResult = { ok: true } | { ok: false; error: string }`, `async approvePurchaseOrderStep(orderId: string): Promise<ActionResult>`, `async returnPurchaseOrderStep(orderId: string, reason: string): Promise<ActionResult>`. Same shape as `purchase-requests/actions.ts`'s equivalents — `Task 18`'s `ApprovalActions` client component calls these.

- [ ] **Step 1: Write the failing integration test**

`tests/integration/purchase-order-approve-return.test.ts`:
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

describe.skipIf(!hasIntegrationTestCredentials())('purchase order approve/return', () => {
  let admin: ReturnType<typeof createServiceRoleTestClient>;
  let applicantId: string;
  let managerId: string;
  let gmId: string;
  let departmentId: string;
  let supplierId: string;
  const createdCaseIds: string[] = [];
  const createdOrderIds: string[] = [];

  beforeAll(async () => {
    admin = createServiceRoleTestClient();
    const { data: emps } = await admin
      .from('employees')
      .select('id, department_id')
      .not('department_id', 'is', null)
      .limit(3);
    [applicantId, managerId, gmId] = emps!.map((e) => e.id);
    departmentId = emps![0].department_id;
    const { data: sup } = await admin.from('suppliers').select('id').limit(1).single();
    supplierId = sup!.id;
  });

  async function makeOrderWithTwoSteps() {
    const { data: caseNumber } = await admin.rpc('next_case_number');
    const { data: pcase } = await admin
      .from('procurement_cases')
      .insert({ case_number: caseNumber, created_by_employee_id: applicantId })
      .select()
      .single();
    createdCaseIds.push(pcase!.id);
    const { data: order } = await admin
      .from('purchase_orders')
      .insert({
        procurement_case_id: pcase!.id,
        purchase_request_id: null,
        applicant_employee_id: applicantId,
        department_id: departmentId,
        budget_owner_employee_id: applicantId,
        supplier_id: supplierId,
        payment_method: '匯款',
        payment_terms: '貨到付款',
        total_amount: 65000,
        current_step_order: 1,
      })
      .select()
      .single();
    createdOrderIds.push(order!.id);
    await admin.from('approval_steps').insert([
      {
        form_type: 'purchase_order',
        form_id: order!.id,
        step_order: 1,
        approver_employee_id: managerId,
        approver_role: 'department_manager',
      },
      {
        form_type: 'purchase_order',
        form_id: order!.id,
        step_order: 2,
        approver_employee_id: gmId,
        approver_role: 'general_manager',
      },
    ]);
    return order!.id;
  }

  afterEach(async () => {
    currentEmployee.value = null;
    for (const id of createdOrderIds.splice(0)) {
      await admin.from('approval_steps').delete().eq('form_type', 'purchase_order').eq('form_id', id);
      await admin.from('notifications').delete().eq('form_type', 'purchase_order').eq('form_id', id);
      await admin.from('purchase_orders').delete().eq('id', id);
    }
    for (const id of createdCaseIds.splice(0)) {
      await admin.from('procurement_cases').delete().eq('id', id);
    }
  });

  it('rejects an approve call from someone who is not the current approver', async () => {
    const orderId = await makeOrderWithTwoSteps();
    currentEmployee.value = { id: applicantId };
    const { approvePurchaseOrderStep } = await import('@/lib/purchase-orders/actions');
    const result = await approvePurchaseOrderStep(orderId);
    expect(result).toEqual({ ok: false, error: '您不是這張採購單目前的簽核人' });
  });

  it('advances to the next step and notifies the next approver on approve', async () => {
    const orderId = await makeOrderWithTwoSteps();
    currentEmployee.value = { id: managerId };
    const { approvePurchaseOrderStep } = await import('@/lib/purchase-orders/actions');
    const result = await approvePurchaseOrderStep(orderId);
    expect(result).toEqual({ ok: true });

    const { data: order } = await admin
      .from('purchase_orders')
      .select('status, current_step_order')
      .eq('id', orderId)
      .single();
    expect(order).toEqual({ status: 'pending_approval', current_step_order: 2 });

    const { data: notifs } = await admin
      .from('notifications')
      .select('recipient_employee_id, type')
      .eq('form_type', 'purchase_order')
      .eq('form_id', orderId);
    expect(notifs).toEqual([{ recipient_employee_id: gmId, type: 'approval_requested' }]);
  });

  it('marks the order approved and notifies the applicant on the final approve', async () => {
    const orderId = await makeOrderWithTwoSteps();
    currentEmployee.value = { id: managerId };
    const { approvePurchaseOrderStep } = await import('@/lib/purchase-orders/actions');
    await approvePurchaseOrderStep(orderId);
    currentEmployee.value = { id: gmId };
    const result = await approvePurchaseOrderStep(orderId);
    expect(result).toEqual({ ok: true });

    const { data: order } = await admin
      .from('purchase_orders')
      .select('status, current_step_order')
      .eq('id', orderId)
      .single();
    expect(order).toEqual({ status: 'approved', current_step_order: null });
  });

  it('marks the order returned and notifies the applicant with the reason', async () => {
    const orderId = await makeOrderWithTwoSteps();
    currentEmployee.value = { id: managerId };
    const { returnPurchaseOrderStep } = await import('@/lib/purchase-orders/actions');
    const result = await returnPurchaseOrderStep(orderId, '報價單付款條件與費用申請單不一致');
    expect(result).toEqual({ ok: true });

    const { data: order } = await admin
      .from('purchase_orders')
      .select('status, current_step_order')
      .eq('id', orderId)
      .single();
    expect(order).toEqual({ status: 'returned', current_step_order: null });

    const { data: notifs } = await admin
      .from('notifications')
      .select('recipient_employee_id, type, message')
      .eq('form_type', 'purchase_order')
      .eq('form_id', orderId);
    expect(notifs).toEqual([
      {
        recipient_employee_id: applicantId,
        type: 'request_returned',
        message: expect.stringContaining('報價單付款條件與費用申請單不一致'),
      },
    ]);
  });

  it('rejects a return with a blank reason', async () => {
    const orderId = await makeOrderWithTwoSteps();
    currentEmployee.value = { id: managerId };
    const { returnPurchaseOrderStep } = await import('@/lib/purchase-orders/actions');
    const result = await returnPurchaseOrderStep(orderId, '   ');
    expect(result).toEqual({ ok: false, error: '請填寫退回原因' });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `export $(grep -v '^#' .env.local | xargs) && npm test -- tests/integration/purchase-order-approve-return.test.ts`
Expected: FAIL — `approvePurchaseOrderStep is not a function` (not exported yet).

- [ ] **Step 3: Implement the actions**

Append to `src/lib/purchase-orders/actions.ts`:
```ts
export type ActionResult = { ok: true } | { ok: false; error: string };

type LoadStepResult =
  | { error: string }
  | {
      order: { id: string; applicant_employee_id: string; procurement_case_id: string };
      step: { id: string; step_order: number; approver_employee_id: string };
    };

async function loadCurrentStep(
  db: ReturnType<typeof createSupabaseServiceRoleClient>,
  orderId: string,
  callerId: string
): Promise<LoadStepResult> {
  const { data: order } = await db
    .from('purchase_orders')
    .select('id, applicant_employee_id, status, current_step_order, procurement_case_id')
    .eq('id', orderId)
    .maybeSingle();
  if (!order || order.status !== 'pending_approval' || order.current_step_order === null) {
    return { error: '這張採購單目前不在簽核中' };
  }
  const { data: step } = await db
    .from('approval_steps')
    .select('id, step_order, approver_employee_id')
    .eq('form_type', 'purchase_order')
    .eq('form_id', orderId)
    .eq('step_order', order.current_step_order)
    .maybeSingle();
  if (!step || step.approver_employee_id !== callerId) {
    return { error: '您不是這張採購單目前的簽核人' };
  }
  return { order, step };
}

export async function approvePurchaseOrderStep(orderId: string): Promise<ActionResult> {
  const employee = await getCurrentEmployee(await createSupabaseServerClient());
  if (!employee) return { ok: false, error: '找不到您的員工資料' };
  const db = createSupabaseServiceRoleClient();

  const loaded = await loadCurrentStep(db, orderId, employee.id);
  if ('error' in loaded) return { ok: false, error: loaded.error };
  const { order, step } = loaded;

  await db
    .from('approval_steps')
    .update({ status: 'approved', acted_at: new Date().toISOString() })
    .eq('id', step.id);

  await db
    .from('notifications')
    .update({ is_read: true })
    .eq('recipient_employee_id', employee.id)
    .eq('form_type', 'purchase_order')
    .eq('form_id', orderId)
    .eq('type', 'approval_requested')
    .eq('is_read', false);

  const { data: caseRow } = await db
    .from('procurement_cases')
    .select('case_number')
    .eq('id', order.procurement_case_id)
    .single();
  const caseNumber = caseRow!.case_number;

  const { data: nextStep } = await db
    .from('approval_steps')
    .select('step_order, approver_employee_id')
    .eq('form_type', 'purchase_order')
    .eq('form_id', orderId)
    .eq('step_order', step.step_order + 1)
    .maybeSingle();

  if (nextStep) {
    await db
      .from('purchase_orders')
      .update({ current_step_order: nextStep.step_order, updated_at: new Date().toISOString() })
      .eq('id', orderId);
    await notifyAndEmail(db, {
      recipientEmployeeId: nextStep.approver_employee_id,
      type: 'approval_requested',
      formType: 'purchase_order',
      formId: orderId,
      caseNumber,
      message: `採購單 ${caseNumber} 待您簽核`,
    });
  } else {
    await db
      .from('purchase_orders')
      .update({ status: 'approved', current_step_order: null, updated_at: new Date().toISOString() })
      .eq('id', orderId);
    await notifyAndEmail(db, {
      recipientEmployeeId: order.applicant_employee_id,
      type: 'request_approved',
      formType: 'purchase_order',
      formId: orderId,
      caseNumber,
      message: `採購單 ${caseNumber} 已完成簽核`,
    });
  }

  revalidatePath('/approvals');
  revalidatePath(`/purchase-orders/${orderId}`);
  return { ok: true };
}

export async function returnPurchaseOrderStep(orderId: string, reason: string): Promise<ActionResult> {
  const employee = await getCurrentEmployee(await createSupabaseServerClient());
  if (!employee) return { ok: false, error: '找不到您的員工資料' };
  if (reason.trim() === '') return { ok: false, error: '請填寫退回原因' };
  const db = createSupabaseServiceRoleClient();

  const loaded = await loadCurrentStep(db, orderId, employee.id);
  if ('error' in loaded) return { ok: false, error: loaded.error };
  const { order, step } = loaded;

  await db
    .from('approval_steps')
    .update({ status: 'returned', comment: reason, acted_at: new Date().toISOString() })
    .eq('id', step.id);

  await db
    .from('notifications')
    .update({ is_read: true })
    .eq('recipient_employee_id', employee.id)
    .eq('form_type', 'purchase_order')
    .eq('form_id', orderId)
    .eq('type', 'approval_requested')
    .eq('is_read', false);

  await db
    .from('purchase_orders')
    .update({ status: 'returned', current_step_order: null, updated_at: new Date().toISOString() })
    .eq('id', orderId);

  const { data: caseRow } = await db
    .from('procurement_cases')
    .select('case_number')
    .eq('id', order.procurement_case_id)
    .single();

  await notifyAndEmail(db, {
    recipientEmployeeId: order.applicant_employee_id,
    type: 'request_returned',
    formType: 'purchase_order',
    formId: orderId,
    caseNumber: caseRow!.case_number,
    message: `採購單 ${caseRow!.case_number} 已被退回：${reason}`,
  });

  revalidatePath('/approvals');
  revalidatePath(`/purchase-orders/${orderId}`);
  return { ok: true };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `export $(grep -v '^#' .env.local | xargs) && npm test -- tests/integration/purchase-order-approve-return.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/purchase-orders/actions.ts tests/integration/purchase-order-approve-return.test.ts
git commit -m "feat: add approvePurchaseOrderStep and returnPurchaseOrderStep"
```

---

## Task 17: 採購單 — `resubmitPurchaseOrder` action + transactional SQL function

**Files:**
- Create: `supabase/migrations/<timestamp>_resubmit_purchase_order_tx.sql`
- Modify: `src/lib/purchase-orders/actions.ts`
- Test: `tests/integration/purchase-order-resubmit.test.ts`

**Interfaces:**
- Consumes: SQL function `resubmit_purchase_order(...)`.
- Produces: `ResubmitPurchaseOrderInput = { supplierId: string; paymentMethod: string; paymentTerms: string; expectedDeliveryDays: number | null; quoteCount: number; quoteCountReason: string | null; items: { purchaseOrderItemId: string; unitPrice: number }[] }` and `async resubmitPurchaseOrder(orderId: string, input: ResubmitPurchaseOrderInput): Promise<ActionResult>`. Only the applicant of a `status = 'returned'` order may call it; it replaces items and approval steps in one transaction and resets to `pending_approval` / step 1, mirroring `resubmit_purchase_request`.

- [ ] **Step 1: Write the failing integration test**

`tests/integration/purchase-order-resubmit.test.ts`:
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

describe.skipIf(!hasIntegrationTestCredentials())('resubmitPurchaseOrder', () => {
  let admin: ReturnType<typeof createServiceRoleTestClient>;
  let applicantId: string;
  let departmentId: string;
  let managerId: string;
  let budgetCodeId: string;
  let supplierId: string;
  const createdCaseIds: string[] = [];
  const createdOrderIds: string[] = [];

  beforeAll(async () => {
    admin = createServiceRoleTestClient();
    const { data: emps } = await admin
      .from('employees')
      .select('id, department_id')
      .not('department_id', 'is', null)
      .limit(2);
    applicantId = emps![0].id;
    managerId = emps![1].id;
    departmentId = emps![0].department_id;
    const { data: bc } = await admin.from('budget_codes').select('id').limit(1).single();
    budgetCodeId = bc!.id;
    const { data: sup } = await admin.from('suppliers').select('id').limit(1).single();
    supplierId = sup!.id;
  });

  afterEach(async () => {
    currentEmployee.value = null;
    for (const id of createdOrderIds.splice(0)) {
      await admin.from('approval_steps').delete().eq('form_type', 'purchase_order').eq('form_id', id);
      await admin.from('notifications').delete().eq('form_type', 'purchase_order').eq('form_id', id);
      await admin.from('purchase_orders').delete().eq('id', id);
    }
    for (const id of createdCaseIds.splice(0)) {
      await admin.from('procurement_cases').delete().eq('id', id);
    }
  });

  it('replaces items and approval steps and resets to pending_approval on resubmit', async () => {
    const { data: caseNumber } = await admin.rpc('next_case_number');
    const { data: pcase } = await admin
      .from('procurement_cases')
      .insert({ case_number: caseNumber, created_by_employee_id: applicantId })
      .select()
      .single();
    createdCaseIds.push(pcase!.id);
    const { data: order } = await admin
      .from('purchase_orders')
      .insert({
        procurement_case_id: pcase!.id,
        purchase_request_id: null,
        applicant_employee_id: applicantId,
        department_id: departmentId,
        budget_owner_employee_id: applicantId,
        supplier_id: supplierId,
        payment_method: '匯款',
        payment_terms: '貨到付款',
        quote_count: 1,
        total_amount: 65000,
        status: 'returned',
      })
      .select()
      .single();
    createdOrderIds.push(order!.id);
    const { data: item } = await admin
      .from('purchase_order_items')
      .insert({
        purchase_order_id: order!.id,
        line_no: 1,
        budget_code_id: budgetCodeId,
        item_category: '材料',
        description: '材料A',
        quantity: 2,
        unit_price: 32500,
        total_price: 65000,
      })
      .select()
      .single();
    await admin.from('departments').update({ manager_employee_id: managerId }).eq('id', departmentId);

    currentEmployee.value = { id: applicantId };
    const { resubmitPurchaseOrder } = await import('@/lib/purchase-orders/actions');
    const result = await resubmitPurchaseOrder(order!.id, {
      supplierId,
      paymentMethod: '匯款',
      paymentTerms: '月結30天',
      expectedDeliveryDays: 21,
      quoteCount: 2,
      quoteCountReason: null,
      items: [{ purchaseOrderItemId: item!.id, unitPrice: 40000 }],
    });
    expect(result).toEqual({ ok: true });

    const { data: updated } = await admin
      .from('purchase_orders')
      .select('status, current_step_order, payment_terms, total_amount')
      .eq('id', order!.id)
      .single();
    expect(updated!.status).toBe('pending_approval');
    expect(updated!.current_step_order).toBe(1);
    expect(updated!.payment_terms).toBe('月結30天');
    expect(Number(updated!.total_amount)).toBe(80000);

    const { data: items } = await admin
      .from('purchase_order_items')
      .select('unit_price, total_price')
      .eq('purchase_order_id', order!.id);
    expect(items).toHaveLength(1);
    expect(Number(items![0].unit_price)).toBe(40000);
  });

  it('rejects a resubmit from someone who is not the applicant', async () => {
    const { data: caseNumber } = await admin.rpc('next_case_number');
    const { data: pcase } = await admin
      .from('procurement_cases')
      .insert({ case_number: caseNumber, created_by_employee_id: applicantId })
      .select()
      .single();
    createdCaseIds.push(pcase!.id);
    const { data: order } = await admin
      .from('purchase_orders')
      .insert({
        procurement_case_id: pcase!.id,
        purchase_request_id: null,
        applicant_employee_id: applicantId,
        department_id: departmentId,
        budget_owner_employee_id: applicantId,
        supplier_id: supplierId,
        payment_method: '匯款',
        payment_terms: '貨到付款',
        status: 'returned',
      })
      .select()
      .single();
    createdOrderIds.push(order!.id);

    currentEmployee.value = { id: managerId };
    const { resubmitPurchaseOrder } = await import('@/lib/purchase-orders/actions');
    const result = await resubmitPurchaseOrder(order!.id, {
      supplierId,
      paymentMethod: '匯款',
      paymentTerms: '貨到付款',
      expectedDeliveryDays: null,
      quoteCount: 1,
      quoteCountReason: '僅一家廠商',
      items: [],
    });
    expect(result).toEqual({ ok: false, error: '只有申請人可以重新送出這張採購單' });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `export $(grep -v '^#' .env.local | xargs) && npm test -- tests/integration/purchase-order-resubmit.test.ts`
Expected: FAIL — `resubmitPurchaseOrder is not a function`.

- [ ] **Step 3: Create and write the SQL transaction function**

Run: `supabase migration new resubmit_purchase_order_tx`. Write:
```sql
create or replace function resubmit_purchase_order(
  p_order_id uuid,
  p_supplier uuid,
  p_payment_method text,
  p_payment_terms text,
  p_expected_delivery_days integer,
  p_quote_count integer,
  p_quote_count_reason text,
  p_total numeric,
  p_items jsonb,
  p_steps jsonb
) returns void
language plpgsql
as $$
begin
  delete from purchase_order_items where purchase_order_id = p_order_id;
  delete from approval_steps
    where form_type = 'purchase_order' and form_id = p_order_id;

  insert into purchase_order_items
    (purchase_order_id, line_no, budget_code_id, item_category, description, quantity, unit_price, total_price)
  select p_order_id,
         (e->>'line_no')::int,
         (e->>'budget_code_id')::uuid,
         e->>'item_category',
         e->>'description',
         (e->>'quantity')::int,
         (e->>'unit_price')::numeric,
         (e->>'total_price')::numeric
  from jsonb_array_elements(p_items) e;

  insert into approval_steps
    (form_type, form_id, step_order, approver_employee_id, approver_role)
  select 'purchase_order',
         p_order_id,
         (s->>'step_order')::int,
         (s->>'approver_employee_id')::uuid,
         s->>'approver_role'
  from jsonb_array_elements(p_steps) s;

  update purchase_orders
     set supplier_id = p_supplier,
         payment_method = p_payment_method,
         payment_terms = p_payment_terms,
         expected_delivery_days = p_expected_delivery_days,
         quote_count = p_quote_count,
         quote_count_reason = p_quote_count_reason,
         total_amount = p_total,
         status = 'pending_approval',
         current_step_order = 1,
         updated_at = now()
   where id = p_order_id;
end;
$$;
```

- [ ] **Step 4: Apply the migration**

Run: `export $(grep -v '^#' .env.local | xargs) && supabase db push`

- [ ] **Step 5: Implement `resubmitPurchaseOrder`**

Append to `src/lib/purchase-orders/actions.ts`:
```ts
export type ResubmitPurchaseOrderInput = {
  supplierId: string;
  paymentMethod: string;
  paymentTerms: string;
  expectedDeliveryDays: number | null;
  quoteCount: number;
  quoteCountReason: string | null;
  items: { purchaseOrderItemId: string; unitPrice: number }[];
};

export async function resubmitPurchaseOrder(
  orderId: string,
  input: ResubmitPurchaseOrderInput
): Promise<ActionResult> {
  const employee = await getCurrentEmployee(await createSupabaseServerClient());
  if (!employee) return { ok: false, error: '找不到您的員工資料' };
  const db = createSupabaseServiceRoleClient();

  const { data: order } = await db
    .from('purchase_orders')
    .select(
      'id, applicant_employee_id, status, department_id, budget_owner_employee_id, procurement_case_id'
    )
    .eq('id', orderId)
    .maybeSingle();
  if (!order) return { ok: false, error: '找不到這張採購單' };
  if (order.applicant_employee_id !== employee.id) {
    return { ok: false, error: '只有申請人可以重新送出這張採購單' };
  }
  if (order.status !== 'returned') {
    return { ok: false, error: '只有被退回的採購單可以重新送出' };
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
    return { ok: false, error: '重新送出後找不到適用的簽核人，請聯絡系統管理員' };
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
  if (txError) return { ok: false, error: '重新送出失敗，請稍後再試' };

  const { data: caseRow } = await db
    .from('procurement_cases')
    .select('case_number')
    .eq('id', order.procurement_case_id)
    .single();
  await notifyAndEmail(db, {
    recipientEmployeeId: chain[0].approverEmployeeId,
    type: 'approval_requested',
    formType: 'purchase_order',
    formId: orderId,
    caseNumber: caseRow!.case_number,
    message: `採購單 ${caseRow!.case_number} 已重新送出，待您簽核`,
  });

  revalidatePath('/approvals');
  revalidatePath(`/purchase-orders/${orderId}`);
  return { ok: true };
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `export $(grep -v '^#' .env.local | xargs) && npm test -- tests/integration/purchase-order-resubmit.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations src/lib/purchase-orders/actions.ts tests/integration/purchase-order-resubmit.test.ts
git commit -m "feat: add resubmitPurchaseOrder and its transactional SQL function"
```

---

## Task 18: 採購單 — query helpers + pages

**Files:**
- Create: `src/lib/purchase-orders/queries.ts`
- Create: `src/app/purchase-orders/page.tsx`
- Create: `src/app/purchase-orders/new/page.tsx` + `purchase-order-form.tsx` (client)
- Create: `src/app/purchase-orders/[id]/page.tsx` + `approval-actions.tsx` (client)
- Modify: `src/app/requests/[id]/page.tsx` (add a "建立採購單" link when eligible)
- Test: `tests/integration/purchase-order-queries.test.ts`

**Interfaces:**
- Consumes: `createSupabaseServerClient`, `getCurrentEmployee`, `AttachmentsPanel` (Task 14), `getAttachments` (Task 13), `createPurchaseOrder`/`approvePurchaseOrderStep`/`returnPurchaseOrderStep` (Tasks 15–16), `classifyItemCategory` (Task 6), `requiredQuoteCount` (Task 7).
- Produces: `OrderSummary = { id, caseNumber, status, totalAmount }`, `OrderDetail = { id, caseNumber, status, totalAmount, supplierName, paymentMethod, paymentTerms, expectedDeliveryDays, quoteCount, quoteCountReason, applicantName, departmentName, currentStepOrder, items: OrderDetailItem[], steps: OrderDetailStep[] }`, `EligiblePurchaseRequest = { id, caseNumber, items: { id, description, quantity, budgetCode }[] }`, `OrderQueueItem = { id, caseNumber, applicantName, totalAmount }`, and `getMyPurchaseOrders()`, `getPurchaseOrderDetail(orderId)`, `getEligiblePurchaseRequestsForOrder()`, `getMyPurchaseOrderApprovalQueue()`. Task 27's merged `/approvals` page and dashboard consume `getMyPurchaseOrderApprovalQueue`.

- [ ] **Step 1: Write the failing integration test for the query helpers**

`tests/integration/purchase-order-queries.test.ts`:
```ts
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  createServiceRoleTestClient,
  hasIntegrationTestCredentials,
} from './supabase-test-client';

const currentEmployee = vi.hoisted(() => ({ value: null as null | { id: string } }));
vi.mock('@/lib/auth/current-employee', () => ({
  getCurrentEmployee: async () => currentEmployee.value,
}));
// Route the user-session client used by the queries to the service-role client for
// the test (RLS scoping itself is covered by new-forms-rls.test.ts).
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => {
    const { createServiceRoleTestClient } = await import('./supabase-test-client');
    return createServiceRoleTestClient();
  },
}));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

describe.skipIf(!hasIntegrationTestCredentials())('purchase order queries', () => {
  let admin: ReturnType<typeof createServiceRoleTestClient>;
  let applicantId: string;
  let departmentId: string;
  let budgetCodeId: string;
  let supplierId: string;
  let requestId: string;
  let orderId: string;

  beforeAll(async () => {
    admin = createServiceRoleTestClient();
    const { data: emp } = await admin
      .from('employees')
      .select('id, department_id')
      .not('department_id', 'is', null)
      .limit(1)
      .single();
    applicantId = emp!.id;
    departmentId = emp!.department_id;
    const { data: bc } = await admin.from('budget_codes').select('id').limit(1).single();
    budgetCodeId = bc!.id;
    const { data: sup } = await admin.from('suppliers').select('id').limit(1).single();
    supplierId = sup!.id;

    const { data: caseNumber } = await admin.rpc('next_case_number');
    const { data: pcase } = await admin
      .from('procurement_cases')
      .insert({ case_number: caseNumber, created_by_employee_id: applicantId })
      .select()
      .single();
    const { data: pr } = await admin
      .from('purchase_requests')
      .insert({
        procurement_case_id: pcase!.id,
        applicant_employee_id: applicantId,
        department_id: departmentId,
        budget_owner_employee_id: applicantId,
        status: 'approved',
      })
      .select()
      .single();
    requestId = pr!.id;
    const { data: prItem } = await admin
      .from('purchase_request_items')
      .insert({
        purchase_request_id: requestId,
        line_no: 1,
        budget_code_id: budgetCodeId,
        item_category: '材料',
        description: '查詢測試',
        quantity: 1,
      })
      .select()
      .single();

    currentEmployee.value = { id: applicantId };
    const actions = await import('@/lib/purchase-orders/actions');
    const created = await actions.createPurchaseOrder({
      purchaseRequestId: requestId,
      supplierId,
      paymentMethod: '匯款',
      paymentTerms: '貨到付款',
      expectedDeliveryDays: 14,
      quoteCount: 1,
      quoteCountReason: '僅一家廠商',
      items: [{ purchaseRequestItemId: prItem!.id, unitPrice: 5000 }],
    });
    if (!created.ok) throw new Error(created.error);
    orderId = created.orderId;
  });

  afterAll(async () => {
    await admin.from('approval_steps').delete().eq('form_id', orderId);
    await admin.from('notifications').delete().eq('form_id', orderId);
    await admin.from('purchase_orders').delete().eq('id', orderId);
    const { data: pr } = await admin
      .from('purchase_requests')
      .select('procurement_case_id')
      .eq('id', requestId)
      .maybeSingle();
    await admin.from('purchase_requests').delete().eq('id', requestId);
    if (pr?.procurement_case_id) {
      await admin.from('procurement_cases').delete().eq('id', pr.procurement_case_id);
    }
    currentEmployee.value = null;
  });

  it('getMyPurchaseOrders returns the applicant’s order', async () => {
    currentEmployee.value = { id: applicantId };
    const { getMyPurchaseOrders } = await import('@/lib/purchase-orders/queries');
    const rows = await getMyPurchaseOrders();
    expect(rows.some((r) => r.id === orderId)).toBe(true);
  });

  it('getPurchaseOrderDetail returns items and steps', async () => {
    const { getPurchaseOrderDetail } = await import('@/lib/purchase-orders/queries');
    const detail = await getPurchaseOrderDetail(orderId);
    expect(detail).not.toBeNull();
    expect(detail!.items).toHaveLength(1);
    expect(detail!.items[0].description).toBe('查詢測試');
    expect(detail!.steps.length).toBeGreaterThanOrEqual(1);
  });

  it('getEligiblePurchaseRequestsForOrder excludes a request that already has an order', async () => {
    const { getEligiblePurchaseRequestsForOrder } = await import('@/lib/purchase-orders/queries');
    const eligible = await getEligiblePurchaseRequestsForOrder();
    expect(eligible.some((r) => r.id === requestId)).toBe(false);
  });

  it('getMyPurchaseOrderApprovalQueue returns orders pending the caller', async () => {
    const { data: step } = await admin
      .from('approval_steps')
      .select('approver_employee_id')
      .eq('form_type', 'purchase_order')
      .eq('form_id', orderId)
      .eq('step_order', 1)
      .single();
    currentEmployee.value = { id: step!.approver_employee_id };
    const { getMyPurchaseOrderApprovalQueue } = await import('@/lib/purchase-orders/queries');
    const queue = await getMyPurchaseOrderApprovalQueue();
    expect(queue.some((q) => q.id === orderId)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `export $(grep -v '^#' .env.local | xargs) && npm test -- tests/integration/purchase-order-queries.test.ts`
Expected: FAIL — `Cannot find module '@/lib/purchase-orders/queries'`.

- [ ] **Step 3: Implement the query helpers**

`src/lib/purchase-orders/queries.ts`:
```ts
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getCurrentEmployee } from '@/lib/auth/current-employee';

export type OrderSummary = {
  id: string;
  caseNumber: string;
  status: string;
  totalAmount: number;
};

export type OrderDetailItem = {
  lineNo: number;
  budgetCode: string;
  itemCategory: string;
  description: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
};

export type OrderDetailStep = {
  stepOrder: number;
  approverEmployeeId: string;
  approverName: string;
  approverRole: string;
  status: string;
  comment: string | null;
};

export type OrderDetail = {
  id: string;
  caseNumber: string;
  status: string;
  totalAmount: number;
  supplierName: string;
  paymentMethod: string;
  paymentTerms: string;
  expectedDeliveryDays: number | null;
  quoteCount: number;
  quoteCountReason: string | null;
  applicantName: string;
  departmentName: string;
  currentStepOrder: number | null;
  purchaseRequestId: string;
  items: OrderDetailItem[];
  steps: OrderDetailStep[];
};

export type EligiblePurchaseRequestItem = {
  id: string;
  description: string;
  quantity: number;
  budgetCode: string;
};

export type EligiblePurchaseRequest = {
  id: string;
  caseNumber: string;
  items: EligiblePurchaseRequestItem[];
};

export type OrderQueueItem = {
  id: string;
  caseNumber: string;
  applicantName: string;
  totalAmount: number;
};

export async function getMyPurchaseOrders(): Promise<OrderSummary[]> {
  const supabase = await createSupabaseServerClient();
  const employee = await getCurrentEmployee(supabase);
  if (!employee) return [];
  const { data } = await supabase
    .from('purchase_orders')
    .select('id, total_amount, status, procurement_cases(case_number)')
    .eq('applicant_employee_id', employee.id)
    .order('created_at', { ascending: false });
  return (data ?? []).map((o) => ({
    id: o.id,
    caseNumber: (o.procurement_cases as unknown as { case_number: string }).case_number,
    status: o.status,
    totalAmount: Number(o.total_amount),
  }));
}

export async function getPurchaseOrderDetail(orderId: string): Promise<OrderDetail | null> {
  const supabase = await createSupabaseServerClient();
  const { data: order } = await supabase
    .from('purchase_orders')
    .select(
      'id, purchase_request_id, total_amount, status, payment_method, payment_terms, expected_delivery_days, quote_count, quote_count_reason, current_step_order, procurement_cases(case_number), applicant:employees!applicant_employee_id(name), departments(name), suppliers(name)'
    )
    .eq('id', orderId)
    .maybeSingle();
  if (!order) return null;

  const { data: items } = await supabase
    .from('purchase_order_items')
    .select('line_no, item_category, description, quantity, unit_price, total_price, budget_codes(code)')
    .eq('purchase_order_id', orderId)
    .order('line_no');

  const { data: steps } = await supabase
    .from('approval_steps')
    .select(
      'step_order, approver_role, status, comment, approver_employee_id, approver:employees!approver_employee_id(name)'
    )
    .eq('form_type', 'purchase_order')
    .eq('form_id', orderId)
    .order('step_order');

  return {
    id: order.id,
    caseNumber: (order.procurement_cases as unknown as { case_number: string }).case_number,
    status: order.status,
    totalAmount: Number(order.total_amount),
    supplierName: (order.suppliers as unknown as { name: string }).name,
    paymentMethod: order.payment_method,
    paymentTerms: order.payment_terms,
    expectedDeliveryDays: order.expected_delivery_days,
    quoteCount: order.quote_count,
    quoteCountReason: order.quote_count_reason,
    applicantName: (order.applicant as unknown as { name: string }).name,
    departmentName: (order.departments as unknown as { name: string }).name,
    currentStepOrder: order.current_step_order,
    purchaseRequestId: order.purchase_request_id,
    items: (items ?? []).map((i) => ({
      lineNo: i.line_no,
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
}

export async function getEligiblePurchaseRequestsForOrder(): Promise<EligiblePurchaseRequest[]> {
  const supabase = await createSupabaseServerClient();
  const employee = await getCurrentEmployee(supabase);
  if (!employee) return [];

  const { data: requests } = await supabase
    .from('purchase_requests')
    .select('id, procurement_cases(case_number)')
    .eq('applicant_employee_id', employee.id)
    .eq('status', 'approved');
  if (!requests || requests.length === 0) return [];

  const { data: existingOrders } = await supabase
    .from('purchase_orders')
    .select('purchase_request_id')
    .in(
      'purchase_request_id',
      requests.map((r) => r.id)
    );
  const takenIds = new Set((existingOrders ?? []).map((o) => o.purchase_request_id));
  const remaining = requests.filter((r) => !takenIds.has(r.id));

  const result: EligiblePurchaseRequest[] = [];
  for (const r of remaining) {
    const { data: items } = await supabase
      .from('purchase_request_items')
      .select('id, description, quantity, budget_codes(code)')
      .eq('purchase_request_id', r.id)
      .order('line_no');
    result.push({
      id: r.id,
      caseNumber: (r.procurement_cases as unknown as { case_number: string }).case_number,
      items: (items ?? []).map((i) => ({
        id: i.id,
        description: i.description,
        quantity: i.quantity,
        budgetCode: (i.budget_codes as unknown as { code: string }).code,
      })),
    });
  }
  return result;
}

export async function getMyPurchaseOrderApprovalQueue(): Promise<OrderQueueItem[]> {
  const supabase = await createSupabaseServerClient();
  const employee = await getCurrentEmployee(supabase);
  if (!employee) return [];
  const { data: steps } = await supabase
    .from('approval_steps')
    .select('form_id, step_order')
    .eq('form_type', 'purchase_order')
    .eq('approver_employee_id', employee.id)
    .eq('status', 'pending');
  const formIds = (steps ?? []).map((s) => s.form_id);
  if (formIds.length === 0) return [];
  const { data: orders } = await supabase
    .from('purchase_orders')
    .select(
      'id, total_amount, current_step_order, status, procurement_cases(case_number), applicant:employees!applicant_employee_id(name)'
    )
    .in('id', formIds)
    .eq('status', 'pending_approval');
  const stepOrderByForm = new Map((steps ?? []).map((s) => [s.form_id, s.step_order]));
  return (orders ?? [])
    .filter((o) => o.current_step_order === stepOrderByForm.get(o.id))
    .map((o) => ({
      id: o.id,
      caseNumber: (o.procurement_cases as unknown as { case_number: string }).case_number,
      applicantName: (o.applicant as unknown as { name: string }).name,
      totalAmount: Number(o.total_amount),
    }));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `export $(grep -v '^#' .env.local | xargs) && npm test -- tests/integration/purchase-order-queries.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Write the list page**

`src/app/purchase-orders/page.tsx`:
```tsx
import Link from 'next/link';
import { getMyPurchaseOrders } from '@/lib/purchase-orders/queries';

const STATUS_LABELS: Record<string, string> = {
  pending_approval: '簽核中',
  approved: '已核准',
  returned: '已退回（待修改）',
};

export default async function PurchaseOrdersPage() {
  const orders = await getMyPurchaseOrders();
  return (
    <main className="mx-auto max-w-4xl p-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">我的採購單</h1>
        <Link href="/purchase-orders/new" className="rounded bg-blue-600 px-3 py-1 text-sm text-white">
          + 新增採購單
        </Link>
      </div>
      {orders.length === 0 ? (
        <p className="text-gray-500">尚無採購單。</p>
      ) : (
        <table className="w-full border text-sm">
          <thead>
            <tr className="bg-gray-100">
              <th className="border p-2">案件單號</th>
              <th className="border p-2">狀態</th>
              <th className="border p-2">總計</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id}>
                <td className="border p-2">
                  <Link href={`/purchase-orders/${o.id}`} className="text-blue-600 underline">
                    {o.caseNumber}
                  </Link>
                </td>
                <td className="border p-2">{STATUS_LABELS[o.status] ?? o.status}</td>
                <td className="border p-2 text-right">{o.totalAmount.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
```

- [ ] **Step 6: Write the create page + form**

`src/app/purchase-orders/new/page.tsx`:
```tsx
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { getEligiblePurchaseRequestsForOrder } from '@/lib/purchase-orders/queries';
import { PurchaseOrderForm } from './purchase-order-form';

export default async function NewPurchaseOrderPage({
  searchParams,
}: {
  searchParams: Promise<{ requestId?: string }>;
}) {
  const { requestId } = await searchParams;
  const supabase = await createSupabaseServerClient();
  const employee = await getCurrentEmployee(supabase);
  if (!employee) redirect('/login');

  const eligible = await getEligiblePurchaseRequestsForOrder();

  if (!requestId) {
    return (
      <main className="mx-auto max-w-2xl p-8">
        <h1 className="mb-6 text-2xl font-bold">新增採購單</h1>
        {eligible.length === 0 ? (
          <p className="text-gray-500">目前沒有已核准、尚未建立採購單的請購單。</p>
        ) : (
          <ul className="space-y-2">
            {eligible.map((r) => (
              <li key={r.id}>
                <a href={`/purchase-orders/new?requestId=${r.id}`} className="text-blue-600 underline">
                  {r.caseNumber}
                </a>
              </li>
            ))}
          </ul>
        )}
      </main>
    );
  }

  const selected = eligible.find((r) => r.id === requestId);
  if (!selected) redirect('/purchase-orders/new');

  const { data: suppliers } = await supabase.from('suppliers').select('id, name').order('name');

  return (
    <main className="mx-auto max-w-4xl p-8">
      <h1 className="mb-2 text-2xl font-bold">新增採購單</h1>
      <p className="mb-6 font-mono text-gray-600">{selected.caseNumber}</p>
      <PurchaseOrderForm
        purchaseRequestId={selected.id}
        items={selected.items}
        suppliers={(suppliers ?? []).map((s) => ({ id: s.id, name: s.name }))}
      />
    </main>
  );
}
```

`src/app/purchase-orders/new/purchase-order-form.tsx`:
```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createPurchaseOrder } from '@/lib/purchase-orders/actions';
import { classifyItemCategory } from '@/lib/procurement/item-category';
import { requiredQuoteCount } from '@/lib/procurement/quote-requirement';

const PAYMENT_TERMS_OPTIONS = ['預付款', '貨到付款', '月結30天', '月結45天', '月結60天', '其他'];

export function PurchaseOrderForm({
  purchaseRequestId,
  items,
  suppliers,
}: {
  purchaseRequestId: string;
  items: { id: string; description: string; quantity: number; budgetCode: string }[];
  suppliers: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id ?? '');
  const [paymentMethod, setPaymentMethod] = useState('匯款');
  const [paymentTerms, setPaymentTerms] = useState('貨到付款');
  const [expectedDeliveryDays, setExpectedDeliveryDays] = useState('14');
  const [quoteCount, setQuoteCount] = useState('1');
  const [quoteCountReason, setQuoteCountReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const total = items.reduce((sum, i) => sum + (Number(prices[i.id] ?? 0) || 0) * i.quantity, 0);
  const required = requiredQuoteCount(total);

  const onSubmit = async () => {
    setError(null);
    setSubmitting(true);
    const result = await createPurchaseOrder({
      purchaseRequestId,
      supplierId,
      paymentMethod,
      paymentTerms,
      expectedDeliveryDays: expectedDeliveryDays === '' ? null : Number(expectedDeliveryDays),
      quoteCount: Number(quoteCount),
      quoteCountReason: quoteCountReason.trim() === '' ? null : quoteCountReason,
      items: items.map((i) => ({
        purchaseRequestItemId: i.id,
        unitPrice: Number(prices[i.id] ?? 0),
      })),
    });
    setSubmitting(false);
    if (result.ok) {
      router.push(`/purchase-orders/${result.orderId}`);
    } else {
      setError(result.error);
    }
  };

  return (
    <div className="space-y-4">
      <label className="block text-sm">
        預計採購廠商：
        <select
          value={supplierId}
          onChange={(e) => setSupplierId(e.target.value)}
          className="ml-2 rounded border px-2 py-1"
        >
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm">
        付款方式：
        <input
          value={paymentMethod}
          onChange={(e) => setPaymentMethod(e.target.value)}
          className="ml-2 rounded border px-2 py-1"
        />
      </label>
      <label className="block text-sm">
        付款條件：
        <select
          value={paymentTerms}
          onChange={(e) => setPaymentTerms(e.target.value)}
          className="ml-2 rounded border px-2 py-1"
        >
          {PAYMENT_TERMS_OPTIONS.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm">
        預計交貨天數：
        <input
          type="number"
          value={expectedDeliveryDays}
          onChange={(e) => setExpectedDeliveryDays(e.target.value)}
          className="ml-2 w-24 rounded border px-2 py-1"
        />
      </label>

      {items.map((item) => {
        const unitPrice = Number(prices[item.id] ?? 0) || 0;
        const untaxedAmount = unitPrice * item.quantity;
        const category = classifyItemCategory({ untaxedAmount, soldWithVehicle: false });
        return (
          <div key={item.id} className="space-y-1 rounded border p-3">
            <p className="text-sm">
              {item.budgetCode}｜{item.description}｜數量 {item.quantity}
            </p>
            <input
              type="number"
              value={prices[item.id] ?? ''}
              onChange={(e) => setPrices((prev) => ({ ...prev, [item.id]: e.target.value }))}
              placeholder="單價"
              className="w-32 rounded border px-2 py-1"
            />
            {category === '設備' && untaxedAmount > 0 && (
              <p className="text-xs text-amber-600">
                提醒：未稅金額達 80,000 以上、且非隨車出售者，項目應選「設備」。
              </p>
            )}
          </div>
        );
      })}

      <label className="block text-sm">
        報價單家數：
        <input
          type="number"
          value={quoteCount}
          onChange={(e) => setQuoteCount(e.target.value)}
          className="ml-2 w-20 rounded border px-2 py-1"
        />
        <span className="ml-2 text-xs text-gray-500">
          依採購金額 NT$ {total.toLocaleString()}，門檻為 {required} 家
        </span>
      </label>
      {Number(quoteCount) < required && (
        <label className="block text-sm">
          未檢附其他報價單原因：
          <input
            value={quoteCountReason}
            onChange={(e) => setQuoteCountReason(e.target.value)}
            className="ml-2 w-full rounded border px-2 py-1"
          />
        </label>
      )}

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

- [ ] **Step 7: Write the detail page + approval actions**

`src/app/purchase-orders/[id]/approval-actions.tsx`:
```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { approvePurchaseOrderStep, returnPurchaseOrderStep } from '@/lib/purchase-orders/actions';

export function ApprovalActions({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onApprove = async () => {
    setBusy(true);
    setError(null);
    const result = await approvePurchaseOrderStep(orderId);
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
    const result = await returnPurchaseOrderStep(orderId, reason);
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

`src/app/purchase-orders/[id]/page.tsx`:
```tsx
import { notFound } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { getPurchaseOrderDetail } from '@/lib/purchase-orders/queries';
import { getAttachments } from '@/lib/attachments/queries';
import { AttachmentsPanel } from '@/app/components/attachments-panel';
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

export default async function PurchaseOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const detail = await getPurchaseOrderDetail(id);
  if (!detail) notFound();

  const supabase = await createSupabaseServerClient();
  const employee = await getCurrentEmployee(supabase);
  const attachments = await getAttachments('purchase_order', id);

  const currentStep =
    detail.status === 'pending_approval' && detail.currentStepOrder !== null
      ? detail.steps.find((s) => s.stepOrder === detail.currentStepOrder)
      : undefined;
  const isCurrentApprover =
    !!employee && !!currentStep && currentStep.approverEmployeeId === employee.id;

  return (
    <main className="mx-auto max-w-4xl space-y-4 p-8">
      <div>
        <h1 className="mb-1 text-2xl font-bold">採購單</h1>
        <p className="font-mono text-gray-600">{detail.caseNumber}（項次 B1）</p>
      </div>

      <section className="rounded border p-4 text-sm">
        <p>申請單位：{detail.departmentName}</p>
        <p>申請人：{detail.applicantName}</p>
        <p>預計採購廠商：{detail.supplierName}</p>
        <p>
          付款方式：{detail.paymentMethod}｜付款條件：{detail.paymentTerms}
        </p>
        <p>預計交貨天數：{detail.expectedDeliveryDays ?? '—'}</p>
        <p>
          報價單家數：{detail.quoteCount}
          {detail.quoteCountReason ? `（${detail.quoteCountReason}）` : ''}
        </p>
        <p>狀態：{STATUS_LABELS[detail.status] ?? detail.status}</p>
        <p>總計：NT$ {detail.totalAmount.toLocaleString()}</p>
      </section>

      <table className="w-full border text-sm">
        <thead>
          <tr className="bg-gray-100">
            <th className="border p-2">項次</th>
            <th className="border p-2">預算編號</th>
            <th className="border p-2">項目</th>
            <th className="border p-2">說明</th>
            <th className="border p-2">數量</th>
            <th className="border p-2">單價</th>
            <th className="border p-2">總價</th>
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
              <td className="border p-2 text-right">{i.unitPrice.toLocaleString()}</td>
              <td className="border p-2 text-right">{i.totalPrice.toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <section>
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

      <AttachmentsPanel formType="purchase_order" formId={id} attachments={attachments} />

      {isCurrentApprover && <ApprovalActions orderId={detail.id} />}
    </main>
  );
}
```

- [ ] **Step 8: Add a "建立採購單" link on the 請購單 detail page when eligible**

In `src/app/requests/[id]/page.tsx`, add the import:
```ts
import Link from 'next/link';
```
and, immediately after the closing `</section>` of the 簽核流程 section (before `{isCurrentApprover && <ApprovalActions requestId={detail.id} />}`), add:
```tsx
      {detail.status === 'approved' && (
        <p>
          <Link href={`/purchase-orders/new?requestId=${detail.id}`} className="text-blue-600 underline">
            建立採購單
          </Link>
        </p>
      )}
```

- [ ] **Step 9: Commit**

```bash
git add src/lib/purchase-orders/queries.ts src/app/purchase-orders src/app/requests/[id]/page.tsx tests/integration/purchase-order-queries.test.ts
git commit -m "feat: add purchase order queries and pages"
```

---

## Task 19: 驗收單 — `validateAcceptanceInput()` + `createAcceptance` action

**Files:**
- Create: `src/lib/acceptances/validate.ts` + `.test.ts`
- Create: `src/lib/acceptances/actions.ts`
- Test: `tests/integration/acceptance-create.test.ts`

**Interfaces:**
- Consumes: `buildApprovalChainForForm` (Task 10), `notifyAndEmail` (Task 12).
- Produces: `validateAcceptanceInput(input: { items: { passFail: 'pass' | 'fail' }[] }): ValidationResult`; `NewAcceptanceItem = { purchaseOrderItemId: string; passFail: 'pass' | 'fail' }`, `NewAcceptance = { purchaseOrderId: string; contractorSupplierId: string; acceptanceDate: string; items: NewAcceptanceItem[] }`, `CreateResult = { ok: true; acceptanceId: string; caseNumber: string } | { ok: false; error: string }`, and `async createAcceptance(input: NewAcceptance): Promise<CreateResult>`. Task 20 (approve/return + property-tag update) and Task 21 (resubmit) live in the same `actions.ts` file.

**Design notes:** items are copied from the source `purchase_order_items` (`amount` = that item's `total_price`, `pass_fail` from the caller). `department_id`/`budget_owner_employee_id`/`total_amount` are inherited from the source `purchase_orders` row (the whole order is either fully accepted-or-not per line; there is no partial-quantity acceptance in this release). Creation is gated: the source order must be `status = 'approved'`, and its `procurement_case_id` must not already have an `acceptances` row.

- [ ] **Step 1: Write the failing test for `validateAcceptanceInput`**

`src/lib/acceptances/validate.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { validateAcceptanceInput } from './validate';

describe('validateAcceptanceInput', () => {
  it('accepts a non-empty item list', () => {
    expect(validateAcceptanceInput({ items: [{ passFail: 'pass' }] })).toEqual({ ok: true });
  });

  it('accepts a mix of pass and fail', () => {
    expect(
      validateAcceptanceInput({ items: [{ passFail: 'pass' }, { passFail: 'fail' }] })
    ).toEqual({ ok: true });
  });

  it('rejects an empty item list', () => {
    expect(validateAcceptanceInput({ items: [] })).toEqual({
      ok: false,
      error: '驗收單至少需要一個明細項次',
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/lib/acceptances/validate.test.ts`
Expected: FAIL — `Cannot find module './validate'`.

- [ ] **Step 3: Implement `validateAcceptanceInput`**

`src/lib/acceptances/validate.ts`:
```ts
export type ValidationResult = { ok: true } | { ok: false; error: string };

export function validateAcceptanceInput(input: {
  items: { passFail: 'pass' | 'fail' }[];
}): ValidationResult {
  if (input.items.length === 0) {
    return { ok: false, error: '驗收單至少需要一個明細項次' };
  }
  return { ok: true };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/lib/acceptances/validate.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Write the failing integration test for `createAcceptance`**

`tests/integration/acceptance-create.test.ts`:
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

describe.skipIf(!hasIntegrationTestCredentials())('createAcceptance', () => {
  let admin: ReturnType<typeof createServiceRoleTestClient>;
  let applicantId: string;
  let departmentId: string;
  let budgetCodeId: string;
  let supplierId: string;
  const createdCaseIds: string[] = [];
  const createdOrderIds: string[] = [];
  const createdAcceptanceIds: string[] = [];

  beforeAll(async () => {
    admin = createServiceRoleTestClient();
    const { data: emp } = await admin
      .from('employees')
      .select('id, department_id')
      .not('department_id', 'is', null)
      .limit(1)
      .single();
    applicantId = emp!.id;
    departmentId = emp!.department_id;
    const { data: bc } = await admin.from('budget_codes').select('id').limit(1).single();
    budgetCodeId = bc!.id;
    const { data: sup } = await admin.from('suppliers').select('id').limit(1).single();
    supplierId = sup!.id;
  });

  async function makeApprovedOrder() {
    const { data: caseNumber } = await admin.rpc('next_case_number');
    const { data: pcase } = await admin
      .from('procurement_cases')
      .insert({ case_number: caseNumber, created_by_employee_id: applicantId })
      .select()
      .single();
    createdCaseIds.push(pcase!.id);
    const { data: po } = await admin
      .from('purchase_orders')
      .insert({
        procurement_case_id: pcase!.id,
        purchase_request_id: null,
        applicant_employee_id: applicantId,
        department_id: departmentId,
        budget_owner_employee_id: applicantId,
        supplier_id: supplierId,
        payment_method: '匯款',
        payment_terms: '貨到付款',
        total_amount: 65000,
        status: 'approved',
      })
      .select()
      .single();
    createdOrderIds.push(po!.id);
    const { data: item } = await admin
      .from('purchase_order_items')
      .insert({
        purchase_order_id: po!.id,
        line_no: 1,
        budget_code_id: budgetCodeId,
        item_category: '材料',
        description: '材料A',
        quantity: 2,
        unit_price: 32500,
        total_price: 65000,
      })
      .select()
      .single();
    return { orderId: po!.id, itemId: item!.id };
  }

  afterEach(async () => {
    currentEmployee.value = null;
    for (const id of createdAcceptanceIds.splice(0)) {
      await admin.from('approval_steps').delete().eq('form_type', 'acceptance').eq('form_id', id);
      await admin.from('notifications').delete().eq('form_type', 'acceptance').eq('form_id', id);
      await admin.from('acceptances').delete().eq('id', id);
    }
    for (const id of createdOrderIds.splice(0)) {
      await admin.from('purchase_orders').delete().eq('id', id);
    }
    for (const id of createdCaseIds.splice(0)) {
      await admin.from('procurement_cases').delete().eq('id', id);
    }
  });

  it('rejects when the source purchase order is not approved', async () => {
    const { data: caseNumber } = await admin.rpc('next_case_number');
    const { data: pcase } = await admin
      .from('procurement_cases')
      .insert({ case_number: caseNumber, created_by_employee_id: applicantId })
      .select()
      .single();
    createdCaseIds.push(pcase!.id);
    const { data: po } = await admin
      .from('purchase_orders')
      .insert({
        procurement_case_id: pcase!.id,
        purchase_request_id: null,
        applicant_employee_id: applicantId,
        department_id: departmentId,
        budget_owner_employee_id: applicantId,
        supplier_id: supplierId,
        payment_method: '匯款',
        payment_terms: '貨到付款',
        status: 'pending_approval',
      })
      .select()
      .single();
    createdOrderIds.push(po!.id);

    currentEmployee.value = { id: applicantId };
    const { createAcceptance } = await import('@/lib/acceptances/actions');
    const result = await createAcceptance({
      purchaseOrderId: po!.id,
      contractorSupplierId: supplierId,
      acceptanceDate: '2026-07-15',
      items: [],
    });
    expect(result).toEqual({ ok: false, error: '來源採購單尚未核准，無法建立驗收單' });
  });

  it('creates an acceptance copying items and pass/fail from the caller', async () => {
    const { orderId, itemId } = await makeApprovedOrder();
    currentEmployee.value = { id: applicantId };
    const { createAcceptance } = await import('@/lib/acceptances/actions');
    const result = await createAcceptance({
      purchaseOrderId: orderId,
      contractorSupplierId: supplierId,
      acceptanceDate: '2026-07-15',
      items: [{ purchaseOrderItemId: itemId, passFail: 'pass' }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    createdAcceptanceIds.push(result.acceptanceId);

    const { data: acceptance } = await admin
      .from('acceptances')
      .select('total_amount, status')
      .eq('id', result.acceptanceId)
      .single();
    expect(Number(acceptance!.total_amount)).toBe(65000);

    const { data: items } = await admin
      .from('acceptance_items')
      .select('description, quantity, pass_fail')
      .eq('acceptance_id', result.acceptanceId);
    expect(items).toEqual([{ description: '材料A', quantity: 2, pass_fail: 'pass' }]);
  });

  it('rejects a second acceptance for the same case', async () => {
    const { orderId, itemId } = await makeApprovedOrder();
    currentEmployee.value = { id: applicantId };
    const { createAcceptance } = await import('@/lib/acceptances/actions');
    const first = await createAcceptance({
      purchaseOrderId: orderId,
      contractorSupplierId: supplierId,
      acceptanceDate: '2026-07-15',
      items: [{ purchaseOrderItemId: itemId, passFail: 'pass' }],
    });
    if (first.ok) createdAcceptanceIds.push(first.acceptanceId);

    const second = await createAcceptance({
      purchaseOrderId: orderId,
      contractorSupplierId: supplierId,
      acceptanceDate: '2026-07-15',
      items: [{ purchaseOrderItemId: itemId, passFail: 'pass' }],
    });
    expect(second).toEqual({ ok: false, error: '此案件已建立過驗收單' });
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `export $(grep -v '^#' .env.local | xargs) && npm test -- tests/integration/acceptance-create.test.ts`
Expected: FAIL — `Cannot find module '@/lib/acceptances/actions'`.

- [ ] **Step 7: Implement `createAcceptance`**

`src/lib/acceptances/actions.ts`:
```ts
'use server';

import { revalidatePath } from 'next/cache';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { buildApprovalChainForForm } from '@/lib/approval/build-chain';
import { notifyAndEmail } from '@/lib/notifications/notify';
import { validateAcceptanceInput } from '@/lib/acceptances/validate';

export type NewAcceptanceItem = {
  purchaseOrderItemId: string;
  passFail: 'pass' | 'fail';
};

export type NewAcceptance = {
  purchaseOrderId: string;
  contractorSupplierId: string;
  acceptanceDate: string;
  items: NewAcceptanceItem[];
};

export type CreateResult =
  | { ok: true; acceptanceId: string; caseNumber: string }
  | { ok: false; error: string };

export async function createAcceptance(input: NewAcceptance): Promise<CreateResult> {
  const employee = await getCurrentEmployee(await createSupabaseServerClient());
  if (!employee) return { ok: false, error: '找不到您的員工資料，請聯絡系統管理員' };

  const db = createSupabaseServiceRoleClient();

  const { data: po } = await db
    .from('purchase_orders')
    .select('id, procurement_case_id, department_id, budget_owner_employee_id, status, total_amount')
    .eq('id', input.purchaseOrderId)
    .maybeSingle();
  if (!po) return { ok: false, error: '找不到來源採購單' };
  if (po.status !== 'approved') {
    return { ok: false, error: '來源採購單尚未核准，無法建立驗收單' };
  }

  const { data: existing } = await db
    .from('acceptances')
    .select('id')
    .eq('procurement_case_id', po.procurement_case_id)
    .maybeSingle();
  if (existing) return { ok: false, error: '此案件已建立過驗收單' };

  const { data: caseRow } = await db
    .from('procurement_cases')
    .select('case_number')
    .eq('id', po.procurement_case_id)
    .single();
  if (!caseRow) return { ok: false, error: '找不到案件資料' };
  const caseNumber = caseRow.case_number;

  const { data: poItems } = await db
    .from('purchase_order_items')
    .select('id, line_no, description, quantity, total_price')
    .eq('purchase_order_id', po.id)
    .order('line_no');
  if (!poItems || poItems.length === 0) {
    return { ok: false, error: '來源採購單沒有明細項次' };
  }

  const passFailByItemId = new Map(input.items.map((i) => [i.purchaseOrderItemId, i.passFail]));
  if (passFailByItemId.size !== poItems.length || poItems.some((i) => !passFailByItemId.has(i.id))) {
    return { ok: false, error: '請為每一項採購明細填寫驗收結果' };
  }

  const validation = validateAcceptanceInput({
    items: poItems.map((i) => ({ passFail: passFailByItemId.get(i.id)! })),
  });
  if (!validation.ok) return { ok: false, error: validation.error };

  const acceptanceItems = poItems.map((i) => ({
    purchase_order_item_id: i.id,
    line_no: i.line_no,
    description: i.description,
    quantity: i.quantity,
    amount: Number(i.total_price),
    pass_fail: passFailByItemId.get(i.id)!,
  }));
  const totalAmount = Number(po.total_amount);

  const chainResult = await buildApprovalChainForForm(db, {
    applicantEmployeeId: employee.id,
    departmentId: po.department_id,
    budgetOwnerEmployeeId: po.budget_owner_employee_id,
    totalAmount,
  });
  if (!chainResult.ok) return { ok: false, error: chainResult.error };
  const chain = chainResult.chain;

  const isAutoApproved = chain.length === 0;
  const { data: acceptance, error: acceptanceError } = await db
    .from('acceptances')
    .insert({
      procurement_case_id: po.procurement_case_id,
      purchase_order_id: po.id,
      applicant_employee_id: employee.id,
      department_id: po.department_id,
      budget_owner_employee_id: po.budget_owner_employee_id,
      contractor_supplier_id: input.contractorSupplierId,
      acceptance_date: input.acceptanceDate,
      total_amount: totalAmount,
      status: isAutoApproved ? 'approved' : 'pending_approval',
      current_step_order: isAutoApproved ? null : 1,
    })
    .select()
    .single();
  if (acceptanceError || !acceptance) return { ok: false, error: '建立驗收單失敗' };

  const cleanup = async () => {
    await db
      .from('approval_steps')
      .delete()
      .eq('form_type', 'acceptance')
      .eq('form_id', acceptance.id);
    await db
      .from('notifications')
      .delete()
      .eq('form_type', 'acceptance')
      .eq('form_id', acceptance.id);
    await db.from('acceptances').delete().eq('id', acceptance.id);
  };

  const { error: itemsError } = await db
    .from('acceptance_items')
    .insert(acceptanceItems.map((i) => ({ ...i, acceptance_id: acceptance.id })));
  if (itemsError) {
    await cleanup();
    return { ok: false, error: '建立驗收明細失敗' };
  }

  if (!isAutoApproved) {
    const { error: stepsError } = await db.from('approval_steps').insert(
      chain.map((step, idx) => ({
        form_type: 'acceptance',
        form_id: acceptance.id,
        step_order: idx + 1,
        approver_employee_id: step.approverEmployeeId,
        approver_role: step.approverRole,
      }))
    );
    if (stepsError) {
      await cleanup();
      return { ok: false, error: '建立簽核流程失敗' };
    }

    const notifyResult = await notifyAndEmail(db, {
      recipientEmployeeId: chain[0].approverEmployeeId,
      type: 'approval_requested',
      formType: 'acceptance',
      formId: acceptance.id,
      caseNumber,
      message: `驗收單 ${caseNumber} 待您簽核`,
    });
    if (!notifyResult.ok) {
      await cleanup();
      return { ok: false, error: '建立通知失敗' };
    }
  }

  revalidatePath('/acceptances');
  revalidatePath('/approvals');
  return { ok: true, acceptanceId: acceptance.id, caseNumber };
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `export $(grep -v '^#' .env.local | xargs) && npm test -- tests/integration/acceptance-create.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 9: Commit**

```bash
git add src/lib/acceptances tests/integration/acceptance-create.test.ts
git commit -m "feat: add validateAcceptanceInput and createAcceptance"
```

---

## Task 20: 驗收單 — `approveAcceptanceStep` + `returnAcceptanceStep` + 財產編號 update (finance-only)

**Files:**
- Modify: `src/lib/acceptances/actions.ts`
- Test: `tests/integration/acceptance-approve-return.test.ts`

**Interfaces:**
- Consumes: `notifyAndEmail` (Task 12), `CurrentEmployee.role`.
- Produces: `ActionResult`, `async approveAcceptanceStep(acceptanceId: string): Promise<ActionResult>`, `async returnAcceptanceStep(acceptanceId: string, reason: string): Promise<ActionResult>`, `async updateAcceptanceItemPropertyTag(itemId: string, propertyTag: string): Promise<ActionResult>` — the last one restricted to `role === 'finance' || role === 'admin'` (spec: 財產編號「財會填」), callable regardless of the acceptance's approval status.

- [ ] **Step 1: Write the failing integration test**

`tests/integration/acceptance-approve-return.test.ts`:
```ts
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
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

describe.skipIf(!hasIntegrationTestCredentials())('acceptance approve/return + property tag', () => {
  let admin: ReturnType<typeof createServiceRoleTestClient>;
  let applicantId: string;
  let managerId: string;
  let departmentId: string;
  let supplierId: string;
  let budgetCodeId: string;
  const createdCaseIds: string[] = [];
  const createdOrderIds: string[] = [];
  const createdAcceptanceIds: string[] = [];

  beforeAll(async () => {
    admin = createServiceRoleTestClient();
    const { data: emps } = await admin
      .from('employees')
      .select('id, department_id')
      .not('department_id', 'is', null)
      .limit(2);
    applicantId = emps![0].id;
    managerId = emps![1].id;
    departmentId = emps![0].department_id;
    const { data: bc } = await admin.from('budget_codes').select('id').limit(1).single();
    budgetCodeId = bc!.id;
    const { data: sup } = await admin.from('suppliers').select('id').limit(1).single();
    supplierId = sup!.id;
  });

  async function makeAcceptanceWithOneStep() {
    const { data: caseNumber } = await admin.rpc('next_case_number');
    const { data: pcase } = await admin
      .from('procurement_cases')
      .insert({ case_number: caseNumber, created_by_employee_id: applicantId })
      .select()
      .single();
    createdCaseIds.push(pcase!.id);
    const { data: po } = await admin
      .from('purchase_orders')
      .insert({
        procurement_case_id: pcase!.id,
        purchase_request_id: null,
        applicant_employee_id: applicantId,
        department_id: departmentId,
        budget_owner_employee_id: applicantId,
        supplier_id: supplierId,
        payment_method: '匯款',
        payment_terms: '貨到付款',
        total_amount: 65000,
        status: 'approved',
      })
      .select()
      .single();
    createdOrderIds.push(po!.id);
    const { data: poItem } = await admin
      .from('purchase_order_items')
      .insert({
        purchase_order_id: po!.id,
        line_no: 1,
        budget_code_id: budgetCodeId,
        item_category: '材料',
        description: '材料A',
        quantity: 1,
        unit_price: 65000,
        total_price: 65000,
      })
      .select()
      .single();
    const { data: acceptance } = await admin
      .from('acceptances')
      .insert({
        procurement_case_id: pcase!.id,
        purchase_order_id: po!.id,
        applicant_employee_id: applicantId,
        department_id: departmentId,
        budget_owner_employee_id: applicantId,
        contractor_supplier_id: supplierId,
        total_amount: 65000,
        current_step_order: 1,
      })
      .select()
      .single();
    createdAcceptanceIds.push(acceptance!.id);
    const { data: item } = await admin
      .from('acceptance_items')
      .insert({
        acceptance_id: acceptance!.id,
        line_no: 1,
        purchase_order_item_id: poItem!.id,
        description: '材料A',
        quantity: 1,
        amount: 65000,
        pass_fail: 'pass',
      })
      .select()
      .single();
    await admin.from('approval_steps').insert({
      form_type: 'acceptance',
      form_id: acceptance!.id,
      step_order: 1,
      approver_employee_id: managerId,
      approver_role: 'department_manager',
    });
    return { acceptanceId: acceptance!.id, itemId: item!.id };
  }

  afterEach(async () => {
    currentEmployee.value = null;
    for (const id of createdAcceptanceIds.splice(0)) {
      await admin.from('approval_steps').delete().eq('form_type', 'acceptance').eq('form_id', id);
      await admin.from('notifications').delete().eq('form_type', 'acceptance').eq('form_id', id);
      await admin.from('acceptances').delete().eq('id', id);
    }
    for (const id of createdOrderIds.splice(0)) {
      await admin.from('purchase_orders').delete().eq('id', id);
    }
    for (const id of createdCaseIds.splice(0)) {
      await admin.from('procurement_cases').delete().eq('id', id);
    }
  });

  it('marks the acceptance approved and notifies the applicant on the final approve', async () => {
    const { acceptanceId } = await makeAcceptanceWithOneStep();
    currentEmployee.value = { id: managerId, role: 'staff' };
    const { approveAcceptanceStep } = await import('@/lib/acceptances/actions');
    const result = await approveAcceptanceStep(acceptanceId);
    expect(result).toEqual({ ok: true });

    const { data: acceptance } = await admin
      .from('acceptances')
      .select('status, current_step_order')
      .eq('id', acceptanceId)
      .single();
    expect(acceptance).toEqual({ status: 'approved', current_step_order: null });
  });

  it('marks the acceptance returned with a reason', async () => {
    const { acceptanceId } = await makeAcceptanceWithOneStep();
    currentEmployee.value = { id: managerId, role: 'staff' };
    const { returnAcceptanceStep } = await import('@/lib/acceptances/actions');
    const result = await returnAcceptanceStep(acceptanceId, '財產編號待補');
    expect(result).toEqual({ ok: true });

    const { data: acceptance } = await admin
      .from('acceptances')
      .select('status')
      .eq('id', acceptanceId)
      .single();
    expect(acceptance!.status).toBe('returned');
  });

  it('rejects a property-tag update from a non-finance, non-admin employee', async () => {
    const { itemId } = await makeAcceptanceWithOneStep();
    currentEmployee.value = { id: applicantId, role: 'staff' };
    const { updateAcceptanceItemPropertyTag } = await import('@/lib/acceptances/actions');
    const result = await updateAcceptanceItemPropertyTag(itemId, 'PROP-0001');
    expect(result).toEqual({ ok: false, error: '只有財會人員可以填寫財產編號' });
  });

  it('lets finance update the property tag', async () => {
    const { itemId } = await makeAcceptanceWithOneStep();
    currentEmployee.value = { id: applicantId, role: 'finance' };
    const { updateAcceptanceItemPropertyTag } = await import('@/lib/acceptances/actions');
    const result = await updateAcceptanceItemPropertyTag(itemId, 'PROP-0001');
    expect(result).toEqual({ ok: true });

    const { data: item } = await admin
      .from('acceptance_items')
      .select('property_tag')
      .eq('id', itemId)
      .single();
    expect(item!.property_tag).toBe('PROP-0001');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `export $(grep -v '^#' .env.local | xargs) && npm test -- tests/integration/acceptance-approve-return.test.ts`
Expected: FAIL — `approveAcceptanceStep is not a function`.

- [ ] **Step 3: Implement the actions**

Append to `src/lib/acceptances/actions.ts`:
```ts
export type ActionResult = { ok: true } | { ok: false; error: string };

type LoadStepResult =
  | { error: string }
  | {
      acceptance: { id: string; applicant_employee_id: string; procurement_case_id: string };
      step: { id: string; step_order: number; approver_employee_id: string };
    };

async function loadCurrentStep(
  db: ReturnType<typeof createSupabaseServiceRoleClient>,
  acceptanceId: string,
  callerId: string
): Promise<LoadStepResult> {
  const { data: acceptance } = await db
    .from('acceptances')
    .select('id, applicant_employee_id, status, current_step_order, procurement_case_id')
    .eq('id', acceptanceId)
    .maybeSingle();
  if (!acceptance || acceptance.status !== 'pending_approval' || acceptance.current_step_order === null) {
    return { error: '這張驗收單目前不在簽核中' };
  }
  const { data: step } = await db
    .from('approval_steps')
    .select('id, step_order, approver_employee_id')
    .eq('form_type', 'acceptance')
    .eq('form_id', acceptanceId)
    .eq('step_order', acceptance.current_step_order)
    .maybeSingle();
  if (!step || step.approver_employee_id !== callerId) {
    return { error: '您不是這張驗收單目前的簽核人' };
  }
  return { acceptance, step };
}

export async function approveAcceptanceStep(acceptanceId: string): Promise<ActionResult> {
  const employee = await getCurrentEmployee(await createSupabaseServerClient());
  if (!employee) return { ok: false, error: '找不到您的員工資料' };
  const db = createSupabaseServiceRoleClient();

  const loaded = await loadCurrentStep(db, acceptanceId, employee.id);
  if ('error' in loaded) return { ok: false, error: loaded.error };
  const { acceptance, step } = loaded;

  await db
    .from('approval_steps')
    .update({ status: 'approved', acted_at: new Date().toISOString() })
    .eq('id', step.id);

  await db
    .from('notifications')
    .update({ is_read: true })
    .eq('recipient_employee_id', employee.id)
    .eq('form_type', 'acceptance')
    .eq('form_id', acceptanceId)
    .eq('type', 'approval_requested')
    .eq('is_read', false);

  const { data: caseRow } = await db
    .from('procurement_cases')
    .select('case_number')
    .eq('id', acceptance.procurement_case_id)
    .single();
  const caseNumber = caseRow!.case_number;

  const { data: nextStep } = await db
    .from('approval_steps')
    .select('step_order, approver_employee_id')
    .eq('form_type', 'acceptance')
    .eq('form_id', acceptanceId)
    .eq('step_order', step.step_order + 1)
    .maybeSingle();

  if (nextStep) {
    await db
      .from('acceptances')
      .update({ current_step_order: nextStep.step_order, updated_at: new Date().toISOString() })
      .eq('id', acceptanceId);
    await notifyAndEmail(db, {
      recipientEmployeeId: nextStep.approver_employee_id,
      type: 'approval_requested',
      formType: 'acceptance',
      formId: acceptanceId,
      caseNumber,
      message: `驗收單 ${caseNumber} 待您簽核`,
    });
  } else {
    await db
      .from('acceptances')
      .update({ status: 'approved', current_step_order: null, updated_at: new Date().toISOString() })
      .eq('id', acceptanceId);
    await notifyAndEmail(db, {
      recipientEmployeeId: acceptance.applicant_employee_id,
      type: 'request_approved',
      formType: 'acceptance',
      formId: acceptanceId,
      caseNumber,
      message: `驗收單 ${caseNumber} 已完成簽核`,
    });
  }

  revalidatePath('/approvals');
  revalidatePath(`/acceptances/${acceptanceId}`);
  return { ok: true };
}

export async function returnAcceptanceStep(
  acceptanceId: string,
  reason: string
): Promise<ActionResult> {
  const employee = await getCurrentEmployee(await createSupabaseServerClient());
  if (!employee) return { ok: false, error: '找不到您的員工資料' };
  if (reason.trim() === '') return { ok: false, error: '請填寫退回原因' };
  const db = createSupabaseServiceRoleClient();

  const loaded = await loadCurrentStep(db, acceptanceId, employee.id);
  if ('error' in loaded) return { ok: false, error: loaded.error };
  const { acceptance, step } = loaded;

  await db
    .from('approval_steps')
    .update({ status: 'returned', comment: reason, acted_at: new Date().toISOString() })
    .eq('id', step.id);

  await db
    .from('notifications')
    .update({ is_read: true })
    .eq('recipient_employee_id', employee.id)
    .eq('form_type', 'acceptance')
    .eq('form_id', acceptanceId)
    .eq('type', 'approval_requested')
    .eq('is_read', false);

  await db
    .from('acceptances')
    .update({ status: 'returned', current_step_order: null, updated_at: new Date().toISOString() })
    .eq('id', acceptanceId);

  const { data: caseRow } = await db
    .from('procurement_cases')
    .select('case_number')
    .eq('id', acceptance.procurement_case_id)
    .single();

  await notifyAndEmail(db, {
    recipientEmployeeId: acceptance.applicant_employee_id,
    type: 'request_returned',
    formType: 'acceptance',
    formId: acceptanceId,
    caseNumber: caseRow!.case_number,
    message: `驗收單 ${caseRow!.case_number} 已被退回：${reason}`,
  });

  revalidatePath('/approvals');
  revalidatePath(`/acceptances/${acceptanceId}`);
  return { ok: true };
}

export async function updateAcceptanceItemPropertyTag(
  itemId: string,
  propertyTag: string
): Promise<ActionResult> {
  const employee = await getCurrentEmployee(await createSupabaseServerClient());
  if (!employee) return { ok: false, error: '找不到您的員工資料' };
  if (employee.role !== 'finance' && employee.role !== 'admin') {
    return { ok: false, error: '只有財會人員可以填寫財產編號' };
  }
  const db = createSupabaseServiceRoleClient();

  const { data: item } = await db
    .from('acceptance_items')
    .select('acceptance_id')
    .eq('id', itemId)
    .maybeSingle();
  if (!item) return { ok: false, error: '找不到驗收明細' };

  const { error } = await db
    .from('acceptance_items')
    .update({ property_tag: propertyTag })
    .eq('id', itemId);
  if (error) return { ok: false, error: '更新財產編號失敗' };

  revalidatePath(`/acceptances/${item.acceptance_id}`);
  return { ok: true };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `export $(grep -v '^#' .env.local | xargs) && npm test -- tests/integration/acceptance-approve-return.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/acceptances/actions.ts tests/integration/acceptance-approve-return.test.ts
git commit -m "feat: add acceptance approve/return actions and finance-only property-tag update"
```

---

## Task 21: 驗收單 — `resubmitAcceptance` action + transactional SQL function

**Files:**
- Create: `supabase/migrations/<timestamp>_resubmit_acceptance_tx.sql`
- Modify: `src/lib/acceptances/actions.ts`
- Test: `tests/integration/acceptance-resubmit.test.ts`

**Interfaces:**
- Consumes: SQL function `resubmit_acceptance(...)`.
- Produces: `ResubmitAcceptanceInput = { contractorSupplierId: string; acceptanceDate: string; items: { acceptanceItemId: string; passFail: 'pass' | 'fail' }[] }` and `async resubmitAcceptance(acceptanceId: string, input: ResubmitAcceptanceInput): Promise<ActionResult>`.

**Design note:** `department_id`/`budget_owner_employee_id`/`total_amount` are immutable on resubmit (they come from the already-approved source purchase order), so only `contractor_supplier_id`, `acceptance_date`, and each item's `pass_fail` can change. The approval chain is still rebuilt via `buildApprovalChainForForm` (not reused as-is) so a roster change (e.g. a new department manager) since the original submission is picked up. Any `property_tag` already filled in by finance is cleared by the item delete+reinsert — acceptable for the first release because finance only fills `property_tag` after final approval, never while a step is pending or after a return.

- [ ] **Step 1: Write the failing integration test**

`tests/integration/acceptance-resubmit.test.ts`:
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

describe.skipIf(!hasIntegrationTestCredentials())('resubmitAcceptance', () => {
  let admin: ReturnType<typeof createServiceRoleTestClient>;
  let applicantId: string;
  let managerId: string;
  let departmentId: string;
  let budgetCodeId: string;
  let supplierId: string;
  let secondSupplierId: string;
  const createdCaseIds: string[] = [];
  const createdOrderIds: string[] = [];
  const createdAcceptanceIds: string[] = [];

  beforeAll(async () => {
    admin = createServiceRoleTestClient();
    const { data: emps } = await admin
      .from('employees')
      .select('id, department_id')
      .not('department_id', 'is', null)
      .limit(2);
    applicantId = emps![0].id;
    managerId = emps![1].id;
    departmentId = emps![0].department_id;
    const { data: bc } = await admin.from('budget_codes').select('id').limit(1).single();
    budgetCodeId = bc!.id;
    const { data: sups } = await admin.from('suppliers').select('id').limit(2);
    supplierId = sups![0].id;
    secondSupplierId = sups![1]?.id ?? sups![0].id;
    await admin.from('departments').update({ manager_employee_id: managerId }).eq('id', departmentId);
  });

  afterEach(async () => {
    currentEmployee.value = null;
    for (const id of createdAcceptanceIds.splice(0)) {
      await admin.from('approval_steps').delete().eq('form_type', 'acceptance').eq('form_id', id);
      await admin.from('notifications').delete().eq('form_type', 'acceptance').eq('form_id', id);
      await admin.from('acceptances').delete().eq('id', id);
    }
    for (const id of createdOrderIds.splice(0)) {
      await admin.from('purchase_orders').delete().eq('id', id);
    }
    for (const id of createdCaseIds.splice(0)) {
      await admin.from('procurement_cases').delete().eq('id', id);
    }
  });

  it('replaces items and approval steps and resets to pending_approval on resubmit', async () => {
    const { data: caseNumber } = await admin.rpc('next_case_number');
    const { data: pcase } = await admin
      .from('procurement_cases')
      .insert({ case_number: caseNumber, created_by_employee_id: applicantId })
      .select()
      .single();
    createdCaseIds.push(pcase!.id);
    const { data: po } = await admin
      .from('purchase_orders')
      .insert({
        procurement_case_id: pcase!.id,
        purchase_request_id: null,
        applicant_employee_id: applicantId,
        department_id: departmentId,
        budget_owner_employee_id: applicantId,
        supplier_id: supplierId,
        payment_method: '匯款',
        payment_terms: '貨到付款',
        total_amount: 65000,
        status: 'approved',
      })
      .select()
      .single();
    createdOrderIds.push(po!.id);
    const { data: poItem } = await admin
      .from('purchase_order_items')
      .insert({
        purchase_order_id: po!.id,
        line_no: 1,
        budget_code_id: budgetCodeId,
        item_category: '材料',
        description: '材料A',
        quantity: 1,
        unit_price: 65000,
        total_price: 65000,
      })
      .select()
      .single();
    const { data: acceptance } = await admin
      .from('acceptances')
      .insert({
        procurement_case_id: pcase!.id,
        purchase_order_id: po!.id,
        applicant_employee_id: applicantId,
        department_id: departmentId,
        budget_owner_employee_id: applicantId,
        contractor_supplier_id: supplierId,
        total_amount: 65000,
        status: 'returned',
      })
      .select()
      .single();
    createdAcceptanceIds.push(acceptance!.id);
    const { data: item } = await admin
      .from('acceptance_items')
      .insert({
        acceptance_id: acceptance!.id,
        line_no: 1,
        purchase_order_item_id: poItem!.id,
        description: '材料A',
        quantity: 1,
        amount: 65000,
        pass_fail: 'fail',
      })
      .select()
      .single();

    currentEmployee.value = { id: applicantId };
    const { resubmitAcceptance } = await import('@/lib/acceptances/actions');
    const result = await resubmitAcceptance(acceptance!.id, {
      contractorSupplierId: secondSupplierId,
      acceptanceDate: '2026-07-20',
      items: [{ acceptanceItemId: item!.id, passFail: 'pass' }],
    });
    expect(result).toEqual({ ok: true });

    const { data: updated } = await admin
      .from('acceptances')
      .select('status, current_step_order, contractor_supplier_id, acceptance_date')
      .eq('id', acceptance!.id)
      .single();
    expect(updated!.status).toBe('pending_approval');
    expect(updated!.current_step_order).toBe(1);
    expect(updated!.contractor_supplier_id).toBe(secondSupplierId);
    expect(updated!.acceptance_date).toBe('2026-07-20');

    const { data: items } = await admin
      .from('acceptance_items')
      .select('pass_fail')
      .eq('acceptance_id', acceptance!.id);
    expect(items).toEqual([{ pass_fail: 'pass' }]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `export $(grep -v '^#' .env.local | xargs) && npm test -- tests/integration/acceptance-resubmit.test.ts`
Expected: FAIL — `resubmitAcceptance is not a function`.

- [ ] **Step 3: Create and write the SQL transaction function**

Run: `supabase migration new resubmit_acceptance_tx`. Write:
```sql
create or replace function resubmit_acceptance(
  p_acceptance_id uuid,
  p_contractor_supplier uuid,
  p_acceptance_date date,
  p_items jsonb,
  p_steps jsonb
) returns void
language plpgsql
as $$
begin
  delete from acceptance_items where acceptance_id = p_acceptance_id;
  delete from approval_steps
    where form_type = 'acceptance' and form_id = p_acceptance_id;

  insert into acceptance_items
    (acceptance_id, line_no, purchase_order_item_id, description, quantity, amount, pass_fail)
  select p_acceptance_id,
         (e->>'line_no')::int,
         (e->>'purchase_order_item_id')::uuid,
         e->>'description',
         (e->>'quantity')::int,
         (e->>'amount')::numeric,
         e->>'pass_fail'
  from jsonb_array_elements(p_items) e;

  insert into approval_steps
    (form_type, form_id, step_order, approver_employee_id, approver_role)
  select 'acceptance',
         p_acceptance_id,
         (s->>'step_order')::int,
         (s->>'approver_employee_id')::uuid,
         s->>'approver_role'
  from jsonb_array_elements(p_steps) s;

  update acceptances
     set contractor_supplier_id = p_contractor_supplier,
         acceptance_date = p_acceptance_date,
         status = 'pending_approval',
         current_step_order = 1,
         updated_at = now()
   where id = p_acceptance_id;
end;
$$;
```

- [ ] **Step 4: Apply the migration**

Run: `export $(grep -v '^#' .env.local | xargs) && supabase db push`

- [ ] **Step 5: Implement `resubmitAcceptance`**

Append to `src/lib/acceptances/actions.ts`:
```ts
export type ResubmitAcceptanceInput = {
  contractorSupplierId: string;
  acceptanceDate: string;
  items: { acceptanceItemId: string; passFail: 'pass' | 'fail' }[];
};

export async function resubmitAcceptance(
  acceptanceId: string,
  input: ResubmitAcceptanceInput
): Promise<ActionResult> {
  const employee = await getCurrentEmployee(await createSupabaseServerClient());
  if (!employee) return { ok: false, error: '找不到您的員工資料' };
  const db = createSupabaseServiceRoleClient();

  const { data: acceptance } = await db
    .from('acceptances')
    .select(
      'id, applicant_employee_id, status, department_id, budget_owner_employee_id, total_amount, procurement_case_id'
    )
    .eq('id', acceptanceId)
    .maybeSingle();
  if (!acceptance) return { ok: false, error: '找不到這張驗收單' };
  if (acceptance.applicant_employee_id !== employee.id) {
    return { ok: false, error: '只有申請人可以重新送出這張驗收單' };
  }
  if (acceptance.status !== 'returned') {
    return { ok: false, error: '只有被退回的驗收單可以重新送出' };
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
    return { ok: false, error: '重新送出後找不到適用的簽核人，請聯絡系統管理員' };
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
  if (txError) return { ok: false, error: '重新送出失敗，請稍後再試' };

  const { data: caseRow } = await db
    .from('procurement_cases')
    .select('case_number')
    .eq('id', acceptance.procurement_case_id)
    .single();
  await notifyAndEmail(db, {
    recipientEmployeeId: chain[0].approverEmployeeId,
    type: 'approval_requested',
    formType: 'acceptance',
    formId: acceptanceId,
    caseNumber: caseRow!.case_number,
    message: `驗收單 ${caseRow!.case_number} 已重新送出，待您簽核`,
  });

  revalidatePath('/approvals');
  revalidatePath(`/acceptances/${acceptanceId}`);
  return { ok: true };
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `export $(grep -v '^#' .env.local | xargs) && npm test -- tests/integration/acceptance-resubmit.test.ts`
Expected: PASS (1 test).

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations src/lib/acceptances/actions.ts tests/integration/acceptance-resubmit.test.ts
git commit -m "feat: add resubmitAcceptance and its transactional SQL function"
```

---

## Task 22: 驗收單 — query helpers + pages

**Files:**
- Create: `src/lib/acceptances/queries.ts`
- Create: `src/app/acceptances/page.tsx`
- Create: `src/app/acceptances/new/page.tsx` + `acceptance-form.tsx` (client)
- Create: `src/app/acceptances/[id]/page.tsx` + `approval-actions.tsx` (client) + `property-tag-form.tsx` (client)
- Modify: `src/app/purchase-orders/[id]/page.tsx` (add a "建立驗收單" link when eligible)
- Test: `tests/integration/acceptance-queries.test.ts`

**Interfaces:**
- Consumes: `createSupabaseServerClient`, `getCurrentEmployee`, `AttachmentsPanel`, `getAttachments`, `createAcceptance`/`approveAcceptanceStep`/`returnAcceptanceStep`/`updateAcceptanceItemPropertyTag` (Tasks 19–21).
- Produces: `AcceptanceSummary`, `AcceptanceDetail` (items carry `itemId`, `passFail`, `propertyTag`), `EligiblePurchaseOrder = { id, caseNumber, items: { id, description, quantity }[] }`, `AcceptanceQueueItem`, and `getMyAcceptances()`, `getAcceptanceDetail(acceptanceId)`, `getEligiblePurchaseOrdersForAcceptance()`, `getMyAcceptanceApprovalQueue()`.

- [ ] **Step 1: Write the failing integration test**

`tests/integration/acceptance-queries.test.ts`:
```ts
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  createServiceRoleTestClient,
  hasIntegrationTestCredentials,
} from './supabase-test-client';

const currentEmployee = vi.hoisted(() => ({ value: null as null | { id: string } }));
vi.mock('@/lib/auth/current-employee', () => ({
  getCurrentEmployee: async () => currentEmployee.value,
}));
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => {
    const { createServiceRoleTestClient } = await import('./supabase-test-client');
    return createServiceRoleTestClient();
  },
}));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

describe.skipIf(!hasIntegrationTestCredentials())('acceptance queries', () => {
  let admin: ReturnType<typeof createServiceRoleTestClient>;
  let applicantId: string;
  let departmentId: string;
  let budgetCodeId: string;
  let supplierId: string;
  let orderId: string;
  let acceptanceId: string;

  beforeAll(async () => {
    admin = createServiceRoleTestClient();
    const { data: emp } = await admin
      .from('employees')
      .select('id, department_id')
      .not('department_id', 'is', null)
      .limit(1)
      .single();
    applicantId = emp!.id;
    departmentId = emp!.department_id;
    const { data: bc } = await admin.from('budget_codes').select('id').limit(1).single();
    budgetCodeId = bc!.id;
    const { data: sup } = await admin.from('suppliers').select('id').limit(1).single();
    supplierId = sup!.id;

    const { data: caseNumber } = await admin.rpc('next_case_number');
    const { data: pcase } = await admin
      .from('procurement_cases')
      .insert({ case_number: caseNumber, created_by_employee_id: applicantId })
      .select()
      .single();
    const { data: po } = await admin
      .from('purchase_orders')
      .insert({
        procurement_case_id: pcase!.id,
        purchase_request_id: null,
        applicant_employee_id: applicantId,
        department_id: departmentId,
        budget_owner_employee_id: applicantId,
        supplier_id: supplierId,
        payment_method: '匯款',
        payment_terms: '貨到付款',
        total_amount: 65000,
        status: 'approved',
      })
      .select()
      .single();
    orderId = po!.id;
    const { data: poItem } = await admin
      .from('purchase_order_items')
      .insert({
        purchase_order_id: orderId,
        line_no: 1,
        budget_code_id: budgetCodeId,
        item_category: '材料',
        description: '查詢測試',
        quantity: 1,
        unit_price: 65000,
        total_price: 65000,
      })
      .select()
      .single();

    currentEmployee.value = { id: applicantId };
    const actions = await import('@/lib/acceptances/actions');
    const created = await actions.createAcceptance({
      purchaseOrderId: orderId,
      contractorSupplierId: supplierId,
      acceptanceDate: '2026-07-20',
      items: [{ purchaseOrderItemId: poItem!.id, passFail: 'pass' }],
    });
    if (!created.ok) throw new Error(created.error);
    acceptanceId = created.acceptanceId;
  });

  afterAll(async () => {
    await admin.from('approval_steps').delete().eq('form_id', acceptanceId);
    await admin.from('notifications').delete().eq('form_id', acceptanceId);
    await admin.from('acceptances').delete().eq('id', acceptanceId);
    const { data: po } = await admin
      .from('purchase_orders')
      .select('procurement_case_id')
      .eq('id', orderId)
      .maybeSingle();
    await admin.from('purchase_orders').delete().eq('id', orderId);
    if (po?.procurement_case_id) {
      await admin.from('procurement_cases').delete().eq('id', po.procurement_case_id);
    }
    currentEmployee.value = null;
  });

  it('getMyAcceptances returns the applicant’s acceptance', async () => {
    currentEmployee.value = { id: applicantId };
    const { getMyAcceptances } = await import('@/lib/acceptances/queries');
    const rows = await getMyAcceptances();
    expect(rows.some((r) => r.id === acceptanceId)).toBe(true);
  });

  it('getAcceptanceDetail returns items with pass/fail and null property tag', async () => {
    const { getAcceptanceDetail } = await import('@/lib/acceptances/queries');
    const detail = await getAcceptanceDetail(acceptanceId);
    expect(detail).not.toBeNull();
    expect(detail!.items).toHaveLength(1);
    expect(detail!.items[0].passFail).toBe('pass');
    expect(detail!.items[0].propertyTag).toBeNull();
  });

  it('getEligiblePurchaseOrdersForAcceptance excludes an order that already has an acceptance', async () => {
    const { getEligiblePurchaseOrdersForAcceptance } = await import('@/lib/acceptances/queries');
    const eligible = await getEligiblePurchaseOrdersForAcceptance();
    expect(eligible.some((o) => o.id === orderId)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `export $(grep -v '^#' .env.local | xargs) && npm test -- tests/integration/acceptance-queries.test.ts`
Expected: FAIL — `Cannot find module '@/lib/acceptances/queries'`.

- [ ] **Step 3: Implement the query helpers**

`src/lib/acceptances/queries.ts`:
```ts
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getCurrentEmployee } from '@/lib/auth/current-employee';

export type AcceptanceSummary = {
  id: string;
  caseNumber: string;
  status: string;
  totalAmount: number;
};

export type AcceptanceDetailItem = {
  lineNo: number;
  itemId: string;
  description: string;
  quantity: number;
  amount: number;
  passFail: 'pass' | 'fail';
  propertyTag: string | null;
};

export type AcceptanceDetailStep = {
  stepOrder: number;
  approverEmployeeId: string;
  approverName: string;
  approverRole: string;
  status: string;
  comment: string | null;
};

export type AcceptanceDetail = {
  id: string;
  caseNumber: string;
  status: string;
  totalAmount: number;
  contractorSupplierName: string;
  acceptanceDate: string;
  applicantName: string;
  departmentName: string;
  currentStepOrder: number | null;
  items: AcceptanceDetailItem[];
  steps: AcceptanceDetailStep[];
};

export type EligiblePurchaseOrderItem = { id: string; description: string; quantity: number };

export type EligiblePurchaseOrder = {
  id: string;
  caseNumber: string;
  items: EligiblePurchaseOrderItem[];
};

export type AcceptanceQueueItem = {
  id: string;
  caseNumber: string;
  applicantName: string;
  totalAmount: number;
};

export async function getMyAcceptances(): Promise<AcceptanceSummary[]> {
  const supabase = await createSupabaseServerClient();
  const employee = await getCurrentEmployee(supabase);
  if (!employee) return [];
  const { data } = await supabase
    .from('acceptances')
    .select('id, total_amount, status, procurement_cases(case_number)')
    .eq('applicant_employee_id', employee.id)
    .order('created_at', { ascending: false });
  return (data ?? []).map((a) => ({
    id: a.id,
    caseNumber: (a.procurement_cases as unknown as { case_number: string }).case_number,
    status: a.status,
    totalAmount: Number(a.total_amount),
  }));
}

export async function getAcceptanceDetail(acceptanceId: string): Promise<AcceptanceDetail | null> {
  const supabase = await createSupabaseServerClient();
  const { data: acceptance } = await supabase
    .from('acceptances')
    .select(
      'id, total_amount, status, acceptance_date, current_step_order, procurement_cases(case_number), applicant:employees!applicant_employee_id(name), departments(name), suppliers:suppliers!contractor_supplier_id(name)'
    )
    .eq('id', acceptanceId)
    .maybeSingle();
  if (!acceptance) return null;

  const { data: items } = await supabase
    .from('acceptance_items')
    .select('line_no, id, description, quantity, amount, pass_fail, property_tag')
    .eq('acceptance_id', acceptanceId)
    .order('line_no');

  const { data: steps } = await supabase
    .from('approval_steps')
    .select(
      'step_order, approver_role, status, comment, approver_employee_id, approver:employees!approver_employee_id(name)'
    )
    .eq('form_type', 'acceptance')
    .eq('form_id', acceptanceId)
    .order('step_order');

  return {
    id: acceptance.id,
    caseNumber: (acceptance.procurement_cases as unknown as { case_number: string }).case_number,
    status: acceptance.status,
    totalAmount: Number(acceptance.total_amount),
    contractorSupplierName: (acceptance.suppliers as unknown as { name: string }).name,
    acceptanceDate: acceptance.acceptance_date,
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
}

export async function getEligiblePurchaseOrdersForAcceptance(): Promise<EligiblePurchaseOrder[]> {
  const supabase = await createSupabaseServerClient();
  const employee = await getCurrentEmployee(supabase);
  if (!employee) return [];

  const { data: orders } = await supabase
    .from('purchase_orders')
    .select('id, procurement_cases(case_number)')
    .eq('applicant_employee_id', employee.id)
    .eq('status', 'approved');
  if (!orders || orders.length === 0) return [];

  const { data: existingAcceptances } = await supabase
    .from('acceptances')
    .select('purchase_order_id')
    .in(
      'purchase_order_id',
      orders.map((o) => o.id)
    );
  const takenIds = new Set((existingAcceptances ?? []).map((a) => a.purchase_order_id));
  const remaining = orders.filter((o) => !takenIds.has(o.id));

  const result: EligiblePurchaseOrder[] = [];
  for (const o of remaining) {
    const { data: items } = await supabase
      .from('purchase_order_items')
      .select('id, description, quantity')
      .eq('purchase_order_id', o.id)
      .order('line_no');
    result.push({
      id: o.id,
      caseNumber: (o.procurement_cases as unknown as { case_number: string }).case_number,
      items: (items ?? []).map((i) => ({ id: i.id, description: i.description, quantity: i.quantity })),
    });
  }
  return result;
}

export async function getMyAcceptanceApprovalQueue(): Promise<AcceptanceQueueItem[]> {
  const supabase = await createSupabaseServerClient();
  const employee = await getCurrentEmployee(supabase);
  if (!employee) return [];
  const { data: steps } = await supabase
    .from('approval_steps')
    .select('form_id, step_order')
    .eq('form_type', 'acceptance')
    .eq('approver_employee_id', employee.id)
    .eq('status', 'pending');
  const formIds = (steps ?? []).map((s) => s.form_id);
  if (formIds.length === 0) return [];
  const { data: acceptances } = await supabase
    .from('acceptances')
    .select(
      'id, total_amount, current_step_order, status, procurement_cases(case_number), applicant:employees!applicant_employee_id(name)'
    )
    .in('id', formIds)
    .eq('status', 'pending_approval');
  const stepOrderByForm = new Map((steps ?? []).map((s) => [s.form_id, s.step_order]));
  return (acceptances ?? [])
    .filter((a) => a.current_step_order === stepOrderByForm.get(a.id))
    .map((a) => ({
      id: a.id,
      caseNumber: (a.procurement_cases as unknown as { case_number: string }).case_number,
      applicantName: (a.applicant as unknown as { name: string }).name,
      totalAmount: Number(a.total_amount),
    }));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `export $(grep -v '^#' .env.local | xargs) && npm test -- tests/integration/acceptance-queries.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Write the list page**

`src/app/acceptances/page.tsx`:
```tsx
import Link from 'next/link';
import { getMyAcceptances } from '@/lib/acceptances/queries';

const STATUS_LABELS: Record<string, string> = {
  pending_approval: '簽核中',
  approved: '已核准',
  returned: '已退回（待修改）',
};

export default async function AcceptancesPage() {
  const acceptances = await getMyAcceptances();
  return (
    <main className="mx-auto max-w-4xl p-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">我的驗收單</h1>
        <Link href="/acceptances/new" className="rounded bg-blue-600 px-3 py-1 text-sm text-white">
          + 新增驗收單
        </Link>
      </div>
      {acceptances.length === 0 ? (
        <p className="text-gray-500">尚無驗收單。</p>
      ) : (
        <table className="w-full border text-sm">
          <thead>
            <tr className="bg-gray-100">
              <th className="border p-2">案件單號</th>
              <th className="border p-2">狀態</th>
              <th className="border p-2">總計</th>
            </tr>
          </thead>
          <tbody>
            {acceptances.map((a) => (
              <tr key={a.id}>
                <td className="border p-2">
                  <Link href={`/acceptances/${a.id}`} className="text-blue-600 underline">
                    {a.caseNumber}
                  </Link>
                </td>
                <td className="border p-2">{STATUS_LABELS[a.status] ?? a.status}</td>
                <td className="border p-2 text-right">{a.totalAmount.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
```

- [ ] **Step 6: Write the create page + form**

`src/app/acceptances/new/page.tsx`:
```tsx
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { getEligiblePurchaseOrdersForAcceptance } from '@/lib/acceptances/queries';
import { AcceptanceForm } from './acceptance-form';

export default async function NewAcceptancePage({
  searchParams,
}: {
  searchParams: Promise<{ orderId?: string }>;
}) {
  const { orderId } = await searchParams;
  const supabase = await createSupabaseServerClient();
  const employee = await getCurrentEmployee(supabase);
  if (!employee) redirect('/login');

  const eligible = await getEligiblePurchaseOrdersForAcceptance();

  if (!orderId) {
    return (
      <main className="mx-auto max-w-2xl p-8">
        <h1 className="mb-6 text-2xl font-bold">新增驗收單</h1>
        {eligible.length === 0 ? (
          <p className="text-gray-500">目前沒有已核准、尚未建立驗收單的採購單。</p>
        ) : (
          <ul className="space-y-2">
            {eligible.map((o) => (
              <li key={o.id}>
                <a href={`/acceptances/new?orderId=${o.id}`} className="text-blue-600 underline">
                  {o.caseNumber}
                </a>
              </li>
            ))}
          </ul>
        )}
      </main>
    );
  }

  const selected = eligible.find((o) => o.id === orderId);
  if (!selected) redirect('/acceptances/new');

  const { data: suppliers } = await supabase.from('suppliers').select('id, name').order('name');

  return (
    <main className="mx-auto max-w-4xl p-8">
      <h1 className="mb-2 text-2xl font-bold">新增驗收單</h1>
      <p className="mb-6 font-mono text-gray-600">{selected.caseNumber}</p>
      <AcceptanceForm
        purchaseOrderId={selected.id}
        items={selected.items}
        suppliers={(suppliers ?? []).map((s) => ({ id: s.id, name: s.name }))}
      />
    </main>
  );
}
```

`src/app/acceptances/new/acceptance-form.tsx`:
```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createAcceptance } from '@/lib/acceptances/actions';

export function AcceptanceForm({
  purchaseOrderId,
  items,
  suppliers,
}: {
  purchaseOrderId: string;
  items: { id: string; description: string; quantity: number }[];
  suppliers: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [contractorSupplierId, setContractorSupplierId] = useState(suppliers[0]?.id ?? '');
  const [acceptanceDate, setAcceptanceDate] = useState(new Date().toISOString().slice(0, 10));
  const [passFail, setPassFail] = useState<Record<string, 'pass' | 'fail'>>(
    Object.fromEntries(items.map((i) => [i.id, 'pass' as const]))
  );
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async () => {
    setError(null);
    setSubmitting(true);
    const result = await createAcceptance({
      purchaseOrderId,
      contractorSupplierId,
      acceptanceDate,
      items: items.map((i) => ({ purchaseOrderItemId: i.id, passFail: passFail[i.id] ?? 'pass' })),
    });
    setSubmitting(false);
    if (result.ok) {
      router.push(`/acceptances/${result.acceptanceId}`);
    } else {
      setError(result.error);
    }
  };

  return (
    <div className="space-y-4">
      <label className="block text-sm">
        承攬廠商：
        <select
          value={contractorSupplierId}
          onChange={(e) => setContractorSupplierId(e.target.value)}
          className="ml-2 rounded border px-2 py-1"
        >
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm">
        驗收日期：
        <input
          type="date"
          value={acceptanceDate}
          onChange={(e) => setAcceptanceDate(e.target.value)}
          className="ml-2 rounded border px-2 py-1"
        />
      </label>

      {items.map((item) => (
        <div key={item.id} className="flex items-center gap-3 rounded border p-3 text-sm">
          <span className="flex-1">
            {item.description}｜數量 {item.quantity}
          </span>
          <label className="flex items-center gap-1">
            <input
              type="radio"
              name={`pass-fail-${item.id}`}
              checked={(passFail[item.id] ?? 'pass') === 'pass'}
              onChange={() => setPassFail((prev) => ({ ...prev, [item.id]: 'pass' }))}
            />
            Pass
          </label>
          <label className="flex items-center gap-1">
            <input
              type="radio"
              name={`pass-fail-${item.id}`}
              checked={(passFail[item.id] ?? 'pass') === 'fail'}
              onChange={() => setPassFail((prev) => ({ ...prev, [item.id]: 'fail' }))}
            />
            Fail
          </label>
        </div>
      ))}

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

- [ ] **Step 7: Write the detail page + approval actions + property-tag form**

`src/app/acceptances/[id]/approval-actions.tsx`: same shape as `src/app/purchase-orders/[id]/approval-actions.tsx` (Task 18, Step 7), importing `approveAcceptanceStep`/`returnAcceptanceStep` from `@/lib/acceptances/actions` and taking an `acceptanceId` prop instead of `orderId`.

`src/app/acceptances/[id]/property-tag-form.tsx`:
```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { updateAcceptanceItemPropertyTag } from '@/lib/acceptances/actions';

export function PropertyTagForm({ itemId, initialValue }: { itemId: string; initialValue: string | null }) {
  const router = useRouter();
  const [value, setValue] = useState(initialValue ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const onSave = async () => {
    setError(null);
    setSaving(true);
    const result = await updateAcceptanceItemPropertyTag(itemId, value);
    setSaving(false);
    if (result.ok) router.refresh();
    else setError(result.error);
  };

  return (
    <span className="inline-flex items-center gap-1">
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="財產編號"
        className="w-28 rounded border px-1 py-0.5 text-xs"
      />
      <button
        type="button"
        onClick={onSave}
        disabled={saving}
        className="rounded border px-2 py-0.5 text-xs disabled:opacity-50"
      >
        儲存
      </button>
      {error && <span className="text-xs text-red-700">{error}</span>}
    </span>
  );
}
```

`src/app/acceptances/[id]/page.tsx`:
```tsx
import { notFound } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { getAcceptanceDetail } from '@/lib/acceptances/queries';
import { getAttachments } from '@/lib/attachments/queries';
import { AttachmentsPanel } from '@/app/components/attachments-panel';
import { ApprovalActions } from './approval-actions';
import { PropertyTagForm } from './property-tag-form';

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

export default async function AcceptanceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const detail = await getAcceptanceDetail(id);
  if (!detail) notFound();

  const supabase = await createSupabaseServerClient();
  const employee = await getCurrentEmployee(supabase);
  const attachments = await getAttachments('acceptance', id);
  const canEditPropertyTag = employee?.role === 'finance' || employee?.role === 'admin';

  const currentStep =
    detail.status === 'pending_approval' && detail.currentStepOrder !== null
      ? detail.steps.find((s) => s.stepOrder === detail.currentStepOrder)
      : undefined;
  const isCurrentApprover =
    !!employee && !!currentStep && currentStep.approverEmployeeId === employee.id;

  return (
    <main className="mx-auto max-w-4xl space-y-4 p-8">
      <div>
        <h1 className="mb-1 text-2xl font-bold">驗收單</h1>
        <p className="font-mono text-gray-600">{detail.caseNumber}（項次 C1）</p>
      </div>

      <section className="rounded border p-4 text-sm">
        <p>申請單位：{detail.departmentName}</p>
        <p>申請人：{detail.applicantName}</p>
        <p>承攬廠商：{detail.contractorSupplierName}</p>
        <p>驗收日期：{detail.acceptanceDate}</p>
        <p>狀態：{STATUS_LABELS[detail.status] ?? detail.status}</p>
        <p>總計：NT$ {detail.totalAmount.toLocaleString()}</p>
      </section>

      <table className="w-full border text-sm">
        <thead>
          <tr className="bg-gray-100">
            <th className="border p-2">項次</th>
            <th className="border p-2">說明</th>
            <th className="border p-2">數量</th>
            <th className="border p-2">金額</th>
            <th className="border p-2">結果</th>
            <th className="border p-2">財產編號（財會填）</th>
          </tr>
        </thead>
        <tbody>
          {detail.items.map((i) => (
            <tr key={i.lineNo}>
              <td className="border p-2 text-center">{i.lineNo}</td>
              <td className="border p-2">{i.description}</td>
              <td className="border p-2 text-right">{i.quantity}</td>
              <td className="border p-2 text-right">{i.amount.toLocaleString()}</td>
              <td className={`border p-2 text-center ${i.passFail === 'fail' ? 'text-red-600' : 'text-green-600'}`}>
                {i.passFail === 'pass' ? 'Pass' : 'Fail'}
              </td>
              <td className="border p-2">
                {canEditPropertyTag ? (
                  <PropertyTagForm itemId={i.itemId} initialValue={i.propertyTag} />
                ) : (
                  (i.propertyTag ?? '—')
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <section>
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

      <AttachmentsPanel formType="acceptance" formId={id} attachments={attachments} />

      {isCurrentApprover && <ApprovalActions acceptanceId={detail.id} />}
    </main>
  );
}
```

- [ ] **Step 8: Add a "建立驗收單" link on the 採購單 detail page when eligible**

In `src/app/purchase-orders/[id]/page.tsx`, add the import `import Link from 'next/link';` and, right before `{isCurrentApprover && <ApprovalActions orderId={detail.id} />}`, add:
```tsx
      {detail.status === 'approved' && (
        <p>
          <Link href={`/acceptances/new?orderId=${detail.id}`} className="text-blue-600 underline">
            建立驗收單
          </Link>
        </p>
      )}
```

- [ ] **Step 9: Commit**

```bash
git add src/lib/acceptances/queries.ts src/app/acceptances src/app/purchase-orders/[id]/page.tsx tests/integration/acceptance-queries.test.ts
git commit -m "feat: add acceptance queries and pages"
```

---

## Task 23: 費用申請單 — `validateExpenseRequestInput()` + `createExpenseRequest` action

**Files:**
- Create: `src/lib/expense-requests/validate.ts` + `.test.ts`
- Create: `src/lib/expense-requests/actions.ts`
- Test: `tests/integration/expense-request-create.test.ts`

**Interfaces:**
- Consumes: `buildApprovalChainForForm` (Task 10), `notifyAndEmail` (Task 12), `computeDefaultExpectedPaymentDate`/`computePaymentBatchDate` (Task 9).
- Produces: `validateExpenseRequestInput(input: { payeeType: 'employee' | 'supplier'; payeeSupplierId: string | null; bankAccount: string | null; includedItemCount: number }): ValidationResult`; `NewExpenseRequest = { purchaseOrderId: string; payeeType: 'employee' | 'supplier'; payeeSupplierId: string | null; paymentMethod: string; bankName: string | null; bankAccount: string | null; accountName: string | null; invoiceMonth: string | null; expectedPaymentDate: string | null; includedSourceItemIds: string[] }`, `CreateResult = { ok: true; expenseRequestId: string; caseNumber: string; paymentBatchDate: string } | { ok: false; error: string }`, and `async createExpenseRequest(input: NewExpenseRequest): Promise<CreateResult>`.

**Design notes — this is the task that implements the 例外路徑 and 驗收 Fail exclusion:**
- The source purchase order must be `status = 'approved'`. The action then looks for an `approved` `acceptances` row for that order: if found, items are copied from its `acceptance_items` (this is the normal path — `acceptance_id` is set); if none is found **and** `purchase_orders.payment_terms = '預付款'`, items are copied from `purchase_order_items` instead (the 預付款 exception — `acceptance_id` stays `null`); otherwise creation is rejected with a message telling the applicant to complete 驗收 first.
- `includedSourceItemIds` lets the applicant exclude a Fail'd acceptance item from the claim (spec: "Fail 的項次仍可送出驗收單，但費用申請單對應項次需人工排除" — the exclusion is a manual choice by the applicant on this form, not an automatic filter) — the applicant may also exclude any Pass'd item they simply aren't claiming yet.
- `payee_supplier_id` / bank fields: when `payeeType === 'supplier'`, `bank_name`/`bank_account`/`account_name` are left `null` on the row (the UI reads the supplier's own bank info from `suppliers` at render time); when `payeeType === 'employee'`, those three columns hold the manually entered bank info and `bankAccount` is required.
- `payment_batch_date` is computed once at creation from `computePaymentBatchDate` and stored — this is the "預計撥款批次日" the spec says is shown to the applicant and finance after approval; it is not recomputed later in this release.

- [ ] **Step 1: Write the failing test for `validateExpenseRequestInput`**

`src/lib/expense-requests/validate.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { validateExpenseRequestInput } from './validate';

describe('validateExpenseRequestInput', () => {
  it('accepts a supplier payee with a chosen supplier and at least one item', () => {
    expect(
      validateExpenseRequestInput({
        payeeType: 'supplier',
        payeeSupplierId: 'S1',
        bankAccount: null,
        includedItemCount: 1,
      })
    ).toEqual({ ok: true });
  });

  it('accepts an employee payee with a bank account and at least one item', () => {
    expect(
      validateExpenseRequestInput({
        payeeType: 'employee',
        payeeSupplierId: null,
        bankAccount: '1234567890',
        includedItemCount: 1,
      })
    ).toEqual({ ok: true });
  });

  it('rejects zero included items', () => {
    expect(
      validateExpenseRequestInput({
        payeeType: 'supplier',
        payeeSupplierId: 'S1',
        bankAccount: null,
        includedItemCount: 0,
      })
    ).toEqual({ ok: false, error: '費用申請單至少需要一個明細項次' });
  });

  it('rejects a supplier payee with no supplier chosen', () => {
    expect(
      validateExpenseRequestInput({
        payeeType: 'supplier',
        payeeSupplierId: null,
        bankAccount: null,
        includedItemCount: 1,
      })
    ).toEqual({ ok: false, error: '付款對象為廠商時必須選擇廠商' });
  });

  it('rejects an employee payee with no bank account', () => {
    expect(
      validateExpenseRequestInput({
        payeeType: 'employee',
        payeeSupplierId: null,
        bankAccount: null,
        includedItemCount: 1,
      })
    ).toEqual({ ok: false, error: '付款對象為員工時必須填寫銀行帳號' });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/lib/expense-requests/validate.test.ts`
Expected: FAIL — `Cannot find module './validate'`.

- [ ] **Step 3: Implement `validateExpenseRequestInput`**

`src/lib/expense-requests/validate.ts`:
```ts
export type ValidationResult = { ok: true } | { ok: false; error: string };

export function validateExpenseRequestInput(input: {
  payeeType: 'employee' | 'supplier';
  payeeSupplierId: string | null;
  bankAccount: string | null;
  includedItemCount: number;
}): ValidationResult {
  if (input.includedItemCount === 0) {
    return { ok: false, error: '費用申請單至少需要一個明細項次' };
  }
  if (input.payeeType === 'supplier' && !input.payeeSupplierId) {
    return { ok: false, error: '付款對象為廠商時必須選擇廠商' };
  }
  if (input.payeeType === 'employee' && !input.bankAccount) {
    return { ok: false, error: '付款對象為員工時必須填寫銀行帳號' };
  }
  return { ok: true };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/lib/expense-requests/validate.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Write the failing integration test for `createExpenseRequest`**

`tests/integration/expense-request-create.test.ts`:
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

describe.skipIf(!hasIntegrationTestCredentials())('createExpenseRequest', () => {
  let admin: ReturnType<typeof createServiceRoleTestClient>;
  let applicantId: string;
  let departmentId: string;
  let budgetCodeId: string;
  let supplierId: string;
  const createdCaseIds: string[] = [];
  const createdOrderIds: string[] = [];
  const createdExpenseIds: string[] = [];

  beforeAll(async () => {
    admin = createServiceRoleTestClient();
    const { data: emp } = await admin
      .from('employees')
      .select('id, department_id')
      .not('department_id', 'is', null)
      .limit(1)
      .single();
    applicantId = emp!.id;
    departmentId = emp!.department_id;
    const { data: bc } = await admin.from('budget_codes').select('id').limit(1).single();
    budgetCodeId = bc!.id;
    const { data: sup } = await admin.from('suppliers').select('id').limit(1).single();
    supplierId = sup!.id;
  });

  async function makeApprovedOrder(paymentTerms: string) {
    const { data: caseNumber } = await admin.rpc('next_case_number');
    const { data: pcase } = await admin
      .from('procurement_cases')
      .insert({ case_number: caseNumber, created_by_employee_id: applicantId })
      .select()
      .single();
    createdCaseIds.push(pcase!.id);
    const { data: po } = await admin
      .from('purchase_orders')
      .insert({
        procurement_case_id: pcase!.id,
        purchase_request_id: null,
        applicant_employee_id: applicantId,
        department_id: departmentId,
        budget_owner_employee_id: applicantId,
        supplier_id: supplierId,
        payment_method: '匯款',
        payment_terms: paymentTerms,
        total_amount: 65000,
        status: 'approved',
      })
      .select()
      .single();
    createdOrderIds.push(po!.id);
    const { data: item } = await admin
      .from('purchase_order_items')
      .insert({
        purchase_order_id: po!.id,
        line_no: 1,
        budget_code_id: budgetCodeId,
        item_category: '材料',
        description: '材料A',
        quantity: 1,
        unit_price: 65000,
        total_price: 65000,
      })
      .select()
      .single();
    return { orderId: po!.id, itemId: item!.id };
  }

  afterEach(async () => {
    currentEmployee.value = null;
    for (const id of createdExpenseIds.splice(0)) {
      await admin.from('approval_steps').delete().eq('form_type', 'expense_request').eq('form_id', id);
      await admin.from('notifications').delete().eq('form_type', 'expense_request').eq('form_id', id);
      await admin.from('expense_requests').delete().eq('id', id);
    }
    for (const id of createdOrderIds.splice(0)) {
      await admin.from('purchase_orders').delete().eq('id', id);
    }
    for (const id of createdCaseIds.splice(0)) {
      await admin.from('procurement_cases').delete().eq('id', id);
    }
  });

  it('rejects when there is no approved acceptance and payment terms are not 預付款', async () => {
    const { orderId, itemId } = await makeApprovedOrder('貨到付款');
    currentEmployee.value = { id: applicantId };
    const { createExpenseRequest } = await import('@/lib/expense-requests/actions');
    const result = await createExpenseRequest({
      purchaseOrderId: orderId,
      payeeType: 'supplier',
      payeeSupplierId: supplierId,
      paymentMethod: '匯款',
      bankName: null,
      bankAccount: null,
      accountName: null,
      invoiceMonth: '2026-07',
      expectedPaymentDate: null,
      includedSourceItemIds: [itemId],
    });
    expect(result).toEqual({
      ok: false,
      error: '此採購單尚未完成驗收，且付款條件非預付款，無法建立費用申請單',
    });
  });

  it('creates an expense request via the 預付款 exception path (no acceptance needed)', async () => {
    const { orderId, itemId } = await makeApprovedOrder('預付款');
    currentEmployee.value = { id: applicantId };
    const { createExpenseRequest } = await import('@/lib/expense-requests/actions');
    const result = await createExpenseRequest({
      purchaseOrderId: orderId,
      payeeType: 'supplier',
      payeeSupplierId: supplierId,
      paymentMethod: '匯款',
      bankName: null,
      bankAccount: null,
      accountName: null,
      invoiceMonth: '2026-07',
      expectedPaymentDate: null,
      includedSourceItemIds: [itemId],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    createdExpenseIds.push(result.expenseRequestId);
    expect(result.paymentBatchDate).toBe('2026-08-25');

    const { data: expenseRequest } = await admin
      .from('expense_requests')
      .select('acceptance_id, total_amount, payment_batch_date, status')
      .eq('id', result.expenseRequestId)
      .single();
    expect(expenseRequest!.acceptance_id).toBeNull();
    expect(Number(expenseRequest!.total_amount)).toBe(65000);
    expect(expenseRequest!.payment_batch_date).toBe('2026-08-25');
  });

  it('creates an expense request from an approved acceptance, excluding a Fail item', async () => {
    const { orderId } = await makeApprovedOrder('貨到付款');
    const { data: poItems } = await admin
      .from('purchase_order_items')
      .select('id')
      .eq('purchase_order_id', orderId);
    await admin.from('purchase_order_items').insert({
      purchase_order_id: orderId,
      line_no: 2,
      budget_code_id: budgetCodeId,
      item_category: '材料',
      description: '材料B',
      quantity: 1,
      unit_price: 5000,
      total_price: 5000,
    });
    const { data: allPoItems } = await admin
      .from('purchase_order_items')
      .select('id, description')
      .eq('purchase_order_id', orderId)
      .order('line_no');
    const { data: acceptance } = await admin
      .from('acceptances')
      .insert({
        procurement_case_id: (
          await admin.from('purchase_orders').select('procurement_case_id').eq('id', orderId).single()
        ).data!.procurement_case_id,
        purchase_order_id: orderId,
        applicant_employee_id: applicantId,
        department_id: departmentId,
        budget_owner_employee_id: applicantId,
        contractor_supplier_id: supplierId,
        total_amount: 70000,
        status: 'approved',
      })
      .select()
      .single();
    const { data: acceptanceItems } = await admin
      .from('acceptance_items')
      .insert([
        {
          acceptance_id: acceptance!.id,
          line_no: 1,
          purchase_order_item_id: allPoItems![0].id,
          description: '材料A',
          quantity: 1,
          amount: 65000,
          pass_fail: 'pass',
        },
        {
          acceptance_id: acceptance!.id,
          line_no: 2,
          purchase_order_item_id: allPoItems![1].id,
          description: '材料B',
          quantity: 1,
          amount: 5000,
          pass_fail: 'fail',
        },
      ])
      .select();
    const passItem = acceptanceItems!.find((i) => i.pass_fail === 'pass')!;

    currentEmployee.value = { id: applicantId };
    const { createExpenseRequest } = await import('@/lib/expense-requests/actions');
    const result = await createExpenseRequest({
      purchaseOrderId: orderId,
      payeeType: 'supplier',
      payeeSupplierId: supplierId,
      paymentMethod: '匯款',
      bankName: null,
      bankAccount: null,
      accountName: null,
      invoiceMonth: null,
      expectedPaymentDate: '2026-07-25',
      includedSourceItemIds: [passItem.id],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    createdExpenseIds.push(result.expenseRequestId);

    const { data: expenseRequest } = await admin
      .from('expense_requests')
      .select('acceptance_id, total_amount')
      .eq('id', result.expenseRequestId)
      .single();
    expect(expenseRequest!.acceptance_id).toBe(acceptance!.id);
    expect(Number(expenseRequest!.total_amount)).toBe(65000);

    const { data: items } = await admin
      .from('expense_request_items')
      .select('description, amount')
      .eq('expense_request_id', result.expenseRequestId);
    expect(items).toEqual([{ description: '材料A', amount: '65000.00' }]);

    await admin.from('acceptance_items').delete().eq('acceptance_id', acceptance!.id);
    await admin.from('acceptances').delete().eq('id', acceptance!.id);
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `export $(grep -v '^#' .env.local | xargs) && npm test -- tests/integration/expense-request-create.test.ts`
Expected: FAIL — `Cannot find module '@/lib/expense-requests/actions'`.

- [ ] **Step 7: Implement `createExpenseRequest`**

`src/lib/expense-requests/actions.ts`:
```ts
'use server';

import { revalidatePath } from 'next/cache';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { buildApprovalChainForForm } from '@/lib/approval/build-chain';
import { notifyAndEmail } from '@/lib/notifications/notify';
import { validateExpenseRequestInput } from '@/lib/expense-requests/validate';
import {
  computeDefaultExpectedPaymentDate,
  computePaymentBatchDate,
} from '@/lib/procurement/payment-batch';

export type NewExpenseRequest = {
  purchaseOrderId: string;
  payeeType: 'employee' | 'supplier';
  payeeSupplierId: string | null;
  paymentMethod: string;
  bankName: string | null;
  bankAccount: string | null;
  accountName: string | null;
  invoiceMonth: string | null;
  expectedPaymentDate: string | null;
  includedSourceItemIds: string[];
};

export type CreateResult =
  | { ok: true; expenseRequestId: string; caseNumber: string; paymentBatchDate: string }
  | { ok: false; error: string };

type SourceItem = {
  id: string;
  purchase_order_item_id: string;
  description: string;
  amount: number;
};

export async function createExpenseRequest(input: NewExpenseRequest): Promise<CreateResult> {
  const employee = await getCurrentEmployee(await createSupabaseServerClient());
  if (!employee) return { ok: false, error: '找不到您的員工資料，請聯絡系統管理員' };

  const db = createSupabaseServiceRoleClient();

  const { data: po } = await db
    .from('purchase_orders')
    .select('id, procurement_case_id, department_id, budget_owner_employee_id, status, payment_terms')
    .eq('id', input.purchaseOrderId)
    .maybeSingle();
  if (!po) return { ok: false, error: '找不到來源採購單' };
  if (po.status !== 'approved') {
    return { ok: false, error: '來源採購單尚未核准，無法建立費用申請單' };
  }

  const { data: existing } = await db
    .from('expense_requests')
    .select('id')
    .eq('procurement_case_id', po.procurement_case_id)
    .maybeSingle();
  if (existing) return { ok: false, error: '此案件已建立過費用申請單' };

  const { data: caseRow } = await db
    .from('procurement_cases')
    .select('case_number')
    .eq('id', po.procurement_case_id)
    .single();
  if (!caseRow) return { ok: false, error: '找不到案件資料' };
  const caseNumber = caseRow.case_number;

  const { data: acceptance } = await db
    .from('acceptances')
    .select('id')
    .eq('purchase_order_id', po.id)
    .eq('status', 'approved')
    .maybeSingle();

  let acceptanceId: string | null = null;
  let sourceItems: SourceItem[] = [];

  if (acceptance) {
    acceptanceId = acceptance.id;
    const { data: items } = await db
      .from('acceptance_items')
      .select('id, purchase_order_item_id, description, amount')
      .eq('acceptance_id', acceptance.id);
    sourceItems = (items ?? []).map((i) => ({
      id: i.id,
      purchase_order_item_id: i.purchase_order_item_id,
      description: i.description,
      amount: Number(i.amount),
    }));
  } else if (po.payment_terms === '預付款') {
    const { data: items } = await db
      .from('purchase_order_items')
      .select('id, description, total_price')
      .eq('purchase_order_id', po.id);
    sourceItems = (items ?? []).map((i) => ({
      id: i.id,
      purchase_order_item_id: i.id,
      description: i.description,
      amount: Number(i.total_price),
    }));
  } else {
    return {
      ok: false,
      error: '此採購單尚未完成驗收，且付款條件非預付款，無法建立費用申請單',
    };
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
    departmentId: po.department_id,
    budgetOwnerEmployeeId: po.budget_owner_employee_id,
    totalAmount,
  });
  if (!chainResult.ok) return { ok: false, error: chainResult.error };
  const chain = chainResult.chain;

  const isAutoApproved = chain.length === 0;
  const { data: expenseRequest, error: expenseError } = await db
    .from('expense_requests')
    .insert({
      procurement_case_id: po.procurement_case_id,
      purchase_order_id: po.id,
      acceptance_id: acceptanceId,
      applicant_employee_id: employee.id,
      department_id: po.department_id,
      budget_owner_employee_id: po.budget_owner_employee_id,
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
  if (expenseError || !expenseRequest) return { ok: false, error: '建立費用申請單失敗' };

  const cleanup = async () => {
    await db
      .from('approval_steps')
      .delete()
      .eq('form_type', 'expense_request')
      .eq('form_id', expenseRequest.id);
    await db
      .from('notifications')
      .delete()
      .eq('form_type', 'expense_request')
      .eq('form_id', expenseRequest.id);
    await db.from('expense_requests').delete().eq('id', expenseRequest.id);
  };

  const { error: itemsError } = await db.from('expense_request_items').insert(
    includedItems.map((i, idx) => ({
      expense_request_id: expenseRequest.id,
      line_no: idx + 1,
      purchase_order_item_id: i.purchase_order_item_id,
      description: i.description,
      amount: i.amount,
    }))
  );
  if (itemsError) {
    await cleanup();
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
      await cleanup();
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
      await cleanup();
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

- [ ] **Step 8: Run the test to verify it passes**

Run: `export $(grep -v '^#' .env.local | xargs) && npm test -- tests/integration/expense-request-create.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 9: Commit**

```bash
git add src/lib/expense-requests tests/integration/expense-request-create.test.ts
git commit -m "feat: add validateExpenseRequestInput and createExpenseRequest"
```

---

## Task 24: 費用申請單 — `approveExpenseRequestStep` + `returnExpenseRequestStep` actions

**Files:**
- Modify: `src/lib/expense-requests/actions.ts`
- Test: `tests/integration/expense-request-approve-return.test.ts`

**Interfaces:**
- Consumes: `notifyAndEmail` (Task 12).
- Produces: `ActionResult`, `async approveExpenseRequestStep(expenseRequestId: string): Promise<ActionResult>`, `async returnExpenseRequestStep(expenseRequestId: string, reason: string): Promise<ActionResult>`. Same shape and `loadCurrentStep` pattern as `purchase-orders/actions.ts` / `acceptances/actions.ts`, adapted to the `expense_requests` table and `'expense_request'` form type.

- [ ] **Step 1: Write the failing integration test**

`tests/integration/expense-request-approve-return.test.ts`:
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

describe.skipIf(!hasIntegrationTestCredentials())('expense request approve/return', () => {
  let admin: ReturnType<typeof createServiceRoleTestClient>;
  let applicantId: string;
  let managerId: string;
  let departmentId: string;
  let supplierId: string;
  const createdCaseIds: string[] = [];
  const createdExpenseIds: string[] = [];

  beforeAll(async () => {
    admin = createServiceRoleTestClient();
    const { data: emps } = await admin
      .from('employees')
      .select('id, department_id')
      .not('department_id', 'is', null)
      .limit(2);
    applicantId = emps![0].id;
    managerId = emps![1].id;
    departmentId = emps![0].department_id;
    const { data: sup } = await admin.from('suppliers').select('id').limit(1).single();
    supplierId = sup!.id;
  });

  async function makeExpenseRequestWithOneStep() {
    const { data: caseNumber } = await admin.rpc('next_case_number');
    const { data: pcase } = await admin
      .from('procurement_cases')
      .insert({ case_number: caseNumber, created_by_employee_id: applicantId })
      .select()
      .single();
    createdCaseIds.push(pcase!.id);
    const { data: expenseRequest } = await admin
      .from('expense_requests')
      .insert({
        procurement_case_id: pcase!.id,
        purchase_order_id: null,
        applicant_employee_id: applicantId,
        department_id: departmentId,
        budget_owner_employee_id: applicantId,
        payee_type: 'supplier',
        payee_supplier_id: supplierId,
        payment_method: '匯款',
        total_amount: 65000,
        current_step_order: 1,
      })
      .select()
      .single();
    createdExpenseIds.push(expenseRequest!.id);
    await admin.from('approval_steps').insert({
      form_type: 'expense_request',
      form_id: expenseRequest!.id,
      step_order: 1,
      approver_employee_id: managerId,
      approver_role: 'department_manager',
    });
    return expenseRequest!.id;
  }

  afterEach(async () => {
    currentEmployee.value = null;
    for (const id of createdExpenseIds.splice(0)) {
      await admin.from('approval_steps').delete().eq('form_type', 'expense_request').eq('form_id', id);
      await admin.from('notifications').delete().eq('form_type', 'expense_request').eq('form_id', id);
      await admin.from('expense_requests').delete().eq('id', id);
    }
    for (const id of createdCaseIds.splice(0)) {
      await admin.from('procurement_cases').delete().eq('id', id);
    }
  });

  it('marks the expense request approved and notifies the applicant on the final approve', async () => {
    const expenseRequestId = await makeExpenseRequestWithOneStep();
    currentEmployee.value = { id: managerId };
    const { approveExpenseRequestStep } = await import('@/lib/expense-requests/actions');
    const result = await approveExpenseRequestStep(expenseRequestId);
    expect(result).toEqual({ ok: true });

    const { data: expenseRequest } = await admin
      .from('expense_requests')
      .select('status, current_step_order')
      .eq('id', expenseRequestId)
      .single();
    expect(expenseRequest).toEqual({ status: 'approved', current_step_order: null });

    const { data: notifs } = await admin
      .from('notifications')
      .select('recipient_employee_id, type')
      .eq('form_type', 'expense_request')
      .eq('form_id', expenseRequestId);
    expect(notifs).toEqual([{ recipient_employee_id: applicantId, type: 'request_approved' }]);
  });

  it('marks the expense request returned with a reason', async () => {
    const expenseRequestId = await makeExpenseRequestWithOneStep();
    currentEmployee.value = { id: managerId };
    const { returnExpenseRequestStep } = await import('@/lib/expense-requests/actions');
    const result = await returnExpenseRequestStep(expenseRequestId, '銀行帳號填寫錯誤');
    expect(result).toEqual({ ok: true });

    const { data: expenseRequest } = await admin
      .from('expense_requests')
      .select('status')
      .eq('id', expenseRequestId)
      .single();
    expect(expenseRequest!.status).toBe('returned');
  });

  it('rejects an approve call from someone who is not the current approver', async () => {
    const expenseRequestId = await makeExpenseRequestWithOneStep();
    currentEmployee.value = { id: applicantId };
    const { approveExpenseRequestStep } = await import('@/lib/expense-requests/actions');
    const result = await approveExpenseRequestStep(expenseRequestId);
    expect(result).toEqual({ ok: false, error: '您不是這張費用申請單目前的簽核人' });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `export $(grep -v '^#' .env.local | xargs) && npm test -- tests/integration/expense-request-approve-return.test.ts`
Expected: FAIL — `approveExpenseRequestStep is not a function`.

- [ ] **Step 3: Implement the actions**

Append to `src/lib/expense-requests/actions.ts`:
```ts
export type ActionResult = { ok: true } | { ok: false; error: string };

type LoadStepResult =
  | { error: string }
  | {
      expenseRequest: { id: string; applicant_employee_id: string; procurement_case_id: string };
      step: { id: string; step_order: number; approver_employee_id: string };
    };

async function loadCurrentStep(
  db: ReturnType<typeof createSupabaseServiceRoleClient>,
  expenseRequestId: string,
  callerId: string
): Promise<LoadStepResult> {
  const { data: expenseRequest } = await db
    .from('expense_requests')
    .select('id, applicant_employee_id, status, current_step_order, procurement_case_id')
    .eq('id', expenseRequestId)
    .maybeSingle();
  if (
    !expenseRequest ||
    expenseRequest.status !== 'pending_approval' ||
    expenseRequest.current_step_order === null
  ) {
    return { error: '這張費用申請單目前不在簽核中' };
  }
  const { data: step } = await db
    .from('approval_steps')
    .select('id, step_order, approver_employee_id')
    .eq('form_type', 'expense_request')
    .eq('form_id', expenseRequestId)
    .eq('step_order', expenseRequest.current_step_order)
    .maybeSingle();
  if (!step || step.approver_employee_id !== callerId) {
    return { error: '您不是這張費用申請單目前的簽核人' };
  }
  return { expenseRequest, step };
}

export async function approveExpenseRequestStep(expenseRequestId: string): Promise<ActionResult> {
  const employee = await getCurrentEmployee(await createSupabaseServerClient());
  if (!employee) return { ok: false, error: '找不到您的員工資料' };
  const db = createSupabaseServiceRoleClient();

  const loaded = await loadCurrentStep(db, expenseRequestId, employee.id);
  if ('error' in loaded) return { ok: false, error: loaded.error };
  const { expenseRequest, step } = loaded;

  await db
    .from('approval_steps')
    .update({ status: 'approved', acted_at: new Date().toISOString() })
    .eq('id', step.id);

  await db
    .from('notifications')
    .update({ is_read: true })
    .eq('recipient_employee_id', employee.id)
    .eq('form_type', 'expense_request')
    .eq('form_id', expenseRequestId)
    .eq('type', 'approval_requested')
    .eq('is_read', false);

  const { data: caseRow } = await db
    .from('procurement_cases')
    .select('case_number')
    .eq('id', expenseRequest.procurement_case_id)
    .single();
  const caseNumber = caseRow!.case_number;

  const { data: nextStep } = await db
    .from('approval_steps')
    .select('step_order, approver_employee_id')
    .eq('form_type', 'expense_request')
    .eq('form_id', expenseRequestId)
    .eq('step_order', step.step_order + 1)
    .maybeSingle();

  if (nextStep) {
    await db
      .from('expense_requests')
      .update({ current_step_order: nextStep.step_order, updated_at: new Date().toISOString() })
      .eq('id', expenseRequestId);
    await notifyAndEmail(db, {
      recipientEmployeeId: nextStep.approver_employee_id,
      type: 'approval_requested',
      formType: 'expense_request',
      formId: expenseRequestId,
      caseNumber,
      message: `費用申請單 ${caseNumber} 待您簽核`,
    });
  } else {
    await db
      .from('expense_requests')
      .update({ status: 'approved', current_step_order: null, updated_at: new Date().toISOString() })
      .eq('id', expenseRequestId);
    await notifyAndEmail(db, {
      recipientEmployeeId: expenseRequest.applicant_employee_id,
      type: 'request_approved',
      formType: 'expense_request',
      formId: expenseRequestId,
      caseNumber,
      message: `費用申請單 ${caseNumber} 已完成簽核`,
    });
  }

  revalidatePath('/approvals');
  revalidatePath(`/expense-requests/${expenseRequestId}`);
  return { ok: true };
}

export async function returnExpenseRequestStep(
  expenseRequestId: string,
  reason: string
): Promise<ActionResult> {
  const employee = await getCurrentEmployee(await createSupabaseServerClient());
  if (!employee) return { ok: false, error: '找不到您的員工資料' };
  if (reason.trim() === '') return { ok: false, error: '請填寫退回原因' };
  const db = createSupabaseServiceRoleClient();

  const loaded = await loadCurrentStep(db, expenseRequestId, employee.id);
  if ('error' in loaded) return { ok: false, error: loaded.error };
  const { expenseRequest, step } = loaded;

  await db
    .from('approval_steps')
    .update({ status: 'returned', comment: reason, acted_at: new Date().toISOString() })
    .eq('id', step.id);

  await db
    .from('notifications')
    .update({ is_read: true })
    .eq('recipient_employee_id', employee.id)
    .eq('form_type', 'expense_request')
    .eq('form_id', expenseRequestId)
    .eq('type', 'approval_requested')
    .eq('is_read', false);

  await db
    .from('expense_requests')
    .update({ status: 'returned', current_step_order: null, updated_at: new Date().toISOString() })
    .eq('id', expenseRequestId);

  const { data: caseRow } = await db
    .from('procurement_cases')
    .select('case_number')
    .eq('id', expenseRequest.procurement_case_id)
    .single();

  await notifyAndEmail(db, {
    recipientEmployeeId: expenseRequest.applicant_employee_id,
    type: 'request_returned',
    formType: 'expense_request',
    formId: expenseRequestId,
    caseNumber: caseRow!.case_number,
    message: `費用申請單 ${caseRow!.case_number} 已被退回：${reason}`,
  });

  revalidatePath('/approvals');
  revalidatePath(`/expense-requests/${expenseRequestId}`);
  return { ok: true };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `export $(grep -v '^#' .env.local | xargs) && npm test -- tests/integration/expense-request-approve-return.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/expense-requests/actions.ts tests/integration/expense-request-approve-return.test.ts
git commit -m "feat: add approveExpenseRequestStep and returnExpenseRequestStep"
```

---

## Task 25: 費用申請單 — `resubmitExpenseRequest` action + transactional SQL function

**Files:**
- Create: `supabase/migrations/<timestamp>_resubmit_expense_request_tx.sql`
- Modify: `src/lib/expense-requests/actions.ts`
- Test: `tests/integration/expense-request-resubmit.test.ts`

**Interfaces:**
- Consumes: SQL function `resubmit_expense_request(...)`.
- Produces: `ResubmitExpenseRequestInput = { payeeType: 'employee' | 'supplier'; payeeSupplierId: string | null; paymentMethod: string; bankName: string | null; bankAccount: string | null; accountName: string | null; invoiceMonth: string | null; expectedPaymentDate: string | null; includedSourceItemIds: string[] }` and `async resubmitExpenseRequest(expenseRequestId: string, input: ResubmitExpenseRequestInput): Promise<ActionResult>`.

**Design note:** the source (`acceptance_items` vs `purchase_order_items`, driven by whether `acceptance_id` was set at creation) is **not** re-derived on resubmit — it stays whatever was fixed at creation time, since `acceptance_id` is immutable on the row. Only which items are `included`, the payee, and the payment fields (and therefore `total_amount`/`payment_batch_date`) can change.

- [ ] **Step 1: Write the failing integration test**

`tests/integration/expense-request-resubmit.test.ts`:
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

describe.skipIf(!hasIntegrationTestCredentials())('resubmitExpenseRequest', () => {
  let admin: ReturnType<typeof createServiceRoleTestClient>;
  let applicantId: string;
  let managerId: string;
  let departmentId: string;
  let budgetCodeId: string;
  let supplierId: string;
  const createdCaseIds: string[] = [];
  const createdOrderIds: string[] = [];
  const createdExpenseIds: string[] = [];

  beforeAll(async () => {
    admin = createServiceRoleTestClient();
    const { data: emps } = await admin
      .from('employees')
      .select('id, department_id')
      .not('department_id', 'is', null)
      .limit(2);
    applicantId = emps![0].id;
    managerId = emps![1].id;
    departmentId = emps![0].department_id;
    const { data: bc } = await admin.from('budget_codes').select('id').limit(1).single();
    budgetCodeId = bc!.id;
    const { data: sup } = await admin.from('suppliers').select('id').limit(1).single();
    supplierId = sup!.id;
    await admin.from('departments').update({ manager_employee_id: managerId }).eq('id', departmentId);
  });

  afterEach(async () => {
    currentEmployee.value = null;
    for (const id of createdExpenseIds.splice(0)) {
      await admin.from('approval_steps').delete().eq('form_type', 'expense_request').eq('form_id', id);
      await admin.from('notifications').delete().eq('form_type', 'expense_request').eq('form_id', id);
      await admin.from('expense_requests').delete().eq('id', id);
    }
    for (const id of createdOrderIds.splice(0)) {
      await admin.from('purchase_orders').delete().eq('id', id);
    }
    for (const id of createdCaseIds.splice(0)) {
      await admin.from('procurement_cases').delete().eq('id', id);
    }
  });

  it('replaces items and approval steps, recomputes totals, and resets to pending_approval', async () => {
    const { data: caseNumber } = await admin.rpc('next_case_number');
    const { data: pcase } = await admin
      .from('procurement_cases')
      .insert({ case_number: caseNumber, created_by_employee_id: applicantId })
      .select()
      .single();
    createdCaseIds.push(pcase!.id);
    const { data: po } = await admin
      .from('purchase_orders')
      .insert({
        procurement_case_id: pcase!.id,
        purchase_request_id: null,
        applicant_employee_id: applicantId,
        department_id: departmentId,
        budget_owner_employee_id: applicantId,
        supplier_id: supplierId,
        payment_method: '匯款',
        payment_terms: '預付款',
        total_amount: 65000,
        status: 'approved',
      })
      .select()
      .single();
    createdOrderIds.push(po!.id);
    const { data: poItem } = await admin
      .from('purchase_order_items')
      .insert({
        purchase_order_id: po!.id,
        line_no: 1,
        budget_code_id: budgetCodeId,
        item_category: '材料',
        description: '材料A',
        quantity: 1,
        unit_price: 65000,
        total_price: 65000,
      })
      .select()
      .single();
    const { data: expenseRequest } = await admin
      .from('expense_requests')
      .insert({
        procurement_case_id: pcase!.id,
        purchase_order_id: po!.id,
        acceptance_id: null,
        applicant_employee_id: applicantId,
        department_id: departmentId,
        budget_owner_employee_id: applicantId,
        payee_type: 'supplier',
        payee_supplier_id: supplierId,
        payment_method: '匯款',
        total_amount: 65000,
        status: 'returned',
      })
      .select()
      .single();
    createdExpenseIds.push(expenseRequest!.id);

    currentEmployee.value = { id: applicantId };
    const { resubmitExpenseRequest } = await import('@/lib/expense-requests/actions');
    const result = await resubmitExpenseRequest(expenseRequest!.id, {
      payeeType: 'supplier',
      payeeSupplierId: supplierId,
      paymentMethod: '匯款',
      bankName: null,
      bankAccount: null,
      accountName: null,
      invoiceMonth: '2026-07',
      expectedPaymentDate: null,
      includedSourceItemIds: [poItem!.id],
    });
    expect(result).toEqual({ ok: true });

    const { data: updated } = await admin
      .from('expense_requests')
      .select('status, current_step_order, payment_batch_date, total_amount')
      .eq('id', expenseRequest!.id)
      .single();
    expect(updated!.status).toBe('pending_approval');
    expect(updated!.current_step_order).toBe(1);
    expect(updated!.payment_batch_date).toBe('2026-08-25');
    expect(Number(updated!.total_amount)).toBe(65000);

    const { data: steps } = await admin
      .from('approval_steps')
      .select('step_order, approver_employee_id')
      .eq('form_type', 'expense_request')
      .eq('form_id', expenseRequest!.id)
      .order('step_order');
    expect(steps!.length).toBeGreaterThanOrEqual(1);
    expect(steps![0].approver_employee_id).toBe(managerId);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `export $(grep -v '^#' .env.local | xargs) && npm test -- tests/integration/expense-request-resubmit.test.ts`
Expected: FAIL — `resubmitExpenseRequest is not a function`.

- [ ] **Step 3: Create and write the SQL transaction function**

Run: `supabase migration new resubmit_expense_request_tx`. Write:
```sql
create or replace function resubmit_expense_request(
  p_expense_request_id uuid,
  p_payee_type text,
  p_payee_supplier uuid,
  p_payment_method text,
  p_bank_name text,
  p_bank_account text,
  p_account_name text,
  p_invoice_month text,
  p_expected_payment_date date,
  p_payment_batch_date date,
  p_total numeric,
  p_items jsonb,
  p_steps jsonb
) returns void
language plpgsql
as $$
begin
  delete from expense_request_items where expense_request_id = p_expense_request_id;
  delete from approval_steps
    where form_type = 'expense_request' and form_id = p_expense_request_id;

  insert into expense_request_items
    (expense_request_id, line_no, purchase_order_item_id, description, amount)
  select p_expense_request_id,
         (e->>'line_no')::int,
         (e->>'purchase_order_item_id')::uuid,
         e->>'description',
         (e->>'amount')::numeric
  from jsonb_array_elements(p_items) e;

  insert into approval_steps
    (form_type, form_id, step_order, approver_employee_id, approver_role)
  select 'expense_request',
         p_expense_request_id,
         (s->>'step_order')::int,
         (s->>'approver_employee_id')::uuid,
         s->>'approver_role'
  from jsonb_array_elements(p_steps) s;

  update expense_requests
     set payee_type = p_payee_type,
         payee_supplier_id = p_payee_supplier,
         payment_method = p_payment_method,
         bank_name = p_bank_name,
         bank_account = p_bank_account,
         account_name = p_account_name,
         invoice_month = p_invoice_month,
         expected_payment_date = p_expected_payment_date,
         payment_batch_date = p_payment_batch_date,
         total_amount = p_total,
         status = 'pending_approval',
         current_step_order = 1,
         updated_at = now()
   where id = p_expense_request_id;
end;
$$;
```

- [ ] **Step 4: Apply the migration**

Run: `export $(grep -v '^#' .env.local | xargs) && supabase db push`

- [ ] **Step 5: Implement `resubmitExpenseRequest`**

Append to `src/lib/expense-requests/actions.ts`:
```ts
export type ResubmitExpenseRequestInput = {
  payeeType: 'employee' | 'supplier';
  payeeSupplierId: string | null;
  paymentMethod: string;
  bankName: string | null;
  bankAccount: string | null;
  accountName: string | null;
  invoiceMonth: string | null;
  expectedPaymentDate: string | null;
  includedSourceItemIds: string[];
};

export async function resubmitExpenseRequest(
  expenseRequestId: string,
  input: ResubmitExpenseRequestInput
): Promise<ActionResult> {
  const employee = await getCurrentEmployee(await createSupabaseServerClient());
  if (!employee) return { ok: false, error: '找不到您的員工資料' };
  const db = createSupabaseServiceRoleClient();

  const { data: expenseRequest } = await db
    .from('expense_requests')
    .select(
      'id, applicant_employee_id, status, department_id, budget_owner_employee_id, procurement_case_id, purchase_order_id, acceptance_id'
    )
    .eq('id', expenseRequestId)
    .maybeSingle();
  if (!expenseRequest) return { ok: false, error: '找不到這張費用申請單' };
  if (expenseRequest.applicant_employee_id !== employee.id) {
    return { ok: false, error: '只有申請人可以重新送出這張費用申請單' };
  }
  if (expenseRequest.status !== 'returned') {
    return { ok: false, error: '只有被退回的費用申請單可以重新送出' };
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
  } else {
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
    return { ok: false, error: '重新送出後找不到適用的簽核人，請聯絡系統管理員' };
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
  if (txError) return { ok: false, error: '重新送出失敗，請稍後再試' };

  const { data: caseRow } = await db
    .from('procurement_cases')
    .select('case_number')
    .eq('id', expenseRequest.procurement_case_id)
    .single();
  await notifyAndEmail(db, {
    recipientEmployeeId: chain[0].approverEmployeeId,
    type: 'approval_requested',
    formType: 'expense_request',
    formId: expenseRequestId,
    caseNumber: caseRow!.case_number,
    message: `費用申請單 ${caseRow!.case_number} 已重新送出，待您簽核`,
  });

  revalidatePath('/approvals');
  revalidatePath(`/expense-requests/${expenseRequestId}`);
  return { ok: true };
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `export $(grep -v '^#' .env.local | xargs) && npm test -- tests/integration/expense-request-resubmit.test.ts`
Expected: PASS (1 test).

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations src/lib/expense-requests/actions.ts tests/integration/expense-request-resubmit.test.ts
git commit -m "feat: add resubmitExpenseRequest and its transactional SQL function"
```

---

## Task 26: 費用申請單 — query helpers + pages

**Files:**
- Create: `src/lib/expense-requests/queries.ts`
- Create: `src/app/expense-requests/page.tsx`
- Create: `src/app/expense-requests/new/page.tsx` + `expense-request-form.tsx` (client)
- Create: `src/app/expense-requests/[id]/page.tsx` + `approval-actions.tsx` (client)
- Modify: `src/app/purchase-orders/[id]/page.tsx` (add a "建立費用申請單" link when eligible)
- Test: `tests/integration/expense-request-queries.test.ts`

**Interfaces:**
- Consumes: `createSupabaseServerClient`, `getCurrentEmployee`, `AttachmentsPanel`, `getAttachments`, `createExpenseRequest`/`approveExpenseRequestStep`/`returnExpenseRequestStep` (Tasks 23–24), `checkPaymentTermsConsistency` (Task 8).
- Produces: `ExpenseRequestSummary`, `ExpenseRequestDetail` (carries `payeeName`, `paymentBatchDate`, `purchaseOrderPaymentTerms`, and `paymentTermsConsistent: boolean` computed via `checkPaymentTermsConsistency`), `EligiblePurchaseOrderForExpense = { id, caseNumber, paymentTerms, sourceItems: { id, description, amount }[] }` (`sourceItems` come from the approved acceptance if one exists, else — only when `paymentTerms === '預付款'` — from the purchase order itself, mirroring `createExpenseRequest`'s own source-selection logic), `ExpenseRequestQueueItem`, and `getMyExpenseRequests()`, `getExpenseRequestDetail(expenseRequestId)`, `getEligiblePurchaseOrdersForExpenseRequest()`, `getMyExpenseRequestApprovalQueue()`.

**Design note:** there is no separate "payee employee" column — when `payeeType === 'employee'` the payee is always the applicant themselves (matches the spec's 員工代墊 wording, where the person submitting the claim is the one being reimbursed). `payeeName` is therefore either the linked supplier's name or the applicant's own name.

- [ ] **Step 1: Write the failing integration test**

`tests/integration/expense-request-queries.test.ts`:
```ts
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  createServiceRoleTestClient,
  hasIntegrationTestCredentials,
} from './supabase-test-client';

const currentEmployee = vi.hoisted(() => ({ value: null as null | { id: string } }));
vi.mock('@/lib/auth/current-employee', () => ({
  getCurrentEmployee: async () => currentEmployee.value,
}));
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => {
    const { createServiceRoleTestClient } = await import('./supabase-test-client');
    return createServiceRoleTestClient();
  },
}));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

describe.skipIf(!hasIntegrationTestCredentials())('expense request queries', () => {
  let admin: ReturnType<typeof createServiceRoleTestClient>;
  let applicantId: string;
  let departmentId: string;
  let budgetCodeId: string;
  let supplierId: string;
  let orderId: string;
  let expenseRequestId: string;

  beforeAll(async () => {
    admin = createServiceRoleTestClient();
    const { data: emp } = await admin
      .from('employees')
      .select('id, department_id')
      .not('department_id', 'is', null)
      .limit(1)
      .single();
    applicantId = emp!.id;
    departmentId = emp!.department_id;
    const { data: bc } = await admin.from('budget_codes').select('id').limit(1).single();
    budgetCodeId = bc!.id;
    const { data: sup } = await admin.from('suppliers').select('id').limit(1).single();
    supplierId = sup!.id;

    const { data: caseNumber } = await admin.rpc('next_case_number');
    const { data: pcase } = await admin
      .from('procurement_cases')
      .insert({ case_number: caseNumber, created_by_employee_id: applicantId })
      .select()
      .single();
    const { data: po } = await admin
      .from('purchase_orders')
      .insert({
        procurement_case_id: pcase!.id,
        purchase_request_id: null,
        applicant_employee_id: applicantId,
        department_id: departmentId,
        budget_owner_employee_id: applicantId,
        supplier_id: supplierId,
        payment_method: '匯款',
        payment_terms: '預付款',
        total_amount: 65000,
        status: 'approved',
      })
      .select()
      .single();
    orderId = po!.id;
    const { data: poItem } = await admin
      .from('purchase_order_items')
      .insert({
        purchase_order_id: orderId,
        line_no: 1,
        budget_code_id: budgetCodeId,
        item_category: '材料',
        description: '查詢測試',
        quantity: 1,
        unit_price: 65000,
        total_price: 65000,
      })
      .select()
      .single();

    currentEmployee.value = { id: applicantId };
    const actions = await import('@/lib/expense-requests/actions');
    const created = await actions.createExpenseRequest({
      purchaseOrderId: orderId,
      payeeType: 'supplier',
      payeeSupplierId: supplierId,
      paymentMethod: '匯款',
      bankName: null,
      bankAccount: null,
      accountName: null,
      invoiceMonth: '2026-07',
      expectedPaymentDate: null,
      includedSourceItemIds: [poItem!.id],
    });
    if (!created.ok) throw new Error(created.error);
    expenseRequestId = created.expenseRequestId;
  });

  afterAll(async () => {
    await admin.from('approval_steps').delete().eq('form_id', expenseRequestId);
    await admin.from('notifications').delete().eq('form_id', expenseRequestId);
    await admin.from('expense_requests').delete().eq('id', expenseRequestId);
    const { data: po } = await admin
      .from('purchase_orders')
      .select('procurement_case_id')
      .eq('id', orderId)
      .maybeSingle();
    await admin.from('purchase_orders').delete().eq('id', orderId);
    if (po?.procurement_case_id) {
      await admin.from('procurement_cases').delete().eq('id', po.procurement_case_id);
    }
    currentEmployee.value = null;
  });

  it('getMyExpenseRequests returns the applicant’s expense request', async () => {
    currentEmployee.value = { id: applicantId };
    const { getMyExpenseRequests } = await import('@/lib/expense-requests/queries');
    const rows = await getMyExpenseRequests();
    expect(rows.some((r) => r.id === expenseRequestId)).toBe(true);
  });

  it('getExpenseRequestDetail returns the payee name, batch date, and items', async () => {
    const { getExpenseRequestDetail } = await import('@/lib/expense-requests/queries');
    const detail = await getExpenseRequestDetail(expenseRequestId);
    expect(detail).not.toBeNull();
    expect(detail!.payeeName).toBeTruthy();
    expect(detail!.paymentBatchDate).toBe('2026-08-25');
    expect(detail!.items).toHaveLength(1);
    expect(detail!.items[0].description).toBe('查詢測試');
  });

  it('getEligiblePurchaseOrdersForExpenseRequest excludes an order that already has an expense request', async () => {
    const { getEligiblePurchaseOrdersForExpenseRequest } = await import(
      '@/lib/expense-requests/queries'
    );
    const eligible = await getEligiblePurchaseOrdersForExpenseRequest();
    expect(eligible.some((o) => o.id === orderId)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `export $(grep -v '^#' .env.local | xargs) && npm test -- tests/integration/expense-request-queries.test.ts`
Expected: FAIL — `Cannot find module '@/lib/expense-requests/queries'`.

- [ ] **Step 3: Implement the query helpers**

`src/lib/expense-requests/queries.ts`:
```ts
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { checkPaymentTermsConsistency } from '@/lib/procurement/payment-terms';

export type ExpenseRequestSummary = {
  id: string;
  caseNumber: string;
  status: string;
  totalAmount: number;
};

export type ExpenseRequestDetailItem = {
  lineNo: number;
  description: string;
  amount: number;
};

export type ExpenseRequestDetailStep = {
  stepOrder: number;
  approverEmployeeId: string;
  approverName: string;
  approverRole: string;
  status: string;
  comment: string | null;
};

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
  applicantName: string;
  departmentName: string;
  currentStepOrder: number | null;
  purchaseOrderPaymentTerms: string;
  paymentTermsConsistent: boolean;
  items: ExpenseRequestDetailItem[];
  steps: ExpenseRequestDetailStep[];
};

export type EligibleSourceItem = { id: string; description: string; amount: number };

export type EligiblePurchaseOrderForExpense = {
  id: string;
  caseNumber: string;
  paymentTerms: string;
  sourceItems: EligibleSourceItem[];
};

export type ExpenseRequestQueueItem = {
  id: string;
  caseNumber: string;
  applicantName: string;
  totalAmount: number;
};

export async function getMyExpenseRequests(): Promise<ExpenseRequestSummary[]> {
  const supabase = await createSupabaseServerClient();
  const employee = await getCurrentEmployee(supabase);
  if (!employee) return [];
  const { data } = await supabase
    .from('expense_requests')
    .select('id, total_amount, status, procurement_cases(case_number)')
    .eq('applicant_employee_id', employee.id)
    .order('created_at', { ascending: false });
  return (data ?? []).map((e) => ({
    id: e.id,
    caseNumber: (e.procurement_cases as unknown as { case_number: string }).case_number,
    status: e.status,
    totalAmount: Number(e.total_amount),
  }));
}

export async function getExpenseRequestDetail(
  expenseRequestId: string
): Promise<ExpenseRequestDetail | null> {
  const supabase = await createSupabaseServerClient();
  const { data: expenseRequest } = await supabase
    .from('expense_requests')
    .select(
      'id, total_amount, status, payee_type, payment_method, bank_name, bank_account, account_name, invoice_month, expected_payment_date, payment_batch_date, current_step_order, procurement_cases(case_number), applicant:employees!applicant_employee_id(name), departments(name), payee_supplier:suppliers!payee_supplier_id(name), purchase_orders(payment_terms, updated_at)'
    )
    .eq('id', expenseRequestId)
    .maybeSingle();
  if (!expenseRequest) return null;

  const { data: items } = await supabase
    .from('expense_request_items')
    .select('line_no, description, amount')
    .eq('expense_request_id', expenseRequestId)
    .order('line_no');

  const { data: steps } = await supabase
    .from('approval_steps')
    .select(
      'step_order, approver_role, status, comment, approver_employee_id, approver:employees!approver_employee_id(name)'
    )
    .eq('form_type', 'expense_request')
    .eq('form_id', expenseRequestId)
    .order('step_order');

  const applicantName = (expenseRequest.applicant as unknown as { name: string }).name;
  const payeeSupplier = expenseRequest.payee_supplier as unknown as { name: string } | null;
  const order = expenseRequest.purchase_orders as unknown as {
    payment_terms: string;
    updated_at: string;
  };

  const consistency = checkPaymentTermsConsistency({
    paymentTerms: order.payment_terms,
    orderApprovedDate: order.updated_at.slice(0, 10),
    expectedPaymentDate: expenseRequest.expected_payment_date,
  });

  return {
    id: expenseRequest.id,
    caseNumber: (expenseRequest.procurement_cases as unknown as { case_number: string })
      .case_number,
    status: expenseRequest.status,
    totalAmount: Number(expenseRequest.total_amount),
    payeeType: expenseRequest.payee_type as 'employee' | 'supplier',
    payeeName: payeeSupplier?.name ?? applicantName,
    paymentMethod: expenseRequest.payment_method,
    bankName: expenseRequest.bank_name,
    bankAccount: expenseRequest.bank_account,
    accountName: expenseRequest.account_name,
    invoiceMonth: expenseRequest.invoice_month,
    expectedPaymentDate: expenseRequest.expected_payment_date,
    paymentBatchDate: expenseRequest.payment_batch_date,
    applicantName,
    departmentName: (expenseRequest.departments as unknown as { name: string }).name,
    currentStepOrder: expenseRequest.current_step_order,
    purchaseOrderPaymentTerms: order.payment_terms,
    paymentTermsConsistent: consistency.consistent,
    items: (items ?? []).map((i) => ({
      lineNo: i.line_no,
      description: i.description,
      amount: Number(i.amount),
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
}

export async function getEligiblePurchaseOrdersForExpenseRequest(): Promise<
  EligiblePurchaseOrderForExpense[]
> {
  const supabase = await createSupabaseServerClient();
  const employee = await getCurrentEmployee(supabase);
  if (!employee) return [];

  const { data: orders } = await supabase
    .from('purchase_orders')
    .select('id, payment_terms, procurement_cases(case_number)')
    .eq('applicant_employee_id', employee.id)
    .eq('status', 'approved');
  if (!orders || orders.length === 0) return [];

  const { data: existingExpenseRequests } = await supabase
    .from('expense_requests')
    .select('purchase_order_id')
    .in(
      'purchase_order_id',
      orders.map((o) => o.id)
    );
  const takenIds = new Set((existingExpenseRequests ?? []).map((e) => e.purchase_order_id));
  const remaining = orders.filter((o) => !takenIds.has(o.id));

  const result: EligiblePurchaseOrderForExpense[] = [];
  for (const o of remaining) {
    const { data: acceptance } = await supabase
      .from('acceptances')
      .select('id')
      .eq('purchase_order_id', o.id)
      .eq('status', 'approved')
      .maybeSingle();

    let sourceItems: EligibleSourceItem[] = [];
    if (acceptance) {
      const { data: items } = await supabase
        .from('acceptance_items')
        .select('id, description, amount')
        .eq('acceptance_id', acceptance.id);
      sourceItems = (items ?? []).map((i) => ({
        id: i.id,
        description: i.description,
        amount: Number(i.amount),
      }));
    } else if (o.payment_terms === '預付款') {
      const { data: items } = await supabase
        .from('purchase_order_items')
        .select('id, description, total_price')
        .eq('purchase_order_id', o.id);
      sourceItems = (items ?? []).map((i) => ({
        id: i.id,
        description: i.description,
        amount: Number(i.total_price),
      }));
    } else {
      continue;
    }

    result.push({
      id: o.id,
      caseNumber: (o.procurement_cases as unknown as { case_number: string }).case_number,
      paymentTerms: o.payment_terms,
      sourceItems,
    });
  }
  return result;
}

export async function getMyExpenseRequestApprovalQueue(): Promise<ExpenseRequestQueueItem[]> {
  const supabase = await createSupabaseServerClient();
  const employee = await getCurrentEmployee(supabase);
  if (!employee) return [];
  const { data: steps } = await supabase
    .from('approval_steps')
    .select('form_id, step_order')
    .eq('form_type', 'expense_request')
    .eq('approver_employee_id', employee.id)
    .eq('status', 'pending');
  const formIds = (steps ?? []).map((s) => s.form_id);
  if (formIds.length === 0) return [];
  const { data: expenseRequests } = await supabase
    .from('expense_requests')
    .select(
      'id, total_amount, current_step_order, status, procurement_cases(case_number), applicant:employees!applicant_employee_id(name)'
    )
    .in('id', formIds)
    .eq('status', 'pending_approval');
  const stepOrderByForm = new Map((steps ?? []).map((s) => [s.form_id, s.step_order]));
  return (expenseRequests ?? [])
    .filter((e) => e.current_step_order === stepOrderByForm.get(e.id))
    .map((e) => ({
      id: e.id,
      caseNumber: (e.procurement_cases as unknown as { case_number: string }).case_number,
      applicantName: (e.applicant as unknown as { name: string }).name,
      totalAmount: Number(e.total_amount),
    }));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `export $(grep -v '^#' .env.local | xargs) && npm test -- tests/integration/expense-request-queries.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Write the list page**

`src/app/expense-requests/page.tsx`:
```tsx
import Link from 'next/link';
import { getMyExpenseRequests } from '@/lib/expense-requests/queries';

const STATUS_LABELS: Record<string, string> = {
  pending_approval: '簽核中',
  approved: '已核准',
  returned: '已退回（待修改）',
};

export default async function ExpenseRequestsPage() {
  const expenseRequests = await getMyExpenseRequests();
  return (
    <main className="mx-auto max-w-4xl p-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">我的費用申請單</h1>
        <Link href="/expense-requests/new" className="rounded bg-blue-600 px-3 py-1 text-sm text-white">
          + 新增費用申請單
        </Link>
      </div>
      {expenseRequests.length === 0 ? (
        <p className="text-gray-500">尚無費用申請單。</p>
      ) : (
        <table className="w-full border text-sm">
          <thead>
            <tr className="bg-gray-100">
              <th className="border p-2">案件單號</th>
              <th className="border p-2">狀態</th>
              <th className="border p-2">總計</th>
            </tr>
          </thead>
          <tbody>
            {expenseRequests.map((e) => (
              <tr key={e.id}>
                <td className="border p-2">
                  <Link href={`/expense-requests/${e.id}`} className="text-blue-600 underline">
                    {e.caseNumber}
                  </Link>
                </td>
                <td className="border p-2">{STATUS_LABELS[e.status] ?? e.status}</td>
                <td className="border p-2 text-right">{e.totalAmount.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
```

- [ ] **Step 6: Write the create page + form**

`src/app/expense-requests/new/page.tsx`:
```tsx
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { getEligiblePurchaseOrdersForExpenseRequest } from '@/lib/expense-requests/queries';
import { ExpenseRequestForm } from './expense-request-form';

export default async function NewExpenseRequestPage({
  searchParams,
}: {
  searchParams: Promise<{ orderId?: string }>;
}) {
  const { orderId } = await searchParams;
  const supabase = await createSupabaseServerClient();
  const employee = await getCurrentEmployee(supabase);
  if (!employee) redirect('/login');

  const eligible = await getEligiblePurchaseOrdersForExpenseRequest();

  if (!orderId) {
    return (
      <main className="mx-auto max-w-2xl p-8">
        <h1 className="mb-6 text-2xl font-bold">新增費用申請單</h1>
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

`src/app/expense-requests/new/expense-request-form.tsx`:
```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createExpenseRequest } from '@/lib/expense-requests/actions';

export function ExpenseRequestForm({
  purchaseOrderId,
  sourceItems,
  suppliers,
}: {
  purchaseOrderId: string;
  sourceItems: { id: string; description: string; amount: number }[];
  suppliers: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [payeeType, setPayeeType] = useState<'employee' | 'supplier'>('supplier');
  const [payeeSupplierId, setPayeeSupplierId] = useState(suppliers[0]?.id ?? '');
  const [paymentMethod, setPaymentMethod] = useState('匯款');
  const [bankName, setBankName] = useState('');
  const [bankAccount, setBankAccount] = useState('');
  const [accountName, setAccountName] = useState('');
  const [invoiceMonth, setInvoiceMonth] = useState('');
  const [expectedPaymentDate, setExpectedPaymentDate] = useState('');
  const [included, setIncluded] = useState<Record<string, boolean>>(
    Object.fromEntries(sourceItems.map((i) => [i.id, true]))
  );
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const total = sourceItems.filter((i) => included[i.id]).reduce((sum, i) => sum + i.amount, 0);

  const onSubmit = async () => {
    setError(null);
    setSubmitting(true);
    const result = await createExpenseRequest({
      purchaseOrderId,
      payeeType,
      payeeSupplierId: payeeType === 'supplier' ? payeeSupplierId : null,
      paymentMethod,
      bankName: payeeType === 'employee' ? bankName : null,
      bankAccount: payeeType === 'employee' ? bankAccount : null,
      accountName: payeeType === 'employee' ? accountName : null,
      invoiceMonth: invoiceMonth.trim() === '' ? null : invoiceMonth,
      expectedPaymentDate: expectedPaymentDate.trim() === '' ? null : expectedPaymentDate,
      includedSourceItemIds: sourceItems.filter((i) => included[i.id]).map((i) => i.id),
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
        發票月份（YYYY-MM，未填期望付款日時用來推算預設日期）：
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

      <div className="space-y-2">
        {sourceItems.map((item) => (
          <label key={item.id} className="flex items-center gap-2 rounded border p-3 text-sm">
            <input
              type="checkbox"
              checked={included[item.id] ?? false}
              onChange={(e) => setIncluded((prev) => ({ ...prev, [item.id]: e.target.checked }))}
            />
            <span className="flex-1">{item.description}</span>
            <span>NT$ {item.amount.toLocaleString()}</span>
          </label>
        ))}
      </div>

      <p className="text-right font-semibold">總計：NT$ {total.toLocaleString()}</p>

      <p className="rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-700">
        送出前請自行核對發票/收據買受人抬頭：「台灣智慧駕駛股份有限公司」統編 50773141（國外廠商為
        TURING DRIVE INC.）。系統無法自動判讀單據影像內容，僅提醒您自行檢查。
      </p>

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

- [ ] **Step 7: Write the detail page + approval actions**

`src/app/expense-requests/[id]/approval-actions.tsx`: same shape as `src/app/purchase-orders/[id]/approval-actions.tsx` (Task 18, Step 7), importing `approveExpenseRequestStep`/`returnExpenseRequestStep` from `@/lib/expense-requests/actions` and taking an `expenseRequestId` prop.

`src/app/expense-requests/[id]/page.tsx`:
```tsx
import { notFound } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { getExpenseRequestDetail } from '@/lib/expense-requests/queries';
import { getAttachments } from '@/lib/attachments/queries';
import { AttachmentsPanel } from '@/app/components/attachments-panel';
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

export default async function ExpenseRequestDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const detail = await getExpenseRequestDetail(id);
  if (!detail) notFound();

  const supabase = await createSupabaseServerClient();
  const employee = await getCurrentEmployee(supabase);
  const attachments = await getAttachments('expense_request', id);

  const currentStep =
    detail.status === 'pending_approval' && detail.currentStepOrder !== null
      ? detail.steps.find((s) => s.stepOrder === detail.currentStepOrder)
      : undefined;
  const isCurrentApprover =
    !!employee && !!currentStep && currentStep.approverEmployeeId === employee.id;

  return (
    <main className="mx-auto max-w-4xl space-y-4 p-8">
      <div>
        <h1 className="mb-1 text-2xl font-bold">費用申請單</h1>
        <p className="font-mono text-gray-600">{detail.caseNumber}（項次 D1）</p>
      </div>

      <section className="rounded border p-4 text-sm">
        <p>申請單位：{detail.departmentName}</p>
        <p>申請人：{detail.applicantName}</p>
        <p>
          付款對象：{detail.payeeType === 'supplier' ? '廠商' : '員工代墊'}｜{detail.payeeName}
        </p>
        <p>付款方式：{detail.paymentMethod}</p>
        {detail.payeeType === 'employee' && (
          <p>
            銀行資訊：{detail.bankName ?? '—'}｜{detail.bankAccount ?? '—'}｜{detail.accountName ?? '—'}
          </p>
        )}
        <p>發票月份：{detail.invoiceMonth ?? '—'}</p>
        <p>期望付款日：{detail.expectedPaymentDate ?? '—'}</p>
        <p>
          預計撥款批次日：{detail.paymentBatchDate ?? '—'}
          {!detail.paymentTermsConsistent && (
            <span className="ml-2 text-amber-600">
              （提醒：期望付款日與採購單付款條件「{detail.purchaseOrderPaymentTerms}」不一致，請確認）
            </span>
          )}
        </p>
        <p>狀態：{STATUS_LABELS[detail.status] ?? detail.status}</p>
        <p>總計：NT$ {detail.totalAmount.toLocaleString()}</p>
      </section>

      <table className="w-full border text-sm">
        <thead>
          <tr className="bg-gray-100">
            <th className="border p-2">項次</th>
            <th className="border p-2">說明</th>
            <th className="border p-2">金額</th>
          </tr>
        </thead>
        <tbody>
          {detail.items.map((i) => (
            <tr key={i.lineNo}>
              <td className="border p-2 text-center">{i.lineNo}</td>
              <td className="border p-2">{i.description}</td>
              <td className="border p-2 text-right">{i.amount.toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <section>
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

      <AttachmentsPanel formType="expense_request" formId={id} attachments={attachments} />

      {isCurrentApprover && <ApprovalActions expenseRequestId={detail.id} />}
    </main>
  );
}
```

- [ ] **Step 8: Add a "建立費用申請單" link on the 採購單 detail page when eligible**

In `src/app/purchase-orders/[id]/page.tsx`, right after the "建立驗收單" block added in Task 22 Step 8, add:
```tsx
      {detail.status === 'approved' && (
        <p>
          <Link href={`/expense-requests/new?orderId=${detail.id}`} className="text-blue-600 underline">
            建立費用申請單
          </Link>
        </p>
      )}
```

- [ ] **Step 9: Commit**

```bash
git add src/lib/expense-requests/queries.ts src/app/expense-requests src/app/purchase-orders/[id]/page.tsx tests/integration/expense-request-queries.test.ts
git commit -m "feat: add expense request queries and pages"
```

---

## Task 27: Cross-cutting — merge the approval queue, fix notification routing, update the dashboard

**Files:**
- Modify: `src/app/approvals/page.tsx`
- Modify: `src/lib/notifications/queries.ts`
- Modify: `src/app/notifications/page.tsx`
- Modify: `src/app/dashboard/page.tsx`

**Interfaces:**
- Consumes: `getMyApprovalQueue` (existing), `getMyPurchaseOrderApprovalQueue` (Task 18), `getMyAcceptanceApprovalQueue` (Task 22), `getMyExpenseRequestApprovalQueue` (Task 26).
- Produces: no new exported functions — `/approvals` now shows pending steps across all four form types instead of only 請購單; `getMyNotifications` gains a `formType` field so `/notifications` links to the right form's detail route instead of always `/requests/[id]`; `/dashboard` links to all four forms' list pages.

**Why no TDD loop here:** this task only reads already-tested query functions and reshapes/links them in page components — the same "no unit test for JSX pages" precedent as every other page task in this plan (Tasks 18, 22, 26) and in the previous plan. `getMyNotifications`'s one-line change (select one more existing column) has no dedicated test file to extend.

- [ ] **Step 1: Replace `/approvals` with a merged queue across all four form types**

`src/app/approvals/page.tsx`:
```tsx
import Link from 'next/link';
import { getMyApprovalQueue } from '@/lib/purchase-requests/queries';
import { getMyPurchaseOrderApprovalQueue } from '@/lib/purchase-orders/queries';
import { getMyAcceptanceApprovalQueue } from '@/lib/acceptances/queries';
import { getMyExpenseRequestApprovalQueue } from '@/lib/expense-requests/queries';

const FORM_LABELS: Record<string, string> = {
  purchase_request: '請購單',
  purchase_order: '採購單',
  acceptance: '驗收單',
  expense_request: '費用申請單',
};

const ROUTE_PREFIX: Record<string, string> = {
  purchase_request: '/requests',
  purchase_order: '/purchase-orders',
  acceptance: '/acceptances',
  expense_request: '/expense-requests',
};

export default async function ApprovalsPage() {
  const [requests, orders, acceptances, expenseRequests] = await Promise.all([
    getMyApprovalQueue(),
    getMyPurchaseOrderApprovalQueue(),
    getMyAcceptanceApprovalQueue(),
    getMyExpenseRequestApprovalQueue(),
  ]);

  const queue = [
    ...requests.map((q) => ({ ...q, formType: 'purchase_request' as const })),
    ...orders.map((q) => ({ ...q, formType: 'purchase_order' as const })),
    ...acceptances.map((q) => ({ ...q, formType: 'acceptance' as const })),
    ...expenseRequests.map((q) => ({ ...q, formType: 'expense_request' as const })),
  ];

  return (
    <main className="mx-auto max-w-4xl p-8">
      <h1 className="mb-6 text-2xl font-bold">待我簽核</h1>
      {queue.length === 0 ? (
        <p className="text-gray-500">目前沒有待簽核的表單。</p>
      ) : (
        <ul className="divide-y rounded border">
          {queue.map((q) => (
            <li key={`${q.formType}-${q.id}`}>
              <Link
                href={`${ROUTE_PREFIX[q.formType]}/${q.id}`}
                className="flex justify-between p-4 hover:bg-gray-50"
              >
                <span className="w-24 text-gray-500">{FORM_LABELS[q.formType]}</span>
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

- [ ] **Step 2: Add `formType` to `getMyNotifications` and route by it**

In `src/lib/notifications/queries.ts`, change:
```ts
export type NotificationRow = {
  id: string;
  type: string;
  caseNumber: string;
  message: string;
  isRead: boolean;
  formId: string;
  createdAt: string;
};
```
to:
```ts
export type NotificationRow = {
  id: string;
  type: string;
  formType: string;
  caseNumber: string;
  message: string;
  isRead: boolean;
  formId: string;
  createdAt: string;
};
```
and change the `.select(...)` call from
```ts
.select('id, type, case_number, message, is_read, form_id, created_at')
```
to
```ts
.select('id, type, form_type, case_number, message, is_read, form_id, created_at')
```
and add `formType: n.form_type,` to the `.map()` return object (alongside the existing `type: n.type,` line).

In `src/app/notifications/page.tsx`, add above the component:
```tsx
const ROUTE_PREFIX: Record<string, string> = {
  purchase_request: '/requests',
  purchase_order: '/purchase-orders',
  acceptance: '/acceptances',
  expense_request: '/expense-requests',
};
```
and change:
```tsx
<Link href={`/requests/${n.formId}`} className="flex-1 hover:underline">
```
to:
```tsx
<Link href={`${ROUTE_PREFIX[n.formType]}/${n.formId}`} className="flex-1 hover:underline">
```

- [ ] **Step 3: Update the dashboard**

In `src/app/dashboard/page.tsx`, replace:
```tsx
import { getMyApprovalQueue } from '@/lib/purchase-requests/queries';
import { getUnreadNotificationCount } from '@/lib/notifications/queries';
```
with:
```tsx
import { getMyApprovalQueue } from '@/lib/purchase-requests/queries';
import { getMyPurchaseOrderApprovalQueue } from '@/lib/purchase-orders/queries';
import { getMyAcceptanceApprovalQueue } from '@/lib/acceptances/queries';
import { getMyExpenseRequestApprovalQueue } from '@/lib/expense-requests/queries';
import { getUnreadNotificationCount } from '@/lib/notifications/queries';
```
replace:
```tsx
  const [queue, unread] = await Promise.all([
    getMyApprovalQueue(),
    getUnreadNotificationCount(),
  ]);
```
with:
```tsx
  const [requestQueue, orderQueue, acceptanceQueue, expenseQueue, unread] = await Promise.all([
    getMyApprovalQueue(),
    getMyPurchaseOrderApprovalQueue(),
    getMyAcceptanceApprovalQueue(),
    getMyExpenseRequestApprovalQueue(),
    getUnreadNotificationCount(),
  ]);
  const pendingCount =
    requestQueue.length + orderQueue.length + acceptanceQueue.length + expenseQueue.length;
```
and replace the `<nav>` block with:
```tsx
      <nav className="mt-6 flex flex-col gap-2">
        <Link href="/requests/new" className="text-blue-600 underline">
          新增請購單
        </Link>
        <Link href="/requests" className="text-blue-600 underline">
          我的請購單
        </Link>
        <Link href="/purchase-orders" className="text-blue-600 underline">
          我的採購單
        </Link>
        <Link href="/acceptances" className="text-blue-600 underline">
          我的驗收單
        </Link>
        <Link href="/expense-requests" className="text-blue-600 underline">
          我的費用申請單
        </Link>
        <Link href="/approvals" className="text-blue-600 underline">
          待我簽核（{pendingCount}）
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
```

- [ ] **Step 4: Run the full test suite to confirm no regressions**

Run: `export $(grep -v '^#' .env.local | xargs) && npm test`
Expected: all pass — no test file exercises these three page/query files directly, so this step is a compile-and-no-regression check, not new coverage.

- [ ] **Step 5: Commit**

```bash
git add src/app/approvals/page.tsx src/lib/notifications/queries.ts src/app/notifications/page.tsx src/app/dashboard/page.tsx
git commit -m "feat: merge approval queue and notification routing across all four forms"
```

---

## Task 28: 案件總覽頁 — `getCaseOverview()` + `/cases/[caseNumber]`

**Files:**
- Create: `src/lib/cases/queries.ts`
- Create: `src/app/cases/[caseNumber]/page.tsx`
- Modify: `src/app/requests/[id]/page.tsx`, `src/app/purchase-orders/[id]/page.tsx`, `src/app/acceptances/[id]/page.tsx`, `src/app/expense-requests/[id]/page.tsx` (case number becomes a link)
- Test: `tests/integration/case-overview-queries.test.ts`

**Interfaces:**
- Consumes: `createSupabaseServerClient`.
- Produces: `CaseFormStatus = { formType, label, itemCode, exists, id, status }`, `CaseOverview = { caseNumber, forms: CaseFormStatus[] }`, `async getCaseOverview(caseNumber: string): Promise<CaseOverview | null>`.

**Design note:** the route is keyed by the human-readable `case_number` (e.g. `CP115070001`), not the internal `procurement_cases.id` — every existing detail query already exposes `caseNumber`, so no existing query file needs a new field to link here.

- [ ] **Step 1: Write the failing integration test**

`tests/integration/case-overview-queries.test.ts`:
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

describe.skipIf(!hasIntegrationTestCredentials())('getCaseOverview', () => {
  let admin: ReturnType<typeof createServiceRoleTestClient>;
  let employeeId: string;
  let departmentId: string;
  let caseId: string;
  let caseNumber: string;
  let requestId: string;

  beforeAll(async () => {
    admin = createServiceRoleTestClient();
    const { data: emp } = await admin
      .from('employees')
      .select('id, department_id')
      .not('department_id', 'is', null)
      .limit(1)
      .single();
    employeeId = emp!.id;
    departmentId = emp!.department_id;
    const { data: cn } = await admin.rpc('next_case_number');
    caseNumber = cn!;
    const { data: pcase } = await admin
      .from('procurement_cases')
      .insert({ case_number: caseNumber, created_by_employee_id: employeeId })
      .select()
      .single();
    caseId = pcase!.id;
    const { data: pr } = await admin
      .from('purchase_requests')
      .insert({
        procurement_case_id: caseId,
        applicant_employee_id: employeeId,
        department_id: departmentId,
        budget_owner_employee_id: employeeId,
        status: 'approved',
      })
      .select()
      .single();
    requestId = pr!.id;
  });

  afterAll(async () => {
    await admin.from('purchase_requests').delete().eq('id', requestId);
    await admin.from('procurement_cases').delete().eq('id', caseId);
  });

  it('returns null for an unknown case number', async () => {
    const { getCaseOverview } = await import('@/lib/cases/queries');
    expect(await getCaseOverview('CP000000000')).toBeNull();
  });

  it('reports the existing 請購單 as approved and the other three forms as not yet created', async () => {
    const { getCaseOverview } = await import('@/lib/cases/queries');
    const overview = await getCaseOverview(caseNumber);
    expect(overview).not.toBeNull();
    expect(overview!.forms).toEqual([
      { formType: 'purchase_request', label: '請購單', itemCode: 'A1', exists: true, id: requestId, status: 'approved' },
      { formType: 'purchase_order', label: '採購單', itemCode: 'B1', exists: false, id: null, status: null },
      { formType: 'acceptance', label: '驗收單', itemCode: 'C1', exists: false, id: null, status: null },
      { formType: 'expense_request', label: '費用申請單', itemCode: 'D1', exists: false, id: null, status: null },
    ]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `export $(grep -v '^#' .env.local | xargs) && npm test -- tests/integration/case-overview-queries.test.ts`
Expected: FAIL — `Cannot find module '@/lib/cases/queries'`.

- [ ] **Step 3: Implement `getCaseOverview`**

`src/lib/cases/queries.ts`:
```ts
import { createSupabaseServerClient } from '@/lib/supabase/server';

export type CaseFormType = 'purchase_request' | 'purchase_order' | 'acceptance' | 'expense_request';

export type CaseFormStatus = {
  formType: CaseFormType;
  label: string;
  itemCode: string;
  exists: boolean;
  id: string | null;
  status: string | null;
};

export type CaseOverview = {
  caseNumber: string;
  forms: CaseFormStatus[];
};

const FORM_DEFS: { formType: CaseFormType; table: string; label: string; itemCode: string }[] = [
  { formType: 'purchase_request', table: 'purchase_requests', label: '請購單', itemCode: 'A1' },
  { formType: 'purchase_order', table: 'purchase_orders', label: '採購單', itemCode: 'B1' },
  { formType: 'acceptance', table: 'acceptances', label: '驗收單', itemCode: 'C1' },
  { formType: 'expense_request', table: 'expense_requests', label: '費用申請單', itemCode: 'D1' },
];

export async function getCaseOverview(caseNumber: string): Promise<CaseOverview | null> {
  const supabase = await createSupabaseServerClient();
  const { data: pcase } = await supabase
    .from('procurement_cases')
    .select('id, case_number')
    .eq('case_number', caseNumber)
    .maybeSingle();
  if (!pcase) return null;

  const forms: CaseFormStatus[] = [];
  for (const def of FORM_DEFS) {
    const { data } = await supabase
      .from(def.table)
      .select('id, status')
      .eq('procurement_case_id', pcase.id)
      .maybeSingle();
    forms.push({
      formType: def.formType,
      label: def.label,
      itemCode: def.itemCode,
      exists: !!data,
      id: data?.id ?? null,
      status: data?.status ?? null,
    });
  }
  return { caseNumber: pcase.case_number, forms };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `export $(grep -v '^#' .env.local | xargs) && npm test -- tests/integration/case-overview-queries.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Write the page**

`src/app/cases/[caseNumber]/page.tsx`:
```tsx
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getCaseOverview } from '@/lib/cases/queries';

const ROUTE_PREFIX: Record<string, string> = {
  purchase_request: '/requests',
  purchase_order: '/purchase-orders',
  acceptance: '/acceptances',
  expense_request: '/expense-requests',
};
const STATUS_LABELS: Record<string, string> = {
  pending_approval: '簽核中',
  approved: '已核准',
  returned: '已退回（待修改）',
};

export default async function CaseOverviewPage({
  params,
}: {
  params: Promise<{ caseNumber: string }>;
}) {
  const { caseNumber } = await params;
  const overview = await getCaseOverview(caseNumber);
  if (!overview) notFound();

  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="mb-6 text-2xl font-bold">案件總覽</h1>
      <p className="mb-4 font-mono text-gray-600">{overview.caseNumber}</p>
      <ul className="space-y-2">
        {overview.forms.map((f) => (
          <li
            key={f.formType}
            className="flex items-center justify-between rounded border p-3 text-sm"
          >
            <span>
              {f.itemCode}｜{f.label}
            </span>
            {f.exists ? (
              <Link href={`${ROUTE_PREFIX[f.formType]}/${f.id}`} className="text-blue-600 underline">
                {STATUS_LABELS[f.status ?? ''] ?? f.status}
              </Link>
            ) : (
              <span className="text-gray-400">尚未建立</span>
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}
```

- [ ] **Step 6: Link each form's case number to the overview page**

In each of `src/app/requests/[id]/page.tsx`, `src/app/purchase-orders/[id]/page.tsx`, `src/app/acceptances/[id]/page.tsx`, `src/app/expense-requests/[id]/page.tsx`, add the import `import Link from 'next/link';` if not already present, and wrap the case-number line in a link. For example in `src/app/requests/[id]/page.tsx`, replace:
```tsx
      <p className="mb-4 font-mono text-gray-600">{detail.caseNumber}</p>
```
with:
```tsx
      <p className="mb-4 font-mono text-gray-600">
        <Link href={`/cases/${detail.caseNumber}`} className="underline">
          {detail.caseNumber}
        </Link>
      </p>
```
Apply the equivalent replacement to the other three pages' case-number line (each currently reads `{detail.caseNumber}（項次 B1/C1/D1）` — keep the項次 suffix outside the link).

- [ ] **Step 7: Commit**

```bash
git add src/lib/cases src/app/cases src/app/requests/[id]/page.tsx src/app/purchase-orders/[id]/page.tsx src/app/acceptances/[id]/page.tsx src/app/expense-requests/[id]/page.tsx tests/integration/case-overview-queries.test.ts
git commit -m "feat: add case overview page linking all four forms"
```

---

## Task 29: Final verification pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full automated test suite**

Run: `export $(grep -v '^#' .env.local | xargs) && npm test`
Expected: all pass — everything from the previous two plans, plus this plan's unit tests (`item-category`, `quote-requirement`, `payment-terms`, `payment-batch`, `build-chain`, `send` (email), `notify`, `attachments/validate`, `purchase-orders/validate`, `acceptances/validate`, `expense-requests/validate`) and integration tests (four new schemas, RLS, attachments actions, three forms' create/approve-return/resubmit/queries, case overview). Confirm none of the integration suites are silently skipped (they run because `.env.local` is exported) — note that `SMTP_*` env vars are **not** required for any test to pass, since every test that reaches `notifyAndEmail` either mocks `@/lib/email/send` outright or exercises it against a live SMTP relay is never attempted in these tests.

- [ ] **Step 2: Run a production build**

Run: `npm run build`
Expected: succeeds with no type errors; routes `/purchase-orders`, `/purchase-orders/new`, `/purchase-orders/[id]`, `/acceptances`, `/acceptances/new`, `/acceptances/[id]`, `/expense-requests`, `/expense-requests/new`, `/expense-requests/[id]`, `/cases/[caseNumber]` all present alongside the existing routes.

- [ ] **Step 3: Walk the manual browser QA checklist**

Start the dev server (`.claude/launch.json`'s dev config), log in as a real seeded employee, then walk the full sequential flow at least once:
1. Create and fully approve a 請購單 (as in the previous plan's QA).
2. From its detail page, click 建立採購單 → fill in unit prices, supplier, payment terms `貨到付款`, quote count below the threshold with a reason → submit → confirm the 報價單家數 hint and 設備/材料 hint render correctly at the boundary amounts.
3. Approve the 採購單 through its full chain (log in as each approver, or seed yourself into the chain via a service-role script per this repo's established QA convention — clean up afterward).
4. From the approved 採購單, click 建立驗收單 → mark one item Fail → submit → approve it. Confirm the Fail item shows in red on the detail page.
5. As a `finance` or `admin` employee, open the approved 驗收單 and fill in a 財產編號 for one item → confirm it saves and a `staff` employee cannot edit it.
6. Click 建立費用申請單 from the 採購單 → confirm the Fail'd item can be unchecked (excluded) → fill in payee/payment fields → submit → confirm the displayed 預計撥款批次日 matches `computePaymentBatchDate`'s rule for the chosen payee type.
7. Repeat steps 2–6 on a **second** 請購單/採購單 pair, but set 採購單's `payment_terms` to `預付款` and skip step 4/5 entirely — confirm 建立費用申請單 is still reachable directly from the approved 採購單 without a 驗收單, and that the created row's `acceptance_id` is null (check via Supabase dashboard or a read-only query).
8. On any form's detail page, upload a PDF and a PNG via the 附件 panel → click each filename → confirms it opens the correct file in a new tab. Confirm an unrelated employee (not applicant, not an approver) cannot see the 附件 panel's files by testing `getAttachmentDownloadUrl` returns null for them (or simply that they can't reach the detail page's RLS-scoped read at all).
9. `/approvals` shows pending items from all four form types with the correct 請購單/採購單/驗收單/費用申請單 label and links to the right route.
10. `/notifications` links route to the correct form's detail page for each of the four form types (not always `/requests/[id]`).
11. Open `/cases/[caseNumber]` for a case with only a 請購單 so far → confirms 採購單/驗收單/費用申請單 show "尚未建立"; after building all four, confirms all four link out with their current status.
12. If `SMTP_*` env vars are set in `.env.local` (they are **not** required to be, per this plan's Global Constraints), confirm a real email arrives for at least one 待簽核 notification; if they are **not** set, confirm the approval/return/create actions still succeed (the email send fails silently inside `notifyAndEmail`'s try/catch) — this is the expected, documented degrade-gracefully behavior until a human provisions the Google Workspace SMTP relay credentials.

- [ ] **Step 4: Confirm no secrets are tracked and server-only credentials stay server-side**

Run: `git status` — `.env.local` not tracked.
Run: `grep -rn "SUPABASE_SERVICE_ROLE_KEY\|SMTP_PASSWORD" src/` — `SUPABASE_SERVICE_ROLE_KEY` appears only in `src/lib/supabase/service-role.ts`; `SMTP_PASSWORD` appears only in `src/lib/email/send.ts`.
Run: `grep -rln "use client" src/ | xargs grep -l "service-role\|email/send" || echo "clean: no client module imports the service-role client or the email sender"`
Expected: prints the "clean" message.

- [ ] **Step 5: Log carried-forward and newly-introduced technical debt**

Add to (or create) a technical-debt note alongside `.superpowers/sdd/progress.md` in the implementation worktree, covering at minimum:
- All items already listed in `docs/superpowers/HANDOFF-plan3.md`'s "前兩份計畫留待後續處理的技術債" section that are still unresolved (e.g. no CAS protection against a double-click double-approve on any of the twelve approve/return actions now in the codebase — this plan did not add it, matching the same gap in the 請購單 actions it mirrors).
- New: a returned-then-resubmitted 驗收單 loses any `property_tag` values finance had already filled in (the resubmit SQL function deletes and reinserts `acceptance_items`) — acceptable because finance only fills `property_tag` after final approval, but should be revisited if that assumption changes.
- New: `payment_batch_date` is computed once at 費用申請單 creation/resubmit and never recomputed afterward (e.g. if the case drags on across a month boundary between submission and approval).
- New: business-day calculations for the 財會撥款週期 hints do not account for Taiwan public holidays (documented simplification, see Global Constraints).
- Not implemented (deliberate scope trim, flag if the user expects it): the design doc's 錯誤處理與例外情境 section describes marking a submitted-without-attachments form as "憑證待補" with a case-page reminder and a pre-payment-cutoff alert to finance. This plan does not block submission on missing attachments (already true — no attachment-count validation exists anywhere), but it also does not add the "憑證待補" status marker, the case-overview reminder, or the finance cutoff alert. If this is needed before go-live, it is a follow-up task: an `is_documentation_complete` (or similar) flag plus a reminder banner on `/cases/[caseNumber]` and the 費用申請單 list.
- Reminder (from the design doc, `docs/superpowers/specs/2026-07-10-procurement-approval-system-design.md`'s "部署與帳號治理注意事項" section, explicitly flagged there as a **mandatory pre-production checklist item**): before this system goes live with real employee/supplier financial data, a human with the appropriate authority must (1) create a company-owned Supabase Organization and transfer the project into it, (2) move the Vercel project to the company's Team account, and (3) switch both platforms' billing to company invoicing with access restricted to authorized members. This is an account-and-billing operation outside the scope of any code change in this plan — flag it to the user rather than attempting it.

This concludes the 採購單／驗收單／費用申請單 + 附件與 Email 通知篇 plan. Together with the previous two plans, all four forms of the 第一期 scope (請購單 → 採購單 → 驗收單 → 費用申請單) are now online with their full sequential approval-chain flow, attachments, and email notifications.
