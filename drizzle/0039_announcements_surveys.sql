-- Company announcements + named internal surveys.

CREATE TABLE IF NOT EXISTS "company_announcements" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "title" text NOT NULL,
  "body" text NOT NULL,
  "category" text NOT NULL DEFAULT 'general',
  "audience_type" text NOT NULL DEFAULT 'company',
  "audience_department_ids" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "audience_employee_ids" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "status" text NOT NULL DEFAULT 'draft',
  "priority" text NOT NULL DEFAULT 'normal',
  "pinned" boolean NOT NULL DEFAULT false,
  "version" integer NOT NULL DEFAULT 1,
  "summary_cache" text,
  "summary_source_version" integer,
  "publish_at" timestamp with time zone,
  "expire_at" timestamp with time zone,
  "published_at" timestamp with time zone,
  "withdrawn_at" timestamp with time zone,
  "created_by_employee_id" uuid NOT NULL,
  "updated_by_employee_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "company_announcements_title_check" CHECK (char_length(btrim(title)) between 1 and 200),
  CONSTRAINT "company_announcements_body_check" CHECK (char_length(body) between 1 and 50000),
  CONSTRAINT "company_announcements_audience_check" CHECK (audience_type in ('company', 'department', 'employees')),
  CONSTRAINT "company_announcements_status_check" CHECK (status in ('draft', 'scheduled', 'published', 'expired', 'withdrawn')),
  CONSTRAINT "company_announcements_priority_check" CHECK (priority in ('normal', 'important', 'urgent')),
  CONSTRAINT "company_announcements_version_check" CHECK (version > 0),
  CONSTRAINT "company_announcements_dept_ids_array_check" CHECK (jsonb_typeof(audience_department_ids) = 'array'),
  CONSTRAINT "company_announcements_emp_ids_array_check" CHECK (jsonb_typeof(audience_employee_ids) = 'array')
);--> statement-breakpoint
ALTER TABLE "company_announcements" ADD CONSTRAINT "company_announcements_created_by_fkey"
  FOREIGN KEY ("created_by_employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_announcements" ADD CONSTRAINT "company_announcements_updated_by_fkey"
  FOREIGN KEY ("updated_by_employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "company_announcements_status_publish_idx" ON "company_announcements" ("status", "publish_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "company_announcements_pinned_idx" ON "company_announcements" ("pinned") WHERE pinned = true;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "company_announcement_reads" (
  "announcement_id" uuid NOT NULL,
  "employee_id" uuid NOT NULL,
  "read_at" timestamp with time zone,
  "acknowledged_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY ("announcement_id", "employee_id")
);--> statement-breakpoint
ALTER TABLE "company_announcement_reads" ADD CONSTRAINT "company_announcement_reads_announcement_fkey"
  FOREIGN KEY ("announcement_id") REFERENCES "public"."company_announcements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_announcement_reads" ADD CONSTRAINT "company_announcement_reads_employee_fkey"
  FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "company_announcement_reads_employee_idx" ON "company_announcement_reads" ("employee_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "company_announcement_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "announcement_id" uuid NOT NULL,
  "version" integer NOT NULL,
  "title" text NOT NULL,
  "body" text NOT NULL,
  "snapshot" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_by_employee_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "company_announcement_versions_unique" UNIQUE ("announcement_id", "version")
);--> statement-breakpoint
ALTER TABLE "company_announcement_versions" ADD CONSTRAINT "company_announcement_versions_announcement_fkey"
  FOREIGN KEY ("announcement_id") REFERENCES "public"."company_announcements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_announcement_versions" ADD CONSTRAINT "company_announcement_versions_created_by_fkey"
  FOREIGN KEY ("created_by_employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "company_surveys" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "title" text NOT NULL,
  "description" text NOT NULL DEFAULT '',
  "status" text NOT NULL DEFAULT 'draft',
  "audience_type" text NOT NULL DEFAULT 'company',
  "audience_department_ids" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "audience_employee_ids" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "opens_at" timestamp with time zone,
  "closes_at" timestamp with time zone,
  "version" integer NOT NULL DEFAULT 1,
  "published_question_snapshot" jsonb,
  "created_by_employee_id" uuid NOT NULL,
  "updated_by_employee_id" uuid,
  "published_at" timestamp with time zone,
  "closed_at" timestamp with time zone,
  "archived_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "company_surveys_title_check" CHECK (char_length(btrim(title)) between 1 and 200),
  CONSTRAINT "company_surveys_status_check" CHECK (status in ('draft', 'scheduled', 'open', 'closed', 'archived')),
  CONSTRAINT "company_surveys_audience_check" CHECK (audience_type in ('company', 'department', 'employees')),
  CONSTRAINT "company_surveys_version_check" CHECK (version > 0),
  CONSTRAINT "company_surveys_dept_ids_array_check" CHECK (jsonb_typeof(audience_department_ids) = 'array'),
  CONSTRAINT "company_surveys_emp_ids_array_check" CHECK (jsonb_typeof(audience_employee_ids) = 'array')
);--> statement-breakpoint
ALTER TABLE "company_surveys" ADD CONSTRAINT "company_surveys_created_by_fkey"
  FOREIGN KEY ("created_by_employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_surveys" ADD CONSTRAINT "company_surveys_updated_by_fkey"
  FOREIGN KEY ("updated_by_employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "company_surveys_status_idx" ON "company_surveys" ("status");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "company_survey_questions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "survey_id" uuid NOT NULL,
  "stable_key" text NOT NULL,
  "prompt" text NOT NULL,
  "help" text NOT NULL DEFAULT '',
  "question_type" text NOT NULL,
  "required" boolean NOT NULL DEFAULT false,
  "sort_order" integer NOT NULL DEFAULT 0,
  "options" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "validation" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "company_survey_questions_stable_key_check" CHECK (stable_key ~ '^[a-z][a-z0-9_]{0,63}$'),
  CONSTRAINT "company_survey_questions_type_check" CHECK (question_type in (
    'single_choice', 'multi_choice', 'short_text', 'long_text', 'number', 'date', 'rating'
  )),
  CONSTRAINT "company_survey_questions_options_array_check" CHECK (jsonb_typeof(options) = 'array'),
  CONSTRAINT "company_survey_questions_survey_key_unique" UNIQUE ("survey_id", "stable_key")
);--> statement-breakpoint
ALTER TABLE "company_survey_questions" ADD CONSTRAINT "company_survey_questions_survey_fkey"
  FOREIGN KEY ("survey_id") REFERENCES "public"."company_surveys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "company_survey_questions_survey_sort_idx" ON "company_survey_questions" ("survey_id", "sort_order");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "company_survey_responses" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "survey_id" uuid NOT NULL,
  "employee_id" uuid NOT NULL,
  "status" text NOT NULL DEFAULT 'draft',
  "answers" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "survey_version" integer NOT NULL DEFAULT 1,
  "submitted_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "company_survey_responses_status_check" CHECK (status in ('draft', 'submitted')),
  CONSTRAINT "company_survey_responses_answers_object_check" CHECK (jsonb_typeof(answers) = 'object'),
  CONSTRAINT "company_survey_responses_one_per_employee" UNIQUE ("survey_id", "employee_id")
);--> statement-breakpoint
ALTER TABLE "company_survey_responses" ADD CONSTRAINT "company_survey_responses_survey_fkey"
  FOREIGN KEY ("survey_id") REFERENCES "public"."company_surveys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_survey_responses" ADD CONSTRAINT "company_survey_responses_employee_fkey"
  FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "company_survey_responses_survey_status_idx" ON "company_survey_responses" ("survey_id", "status");--> statement-breakpoint
