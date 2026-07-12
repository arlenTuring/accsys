create or replace function taipei_now() returns timestamptz
language sql stable
as $$
  select now() at time zone 'Asia/Taipei';
$$;

create or replace function next_case_number() returns text
language plpgsql
as $$
declare
  v_taipei_now timestamptz;
  v_year_month text;
  v_serial integer;
begin
  v_taipei_now := now() at time zone 'Asia/Taipei';
  v_year_month := lpad((extract(year from v_taipei_now)::int - 1911)::text, 3, '0')
                  || lpad(extract(month from v_taipei_now)::int::text, 2, '0');
  insert into case_number_counters (year_month, last_serial)
  values (v_year_month, 1)
  on conflict (year_month)
  do update set last_serial = case_number_counters.last_serial + 1
  returning last_serial into v_serial;
  return 'CP' || v_year_month || lpad(v_serial::text, 4, '0');
end;
$$;

alter table purchase_requests alter column request_date set default (now() at time zone 'Asia/Taipei')::date;
alter table acceptances alter column acceptance_date set default (now() at time zone 'Asia/Taipei')::date;
