CREATE TABLE "form_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "form_categories_key_key" UNIQUE("key"),
	CONSTRAINT "form_categories_key_check" CHECK (key ~ '^[a-z][a-z0-9_]{0,39}$')
);
--> statement-breakpoint
CREATE TABLE "form_definition_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"definition_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"schema" jsonb NOT NULL,
	"flow" jsonb NOT NULL,
	"actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_by_employee_id" uuid NOT NULL,
	CONSTRAINT "form_definition_versions_definition_id_version_key" UNIQUE("definition_id","version"),
	CONSTRAINT "form_definition_versions_id_definition_id_key" UNIQUE("id","definition_id"),
	CONSTRAINT "form_definition_versions_version_check" CHECK (version > 0)
);
--> statement-breakpoint
CREATE TABLE "form_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"category_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"published_version_id" uuid,
	"draft_schema" jsonb,
	"draft_flow" jsonb,
	"number_prefix" text NOT NULL,
	"visibility" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"legacy_form_type" text,
	"created_by_employee_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "form_definitions_key_key" UNIQUE("key"),
	CONSTRAINT "form_definitions_key_check" CHECK (key ~ '^[a-z][a-z0-9-]{1,39}$'),
	CONSTRAINT "form_definitions_status_check" CHECK (status in ('draft', 'published', 'archived')),
	CONSTRAINT "form_definitions_published_check" CHECK (status <> 'published' or published_version_id is not null),
	CONSTRAINT "form_definitions_number_prefix_check" CHECK (number_prefix ~ '^[A-Z][A-Z0-9]{0,5}$'),
	CONSTRAINT "form_definitions_visibility_check" CHECK (jsonb_typeof(visibility) = 'object'),
	CONSTRAINT "form_definitions_version_check" CHECK (version > 0)
);
--> statement-breakpoint
CREATE TABLE "form_number_counters" (
	"definition_id" uuid NOT NULL,
	"period" text NOT NULL,
	"last_serial" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "form_number_counters_pkey" PRIMARY KEY("definition_id","period"),
	CONSTRAINT "form_number_counters_period_check" CHECK (period ~ '^[0-9]{8}$')
);
--> statement-breakpoint
CREATE TABLE "form_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"procurement_case_id" uuid NOT NULL,
	"definition_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"form_number" text NOT NULL,
	"applicant_employee_id" uuid NOT NULL,
	"department_id" uuid NOT NULL,
	"status" text DEFAULT 'pending_approval' NOT NULL,
	"data" jsonb NOT NULL,
	"total_amount" numeric(14, 2),
	"budget_code_id" uuid,
	"project_id" uuid,
	"current_step_order" integer,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "form_submissions_form_number_key" UNIQUE("form_number"),
	CONSTRAINT "form_submissions_procurement_case_id_key" UNIQUE("procurement_case_id"),
	CONSTRAINT "form_submissions_status_check" CHECK (status in ('pending_approval', 'approved', 'returned', 'withdrawn')),
	CONSTRAINT "form_submissions_data_check" CHECK (jsonb_typeof(data) = 'object'),
	CONSTRAINT "form_submissions_version_check" CHECK (version > 0)
);
--> statement-breakpoint
ALTER TABLE "approval_steps" DROP CONSTRAINT "approval_steps_form_type_check";--> statement-breakpoint
ALTER TABLE "attachments" DROP CONSTRAINT "attachments_form_type_check";--> statement-breakpoint
ALTER TABLE "procurement_cases" DROP CONSTRAINT "procurement_cases_case_type_check";--> statement-breakpoint
ALTER TABLE "form_definition_versions" ADD CONSTRAINT "form_definition_versions_definition_id_fkey" FOREIGN KEY ("definition_id") REFERENCES "public"."form_definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_definition_versions" ADD CONSTRAINT "form_definition_versions_published_by_fkey" FOREIGN KEY ("published_by_employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_definitions" ADD CONSTRAINT "form_definitions_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."form_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_definitions" ADD CONSTRAINT "form_definitions_created_by_fkey" FOREIGN KEY ("created_by_employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_definitions" ADD CONSTRAINT "form_definitions_published_version_fkey" FOREIGN KEY ("published_version_id","id") REFERENCES "public"."form_definition_versions"("id","definition_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_number_counters" ADD CONSTRAINT "form_number_counters_definition_id_fkey" FOREIGN KEY ("definition_id") REFERENCES "public"."form_definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_procurement_case_id_fkey" FOREIGN KEY ("procurement_case_id") REFERENCES "public"."procurement_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_version_fkey" FOREIGN KEY ("version_id","definition_id") REFERENCES "public"."form_definition_versions"("id","definition_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_applicant_employee_id_fkey" FOREIGN KEY ("applicant_employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_budget_code_id_fkey" FOREIGN KEY ("budget_code_id") REFERENCES "public"."budget_codes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "form_submissions_definition_applicant_idx" ON "form_submissions" USING btree ("definition_id","applicant_employee_id");--> statement-breakpoint
CREATE INDEX "form_submissions_applicant_employee_id_idx" ON "form_submissions" USING btree ("applicant_employee_id");--> statement-breakpoint
CREATE INDEX "form_submissions_status_idx" ON "form_submissions" USING btree ("status");--> statement-breakpoint
ALTER TABLE "approval_steps" ADD CONSTRAINT "approval_steps_form_type_check" CHECK (form_type in ('purchase_request', 'purchase_order', 'acceptance', 'expense_request', 'travel_expense', 'contract_seal_request', 'general_seal_request', 'invoice_seal_request', 'department_expense', 'project_expense', 'revenue_expense', 'minor_expense', 'asset_transfer', 'custom'));--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_form_type_check" CHECK (form_type in ('purchase_request', 'purchase_order', 'acceptance', 'expense_request', 'travel_expense', 'contract_seal_request', 'general_seal_request', 'invoice_seal_request', 'department_expense', 'project_expense', 'revenue_expense', 'minor_expense', 'asset_transfer', 'custom'));--> statement-breakpoint
ALTER TABLE "procurement_cases" ADD CONSTRAINT "procurement_cases_case_type_check" CHECK (case_type in ('standard', 'standalone_expense', 'travel_expense', 'contract_seal', 'general_seal', 'invoice_seal', 'department_expense', 'project_expense', 'revenue_expense', 'minor_expense', 'asset_transfer', 'custom'));--> statement-breakpoint
-- Submitted forms are displayed and validated against the version they were
-- filled in, so a published version can never change or disappear.
CREATE FUNCTION form_definition_versions_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'published form definition versions cannot be modified'
    USING ERRCODE = '23514', CONSTRAINT = 'form_definition_versions_immutable';
END;
$$;--> statement-breakpoint
CREATE TRIGGER form_definition_versions_immutable
  BEFORE UPDATE OR DELETE ON form_definition_versions
  FOR EACH ROW EXECUTE FUNCTION form_definition_versions_immutable();--> statement-breakpoint
-- Links (/f/<key>/...) and notifications use the key; it is fixed after the first publish.
CREATE FUNCTION form_definitions_key_fixed() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.published_version_id IS NOT NULL AND NEW.key IS DISTINCT FROM OLD.key THEN
    RAISE EXCEPTION 'the key of a published form definition cannot change'
      USING ERRCODE = '23514', CONSTRAINT = 'form_definitions_key_fixed';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER form_definitions_key_fixed
  BEFORE UPDATE OF key ON form_definitions
  FOR EACH ROW EXECUTE FUNCTION form_definitions_key_fixed();--> statement-breakpoint
INSERT INTO form_categories (key, title, description, sort_order) VALUES
  ('procurement', '採購流程', '請購 → 採購 → 驗收 → 付款，同一個案號串起整個採購。', 10),
  ('expense', '費用報支', '不需走採購的費用，依預算來源選擇對應版本；出差旅費另有專用表單。', 20),
  ('seal', '用印申請', '文件需要蓋公司印章時申請，核准後印出申請單連同文件交付用印。', 30),
  ('asset', '資產管理', '財產保管人異動、借出、合併、出售或報廢，核准後自動更新財產清冊。', 40),
  ('general', '一般申請', '其他行政申請表單。', 50);