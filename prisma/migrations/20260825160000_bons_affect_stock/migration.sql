-- Per-business toggle: when false, signing bons is documentary only (no stock ledger posts).
ALTER TABLE "businesses" ADD COLUMN "bons_affect_stock" BOOLEAN NOT NULL DEFAULT true;
