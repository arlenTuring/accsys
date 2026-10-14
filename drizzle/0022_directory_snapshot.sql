CREATE TABLE "directory_sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text NOT NULL,
	"pages" integer,
	"directory_count" integer,
	"active_count" integer,
	"error" text,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "directory_sync_runs_source_check" CHECK (source in ('directory', 'fixture')),
	CONSTRAINT "directory_sync_runs_status_check" CHECK (status in ('succeeded', 'blocked', 'failed')),
	CONSTRAINT "directory_sync_runs_error_check" CHECK ((status = 'succeeded') = (error is null) and char_length(coalesce(error, '')) <= 500)
);
--> statement-breakpoint
CREATE TABLE "directory_users" (
	"directory_user_id" text PRIMARY KEY NOT NULL,
	"customer_id" text,
	"primary_email" text NOT NULL,
	"full_name" text DEFAULT '' NOT NULL,
	"suspended" boolean DEFAULT false NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"org_unit_path" text,
	"phone" text,
	"title" text,
	"department" text,
	"employee_code" text,
	"manager_email" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone,
	CONSTRAINT "directory_users_id_check" CHECK (directory_user_id ~ '^[0-9]{1,32}$'),
	CONSTRAINT "directory_users_email_check" CHECK (primary_email = lower(primary_email) and primary_email like '%_@_%')
);
--> statement-breakpoint
CREATE INDEX "directory_sync_runs_finished_at_idx" ON "directory_sync_runs" USING btree ("finished_at");--> statement-breakpoint
CREATE INDEX "directory_users_primary_email_idx" ON "directory_users" USING btree ("primary_email");