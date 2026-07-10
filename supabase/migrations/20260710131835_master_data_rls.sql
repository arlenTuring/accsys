create or replace function is_admin() returns boolean
language sql stable
as $$
  select exists (
    select 1 from employees e
    where e.google_email = auth.jwt() ->> 'email'
    and e.role = 'admin'
  );
$$;

alter table departments enable row level security;
alter table employees enable row level security;
alter table budget_codes enable row level security;
alter table suppliers enable row level security;

create policy "authenticated_read_departments" on departments
  for select using (auth.role() = 'authenticated');
create policy "admin_manage_departments" on departments
  for all using (is_admin()) with check (is_admin());

create policy "authenticated_read_employees" on employees
  for select using (auth.role() = 'authenticated');
create policy "admin_manage_employees" on employees
  for all using (is_admin()) with check (is_admin());

create policy "authenticated_read_budget_codes" on budget_codes
  for select using (auth.role() = 'authenticated');
create policy "admin_manage_budget_codes" on budget_codes
  for all using (is_admin()) with check (is_admin());

create policy "authenticated_read_suppliers" on suppliers
  for select using (auth.role() = 'authenticated');
create policy "admin_manage_suppliers" on suppliers
  for all using (is_admin()) with check (is_admin());
