-- Asset register extensibility: configurable fields, inventory batches,
-- custody department independent of custodian's current job department,
-- and permissions for field admin / purge / announcements / surveys.

ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "custody_department_id" uuid;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "item_kind" text;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "description" text;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "unit" text;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "extra_values" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "field_schema_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "assets" ADD CONSTRAINT "assets_custody_department_id_fkey"
    FOREIGN KEY ("custody_department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assets_custody_department_id_idx" ON "assets" ("custody_department_id");--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_field_schema_version_check" CHECK ("field_schema_version" > 0);--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_extra_values_object_check" CHECK (jsonb_typeof("extra_values") = 'object');--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "asset_field_definitions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "stable_key" text NOT NULL,
  "label" text NOT NULL,
  "help" text DEFAULT '' NOT NULL,
  "field_type" text NOT NULL,
  "section" text NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "required" boolean DEFAULT false NOT NULL,
  "show_in_list" boolean DEFAULT false NOT NULL,
  "searchable" boolean DEFAULT false NOT NULL,
  "filterable" boolean DEFAULT false NOT NULL,
  "exportable" boolean DEFAULT true NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "options" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "view_permission" text,
  "edit_permission" text,
  "system_binding" text,
  "storage_scope" text DEFAULT 'asset' NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "hidden_at" timestamp with time zone,
  "hidden_by_employee_id" uuid,
  "deleted_at" timestamp with time zone,
  "deleted_by_employee_id" uuid,
  "delete_job_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "asset_field_definitions_stable_key_key" UNIQUE("stable_key"),
  CONSTRAINT "asset_field_definitions_stable_key_check" CHECK (stable_key ~ '^[a-z][a-z0-9_]{0,63}$'),
  CONSTRAINT "asset_field_definitions_label_check" CHECK (char_length(btrim(label)) between 1 and 80),
  CONSTRAINT "asset_field_definitions_type_check" CHECK (field_type in (
    'text','textarea','integer','decimal','date','select','multiselect','tristate','employee','department','project'
  )),
  CONSTRAINT "asset_field_definitions_section_check" CHECK (section in (
    'basic','accounting','custody','status_qty','notes','inventory','custom'
  )),
  CONSTRAINT "asset_field_definitions_status_check" CHECK (status in ('active','hidden','deleted')),
  CONSTRAINT "asset_field_definitions_scope_check" CHECK (storage_scope in ('asset','inventory')),
  CONSTRAINT "asset_field_definitions_version_check" CHECK (version > 0),
  CONSTRAINT "asset_field_definitions_options_array_check" CHECK (jsonb_typeof(options) = 'array')
);--> statement-breakpoint
ALTER TABLE "asset_field_definitions" ADD CONSTRAINT "asset_field_definitions_hidden_by_fkey"
  FOREIGN KEY ("hidden_by_employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_field_definitions" ADD CONSTRAINT "asset_field_definitions_deleted_by_fkey"
  FOREIGN KEY ("deleted_by_employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "asset_field_definitions_status_idx" ON "asset_field_definitions" ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "asset_field_definitions_section_sort_idx" ON "asset_field_definitions" ("section","sort_order");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "asset_inventory_batches" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "label" text NOT NULL,
  "source_workbook" text,
  "source_sheet" text,
  "as_of_date" date,
  "status" text DEFAULT 'open' NOT NULL,
  "row_count" integer DEFAULT 0 NOT NULL,
  "created_by_employee_id" uuid NOT NULL,
  "locked_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "asset_inventory_batches_status_check" CHECK (status in ('open','locked')),
  CONSTRAINT "asset_inventory_batches_label_check" CHECK (char_length(btrim(label)) between 1 and 160)
);--> statement-breakpoint
ALTER TABLE "asset_inventory_batches" ADD CONSTRAINT "asset_inventory_batches_created_by_fkey"
  FOREIGN KEY ("created_by_employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "asset_inventory_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "batch_id" uuid NOT NULL,
  "asset_id" uuid,
  "asset_tag" text NOT NULL,
  "physical_quantity" integer,
  "answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "source_row" integer,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "asset_inventory_lines_batch_tag_key" UNIQUE("batch_id","asset_tag"),
  CONSTRAINT "asset_inventory_lines_answers_object_check" CHECK (jsonb_typeof(answers) = 'object')
);--> statement-breakpoint
ALTER TABLE "asset_inventory_lines" ADD CONSTRAINT "asset_inventory_lines_batch_fkey"
  FOREIGN KEY ("batch_id") REFERENCES "public"."asset_inventory_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_inventory_lines" ADD CONSTRAINT "asset_inventory_lines_asset_fkey"
  FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "asset_inventory_lines_asset_id_idx" ON "asset_inventory_lines" ("asset_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "asset_import_batches" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "idempotency_key" text NOT NULL,
  "source_workbook" text NOT NULL,
  "source_sheet" text NOT NULL,
  "mapping" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "status" text DEFAULT 'draft' NOT NULL,
  "counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "inventory_batch_id" uuid,
  "created_by_employee_id" uuid NOT NULL,
  "confirmed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "asset_import_batches_idempotency_key" UNIQUE("idempotency_key"),
  CONSTRAINT "asset_import_batches_status_check" CHECK (status in ('draft','validated','confirmed','failed'))
);--> statement-breakpoint
ALTER TABLE "asset_import_batches" ADD CONSTRAINT "asset_import_batches_created_by_fkey"
  FOREIGN KEY ("created_by_employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_import_batches" ADD CONSTRAINT "asset_import_batches_inventory_fkey"
  FOREIGN KEY ("inventory_batch_id") REFERENCES "public"."asset_inventory_batches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "asset_field_purge_jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "field_definition_id" uuid NOT NULL,
  "status" text DEFAULT 'queued' NOT NULL,
  "requested_by_employee_id" uuid NOT NULL,
  "expected_version" integer NOT NULL,
  "progress" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "backup_path" text,
  "error" text,
  "idempotency_key" text NOT NULL,
  "started_at" timestamp with time zone,
  "finished_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "asset_field_purge_jobs_idempotency_key" UNIQUE("idempotency_key"),
  CONSTRAINT "asset_field_purge_jobs_status_check" CHECK (status in ('queued','running','completed','failed','cancelled'))
);--> statement-breakpoint
ALTER TABLE "asset_field_purge_jobs" ADD CONSTRAINT "asset_field_purge_jobs_field_fkey"
  FOREIGN KEY ("field_definition_id") REFERENCES "public"."asset_field_definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_field_purge_jobs" ADD CONSTRAINT "asset_field_purge_jobs_requested_by_fkey"
  FOREIGN KEY ("requested_by_employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- New permissions for finance/admin presets (idempotent).
INSERT INTO "access_role_permissions" ("role_id", "permission")
SELECT r.id, p.permission
FROM "access_roles" r
CROSS JOIN (VALUES
  ('finance.assets_fields'),
  ('finance.assets_fields_purge'),
  ('company.announcements'),
  ('company.surveys'),
  ('company.surveys_results')
) AS p(permission)
WHERE r.code IN ('finance', 'admin')
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "access_role_permissions" ("role_id", "permission")
SELECT r.id, p.permission
FROM "access_roles" r
CROSS JOIN (VALUES
  ('finance.assets_fields'),
  ('finance.assets_fields_purge'),
  ('company.announcements'),
  ('company.surveys'),
  ('company.surveys_results'),
  ('assets.company_view')
) AS p(permission)
WHERE r.code = 'admin'
ON CONFLICT DO NOTHING;
