CREATE TABLE "form_submission_asset_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid NOT NULL,
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
	CONSTRAINT "form_submission_asset_lines_submission_id_line_no_key" UNIQUE("submission_id","line_no"),
	CONSTRAINT "form_submission_asset_lines_submission_id_asset_id_key" UNIQUE("submission_id","asset_id"),
	CONSTRAINT "form_submission_asset_lines_quantity_check" CHECK (quantity > 0),
	CONSTRAINT "form_submission_asset_lines_reason_check" CHECK (reason in ('custodian_change', 'lend', 'merge', 'sell', 'scrap', 'other'))
);
--> statement-breakpoint
ALTER TABLE "form_submissions" ADD COLUMN "register_applied_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "form_submission_asset_lines" ADD CONSTRAINT "form_submission_asset_lines_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "public"."form_submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submission_asset_lines" ADD CONSTRAINT "form_submission_asset_lines_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submission_asset_lines" ADD CONSTRAINT "form_submission_asset_lines_original_custodian_fkey" FOREIGN KEY ("original_custodian_employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submission_asset_lines" ADD CONSTRAINT "form_submission_asset_lines_new_custodian_fkey" FOREIGN KEY ("new_custodian_employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "form_submission_asset_lines_asset_id_idx" ON "form_submission_asset_lines" USING btree ("asset_id");