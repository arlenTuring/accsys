-- SECURITY DEFINER + pinned search_path so this bypasses approval_steps' own
-- RLS when called from the form/item/attachment policies below, avoiding the
-- 42P17 recursion that would occur if a policy subquerying approval_steps
-- re-triggered approval_steps' own policy (which subqueries the form tables).
-- It deliberately does NOT reuse is_approver_of_request() (purchase-request
-- specific): the approval_steps existence check is duplicated inline so all
-- four form_type branches stay symmetric.
create or replace function is_participant_of_form(p_form_type text, p_form_id uuid) returns boolean
language plpgsql stable security definer set search_path = public
as $$
begin
  if exists (
    select 1 from approval_steps
    where form_type = p_form_type
      and form_id = p_form_id
      and approver_employee_id = current_employee_id()
  ) then
    return true;
  end if;

  case p_form_type
    when 'purchase_request' then
      return exists (
        select 1 from purchase_requests
        where id = p_form_id and applicant_employee_id = current_employee_id()
      );
    when 'purchase_order' then
      return exists (
        select 1 from purchase_orders
        where id = p_form_id and applicant_employee_id = current_employee_id()
      );
    when 'acceptance' then
      return exists (
        select 1 from acceptances
        where id = p_form_id and applicant_employee_id = current_employee_id()
      );
    when 'expense_request' then
      return exists (
        select 1 from expense_requests
        where id = p_form_id and applicant_employee_id = current_employee_id()
      );
    else
      return false;
  end case;
end;
$$;

alter table purchase_orders enable row level security;
alter table purchase_order_items enable row level security;
alter table acceptances enable row level security;
alter table acceptance_items enable row level security;
alter table expense_requests enable row level security;
alter table expense_request_items enable row level security;
alter table attachments enable row level security;

create policy "participant_read_purchase_orders" on purchase_orders
  for select using (
    is_finance() or is_admin() or is_participant_of_form('purchase_order', id)
  );

create policy "participant_read_purchase_order_items" on purchase_order_items
  for select using (
    is_finance() or is_admin()
    or exists (
      select 1 from purchase_orders po
      where po.id = purchase_order_items.purchase_order_id
        and is_participant_of_form('purchase_order', po.id)
    )
  );

create policy "participant_read_acceptances" on acceptances
  for select using (
    is_finance() or is_admin() or is_participant_of_form('acceptance', id)
  );

create policy "participant_read_acceptance_items" on acceptance_items
  for select using (
    is_finance() or is_admin()
    or exists (
      select 1 from acceptances a
      where a.id = acceptance_items.acceptance_id
        and is_participant_of_form('acceptance', a.id)
    )
  );

create policy "participant_read_expense_requests" on expense_requests
  for select using (
    is_finance() or is_admin() or is_participant_of_form('expense_request', id)
  );

create policy "participant_read_expense_request_items" on expense_request_items
  for select using (
    is_finance() or is_admin()
    or exists (
      select 1 from expense_requests er
      where er.id = expense_request_items.expense_request_id
        and is_participant_of_form('expense_request', er.id)
    )
  );

create policy "participant_read_attachments" on attachments
  for select using (
    is_finance() or is_admin() or is_participant_of_form(form_type, form_id)
  );

-- storage.objects: zero policies on the 'attachments' bucket → only the
-- service-role key (used inside vetted server actions) can read/write bytes.
