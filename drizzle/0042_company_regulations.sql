-- Company regulations & policies + attachments

CREATE TABLE IF NOT EXISTS "company_regulations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "code" text NOT NULL,
  "title" text NOT NULL,
  "category" text NOT NULL DEFAULT 'general',
  "version_label" text NOT NULL DEFAULT '1.0',
  "effective_date" text NOT NULL DEFAULT '',
  "owner_department" text NOT NULL DEFAULT '管理部',
  "approver_title" text NOT NULL DEFAULT '董事長',
  "summary" text NOT NULL DEFAULT '',
  "body" text NOT NULL,
  "related_forms" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "drive_file_id" text,
  "drive_url" text,
  "drive_file_name" text,
  "status" text NOT NULL DEFAULT 'published',
  "pinned" boolean NOT NULL DEFAULT false,
  "sort_order" integer NOT NULL DEFAULT 0,
  "revision_number" integer NOT NULL DEFAULT 1,
  "created_by_employee_id" uuid,
  "updated_by_employee_id" uuid,
  "published_at" timestamp with time zone DEFAULT now(),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "company_regulations_title_check" CHECK (char_length(btrim(title)) between 1 and 200),
  CONSTRAINT "company_regulations_body_check" CHECK (char_length(body) between 1 and 200000),
  CONSTRAINT "company_regulations_status_check" CHECK (status in ('draft', 'published', 'archived')),
  CONSTRAINT "company_regulations_related_forms_array_check" CHECK (jsonb_typeof(related_forms) = 'array')
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "company_regulations_status_cat_idx"
  ON "company_regulations" ("status", "category", "sort_order");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "company_regulation_attachments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "regulation_id" uuid NOT NULL,
  "uploaded_by_employee_id" uuid,
  "storage_path" text NOT NULL,
  "file_name" text NOT NULL,
  "mime_type" text NOT NULL,
  "file_size_bytes" bigint NOT NULL,
  "sha256" text,
  "scan_status" text NOT NULL DEFAULT 'clean',
  "scanned_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "company_regulation_attachments_path_uidx" UNIQUE ("storage_path"),
  CONSTRAINT "company_regulation_attachments_reg_fkey"
    FOREIGN KEY ("regulation_id") REFERENCES "public"."company_regulations"("id") ON DELETE cascade ON UPDATE no action
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "company_regulation_attachments_reg_idx"
  ON "company_regulation_attachments" ("regulation_id", "created_at");
