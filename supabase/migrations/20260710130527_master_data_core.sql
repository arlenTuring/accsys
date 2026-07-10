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
