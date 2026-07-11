create or replace function current_employee_id() returns uuid
language sql stable security definer set search_path = public
as $$
  select id from employees where google_email = auth.jwt() ->> 'email';
$$;

create or replace function is_finance() returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from employees
    where google_email = auth.jwt() ->> 'email' and role in ('finance', 'admin')
  );
$$;

-- SECURITY DEFINER so this bypasses approval_steps' own RLS when called from
-- purchase_requests'/purchase_request_items' policies below. Without this, a
-- policy on purchase_requests that subqueries approval_steps (RLS-enabled)
-- would trigger approval_steps' policy, which itself subqueries
-- purchase_requests — infinite recursion (Postgres error 42P17).
create or replace function is_approver_of_request(p_request_id uuid) returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from approval_steps
    where form_type = 'purchase_request'
      and form_id = p_request_id
      and approver_employee_id = current_employee_id()
  );
$$;

alter table procurement_cases enable row level security;
alter table case_number_counters enable row level security;
alter table purchase_requests enable row level security;
alter table purchase_request_items enable row level security;
alter table approval_steps enable row level security;
alter table notifications enable row level security;

-- case_number_counters: no policies at all → only service role can touch it.

-- procurement_cases carry only a number + creator; any authenticated user may read.
create policy "auth_read_cases" on procurement_cases
  for select using (auth.role() = 'authenticated');

-- A purchase request is visible to its applicant, any of its approvers, and finance/admin.
create policy "participant_read_requests" on purchase_requests
  for select using (
    applicant_employee_id = current_employee_id()
    or is_finance()
    or is_admin()
    or is_approver_of_request(purchase_requests.id)
  );

create policy "participant_read_request_items" on purchase_request_items
  for select using (
    exists (
      select 1 from purchase_requests pr
      where pr.id = purchase_request_items.purchase_request_id
        and (
          pr.applicant_employee_id = current_employee_id()
          or is_finance()
          or is_admin()
          or is_approver_of_request(pr.id)
        )
    )
  );

create policy "participant_read_approval_steps" on approval_steps
  for select using (
    approver_employee_id = current_employee_id()
    or is_finance()
    or is_admin()
    or exists (
      select 1 from purchase_requests pr
      where pr.id = approval_steps.form_id
        and approval_steps.form_type = 'purchase_request'
        and pr.applicant_employee_id = current_employee_id()
    )
  );

create policy "recipient_read_notifications" on notifications
  for select using (recipient_employee_id = current_employee_id() or is_admin());

create policy "recipient_update_notifications" on notifications
  for update using (recipient_employee_id = current_employee_id())
  with check (recipient_employee_id = current_employee_id());
