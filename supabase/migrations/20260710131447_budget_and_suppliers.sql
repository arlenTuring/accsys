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
