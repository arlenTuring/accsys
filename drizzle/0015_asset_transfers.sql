CREATE TABLE "asset_transfer_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_transfer_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"asset_id" uuid NOT NULL,
	"asset_tag" text NOT NULL,
	"asset_name" text NOT NULL,
	"quantity" integer NOT NULL,
	"original_custodian_employee_id" uuid NOT NULL,
	"original_location" text NOT NULL,
	"reason" text NOT NULL,
	"new_custodian_employee_id" uuid NOT NULL,
	"new_location" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "asset_transfer_items_asset_transfer_id_line_no_key" UNIQUE("asset_transfer_id","line_no"),
	CONSTRAINT "asset_transfer_items_asset_transfer_id_asset_id_key" UNIQUE("asset_transfer_id","asset_id"),
	CONSTRAINT "asset_transfer_items_quantity_check" CHECK (quantity > 0),
	CONSTRAINT "asset_transfer_items_reason_check" CHECK (reason in ('custodian_change', 'lend', 'merge', 'sell', 'scrap', 'other'))
);
--> statement-breakpoint
CREATE TABLE "asset_transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"procurement_case_id" uuid NOT NULL,
	"applicant_employee_id" uuid NOT NULL,
	"department_id" uuid NOT NULL,
	"use_department_id" uuid NOT NULL,
	"use_budget_code_id" uuid NOT NULL,
	"application_date" date DEFAULT (now() at time zone 'Asia/Taipei')::date NOT NULL,
	"transfer_types" text[] NOT NULL,
	"remark" text,
	"original_custodian_employee_id" uuid NOT NULL,
	"new_custodian_employee_id" uuid NOT NULL,
	"other_custodian_employee_id" uuid,
	"original_manager_employee_id" uuid NOT NULL,
	"new_manager_employee_id" uuid NOT NULL,
	"other_manager_employee_id" uuid,
	"applied_at" timestamp with time zone,
	"status" text DEFAULT 'pending_approval' NOT NULL,
	"current_step_order" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "asset_transfers_procurement_case_id_key" UNIQUE("procurement_case_id"),
	CONSTRAINT "asset_transfers_version_check" CHECK (version > 0),
	CONSTRAINT "asset_transfers_status_check" CHECK (status in ('pending_approval', 'approved', 'returned', 'withdrawn')),
	CONSTRAINT "asset_transfers_transfer_types_check" CHECK (cardinality(transfer_types) > 0 and transfer_types <@ array['custodian_change', 'lend', 'merge', 'sell', 'scrap', 'other']::text[]),
	CONSTRAINT "asset_transfers_applied_check" CHECK (applied_at is null or status = 'approved')
);
--> statement-breakpoint
CREATE TABLE "assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tag" text NOT NULL,
	"name" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"custodian_employee_id" uuid NOT NULL,
	"location" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'in_custody' NOT NULL,
	"remark" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assets_tag_key" UNIQUE("tag"),
	CONSTRAINT "assets_quantity_check" CHECK (quantity > 0),
	CONSTRAINT "assets_status_check" CHECK (status in ('in_custody', 'lent', 'merged', 'sold', 'scrapped'))
);
--> statement-breakpoint
ALTER TABLE "approval_steps" DROP CONSTRAINT "approval_steps_form_type_check";--> statement-breakpoint
ALTER TABLE "approval_steps" DROP CONSTRAINT "approval_steps_approver_role_check";--> statement-breakpoint
ALTER TABLE "attachments" DROP CONSTRAINT "attachments_form_type_check";--> statement-breakpoint
ALTER TABLE "procurement_cases" DROP CONSTRAINT "procurement_cases_case_type_check";--> statement-breakpoint
ALTER TABLE "asset_transfer_items" ADD CONSTRAINT "asset_transfer_items_asset_transfer_id_fkey" FOREIGN KEY ("asset_transfer_id") REFERENCES "public"."asset_transfers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_transfer_items" ADD CONSTRAINT "asset_transfer_items_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_transfer_items" ADD CONSTRAINT "asset_transfer_items_original_custodian_fkey" FOREIGN KEY ("original_custodian_employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_transfer_items" ADD CONSTRAINT "asset_transfer_items_new_custodian_fkey" FOREIGN KEY ("new_custodian_employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_transfers" ADD CONSTRAINT "asset_transfers_procurement_case_id_fkey" FOREIGN KEY ("procurement_case_id") REFERENCES "public"."procurement_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_transfers" ADD CONSTRAINT "asset_transfers_applicant_employee_id_fkey" FOREIGN KEY ("applicant_employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_transfers" ADD CONSTRAINT "asset_transfers_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_transfers" ADD CONSTRAINT "asset_transfers_use_department_id_fkey" FOREIGN KEY ("use_department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_transfers" ADD CONSTRAINT "asset_transfers_use_budget_code_id_fkey" FOREIGN KEY ("use_budget_code_id") REFERENCES "public"."budget_codes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_transfers" ADD CONSTRAINT "asset_transfers_original_custodian_fkey" FOREIGN KEY ("original_custodian_employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_transfers" ADD CONSTRAINT "asset_transfers_new_custodian_fkey" FOREIGN KEY ("new_custodian_employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_transfers" ADD CONSTRAINT "asset_transfers_other_custodian_fkey" FOREIGN KEY ("other_custodian_employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_transfers" ADD CONSTRAINT "asset_transfers_original_manager_fkey" FOREIGN KEY ("original_manager_employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_transfers" ADD CONSTRAINT "asset_transfers_new_manager_fkey" FOREIGN KEY ("new_manager_employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_transfers" ADD CONSTRAINT "asset_transfers_other_manager_fkey" FOREIGN KEY ("other_manager_employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_custodian_employee_id_fkey" FOREIGN KEY ("custodian_employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "asset_transfer_items_asset_id_idx" ON "asset_transfer_items" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "asset_transfers_applicant_employee_id_idx" ON "asset_transfers" USING btree ("applicant_employee_id");--> statement-breakpoint
CREATE INDEX "asset_transfers_status_idx" ON "asset_transfers" USING btree ("status");--> statement-breakpoint
CREATE INDEX "assets_custodian_employee_id_idx" ON "assets" USING btree ("custodian_employee_id");--> statement-breakpoint
ALTER TABLE "approval_steps" ADD CONSTRAINT "approval_steps_form_type_check" CHECK (form_type in ('purchase_request', 'purchase_order', 'acceptance', 'expense_request', 'travel_expense', 'contract_seal_request', 'general_seal_request', 'invoice_seal_request', 'department_expense', 'project_expense', 'revenue_expense', 'minor_expense', 'asset_transfer'));--> statement-breakpoint
ALTER TABLE "approval_steps" ADD CONSTRAINT "approval_steps_approver_role_check" CHECK (approver_role in ('department_manager', 'budget_owner', 'general_manager', 'chairman', 'original_custodian', 'new_custodian', 'other_custodian', 'original_custodian_manager', 'new_custodian_manager', 'other_custodian_manager'));--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_form_type_check" CHECK (form_type in ('purchase_request', 'purchase_order', 'acceptance', 'expense_request', 'travel_expense', 'contract_seal_request', 'general_seal_request', 'invoice_seal_request', 'department_expense', 'project_expense', 'revenue_expense', 'minor_expense', 'asset_transfer'));--> statement-breakpoint
ALTER TABLE "procurement_cases" ADD CONSTRAINT "procurement_cases_case_type_check" CHECK (case_type in ('standard', 'standalone_expense', 'travel_expense', 'contract_seal', 'general_seal', 'invoice_seal', 'department_expense', 'project_expense', 'revenue_expense', 'minor_expense', 'asset_transfer'));