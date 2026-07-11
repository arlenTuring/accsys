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
