-- ACCSYS database roles and privileges. Idempotent; safe to re-run.
--
-- Run as a PostgreSQL superuser (or the DBA account) while connected to the
-- ACCSYS database, BEFORE `npm run db:migrate` / `npm run db:baseline`:
--
--   psql "postgres://ADMIN@HOST:5432/accsys" -v ON_ERROR_STOP=1 -f db/roles.sql
--
-- Passwords are never set here. Set them afterwards, interactively:
--   \password accsys_migrator
--   \password accsys_app
--   \password accsys_backup
--
-- Role model
--   accsys_owner     NOLOGIN. Owns every schema object. Only reachable via SET ROLE.
--   accsys_migrator  LOGIN. Member of accsys_owner; used only by the migration job.
--   accsys_app       LOGIN. Runtime web app: SELECT/INSERT/UPDATE/DELETE only,
--                    no DDL, no TRUNCATE, no access to the migrations schema,
--                    and no UPDATE/DELETE on audit_events.
--   accsys_backup    LOGIN. Read-only (pg_read_all_data) for pg_dump.

-- ---------------------------------------------------------------------------
-- Cluster-level roles
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select from pg_roles where rolname = 'accsys_owner') then
    create role accsys_owner nologin;
  end if;
  if not exists (select from pg_roles where rolname = 'accsys_migrator') then
    create role accsys_migrator login;
  end if;
  if not exists (select from pg_roles where rolname = 'accsys_app') then
    create role accsys_app login;
  end if;
  if not exists (select from pg_roles where rolname = 'accsys_backup') then
    create role accsys_backup login;
  end if;
end
$$;

alter role accsys_owner nologin nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
alter role accsys_migrator login nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
alter role accsys_app login nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
alter role accsys_backup login nosuperuser nocreatedb nocreaterole noreplication nobypassrls;

grant accsys_owner to accsys_migrator;
grant pg_read_all_data to accsys_backup;

-- Runtime guard rails, enforced by the server regardless of app configuration.
alter role accsys_app set statement_timeout = '30s';
alter role accsys_app set lock_timeout = '10s';
alter role accsys_app set idle_in_transaction_session_timeout = '60s';
alter role accsys_migrator set lock_timeout = '10s';
alter role accsys_backup set default_transaction_read_only = on;

-- ---------------------------------------------------------------------------
-- Database-level privileges (current database)
-- ---------------------------------------------------------------------------
do $$
declare
  db text := current_database();
begin
  execute format('revoke all on database %I from public', db);
  execute format('grant connect on database %I to accsys_app, accsys_migrator, accsys_backup', db);
  -- CREATE lets the owner create the migrations schema and trusted extensions (pgcrypto).
  execute format('grant create, temporary on database %I to accsys_owner', db);
end
$$;

alter schema public owner to accsys_owner;
revoke create on schema public from public;
grant usage on schema public to accsys_app, accsys_backup;

create schema if not exists drizzle authorization accsys_owner;
alter schema drizzle owner to accsys_owner;
revoke all on schema drizzle from public;

-- ---------------------------------------------------------------------------
-- Adopt objects created before this role model (e.g. by db/legacy/schema-v0.sql
-- as the bootstrap superuser). Extension-owned objects are left alone.
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select c.oid::regclass as obj, c.relkind
      from pg_class c
     where c.relnamespace in ('public'::regnamespace, 'drizzle'::regnamespace)
       and c.relkind in ('r', 'p', 'v', 'm', 'S')
       and c.relowner <> 'accsys_owner'::regrole
       and not exists (select from pg_depend d
                        where d.classid = 'pg_class'::regclass and d.objid = c.oid
                          and d.deptype in ('e', 'a', 'i'))
  loop
    if r.relkind = 'S' then
      execute format('alter sequence %s owner to accsys_owner', r.obj);
    elsif r.relkind in ('v', 'm') then
      execute format('alter %s %s owner to accsys_owner',
                     case r.relkind when 'v' then 'view' else 'materialized view' end, r.obj);
    else
      execute format('alter table %s owner to accsys_owner', r.obj);
    end if;
  end loop;

  for r in
    select p.oid::regprocedure as fn
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proowner <> 'accsys_owner'::regrole
       and not exists (select from pg_depend d
                        where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('alter function %s owner to accsys_owner', r.fn);
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- Runtime (accsys_app) privileges: existing objects + everything the owner
-- creates later through migrations.
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on all tables in schema public to accsys_app;
grant usage, select on all sequences in schema public to accsys_app;
grant execute on all functions in schema public to accsys_app;

alter default privileges for role accsys_owner in schema public
  grant select, insert, update, delete on tables to accsys_app;
alter default privileges for role accsys_owner in schema public
  grant usage, select on sequences to accsys_app;
alter default privileges for role accsys_owner in schema public
  grant execute on functions to accsys_app;

-- Append-only audit trail (also enforced by triggers from migration 0003).
do $$
begin
  if to_regclass('public.audit_events') is not null then
    revoke update, delete, truncate on public.audit_events from accsys_app;
  end if;
end
$$;
