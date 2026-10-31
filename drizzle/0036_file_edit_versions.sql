-- Photo edit versions (the original file is never changed) and composer state of staged files.
CREATE TABLE "ai_file_edit_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_employee_id" uuid NOT NULL,
	"source_kind" text NOT NULL,
	"source_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"operations" jsonb NOT NULL,
	"output_path" text NOT NULL,
	"output_sha256" text NOT NULL,
	"analysis_path" text NOT NULL,
	"analysis_sha256" text NOT NULL,
	"mime_type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_file_edit_versions_source_version_uidx" UNIQUE("source_kind","source_id","version"),
	CONSTRAINT "ai_file_edit_versions_kind_check" CHECK (source_kind in ('staged', 'draft_file'))
);
--> statement-breakpoint
ALTER TABLE "ai_chat_staged_attachments" ADD COLUMN "active_edit_id" uuid;--> statement-breakpoint
ALTER TABLE "ai_chat_staged_attachments" ADD COLUMN "target_draft_id" uuid;--> statement-breakpoint
ALTER TABLE "ai_chat_staged_attachments" ADD COLUMN "sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ai_draft_file_attachments" ADD COLUMN "active_edit_id" uuid;--> statement-breakpoint
ALTER TABLE "ai_file_edit_versions" ADD CONSTRAINT "ai_file_edit_versions_owner_fkey" FOREIGN KEY ("owner_employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_file_edit_versions_source_idx" ON "ai_file_edit_versions" USING btree ("source_id");