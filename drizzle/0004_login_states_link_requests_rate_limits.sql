CREATE TABLE "identity_link_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"issuer" text NOT NULL,
	"subject" text NOT NULL,
	"email" text NOT NULL,
	"display_name" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"conflict_reason" text,
	"attempt_count" integer DEFAULT 1 NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_by_employee_id" uuid,
	"approved_employee_id" uuid,
	CONSTRAINT "identity_link_requests_provider_issuer_subject_key" UNIQUE("provider","issuer","subject"),
	CONSTRAINT "identity_link_requests_provider_check" CHECK (provider in ('google')),
	CONSTRAINT "identity_link_requests_status_check" CHECK (status in ('pending', 'approved', 'rejected')),
	CONSTRAINT "identity_link_requests_decision_check" CHECK ((status = 'pending') = (decided_at is null) and (status = 'approved') = (approved_employee_id is not null))
);
--> statement-breakpoint
CREATE TABLE "oidc_login_states" (
	"state_hash" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	CONSTRAINT "oidc_login_states_state_hash_check" CHECK (state_hash ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "rate_limit_buckets" (
	"bucket_key" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"hits" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "rate_limit_buckets_pkey" PRIMARY KEY("bucket_key","window_start")
);
--> statement-breakpoint
ALTER TABLE "identity_link_requests" ADD CONSTRAINT "identity_link_requests_decided_by_employee_id_fkey" FOREIGN KEY ("decided_by_employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_link_requests" ADD CONSTRAINT "identity_link_requests_approved_employee_id_fkey" FOREIGN KEY ("approved_employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "identity_link_requests_status_idx" ON "identity_link_requests" USING btree ("status","last_attempt_at");--> statement-breakpoint
CREATE INDEX "oidc_login_states_expires_at_idx" ON "oidc_login_states" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "rate_limit_buckets_window_start_idx" ON "rate_limit_buckets" USING btree ("window_start");