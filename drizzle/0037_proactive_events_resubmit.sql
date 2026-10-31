-- Proactive events: delivered state for at-most-once popups; 補件 drafts revise a returned submission.
ALTER TABLE "ai_assistant_event_acks" DROP CONSTRAINT "ai_assistant_event_acks_state_check";--> statement-breakpoint
ALTER TABLE "ai_application_drafts" ADD COLUMN "resubmit_of_submission_id" uuid;--> statement-breakpoint
ALTER TABLE "ai_application_drafts" ADD COLUMN "resubmit_base_version" integer;--> statement-breakpoint
ALTER TABLE "ai_application_drafts" ADD CONSTRAINT "ai_application_drafts_resubmit_of_fkey" FOREIGN KEY ("resubmit_of_submission_id") REFERENCES "public"."form_submissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_application_drafts_open_resubmit_uidx" ON "ai_application_drafts" USING btree ("resubmit_of_submission_id") WHERE resubmit_of_submission_id is not null and status = 'draft';--> statement-breakpoint
ALTER TABLE "ai_assistant_event_acks" ADD CONSTRAINT "ai_assistant_event_acks_state_check" CHECK (state in ('delivered', 'viewed', 'dismissed', 'muted'));