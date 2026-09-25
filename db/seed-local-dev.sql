-- Minimal seed data for local development only.
-- Do NOT run in production. Use npm run seed for real employee/budget data.

insert into departments (id, code, name)
values ('00000000-0000-0000-0000-000000000001', 'DEV', '本機開發')
on conflict (id) do nothing;

insert into employees (
  id, employee_code, name, department_id, title, google_email, role, is_general_manager, is_chairman
) values (
  '00000000-0000-0000-0000-000000000002',
  'DEV001',
  '本機開發者',
  '00000000-0000-0000-0000-000000000001',
  '資訊管理',
  'dev@turing-drive.com',
  'admin',
  true,
  true
)
on conflict (id) do update set
  name = excluded.name,
  title = excluded.title,
  google_email = excluded.google_email,
  role = excluded.role,
  is_general_manager = excluded.is_general_manager,
  is_chairman = excluded.is_chairman;

update departments
  set manager_employee_id = '00000000-0000-0000-0000-000000000002'
  where id = '00000000-0000-0000-0000-000000000001';

insert into budget_codes (
  id, code, department_id, category, owner_employee_id, fiscal_year, annual_budget_amount
) values (
  '00000000-0000-0000-0000-000000000003',
  '115DEV001',
  '00000000-0000-0000-0000-000000000001',
  '本機測試',
  '00000000-0000-0000-0000-000000000002',
  '115',
  1000000
)
on conflict (id) do nothing;
