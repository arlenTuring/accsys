ALTER TABLE "form_submissions" DROP CONSTRAINT "form_submissions_procurement_case_id_key";--> statement-breakpoint
ALTER TABLE "form_submissions" ADD COLUMN "source_submission_id" uuid;--> statement-breakpoint
ALTER TABLE "form_submissions" ADD COLUMN "filed_by_employee_id" uuid;--> statement-breakpoint
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_source_submission_id_fkey" FOREIGN KEY ("source_submission_id") REFERENCES "public"."form_submissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_filed_by_employee_id_fkey" FOREIGN KEY ("filed_by_employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "form_submissions_procurement_case_id_idx" ON "form_submissions" USING btree ("procurement_case_id");--> statement-breakpoint
CREATE INDEX "form_submissions_source_submission_id_idx" ON "form_submissions" USING btree ("source_submission_id");--> statement-breakpoint
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_definition_case_key" UNIQUE("definition_id","procurement_case_id");--> statement-breakpoint
UPDATE "form_submissions" s SET "filed_by_employee_id" = c."created_by_employee_id" FROM "procurement_cases" c WHERE c."id" = s."procurement_case_id" AND s."filed_by_employee_id" IS NULL;