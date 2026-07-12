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
