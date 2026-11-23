CREATE TABLE IF NOT EXISTS "system_email_settings" (
  "code" text PRIMARY KEY DEFAULT 'default' NOT NULL,
  "config" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
