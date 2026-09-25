-- Fake form data for the "existing database" migration drill. Loaded after
-- base.sql into a database built from db/legacy/schema-v0.sql. Fictitious only.

insert into case_number_counters (year_month, last_serial) values ('11508', 2);

insert into procurement_cases (id, case_number, created_by_employee_id, case_type) values
  ('60000000-0000-0000-0000-000000000001', 'CP115080001', '20000000-0000-0000-0000-000000000001', 'standard'),
  ('60000000-0000-0000-0000-000000000002', 'CP115080002', '20000000-0000-0000-0000-000000000001', 'standalone_expense');

insert into purchase_requests (id, procurement_case_id, applicant_employee_id, department_id, budget_owner_employee_id,
  request_date, needed_within_days, total_amount, status) values
  ('61000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001',
   '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', '2026-08-01', 14, 30000.50, 'approved');

insert into purchase_request_items (id, purchase_request_id, line_no, budget_code_id, item_category, description, quantity, estimated_amount) values
  ('61100000-0000-0000-0000-000000000001', '61000000-0000-0000-0000-000000000001', 1, '40000000-0000-0000-0000-000000000001',
   '設備', '測試設備', 2, 15000.25);

insert into purchase_orders (id, procurement_case_id, purchase_request_id, applicant_employee_id, department_id,
  budget_owner_employee_id, supplier_id, payment_method, payment_terms, quote_count, total_amount, status) values
  ('62000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001', '61000000-0000-0000-0000-000000000001',
   '20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002',
   '50000000-0000-0000-0000-000000000001', '匯款', '貨到付款', 1, 30000.50, 'approved');

insert into purchase_order_items (id, purchase_order_id, line_no, budget_code_id, item_category, description, quantity, unit_price, total_price) values
  ('62100000-0000-0000-0000-000000000001', '62000000-0000-0000-0000-000000000001', 1, '40000000-0000-0000-0000-000000000001',
   '設備', '測試設備', 2, 15000.25, 30000.50);

insert into acceptances (id, procurement_case_id, purchase_order_id, applicant_employee_id, department_id,
  budget_owner_employee_id, contractor_supplier_id, acceptance_date, total_amount, status) values
  ('63000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001', '62000000-0000-0000-0000-000000000001',
   '20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002',
   '50000000-0000-0000-0000-000000000001', '2026-08-20', 30000.50, 'approved');

insert into acceptance_items (id, acceptance_id, line_no, purchase_order_item_id, description, quantity, amount, pass_fail, property_tag) values
  ('63100000-0000-0000-0000-000000000001', '63000000-0000-0000-0000-000000000001', 1, '62100000-0000-0000-0000-000000000001',
   '測試設備', 2, 30000.50, 'pass', 'PROP-TEST-1');

insert into expense_requests (id, procurement_case_id, purchase_order_id, budget_code_id, acceptance_id, applicant_employee_id,
  department_id, budget_owner_employee_id, payee_type, payee_supplier_id, payment_method, bank_name, bank_account, account_name,
  invoice_month, expected_payment_date, total_amount, status, current_step_order) values
  ('64000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001', '62000000-0000-0000-0000-000000000001', null,
   '63000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
   '20000000-0000-0000-0000-000000000002', 'supplier', '50000000-0000-0000-0000-000000000001', '匯款', '測試銀行', '000-TEST-0000',
   '測試供應商', '2026-08', '2026-09-10', 30000.50, 'pending_approval', 1),
  ('64000000-0000-0000-0000-000000000002', '60000000-0000-0000-0000-000000000002', null, '40000000-0000-0000-0000-000000000002',
   null, '20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002',
   'employee', null, '匯款', null, null, null, null, null, 1234.56, 'returned', null);

insert into expense_request_items (id, expense_request_id, line_no, purchase_order_item_id, description, amount) values
  ('64100000-0000-0000-0000-000000000001', '64000000-0000-0000-0000-000000000001', 1, '62100000-0000-0000-0000-000000000001', '測試設備款', 30000.50),
  ('64100000-0000-0000-0000-000000000002', '64000000-0000-0000-0000-000000000002', 1, null, '差旅費', 1234.56);

insert into approval_steps (id, form_type, form_id, step_order, approver_employee_id, approver_role, status, comment, acted_at) values
  ('65000000-0000-0000-0000-000000000001', 'purchase_request', '61000000-0000-0000-0000-000000000001', 1,
   '20000000-0000-0000-0000-000000000002', 'department_manager', 'approved', null, '2026-08-02T01:00:00Z'),
  ('65000000-0000-0000-0000-000000000002', 'expense_request', '64000000-0000-0000-0000-000000000001', 1,
   '20000000-0000-0000-0000-000000000002', 'department_manager', 'pending', null, null),
  ('65000000-0000-0000-0000-000000000003', 'expense_request', '64000000-0000-0000-0000-000000000002', 1,
   '20000000-0000-0000-0000-000000000002', 'department_manager', 'returned', '請補發票', '2026-08-05T02:00:00Z');

insert into notifications (id, recipient_employee_id, type, form_type, form_id, case_number, message, is_read) values
  ('66000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', 'approval_requested', 'expense_request',
   '64000000-0000-0000-0000-000000000001', 'CP115080001', '費用申請 CP115080001 待您簽核', false);

insert into attachments (id, form_type, form_id, uploaded_by_employee_id, storage_path, file_name, mime_type, file_size_bytes) values
  ('67000000-0000-0000-0000-000000000001', 'purchase_order', '62000000-0000-0000-0000-000000000001',
   '20000000-0000-0000-0000-000000000001', 'purchase_order/62000000-0000-0000-0000-000000000001/quote.pdf', 'quote.pdf',
   'application/pdf', 2048);
