CREATE TABLE "idempotency_keys" (
	"actor_employee_id" uuid NOT NULL,
	"operation" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY("actor_employee_id","operation","idempotency_key"),
	CONSTRAINT "idempotency_keys_key_check" CHECK (length(idempotency_key) between 8 and 100)
);
--> statement-breakpoint
ALTER TABLE "acceptances" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "expense_requests" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "event_key" text;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_requests" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_actor_employee_id_fkey" FOREIGN KEY ("actor_employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idempotency_keys_created_at_idx" ON "idempotency_keys" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_event_key_idx" ON "notifications" USING btree ("event_key") WHERE event_key is not null;--> statement-breakpoint
ALTER TABLE "acceptances" ADD CONSTRAINT "acceptances_version_check" CHECK (version > 0);--> statement-breakpoint
ALTER TABLE "expense_requests" ADD CONSTRAINT "expense_requests_version_check" CHECK (version > 0);--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_version_check" CHECK (version > 0);--> statement-breakpoint
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_version_check" CHECK (version > 0);