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
