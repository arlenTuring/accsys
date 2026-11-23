-- Minimal seed data for local development only (第 39 條：使用台灣智慧駕駛 Turing Drive 真實員工帳號進行各關卡測試).
-- Do NOT run in production. Use npm run seed for full employee/budget workbook import.

insert into departments (code, name, active)
values
  ('CO',  '董事長室', true),
  ('GO',  '總經理室', true),
  ('AD',  '管理部', true),
  ('ADS', '自動駕駛系統部', true),
  ('D&C', '資料與雲端平台部', true),
  ('VD',  '車輛開發部', true),
  ('PD',  '產品部', true),
  ('S&M', '營業行銷部', true)
on conflict (code) do update set name = excluded.name, active = true;

insert into employees (
  employee_code, name, department_id, title, google_email, role, is_general_manager, is_chairman, access_enabled
) values
  ('0001', '陳維隆', (select id from departments where code = 'CO' limit 1),  '董事長',             'wlc@turing-drive.com',        'staff',   false, true,  true),
  ('0002', '沈大維', (select id from departments where code = 'GO' limit 1),  '執行長',             'david_shen@turing-drive.com', 'admin',   true,  false, true),
  ('0009', '許雲茹', (select id from departments where code = 'AD' limit 1),  '行政財會',           'lucia@turing-drive.com',      'finance', false, false, true),
  ('0017', '阮振瑋', (select id from departments where code = 'ADS' limit 1), '工程經理',           'wayne@turing-drive.com',      'staff',   false, false, true),
  ('0032', '陳冠文', (select id from departments where code = 'VD' limit 1),  '副總經理',           'henry@turing-drive.com',      'staff',   false, false, true),
  ('0046', '賴昭宇', (select id from departments where code = 'VD' limit 1),  '資深車輛開發工程師', 'jeter@turing-drive.com',      'staff',   false, false, true),
  ('0053', '楊為任', (select id from departments where code = 'ADS' limit 1), '軟體研發副總',       'nickyang@turing-drive.com',   'staff',   false, false, true),
  ('0060', '張晏銘', (select id from departments where code = 'PD' limit 1),  '產品經理',           'vic.c@turing-drive.com',      'staff',   false, false, true),
  ('0065', '吳旭東', (select id from departments where code = 'AD' limit 1),  '協理',               'ivan_wu@turing-drive.com',    'admin',   false, false, true),
  ('0075', '汪怡伶', (select id from departments where code = 'AD' limit 1),  '行政總務專員',       'ellen@turing-drive.com',      'finance', false, false, true)
on conflict (employee_code) do update set
  name = excluded.name,
  department_id = excluded.department_id,
  title = excluded.title,
  google_email = coalesce(employees.google_email, excluded.google_email),
  role = excluded.role,
  is_general_manager = excluded.is_general_manager,
  is_chairman = excluded.is_chairman,
  access_enabled = true,
  disabled_at = null;

update departments set manager_employee_id = (select id from employees where employee_code = '0001' limit 1) where code in ('CO', 'S&M');
update departments set manager_employee_id = (select id from employees where employee_code = '0002' limit 1) where code in ('GO', 'PD');
update departments set manager_employee_id = (select id from employees where employee_code = '0065' limit 1) where code = 'AD';
update departments set manager_employee_id = (select id from employees where employee_code = '0053' limit 1) where code in ('ADS', 'D&C');
update departments set manager_employee_id = (select id from employees where employee_code = '0032' limit 1) where code = 'VD';
