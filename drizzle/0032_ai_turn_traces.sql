-- Per-turn AI assistant diagnostics (correlation id = turn_id).
-- Note: the drizzle snapshot for this migration also catches up tables that
-- 0026-0031 created with hand-written SQL; only ai_turn_traces is new here.
CREATE TABLE "ai_turn_traces" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ai_turn_traces_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"turn_id" uuid NOT NULL,
	"conversation_id" uuid,
	"owner_employee_id" uuid,
	"seq" integer NOT NULL,
	"stage" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_turn_traces_stage_check" CHECK (char_length(stage) between 1 and 60)
);
--> statement-breakpoint
ALTER TABLE "ai_turn_traces" ADD CONSTRAINT "ai_turn_traces_owner_employee_id_fkey" FOREIGN KEY ("owner_employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_turn_traces_turn_seq_uidx" ON "ai_turn_traces" USING btree ("turn_id","seq");--> statement-breakpoint
CREATE INDEX "ai_turn_traces_conversation_idx" ON "ai_turn_traces" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_turn_traces_created_at_idx" ON "ai_turn_traces" USING btree ("created_at");
