# 電子採購與簽核系統 — 地基篇 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the Next.js + Supabase foundation for the procurement system — project scaffold, database schema and RLS for master data (departments/employees/budget codes/suppliers), Google OAuth login restricted to the company domain, and a minimal authenticated app shell that proves the whole stack works end to end.

**Architecture:** Next.js (App Router, TypeScript) as a single full-stack app, backed by Supabase (Postgres + Auth + RLS). Server Components read data directly via a server-side Supabase client; a browser client drives the Google OAuth sign-in flow. Master data is seeded from the existing `reference/20260709_請採驗費用申請單.xlsx` workbook via a one-off Node script, not a UI (self-service master data admin is out of scope for this plan — see the design spec's Non-goals).

**Tech Stack:** Next.js 15 (App Router), React 19, TypeScript 5 (strict), Tailwind CSS 3, Supabase (`@supabase/supabase-js`, `@supabase/ssr`), Vitest, `xlsx` (SheetJS) for seed parsing, `tsx` for running scripts, Supabase CLI for migrations.

## Global Constraints

- Node.js >= 20, npm as the package manager (no yarn/pnpm lockfiles).
- TypeScript `strict: true`; no `any` in new code.
- All user-facing copy is Traditional Chinese, matching the terminology in the source forms (`reference/*.pdf`, `reference/*.xlsx`) — e.g. "部門", "員工", "預算編號", not translated English labels.
- No code comments except where a non-obvious business rule needs explaining (e.g. why a heuristic derives a flag from a job title).
- Secrets (`SUPABASE_SERVICE_ROLE_KEY`, etc.) only ever live in `.env.local` / CI secrets, never committed. `.env.local` must stay in `.gitignore` (already present from repo init).
- Every table's row-level security must default-deny; access is granted explicitly per policy.
- This plan targets the **hosted** Supabase project already created under the developer's personal account per `docs/superpowers/specs/2026-07-10-procurement-approval-system-design.md` (to be transferred to a company-owned org before go-live — tracked separately, not part of this plan).

---

## Task 1: Project scaffold (Next.js + TypeScript + Tailwind + Vitest)

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `next.config.ts`
- Create: `next-env.d.ts`
- Create: `tailwind.config.ts`
- Create: `postcss.config.mjs`
- Create: `vitest.config.ts`
- Create: `src/app/globals.css`
- Create: `src/app/layout.tsx`
- Create: `src/app/page.tsx`
- Create: `src/lib/env.ts`
- Test: `src/lib/env.test.ts`

**Interfaces:**
- Produces: `getRequiredEnv(name: string): string` from `src/lib/env.ts`, throws `Error('Missing required environment variable: ' + name)` when unset. Every later task that reads an env var uses this.

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "accsys",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint .",
    "test": "vitest run",
    "test:watch": "vitest",
    "seed": "tsx scripts/import-seed-data.ts"
  },
  "dependencies": {
    "next": "15.1.0",
    "react": "19.0.0",
    "react-dom": "19.0.0",
    "@supabase/supabase-js": "^2.47.10",
    "@supabase/ssr": "^0.5.2"
  },
  "devDependencies": {
    "typescript": "^5.7.2",
    "@types/node": "^22.10.2",
    "@types/react": "^19.0.2",
    "@types/react-dom": "^19.0.2",
    "tailwindcss": "^3.4.17",
    "postcss": "^8.4.49",
    "autoprefixer": "^10.4.20",
    "vitest": "^2.1.8",
    "xlsx": "^0.18.5",
    "tsx": "^4.19.2",
    "dotenv": "^16.4.7",
    "eslint": "^9.17.0",
    "eslint-config-next": "15.1.0"
  }
}
```

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2017",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: Write `next.config.ts`, `next-env.d.ts`, `tailwind.config.ts`, `postcss.config.mjs`**

`next.config.ts`:
```ts
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {};

export default nextConfig;
```

`next-env.d.ts`:
```ts
/// <reference types="next" />
/// <reference types="next/image-types/global" />
```

`tailwind.config.ts`:
```ts
import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: { extend: {} },
  plugins: [],
};

export default config;
```

`postcss.config.mjs`:
```js
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

- [ ] **Step 4: Write `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts', 'tests/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
```

- [ ] **Step 5: Write app shell files**

`src/app/globals.css`:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

`src/app/layout.tsx`:
```tsx
import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '台灣智慧駕駛 電子採購與簽核系統',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hant">
      <body>{children}</body>
    </html>
  );
}
```

`src/app/page.tsx`:
```tsx
export default function HomePage() {
  return (
    <main className="p-8">
      <h1 className="text-2xl font-bold">台灣智慧駕駛 電子採購與簽核系統</h1>
    </main>
  );
}
```

- [ ] **Step 6: Write the failing test for `getRequiredEnv`**

`src/lib/env.test.ts`:
```ts
import { afterEach, describe, expect, it } from 'vitest';
import { getRequiredEnv } from './env';

describe('getRequiredEnv', () => {
  afterEach(() => {
    delete process.env.TEST_VAR;
  });

  it('returns the value when the env var is set', () => {
    process.env.TEST_VAR = 'hello';
    expect(getRequiredEnv('TEST_VAR')).toBe('hello');
  });

  it('throws when the env var is missing', () => {
    expect(() => getRequiredEnv('TEST_VAR')).toThrow(
      'Missing required environment variable: TEST_VAR'
    );
  });

  it('throws when the env var is an empty string', () => {
    process.env.TEST_VAR = '   ';
    expect(() => getRequiredEnv('TEST_VAR')).toThrow(
      'Missing required environment variable: TEST_VAR'
    );
  });
});
```

- [ ] **Step 7: Run the test to verify it fails**

Run: `npm install && npm test -- src/lib/env.test.ts`
Expected: FAIL — `Cannot find module './env'` (file doesn't exist yet).

- [ ] **Step 8: Implement `getRequiredEnv`**

`src/lib/env.ts`:
```ts
export function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}
```

- [ ] **Step 9: Run the test to verify it passes**

Run: `npm test -- src/lib/env.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 10: Verify the app builds**

Run: `npm run build`
Expected: Build succeeds (no Supabase env vars are required yet since nothing reads them).

- [ ] **Step 11: Commit**

```bash
git add package.json tsconfig.json next.config.ts next-env.d.ts tailwind.config.ts postcss.config.mjs vitest.config.ts src/app src/lib/env.ts src/lib/env.test.ts package-lock.json
git commit -m "chore: scaffold Next.js + TypeScript + Tailwind + Vitest project"
```

---

## Task 2: Supabase CLI setup and environment scaffolding

**Files:**
- Create: `supabase/config.toml` (generated by CLI)
- Create: `.env.local.example`
- Modify: `.gitignore`

**Interfaces:**
- Produces: documented environment variable names (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ALLOWED_GOOGLE_DOMAIN`) that every later task's code reads via `getRequiredEnv`.

**Prerequisite (manual, one-time, outside this repo):** a Supabase project must already exist under the developer's account (Supabase dashboard → New Project). Note its Project Reference ID and the Project URL/anon key/service role key from Settings → API.

- [ ] **Step 1: Install the Supabase CLI and initialize**

Run: `brew install supabase/tap/supabase` (or `npm install -g supabase` if Homebrew isn't available)
Run: `supabase init`
Expected: creates `supabase/config.toml` and `supabase/.gitignore`.

- [ ] **Step 2: Link the local project to the hosted Supabase project**

Run: `supabase login`
Run: `supabase link --project-ref <your-project-ref>`
Expected: CLI confirms the link; you'll be prompted for the database password set when the project was created.

- [ ] **Step 3: Document required environment variables**

`.env.local.example`:
```bash
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key-from-supabase-dashboard>
SUPABASE_SERVICE_ROLE_KEY=<service-role-key-from-supabase-dashboard>
ALLOWED_GOOGLE_DOMAIN=turingdrive.ai
```

Copy this to `.env.local` and fill in real values (never commit `.env.local`).

- [ ] **Step 4: Confirm `.env.local` and Supabase local artifacts are gitignored**

Update `.gitignore` (append, don't remove existing entries):
```bash
.DS_Store
.claude/settings.local.json
node_modules/
.next/
.env
.env.local
supabase/.branches
supabase/.temp
```

- [ ] **Step 5: Verify**

Run: `supabase projects list`
Expected: your linked project appears in the output.
Run: `cat .env.local` (should exist locally, must NOT show up in `git status`)

- [ ] **Step 6: Commit**

```bash
git add .env.local.example .gitignore supabase/config.toml
git commit -m "chore: add Supabase CLI project and env var documentation"
```

---

## Task 3: Migration — `departments` and `employees` schema

**Files:**
- Create: `supabase/migrations/<timestamp>_master_data_core.sql`
- Create: `tests/integration/supabase-test-client.ts`
- Test: `tests/integration/master-data-schema.test.ts`

**Interfaces:**
- Produces: tables `departments(id, code, name, manager_employee_id, created_at)` and `employees(id, employee_code, name, department_id, title, google_email, role, is_general_manager, is_chairman, created_at)`. `employees.role` is one of `'staff' | 'finance' | 'admin'`, default `'staff'`.
- Consumes: nothing (first schema migration).

- [ ] **Step 1: Write the test client helper**

`tests/integration/supabase-test-client.ts`:
```ts
import { createClient } from '@supabase/supabase-js';

export function hasIntegrationTestCredentials(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.SUPABASE_SERVICE_ROLE_KEY &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

export function createServiceRoleTestClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export function createAnonTestClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
```

- [ ] **Step 2: Write the failing schema test**

`tests/integration/master-data-schema.test.ts`:
```ts
import { afterAll, describe, expect, it } from 'vitest';
import {
  createServiceRoleTestClient,
  hasIntegrationTestCredentials,
} from './supabase-test-client';

describe.skipIf(!hasIntegrationTestCredentials())('departments and employees schema', () => {
  const supabase = createServiceRoleTestClient();
  const departmentCode = `TEST-${Date.now()}`;
  let departmentId: string;

  afterAll(async () => {
    await supabase.from('employees').delete().eq('department_id', departmentId);
    await supabase.from('departments').delete().eq('id', departmentId);
  });

  it('inserts a department and reads it back', async () => {
    const { data, error } = await supabase
      .from('departments')
      .insert({ code: departmentCode, name: '測試部門' })
      .select()
      .single();

    expect(error).toBeNull();
    expect(data?.code).toBe(departmentCode);
    departmentId = data!.id;
  });

  it('rejects a duplicate department code', async () => {
    const { error } = await supabase
      .from('departments')
      .insert({ code: departmentCode, name: '重複部門' });

    expect(error).not.toBeNull();
  });

  it('inserts an employee linked to the department with default role staff', async () => {
    const { data, error } = await supabase
      .from('employees')
      .insert({
        employee_code: `EMP-${Date.now()}`,
        name: '測試員工',
        department_id: departmentId,
        google_email: `test-${Date.now()}@turingdrive.ai`,
      })
      .select()
      .single();

    expect(error).toBeNull();
    expect(data?.role).toBe('staff');
    expect(data?.is_general_manager).toBe(false);
    expect(data?.is_chairman).toBe(false);
  });

  it('rejects an employee with an invalid role', async () => {
    const { error } = await supabase.from('employees').insert({
      employee_code: `EMP-BAD-${Date.now()}`,
      name: '壞角色員工',
      department_id: departmentId,
      google_email: `bad-${Date.now()}@turingdrive.ai`,
      role: 'ceo',
    });

    expect(error).not.toBeNull();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test -- tests/integration/master-data-schema.test.ts`
Expected: FAIL — `relation "departments" does not exist` (table not created yet). If the test instead shows SKIP, set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` from `.env.local` in your shell first (`export $(cat .env.local | xargs)`).

- [ ] **Step 4: Create and write the migration**

Run: `supabase migration new master_data_core`
Expected: creates `supabase/migrations/<timestamp>_master_data_core.sql`. Open that file and write:

```sql
create extension if not exists "pgcrypto";

create table departments (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  manager_employee_id uuid,
  created_at timestamptz not null default now()
);

create table employees (
  id uuid primary key default gen_random_uuid(),
  employee_code text not null unique,
  name text not null,
  department_id uuid not null references departments(id),
  title text,
  google_email text unique,
  role text not null default 'staff' check (role in ('staff', 'finance', 'admin')),
  is_general_manager boolean not null default false,
  is_chairman boolean not null default false,
  created_at timestamptz not null default now()
);

alter table departments
  add constraint departments_manager_fk
  foreign key (manager_employee_id) references employees(id);
```

- [ ] **Step 5: Apply the migration to the linked project**

Run: `supabase db push`
Expected: CLI reports the migration applied successfully.

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm test -- tests/integration/master-data-schema.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations tests/integration/supabase-test-client.ts tests/integration/master-data-schema.test.ts
git commit -m "feat: add departments and employees schema"
```

---

## Task 4: Migration — `budget_codes` and `suppliers` schema

**Files:**
- Create: `supabase/migrations/<timestamp>_budget_and_suppliers.sql`
- Test: `tests/integration/budget-and-suppliers-schema.test.ts`

**Interfaces:**
- Consumes: `departments(id)`, `employees(id)` from Task 3.
- Produces: tables `budget_codes(id, code, department_id, category, owner_employee_id, fiscal_year, annual_budget_amount, created_at)` and `suppliers(id, name, short_name, tax_id, country, registered_address, mailing_address, phone, contact_name, contact_department, contact_phone, contact_mobile, email, bank_name, bank_branch, bank_account, account_name, currency, notes, created_at)`.

- [ ] **Step 1: Write the failing schema test**

`tests/integration/budget-and-suppliers-schema.test.ts`:
```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createServiceRoleTestClient,
  hasIntegrationTestCredentials,
} from './supabase-test-client';

describe.skipIf(!hasIntegrationTestCredentials())('budget_codes and suppliers schema', () => {
  let supabase: ReturnType<typeof createServiceRoleTestClient>;
  const departmentCode = `TEST-BC-${Date.now()}`;
  let departmentId: string;
  let employeeId: string;

  beforeAll(() => {
    supabase = createServiceRoleTestClient();
  });

  afterAll(async () => {
    await supabase.from('budget_codes').delete().eq('department_id', departmentId);
    await supabase.from('employees').delete().eq('id', employeeId);
    await supabase.from('departments').delete().eq('id', departmentId);
    await supabase.from('suppliers').delete().eq('name', '測試供應商');
  });

  it('inserts a budget code referencing a department and owner employee', async () => {
    const { data: dept } = await supabase
      .from('departments')
      .insert({ code: departmentCode, name: '測試預算部門' })
      .select()
      .single();
    departmentId = dept!.id;

    const { data: employee } = await supabase
      .from('employees')
      .insert({
        employee_code: `BC-EMP-${Date.now()}`,
        name: '測試預算負責人',
        department_id: departmentId,
        google_email: `bc-owner-${Date.now()}@turingdrive.ai`,
      })
      .select()
      .single();
    employeeId = employee!.id;

    const { data, error } = await supabase
      .from('budget_codes')
      .insert({
        code: `115TEST${Date.now()}`,
        department_id: departmentId,
        category: '材料',
        owner_employee_id: employeeId,
        fiscal_year: '115',
        annual_budget_amount: 100000,
      })
      .select()
      .single();

    expect(error).toBeNull();
    expect(data?.category).toBe('材料');
  });

  it('inserts a supplier with only a name and rejects a duplicate name', async () => {
    const { error: firstError } = await supabase
      .from('suppliers')
      .insert({ name: '測試供應商' });
    expect(firstError).toBeNull();

    const { error: duplicateError } = await supabase
      .from('suppliers')
      .insert({ name: '測試供應商' });
    expect(duplicateError).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/integration/budget-and-suppliers-schema.test.ts`
Expected: FAIL — `relation "budget_codes" does not exist`

- [ ] **Step 3: Create and write the migration**

Run: `supabase migration new budget_and_suppliers`

```sql
create table budget_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  department_id uuid not null references departments(id),
  category text not null,
  owner_employee_id uuid references employees(id),
  fiscal_year text not null,
  annual_budget_amount numeric(14, 2),
  created_at timestamptz not null default now()
);

create table suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  short_name text,
  tax_id text,
  country text,
  registered_address text,
  mailing_address text,
  phone text,
  contact_name text,
  contact_department text,
  contact_phone text,
  contact_mobile text,
  email text,
  bank_name text,
  bank_branch text,
  bank_account text,
  account_name text,
  currency text,
  notes text,
  created_at timestamptz not null default now()
);
```

- [ ] **Step 4: Apply the migration**

Run: `supabase db push`

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- tests/integration/budget-and-suppliers-schema.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations tests/integration/budget-and-suppliers-schema.test.ts
git commit -m "feat: add budget_codes and suppliers schema"
```

---

## Task 5: Row Level Security for master data tables

**Files:**
- Create: `supabase/migrations/<timestamp>_master_data_rls.sql`
- Test: `tests/integration/master-data-rls.test.ts`

**Interfaces:**
- Consumes: `departments`, `employees`, `budget_codes`, `suppliers` from Tasks 3–4.
- Produces: SQL function `is_admin()` usable by later migrations; RLS policies: any authenticated user can `select` from all four tables, only a user whose `employees.role = 'admin'` row matches their JWT email can insert/update/delete.

- [ ] **Step 1: Write the failing RLS test**

`tests/integration/master-data-rls.test.ts`:
```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createAnonTestClient,
  createServiceRoleTestClient,
  hasIntegrationTestCredentials,
} from './supabase-test-client';

describe.skipIf(!hasIntegrationTestCredentials())('master data RLS policies', () => {
  let adminClient: ReturnType<typeof createServiceRoleTestClient>;
  const password = 'Test-password-123!';
  const staffEmail = `rls-staff-${Date.now()}@turingdrive.ai`;
  const adminEmail = `rls-admin-${Date.now()}@turingdrive.ai`;

  let departmentId: string;
  let staffAuthUserId: string;
  let adminAuthUserId: string;

  beforeAll(async () => {
    adminClient = createServiceRoleTestClient();

    const { data: dept, error: deptError } = await adminClient
      .from('departments')
      .insert({ code: `RLS-${Date.now()}`, name: 'RLS 測試部門' })
      .select()
      .single();
    if (deptError) throw deptError;
    departmentId = dept.id;

    const { data: staffUser, error: staffAuthError } = await adminClient.auth.admin.createUser({
      email: staffEmail,
      password,
      email_confirm: true,
    });
    if (staffAuthError) throw staffAuthError;
    staffAuthUserId = staffUser.user.id;

    const { data: adminUser, error: adminAuthError } = await adminClient.auth.admin.createUser({
      email: adminEmail,
      password,
      email_confirm: true,
    });
    if (adminAuthError) throw adminAuthError;
    adminAuthUserId = adminUser.user.id;

    const { error: employeesError } = await adminClient.from('employees').insert([
      {
        employee_code: `RLS-STAFF-${Date.now()}`,
        name: 'RLS Staff',
        department_id: departmentId,
        google_email: staffEmail,
        role: 'staff',
      },
      {
        employee_code: `RLS-ADMIN-${Date.now()}`,
        name: 'RLS Admin',
        department_id: departmentId,
        google_email: adminEmail,
        role: 'admin',
      },
    ]);
    if (employeesError) throw employeesError;
  });

  afterAll(async () => {
    await adminClient.auth.admin.deleteUser(staffAuthUserId);
    await adminClient.auth.admin.deleteUser(adminAuthUserId);
    await adminClient.from('employees').delete().eq('department_id', departmentId);
    await adminClient.from('departments').delete().eq('id', departmentId);
  });

  it('allows an authenticated staff user to read departments', async () => {
    const staffClient = createAnonTestClient();
    const { error: signInError } = await staffClient.auth.signInWithPassword({
      email: staffEmail,
      password,
    });
    expect(signInError).toBeNull();

    const { data, error } = await staffClient
      .from('departments')
      .select('*')
      .eq('id', departmentId);

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it('blocks a staff user from creating a department', async () => {
    const staffClient = createAnonTestClient();
    await staffClient.auth.signInWithPassword({ email: staffEmail, password });

    const { error } = await staffClient
      .from('departments')
      .insert({ code: `RLS-DENY-${Date.now()}`, name: '不應該成功' });

    expect(error).not.toBeNull();
  });

  it('allows an admin user to create and delete a department', async () => {
    const adminAuthClient = createAnonTestClient();
    await adminAuthClient.auth.signInWithPassword({ email: adminEmail, password });

    const { data, error } = await adminAuthClient
      .from('departments')
      .insert({ code: `RLS-ALLOW-${Date.now()}`, name: '應該成功' })
      .select()
      .single();

    expect(error).toBeNull();
    expect(data?.name).toBe('應該成功');

    await adminClient.from('departments').delete().eq('id', data!.id);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/integration/master-data-rls.test.ts`
Expected: FAIL — the "blocks a staff user" assertion fails because RLS isn't enabled yet (insert succeeds when it should be denied).

- [ ] **Step 3: Create and write the RLS migration**

Run: `supabase migration new master_data_rls`

```sql
create or replace function is_admin() returns boolean
language sql stable
as $$
  select exists (
    select 1 from employees e
    where e.google_email = auth.jwt() ->> 'email'
    and e.role = 'admin'
  );
$$;

alter table departments enable row level security;
alter table employees enable row level security;
alter table budget_codes enable row level security;
alter table suppliers enable row level security;

create policy "authenticated_read_departments" on departments
  for select using (auth.role() = 'authenticated');
create policy "admin_manage_departments" on departments
  for all using (is_admin()) with check (is_admin());

create policy "authenticated_read_employees" on employees
  for select using (auth.role() = 'authenticated');
create policy "admin_manage_employees" on employees
  for all using (is_admin()) with check (is_admin());

create policy "authenticated_read_budget_codes" on budget_codes
  for select using (auth.role() = 'authenticated');
create policy "admin_manage_budget_codes" on budget_codes
  for all using (is_admin()) with check (is_admin());

create policy "authenticated_read_suppliers" on suppliers
  for select using (auth.role() = 'authenticated');
create policy "admin_manage_suppliers" on suppliers
  for all using (is_admin()) with check (is_admin());
```

- [ ] **Step 4: Apply the migration**

Run: `supabase db push`

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- tests/integration/master-data-rls.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations tests/integration/master-data-rls.test.ts
git commit -m "feat: enable RLS on master data tables, admin-only writes"
```

---

## Task 6: Supabase client helpers and session middleware

**Files:**
- Create: `src/lib/supabase/client.ts`
- Create: `src/lib/supabase/server.ts`
- Create: `src/lib/auth/public-paths.ts`
- Test: `src/lib/auth/public-paths.test.ts`
- Create: `src/middleware.ts`

**Interfaces:**
- Consumes: `getRequiredEnv` from Task 1.
- Produces: `createSupabaseBrowserClient()`, `createSupabaseServerClient()` (async, returns a Supabase client bound to Next.js cookies), `isPublicPath(pathname: string, publicPaths?: string[]): boolean`. Later tasks (7, 9, 10, 11) build on these.

- [ ] **Step 1: Write the failing test for `isPublicPath`**

`src/lib/auth/public-paths.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { isPublicPath } from './public-paths';

describe('isPublicPath', () => {
  it('treats the home page as public', () => {
    expect(isPublicPath('/')).toBe(true);
  });

  it('treats the login page as public', () => {
    expect(isPublicPath('/login')).toBe(true);
  });

  it('treats the auth callback as public', () => {
    expect(isPublicPath('/auth/callback')).toBe(true);
  });

  it('treats the dashboard as protected', () => {
    expect(isPublicPath('/dashboard')).toBe(false);
  });

  it('treats admin pages as protected', () => {
    expect(isPublicPath('/admin/master-data')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/lib/auth/public-paths.test.ts`
Expected: FAIL — `Cannot find module './public-paths'`

- [ ] **Step 3: Implement `isPublicPath`**

`src/lib/auth/public-paths.ts`:
```ts
export const PUBLIC_PATHS = ['/login', '/auth/callback'];

export function isPublicPath(pathname: string, publicPaths: string[] = PUBLIC_PATHS): boolean {
  return pathname === '/' || publicPaths.some((path) => pathname.startsWith(path));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/lib/auth/public-paths.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Write the Supabase browser and server client helpers**

`src/lib/supabase/client.ts`:
```ts
'use client';

import { createBrowserClient } from '@supabase/ssr';
import { getRequiredEnv } from '@/lib/env';

export function createSupabaseBrowserClient() {
  return createBrowserClient(
    getRequiredEnv('NEXT_PUBLIC_SUPABASE_URL'),
    getRequiredEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY')
  );
}
```

`src/lib/supabase/server.ts`:
```ts
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { getRequiredEnv } from '@/lib/env';

export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient(
    getRequiredEnv('NEXT_PUBLIC_SUPABASE_URL'),
    getRequiredEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from a Server Component; middleware refreshes the session instead.
          }
        },
      },
    }
  );
}
```

- [ ] **Step 6: Write session-refresh and route-protection middleware**

`src/middleware.ts`:
```ts
import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { getRequiredEnv } from '@/lib/env';
import { isPublicPath } from '@/lib/auth/public-paths';

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    getRequiredEnv('NEXT_PUBLIC_SUPABASE_URL'),
    getRequiredEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && !isPublicPath(request.nextUrl.pathname)) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
```

- [ ] **Step 7: Verify the build succeeds**

Run: `npm run build`
Expected: build fails with a clear `getRequiredEnv` error unless `.env.local` has `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` set (from Task 2) — set them, then rerun. Expected: build succeeds.

- [ ] **Step 8: Commit**

```bash
git add src/lib/supabase src/lib/auth/public-paths.ts src/lib/auth/public-paths.test.ts src/middleware.ts
git commit -m "feat: add Supabase client helpers and session middleware"
```

---

## Task 7: Seed workbook parser

**Files:**
- Create: `scripts/lib/parse-seed-workbook.ts`
- Test: `scripts/lib/parse-seed-workbook.test.ts`

**Interfaces:**
- Consumes: `reference/20260709_請採驗費用申請單.xlsx` (already in the repo) as its default input file.
- Produces: `parseSeedWorkbook(filePath: string): { employees: ParsedEmployee[]; budgetCodes: ParsedBudgetCode[]; suppliers: ParsedSupplier[] }`. Task 8 consumes this directly.

- [ ] **Step 1: Write the failing test using the real reference workbook as fixture**

`scripts/lib/parse-seed-workbook.test.ts`:
```ts
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseSeedWorkbook } from './parse-seed-workbook';

const FIXTURE_PATH = path.join(
  process.cwd(),
  'reference',
  '20260709_請採驗費用申請單.xlsx'
);

describe('parseSeedWorkbook', () => {
  const result = parseSeedWorkbook(FIXTURE_PATH);

  it('parses all 39 employees from the link sheet', () => {
    expect(result.employees).toHaveLength(39);
  });

  it('parses employee fields correctly for a known row', () => {
    const chairman = result.employees.find((e) => e.employeeCode === '0001');
    expect(chairman).toEqual({
      employeeCode: '0001',
      name: '陳維隆',
      departmentName: '董事長室',
      departmentCode: 'CO',
      managerName: '陳維隆',
      title: '董事長',
    });
  });

  it('parses all 293 unique budget codes', () => {
    const uniqueCodes = new Set(result.budgetCodes.map((b) => b.code));
    expect(uniqueCodes.size).toBe(293);
  });

  it('parses budget code fields correctly for a known row', () => {
    const budget = result.budgetCodes.find((b) => b.code === '115ADSE01');
    expect(budget).toEqual({
      code: '115ADSE01',
      departmentCode: 'AD',
      category: '人事費',
      fiscalYear: '115',
      annualBudgetAmount: -4063966,
    });
  });

  it('parses all 4 suppliers', () => {
    expect(result.suppliers).toHaveLength(4);
    expect(result.suppliers.map((s) => s.name)).toEqual([
      '中華電信',
      '遠傳',
      '台灣大哥大',
      '台灣之星',
    ]);
  });

  it('parses supplier contact fields', () => {
    const supplier = result.suppliers.find((s) => s.name === '中華電信');
    expect(supplier).toEqual({
      name: '中華電信',
      phone: '02-2706-6918#6988',
      email: 'summer797731@gmail.com',
      contactName: '王先生',
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- scripts/lib/parse-seed-workbook.test.ts`
Expected: FAIL — `Cannot find module './parse-seed-workbook'`

- [ ] **Step 3: Implement the parser**

`scripts/lib/parse-seed-workbook.ts`:
```ts
import * as XLSX from 'xlsx';

export type ParsedEmployee = {
  employeeCode: string;
  name: string;
  departmentName: string;
  departmentCode: string;
  managerName: string;
  title: string;
};

export type ParsedBudgetCode = {
  code: string;
  departmentCode: string;
  category: string;
  fiscalYear: string;
  annualBudgetAmount: number | null;
};

export type ParsedSupplier = {
  name: string;
  phone: string | null;
  email: string | null;
  contactName: string | null;
};

export type ParsedSeedWorkbook = {
  employees: ParsedEmployee[];
  budgetCodes: ParsedBudgetCode[];
  suppliers: ParsedSupplier[];
};

function cell(row: unknown[], index: number): string {
  return String(row[index] ?? '').trim();
}

export function parseSeedWorkbook(filePath: string): ParsedSeedWorkbook {
  const workbook = XLSX.readFile(filePath);

  const linkSheet = workbook.Sheets['link'];
  const linkRows: unknown[][] = XLSX.utils.sheet_to_json(linkSheet, {
    header: 1,
    raw: true,
  });

  const employees: ParsedEmployee[] = [];
  const budgetCodes: ParsedBudgetCode[] = [];

  for (const row of linkRows.slice(1)) {
    const employeeCode = cell(row, 1); // column B
    if (employeeCode !== '') {
      employees.push({
        employeeCode,
        name: cell(row, 2), // C
        departmentName: cell(row, 3), // D
        departmentCode: cell(row, 4), // E
        managerName: cell(row, 5), // F
        title: cell(row, 6), // G
      });
    }

    const budgetCode = cell(row, 22); // column W
    if (budgetCode !== '') {
      const fiscalYearMatch = budgetCode.match(/^\d{3}/);
      const rawAmount = row[24]; // column Y
      budgetCodes.push({
        code: budgetCode,
        departmentCode: cell(row, 18), // S
        category: cell(row, 21), // V
        fiscalYear: fiscalYearMatch ? fiscalYearMatch[0] : '',
        annualBudgetAmount: typeof rawAmount === 'number' ? rawAmount : null,
      });
    }
  }

  const supplierSheet = workbook.Sheets['供應商資料'];
  const supplierRows: unknown[][] = XLSX.utils.sheet_to_json(supplierSheet, {
    header: 1,
    raw: true,
  });

  const suppliers: ParsedSupplier[] = supplierRows
    .slice(1)
    .filter((row) => cell(row, 0) !== '')
    .map((row) => ({
      name: cell(row, 0),
      phone: cell(row, 1) || null,
      email: cell(row, 2) || null,
      contactName: cell(row, 3) || null,
    }));

  return { employees, budgetCodes, suppliers };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- scripts/lib/parse-seed-workbook.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/parse-seed-workbook.ts scripts/lib/parse-seed-workbook.test.ts
git commit -m "feat: parse master data from the reference seed workbook"
```

---

## Task 8: Seed import script (writes parsed data to Supabase)

**Files:**
- Create: `scripts/import-seed-data.ts`

**Interfaces:**
- Consumes: `parseSeedWorkbook` from Task 7; `getRequiredEnv` from Task 1.
- Produces: populated `departments`, `employees`, `budget_codes`, `suppliers` tables in the linked Supabase project. No other task depends on this script's internals — only on the data it produces.

This task has no automated test (it performs live writes against the hosted database, which the integration tests in Tasks 3–5 already exercise against disposable test rows). Verification is manual, via row counts in the last step.

- [ ] **Step 1: Write the seed script**

`scripts/import-seed-data.ts`:
```ts
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { parseSeedWorkbook } from './lib/parse-seed-workbook';
import { getRequiredEnv } from '../src/lib/env';

const SEED_FILE = 'reference/20260709_請採驗費用申請單.xlsx';

async function main() {
  const supabase = createClient(
    getRequiredEnv('NEXT_PUBLIC_SUPABASE_URL'),
    getRequiredEnv('SUPABASE_SERVICE_ROLE_KEY')
  );

  const { employees, budgetCodes, suppliers } = parseSeedWorkbook(SEED_FILE);

  const departmentByCode = new Map<string, { name: string; managerName: string }>();
  for (const emp of employees) {
    if (!departmentByCode.has(emp.departmentCode)) {
      departmentByCode.set(emp.departmentCode, {
        name: emp.departmentName,
        managerName: emp.managerName,
      });
    }
  }

  for (const [code, dept] of departmentByCode) {
    const { error } = await supabase
      .from('departments')
      .upsert({ code, name: dept.name }, { onConflict: 'code' });
    if (error) throw error;
  }

  const { data: departmentRows, error: departmentReadError } = await supabase
    .from('departments')
    .select('id, code');
  if (departmentReadError) throw departmentReadError;
  const departmentIdByCode = new Map(departmentRows.map((d) => [d.code, d.id]));

  for (const emp of employees) {
    const departmentId = departmentIdByCode.get(emp.departmentCode);
    if (!departmentId) {
      console.warn(`跳過員工 ${emp.name}：找不到部門代碼 ${emp.departmentCode}`);
      continue;
    }

    const { error } = await supabase.from('employees').upsert(
      {
        employee_code: emp.employeeCode,
        name: emp.name,
        department_id: departmentId,
        title: emp.title,
        is_general_manager: emp.title === '執行長' || emp.title === '總經理',
        is_chairman: emp.title === '董事長',
      },
      { onConflict: 'employee_code' }
    );
    if (error) throw error;
  }

  const { data: employeeRows, error: employeeReadError } = await supabase
    .from('employees')
    .select('id, name');
  if (employeeReadError) throw employeeReadError;

  for (const [code, dept] of departmentByCode) {
    const departmentId = departmentIdByCode.get(code);
    const manager = employeeRows.find((e) => e.name === dept.managerName);
    if (!manager) {
      console.warn(`跳過部門主管設定：部門 ${code} 找不到員工「${dept.managerName}」`);
      continue;
    }
    const { error } = await supabase
      .from('departments')
      .update({ manager_employee_id: manager.id })
      .eq('id', departmentId);
    if (error) throw error;
  }

  const { data: refreshedDepartments, error: refreshedDeptError } = await supabase
    .from('departments')
    .select('id, code, manager_employee_id');
  if (refreshedDeptError) throw refreshedDeptError;
  const managerIdByDeptCode = new Map(
    refreshedDepartments.map((d) => [d.code, d.manager_employee_id])
  );

  const uniqueBudgetCodes = new Map(budgetCodes.map((b) => [b.code, b]));
  let insertedBudgetCodeCount = 0;
  let skippedProjectScopedBudgetCodeCount = 0;
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

  for (const supplier of suppliers) {
    const { error } = await supabase.from('suppliers').upsert(
      {
        name: supplier.name,
        phone: supplier.phone,
        email: supplier.email,
        contact_name: supplier.contactName,
      },
      { onConflict: 'name' }
    );
    if (error) throw error;
  }

  console.log(
    `匯入完成：${departmentByCode.size} 個部門、${employees.length} 位員工、${insertedBudgetCodeCount} 個預算編號、${suppliers.length} 家供應商。`
  );
  if (skippedProjectScopedBudgetCodeCount > 0) {
    console.log(
      `已略過 ${skippedProjectScopedBudgetCodeCount} 個專案型預算編號（部門代號欄位填的是專案代碼，不在 8 個部門代碼中）——這批專案預算的部門歸屬解析留待後續任務處理，本次匯入僅涵蓋部門型預算。`
    );
  }
  console.log(
    '提醒：所有員工預設角色為 staff，且尚未設定 google_email。請於 Supabase Studio 手動：' +
      '(1) 補上每位員工的 google_email 才能登入，(2) 將財會與系統管理員設為對應角色 (finance / admin)。'
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **Step 2: Run the script against the linked Supabase project**

Run: `npm run seed`
Expected output ends with:
```
匯入完成：8 個部門、39 位員工、185 個預算編號、4 家供應商。
已略過 108 個專案型預算編號（部門代號欄位填的是專案代碼，不在 8 個部門代碼中）——這批專案預算的部門歸屬解析留待後續任務處理，本次匯入僅涵蓋部門型預算。
提醒：所有員工預設角色為 staff，且尚未設定 google_email。...
```

Note: the source workbook has 293 unique budget codes total (Task 7's parser correctly extracts all of them), but 108 of those rows carry a *project* code (e.g. `112BD003`) in the department-code column instead of one of the 8 real department codes — those are project-scoped budgets whose department attribution lives in a different column. This plan's scope only imports department-scoped budgets (185 rows); resolving project-scoped budgets to a department is deferred to a later task.

- [ ] **Step 3: Manually verify row counts in Supabase Studio**

Open the Supabase dashboard → Table Editor. Confirm: `departments` has 8 rows, `employees` has 39 rows, `budget_codes` has 185 rows, `suppliers` has 4 rows, and every `departments.manager_employee_id` is non-null.

- [ ] **Step 4: Set your own employee's `google_email` and `role` so you can log in**

In Supabase Studio, find your row in `employees` (e.g. by `name`), set `google_email` to your company Google address and `role` to `admin`.

- [ ] **Step 5: Commit**

```bash
git add scripts/import-seed-data.ts
git commit -m "feat: add seed import script for master data"
```

---

## Task 9: Google OAuth login restricted to the company domain

**Files:**
- Create: `src/lib/auth/allowed-domain.ts`
- Test: `src/lib/auth/allowed-domain.test.ts`
- Create: `src/app/login/page.tsx`
- Create: `src/app/auth/callback/route.ts`

**Interfaces:**
- Consumes: `createSupabaseBrowserClient`, `createSupabaseServerClient` from Task 6; `getRequiredEnv` from Task 1.
- Produces: `isAllowedEmail(email: string, allowedDomain: string): boolean`, routes `GET /login` and `GET /auth/callback`. Task 11's dashboard assumes users arriving there have already passed this domain check.

**Manual prerequisite (Supabase dashboard):** Authentication → Providers → enable Google, with the OAuth Client ID/Secret from Google Cloud Console (Authorized redirect URI: `https://<project-ref>.supabase.co/auth/v1/callback`).

- [ ] **Step 1: Write the failing test for the domain check**

`src/lib/auth/allowed-domain.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { isAllowedEmail } from './allowed-domain';

describe('isAllowedEmail', () => {
  it('accepts an email on the allowed domain', () => {
    expect(isAllowedEmail('user@turingdrive.ai', 'turingdrive.ai')).toBe(true);
  });

  it('rejects an email on a different domain', () => {
    expect(isAllowedEmail('user@gmail.com', 'turingdrive.ai')).toBe(false);
  });

  it('is case-insensitive on the domain', () => {
    expect(isAllowedEmail('user@TuringDrive.AI', 'turingdrive.ai')).toBe(true);
  });

  it('rejects a domain that merely ends with the allowed domain', () => {
    expect(isAllowedEmail('user@notturingdrive.ai', 'turingdrive.ai')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/lib/auth/allowed-domain.test.ts`
Expected: FAIL — `Cannot find module './allowed-domain'`

- [ ] **Step 3: Implement `isAllowedEmail`**

`src/lib/auth/allowed-domain.ts`:
```ts
export function isAllowedEmail(email: string, allowedDomain: string): boolean {
  const [, domain] = email.toLowerCase().split('@');
  return domain === allowedDomain.toLowerCase();
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/lib/auth/allowed-domain.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Write the login page**

`src/app/login/page.tsx`:
```tsx
'use client';

import { createSupabaseBrowserClient } from '@/lib/supabase/client';

export default function LoginPage() {
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

- [ ] **Step 6: Write the OAuth callback route**

`src/app/auth/callback/route.ts`:
```ts
import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getRequiredEnv } from '@/lib/env';
import { isAllowedEmail } from '@/lib/auth/allowed-domain';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=auth_failed`);
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(`${origin}/login?error=auth_failed`);
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const allowedDomain = getRequiredEnv('ALLOWED_GOOGLE_DOMAIN');

  if (!user?.email || !isAllowedEmail(user.email, allowedDomain)) {
    await supabase.auth.signOut();
    return NextResponse.redirect(`${origin}/login?error=domain_not_allowed`);
  }

  return NextResponse.redirect(`${origin}/dashboard`);
}
```

- [ ] **Step 7: Manually verify the login flow**

Run: `npm run dev`, open `http://localhost:3000/login`, click "使用 Google 帳號登入", sign in with your company Google account (the one you set as `google_email` in Task 8, Step 4).
Expected: redirected to `/dashboard` (a 404 is fine for now — Task 11 builds that page). Try signing in with a non-company Google account; expected: redirected back to `/login?error=domain_not_allowed`.

- [ ] **Step 8: Commit**

```bash
git add src/lib/auth/allowed-domain.ts src/lib/auth/allowed-domain.test.ts src/app/login src/app/auth
git commit -m "feat: add Google OAuth login restricted to the company domain"
```

---

## Task 10: Current-employee resolution helper

**Files:**
- Create: `src/lib/auth/current-employee.ts`
- Test: `src/lib/auth/current-employee.test.ts`

**Interfaces:**
- Consumes: any Supabase client with `.auth.getUser()` and `.from('employees')...`.
- Produces: `getCurrentEmployee(supabase): Promise<CurrentEmployee | null>` where `CurrentEmployee = { id, employeeCode, name, departmentId, role: 'staff' | 'finance' | 'admin', isGeneralManager, isChairman }`. Task 11's dashboard and admin page, and every later plan's approval-routing logic, use this.

- [ ] **Step 1: Write the failing test with a mocked Supabase client**

`src/lib/auth/current-employee.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest';
import { getCurrentEmployee } from './current-employee';

function createMockSupabase(options: {
  email?: string;
  employeeRow?: Record<string, unknown> | null;
}) {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: options.email ? { email: options.email } : null },
      }),
    },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: options.employeeRow ?? null,
            error: null,
          }),
        }),
      }),
    }),
  };
}

describe('getCurrentEmployee', () => {
  it('returns null when there is no logged-in user', async () => {
    const supabase = createMockSupabase({});
    const result = await getCurrentEmployee(supabase as never);
    expect(result).toBeNull();
  });

  it('returns null when the email has no matching employee row', async () => {
    const supabase = createMockSupabase({
      email: 'nobody@turingdrive.ai',
      employeeRow: null,
    });
    const result = await getCurrentEmployee(supabase as never);
    expect(result).toBeNull();
  });

  it('maps the employee row to a CurrentEmployee', async () => {
    const supabase = createMockSupabase({
      email: 'user@turingdrive.ai',
      employeeRow: {
        id: 'emp-1',
        employee_code: '0091',
        name: '李盈萱',
        department_id: 'dept-1',
        role: 'admin',
        is_general_manager: false,
        is_chairman: false,
      },
    });

    const result = await getCurrentEmployee(supabase as never);

    expect(result).toEqual({
      id: 'emp-1',
      employeeCode: '0091',
      name: '李盈萱',
      departmentId: 'dept-1',
      role: 'admin',
      isGeneralManager: false,
      isChairman: false,
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/lib/auth/current-employee.test.ts`
Expected: FAIL — `Cannot find module './current-employee'`

- [ ] **Step 3: Implement `getCurrentEmployee`**

`src/lib/auth/current-employee.ts`:
```ts
import type { SupabaseClient } from '@supabase/supabase-js';

export type CurrentEmployee = {
  id: string;
  employeeCode: string;
  name: string;
  departmentId: string;
  role: 'staff' | 'finance' | 'admin';
  isGeneralManager: boolean;
  isChairman: boolean;
};

export async function getCurrentEmployee(
  supabase: SupabaseClient
): Promise<CurrentEmployee | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) {
    return null;
  }

  const { data, error } = await supabase
    .from('employees')
    .select('id, employee_code, name, department_id, role, is_general_manager, is_chairman')
    .eq('google_email', user.email)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return {
    id: data.id,
    employeeCode: data.employee_code,
    name: data.name,
    departmentId: data.department_id,
    role: data.role,
    isGeneralManager: data.is_general_manager,
    isChairman: data.is_chairman,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/lib/auth/current-employee.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth/current-employee.ts src/lib/auth/current-employee.test.ts
git commit -m "feat: add getCurrentEmployee session resolution helper"
```

---

## Task 11: Authenticated dashboard and admin master-data page

**Files:**
- Create: `src/app/dashboard/page.tsx`
- Create: `src/app/admin/master-data/page.tsx`

**Interfaces:**
- Consumes: `createSupabaseServerClient` (Task 6), `getCurrentEmployee` (Task 10).
- Produces: pages at `/dashboard` and `/admin/master-data`. Nothing later in this plan depends on these, but Plan 2 (Purchase Request + Approval Engine) will link its request form from `/dashboard`.

This task is UI wiring on top of already-tested helpers; verification here is manual (browser), not unit tests.

- [ ] **Step 1: Write the dashboard page**

`src/app/dashboard/page.tsx`:
```tsx
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getCurrentEmployee } from '@/lib/auth/current-employee';

export default async function DashboardPage() {
  const supabase = await createSupabaseServerClient();
  const employee = await getCurrentEmployee(supabase);

  if (!employee) {
    redirect('/login?error=not_registered');
  }

  return (
    <main className="p-8">
      <h1 className="text-2xl font-bold">歡迎，{employee.name}</h1>
      <p className="mt-2 text-gray-600">
        工號：{employee.employeeCode}｜角色：{employee.role}
      </p>
      {employee.role === 'admin' && (
        <a href="/admin/master-data" className="mt-4 inline-block text-blue-600 underline">
          主檔資料總覽
        </a>
      )}
    </main>
  );
}
```

- [ ] **Step 2: Write the admin master-data page**

`src/app/admin/master-data/page.tsx`:
```tsx
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getCurrentEmployee } from '@/lib/auth/current-employee';

export default async function MasterDataPage() {
  const supabase = await createSupabaseServerClient();
  const employee = await getCurrentEmployee(supabase);

  if (!employee) {
    redirect('/login');
  }
  if (employee.role !== 'admin') {
    redirect('/dashboard');
  }

  const [
    { data: departments },
    { data: employees },
    { data: budgetCodes },
    { data: suppliers },
  ] = await Promise.all([
    supabase.from('departments').select('code, name').order('code'),
    supabase
      .from('employees')
      .select('employee_code, name, department_id, role')
      .order('employee_code'),
    supabase.from('budget_codes').select('code, category, fiscal_year').order('code'),
    supabase.from('suppliers').select('name, phone, email').order('name'),
  ]);

  return (
    <main className="space-y-8 p-8">
      <h1 className="text-2xl font-bold">主檔資料總覽</h1>

      <section>
        <h2 className="text-lg font-semibold">部門（{departments?.length ?? 0}）</h2>
        <ul className="list-disc pl-6">
          {departments?.map((d) => (
            <li key={d.code}>
              {d.code} — {d.name}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="text-lg font-semibold">員工（{employees?.length ?? 0}）</h2>
        <ul className="list-disc pl-6">
          {employees?.map((e) => (
            <li key={e.employee_code}>
              {e.employee_code} — {e.name}（{e.role}）
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="text-lg font-semibold">預算編號（{budgetCodes?.length ?? 0}）</h2>
        <ul className="list-disc pl-6">
          {budgetCodes?.map((b) => (
            <li key={b.code}>
              {b.code} — {b.category}（{b.fiscal_year}年）
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="text-lg font-semibold">供應商（{suppliers?.length ?? 0}）</h2>
        <ul className="list-disc pl-6">
          {suppliers?.map((s) => (
            <li key={s.name}>
              {s.name}
              {s.phone ? ` — ${s.phone}` : ''}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
```

- [ ] **Step 3: Manually verify in the browser**

Run: `npm run dev`, log in via `/login` as the admin employee you configured in Task 8, Step 4.
Expected: `/dashboard` shows your name, employee code, and role, plus a link to "主檔資料總覽" (only because your role is `admin`). Clicking it shows `/admin/master-data` with 8 departments, 39 employees, 185 budget codes, 4 suppliers.
Log out (clear cookies) and hit `/dashboard` directly.
Expected: redirected to `/login` (middleware from Task 6 blocks unauthenticated access).

- [ ] **Step 4: Commit**

```bash
git add src/app/dashboard src/app/admin
git commit -m "feat: add authenticated dashboard and admin master-data page"
```

---

## Task 12: Final verification pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full automated test suite**

Run: `npm test`
Expected: all tests pass (env, public-paths, allowed-domain, current-employee unit tests always run; the `tests/integration/*` and schema/RLS suites run if `.env.local` credentials are exported in the shell, otherwise they report as skipped — confirm they are not skipped by running `export $(cat .env.local | xargs) && npm test`).

- [ ] **Step 2: Run a production build**

Run: `npm run build`
Expected: build succeeds with no type errors.

- [ ] **Step 3: Walk the manual QA checklist**

1. `npm run dev`, visit `/` — shows the app title, no errors in console.
2. Visit `/dashboard` while logged out — redirected to `/login`.
3. Log in with a non-company Google account (if you have one to test with) — redirected to `/login?error=domain_not_allowed`.
4. Log in with your configured company account — redirected to `/dashboard`, shows correct name/employee code/role.
5. As an `admin`-role employee, visit `/admin/master-data` — counts match Task 8's verified numbers (8/39/185/4).
6. Temporarily set your `employees.role` to `staff` in Supabase Studio, reload `/admin/master-data` — redirected to `/dashboard`. Set your role back to `admin` afterward.

- [ ] **Step 4: Confirm no secrets are tracked by git**

Run: `git status` — `.env.local` must not appear as tracked or staged.
Run: `git log --all --full-history -- .env.local` — expect no output (never committed).

This concludes the Foundation plan. Plan 2 ("請購單 + 簽核引擎篇") builds `procurement_cases`, `purchase_requests`, `approval_steps`, and `notifications` on top of the `departments`/`employees`/`budget_codes` tables and the `getCurrentEmployee` helper established here.
