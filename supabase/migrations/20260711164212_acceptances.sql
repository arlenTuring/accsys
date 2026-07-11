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
