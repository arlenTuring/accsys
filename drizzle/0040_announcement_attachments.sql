-- Announcement file attachments (reuse storage/scan primitives; not form_type).

CREATE TABLE IF NOT EXISTS "company_announcement_attachments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "announcement_id" uuid NOT NULL,
  "uploaded_by_employee_id" uuid NOT NULL,
  "storage_path" text NOT NULL,
  "file_name" text NOT NULL,
  "mime_type" text NOT NULL,
  "file_size_bytes" bigint NOT NULL,
  "sha256" text,
  "scan_status" text NOT NULL DEFAULT 'pending',
  "scanned_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "company_announcement_attachments_path_uidx" UNIQUE ("storage_path"),
  CONSTRAINT "company_announcement_attachments_size_check" CHECK (file_size_bytes > 0 AND file_size_bytes <= 52428800),
  CONSTRAINT "company_announcement_attachments_scan_check" CHECK (
    scan_status in ('pending', 'clean', 'infected', 'scan_failed', 'unscanned')
  )
);--> statement-breakpoint
ALTER TABLE "company_announcement_attachments" ADD CONSTRAINT "company_announcement_attachments_announcement_fkey"
  FOREIGN KEY ("announcement_id") REFERENCES "public"."company_announcements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_announcement_attachments" ADD CONSTRAINT "company_announcement_attachments_uploader_fkey"
  FOREIGN KEY ("uploaded_by_employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "company_announcement_attachments_announcement_idx"
  ON "company_announcement_attachments" ("announcement_id", "created_at");
