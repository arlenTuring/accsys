-- Attachment preview derivatives, analyses, confirmations, upload sessions, company profile.

CREATE TABLE IF NOT EXISTS "company_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"legal_name" text NOT NULL,
	"tax_id" text NOT NULL,
	"address" text,
	"name_aliases" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by_employee_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_profiles_code_uidx" UNIQUE("code"),
	CONSTRAINT "company_profiles_tax_id_check" CHECK (char_length(btrim(tax_id)) BETWEEN 8 AND 10)
);--> statement-breakpoint
ALTER TABLE "company_profiles" ADD CONSTRAINT "company_profiles_updated_by_fkey" FOREIGN KEY ("updated_by_employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "attachment_derivatives" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attachment_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"mime_type" text NOT NULL,
	"storage_path" text NOT NULL,
	"file_size_bytes" bigint NOT NULL,
	"source_sha256" text NOT NULL,
	"renderer_version" text NOT NULL,
	"page_from" integer,
	"page_to" integer,
	"width" integer,
	"height" integer,
	"status" text DEFAULT 'ready' NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attachment_derivatives_path_uidx" UNIQUE("storage_path"),
	CONSTRAINT "attachment_derivatives_kind_check" CHECK (kind in ('preview_image', 'preview_pdf', 'page_image', 'thumbnail')),
	CONSTRAINT "attachment_derivatives_status_check" CHECK (status in ('pending', 'ready', 'failed'))
);--> statement-breakpoint
ALTER TABLE "attachment_derivatives" ADD CONSTRAINT "attachment_derivatives_attachment_fkey" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attachment_derivatives_attachment_idx" ON "attachment_derivatives" USING btree ("attachment_id","kind");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "attachment_analyses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attachment_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"model" text,
	"rules_version" text NOT NULL,
	"company_profile_id" uuid,
	"company_profile_version" integer,
	"result" jsonb NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "attachment_analyses_kind_check" CHECK (kind in ('invoice_check', 'document_type')),
	CONSTRAINT "attachment_analyses_status_check" CHECK (status in ('pending', 'running', 'ready', 'failed', 'skipped'))
);--> statement-breakpoint
ALTER TABLE "attachment_analyses" ADD CONSTRAINT "attachment_analyses_attachment_fkey" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachment_analyses" ADD CONSTRAINT "attachment_analyses_company_fkey" FOREIGN KEY ("company_profile_id") REFERENCES "public"."company_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attachment_analyses_attachment_idx" ON "attachment_analyses" USING btree ("attachment_id","kind","created_at");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "attachment_confirmations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attachment_id" uuid NOT NULL,
	"draft_id" uuid,
	"form_type" text,
	"form_id" uuid,
	"analysis_id" uuid,
	"content_sha256" text NOT NULL,
	"company_profile_version" integer,
	"reminder_code" text NOT NULL,
	"reminder_summary" text NOT NULL,
	"user_note" text,
	"corrections" jsonb,
	"confirmed_by_employee_id" uuid NOT NULL,
	"confirmed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attachment_confirmations_reminder_check" CHECK (reminder_code in ('tax_id_mismatch', 'tax_id_missing', 'unclear', 'analysis_failed', 'not_invoice', 'company_unset', 'other'))
);--> statement-breakpoint
ALTER TABLE "attachment_confirmations" ADD CONSTRAINT "attachment_confirmations_attachment_fkey" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachment_confirmations" ADD CONSTRAINT "attachment_confirmations_analysis_fkey" FOREIGN KEY ("analysis_id") REFERENCES "public"."attachment_analyses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachment_confirmations" ADD CONSTRAINT "attachment_confirmations_by_fkey" FOREIGN KEY ("confirmed_by_employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attachment_confirmations_attachment_idx" ON "attachment_confirmations" USING btree ("attachment_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "attachment_upload_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_employee_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"form_type" text,
	"form_id" uuid,
	"conversation_id" uuid,
	"client_upload_id" text NOT NULL,
	"file_name" text NOT NULL,
	"declared_mime" text,
	"declared_size_bytes" bigint NOT NULL,
	"chunk_size_bytes" integer NOT NULL,
	"total_chunks" integer NOT NULL,
	"received_chunks" integer DEFAULT 0 NOT NULL,
	"temp_storage_prefix" text NOT NULL,
	"status" text DEFAULT 'receiving' NOT NULL,
	"assembled_sha256" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "attachment_upload_sessions_client_uidx" UNIQUE("owner_employee_id","client_upload_id"),
	CONSTRAINT "attachment_upload_sessions_purpose_check" CHECK (purpose in ('form', 'ai_chat', 'draft')),
	CONSTRAINT "attachment_upload_sessions_status_check" CHECK (status in ('receiving', 'assembling', 'ready', 'failed', 'expired', 'purged')),
	CONSTRAINT "attachment_upload_sessions_size_check" CHECK (declared_size_bytes > 0 AND chunk_size_bytes > 0 AND total_chunks > 0)
);--> statement-breakpoint
ALTER TABLE "attachment_upload_sessions" ADD CONSTRAINT "attachment_upload_sessions_owner_fkey" FOREIGN KEY ("owner_employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attachment_upload_sessions_owner_idx" ON "attachment_upload_sessions" USING btree ("owner_employee_id","created_at");--> statement-breakpoint

-- Relax AI chat staged attachment checks for unified policy (PDF + HEIC + larger sizes).
ALTER TABLE "ai_chat_staged_attachments" DROP CONSTRAINT IF EXISTS "ai_chat_staged_attachments_mime_check";--> statement-breakpoint
ALTER TABLE "ai_chat_staged_attachments" ADD CONSTRAINT "ai_chat_staged_attachments_mime_check" CHECK (mime_type in ('image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'));--> statement-breakpoint
ALTER TABLE "ai_chat_staged_attachments" DROP CONSTRAINT IF EXISTS "ai_chat_staged_attachments_size_check";--> statement-breakpoint
ALTER TABLE "ai_chat_staged_attachments" ADD CONSTRAINT "ai_chat_staged_attachments_size_check" CHECK (file_size_bytes > 0 AND file_size_bytes <= 52428800);
