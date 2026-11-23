-- 0044: Common form features — filing_agents (經辦人設定) and form_drafts (表單送出前暫存草稿)

CREATE TABLE IF NOT EXISTS "filing_agents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "agent_employee_id" uuid NOT NULL,
  "target_type" text NOT NULL,
  "target_employee_id" uuid,
  "target_department_id" uuid,
  "note" text,
  "created_by_employee_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "filing_agents_agent_employee_id_fkey" FOREIGN KEY ("agent_employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade,
  CONSTRAINT "filing_agents_target_employee_id_fkey" FOREIGN KEY ("target_employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade,
  CONSTRAINT "filing_agents_target_department_id_fkey" FOREIGN KEY ("target_department_id") REFERENCES "public"."departments"("id") ON DELETE cascade,
  CONSTRAINT "filing_agents_created_by_employee_id_fkey" FOREIGN KEY ("created_by_employee_id") REFERENCES "public"."employees"("id"),
  CONSTRAINT "filing_agents_target_check" CHECK (
    ("target_type" = 'employee' AND "target_employee_id" IS NOT NULL AND "target_department_id" IS NULL AND "target_employee_id" <> "agent_employee_id")
    OR ("target_type" = 'department' AND "target_department_id" IS NOT NULL AND "target_employee_id" IS NULL)
  ),
  CONSTRAINT "filing_agents_note_check" CHECK ("note" IS NULL OR char_length("note") <= 200)
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "filing_agents_agent_idx" ON "filing_agents" ("agent_employee_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "filing_agents_target_emp_idx" ON "filing_agents" ("target_employee_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "filing_agents_target_dept_idx" ON "filing_agents" ("target_department_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "form_drafts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "owner_employee_id" uuid NOT NULL,
  "applicant_employee_id" uuid,
  "form_type" text DEFAULT 'custom' NOT NULL,
  "form_key" text NOT NULL,
  "form_label" text NOT NULL,
  "title" text DEFAULT '' NOT NULL,
  "data" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "form_drafts_owner_employee_id_fkey" FOREIGN KEY ("owner_employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade,
  CONSTRAINT "form_drafts_applicant_employee_id_fkey" FOREIGN KEY ("applicant_employee_id") REFERENCES "public"."employees"("id") ON DELETE set null,
  CONSTRAINT "form_drafts_data_object_check" CHECK (jsonb_typeof("data") = 'object')
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "form_drafts_owner_updated_idx" ON "form_drafts" ("owner_employee_id", "updated_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "form_drafts_owner_form_idx" ON "form_drafts" ("owner_employee_id", "form_key");
