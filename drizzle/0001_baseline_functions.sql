-- Baseline part 2: extension and stored procedures, copied verbatim from the
-- original db/schema.sql so databases created from that file match exactly.
create extension if not exists "pgcrypto";
--> statement-breakpoint
create or replace function next_case_number() returns text
language plpgsql
as $$
declare
  v_taipei_now timestamptz;
  v_year_month text;
  v_serial integer;
begin
  v_taipei_now := now() at time zone 'Asia/Taipei';
  v_year_month := lpad((extract(year from v_taipei_now)::int - 1911)::text, 3, '0')
                  || lpad(extract(month from v_taipei_now)::int::text, 2, '0');
  insert into case_number_counters (year_month, last_serial)
  values (v_year_month, 1)
  on conflict (year_month)
  do update set last_serial = case_number_counters.last_serial + 1
  returning last_serial into v_serial;
  return 'CP' || v_year_month || lpad(v_serial::text, 4, '0');
end;
$$;

--> statement-breakpoint
create or replace function resubmit_purchase_request(
  p_request_id uuid,
  p_budget_owner uuid,
  p_needed_days integer,
  p_total numeric,
  p_items jsonb,
  p_steps jsonb
) returns void
language plpgsql
as $$
begin
  delete from purchase_request_items where purchase_request_id = p_request_id;
  delete from approval_steps
    where form_type = 'purchase_request' and form_id = p_request_id;

  insert into purchase_request_items
    (purchase_request_id, line_no, budget_code_id, item_category, description, quantity, estimated_amount)
  select p_request_id,
         (e->>'line_no')::int,
         (e->>'budget_code_id')::uuid,
         e->>'item_category',
         e->>'description',
         (e->>'quantity')::int,
         (e->>'estimated_amount')::numeric
  from jsonb_array_elements(p_items) e;

  insert into approval_steps
    (form_type, form_id, step_order, approver_employee_id, approver_role)
  select 'purchase_request',
         p_request_id,
         (s->>'step_order')::int,
         (s->>'approver_employee_id')::uuid,
         s->>'approver_role'
  from jsonb_array_elements(p_steps) s;

  update purchase_requests
     set budget_owner_employee_id = p_budget_owner,
         needed_within_days = p_needed_days,
         total_amount = p_total,
         status = 'pending_approval',
         current_step_order = 1,
         updated_at = now()
   where id = p_request_id;
end;
$$;

--> statement-breakpoint
create or replace function resubmit_purchase_order(
  p_order_id uuid,
  p_supplier uuid,
  p_payment_method text,
  p_payment_terms text,
  p_expected_delivery_days integer,
  p_quote_count integer,
  p_quote_count_reason text,
  p_total numeric,
  p_items jsonb,
  p_steps jsonb
) returns void
language plpgsql
as $$
begin
  delete from purchase_order_items where purchase_order_id = p_order_id;
  delete from approval_steps
    where form_type = 'purchase_order' and form_id = p_order_id;

  insert into purchase_order_items
    (purchase_order_id, line_no, budget_code_id, item_category, description, quantity, unit_price, total_price)
  select p_order_id,
         (e->>'line_no')::int,
         (e->>'budget_code_id')::uuid,
         e->>'item_category',
         e->>'description',
         (e->>'quantity')::int,
         (e->>'unit_price')::numeric,
         (e->>'total_price')::numeric
  from jsonb_array_elements(p_items) e;

  insert into approval_steps
    (form_type, form_id, step_order, approver_employee_id, approver_role)
  select 'purchase_order',
         p_order_id,
         (s->>'step_order')::int,
         (s->>'approver_employee_id')::uuid,
         s->>'approver_role'
  from jsonb_array_elements(p_steps) s;

  update purchase_orders
     set supplier_id = p_supplier,
         payment_method = p_payment_method,
         payment_terms = p_payment_terms,
         expected_delivery_days = p_expected_delivery_days,
         quote_count = p_quote_count,
         quote_count_reason = p_quote_count_reason,
         total_amount = p_total,
         status = 'pending_approval',
         current_step_order = 1,
         updated_at = now()
   where id = p_order_id;
end;
$$;

--> statement-breakpoint
create or replace function resubmit_acceptance(
  p_acceptance_id uuid,
  p_contractor_supplier uuid,
  p_acceptance_date date,
  p_items jsonb,
  p_steps jsonb
) returns void
language plpgsql
as $$
begin
  delete from acceptance_items where acceptance_id = p_acceptance_id;
  delete from approval_steps
    where form_type = 'acceptance' and form_id = p_acceptance_id;

  insert into acceptance_items
    (acceptance_id, line_no, purchase_order_item_id, description, quantity, amount, pass_fail)
  select p_acceptance_id,
         (e->>'line_no')::int,
         (e->>'purchase_order_item_id')::uuid,
         e->>'description',
         (e->>'quantity')::int,
         (e->>'amount')::numeric,
         e->>'pass_fail'
  from jsonb_array_elements(p_items) e;

  insert into approval_steps
    (form_type, form_id, step_order, approver_employee_id, approver_role)
  select 'acceptance',
         p_acceptance_id,
         (s->>'step_order')::int,
         (s->>'approver_employee_id')::uuid,
         s->>'approver_role'
  from jsonb_array_elements(p_steps) s;

  update acceptances
     set contractor_supplier_id = p_contractor_supplier,
         acceptance_date = p_acceptance_date,
         status = 'pending_approval',
         current_step_order = 1,
         updated_at = now()
   where id = p_acceptance_id;
end;
$$;

--> statement-breakpoint
create or replace function resubmit_expense_request(
  p_expense_request_id uuid,
  p_payee_type text,
  p_payee_supplier uuid,
  p_payment_method text,
  p_bank_name text,
  p_bank_account text,
  p_account_name text,
  p_invoice_month text,
  p_expected_payment_date date,
  p_payment_batch_date date,
  p_total numeric,
  p_items jsonb,
  p_steps jsonb
) returns void
language plpgsql
as $$
begin
  delete from expense_request_items where expense_request_id = p_expense_request_id;
  delete from approval_steps
    where form_type = 'expense_request' and form_id = p_expense_request_id;

  insert into expense_request_items
    (expense_request_id, line_no, purchase_order_item_id, description, amount)
  select p_expense_request_id,
         (e->>'line_no')::int,
         (e->>'purchase_order_item_id')::uuid,
         e->>'description',
         (e->>'amount')::numeric
  from jsonb_array_elements(p_items) e;

  insert into approval_steps
    (form_type, form_id, step_order, approver_employee_id, approver_role)
  select 'expense_request',
         p_expense_request_id,
         (s->>'step_order')::int,
         (s->>'approver_employee_id')::uuid,
         s->>'approver_role'
  from jsonb_array_elements(p_steps) s;

  update expense_requests
     set payee_type = p_payee_type,
         payee_supplier_id = p_payee_supplier,
         payment_method = p_payment_method,
         bank_name = p_bank_name,
         bank_account = p_bank_account,
         account_name = p_account_name,
         invoice_month = p_invoice_month,
         expected_payment_date = p_expected_payment_date,
         payment_batch_date = p_payment_batch_date,
         total_amount = p_total,
         status = 'pending_approval',
         current_step_order = 1,
         updated_at = now()
   where id = p_expense_request_id;
end;
$$;
