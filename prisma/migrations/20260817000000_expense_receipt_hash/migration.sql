-- Add sha256 hash of receipt bytes for duplicate detection.
ALTER TABLE "expenses" ADD COLUMN "receipt_hash" CHAR(64);
CREATE INDEX "expenses_business_id_receipt_hash_idx" ON "expenses"("business_id", "receipt_hash");
