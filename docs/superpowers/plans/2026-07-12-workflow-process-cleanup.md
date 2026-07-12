# 網頁內運作流程清理篇（Plan 4）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve the in-app process/workflow gaps identified during Plan 3's post-merge QA and code review, before real email sending is turned on and before the separate, later UI/UX design initiative begins. This is a tech-debt and correctness cleanup pass — no new forms, no visual redesign.

**Architecture:** Every task here is a small, independent fix against the already-shipped four-form procurement system (請購單／採購單／驗收單／費用申請單). Nothing in this plan depends on anything else in this plan except Task 4 (shared form-type map), which Task 9's attachments touch-point and the existing `approvals`/`notifications`/`cases` pages already reference — so Task 4 should run early. Otherwise tasks are independent and can be done in any order; the ordering below is "quick, low-risk wins first."

**Tech Stack:** Same as before — Next.js 15 (App Router, Server Actions), React 19, TypeScript 5 (strict), Tailwind CSS 3, Supabase (Postgres + RLS), Vitest, Supabase CLI for migrations. New dev dependency: `@eslint/eslintrc` (Task 6, lint fix only).

## Global Constraints

- Node.js >= 20, npm as the package manager. `npm test` carries `NODE_OPTIONS=--experimental-websocket`; do not remove it.
- TypeScript `strict: true`; no `any` in new code.
- All user-facing copy is Traditional Chinese.
- No code comments except where a non-obvious business rule needs explaining.
- Secrets only ever live in `.env.local` / CI secrets, never committed.
- Every new/modified table's row-level security follows the existing pattern: reads RLS-scoped, writes through server actions using the service-role client with in-code authorization — this plan doesn't change that model, only extends specific columns/functions.
- Environment for integration tests: export `.env.local` into the shell first — `export $(grep -v '^#' .env.local | xargs)` — so the integration suites don't skip. Migrations apply to the linked hosted project via `supabase db push` (already linked — no re-link needed).
- **Do not** implement the full UI/UX redesign (persistent sidebar, breadcrumbs, visual polish) in this plan — Task 3 is a deliberately minimal, single-file navigation fix; a fuller design is a separate, later initiative the user has explicitly deferred.
- **Do not** provision or wire up SMTP/email activation in this plan — that's deferred separately until this plan ships.

## Existing interfaces this plan consumes

- `getCurrentEmployee(supabase): Promise<CurrentEmployee | null>` from `src/lib/auth/current-employee.ts`, `CurrentEmployee = { id, employeeCode, name, departmentId, role: 'staff'|'finance'|'admin', isGeneralManager, isChairman }`.
- `createSupabaseServerClient()` from `src/lib/supabase/server.ts`, `createSupabaseServiceRoleClient()` from `src/lib/supabase/service-role.ts`.
- `isPublicPath(pathname, publicPaths?)` from `src/lib/auth/public-paths.ts`, `PUBLIC_PATHS = ['/login', '/auth/callback']`; `pathname === '/'` is currently always treated as public inside this function.
- The four forms' `approve*Step`/`return*Step` actions in `src/lib/purchase-requests/actions.ts`, `src/lib/purchase-orders/actions.ts`, `src/lib/acceptances/actions.ts`, `src/lib/expense-requests/actions.ts` — each has a private `loadCurrentStep(db, formId, callerId)` helper with an identical shape (returns `{ error: string } | { <header row>, step }`), followed by an `approval_steps` UPDATE with no optimistic-concurrency guard.
- `next_case_number()` SQL function in `supabase/migrations/20260711033121_procurement_cases.sql`, currently computes ROC year-month from `now()` (server/UTC time) with no explicit timezone.
- `budget_codes(id, code, department_id uuid not null, category, owner_employee_id, fiscal_year, annual_budget_amount)` — `department_id` is currently `not null`.
- `scripts/import-seed-data.ts` — already detects and skips project-scoped budget rows (`skippedProjectScopedBudgetCodeCount`), logging that department resolution is deferred.
- `attachments/actions.ts`'s `FORM_TABLE`/`FORM_ROUTE_PREFIX`, `notifications/page.tsx`'s `ROUTE_PREFIX`, `approvals/page.tsx`'s `ROUTE_PREFIX`/`FORM_LABELS`, `cases/[caseNumber]/page.tsx`'s `ROUTE_PREFIX` — four independently-defined, near-identical `Record<string, string>` maps keyed by the same four `form_type` values (`purchase_request`, `purchase_order`, `acceptance`, `expense_request`).

## File Structure

- `src/lib/procurement/form-registry.ts` — new shared module: `FORM_TYPES`, `FORM_ROUTE_PREFIX`, `FORM_LABELS`, `FORM_TABLE` (Task 4)
- `src/app/page.tsx` — modified: redirect instead of static title (Task 1)
- `src/app/login/page.tsx` — modified: render `?error=` (Task 2)
- `src/lib/auth/login-errors.ts` — new: error-code → Traditional Chinese message map (Task 2)
- `src/app/layout.tsx` — modified: minimal authenticated top bar (Task 3)
- `src/app/components/top-nav.tsx` — new: the top bar itself (Task 3)
- `src/lib/acceptances/actions.ts` — modified: status guard on `updateAcceptanceItemPropertyTag` (Task 5)
- `eslint.config.mjs` — new (Task 6)
- `supabase/migrations/<ts>_taiwan_timezone_case_numbers.sql` — new (Task 7)
- `src/lib/purchase-requests/actions.ts`, `src/lib/purchase-orders/actions.ts`, `src/lib/acceptances/actions.ts`, `src/lib/expense-requests/actions.ts` — modified: CAS guard in all 8 approve/return actions (Task 8)
- `supabase/migrations/<ts>_documentation_pending_flag.sql` — new (Task 9)
- `src/lib/cases/queries.ts`, `src/app/cases/[caseNumber]/page.tsx` — modified: 憑證待補 reminder (Task 9)
- `supabase/migrations/<ts>_project_scoped_budget_codes.sql` — new (Task 10)
- `scripts/import-seed-data.ts` — modified (Task 10)

---

## Task 1: 根目錄 `/` 依登入狀態導向，移除死路徑

**Files:**
- Modify: `src/app/page.tsx`

**Interfaces:**
- Consumes: `createSupabaseServerClient`, `getCurrentEmployee`.
- Produces: no new exports — visiting `/` now redirects instead of rendering a dead-end static page.

**Design note:** `src/middleware.ts` treats `pathname === '/'` as always public (`src/lib/auth/public-paths.ts`), so an unauthenticated visitor to `/` is never redirected by middleware — today they just see a bare title with no way to reach `/login`. Simplest correct fix: make the root page itself redirect based on auth state, matching what `/dashboard` already does for the "not registered" case.

- [ ] **Step 1: Write the new root page**

`src/app/page.tsx`:
```tsx
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getCurrentEmployee } from '@/lib/auth/current-employee';

export default async function HomePage() {
  const supabase = await createSupabaseServerClient();
  const employee = await getCurrentEmployee(supabase);
  redirect(employee ? '/dashboard' : '/login');
}
```

- [ ] **Step 2: Run the full suite to confirm no regression**

Run: `npm test`
Expected: all pass (no test exercises `src/app/page.tsx` directly — this is a manual-QA-verified change, matching this codebase's established convention for page components).

- [ ] **Step 3: Commit**

```bash
git add src/app/page.tsx
git commit -m "fix: redirect root path to /dashboard or /login instead of a dead-end static page"
```

---

## Task 2: `/login` 顯示 `?error=` 對應的中文訊息

**Files:**
- Create: `src/lib/auth/login-errors.ts` + `.test.ts`
- Modify: `src/app/login/page.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: `LOGIN_ERROR_MESSAGES: Record<string, string>` and `getLoginErrorMessage(code: string | null): string | null` — maps the three error codes already emitted by `src/app/auth/callback/route.ts` (`auth_failed`, `domain_not_allowed`) and `src/app/dashboard/page.tsx` (`not_registered`) to a Traditional Chinese message; returns `null` for an unknown/missing code so the caller can render nothing.

- [ ] **Step 1: Write the failing test**

`src/lib/auth/login-errors.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { getLoginErrorMessage } from './login-errors';

describe('getLoginErrorMessage', () => {
  it('maps auth_failed to a Traditional Chinese message', () => {
    expect(getLoginErrorMessage('auth_failed')).toBe('登入失敗，請再試一次。');
  });

  it('maps domain_not_allowed to a Traditional Chinese message', () => {
    expect(getLoginErrorMessage('domain_not_allowed')).toBe(
      '此帳號網域不在允許範圍內，請使用公司 Google 帳號登入。'
    );
  });

  it('maps not_registered to a Traditional Chinese message', () => {
    expect(getLoginErrorMessage('not_registered')).toBe(
      '找不到您的員工資料，請聯絡系統管理員將您加入員工名單。'
    );
  });

  it('returns null for an unknown code', () => {
    expect(getLoginErrorMessage('something_else')).toBeNull();
  });

  it('returns null for null', () => {
    expect(getLoginErrorMessage(null)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/lib/auth/login-errors.test.ts`
Expected: FAIL — `Cannot find module './login-errors'`.

- [ ] **Step 3: Implement the map**

`src/lib/auth/login-errors.ts`:
```ts
export const LOGIN_ERROR_MESSAGES: Record<string, string> = {
  auth_failed: '登入失敗，請再試一次。',
  domain_not_allowed: '此帳號網域不在允許範圍內，請使用公司 Google 帳號登入。',
  not_registered: '找不到您的員工資料，請聯絡系統管理員將您加入員工名單。',
};

export function getLoginErrorMessage(code: string | null): string | null {
  if (!code) return null;
  return LOGIN_ERROR_MESSAGES[code] ?? null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/lib/auth/login-errors.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Render the error on `/login`**

Read `src/app/login/page.tsx` first (it's a `'use client'` component with a single `handleLogin` function and a button). Replace its full contents with:

```tsx
'use client';

import { useSearchParams } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { getLoginErrorMessage } from '@/lib/auth/login-errors';

export default function LoginPage() {
  const searchParams = useSearchParams();
  const errorMessage = getLoginErrorMessage(searchParams.get('error'));

  const handleLogin = async () => {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4">
      <h1 className="text-xl font-bold">台灣智慧駕駛 電子採購與簽核系統</h1>
      {errorMessage && (
        <p className="rounded bg-red-50 px-4 py-2 text-sm text-red-700">{errorMessage}</p>
      )}
      <button
        onClick={handleLogin}
        className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
      >
        使用 Google 帳號登入
      </button>
    </main>
  );
}
```

- [ ] **Step 6: Run the full suite to confirm no regression**

Run: `npm test`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/lib/auth/login-errors.ts src/lib/auth/login-errors.test.ts src/app/login/page.tsx
git commit -m "fix: surface ?error= reason on the login page"
```

---

## Task 3: 全站最小導覽列（登入後可見的頂部橫條）

**Files:**
- Create: `src/app/components/top-nav.tsx`
- Modify: `src/app/layout.tsx`

**Interfaces:**
- Consumes: `createSupabaseServerClient`, `getCurrentEmployee`.
- Produces: `<TopNav employeeName={string} />` (server component, no client interactivity needed) — rendered once from the root layout, appears on every page a logged-in employee visits (including `/dashboard` itself, which already has its own longer nav list — this bar is deliberately terser: just a home + back affordance, not a duplicate of the dashboard links).

**Design note — deliberately minimal, not the future UI/UX pass:** this is a single top bar with a "🏠 儀表板" link and a "← 上一頁" browser-back button (`<a href="javascript:history.back()">`-style is avoided; use a tiny client island instead since `history.back()` needs `'use client'`). It does not attempt breadcrumbs, a sidebar, or per-page context — that's explicitly out of scope for this plan (see Global Constraints).

- [ ] **Step 1: Write the back-button client island**

`src/app/components/top-nav.tsx`:
```tsx
'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

export function TopNav({ employeeName }: { employeeName: string }) {
  const router = useRouter();
  return (
    <div className="flex items-center gap-4 border-b bg-gray-50 px-4 py-2 text-sm">
      <button
        type="button"
        onClick={() => router.back()}
        className="text-gray-600 hover:underline"
      >
        ← 上一頁
      </button>
      <Link href="/dashboard" className="text-gray-600 hover:underline">
        🏠 儀表板
      </Link>
      <span className="ml-auto text-gray-400">{employeeName}</span>
    </div>
  );
}
```

- [ ] **Step 2: Wire it into the root layout**

Read `src/app/layout.tsx` first. Replace its full contents with:

```tsx
import type { Metadata } from 'next';
import './globals.css';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { TopNav } from '@/app/components/top-nav';

export const metadata: Metadata = {
  title: '台灣智慧駕駛 電子採購與簽核系統',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createSupabaseServerClient();
  const employee = await getCurrentEmployee(supabase);

  return (
    <html lang="zh-Hant">
      <body>
        {employee && <TopNav employeeName={employee.name} />}
        {children}
      </body>
    </html>
  );
}
```

**Note:** this makes every page (including `/login`, since the root layout wraps it too) perform an auth check. That's an acceptable extra query per request at this codebase's current scale — `getCurrentEmployee` is already called independently by most page components today, so this is not a new pattern, just a new call site. On `/login` itself `employee` will always be `null` (an authenticated user visiting `/login` would already have been redirected away by `/`'s own logic or by whichever page sent them there), so no bar renders there.

- [ ] **Step 3: Run the full suite to confirm no regression**

Run: `npm test`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add src/app/components/top-nav.tsx src/app/layout.tsx
git commit -m "feat: add minimal top nav bar with back and dashboard links"
```

---

## Task 4: 抽出共用的表單型別對照表模組

**Files:**
- Create: `src/lib/procurement/form-registry.ts` + `.test.ts`
- Modify: `src/lib/attachments/actions.ts`, `src/app/notifications/page.tsx`, `src/app/approvals/page.tsx`, `src/app/cases/[caseNumber]/page.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: `FormType = 'purchase_request' | 'purchase_order' | 'acceptance' | 'expense_request'`, `FORM_TYPES: readonly FormType[]`, `FORM_ROUTE_PREFIX: Record<FormType, string>`, `FORM_LABELS: Record<FormType, string>`, `FORM_TABLE: Record<FormType, string>`. All four consuming files replace their locally-defined copy of whichever of these maps they had with an import from this module.

**Design note:** using `Record<FormType, string>` (not `Record<string, string>`) means TypeScript itself now enforces that all four form types are covered wherever these maps are used — adding a fifth form type in the future and forgetting to add it to one of these maps becomes a compile error instead of a silent `undefined` in a URL.

- [ ] **Step 1: Write the failing test**

`src/lib/procurement/form-registry.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { FORM_LABELS, FORM_ROUTE_PREFIX, FORM_TABLE, FORM_TYPES } from './form-registry';

describe('form-registry', () => {
  it('lists exactly the four known form types', () => {
    expect(FORM_TYPES).toEqual([
      'purchase_request',
      'purchase_order',
      'acceptance',
      'expense_request',
    ]);
  });

  it('has a route prefix for every form type', () => {
    for (const type of FORM_TYPES) {
      expect(FORM_ROUTE_PREFIX[type]).toMatch(/^\//);
    }
  });

  it('has a Traditional Chinese label for every form type', () => {
    expect(FORM_LABELS.purchase_request).toBe('請購單');
    expect(FORM_LABELS.purchase_order).toBe('採購單');
    expect(FORM_LABELS.acceptance).toBe('驗收單');
    expect(FORM_LABELS.expense_request).toBe('費用申請單');
  });

  it('has a table name for every form type', () => {
    expect(FORM_TABLE.purchase_request).toBe('purchase_requests');
    expect(FORM_TABLE.purchase_order).toBe('purchase_orders');
    expect(FORM_TABLE.acceptance).toBe('acceptances');
    expect(FORM_TABLE.expense_request).toBe('expense_requests');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/lib/procurement/form-registry.test.ts`
Expected: FAIL — `Cannot find module './form-registry'`.

- [ ] **Step 3: Implement the module**

`src/lib/procurement/form-registry.ts`:
```ts
export type FormType = 'purchase_request' | 'purchase_order' | 'acceptance' | 'expense_request';

export const FORM_TYPES: readonly FormType[] = [
  'purchase_request',
  'purchase_order',
  'acceptance',
  'expense_request',
];

export const FORM_ROUTE_PREFIX: Record<FormType, string> = {
  purchase_request: '/requests',
  purchase_order: '/purchase-orders',
  acceptance: '/acceptances',
  expense_request: '/expense-requests',
};

export const FORM_LABELS: Record<FormType, string> = {
  purchase_request: '請購單',
  purchase_order: '採購單',
  acceptance: '驗收單',
  expense_request: '費用申請單',
};

export const FORM_TABLE: Record<FormType, string> = {
  purchase_request: 'purchase_requests',
  purchase_order: 'purchase_orders',
  acceptance: 'acceptances',
  expense_request: 'expense_requests',
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/lib/procurement/form-registry.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Update `src/lib/attachments/actions.ts`**

Replace:
```ts
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
```
with:
```ts
import { FORM_ROUTE_PREFIX, FORM_TABLE } from '@/lib/procurement/form-registry';
```
placed with the other imports at the top of the file (the `import` line replaces both `const` declarations; the rest of the file, which references `FORM_TABLE[formType]` and `FORM_ROUTE_PREFIX[formType]`, is unchanged — note `formType`/`attachment.form_type` are typed as plain `string` in this file's function signatures, which still works against a `Record<FormType, string>` index as long as the value passed in practice is always one of the four `FormType` members; this file does not need its own parameter types tightened as part of this task).

- [ ] **Step 6: Update `src/app/notifications/page.tsx`**

Replace:
```ts
const ROUTE_PREFIX: Record<string, string> = {
  purchase_request: '/requests',
  purchase_order: '/purchase-orders',
  acceptance: '/acceptances',
  expense_request: '/expense-requests',
};
```
with:
```ts
import { FORM_ROUTE_PREFIX } from '@/lib/procurement/form-registry';
```
and update the one usage site from `ROUTE_PREFIX[n.formType]` to `FORM_ROUTE_PREFIX[n.formType]`.

- [ ] **Step 7: Update `src/app/approvals/page.tsx`**

Replace:
```ts
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
```
with:
```ts
import { FORM_LABELS, FORM_ROUTE_PREFIX } from '@/lib/procurement/form-registry';
```
and update the two usage sites (`ROUTE_PREFIX[q.formType]` → `FORM_ROUTE_PREFIX[q.formType]`, `FORM_LABELS[q.formType]` stays the same name, just now imported).

- [ ] **Step 8: Update `src/app/cases/[caseNumber]/page.tsx`**

Replace:
```ts
const ROUTE_PREFIX: Record<string, string> = {
  purchase_request: '/requests',
  purchase_order: '/purchase-orders',
  acceptance: '/acceptances',
  expense_request: '/expense-requests',
};
```
with:
```ts
import { FORM_ROUTE_PREFIX } from '@/lib/procurement/form-registry';
```
and update the one usage site from `ROUTE_PREFIX[f.formType]` to `FORM_ROUTE_PREFIX[f.formType]`.

- [ ] **Step 9: Run the full suite to confirm no regression**

Run: `npm test`
Expected: all pass, same counts as before this task (this is a pure refactor — no behavior change).

- [ ] **Step 10: Commit**

```bash
git add src/lib/procurement/form-registry.ts src/lib/procurement/form-registry.test.ts src/lib/attachments/actions.ts src/app/notifications/page.tsx src/app/approvals/page.tsx "src/app/cases/[caseNumber]/page.tsx"
git commit -m "refactor: extract shared form-type registry, replacing four duplicated maps"
```

---

## Task 5: `updateAcceptanceItemPropertyTag` 加上狀態限制

**Files:**
- Modify: `src/lib/acceptances/actions.ts`
- Test: `tests/integration/acceptance-approve-return.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: no signature change to `updateAcceptanceItemPropertyTag(itemId, propertyTag)` — only tightens its behavior: it now additionally requires the parent `acceptances` row to have `status = 'approved'`, matching the plan-3 design note that finance only ever fills 財產編號 after final approval.

- [ ] **Step 1: Write the failing integration test**

Read `tests/integration/acceptance-approve-return.test.ts` first — it already has a `makeAcceptanceWithOneStep()` helper that creates an acceptance in `pending_approval` (via `current_step_order: 1`, no `status` override, so it defaults to `pending_approval`) plus one `acceptance_items` row, and an existing test `lets finance update the property tag`. Add a new test right after that one:

```ts
  it('rejects a property-tag update while the acceptance is still pending_approval', async () => {
    const { itemId } = await makeAcceptanceWithOneStep();
    currentEmployee.value = { id: applicantId, role: 'finance' };
    const { updateAcceptanceItemPropertyTag } = await import('@/lib/acceptances/actions');
    const result = await updateAcceptanceItemPropertyTag(itemId, 'PROP-0002');
    expect(result).toEqual({ ok: false, error: '只能在驗收單已核准後填寫財產編號' });
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `export $(grep -v '^#' .env.local | xargs) && npm test -- tests/integration/acceptance-approve-return.test.ts`
Expected: FAIL — the call currently succeeds (no status check exists yet), so `result` is `{ ok: true }`, not the expected rejection.

- [ ] **Step 3: Add the status guard**

In `src/lib/acceptances/actions.ts`, `updateAcceptanceItemPropertyTag` currently reads:
```ts
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
```
Replace with:
```ts
  const { data: item } = await db
    .from('acceptance_items')
    .select('acceptance_id, acceptances(status)')
    .eq('id', itemId)
    .maybeSingle();
  if (!item) return { ok: false, error: '找不到驗收明細' };
  const acceptanceStatus = (item.acceptances as unknown as { status: string } | null)?.status;
  if (acceptanceStatus !== 'approved') {
    return { ok: false, error: '只能在驗收單已核准後填寫財產編號' };
  }

  const { error } = await db
    .from('acceptance_items')
    .update({ property_tag: propertyTag })
    .eq('id', itemId);
  if (error) return { ok: false, error: '更新財產編號失敗' };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `export $(grep -v '^#' .env.local | xargs) && npm test -- tests/integration/acceptance-approve-return.test.ts`
Expected: PASS (5 tests — the 4 existing plus the new one). The pre-existing `lets finance update the property tag` test must still pass — check it: if it calls `updateAcceptanceItemPropertyTag` against an acceptance still in `pending_approval` (via `makeAcceptanceWithOneStep()` directly, without first approving it), that test now needs to approve the acceptance first before asserting the property-tag update succeeds. Read that test; if it doesn't already drive the acceptance to `approved` first, update it to call `approveAcceptanceStep` (as the step's approver) before calling `updateAcceptanceItemPropertyTag`, matching the new, correct precondition.

- [ ] **Step 5: Run the full suite to confirm no regression**

Run: `export $(grep -v '^#' .env.local | xargs) && npm test`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/acceptances/actions.ts tests/integration/acceptance-approve-return.test.ts
git commit -m "fix: require an approved acceptance before its property tag can be edited"
```

---

## Task 6: 修復 `npm run lint`（新增 ESLint 9 flat config）

**Files:**
- Create: `eslint.config.mjs`
- Modify: `package.json` (add `@eslint/eslintrc` dev dependency)

**Interfaces:**
- Consumes: nothing.
- Produces: a working `npm run lint` command. No runtime code interface — this is tooling configuration only.

**Design note:** `package.json` already has `"lint": "eslint ."`, `"eslint": "^9.17.0"`, and `"eslint-config-next": "15.1.0"`, but there is no `eslint.config.js`/`.mjs` anywhere in the repo, so ESLint 9 (which defaults to flat config, no automatic fallback to a legacy `.eslintrc`) fails immediately. `eslint-config-next` still ships its rule sets in the legacy "extends" format, so the standard fix (the same one `create-next-app` itself generates for a Next 15 + ESLint 9 project) is to bridge it via `@eslint/eslintrc`'s `FlatCompat` helper.

- [ ] **Step 1: Install the dependency**

Run: `npm install -D @eslint/eslintrc`

- [ ] **Step 2: Create the flat config**

`eslint.config.mjs`:
```js
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { FlatCompat } from '@eslint/eslintrc';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    ignores: ['.next/**', 'node_modules/**', 'supabase/**'],
  },
];

export default eslintConfig;
```

- [ ] **Step 3: Run lint and fix whatever it reports**

Run: `npm run lint`
Expected: this will likely report some real findings across the existing codebase (three plans' worth of code has never been linted). Fix each finding directly — do not add `eslint-disable` comments to silence them unless a finding is a false positive you can justify in one sentence. If the finding count is large, work through them file by file, re-running `npm run lint` after each batch, and run `npm test` once after all fixes to confirm nothing broke behaviorally.

- [ ] **Step 4: Run the full suite to confirm no regression**

Run: `npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add eslint.config.mjs package.json package-lock.json
git commit -m "fix: add ESLint 9 flat config so npm run lint works"
```

If Step 3 required source-code fixes beyond the config itself, stage and commit those in one or more separate commits (`git commit -m "fix: resolve eslint findings in <area>"`) rather than folding them into the config commit, so the config-only commit stays easy to review in isolation.

---

## Task 7: 案件單號改用台灣時區計算，修正月份交界 off-by-one

**Files:**
- Create: `supabase/migrations/<timestamp>_taiwan_timezone_case_numbers.sql`
- Test: `tests/integration/taiwan-timezone-case-numbers.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `next_case_number()` (redefined) — same signature and return format as before (`CP` + ROC year-month + 4-digit serial), but the ROC year-month component is now computed from Asia/Taipei local time instead of the database session's UTC time, so a case created at, say, 2026-07-01 07:00 UTC (2026-07-01 15:00 Taipei time — still July in both) or, more to the point, 2026-06-30 17:00 UTC (which is already 2026-07-01 01:00 Taipei time, the next month) gets the Taipei-local month, not the UTC month.

- [ ] **Step 1: Write the failing integration test**

`tests/integration/taiwan-timezone-case-numbers.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { createServiceRoleTestClient, hasIntegrationTestCredentials } from './supabase-test-client';

describe.skipIf(!hasIntegrationTestCredentials())('next_case_number Taiwan timezone', () => {
  it('uses the Asia/Taipei calendar date, not the UTC date, for the year-month component', async () => {
    const supabase = createServiceRoleTestClient();
    const { data: taipeiNow, error } = await supabase.rpc('taipei_now');
    expect(error).toBeNull();
    const taipeiDate = new Date(taipeiNow as string);
    const expectedYearMonth =
      String(taipeiDate.getUTCFullYear() - 1911).padStart(3, '0') +
      String(taipeiDate.getUTCMonth() + 1).padStart(2, '0');

    const { data: caseNumber, error: caseNumError } = await supabase.rpc('next_case_number');
    expect(caseNumError).toBeNull();
    expect((caseNumber as string).slice(0, 7)).toBe('CP' + expectedYearMonth);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `export $(grep -v '^#' .env.local | xargs) && npm test -- tests/integration/taiwan-timezone-case-numbers.test.ts`
Expected: FAIL — `Cannot find function public.taipei_now` (the helper function doesn't exist yet; this also indirectly exercises the current, UTC-based `next_case_number()` if the function-not-found check is bypassed, but the primary expected failure is the missing `taipei_now` RPC).

- [ ] **Step 3: Create and write the migration**

Run: `supabase migration new taiwan_timezone_case_numbers`. Write:
```sql
create or replace function taipei_now() returns timestamptz
language sql stable
as $$
  select now() at time zone 'Asia/Taipei';
$$;

create or replace function next_case_number() returns text
language plpgsql
as $$
declare
  v_taipei_now timestamptz;
  v_year_month text;
  v_serial integer;
begin
  v_taipei_now := now() at time zone 'Asia/Taipei';
  v_year_month := lpad((extract(year from v_taipei_now)::int - 1911)::text, 3, '0')
                  || lpad(extract(month from v_taipei_now)::int::text, 2, '0');
  insert into case_number_counters (year_month, last_serial)
  values (v_year_month, 1)
  on conflict (year_month)
  do update set last_serial = case_number_counters.last_serial + 1
  returning last_serial into v_serial;
  return 'CP' || v_year_month || lpad(v_serial::text, 4, '0');
end;
$$;

alter table purchase_requests alter column request_date set default (now() at time zone 'Asia/Taipei')::date;
alter table acceptances alter column acceptance_date set default (now() at time zone 'Asia/Taipei')::date;
```

**Note on the `timestamptz` cast:** `now() at time zone 'Asia/Taipei'` returns a `timestamp` (no zone) representing the Taipei wall-clock time — Postgres's `at time zone` on a `timestamptz` input strips the zone and gives you the local clock reading. `taipei_now()` is declared to return `timestamptz` for convenience on the calling/test side, so Postgres implicitly casts that naive local timestamp back assuming the session's zone; since this function's only consumer here is the test (comparing calendar components, not absolute instants), this is fine — do not reuse `taipei_now()` anywhere that needs a true absolute-instant comparison.

- [ ] **Step 4: Apply the migration**

Run: `export $(grep -v '^#' .env.local | xargs) && supabase db push`

- [ ] **Step 5: Run the test to verify it passes**

Run: `export $(grep -v '^#' .env.local | xargs) && npm test -- tests/integration/taiwan-timezone-case-numbers.test.ts`
Expected: PASS (1 test).

- [ ] **Step 6: Run the full suite to confirm no regression**

Run: `export $(grep -v '^#' .env.local | xargs) && npm test`
Expected: all pass — in particular, every existing test asserting `next_case_number()`'s output shape (`^CP\d{5}\d{4}$` style regexes) should still pass since the format is unchanged, only the timezone basis for the year-month component changed.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations tests/integration/taiwan-timezone-case-numbers.test.ts
git commit -m "fix: compute case numbers and request/acceptance dates in Asia/Taipei time, not UTC"
```

---

## Task 8: 所有 approve/return actions 加上 CAS 保護，防止連點兩下產生重複通知

**Files:**
- Modify: `src/lib/purchase-requests/actions.ts`, `src/lib/purchase-orders/actions.ts`, `src/lib/acceptances/actions.ts`, `src/lib/expense-requests/actions.ts`
- Test: `tests/integration/purchase-request-approve-return.test.ts`, `tests/integration/purchase-order-approve-return.test.ts`, `tests/integration/acceptance-approve-return.test.ts`, `tests/integration/expense-request-approve-return.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: no signature changes to any `approve*Step`/`return*Step` action — only tightens behavior. Today, `loadCurrentStep` reads the current `approval_steps` row (`status`, `approver_employee_id`) via a plain `SELECT`, and the subsequent `UPDATE ... SET status = 'approved' WHERE id = step.id` has no condition tying it back to the state that was just read. If the same approver's two clicks (or two browser tabs) both pass `loadCurrentStep`'s read before either write lands, both requests proceed to advance the form and send a duplicate `approval_requested`/`request_approved`/`request_returned` notification to whoever's next. This task adds `.eq('status', 'pending')` to every `approval_steps` UPDATE and checks that exactly one row was actually changed before continuing — if zero rows changed, someone else's concurrent click already won, and this call returns an error instead of proceeding.

**Design note — do this once, then repeat the same edit 8 times:** the fix shape is identical across all four forms' `approve*Step` and `return*Step` functions. Work out the exact pattern on `purchase-requests/actions.ts` first (Steps 1-4 below), verify it with a real concurrency test, then apply the identical pattern to the other three files (Step 5) — don't re-derive the approach three more times.

- [ ] **Step 1: Write the failing test for the first form (請購單)**

Read `tests/integration/purchase-request-approve-return.test.ts` first to see its existing fixture helpers. Add this test (it needs a two-step chain so there's a "next approver" to check the notification against — reuse whatever multi-step fixture helper the file already has, or construct one inline following the same pattern as the file's other tests):

```ts
  it('only advances the chain once when approve is called twice concurrently for the same step', async () => {
    const requestId = await makeRequestWithTwoSteps(); // use this file's existing 2-step fixture helper
    currentEmployee.value = { id: managerId };
    const { approvePurchaseRequestStep } = await import('@/lib/purchase-requests/actions');

    const [first, second] = await Promise.all([
      approvePurchaseRequestStep(requestId),
      approvePurchaseRequestStep(requestId),
    ]);
    const results = [first, second];
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toHaveLength(1);

    const { data: notifs } = await admin
      .from('notifications')
      .select('id')
      .eq('form_type', 'purchase_request')
      .eq('form_id', requestId)
      .eq('type', 'approval_requested');
    expect(notifs).toHaveLength(1);
  });
```

If the file's existing fixture helper is named differently than `makeRequestWithTwoSteps`, use the actual name — read the file to find it (this codebase's other approve/return test files use names like `makeOrderWithTwoSteps`/`makeAcceptanceWithOneStep`; the purchase-requests one may differ).

- [ ] **Step 2: Run the test to verify it fails**

Run: `export $(grep -v '^#' .env.local | xargs) && npm test -- tests/integration/purchase-request-approve-return.test.ts`
Expected: FAIL — both concurrent calls currently succeed (`results.filter((r) => r.ok)` has length 2, not 1), and 2 notifications get created instead of 1.

- [ ] **Step 3: Add the CAS guard to `approvePurchaseRequestStep` and `returnPurchaseRequestStep`**

In `src/lib/purchase-requests/actions.ts`, `approvePurchaseRequestStep` currently does:
```ts
  await db
    .from('approval_steps')
    .update({ status: 'approved', acted_at: new Date().toISOString() })
    .eq('id', step.id);
```
Replace with:
```ts
  const { data: updatedSteps } = await db
    .from('approval_steps')
    .update({ status: 'approved', acted_at: new Date().toISOString() })
    .eq('id', step.id)
    .eq('status', 'pending')
    .select('id');
  if (!updatedSteps || updatedSteps.length === 0) {
    return { ok: false, error: '此表單已被處理，請重新整理頁面' };
  }
```

`returnPurchaseRequestStep` currently does:
```ts
  await db
    .from('approval_steps')
    .update({ status: 'returned', comment: reason, acted_at: new Date().toISOString() })
    .eq('id', step.id);
```
Replace with:
```ts
  const { data: updatedSteps } = await db
    .from('approval_steps')
    .update({ status: 'returned', comment: reason, acted_at: new Date().toISOString() })
    .eq('id', step.id)
    .eq('status', 'pending')
    .select('id');
  if (!updatedSteps || updatedSteps.length === 0) {
    return { ok: false, error: '此表單已被處理，請重新整理頁面' };
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `export $(grep -v '^#' .env.local | xargs) && npm test -- tests/integration/purchase-request-approve-return.test.ts`
Expected: PASS (all tests including the new concurrency one). Note: `Promise.all` on two calls to the same async function against a real network-backed database does not guarantee true simultaneity — if this test is flaky (occasionally both awaits happen to serialize cleanly and the race never manifests), that's an acceptable, known limitation of testing a race condition against a real remote database; do not loop-retry the test to force a race. If it passes on the first try, that already proves the CAS guard's WHERE-clause logic is correct (the guard's correctness doesn't depend on true simultaneity — it depends on the UPDATE's own atomicity, which Postgres guarantees regardless of how close together the two calls arrive).

- [ ] **Step 5: Apply the identical pattern to the other three forms**

For each of `src/lib/purchase-orders/actions.ts` (`approvePurchaseOrderStep`, `returnPurchaseOrderStep`), `src/lib/acceptances/actions.ts` (`approveAcceptanceStep`, `returnAcceptanceStep`), and `src/lib/expense-requests/actions.ts` (`approveExpenseRequestStep`, `returnExpenseRequestStep`):

1. Find the `approval_steps` UPDATE inside the approve function (sets `status: 'approved'`) and apply the same transformation as Step 3 above (add `.eq('status', 'pending').select('id')`, check `updatedSteps.length === 0`, return `{ ok: false, error: '此表單已被處理，請重新整理頁面' }`).
2. Find the `approval_steps` UPDATE inside the return function (sets `status: 'returned'`) and apply the same transformation.
3. Add the equivalent concurrent-approve test to that form's `*-approve-return.test.ts` file, using that file's own existing two-step (or, for `acceptance-approve-return.test.ts`, its one-step — adapt the assertion to check `updatedSteps`/notification count for a single-step chain: both concurrent calls race for the FINAL approval, so assert exactly one `request_approved` notification instead of `approval_requested`) fixture helper and the form's own action/table names.
4. Run that form's test file, confirm PASS.

- [ ] **Step 6: Run the full suite to confirm no regression**

Run: `export $(grep -v '^#' .env.local | xargs) && npm test`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/lib/purchase-requests/actions.ts src/lib/purchase-orders/actions.ts src/lib/acceptances/actions.ts src/lib/expense-requests/actions.ts tests/integration/purchase-request-approve-return.test.ts tests/integration/purchase-order-approve-return.test.ts tests/integration/acceptance-approve-return.test.ts tests/integration/expense-request-approve-return.test.ts
git commit -m "fix: add CAS guard to all approve/return actions to prevent duplicate-click races"
```

---

## Task 9: 「憑證待補」提醒（案件總覽頁）

**Files:**
- Modify: `src/lib/cases/queries.ts`, `src/app/cases/[caseNumber]/page.tsx`
- Test: `tests/integration/case-overview-queries.test.ts`

**Interfaces:**
- Consumes: `attachments` table (already exists, from Plan 3).
- Produces: `CaseFormStatus` gains one field: `hasAttachments: boolean`. No new table, no new column — "缺件" is derived on read as "this existing form has zero rows in `attachments`", not a stored flag.

**Design note — deliberately simpler than the original design doc's full spec:** the design doc describes a stored "憑證待補" status plus an overdue-payment alert tied to the 財會撥款週期. This task implements only the part explicitly requested for Plan 4: a visible reminder on the case overview page when a created form has no attachments yet. It does not add a stored flag, does not compute "overdue," and does not gate payment in any way (matches the existing "attachments are always optional, never block submission" rule from Plan 3). If the fuller version (stored flag, overdue alert) turns out to be needed, that's a follow-up task, not a re-scope of this one.

- [ ] **Step 1: Write the failing integration test**

Read `tests/integration/case-overview-queries.test.ts` first (it has a `describe` block with a `beforeAll` that creates a case with one approved `purchase_requests` row). Add this test:

```ts
  it('reports hasAttachments false for a form with no attachments', async () => {
    const { getCaseOverview } = await import('@/lib/cases/queries');
    const overview = await getCaseOverview(caseNumber);
    const requestEntry = overview!.forms.find((f) => f.formType === 'purchase_request');
    expect(requestEntry!.hasAttachments).toBe(false);
  });

  it('reports hasAttachments true once a form has at least one attachment', async () => {
    await admin.from('attachments').insert({
      form_type: 'purchase_request',
      form_id: requestId,
      uploaded_by_employee_id: employeeId,
      storage_path: `purchase_request/${requestId}/test-${Date.now()}.pdf`,
      file_name: 'test.pdf',
      mime_type: 'application/pdf',
      file_size_bytes: 100,
    });
    const { getCaseOverview } = await import('@/lib/cases/queries');
    const overview = await getCaseOverview(caseNumber);
    const requestEntry = overview!.forms.find((f) => f.formType === 'purchase_request');
    expect(requestEntry!.hasAttachments).toBe(true);
    await admin.from('attachments').delete().eq('form_id', requestId);
  });
```

(`requestId`, `caseNumber`, `employeeId`, and `admin` are the existing fixture variables this test file already declares in its outer `describe` scope — reuse them, don't redeclare.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `export $(grep -v '^#' .env.local | xargs) && npm test -- tests/integration/case-overview-queries.test.ts`
Expected: FAIL — `requestEntry!.hasAttachments` is `undefined`, not `false`/`true` (the field doesn't exist yet).

- [ ] **Step 3: Add `hasAttachments` to `getCaseOverview`**

Read `src/lib/cases/queries.ts` first. Its `CaseFormStatus` type and the loop inside `getCaseOverview` currently look like:
```ts
export type CaseFormStatus = {
  formType: CaseFormType;
  label: string;
  itemCode: string;
  exists: boolean;
  id: string | null;
  status: string | null;
};
```
and inside the function, for each `def` in `FORM_DEFS`:
```ts
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
```
Change the type to:
```ts
export type CaseFormStatus = {
  formType: CaseFormType;
  label: string;
  itemCode: string;
  exists: boolean;
  id: string | null;
  status: string | null;
  hasAttachments: boolean;
};
```
and the loop body to:
```ts
    const { data } = await supabase
      .from(def.table)
      .select('id, status')
      .eq('procurement_case_id', pcase.id)
      .maybeSingle();
    let hasAttachments = false;
    if (data) {
      const { count } = await supabase
        .from('attachments')
        .select('id', { count: 'exact', head: true })
        .eq('form_type', def.formType)
        .eq('form_id', data.id);
      hasAttachments = (count ?? 0) > 0;
    }
    forms.push({
      formType: def.formType,
      label: def.label,
      itemCode: def.itemCode,
      exists: !!data,
      id: data?.id ?? null,
      status: data?.status ?? null,
      hasAttachments,
    });
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `export $(grep -v '^#' .env.local | xargs) && npm test -- tests/integration/case-overview-queries.test.ts`
Expected: PASS (all tests including the two new ones).

- [ ] **Step 5: Show the reminder on the case overview page**

Read `src/app/cases/[caseNumber]/page.tsx` first. Inside the `overview.forms.map((f) => ...)` block, where it currently renders the status link/badge for a form that `f.exists`, add a reminder next to it. Find:
```tsx
            {f.exists ? (
              <Link href={`${FORM_ROUTE_PREFIX[f.formType]}/${f.id}`} className="text-blue-600 underline">
                {STATUS_LABELS[f.status ?? ''] ?? f.status}
              </Link>
            ) : (
              <span className="text-gray-400">尚未建立</span>
            )}
```
(the exact import name for the route-prefix map is whatever Task 4 left it as — `FORM_ROUTE_PREFIX` from `@/lib/procurement/form-registry` if Task 4 already ran, or `ROUTE_PREFIX` locally-defined if Task 4 hasn't run yet in your execution order; use whichever this file actually has when you read it) and replace with:
```tsx
            {f.exists ? (
              <span className="flex items-center gap-2">
                <Link href={`${FORM_ROUTE_PREFIX[f.formType]}/${f.id}`} className="text-blue-600 underline">
                  {STATUS_LABELS[f.status ?? ''] ?? f.status}
                </Link>
                {!f.hasAttachments && (
                  <span className="rounded bg-amber-50 px-2 py-0.5 text-xs text-amber-700">
                    憑證待補
                  </span>
                )}
              </span>
            ) : (
              <span className="text-gray-400">尚未建立</span>
            )}
```

- [ ] **Step 6: Run the full suite to confirm no regression**

Run: `export $(grep -v '^#' .env.local | xargs) && npm test`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/lib/cases/queries.ts "src/app/cases/[caseNumber]/page.tsx" tests/integration/case-overview-queries.test.ts
git commit -m "feat: show a 憑證待補 reminder on the case overview page for forms with no attachments"
```

---

## Task 10: 專案型預算編號改用 nullable department + project_code 欄位，補匯入

**Files:**
- Create: `supabase/migrations/<timestamp>_project_scoped_budget_codes.sql`
- Modify: `scripts/import-seed-data.ts`
- Test: `tests/integration/budget-and-suppliers-schema.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `budget_codes.department_id` becomes nullable; new column `budget_codes.project_code text` (nullable). Exactly one of `department_id`/`project_code` is set per row (enforced by a CHECK constraint) — a "department-scoped" budget code has `department_id` set and `project_code` null (unchanged from today); a "project-scoped" budget code has `project_code` set (the code that used to be misread as a department code) and `department_id` null.

**Design note — this fix is intentionally partial, and that's documented, not hidden:** `scripts/import-seed-data.ts` currently skips project-scoped rows entirely because it can't resolve a `department_id` for them. After this task, those rows import successfully with `department_id = null`, but `owner_employee_id` will also be `null` for every one of them (the importer derives the owner from the department's manager, and project-scoped rows have no department to look a manager up from). A budget code with no owner cannot be selected when creating a 請購單 today (`createPurchaseRequest`/`validatePurchaseRequestInput` reject a request whose budget code has no owner). **This task does not attempt to determine per-project owners** — that requires business input this plan doesn't have. After this task ships, a human with admin access needs to manually set `owner_employee_id` for each imported project-scoped budget code (there is no in-app editor for this yet — direct Supabase Studio edit, matching how master-data edits are already done today) before those codes become usable in a real request. Flag this to the user when this task is reported done; don't silently treat "imported into the table" as "usable."

- [ ] **Step 1: Write the failing integration test**

Read `tests/integration/budget-and-suppliers-schema.test.ts` first to see its existing style. Add:

```ts
  it('accepts a project-scoped budget code with department_id null and project_code set', async () => {
    const { data, error } = await supabase
      .from('budget_codes')
      .insert({
        code: `PROJ-TEST-${Date.now()}`,
        department_id: null,
        project_code: 'A123',
        category: '材料',
        fiscal_year: '115',
      })
      .select()
      .single();
    expect(error).toBeNull();
    expect(data!.department_id).toBeNull();
    expect(data!.project_code).toBe('A123');
    await supabase.from('budget_codes').delete().eq('id', data!.id);
  });

  it('rejects a budget code with both department_id and project_code set', async () => {
    const { data: dept } = await supabase.from('departments').select('id').limit(1).single();
    const { error } = await supabase.from('budget_codes').insert({
      code: `PROJ-TEST-BOTH-${Date.now()}`,
      department_id: dept!.id,
      project_code: 'A123',
      category: '材料',
      fiscal_year: '115',
    });
    expect(error).not.toBeNull();
  });

  it('rejects a budget code with neither department_id nor project_code set', async () => {
    const { error } = await supabase.from('budget_codes').insert({
      code: `PROJ-TEST-NEITHER-${Date.now()}`,
      department_id: null,
      project_code: null,
      category: '材料',
      fiscal_year: '115',
    });
    expect(error).not.toBeNull();
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `export $(grep -v '^#' .env.local | xargs) && npm test -- tests/integration/budget-and-suppliers-schema.test.ts`
Expected: FAIL — `department_id` is currently `not null`, so even the first new test's insert fails (wrong reason: NOT NULL violation instead of the column/constraint not existing yet, but still a failure, confirming RED).

- [ ] **Step 3: Create and write the migration**

Run: `supabase migration new project_scoped_budget_codes`. Write:
```sql
alter table budget_codes add column project_code text;
alter table budget_codes alter column department_id drop not null;
alter table budget_codes add constraint budget_codes_department_or_project_check
  check ((department_id is not null) <> (project_code is not null));
```

- [ ] **Step 4: Apply the migration**

Run: `export $(grep -v '^#' .env.local | xargs) && supabase db push`

- [ ] **Step 5: Run the test to verify it passes**

Run: `export $(grep -v '^#' .env.local | xargs) && npm test -- tests/integration/budget-and-suppliers-schema.test.ts`
Expected: PASS (all tests including the three new ones).

- [ ] **Step 6: Update the importer**

Read `scripts/import-seed-data.ts` first, specifically the loop around `skippedProjectScopedBudgetCodeCount`. Currently:
```ts
  for (const budget of uniqueBudgetCodes.values()) {
    const departmentId = departmentIdByCode.get(budget.departmentCode);
    if (!departmentId) {
      skippedProjectScopedBudgetCodeCount += 1;
      continue;
    }
    const { error } = await supabase.from('budget_codes').upsert(
      {
        code: budget.code,
        department_id: departmentId,
        category: budget.category,
        fiscal_year: budget.fiscalYear,
        annual_budget_amount: budget.annualBudgetAmount,
        owner_employee_id: managerIdByDeptCode.get(budget.departmentCode) ?? null,
      },
      { onConflict: 'code' }
    );
    if (error) throw error;
    insertedBudgetCodeCount += 1;
  }
```
Replace with:
```ts
  let importedProjectScopedBudgetCodeCount = 0;
  for (const budget of uniqueBudgetCodes.values()) {
    const departmentId = departmentIdByCode.get(budget.departmentCode);
    const { error } = await supabase.from('budget_codes').upsert(
      {
        code: budget.code,
        department_id: departmentId ?? null,
        project_code: departmentId ? null : budget.departmentCode,
        category: budget.category,
        fiscal_year: budget.fiscalYear,
        annual_budget_amount: budget.annualBudgetAmount,
        owner_employee_id: departmentId ? (managerIdByDeptCode.get(budget.departmentCode) ?? null) : null,
      },
      { onConflict: 'code' }
    );
    if (error) throw error;
    insertedBudgetCodeCount += 1;
    if (!departmentId) importedProjectScopedBudgetCodeCount += 1;
  }
```
Remove the now-unused `skippedProjectScopedBudgetCodeCount` variable declaration and its increment (both no longer referenced). Find the summary `console.log` block at the end of the function:
```ts
  console.log(
    `匯入完成：${departmentByCode.size} 個部門、${employees.length} 位員工、${insertedBudgetCodeCount} 個預算編號、${suppliers.length} 家供應商。`
  );
  if (skippedProjectScopedBudgetCodeCount > 0) {
    console.log(
      `已略過 ${skippedProjectScopedBudgetCodeCount} 個專案型預算編號（部門代號欄位填的是專案代碼，不在 8 個部門代碼中）——這批專案預算的部門歸屬解析留待後續任務處理，本次匯入僅涵蓋部門型預算。`
    );
  }
```
Replace with:
```ts
  console.log(
    `匯入完成：${departmentByCode.size} 個部門、${employees.length} 位員工、${insertedBudgetCodeCount} 個預算編號（其中 ${importedProjectScopedBudgetCodeCount} 個為專案型）、${suppliers.length} 家供應商。`
  );
  if (importedProjectScopedBudgetCodeCount > 0) {
    console.log(
      `提醒：${importedProjectScopedBudgetCodeCount} 個專案型預算編號目前沒有預算負責人（owner_employee_id 為 null），無法用於建立請購單，需要有 admin 權限的人到 Supabase Studio 手動指定每一筆的負責人。`
    );
  }
```

- [ ] **Step 7: Re-run the seed import against the linked project**

Run: `export $(grep -v '^#' .env.local | xargs) && npm run seed`
Expected: the console summary now reports importing the previously-skipped project-scoped codes (108, per the existing tech-debt note — confirm the actual printed count matches or note if it differs) and the follow-up reminder about missing owners.

- [ ] **Step 8: Run the full suite to confirm no regression**

Run: `export $(grep -v '^#' .env.local | xargs) && npm test`
Expected: all pass — in particular, `src/app/admin/master-data/page.tsx`'s budget-code listing (which only selects `code, category, fiscal_year`, not `department_id`) is unaffected by `department_id` becoming nullable.

- [ ] **Step 9: Commit**

```bash
git add supabase/migrations scripts/import-seed-data.ts tests/integration/budget-and-suppliers-schema.test.ts
git commit -m "feat: import project-scoped budget codes with nullable department_id + project_code"
```

---

## Task 11: Final verification pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full automated test suite**

Run: `export $(grep -v '^#' .env.local | xargs) && npm test`
Expected: all pass.

- [ ] **Step 2: Run lint and the production build**

Run: `npm run lint`
Expected: clean (Task 6 fixed this).

Run: `npm run build`
Expected: succeeds with no type errors.

- [ ] **Step 3: Manual browser QA checklist**

Start the dev server, log in as a real seeded employee, then:
1. Visit `/` while logged out → lands on `/login` (not a bare title page).
2. Deliberately trigger a login error (e.g. sign in with a non-`turing-drive.com` Google account, if you have one available) → `/login` shows the Traditional Chinese error message, not a silent redirect back to a blank form.
3. Every page you visit while logged in shows the top bar with "← 上一頁" / "🏠 儀表板"; clicking "← 上一頁" goes back in browser history.
4. Open a 驗收單 that is NOT yet approved as a `finance`/`admin` employee → the 財產編號 field is not editable (or editing it fails with the new error message) until the acceptance is approved.
5. Click 核准 twice in quick succession on the same pending step (two rapid clicks, or open the same detail page in two tabs and click both) → only one notification goes out; the second click either no-ops cleanly or shows "此表單已被處理，請重新整理頁面" without crashing the page.
6. Open `/cases/[caseNumber]` for a case with a created form that has no attachments → see the "憑證待補" badge; upload an attachment, refresh → badge disappears.
7. Create a new 請購單 near a Taipei-local month boundary if practical (otherwise skip — this is hard to test on demand) — otherwise just confirm the case number's year-month component matches today's Taipei-local month via `date` in a terminal set to `Asia/Taipei` vs. the generated case number.

- [ ] **Step 4: Commit any final fixups discovered during manual QA, then stop**

If Step 3 surfaces a real bug, fix it as a follow-up commit in whichever task's file it belongs to, re-run that task's tests, and re-run the full suite once more before considering Plan 4 done.

This concludes the 網頁內運作流程清理篇（Plan 4）plan.

