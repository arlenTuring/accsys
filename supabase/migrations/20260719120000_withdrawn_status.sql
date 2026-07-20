-- supabase/migrations/20260719120000_withdrawn_status.sql
-- Widen the status CHECK constraint on all four form tables to also allow 'withdrawn'.
-- Constraint names verified live against the linked project via
-- `supabase db query --linked` against pg_constraint before writing this migration.

alter table purchase_requests drop constraint purchase_requests_status_check;
alter table purchase_requests add constraint purchase_requests_status_check
  check (status in ('pending_approval', 'approved', 'returned', 'withdrawn'));

alter table purchase_orders drop constraint purchase_orders_status_check;
alter table purchase_orders add constraint purchase_orders_status_check
  check (status in ('pending_approval', 'approved', 'returned', 'withdrawn'));

alter table acceptances drop constraint acceptances_status_check;
alter table acceptances add constraint acceptances_status_check
  check (status in ('pending_approval', 'approved', 'returned', 'withdrawn'));

alter table expense_requests drop constraint expense_requests_status_check;
alter table expense_requests add constraint expense_requests_status_check
  check (status in ('pending_approval', 'approved', 'returned', 'withdrawn'));
