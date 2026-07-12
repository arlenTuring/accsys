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
