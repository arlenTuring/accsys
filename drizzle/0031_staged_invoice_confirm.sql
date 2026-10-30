-- Invoice analysis + business confirmations for chat-staged files (before formal form attachment).

ALTER TABLE "ai_chat_staged_attachments" ADD COLUMN IF NOT EXISTS "analysis_status" text;--> statement-breakpoint
ALTER TABLE "ai_chat_staged_attachments" ADD COLUMN IF NOT EXISTS "analysis_result" jsonb;--> statement-breakpoint
ALTER TABLE "ai_chat_staged_attachments" ADD COLUMN IF NOT EXISTS "analysis_completed_at" timestamp with time zone;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "staged_invoice_confirmations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"staged_id" uuid NOT NULL,
	"draft_id" uuid,
	"content_sha256" text NOT NULL,
	"reminder_code" text NOT NULL,
	"reminder_summary" text NOT NULL,
	"user_note" text,
	"analysis_snapshot" jsonb,
	"company_profile_version" integer,
	"confirmed_by_employee_id" uuid NOT NULL,
	"confirmed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staged_invoice_confirmations_reminder_check" CHECK (reminder_code in ('tax_id_mismatch', 'tax_id_missing', 'unclear', 'analysis_failed', 'not_invoice', 'company_unset', 'other'))
);--> statement-breakpoint
ALTER TABLE "staged_invoice_confirmations" ADD CONSTRAINT "staged_invoice_confirmations_staged_fkey" FOREIGN KEY ("staged_id") REFERENCES "public"."ai_chat_staged_attachments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staged_invoice_confirmations" ADD CONSTRAINT "staged_invoice_confirmations_by_fkey" FOREIGN KEY ("confirmed_by_employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "staged_invoice_confirmations_staged_idx" ON "staged_invoice_confirmations" USING btree ("staged_id","confirmed_at");
