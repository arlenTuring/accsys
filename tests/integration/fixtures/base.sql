-- Minimal fake master data for the disposable integration-test database.
-- Loaded only by docker-compose.test.yml; never apply to a real database.
-- All names, emails and bank fields are fictitious.

insert into departments (id, code, name) values
  ('10000000-0000-0000-0000-000000000001', 'T-RD', '測試研發部'),
  ('10000000-0000-0000-0000-000000000002', 'T-FIN', '測試財務部');

insert into employees (id, employee_code, name, department_id, title, google_email, role, is_general_manager, is_chairman) values
  ('20000000-0000-0000-0000-000000000001', 'T-STAFF', '測試員工', '10000000-0000-0000-0000-000000000001', '工程師', 'staff@example.test', 'staff', false, false),
  ('20000000-0000-0000-0000-000000000002', 'T-MGR', '測試主管', '10000000-0000-0000-0000-000000000001', '經理', 'manager@example.test', 'staff', false, false),
  ('20000000-0000-0000-0000-000000000003', 'T-FIN', '測試財會', '10000000-0000-0000-0000-000000000002', '財務專員', 'finance@example.test', 'finance', false, false),
  ('20000000-0000-0000-0000-000000000004', 'T-GM', '測試總經理', '10000000-0000-0000-0000-000000000002', '總經理', 'gm@example.test', 'admin', true, true);

update departments set manager_employee_id = '20000000-0000-0000-0000-000000000002'
  where id = '10000000-0000-0000-0000-000000000001';
update departments set manager_employee_id = '20000000-0000-0000-0000-000000000004'
  where id = '10000000-0000-0000-0000-000000000002';

insert into projects (id, code, name) values
  ('30000000-0000-0000-0000-000000000001', 'T-PRJ', '測試專案');

insert into budget_codes (id, code, department_id, project_id, category, owner_employee_id, fiscal_year, annual_budget_amount) values
  ('40000000-0000-0000-0000-000000000001', 'T115RD001', '10000000-0000-0000-0000-000000000001', null, '測試設備', '20000000-0000-0000-0000-000000000002', '115', 1000000),
  ('40000000-0000-0000-0000-000000000002', 'T115PRJ001', null, '30000000-0000-0000-0000-000000000001', '測試專案支出', '20000000-0000-0000-0000-000000000002', '115', 500000);

insert into suppliers (id, name, short_name, tax_id, bank_name, bank_account, account_name) values
  ('50000000-0000-0000-0000-000000000001', '測試供應商股份有限公司', '測試供應商', '00000000', '測試銀行', '000-TEST-0000', '測試供應商');
