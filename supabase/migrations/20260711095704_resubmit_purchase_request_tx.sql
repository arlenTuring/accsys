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
