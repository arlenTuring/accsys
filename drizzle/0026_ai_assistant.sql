CREATE TABLE "ai_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_employee_id" uuid NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_conversations_title_check" CHECK (char_length(title) <= 120)
);
--> statement-breakpoint
CREATE TABLE "ai_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"role" text NOT NULL,
	"client_message_id" text,
	"content_text" text DEFAULT '' NOT NULL,
	"blocks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tools_used" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_messages_role_check" CHECK (role in ('user', 'model', 'system')),
	CONSTRAINT "ai_messages_blocks_check" CHECK (jsonb_typeof(blocks) = 'array'),
	CONSTRAINT "ai_messages_tools_used_check" CHECK (jsonb_typeof(tools_used) = 'array')
);
--> statement-breakpoint
CREATE TABLE "ai_application_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"owner_employee_id" uuid NOT NULL,
	"form_definition_key" text NOT NULL,
	"form_version_id" uuid,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"submission_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_application_drafts_status_check" CHECK (status in ('draft', 'submitted', 'abandoned')),
	CONSTRAINT "ai_application_drafts_data_check" CHECK (jsonb_typeof(data) = 'object'),
	CONSTRAINT "ai_application_drafts_version_check" CHECK (version > 0)
);
--> statement-breakpoint
CREATE TABLE "ai_project_usage" (
	"employee_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_project_usage_pkey" PRIMARY KEY("employee_id","project_id")
);
--> statement-breakpoint
CREATE TABLE "ai_nudge_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"form_type" text NOT NULL,
	"form_id" uuid NOT NULL,
	"business_date" date NOT NULL,
	"actor_employee_id" uuid NOT NULL,
	"recipients" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_nudge_events_form_day_key" UNIQUE("form_type","form_id","business_date"),
	CONSTRAINT "ai_nudge_events_status_check" CHECK (status in ('queued', 'notified', 'failed')),
	CONSTRAINT "ai_nudge_events_recipients_check" CHECK (jsonb_typeof(recipients) = 'array')
);
--> statement-breakpoint
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_owner_employee_id_fkey" FOREIGN KEY ("owner_employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."ai_conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_application_drafts" ADD CONSTRAINT "ai_application_drafts_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."ai_conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_application_drafts" ADD CONSTRAINT "ai_application_drafts_owner_employee_id_fkey" FOREIGN KEY ("owner_employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_application_drafts" ADD CONSTRAINT "ai_application_drafts_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "public"."form_submissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_project_usage" ADD CONSTRAINT "ai_project_usage_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_project_usage" ADD CONSTRAINT "ai_project_usage_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_nudge_events" ADD CONSTRAINT "ai_nudge_events_actor_employee_id_fkey" FOREIGN KEY ("actor_employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_conversations_owner_updated_idx" ON "ai_conversations" USING btree ("owner_employee_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_messages_conversation_client_message_uidx" ON "ai_messages" USING btree ("conversation_id","client_message_id");--> statement-breakpoint
CREATE INDEX "ai_messages_conversation_created_idx" ON "ai_messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_application_drafts_owner_updated_idx" ON "ai_application_drafts" USING btree ("owner_employee_id","updated_at");--> statement-breakpoint
CREATE INDEX "ai_application_drafts_conversation_idx" ON "ai_application_drafts" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "ai_project_usage_employee_last_used_idx" ON "ai_project_usage" USING btree ("employee_id","last_used_at");--> statement-breakpoint
CREATE INDEX "ai_nudge_events_form_idx" ON "ai_nudge_events" USING btree ("form_type","form_id");
