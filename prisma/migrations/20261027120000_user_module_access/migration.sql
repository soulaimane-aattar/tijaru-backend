-- Per-employee module allow-list. restrict_modules=false (default) keeps today's
-- behaviour: the user can use every module the business has active.
ALTER TABLE "users" ADD COLUMN "restrict_modules" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN "module_access" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
