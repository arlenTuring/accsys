-- Lets a later conversation of the same owner continue a draft (see aiConversationDraftLinks).
CREATE TABLE "ai_conversation_draft_links" (
	"conversation_id" uuid NOT NULL,
	"draft_id" uuid NOT NULL,
	"owner_employee_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_conversation_draft_links_pkey" PRIMARY KEY("conversation_id","draft_id")
);
--> statement-breakpoint
ALTER TABLE "ai_conversation_draft_links" ADD CONSTRAINT "ai_conversation_draft_links_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."ai_conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_conversation_draft_links" ADD CONSTRAINT "ai_conversation_draft_links_draft_id_fkey" FOREIGN KEY ("draft_id") REFERENCES "public"."ai_application_drafts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_conversation_draft_links" ADD CONSTRAINT "ai_conversation_draft_links_owner_employee_id_fkey" FOREIGN KEY ("owner_employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_conversation_draft_links_draft_idx" ON "ai_conversation_draft_links" USING btree ("draft_id");