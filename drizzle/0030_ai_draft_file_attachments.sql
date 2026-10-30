-- Durable file attachments linked to AI drafts (copied from chat staging; survive staged purge).

CREATE TABLE IF NOT EXISTS "ai_draft_file_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"draft_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"file_size_bytes" bigint NOT NULL,
	"storage_path" text NOT NULL,
	"sha256" text NOT NULL,
	"source_staged_id" uuid,
	"attached_by_employee_id" uuid NOT NULL,
	"attached_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_draft_file_attachments_path_uidx" UNIQUE("storage_path"),
	CONSTRAINT "ai_draft_file_attachments_size_check" CHECK (file_size_bytes > 0 AND file_size_bytes <= 52428800)
);--> statement-breakpoint
ALTER TABLE "ai_draft_file_attachments" ADD CONSTRAINT "ai_draft_file_attachments_draft_fkey" FOREIGN KEY ("draft_id") REFERENCES "public"."ai_application_drafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_draft_file_attachments" ADD CONSTRAINT "ai_draft_file_attachments_by_fkey" FOREIGN KEY ("attached_by_employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_draft_file_attachments_draft_idx" ON "ai_draft_file_attachments" USING btree ("draft_id","attached_at");
