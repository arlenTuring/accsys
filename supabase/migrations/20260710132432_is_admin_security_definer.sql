create or replace function is_admin() returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from employees e
    where e.google_email = auth.jwt() ->> 'email'
    and e.role = 'admin'
  );
$$;
