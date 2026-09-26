-- Files uploaded before scanning existed are marked 'unscanned' (never served in
-- production until rescanned: scripts/attachments-rescan.ts); new rows start as
-- 'pending'.
ALTER TABLE "attachments" ADD COLUMN "scan_status" text DEFAULT 'unscanned' NOT NULL;--> statement-breakpoint
ALTER TABLE "attachments" ALTER COLUMN "scan_status" SET DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "scanned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "sha256" text;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_scan_status_check" CHECK (scan_status in ('pending', 'clean', 'infected', 'scan_failed', 'unscanned'));
