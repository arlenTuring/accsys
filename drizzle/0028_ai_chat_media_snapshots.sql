CREATE TABLE "ai_chat_staged_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_employee_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"client_attachment_id" text NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"file_size_bytes" bigint NOT NULL,
	"storage_path" text NOT NULL,
	"sha256" text NOT NULL,
	"width" integer,
	"height" integer,
	"scan_status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"purged_at" timestamp with time zone,
	CONSTRAINT "ai_chat_staged_attachments_client_uidx" UNIQUE("owner_employee_id","client_attachment_id"),
	CONSTRAINT "ai_chat_staged_attachments_mime_check" CHECK (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
	CONSTRAINT "ai_chat_staged_attachments_scan_check" CHECK (scan_status in ('pending', 'scanning', 'ready', 'failed', 'purged')),
	CONSTRAINT "ai_chat_staged_attachments_size_check" CHECK (file_size_bytes > 0 AND file_size_bytes <= 3145728)
);--> statement-breakpoint
ALTER TABLE "ai_chat_staged_attachments" ADD CONSTRAINT "ai_chat_staged_attachments_owner_fkey" FOREIGN KEY ("owner_employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_chat_staged_attachments" ADD CONSTRAINT "ai_chat_staged_attachments_conversation_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."ai_conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_chat_staged_attachments_conversation_idx" ON "ai_chat_staged_attachments" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE TABLE "approved_document_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_form_type" text NOT NULL,
	"source_form_id" uuid NOT NULL,
	"source_form_number" text NOT NULL,
	"source_form_key" text,
	"source_version" integer NOT NULL,
	"approval_round_key" text NOT NULL,
	"approved_at" timestamp with time zone NOT NULL,
	"content_hash" text NOT NULL,
	"renderer_version" text NOT NULL,
	"storage_path" text NOT NULL,
	"file_name" text NOT NULL,
	"file_size_bytes" bigint NOT NULL,
	"generated_by_employee_id" uuid NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approved_document_snapshots_source_round_uidx" UNIQUE("source_form_type","source_form_id","source_version","approval_round_key"),
	CONSTRAINT "approved_document_snapshots_hash_check" CHECK (char_length(content_hash) = 64),
	CONSTRAINT "approved_document_snapshots_size_check" CHECK (file_size_bytes > 0)
);--> statement-breakpoint
ALTER TABLE "approved_document_snapshots" ADD CONSTRAINT "approved_document_snapshots_generated_by_fkey" FOREIGN KEY ("generated_by_employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approved_document_snapshots_source_idx" ON "approved_document_snapshots" USING btree ("source_form_type","source_form_id");--> statement-breakpoint
CREATE TABLE "ai_draft_snapshot_attachments" (
	"draft_id" uuid NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"attached_by_employee_id" uuid NOT NULL,
	"attached_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_draft_snapshot_attachments_pkey" PRIMARY KEY("draft_id","snapshot_id")
);--> statement-breakpoint
ALTER TABLE "ai_draft_snapshot_attachments" ADD CONSTRAINT "ai_draft_snapshot_attachments_draft_fkey" FOREIGN KEY ("draft_id") REFERENCES "public"."ai_application_drafts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_draft_snapshot_attachments" ADD CONSTRAINT "ai_draft_snapshot_attachments_snapshot_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "public"."approved_document_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_draft_snapshot_attachments" ADD CONSTRAINT "ai_draft_snapshot_attachments_by_fkey" FOREIGN KEY ("attached_by_employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;
