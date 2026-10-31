-- Records when an AI check was started and what its result was computed from (file hash, company profile, rules).
ALTER TABLE "ai_chat_staged_attachments" ADD COLUMN "analysis_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ai_chat_staged_attachments" ADD COLUMN "analysis_content_sha256" text;--> statement-breakpoint
ALTER TABLE "ai_chat_staged_attachments" ADD COLUMN "analysis_company_version" integer;--> statement-breakpoint
ALTER TABLE "ai_chat_staged_attachments" ADD COLUMN "analysis_rules_version" text;