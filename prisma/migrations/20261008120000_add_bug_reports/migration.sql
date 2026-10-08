-- Idempotent: safe if a previous `db push` already created the table.
CREATE TABLE IF NOT EXISTS "bug_reports" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'bug',
    "description" TEXT NOT NULL,
    "screenshot" TEXT,
    "pin_x" DOUBLE PRECISION,
    "pin_y" DOUBLE PRECISION,
    "screen" TEXT,
    "device_info" TEXT,
    "app_version" TEXT,
    "note" TEXT,
    "zone" JSONB,
    "status" TEXT NOT NULL DEFAULT 'open',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bug_reports_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "bug_reports" ADD COLUMN IF NOT EXISTS "note" TEXT;
ALTER TABLE "bug_reports" ADD COLUMN IF NOT EXISTS "zone" JSONB;

CREATE INDEX IF NOT EXISTS "bug_reports_business_id_idx" ON "bug_reports"("business_id");

DO $$ BEGIN
    ALTER TABLE "bug_reports" ADD CONSTRAINT "bug_reports_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "bug_reports" ADD CONSTRAINT "bug_reports_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
