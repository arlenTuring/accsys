create table procurement_cases (
  id uuid primary key default gen_random_uuid(),
  case_number text not null unique,
  created_by_employee_id uuid not null references employees(id),
  created_at timestamptz not null default now()
);

create table case_number_counters (
  year_month text primary key,
  last_serial integer not null default 0
);

-- ROC year-month is Gregorian year minus 1911 (3 digits) plus month (2 digits).
-- The upsert row-locks the counter, so concurrent callers get distinct serials.
create or replace function next_case_number() returns text
language plpgsql
as $$
declare
  v_year_month text;
  v_serial integer;
begin
  v_year_month := lpad((extract(year from now())::int - 1911)::text, 3, '0')
                  || lpad(extract(month from now())::int::text, 2, '0');
  insert into case_number_counters (year_month, last_serial)
  values (v_year_month, 1)
  on conflict (year_month)
  do update set last_serial = case_number_counters.last_serial + 1
  returning last_serial into v_serial;
  return 'CP' || v_year_month || lpad(v_serial::text, 4, '0');
end;
$$;
