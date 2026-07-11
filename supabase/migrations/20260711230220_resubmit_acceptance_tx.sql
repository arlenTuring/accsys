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
