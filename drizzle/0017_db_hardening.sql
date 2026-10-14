ALTER TABLE "travel_expenses" ADD CONSTRAINT "travel_expenses_total_amount_check" CHECK (total_amount >= 0);--> statement-breakpoint
-- Serial 10000+ used to be truncated by lpad and collide with an existing case
-- number, blocking every new form for the rest of the month. Up to 9999 the
-- output is unchanged.
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
  return 'CP' || v_year_month || lpad(v_serial::text, greatest(4, length(v_serial::text)), '0');
end;
$$;--> statement-breakpoint
-- Legacy resubmit procedures (replaced by src/lib/workflow/tx.ts): they delete
-- approval steps without an audit record and were still executable by the app role.
drop function if exists resubmit_purchase_request(uuid, uuid, integer, numeric, jsonb, jsonb);--> statement-breakpoint
drop function if exists resubmit_purchase_order(uuid, uuid, text, text, integer, integer, text, numeric, jsonb, jsonb);--> statement-breakpoint
drop function if exists resubmit_acceptance(uuid, uuid, date, jsonb, jsonb);--> statement-breakpoint
drop function if exists resubmit_expense_request(uuid, text, uuid, text, text, text, text, text, date, date, numeric, jsonb, jsonb);
