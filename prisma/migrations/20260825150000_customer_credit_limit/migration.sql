-- Customer credit ceiling (dette alert threshold). NULL = no limit configured.
ALTER TABLE "customers" ADD COLUMN "credit_limit" DECIMAL(14, 2);
