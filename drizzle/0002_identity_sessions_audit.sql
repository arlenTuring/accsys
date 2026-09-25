CREATE TABLE "app_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"employee_id" uuid NOT NULL,
	"identity_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text,
	CONSTRAINT "app_sessions_token_hash_key" UNIQUE("token_hash"),
	CONSTRAINT "app_sessions_token_hash_check" CHECK (token_hash ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "app_sessions_expiry_check" CHECK (expires_at > created_at)
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_type" text NOT NULL,
	"actor_employee_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"request_id" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "audit_events_actor_type_check" CHECK (actor_type in ('employee', 'system')),
	CONSTRAINT "audit_events_actor_check" CHECK ((actor_type = 'employee') = (actor_employee_id is not null))
);
--> statement-breakpoint
CREATE TABLE "employee_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"issuer" text NOT NULL,
	"subject" text NOT NULL,
	"email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "employee_identities_provider_issuer_subject_key" UNIQUE("provider","issuer","subject"),
	CONSTRAINT "employee_identities_provider_check" CHECK (provider in ('google')),
	CONSTRAINT "employee_identities_issuer_check" CHECK (issuer <> ''),
	CONSTRAINT "employee_identities_subject_check" CHECK (subject <> '')
);
--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "access_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "disabled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "disabled_reason" text;--> statement-breakpoint
ALTER TABLE "app_sessions" ADD CONSTRAINT "app_sessions_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_sessions" ADD CONSTRAINT "app_sessions_identity_id_fkey" FOREIGN KEY ("identity_id") REFERENCES "public"."employee_identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_employee_id_fkey" FOREIGN KEY ("actor_employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_identities" ADD CONSTRAINT "employee_identities_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "app_sessions_active_employee_idx" ON "app_sessions" USING btree ("employee_id") WHERE revoked_at is null;--> statement-breakpoint
CREATE INDEX "app_sessions_expires_at_idx" ON "app_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "audit_events_entity_idx" ON "audit_events" USING btree ("entity_type","entity_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_events_actor_idx" ON "audit_events" USING btree ("actor_employee_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "employee_identities_one_active_per_provider_idx" ON "employee_identities" USING btree ("employee_id","provider") WHERE revoked_at is null;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_access_state_check" CHECK (access_enabled = (disabled_at is null));