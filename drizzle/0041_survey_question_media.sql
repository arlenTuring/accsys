-- Media (image / video) attached to survey questions for respondents to view.

CREATE TABLE IF NOT EXISTS "company_survey_question_media" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "survey_id" uuid NOT NULL,
  "question_id" uuid NOT NULL,
  "uploaded_by_employee_id" uuid NOT NULL,
  "storage_path" text NOT NULL,
  "file_name" text NOT NULL,
  "mime_type" text NOT NULL,
  "file_size_bytes" bigint NOT NULL,
  "sha256" text,
  "scan_status" text NOT NULL DEFAULT 'pending',
  "scanned_at" timestamp with time zone,
  "sort_order" integer NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "company_survey_question_media_path_uidx" UNIQUE ("storage_path"),
  CONSTRAINT "company_survey_question_media_size_check" CHECK (file_size_bytes > 0 AND file_size_bytes <= 52428800),
  CONSTRAINT "company_survey_question_media_mime_check" CHECK (
    mime_type in ('image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm')
  ),
  CONSTRAINT "company_survey_question_media_scan_check" CHECK (
    scan_status in ('pending', 'clean', 'infected', 'scan_failed', 'unscanned')
  )
);--> statement-breakpoint
ALTER TABLE "company_survey_question_media" ADD CONSTRAINT "company_survey_question_media_survey_fkey"
  FOREIGN KEY ("survey_id") REFERENCES "public"."company_surveys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_survey_question_media" ADD CONSTRAINT "company_survey_question_media_question_fkey"
  FOREIGN KEY ("question_id") REFERENCES "public"."company_survey_questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_survey_question_media" ADD CONSTRAINT "company_survey_question_media_uploader_fkey"
  FOREIGN KEY ("uploaded_by_employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "company_survey_question_media_question_idx"
  ON "company_survey_question_media" ("question_id", "sort_order", "created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "company_survey_question_media_survey_idx"
  ON "company_survey_question_media" ("survey_id");
