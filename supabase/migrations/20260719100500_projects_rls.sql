alter table projects enable row level security;

create policy "authenticated_read_projects" on projects
  for select using (auth.role() = 'authenticated');
create policy "admin_manage_projects" on projects
  for all using (is_admin()) with check (is_admin());
