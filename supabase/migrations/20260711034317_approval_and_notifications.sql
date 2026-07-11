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
