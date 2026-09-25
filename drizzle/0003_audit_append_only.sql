-- audit_events is append-only for every role, including the table owner:
-- UPDATE, DELETE and TRUNCATE raise. Removing this protection requires a
-- reviewed migration (or a superuser disabling the triggers), which leaves its
-- own trace. Privileges for the runtime role are also restricted in
-- db/roles.sql; this trigger is the backstop if grants drift.
create function audit_events_append_only() returns trigger
language plpgsql
as $$
begin
  raise exception 'audit_events is append-only (% blocked)', tg_op
    using errcode = 'insufficient_privilege';
end;
$$;
--> statement-breakpoint
create trigger audit_events_no_update_delete
  before update or delete on audit_events
  for each row execute function audit_events_append_only();
--> statement-breakpoint
create trigger audit_events_no_truncate
  before truncate on audit_events
  for each statement execute function audit_events_append_only();
--> statement-breakpoint
revoke update, delete, truncate on audit_events from public;
--> statement-breakpoint
-- Default privileges from db/roles.sql grant DML on new tables to the runtime
-- role; take UPDATE/DELETE back for the audit trail.
do $$
begin
  if exists (select from pg_roles where rolname = 'accsys_app') then
    revoke update, delete, truncate on audit_events from accsys_app;
  end if;
end
$$;
