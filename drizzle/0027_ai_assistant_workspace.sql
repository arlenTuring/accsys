ALTER TABLE "ai_conversations" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ai_application_drafts" ADD COLUMN "title" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_application_drafts" ADD COLUMN "create_idempotency_key" text;--> statement-breakpoint
ALTER TABLE "ai_application_drafts" ADD CONSTRAINT "ai_application_drafts_title_check" CHECK (char_length(title) <= 160);--> statement-breakpoint
CREATE UNIQUE INDEX "ai_application_drafts_owner_create_idem_uidx" ON "ai_application_drafts" USING btree ("owner_employee_id","create_idempotency_key") WHERE "create_idempotency_key" IS NOT NULL;--> statement-breakpoint
CREATE TABLE "ai_assistant_event_acks" (
	"employee_id" uuid NOT NULL,
	"event_key" text NOT NULL,
	"state" text DEFAULT 'viewed' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_assistant_event_acks_pkey" PRIMARY KEY("employee_id","event_key"),
	CONSTRAINT "ai_assistant_event_acks_state_check" CHECK (state in ('viewed', 'dismissed', 'muted')),
	CONSTRAINT "ai_assistant_event_acks_event_key_check" CHECK (char_length(event_key) >= 1 AND char_length(event_key) <= 200)
);--> statement-breakpoint
ALTER TABLE "ai_assistant_event_acks" ADD CONSTRAINT "ai_assistant_event_acks_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_assistant_event_acks_employee_updated_idx" ON "ai_assistant_event_acks" USING btree ("employee_id","updated_at");
