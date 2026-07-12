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
