-- supabase/migrations/20260719110000_standalone_expense_requests.sql

alter table expense_requests alter column purchase_order_id drop not null;
alter table expense_requests add column budget_code_id uuid references budget_codes(id);
alter table expense_requests add constraint expense_requests_po_xor_budget_code_check
  check ((purchase_order_id is not null) or (budget_code_id is not null));

alter table expense_request_items alter column purchase_order_item_id drop not null;

alter table procurement_cases add column case_type text not null default 'standard'
  check (case_type in ('standard', 'standalone_expense'));
