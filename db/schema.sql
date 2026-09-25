-- ACCSYS PostgreSQL schema (portable, no Supabase / RLS).
-- Source of truth for DDL. Apply to any Postgres 14+ instance.
--
-- Local:  docker compose (auto on first boot) or npm run db:schema:apply
-- GCP:    psql $DATABASE_URL -f db/schema.sql  (Cloud SQL, VM, or AlloyDB)

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Master data
-- ---------------------------------------------------------------------------

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

create table projects (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  created_at timestamptz not null default now()
);

create table budget_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  department_id uuid references departments(id),
  project_id uuid references projects(id),
  category text not null,
  owner_employee_id uuid references employees(id),
  fiscal_year text not null,
  annual_budget_amount numeric(14, 2),
  created_at timestamptz not null default now(),
  constraint budget_codes_department_or_project_check
    check ((department_id is not null) <> (project_id is not null))
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

-- ---------------------------------------------------------------------------
-- Procurement cases (one case_number ties four form types together)
-- ---------------------------------------------------------------------------

create table procurement_cases (
  id uuid primary key default gen_random_uuid(),
  case_number text not null unique,
  created_by_employee_id uuid not null references employees(id),
  case_type text not null default 'standard'
    check (case_type in ('standard', 'standalone_expense')),
  created_at timestamptz not null default now()
);

create table case_number_counters (
  year_month text primary key,
  last_serial integer not null default 0
);

create table purchase_requests (
  id uuid primary key default gen_random_uuid(),
  procurement_case_id uuid not null references procurement_cases(id),
  applicant_employee_id uuid not null references employees(id),
  department_id uuid not null references departments(id),
  budget_owner_employee_id uuid not null references employees(id),
  request_date date not null default (now() at time zone 'Asia/Taipei')::date,
  needed_within_days integer,
  total_amount numeric(14, 2) not null default 0,
  status text not null default 'pending_approval'
    check (status in ('pending_approval', 'approved', 'returned', 'withdrawn')),
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
    check (status in ('pending_approval', 'approved', 'returned', 'withdrawn')),
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

create table acceptances (
  id uuid primary key default gen_random_uuid(),
  procurement_case_id uuid not null references procurement_cases(id),
  purchase_order_id uuid not null references purchase_orders(id),
  applicant_employee_id uuid not null references employees(id),
  department_id uuid not null references departments(id),
  budget_owner_employee_id uuid not null references employees(id),
  contractor_supplier_id uuid not null references suppliers(id),
  acceptance_date date not null default (now() at time zone 'Asia/Taipei')::date,
  total_amount numeric(14, 2) not null default 0,
  status text not null default 'pending_approval'
    check (status in ('pending_approval', 'approved', 'returned', 'withdrawn')),
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

create table expense_requests (
  id uuid primary key default gen_random_uuid(),
  procurement_case_id uuid not null references procurement_cases(id),
  purchase_order_id uuid references purchase_orders(id),
  budget_code_id uuid references budget_codes(id),
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
    check (status in ('pending_approval', 'approved', 'returned', 'withdrawn')),
  current_step_order integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (procurement_case_id),
  check ((payee_type = 'supplier') = (payee_supplier_id is not null)),
  constraint expense_requests_po_xor_budget_code_check
    check ((purchase_order_id is not null) or (budget_code_id is not null))
);

create index on expense_requests (applicant_employee_id);
create index on expense_requests (status);

create table expense_request_items (
  id uuid primary key default gen_random_uuid(),
  expense_request_id uuid not null references expense_requests(id) on delete cascade,
  line_no integer not null,
  purchase_order_item_id uuid references purchase_order_items(id),
  description text not null,
  amount numeric(14, 2) not null check (amount > 0),
  created_at timestamptz not null default now(),
  unique (expense_request_id, line_no)
);

-- ---------------------------------------------------------------------------
-- Approval, notifications, attachments
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- Stored procedures (case numbers + resubmit transactions)
-- ---------------------------------------------------------------------------

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

create or replace function resubmit_purchase_request(
  p_request_id uuid,
  p_budget_owner uuid,
  p_needed_days integer,
  p_total numeric,
  p_items jsonb,
  p_steps jsonb
) returns void
language plpgsql
as $$
begin
  delete from purchase_request_items where purchase_request_id = p_request_id;
  delete from approval_steps
    where form_type = 'purchase_request' and form_id = p_request_id;

  insert into purchase_request_items
    (purchase_request_id, line_no, budget_code_id, item_category, description, quantity, estimated_amount)
  select p_request_id,
         (e->>'line_no')::int,
         (e->>'budget_code_id')::uuid,
         e->>'item_category',
         e->>'description',
         (e->>'quantity')::int,
         (e->>'estimated_amount')::numeric
  from jsonb_array_elements(p_items) e;

  insert into approval_steps
    (form_type, form_id, step_order, approver_employee_id, approver_role)
  select 'purchase_request',
         p_request_id,
         (s->>'step_order')::int,
         (s->>'approver_employee_id')::uuid,
         s->>'approver_role'
  from jsonb_array_elements(p_steps) s;

  update purchase_requests
     set budget_owner_employee_id = p_budget_owner,
         needed_within_days = p_needed_days,
         total_amount = p_total,
         status = 'pending_approval',
         current_step_order = 1,
         updated_at = now()
   where id = p_request_id;
end;
$$;

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
