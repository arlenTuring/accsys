CREATE TABLE "approval_delegations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"delegator_employee_id" uuid NOT NULL,
	"delegate_employee_id" uuid NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"form_keys" text[],
	"reason" text,
	"created_by_employee_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "approval_delegations_not_self_check" CHECK (delegator_employee_id <> delegate_employee_id),
	CONSTRAINT "approval_delegations_period_check" CHECK (ends_on >= starts_on)
);
--> statement-breakpoint
CREATE TABLE "employee_group_members" (
	"group_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "employee_group_members_pkey" PRIMARY KEY("group_id","employee_id")
);
--> statement-breakpoint
CREATE TABLE "employee_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employee_groups_name_key" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "employee_job_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"job_role_id" uuid NOT NULL,
	"department_id" uuid,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employee_job_roles_role_department_employee_key" UNIQUE NULLS NOT DISTINCT("job_role_id","department_id","employee_id")
);
--> statement-breakpoint
CREATE TABLE "job_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_system" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_roles_code_key" UNIQUE("code"),
	CONSTRAINT "job_roles_code_check" CHECK (code ~ '^[a-z][a-z0-9_]{0,39}$')
);
--> statement-breakpoint
CREATE TABLE "org_levels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"rank" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_levels_code_key" UNIQUE("code"),
	CONSTRAINT "org_levels_rank_key" UNIQUE("rank"),
	CONSTRAINT "org_levels_code_check" CHECK (code ~ '^[a-z][a-z0-9_]{0,39}$')
);
--> statement-breakpoint
ALTER TABLE "approval_steps" DROP CONSTRAINT "approval_steps_approver_role_check";--> statement-breakpoint
ALTER TABLE "approval_steps" DROP CONSTRAINT "approval_steps_status_check";--> statement-breakpoint
ALTER TABLE "approval_steps" ALTER COLUMN "approver_employee_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "approval_steps" ADD COLUMN "step_label" text;--> statement-breakpoint
ALTER TABLE "approval_steps" ADD COLUMN "source_kind" text;--> statement-breakpoint
ALTER TABLE "approval_steps" ADD COLUMN "delegated_from_employee_id" uuid;--> statement-breakpoint
ALTER TABLE "approval_steps" ADD COLUMN "system_note" text;--> statement-breakpoint
ALTER TABLE "departments" ADD COLUMN "parent_department_id" uuid;--> statement-breakpoint
ALTER TABLE "departments" ADD COLUMN "org_level_id" uuid;--> statement-breakpoint
ALTER TABLE "departments" ADD COLUMN "sort_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "departments" ADD COLUMN "active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "extension" text;--> statement-breakpoint
ALTER TABLE "approval_delegations" ADD CONSTRAINT "approval_delegations_delegator_fkey" FOREIGN KEY ("delegator_employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_delegations" ADD CONSTRAINT "approval_delegations_delegate_fkey" FOREIGN KEY ("delegate_employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_delegations" ADD CONSTRAINT "approval_delegations_created_by_fkey" FOREIGN KEY ("created_by_employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_group_members" ADD CONSTRAINT "employee_group_members_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "public"."employee_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_group_members" ADD CONSTRAINT "employee_group_members_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_job_roles" ADD CONSTRAINT "employee_job_roles_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_job_roles" ADD CONSTRAINT "employee_job_roles_job_role_id_fkey" FOREIGN KEY ("job_role_id") REFERENCES "public"."job_roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_job_roles" ADD CONSTRAINT "employee_job_roles_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approval_delegations_delegator_idx" ON "approval_delegations" USING btree ("delegator_employee_id","starts_on","ends_on");--> statement-breakpoint
CREATE UNIQUE INDEX "employee_job_roles_one_primary_idx" ON "employee_job_roles" USING btree ("job_role_id",coalesce(department_id, '00000000-0000-0000-0000-000000000000'::uuid)) WHERE is_primary;--> statement-breakpoint
CREATE INDEX "employee_job_roles_employee_id_idx" ON "employee_job_roles" USING btree ("employee_id");--> statement-breakpoint
ALTER TABLE "approval_steps" ADD CONSTRAINT "approval_steps_delegated_from_employee_id_fkey" FOREIGN KEY ("delegated_from_employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_parent_department_id_fkey" FOREIGN KEY ("parent_department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_org_level_id_fkey" FOREIGN KEY ("org_level_id") REFERENCES "public"."org_levels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "departments_parent_department_id_idx" ON "departments" USING btree ("parent_department_id");--> statement-breakpoint
ALTER TABLE "approval_steps" ADD CONSTRAINT "approval_steps_approver_check" CHECK (approver_employee_id is not null or status = 'skipped');--> statement-breakpoint
ALTER TABLE "approval_steps" ADD CONSTRAINT "approval_steps_source_kind_check" CHECK (source_kind is null or source_kind in ('employee', 'department_manager', 'department_members', 'org_chain', 'form_party', 'employee_group', 'job_role'));--> statement-breakpoint
ALTER TABLE "approval_steps" ADD CONSTRAINT "approval_steps_approver_role_check" CHECK (approver_role in ('department_manager', 'budget_owner', 'general_manager', 'chairman', 'original_custodian', 'new_custodian', 'other_custodian', 'original_custodian_manager', 'new_custodian_manager', 'other_custodian_manager', 'applicant_confirmation') or approver_role ~ '^step:[A-Za-z0-9_-]{1,64}$');--> statement-breakpoint
ALTER TABLE "approval_steps" ADD CONSTRAINT "approval_steps_status_check" CHECK (status in ('pending', 'approved', 'returned', 'auto_approved', 'skipped'));--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_parent_not_self_check" CHECK (parent_department_id is null or parent_department_id <> id);--> statement-breakpoint
-- A department may not become its own ancestor. The advisory lock serialises
-- hierarchy changes so two concurrent moves cannot close a loop together.
create or replace function departments_prevent_cycle() returns trigger
language plpgsql
as $$
begin
  if new.parent_department_id is null then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtext('accsys.departments.hierarchy'));
  if exists (
    with recursive up(id) as (
      select d.parent_department_id from departments d where d.id = new.parent_department_id
      union
      select d.parent_department_id from departments d join up on d.id = up.id where d.parent_department_id is not null
    )
    select 1 from up where up.id = new.id
  ) or new.parent_department_id = new.id then
    raise exception 'department hierarchy cycle' using errcode = '23514', constraint = 'departments_hierarchy_cycle';
  end if;
  return new;
end;
$$;--> statement-breakpoint
create trigger departments_prevent_cycle
  before insert or update of parent_department_id on departments
  for each row execute function departments_prevent_cycle();--> statement-breakpoint
insert into job_roles (code, name, description, is_system) values
  ('general_manager', '總經理', '系統內建，與員工資料的「總經理」旗標同步', true),
  ('chairman', '董事長', '系統內建，與員工資料的「董事長」旗標同步', true)
on conflict (code) do nothing;--> statement-breakpoint
-- Transition period: forms not yet on configurable flows still read the
-- employees flags, so the flags stay authoritative and the company-wide system
-- role bindings follow them. The oldest holder is primary, matching the legacy
-- lookup order (created_at, id).
create or replace function sync_system_job_role(p_code text) returns void
language plpgsql
as $$
declare
  v_role uuid;
begin
  select id into v_role from job_roles where code = p_code;
  if v_role is null then
    return;
  end if;
  perform pg_advisory_xact_lock(hashtext('accsys.system_job_role.' || p_code));
  delete from employee_job_roles r
   where r.job_role_id = v_role and r.department_id is null
     and not exists (
       select 1 from employees e
        where e.id = r.employee_id
          and case p_code when 'general_manager' then e.is_general_manager when 'chairman' then e.is_chairman else false end
     );
  insert into employee_job_roles (employee_id, job_role_id, department_id, is_primary)
  select e.id, v_role, null, false
    from employees e
   where case p_code when 'general_manager' then e.is_general_manager when 'chairman' then e.is_chairman else false end
  on conflict on constraint employee_job_roles_role_department_employee_key do nothing;
  update employee_job_roles r set is_primary = false
   where r.job_role_id = v_role and r.department_id is null and r.is_primary;
  update employee_job_roles r set is_primary = true
   where r.id = (
     select r2.id from employee_job_roles r2 join employees e on e.id = r2.employee_id
      where r2.job_role_id = v_role and r2.department_id is null
      order by e.created_at, e.id
      limit 1
   );
end;
$$;--> statement-breakpoint
create or replace function employees_sync_system_job_roles() returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if new.is_general_manager then perform sync_system_job_role('general_manager'); end if;
    if new.is_chairman then perform sync_system_job_role('chairman'); end if;
  else
    if new.is_general_manager is distinct from old.is_general_manager then perform sync_system_job_role('general_manager'); end if;
    if new.is_chairman is distinct from old.is_chairman then perform sync_system_job_role('chairman'); end if;
  end if;
  return null;
end;
$$;--> statement-breakpoint
create trigger employees_sync_system_job_roles
  after insert or update of is_general_manager, is_chairman on employees
  for each row execute function employees_sync_system_job_roles();--> statement-breakpoint
select sync_system_job_role('general_manager');--> statement-breakpoint
select sync_system_job_role('chairman');