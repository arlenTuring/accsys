-- Allow budget codes to be disabled so they no longer appear in form dropdowns while preserving history.

ALTER TABLE "budget_codes" ADD COLUMN IF NOT EXISTS "active" boolean DEFAULT true NOT NULL;
