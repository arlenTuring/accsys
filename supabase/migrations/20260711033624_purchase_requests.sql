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
